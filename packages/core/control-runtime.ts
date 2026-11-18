import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import type { ToolOwner } from '../contracts/tool-effects.ts';
import {
  storedCaptureV1Schema,
  type ControlActionV1,
  type ControlMode,
  type ControlTargetCandidateV1,
  type ControlTargetIdentityV1,
  type InteractiveGrantV1,
  type StoredCaptureV1,
} from '../contracts/interactive-control.ts';
import type { Store } from '../storage/store.ts';
import type { BrowserConsentHost, ControlDriverRegistry } from './browser-consent.ts';
import { ControlDispatcher, type ControlDriverOperations, type QueuedControlAction } from './desktop-control.ts';

/** M16 C3/C4 host runtime (followup/m16-windows-control-bridge). Owns the
 * single approved driver attachment, per-thread dispatchers and the artifact
 * store for captures. The consent host remains the only grant authority; this
 * runtime never writes grants, never relaxes a flag and never substitutes a
 * fallback driver — an unattached driver still resolves DRIVER_UNAVAILABLE
 * at the registry (D01/D02/D07). */

export interface ControlDriverAttachment {
  driver: ControlDriverOperations;
}

const ACTION_KINDS = ['CAPTURE', 'CLICK', 'TYPE', 'KEYPRESS', 'UPLOAD', 'DOWNLOAD', 'NAVIGATE'] as const;
type ActionKind = (typeof ACTION_KINDS)[number];

export class ControlRuntime {
  private driver: ControlDriverOperations | null = null;
  private readonly dispatchers = new Map<string, ControlDispatcher>();
  private readonly now: () => number;

  constructor(
    private readonly store: Store,
    private readonly consent: BrowserConsentHost,
    private readonly deps: {
      registry: ControlDriverRegistry;
      device: { deviceId: string; sessionId: string };
      artifactRoot: string;
      nowMs?: () => number;
    },
  ) {
    this.now = deps.nowMs ?? Date.now;
  }

  /** Attach the single approved driver. Registration entries were already
   * validated and registered by the caller's host path; this only wires the
   * executable handle. Detach leaves input functions unregistered again (D07). */
  attachDriver(driver: ControlDriverOperations): void { this.driver = driver; }
  detachDriver(): void {
    this.driver = null;
    for (const dispatcher of this.dispatchers.values()) void dispatcher.stop();
    this.dispatchers.clear();
  }
  driverAttached(): boolean { return this.driver !== null; }

  private requireDriver(): ControlDriverOperations {
    if (!this.driver) throw new HarnessError('DRIVER_UNAVAILABLE', 'No approved control driver is attached.');
    return this.driver;
  }

  /** S02 target candidates for a pending consent: browser modes enumerate the
   * driver's registered in-app targets; the desktop-application mode lists the
   * driver's app-owned consent-chooser rows (each carries its own proven
   * window handle — the system picker's pickTarget stays held). */
  async targets(mode: ControlMode): Promise<ControlTargetCandidateV1[]> {
    const driver = this.requireDriver();
    return this.consent.listTargets(mode, () => driver.candidates(mode));
  }

  /** Consent resolution stays a synchronous host command path: the grant is
   * written under the open command transaction with this host's authenticated
   * device/session identity. */
  grant(consentId: string, owner: ToolOwner, target: ControlTargetIdentityV1): InteractiveGrantV1 {
    return this.consent.grant(consentId, owner, target, this.deps.device);
  }

  private dispatcherFor(threadId: string, grant: InteractiveGrantV1): ControlDispatcher {
    const existing = this.dispatchers.get(threadId);
    if (existing) return existing;
    const dispatcher = new ControlDispatcher({
      driver: this.requireDriver(),
      registration: this.deps.registry.resolve(grant.mode),
      nowMs: this.now,
    });
    this.dispatchers.set(threadId, dispatcher);
    return dispatcher;
  }

  private activeGrant(threadId: string): InteractiveGrantV1 {
    const grant = this.consent.activeGrant(threadId);
    if (!grant) throw new HarnessError('CAPABILITY_DENIED', 'No active control grant for this thread.');
    return grant;
  }

  /** Observe permission is independent of interact permission (D03). The PNG
   * bytes are private task data: they are written only under the host artifact
   * root with a recorded digest and are never sent anywhere else (S05/S08). */
  async capture(threadId: string): Promise<{ capture: StoredCaptureV1; artifactRef: string }> {
    const grant = this.activeGrant(threadId);
    this.consent.authorizeAction(grant, 'CAPTURE');
    const registration = this.deps.registry.resolve(grant.mode);
    const frame = await this.requireDriver().capture(grant.target);
    if (frame.width > registration.captureBounds.maxWidth || frame.height > registration.captureBounds.maxHeight || frame.data.byteLength > registration.captureBounds.maxBytes) {
      throw new HarnessError('CAPTURE_BOUNDS_EXCEEDED', 'The capture exceeded the approved driver bounds.');
    }
    const artifactId = `capture-${randomUUID()}`;
    const sha = createHash('sha256').update(frame.data).digest('hex');
    const relative = join('control-captures', threadId, `${artifactId}.png`);
    const absolute = join(this.deps.artifactRoot, relative);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, frame.data, { mode: 0o600 });
    const capture = storedCaptureV1Schema.parse({
      artifactId,
      target: grant.target,
      timestampMs: this.now(),
      frameDimensions: { width: frame.width, height: frame.height },
      sourceOwner: grant.owner.threadId,
      captureScope: { kind: grant.target.kind === 'BROWSER_TAB' ? 'TAB' : 'WINDOW', region: null },
      artifactRef: relative.replaceAll('\\', '/'),
      sha256: sha,
      mimeType: 'image/png',
    });
    this.store.internal('control.capture', threadId, () => { this.store.put('controlCapture', capture.artifactId, threadId, capture); });
    return { capture, artifactRef: capture.artifactRef };
  }

  /** Dispatch one consent-admitted input action through the serialized queue.
   * The action is validated against the live grant, host-classified (D05),
   * enqueued with a fresh observation and settled before the durable
   * 'controlAction' record is written. Nothing bypasses the queue. */
  async action(threadId: string, _owner: ToolOwner, input: { action: string; parameters?: Record<string, unknown>; observation: unknown }): Promise<{ action: ControlActionV1; outcome: QueuedControlAction['outcome']; reason?: string }> {
    if (!ACTION_KINDS.includes(input.action as ActionKind) || input.action === 'CAPTURE') throw new HarnessError('INVALID_INPUT', 'Choose a valid control input action.');
    const grant = this.activeGrant(threadId);
    const kind = input.action as Exclude<ActionKind, 'CAPTURE'>;
    this.consent.authorizeAction(grant, kind);
    if (!input.observation || typeof input.observation !== 'object') throw new HarnessError('INVALID_INPUT', 'A fresh target observation is required.');
    const observation = input.observation as import('../contracts/interactive-control.ts').TargetObservationV1;
    this.consent.validateTarget(grant, observation.target, observation.target.origin);
    const dispatcher = this.dispatcherFor(threadId, grant);
    const item = dispatcher.enqueue({
      grant,
      action: { action: kind, redactedParameters: input.parameters ?? {} },
      observation,
    });
    const settled = await item.settled!;
    const record = settled.action;
    this.store.internal('control.action.settled', threadId, () => {
      this.store.put('controlAction', record.actionId, threadId, { ...record, outcome: settled.outcome, reason: settled.reason ?? null });
    });
    return { action: record, outcome: settled.outcome, reason: settled.reason };
  }

  /** Fresh observation of the granted target straight from the driver —
   * callers enqueue input only against a current observation (S06). */
  async observe(threadId: string): Promise<import('../contracts/interactive-control.ts').TargetObservationV1> {
    const grant = this.activeGrant(threadId);
    const observation = await this.requireDriver().observe(grant.target);
    const state = this.consent.validateTarget(grant, observation.target, observation.target.origin);
    if (state !== 'ACTIVE') throw new HarnessError(state === 'NEEDS_NEW_PERMISSION' ? 'NEEDS_NEW_PERMISSION' : 'CAPABILITY_DENIED', 'The controlled target needs renewed consent.');
    return observation;
  }

  /** G03 rollback for dispatch: the dispatcher's generation is revoked before
   * queued actions are cancelled. Unconditional for this thread. */
  async stopDispatch(threadId: string): Promise<void> {
    const dispatcher = this.dispatchers.get(threadId);
    if (!dispatcher) return;
    this.dispatchers.delete(threadId);
    await dispatcher.stop();
  }

  /** Rollback: revoke grants via the consent host and stop input. Only this
   * thread's own control connection is touched; owned receipts stay (G03). */
  async stop(threadId: string) {
    const stopping = this.stopDispatch(threadId);
    const surface = this.consent.stop(threadId);
    await stopping;
    return surface;
  }
}
