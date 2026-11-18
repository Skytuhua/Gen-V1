import { randomUUID } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import {
  CONTROL_MAX_OBSERVATION_AGE_MS,
  CONTROL_MIN_DISPATCH_INTERVAL_MS,
  CONTROL_QUEUE_CAP,
  classifyControlAction,
  controlActionV1Schema,
  controlTargetIdentityV1Schema,
  type ControlActionV1,
  type ControlDriverRegistrationV1,
  type ControlMode,
  type ControlTargetCandidateV1,
  type ControlTargetIdentityV1,
  type InteractiveGrantV1,
  type TargetObservationV1,
} from '../contracts/interactive-control.ts';
import { sameTargetIdentity, grantState } from './browser-consent.ts';

/** M16 input dispatch (C1/C4 contracts). Input actions are serialized with at
 * least CONTROL_MIN_DISPATCH_INTERVAL_MS between dispatches, a queue cap of
 * CONTROL_QUEUE_CAP, and a fresh observation (<=2s) immediately before each
 * dispatch (S06). Stop bumps the revocation generation before queued actions
 * are cancelled; already delivered input is recorded as uncertain, never
 * claimed undoable (D06/G03). Native backend absence leaves the input
 * functions unregistered (D07). */

export interface ControlDriverHandle {
  /** Fresh observation of the approved target only; never an enumeration. */
  observe(target: ControlTargetIdentityV1): Promise<TargetObservationV1>;
  /** Deliver one admitted input action to the target. */
  dispatch(action: ControlActionV1): Promise<{ receipt: string }>;
  /** D02 input-cancellation operation; registration proves it exists. */
  cancelInput(target: ControlTargetIdentityV1): Promise<void>;
}

/** The full approved-driver surface. The serialized input path only needs the
 * narrow ControlDriverHandle; candidates, target picking and capture are the
 * consent/observation half of the same D02 driver (S02/S05). A driver that
 * cannot perform an operation throws HarnessError — never a silent fallback. */
export interface ControlDriverOperations extends ControlDriverHandle {
  /** Minimal-metadata candidate list for the approved target picker (S02). */
  candidates(mode: ControlMode): Promise<ControlTargetCandidateV1[]>;
  /** Runs the driver's own approved picker (e.g. the system
   * GraphicsCapturePicker) and returns the exact user selection, or null on
   * user cancellation. Never enumerates unrelated windows. */
  pickTarget(mode: ControlMode): Promise<ControlTargetCandidateV1 | null>;
  /** Observation pixels of the consented target only. */
  capture(target: ControlTargetIdentityV1): Promise<{ data: Uint8Array; width: number; height: number; mimeType: 'image/png' }>;
}

export interface QueuedControlAction {
  action: ControlActionV1;
  grant: InteractiveGrantV1;
  observation: TargetObservationV1;
  generation: number;
  outcome: 'QUEUED' | 'DISPATCHED' | 'REJECTED' | 'CANCELLED' | 'UNCERTAIN';
  reason?: string;
  /** Set once the action has been handed to the driver; only such an action
   * can be UNCERTAIN under Stop — a waiting one was never dispatched. */
  reachedDispatch?: boolean;
  /** Resolves once the action has left the queue with its terminal outcome —
   * dispatched, rejected, cancelled or uncertain. */
  settled?: Promise<QueuedControlAction>;
}

export interface ControlDispatcherOptions {
  driver?: ControlDriverHandle;
  registration?: ControlDriverRegistrationV1;
  nowMs?: () => number;
  sleepMs?: (ms: number) => Promise<void>;
}

export class ControlDispatcher {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: QueuedControlAction[] = [];
  private dispatched: QueuedControlAction[] = [];
  private inFlight: QueuedControlAction | null = null;
  private generation = 0;
  private lastDispatchAt = -Infinity;
  private draining: Promise<void> | null = null;
  private stopped = false;
  private readonly settleWaiters = new Map<QueuedControlAction, (item: QueuedControlAction) => void>();

  constructor(private readonly options: ControlDispatcherOptions) {
    this.now = options.nowMs ?? Date.now;
    this.sleep = options.sleepMs ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  }

  get stoppedGeneration(): number { return this.generation; }
  get pending(): readonly QueuedControlAction[] { return this.queue; }
  get completed(): readonly QueuedControlAction[] { return this.dispatched; }

  /** D07: native backend absence leaves input functions unregistered — every
   * input attempt fails DRIVER_UNAVAILABLE before any driver call (D01). */
  private requireDriver(): { driver: ControlDriverHandle; registration: ControlDriverRegistrationV1 } {
    if (!this.options.driver || !this.options.registration) throw new HarnessError('DRIVER_UNAVAILABLE', 'No approved control driver is registered; live input is unavailable.');
    return { driver: this.options.driver, registration: this.options.registration };
  }

  /** Queue one action bound to the current grant generation and a fresh
   * observation. Capture is refused here — this queue is input only; observe
   * goes through the consent host's separate capture permission. */
  enqueue(input: { grant: InteractiveGrantV1; action: Omit<ControlActionV1, 'actionId' | 'grantId' | 'target' | 'preObservationRef' | 'postObservationRef' | 'effectReceipt'>; observation: TargetObservationV1 }): QueuedControlAction {
    this.requireDriver();
    if (this.stopped) throw new HarnessError('CANCELLED', 'Control input was stopped; request renewed consent.');
    if (grantState(input.grant, this.now(), this.generation) !== 'ACTIVE') throw new HarnessError('CAPABILITY_DENIED', 'The control grant is expired or revoked.');
    if (input.action.action === 'CAPTURE') throw new HarnessError('INVALID_INPUT', 'CAPTURE is an observation, not a queued input action.');
    // D05/S07: every dispatch passes the host-classified effect risk. An
    // unclassified action denies; consequential operations keep their
    // separate exact approval; credential text is never typed (secure handoff).
    const classification = classifyControlAction(input.action.action, input.action.redactedParameters);
    if (classification === 'DENY') throw new HarnessError('CAPABILITY_DENIED', 'This control action is not consented; credentials go through the secure human handoff.');
    if (classification === 'REQUIRE_APPROVAL') throw new HarnessError('APPROVAL_REQUIRED', 'This consequential control action needs its own exact approval.');
    // D03/D05: operations the grant did not explicitly consent deny — consent
    // is an allowlist, never a floor.
    if (!input.grant.permittedOperations.includes(input.action.action)) throw new HarnessError('CAPABILITY_DENIED', `Operation ${input.action.action} is not consented for this target.`);
    if (this.queue.length + (this.inFlight ? 1 : 0) >= CONTROL_QUEUE_CAP) throw new HarnessError('QUEUE_FULL', 'The control input queue is full.');
    if (this.now() - input.observation.observedAtMs > CONTROL_MAX_OBSERVATION_AGE_MS) throw new HarnessError('OBSERVATION_STALE', 'The target observation is stale; observe again before queuing input.');
    if (!sameTargetIdentity(input.grant.target, input.observation.target)) throw new HarnessError('TARGET_MISMATCH', 'The observation does not describe the granted target.');
    controlTargetIdentityV1Schema.parse(input.observation.target);
    const item: QueuedControlAction = {
      action: controlActionV1Schema.parse({
        actionId: `action-${randomUUID()}`,
        grantId: input.grant.grantId,
        target: input.observation.target,
        action: input.action.action,
        redactedParameters: input.action.redactedParameters,
        preObservationRef: input.observation.observationId,
        postObservationRef: null,
        effectReceipt: null,
      }),
      grant: input.grant,
      observation: input.observation,
      generation: this.generation,
      outcome: 'QUEUED',
    };
    item.settled = new Promise<QueuedControlAction>(resolve => { this.settleWaiters.set(item, resolve); });
    this.queue.push(item);
    this.draining ??= this.drain().finally(() => { this.draining = null; });
    return item;
  }

  /** Reobserve immediately before dispatch. Movement, resize, minimization,
   * DPI change or an identity mismatch invalidates the queued action — a new
   * observation is requested instead of rescaling an old click (S06/D03). */
  private async freshObservation(driver: ControlDriverHandle, item: QueuedControlAction): Promise<TargetObservationV1> {
    const observed = await driver.observe(item.grant.target);
    if (!sameTargetIdentity(observed.target, item.grant.target)) throw new HarnessError('TARGET_MISMATCH', 'The controlled target changed identity; renew consent.');
    // A tab that navigated to an origin outside the consent loses input
    // authority even when identity and geometry are unchanged (S03). An
    // unreported origin is never a member of a declared list.
    if (item.grant.target.kind === 'BROWSER_TAB' && item.grant.allowedOrigins.length > 0 && (observed.target.origin === null || !item.grant.allowedOrigins.includes(observed.target.origin))) throw new HarnessError('NEEDS_NEW_PERMISSION', 'The controlled tab navigated to an unconsented origin; renew consent.');
    if (JSON.stringify(observed.geometry) !== JSON.stringify(item.observation.geometry)) throw new HarnessError('TARGET_MOVED', 'The controlled target moved or changed DPI; observe again.');
    if (this.now() - observed.observedAtMs > CONTROL_MAX_OBSERVATION_AGE_MS) throw new HarnessError('OBSERVATION_STALE', 'The fresh observation arrived stale.');
    return observed;
  }

  /** Permission state for an item right now: the dispatcher's own generation
   * must match the generation recorded at enqueue, Stop must not have run and
   * the grant must still be active under that generation. */
  private permissionLive(item: QueuedControlAction): boolean {
    return !this.stopped && item.generation === this.generation && grantState(item.grant, this.now(), this.generation) === 'ACTIVE';
  }

  private async drain(): Promise<void> {
    const { driver } = this.requireDriver();
    while (this.queue.length) {
      const item = this.queue.shift()!;
      // Account for the item as in flight immediately: an enqueue during the
      // rate-limit wait must still count it against the queue cap.
      this.inFlight = item;
      try {
        const wait = CONTROL_MIN_DISPATCH_INTERVAL_MS - (this.now() - this.lastDispatchAt);
        if (wait > 0) await this.sleep(wait);
        if (!this.permissionLive(item)) {
          item.outcome = 'CANCELLED';
          item.reason = 'grant_revoked';
        } else {
          await this.freshObservation(driver, item);
          // Stop or expiry can land while observe is in flight; re-check
          // permission immediately before handing input to the driver.
          if (!this.permissionLive(item)) {
            item.outcome = 'CANCELLED';
            item.reason = 'grant_revoked';
          } else {
            item.reachedDispatch = true;
            // Rate-limit spacing binds dispatch attempts, not only successes.
            this.lastDispatchAt = this.now();
            const result = await driver.dispatch(item.action);
            // UNCERTAIN set by stop() survives: a delivered-or-hung dispatch is
            // never claimed DISPATCHED after Stop.
            if (item.outcome === 'QUEUED') item.outcome = 'DISPATCHED';
            // Post-action evidence must postdate the action; a failed
            // post-observation stays null rather than mislabelling the
            // pre-dispatch observation as the resulting state.
            let postObservationRef: string | null = null;
            try {
              const post = await driver.observe(item.grant.target);
              // An observation of a different target is not evidence for this
              // action; only a matching post-observation is recorded.
              if (sameTargetIdentity(post.target, item.grant.target)) postObservationRef = post.observationId;
            } catch { postObservationRef = null; }
            item.action = { ...item.action, postObservationRef, effectReceipt: result.receipt };
          }
        }
      } catch (error) {
        // A still-QUEUED action whose permission died while it waited or
        // observed is a cancellation, not a rejection; only failures before
        // dispatch are rejections, and dispatch-stage failures stay UNCERTAIN.
        if (item.outcome === 'QUEUED') {
          // Dispatch is the decisive boundary: once input was handed to the
          // driver the outcome is UNCERTAIN, however permission ended; a
          // never-dispatched action is CANCELLED when permission died and
          // REJECTED only for a failure while permission was live.
          if (item.reachedDispatch) item.outcome = 'UNCERTAIN';
          else item.outcome = this.permissionLive(item) ? 'REJECTED' : 'CANCELLED';
          item.reason = item.outcome === 'CANCELLED' ? 'grant_revoked' : (error instanceof HarnessError ? error.code : 'DRIVER_ERROR');
        }
      } finally {
        if (this.inFlight === item) this.inFlight = null;
        this.dispatched.push(item);
        this.settleWaiters.get(item)?.(item);
        this.settleWaiters.delete(item);
      }
    }
  }

  /** D05/D06: independent Stop. Revokes the generation first — queued
   * actions see a dead generation before any cancellation reaches the driver
   * — then cancels pending input via the driver's cancellation operation and
   * marks it CANCELLED. In-flight items already handed to the driver become
   * UNCERTAIN; no old-generation input reaches a replacement target. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.outcome = 'CANCELLED';
      item.reason = 'stopped';
      this.dispatched.push(item);
      this.settleWaiters.get(item)?.(item);
      this.settleWaiters.delete(item);
    }
    // Only an action already handed to the driver is uncertain; one still
    // waiting for rate spacing was never dispatched and stays a clean cancel.
    if (this.inFlight && this.inFlight.outcome === 'QUEUED' && this.inFlight.reachedDispatch) { this.inFlight.outcome = 'UNCERTAIN'; this.inFlight.reason = 'stopped_in_flight'; }
    try { await this.options.driver?.cancelInput((this.inFlight ?? pending[0])?.grant.target ?? { kind: 'APPLICATION', creationIdentity: 'none', sessionIdentity: 'none', origin: null }); }
    catch { /* Stop must still finish: cancellation is best-effort after generation revocation. */ }
    // Deliberately not awaiting this.draining: a hung driver dispatch must
    // never block Stop (D05). The drain records outcomes as it unwinds.
  }
}

/** S09: platform capability detection. Unsupported sessions, missing
 * permissions or untested drivers report BLOCKED — never a silent fallback to
 * broad OS automation. */
export function controlCapability(input: { flagEnabled: boolean; registration: ControlDriverRegistrationV1 | null; platformSupported: boolean }): { state: 'AVAILABLE' | 'BLOCKED'; reason: string | null } {
  if (!input.flagEnabled) return { state: 'BLOCKED', reason: 'CAPABILITY_DISABLED' };
  if (!input.platformSupported) return { state: 'BLOCKED', reason: 'PLATFORM_UNSUPPORTED' };
  if (!input.registration) return { state: 'BLOCKED', reason: 'DRIVER_UNAVAILABLE' };
  return { state: 'AVAILABLE', reason: null };
}
