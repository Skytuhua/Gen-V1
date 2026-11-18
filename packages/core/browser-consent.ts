import { randomUUID } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import type { ToolOwner } from '../contracts/tool-effects.ts';
import {
  CONTROL_GRANT_TTL_MS,
  consentRequestV1Schema,
  controlDriverRegistrationV1Schema,
  interactiveGrantV1Schema,
  type ConsentRequestV1,
  type ControlDriverRegistrationV1,
  type ControlInteractOperation,
  type ControlMode,
  type ControlSurfaceModelV1,
  type ControlTargetCandidateV1,
  type ControlTargetIdentityV1,
  type InteractiveGrantV1,
} from '../contracts/interactive-control.ts';
import { capabilityEnabled } from './capability-flags.ts';
import type { Store } from '../storage/store.ts';

/** M16 consent and grant authority (C1). The host owns grant records; every
 * action revalidates grant expiry, revocation generation and the exact target
 * identity. With zero or ambiguous approved driver registrations the only
 * answer is DRIVER_UNAVAILABLE — before any OS or browser call (D01/D02).
 * Existing sessions never inherit access from a visible screenshot (S01). */

export const CONTROL_UNAVAILABLE_REASON = 'DRIVER_UNAVAILABLE';

/** Approved driver registry (D02). Registration is host composition, never
 * tool-callable; zero or more-than-one matching drivers both produce
 * DRIVER_UNAVAILABLE. */
export class ControlDriverRegistry {
  private readonly registrations: ControlDriverRegistrationV1[] = [];
  register(registration: ControlDriverRegistrationV1): ControlDriverRegistrationV1 {
    const parsed = controlDriverRegistrationV1Schema.parse(registration);
    if (this.registrations.some(item => item.driverId === parsed.driverId)) throw new HarnessError('REGISTRY_CONFLICT', `Duplicate driver registration: ${parsed.driverId}`);
    this.registrations.push(parsed);
    return parsed;
  }
  /** Exactly one driver may back a mode; zero or ambiguous = unavailable. */
  resolve(mode: ControlMode): ControlDriverRegistrationV1 {
    const matches = this.registrations.filter(item => item.apiProtocol === protocolFor(mode));
    if (matches.length !== 1) throw new HarnessError(CONTROL_UNAVAILABLE_REASON, 'No unique approved control driver is registered for this mode.');
    return matches[0]!;
  }
  list(): readonly ControlDriverRegistrationV1[] { return this.registrations; }
}

function protocolFor(mode: ControlMode): string {
  return mode === 'SELECTED_DESKTOP_APPLICATION' ? 'native-window' : 'browser-tab';
}

/** The shared registry the host composes. Empty until an approved driver
 * exists; tests inject their own instance — never mutate this one. */
export const hostControlDriverRegistry = new ControlDriverRegistry();

const flagFor = (mode: ControlMode): 'control.consentedBrowserV1' | 'control.selectedDesktopV1' =>
  mode === 'SELECTED_DESKTOP_APPLICATION' ? 'control.selectedDesktopV1' : 'control.consentedBrowserV1';

export function sameTargetIdentity(a: ControlTargetIdentityV1, b: ControlTargetIdentityV1): boolean {
  return a.kind === b.kind && a.creationIdentity === b.creationIdentity && a.sessionIdentity === b.sessionIdentity;
}

export type GrantState = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'NEEDS_NEW_PERMISSION';

export function grantState(grant: InteractiveGrantV1, nowMs: number, currentRevocationGeneration?: number): GrantState {
  // revocationGeneration is bumped exactly by revocation: a holder passing
  // its recorded generation sees REVOKED once they differ, and a reader of
  // the record itself sees REVOKED once it is non-zero.
  if (currentRevocationGeneration !== undefined ? currentRevocationGeneration !== grant.revocationGeneration : grant.revocationGeneration !== 0) return 'REVOKED';
  if (nowMs >= grant.expiresAtMs) return 'EXPIRED';
  return 'ACTIVE';
}

export class BrowserConsentHost {
  constructor(
    private readonly store: Store,
    private readonly deps: { registry: ControlDriverRegistry; nowMs?: () => number } = { registry: hostControlDriverRegistry },
  ) {}
  private now(): number { return (this.deps.nowMs ?? Date.now)(); }

  /** Writes go through the caller's open command transaction when one exists
   * (Store forbids nested commits), otherwise open an internal event. The
   * event type is still recorded either way. */
  private write<T>(type: string, threadId: string | null, apply: () => T): T {
    return this.store.inTransaction ? apply() : this.store.internal(type, threadId, apply) as T;
  }

  private grants(threadId: string): InteractiveGrantV1[] {
    return this.store.all<InteractiveGrantV1>('interactiveGrant', threadId).filter(item => item.owner.threadId === threadId);
  }
  activeGrant(threadId: string): InteractiveGrantV1 | null {
    return this.grants(threadId).find(grant => grantState(grant, this.now()) === 'ACTIVE') ?? null;
  }
  private consents(threadId: string): ConsentRequestV1[] {
    return this.store.all<ConsentRequestV1>('controlConsent', threadId);
  }
  pendingConsent(threadId: string): ConsentRequestV1 | null {
    return this.consents(threadId).find(item => item.state === 'PENDING' || item.state === 'UNAVAILABLE') ?? null;
  }

  /** U02 consent preview: Observe and Interact permissions stay separated,
   * expiry and allowed origins are named. A new origin or changed target
   * presents "Needs new permission" via the surface model, never a quiet
   * re-scoping. */
  consentPreview(input: { mode: ControlMode; observe: boolean; operations: readonly ControlInteractOperation[]; allowedOrigins: readonly string[] }): { mode: ControlMode; observe: boolean; interact: boolean; operations: readonly ControlInteractOperation[]; allowedOrigins: readonly string[]; expiresInMs: number } {
    return { mode: input.mode, observe: input.observe, interact: input.operations.length > 0, operations: input.operations, allowedOrigins: input.allowedOrigins, expiresInMs: CONTROL_GRANT_TTL_MS };
  }

  /** Request a consent surface for a thread. When the capability is disabled
   * the request is recorded UNAVAILABLE with the reason — this is what makes
   * the disabled capability presentation reachable in production — and never
   * becomes a grant. */
  requestConsent(owner: ToolOwner, input: { mode: ControlMode; observe: boolean; operations?: readonly ControlInteractOperation[]; allowedOrigins?: readonly string[] }): ConsentRequestV1 {
    const enabled = capabilityEnabled(flagFor(input.mode));
    const record: ConsentRequestV1 = consentRequestV1Schema.parse({
      consentId: `consent-${randomUUID()}`,
      owner,
      mode: input.mode,
      requestedObserve: input.observe,
      requestedOperations: input.operations ?? [],
      allowedOrigins: input.allowedOrigins ?? [],
      state: enabled ? 'PENDING' : 'UNAVAILABLE',
      reason: enabled ? null : CONTROL_UNAVAILABLE_REASON,
      createdAtMs: this.now(),
      resolvedAtMs: enabled ? null : this.now(),
    });
    return this.write('control.consent.requested', owner.threadId, () => {
      this.store.put('controlConsent', record.consentId, owner.threadId, record);
      return record;
    });
  }

  /** Resolve a pending consent into a grant. Requires the registered mode
   * flag, an unexpired pending request, and exactly one approved driver
   * registration. Never extends a grant automatically (C01). */
  grant(consentId: string, owner: ToolOwner, target: ControlTargetIdentityV1, device: { deviceId: string; sessionId: string }): InteractiveGrantV1 {
    const consent = this.store.get<ConsentRequestV1>('controlConsent', consentId);
    if (!consent || consent.owner.threadId !== owner.threadId || consent.state !== 'PENDING') throw new HarnessError('CAPABILITY_DENIED', 'No pending consent request for this grant.');
    if (!capabilityEnabled(flagFor(consent.mode))) throw new HarnessError('CAPABILITY_DENIED', 'This control capability is disabled on this host.');
    const expectedKind = consent.mode === 'SELECTED_DESKTOP_APPLICATION' ? 'APPLICATION' : 'BROWSER_TAB';
    if (target.kind !== expectedKind) throw new HarnessError('INVALID_INPUT', 'The selected target does not match the consented mode.');
    this.deps.registry.resolve(consent.mode);
    const now = this.now();
    const grant: InteractiveGrantV1 = interactiveGrantV1Schema.parse({
      grantId: `grant-${randomUUID()}`,
      owner,
      deviceIdentity: device,
      mode: consent.mode,
      target,
      permittedOperations: consent.requestedOperations,
      allowedOrigins: consent.allowedOrigins,
      capturePermission: consent.requestedObserve,
      issuedAtMs: now,
      expiresAtMs: now + CONTROL_GRANT_TTL_MS,
      revocationGeneration: 0,
    });
    return this.write('control.grant.issued', owner.threadId, () => {
      this.store.put('interactiveGrant', grant.grantId, owner.threadId, grant);
      this.store.put('controlConsent', consentId, owner.threadId, { ...consent, state: 'GRANTED', resolvedAtMs: now });
      return grant;
    });
  }

  /** S04: revocation bumps the generation before any queued action is
   * cancelled — already dispatched effects keep M02 uncertainty records. */
  revoke(grantId: string): InteractiveGrantV1 {
    const grant = this.store.get<InteractiveGrantV1>('interactiveGrant', grantId);
    if (!grant) throw new HarnessError('NOT_FOUND', 'Unknown control grant.');
    return this.write('control.grant.revoked', grant.owner.threadId, () => {
      const current = this.store.get<InteractiveGrantV1>('interactiveGrant', grantId)!;
      const revoked = { ...current, revocationGeneration: current.revocationGeneration + 1 };
      this.store.put('interactiveGrant', grantId, current.owner.threadId, revoked);
      return revoked;
    });
  }

  /** S04/G03: independent host Stop — the rollback surface the UI's Stop
   * button binds to. Revokes the active grant (bumping revocationGeneration
   * before any queued-action cancellation the driver layer performs) and
   * closes a still-pending consent. Only this thread's own control state is
   * touched; unrelated tabs, applications and their state are never closed,
   * and grant/consent records are retained as receipts. */
  stop(threadId: string): ControlSurfaceModelV1 {
    const actives = this.grants(threadId).filter(grant => grantState(grant, this.now()) === 'ACTIVE');
    const pending = actives.length ? null : this.pendingConsent(threadId);
    if (!actives.length && !pending) return this.surfaceModel(threadId);
    this.write('control.stopped', threadId, () => {
      // Stop is unconditional for this thread: every active grant is revoked,
      // never only the first one the lookup happens to return.
      for (const grant of actives) {
        const current = this.store.get<InteractiveGrantV1>('interactiveGrant', grant.grantId);
        if (current) this.store.put('interactiveGrant', grant.grantId, threadId, { ...current, revocationGeneration: current.revocationGeneration + 1 });
      }
      if (!actives.length && pending) {
        this.store.put('controlConsent', pending.consentId, threadId, { ...pending, state: 'DENIED', reason: 'stopped', resolvedAtMs: this.now() });
      }
    });
    return this.surfaceModel(threadId);
  }

  /** S03: validate the live target at each action. A new origin, changed
   * process/window creation identity or a revoked grant all require renewed
   * consent — the pending action is refused, never transformed. */
  validateTarget(grant: InteractiveGrantV1, observed: ControlTargetIdentityV1, origin: string | null = observed.origin): GrantState {
    // Read the live record: the caller's object may be a stale snapshot taken
    // before a revocation, and revocation must never be missed (S03/D04).
    const live = this.store.get<InteractiveGrantV1>('interactiveGrant', grant.grantId) ?? grant;
    const state = grantState(live, this.now());
    if (state !== 'ACTIVE') return state;
    if (!sameTargetIdentity(live.target, observed)) return 'NEEDS_NEW_PERMISSION';
    // A declared origin list authorizes only a proven member: an unreported
    // origin is outside it, never silently inside. A grant that declares no
    // origins keeps origin out of its policy.
    if (live.target.kind === 'BROWSER_TAB' && live.allowedOrigins.length > 0 && (origin === null || !live.allowedOrigins.includes(origin))) return 'NEEDS_NEW_PERMISSION';
    return 'ACTIVE';
  }

  /** Per-action authorization (D03/D05): capture and interact are independent;
   * an action absent from permittedOperations is denied, never inferred
   * harmless. The caller supplies the current generation from its own
   * revocation counter. */
  authorizeAction(grant: InteractiveGrantV1, action: 'CAPTURE' | ControlInteractOperation, currentRevocationGeneration?: number): void {
    // Authorize the live record, never the caller's snapshot: a grant revoked
    // after issue must not stay authorized (S03/D04).
    const live = this.store.get<InteractiveGrantV1>('interactiveGrant', grant.grantId) ?? grant;
    if (grantState(live, this.now(), currentRevocationGeneration) !== 'ACTIVE') throw new HarnessError('CAPABILITY_DENIED', 'The control grant is expired or revoked.');
    if (action === 'CAPTURE') { if (!live.capturePermission) throw new HarnessError('CAPABILITY_DENIED', 'Observation was not consented for this target.'); return; }
    if (!live.permittedOperations.includes(action)) throw new HarnessError('CAPABILITY_DENIED', `Operation ${action} is not consented for this target.`);
  }

  /** S02: candidate targets come only through the approved driver for the
   * mode — no auto-attach, no unrelated window/profile enumeration. */
  listTargets(mode: ControlMode, enumerate: (registration: ControlDriverRegistrationV1) => ControlTargetCandidateV1[] | Promise<ControlTargetCandidateV1[]>): Promise<ControlTargetCandidateV1[]> {
    if (!capabilityEnabled(flagFor(mode))) throw new HarnessError('CAPABILITY_DENIED', 'This control capability is disabled on this host.');
    return Promise.resolve(enumerate(this.deps.registry.resolve(mode)));
  }

  /** G/U01-U03: the surface the production UI binds to. Disabled presents the
   * unavailable screen; a pending or recorded consent request shows the
   * consent state; an active grant shows mode, target, permissions, expiry
   * and the persistent Stop. */
  surfaceModel(threadId: string): ControlSurfaceModelV1 {
    const grant = this.activeGrant(threadId);
    const pending = grant ? null : this.pendingConsent(threadId);
    const browserEnabled = capabilityEnabled('control.consentedBrowserV1');
    const desktopEnabled = capabilityEnabled('control.selectedDesktopV1');
    const modeAvailable = (mode: ControlMode) => (mode === 'SELECTED_DESKTOP_APPLICATION' ? desktopEnabled : browserEnabled) && this.deps.registry.list().filter(item => item.apiProtocol === protocolFor(mode)).length === 1;
    return {
      state: grant ? 'active' : pending ? (pending.state === 'PENDING' ? 'consent' : 'unavailable') : 'unavailable',
      liveControlActive: grant !== null,
      modes: (['FRESH_VERIFICATION_BROWSER', 'CONSENTED_EXISTING_TAB', 'SELECTED_DESKTOP_APPLICATION'] as const).map(mode => ({
        mode,
        available: modeAvailable(mode),
        reason: modeAvailable(mode) ? null : CONTROL_UNAVAILABLE_REASON,
      })),
      permissions: { observe: grant?.capturePermission ?? pending?.requestedObserve ?? false, interact: (grant?.permittedOperations.length ?? pending?.requestedOperations.length ?? 0) > 0 },
      expiryMs: grant ? grant.expiresAtMs - this.now() : CONTROL_GRANT_TTL_MS,
      activeGrant: grant,
      pendingConsent: pending,
      stopAvailable: grant !== null,
      reason: grant ? null : pending ? (pending.state === 'PENDING' ? null : (pending.reason ?? CONTROL_UNAVAILABLE_REASON)) : CONTROL_UNAVAILABLE_REASON,
    };
  }
}
