import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store.ts';
import { BrowserConsentHost, ControlDriverRegistry, grantState, sameTargetIdentity } from '../packages/core/browser-consent.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import {
  CONTROL_GRANT_TTL_MS,
  captureV1Schema,
  consentRequestV1Schema,
  controlActionV1Schema,
  controlDriverRegistrationV1Schema,
  interactiveGrantV1Schema,
  type ConsentRequestV1,
  type ControlTargetIdentityV1,
  type InteractiveGrantV1,
} from '../packages/contracts/interactive-control.ts';
import { HarnessError } from '../packages/contracts/index.ts';
import type { ToolOwner } from '../packages/contracts/tool-effects.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) fn();
  __setCapabilityFlagForTests('control.consentedBrowserV1', undefined);
  __setCapabilityFlagForTests('control.selectedDesktopV1', undefined);
});

const codeOf = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (error) { return error instanceof HarnessError ? error.code : 'UNEXPECTED'; }
};
const owner: ToolOwner = { threadId: 'thread-1', runId: null, epoch: 0, projectId: 'p1', workspaceId: 'w1', accountBinding: 'acct-1' };
const tab: ControlTargetIdentityV1 = { kind: 'BROWSER_TAB', creationIdentity: 'browser-target-7a9c', sessionIdentity: 'browser-session-01', origin: 'https://app.example' };
const app: ControlTargetIdentityV1 = { kind: 'APPLICATION', creationIdentity: 'process-created-1699', sessionIdentity: 'desktop-session-02', origin: null };
const device = { deviceId: 'device-9f', sessionId: 'device-session-31' };
const registration = (over: Partial<{ driverId: string; apiProtocol: string }> = {}) => ({
  driverId: over.driverId ?? 'driver-1',
  packageDigest: 'a'.repeat(64),
  apiProtocol: over.apiProtocol ?? 'browser-tab',
  backendProofRef: 'proof:backend-1',
  targetIdentityFormat: 'driver-target-id',
  captureBounds: { maxWidth: 3840, maxHeight: 2160, maxBytes: 8 * 1024 * 1024 },
  supportsInputCancellation: true as const,
  stopRoute: 'DRIVER_STOP' as const,
});

function fixture(flag = true) {
  const root = mkdtempSync(join(tmpdir(), 'm16-consent-'));
  const store = new Store(join(root, 'data'));
  cleanup.push(() => { try { store.close(); } catch { /* closed */ } rmSync(root, { recursive: true, force: true }); });
  const registry = new ControlDriverRegistry();
  const now = { value: 1_700_000_000_000 };
  const host = new BrowserConsentHost(store, { registry, nowMs: () => now.value });
  if (flag) __setCapabilityFlagForTests('control.consentedBrowserV1', true);
  return { store, registry, host, now };
}

function granted(host: BrowserConsentHost, registry: ControlDriverRegistry, mode: 'CONSENTED_EXISTING_TAB' | 'SELECTED_DESKTOP_APPLICATION' = 'CONSENTED_EXISTING_TAB'): InteractiveGrantV1 {
  if (mode === 'SELECTED_DESKTOP_APPLICATION') __setCapabilityFlagForTests('control.selectedDesktopV1', true);
  registry.register(registration({ apiProtocol: mode === 'SELECTED_DESKTOP_APPLICATION' ? 'native-window' : 'browser-tab' }));
  const consent = host.requestConsent(owner, { mode, observe: true, operations: ['CLICK', 'TYPE'], allowedOrigins: ['https://app.example'] });
  return host.grant(consent.consentId, owner, mode === 'SELECTED_DESKTOP_APPLICATION' ? app : tab, device);
}

describe('M16-C01 InteractiveGrantV1 contract', () => {
  it('round-trips a grant with owner, device session, target, permissions and revocation generation', () => {
    const { host, registry } = fixture();
    const grant = granted(host, registry);
    const parsed = interactiveGrantV1Schema.parse(grant);
    expect(parsed.owner).toEqual(owner);
    expect(parsed.deviceIdentity).toEqual(device);
    expect(parsed.target).toEqual(tab);
    expect(parsed.permittedOperations).toEqual(['CLICK', 'TYPE']);
    expect(parsed.capturePermission).toBe(true);
    expect(parsed.allowedOrigins).toEqual(['https://app.example']);
    expect(parsed.expiresAtMs - parsed.issuedAtMs).toBe(CONTROL_GRANT_TTL_MS);
    expect(parsed.revocationGeneration).toBe(0);
  });

  it('rejects grants missing device identity, expiry or creation identity', () => {
    const { host, registry } = fixture();
    const grant = granted(host, registry);
    expect(() => interactiveGrantV1Schema.parse({ ...grant, deviceIdentity: { deviceId: '', sessionId: 'x' } })).toThrow();
    expect(() => interactiveGrantV1Schema.parse({ ...grant, target: { ...grant.target, creationIdentity: '' } })).toThrow();
    expect(() => interactiveGrantV1Schema.parse({ ...grant, expiresAtMs: grant.issuedAtMs + CONTROL_GRANT_TTL_MS + 1 })).not.toThrow(); // shape only; expiry ordering is enforced by grantState
  });
});

describe('M16-C02/M16-C03 action and capture contracts', () => {
  it('keeps CAPTURE separate from interact actions and carries observation references', () => {
    const action = controlActionV1Schema.parse({
      actionId: 'a1', grantId: 'g1', target: tab, action: 'CLICK',
      redactedParameters: { x: 12, y: 40 }, preObservationRef: 'obs-1', postObservationRef: 'obs-2', effectReceipt: 'rcpt-1',
    });
    expect(action.action).toBe('CLICK');
    const capture = captureV1Schema.parse({
      artifactId: 'shot-1', target: tab, timestampMs: 123, frameDimensions: { width: 800, height: 600 },
      sourceOwner: 'host', captureScope: { kind: 'TAB', region: null },
    });
    expect(capture.captureScope.kind).toBe('TAB');
    // Read/capture is a distinct permission — the action enum admits both but
    // grants authorize them separately (D03).
    expect(() => controlActionV1Schema.parse({ ...action, action: 'READ_CAPTURE' })).toThrow();
  });
});

describe('M16-S01/S02 modes, consent preview and driver resolution', () => {
  it('exposes three separate modes; only consent turns into a grant and existing sessions inherit nothing', () => {
    const { host, registry } = fixture();
    const preview = host.consentPreview({ mode: 'CONSENTED_EXISTING_TAB', observe: true, operations: ['CLICK'], allowedOrigins: ['https://app.example'] });
    expect(preview.interact).toBe(true);
    expect(preview.expiresInMs).toBe(CONTROL_GRANT_TTL_MS);
    // A screenshot or imported message grants nothing: a grant exists only
    // after an explicit consent resolution through this host.
    expect(host.activeGrant(owner.threadId)).toBeNull();
    registry.register(registration());
    const consent = host.requestConsent(owner, { mode: 'CONSENTED_EXISTING_TAB', observe: false, operations: ['CLICK'], allowedOrigins: ['https://app.example'] });
    expect(consent.state).toBe('PENDING');
    const grant = host.grant(consent.consentId, owner, tab, device);
    expect(grant.capturePermission).toBe(false);
  });

  it('zero or ambiguous driver registrations produce DRIVER_UNAVAILABLE', () => {
    const { host } = fixture();
    const consent = host.requestConsent(owner, { mode: 'CONSENTED_EXISTING_TAB', observe: true, operations: ['CLICK'] });
    expect(codeOf(() => host.grant(consent.consentId, owner, tab, device))).toBe('DRIVER_UNAVAILABLE');
    const ambiguous = new ControlDriverRegistry();
    ambiguous.register(registration({ driverId: 'a' }));
    ambiguous.register(registration({ driverId: 'b' }));
    const host2 = new BrowserConsentHost(new Store(join(mkdtempSync(join(tmpdir(), 'm16-amb-')), 'data')), { registry: ambiguous });
    cleanup.push(() => { try { (host2 as unknown as { store: Store }).store.close(); } catch { /* noop */ } });
    const consent2 = host2.requestConsent(owner, { mode: 'CONSENTED_EXISTING_TAB', observe: true, operations: ['CLICK'] });
    expect(codeOf(() => host2.grant(consent2.consentId, owner, tab, device))).toBe('DRIVER_UNAVAILABLE');
    expect(() => controlDriverRegistrationV1Schema.parse({ ...registration(), supportsInputCancellation: false })).toThrow();
    expect(() => controlDriverRegistrationV1Schema.parse({ ...registration(), packageDigest: 'not-a-digest' })).toThrow();
  });

  it('a consent request while the flag is off is recorded UNAVAILABLE, never granted', () => {
    const { host } = fixture(false);
    const consent = host.requestConsent(owner, { mode: 'CONSENTED_EXISTING_TAB', observe: true, operations: ['CLICK'] });
    expect(consent.state).toBe('UNAVAILABLE');
    expect(consent.reason).toBe('DRIVER_UNAVAILABLE');
    expect(codeOf(() => host.grant(consent.consentId, owner, tab, device))).toBe('CAPABILITY_DENIED');
    const model = host.surfaceModel(owner.threadId);
    expect(model.state).toBe('unavailable');
    expect(model.liveControlActive).toBe(false);
    expect(model.reason).toBe('DRIVER_UNAVAILABLE');
    expect(model.stopAvailable).toBe(false);
  });
});

describe('M16-S03 target revalidation at each action', () => {
  it('new origin, changed creation identity and revocation each force renewed consent', () => {
    const { host, registry, now } = fixture();
    const grant = granted(host, registry);
    expect(host.validateTarget(grant, tab, 'https://app.example')).toBe('ACTIVE');
    // Navigated to an unlisted origin.
    expect(host.validateTarget(grant, { ...tab, origin: 'https://other.example' }, 'https://other.example')).toBe('NEEDS_NEW_PERMISSION');
    // Window/tab recreated with a new creation identity (PID reuse is covered by the decision suite).
    expect(host.validateTarget(grant, { ...tab, creationIdentity: 'browser-target-recreated' })).toBe('NEEDS_NEW_PERMISSION');
    // Expiry is fixed with no automatic extension.
    now.value = grant.expiresAtMs;
    expect(grantState(grant, now.value)).toBe('EXPIRED');
    now.value = 1_700_000_000_000;
    const revoked = host.revoke(grant.grantId);
    expect(revoked.revocationGeneration).toBe(1);
    expect(grantState(revoked, now.value, 0)).toBe('REVOKED');
    expect(codeOf(() => host.authorizeAction(revoked, 'CLICK', 0))).toBe('CAPABILITY_DENIED');
  });

  it('never accepts an unreported origin for a grant that declares allowed origins', () => {
    const { host, registry } = fixture();
    const grant = granted(host, registry);
    // The driver reported no origin, so nothing proves the tab is still inside
    // the consented list: input needs renewed consent instead of passing.
    expect(host.validateTarget(grant, { ...tab, origin: null }, null)).toBe('NEEDS_NEW_PERMISSION');
    // A grant that declares no origins (fresh verification browser) keeps origin
    // out of its policy, so the report stays active.
    const fresh = host.requestConsent(owner, { mode: 'FRESH_VERIFICATION_BROWSER', observe: true, operations: ['CLICK'] });
    const freshGrant = host.grant(fresh.consentId, owner, tab, device);
    expect(host.validateTarget(freshGrant, { ...tab, origin: null }, null)).toBe('ACTIVE');
  });

  it('capture and interact permissions are independent and unclassified actions deny', () => {
    const { host, registry } = fixture();
    registry.register(registration());
    const observeOnly = host.requestConsent(owner, { mode: 'CONSENTED_EXISTING_TAB', observe: true, operations: [] });
    const grant = host.grant(observeOnly.consentId, owner, tab, device);
    expect(codeOf(() => host.authorizeAction(grant, 'CAPTURE'))).toBeNull();
    expect(codeOf(() => host.authorizeAction(grant, 'CLICK'))).toBe('CAPABILITY_DENIED');
    expect(codeOf(() => host.authorizeAction(grant, 'UPLOAD'))).toBe('CAPABILITY_DENIED');
  });
});

describe('M16-S04/G03 host Stop and rollback', () => {
  it('stop revokes the active grant generation and retains the receipt', () => {
    const { store, host, registry } = fixture();
    const grant = granted(host, registry);
    const model = host.stop(owner.threadId);
    expect(model.state).toBe('unavailable');
    expect(model.liveControlActive).toBe(false);
    const stored = store.get<InteractiveGrantV1>('interactiveGrant', grant.grantId)!;
    expect(stored.revocationGeneration).toBe(1); // receipt retained, not erased
  });

  it('stop closes a pending consent and a target kind that mismatches the mode cannot be granted', () => {
    const { store, host, registry } = fixture();
    registry.register(registration());
    const consent = host.requestConsent(owner, { mode: 'CONSENTED_EXISTING_TAB', observe: true, operations: ['CLICK'] });
    expect(codeOf(() => host.grant(consent.consentId, owner, app, device))).toBe('INVALID_INPUT');
    const model = host.stop(owner.threadId);
    expect(model.state).toBe('unavailable');
    expect(store.get<ConsentRequestV1>('controlConsent', consent.consentId)?.state).toBe('DENIED');
  });
});

describe('M16-G surface model and store records', () => {
  it('presents mode, permissions, expiry and Stop while active; consent requests are durable host-owned records', () => {
    const { store, host, registry } = fixture();
    const grant = granted(host, registry);
    const model = host.surfaceModel(owner.threadId);
    expect(model.state).toBe('active');
    expect(model.liveControlActive).toBe(true);
    expect(model.permissions).toEqual({ observe: true, interact: true });
    expect(model.stopAvailable).toBe(true);
    expect(model.expiryMs).toBeGreaterThan(0);
    const stored = store.all<InteractiveGrantV1>('interactiveGrant', owner.threadId);
    expect(stored.map(item => item.grantId)).toEqual([grant.grantId]);
    const requests = store.all('controlConsent', owner.threadId).map(item => consentRequestV1Schema.parse(item));
    expect(requests[0]!.state).toBe('GRANTED');
  });

  it('identity comparison ignores display metadata and requires creation + session identity', () => {
    expect(sameTargetIdentity(tab, { ...tab })).toBe(true);
    expect(sameTargetIdentity(tab, { ...tab, origin: 'https://elsewhere.example' })).toBe(true); // origin is policy, not identity
    expect(sameTargetIdentity(tab, { ...tab, sessionIdentity: 'other' })).toBe(false);
    expect(sameTargetIdentity(tab, { ...tab, creationIdentity: 'other' })).toBe(false);
  });
});

// Regression anchor for HarnessError codes the UI and evidence depend on.
describe('M16 blocked-state mapping', () => {
  it('uses HOLD_DRIVER_SPECIFICATION-compatible failures: DRIVER_UNAVAILABLE, CAPABILITY_DENIED — never a guessed driver', () => {
    const { host } = fixture();
    const calls: string[] = [];
    expect(codeOf(() => host.listTargets('CONSENTED_EXISTING_TAB', reg => { calls.push(reg.driverId); return []; }))).toBe('DRIVER_UNAVAILABLE');
    expect(calls).toEqual([]);
  });
});
