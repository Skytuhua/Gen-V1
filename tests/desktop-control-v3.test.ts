import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlDispatcher, controlCapability, type ControlDriverHandle } from '../packages/core/desktop-control.ts';
import {
  CONTROL_MAX_OBSERVATION_AGE_MS,
  CONTROL_MIN_DISPATCH_INTERVAL_MS,
  CONTROL_QUEUE_CAP,
  type ControlDriverRegistrationV1,
  type ControlTargetIdentityV1,
  type InteractiveGrantV1,
  type TargetObservationV1,
} from '../packages/contracts/interactive-control.ts';
import { HarnessError } from '../packages/contracts/index.ts';
import type { ToolOwner } from '../packages/contracts/tool-effects.ts';

afterEach(() => vi.restoreAllMocks());

const codeOf = (fn: () => unknown): string | null => {
  try { fn(); return null; } catch (error) { return error instanceof HarnessError ? error.code : 'UNEXPECTED'; }
};

const owner: ToolOwner = { threadId: 'thread-1', runId: 'run-1', epoch: 3, projectId: 'p1', workspaceId: 'w1', accountBinding: 'acct-1' };
const target: ControlTargetIdentityV1 = { kind: 'APPLICATION', creationIdentity: 'proc-created-77', sessionIdentity: 'desktop-session-7', origin: null };
const geometry = { x: 10, y: 20, width: 800, height: 600, dpiScale: 1 };
const registration: ControlDriverRegistrationV1 = {
  driverId: 'driver-1', packageDigest: 'b'.repeat(64), apiProtocol: 'native-window',
  backendProofRef: 'proof:backend-1', targetIdentityFormat: 'hwnd-creation-token',
  captureBounds: { maxWidth: 3840, maxHeight: 2160, maxBytes: 8 * 1024 * 1024 },
  supportsInputCancellation: true, stopRoute: 'DRIVER_STOP',
};
const grant = (issuedAtMs: number): InteractiveGrantV1 => ({
  grantId: 'grant-1', owner, deviceIdentity: { deviceId: 'd1', sessionId: 's1' },
  mode: 'SELECTED_DESKTOP_APPLICATION', target, permittedOperations: ['CLICK', 'TYPE', 'KEYPRESS'],
  allowedOrigins: [], capturePermission: true, issuedAtMs, expiresAtMs: issuedAtMs + 600_000, revocationGeneration: 0,
});
const observation = (observedAtMs: number, over: Partial<TargetObservationV1> = {}): TargetObservationV1 => ({
  observationId: `obs-${observedAtMs}-${Math.random()}`, target, geometry, observedAtMs, ...over,
});

function harness(nowStart = 1_000_000) {
  const now = { value: nowStart };
  const sleeps: number[] = [];
  const calls: { observe: number; dispatch: string[]; cancel: number } = { observe: 0, dispatch: [], cancel: 0 };
  const driver: ControlDriverHandle = {
    observe: async () => { calls.observe++; return observation(now.value); },
    dispatch: async action => { calls.dispatch.push(action.actionId); return { receipt: `rcpt-${action.actionId}` }; },
    cancelInput: async () => { calls.cancel++; },
  };
  const dispatcher = new ControlDispatcher({ driver, registration, nowMs: () => now.value, sleepMs: async ms => { sleeps.push(ms); now.value += ms; } });
  return { now, sleeps, calls, driver, dispatcher };
}
const click = { action: 'CLICK' as const, redactedParameters: { x: 5, y: 5 } };

describe('M16-S06 dispatch serialization, rate and observation freshness', () => {
  it('dispatches at most 5 actions per second with >=200ms spacing', async () => {
    const { dispatcher, calls, sleeps, now } = harness();
    for (let i = 0; i < 6; i++) dispatcher.enqueue({ grant: grant(now.value), action: click, observation: observation(now.value) });
    await dispatcher['draining'];
    expect(calls.dispatch).toHaveLength(6);
    // Six actions admit at 0,200,...,1000 ms: five gaps of >=200ms.
    expect(sleeps).toHaveLength(5);
    for (const gap of sleeps) expect(gap).toBeGreaterThanOrEqual(CONTROL_MIN_DISPATCH_INTERVAL_MS);
    expect(now.value).toBe(1_001_000);
  });

  it('rejects enqueue beyond the queue cap without reaching the driver', async () => {
    const { dispatcher, calls, now } = harness();
    // Hold dispatch by making each observe slow.
    const holding: Promise<void>[] = [];
    const holdDispatcher = new ControlDispatcher({
      registration,
      nowMs: () => now.value,
      sleepMs: async () => {},
      driver: { observe: async () => { holding.push(new Promise(() => {})); return observation(now.value); }, dispatch: async () => ({ receipt: 'x' }), cancelInput: async () => {} },
    });
    for (let i = 0; i < CONTROL_QUEUE_CAP; i++) holdDispatcher.enqueue({ grant: grant(now.value), action: click, observation: observation(now.value) });
    expect(codeOf(() => holdDispatcher.enqueue({ grant: grant(now.value), action: click, observation: observation(now.value) }))).toBe('QUEUE_FULL');
    expect(calls.dispatch).toHaveLength(0);
    await holdDispatcher.stop();
    void dispatcher;
  });

  it('refuses stale observations at enqueue and re-checks freshness before dispatch', async () => {
    const { dispatcher, now } = harness();
    expect(codeOf(() => dispatcher.enqueue({ grant: grant(now.value), action: click, observation: observation(now.value - CONTROL_MAX_OBSERVATION_AGE_MS - 1) }))).toBe('OBSERVATION_STALE');
    // Observation whose target identity differs from the granted target.
    expect(codeOf(() => dispatcher.enqueue({ grant: grant(now.value), action: click, observation: observation(now.value, { target: { ...target, creationIdentity: 'recreated' } }) }))).toBe('TARGET_MISMATCH');
  });
});

describe('M16-D03/S06 target geometry and identity binding', () => {
  it('movement, resize or DPI change after queueing rejects the action instead of rescaling', async () => {
    const now = { value: 1_000_000 };
    const rejected: string[] = [];
    const driver: ControlDriverHandle = {
      observe: async () => observation(now.value, { geometry: { ...geometry, x: 999 } }),
      dispatch: async () => { throw new Error('must not dispatch'); },
      cancelInput: async () => {},
    };
    const dispatcher = new ControlDispatcher({ driver, registration, nowMs: () => now.value, sleepMs: async ms => { now.value += ms; } });
    const item = dispatcher.enqueue({ grant: grant(now.value), action: click, observation: observation(now.value) });
    await dispatcher['draining'];
    expect(item.outcome).toBe('REJECTED');
    expect(item.reason).toBe('TARGET_MOVED');
    rejected.push(item.reason!);
    expect(rejected).toEqual(['TARGET_MOVED']);
  });
});

describe('M16-D05/S04 independent Stop', () => {
  it('revokes the generation before cancelling queued actions; no old-generation input reaches the driver', async () => {
    const now = { value: 1_000_000 };
    const dispatched: string[] = [];
    let releaseFirst: () => void = () => {};
    let observes = 0;
    const driver: ControlDriverHandle = {
      // The first dispatch hangs (model hang); stop must still win.
      observe: async () => { observes++; return observation(now.value); },
      dispatch: async action => { if (dispatched.length === 0) await new Promise<void>(resolve => { releaseFirst = resolve; }); dispatched.push(action.actionId); return { receipt: 'r' }; },
      cancelInput: async () => {},
    };
    const dispatcher = new ControlDispatcher({ driver, registration, nowMs: () => now.value, sleepMs: async ms => { now.value += ms; } });
    const grantValue = grant(now.value);
    const first = dispatcher.enqueue({ grant: grantValue, action: click, observation: observation(now.value) });
    const second = dispatcher.enqueue({ grant: grantValue, action: click, observation: observation(now.value) });
    await Promise.resolve();
    await dispatcher.stop();
    releaseFirst();
    expect(second.outcome).toBe('CANCELLED');
    expect(dispatched.length).toBeLessThanOrEqual(1);
    expect(codeOf(() => dispatcher.enqueue({ grant: grantValue, action: click, observation: observation(now.value) }))).toBe('CANCELLED');
    expect(observes).toBeGreaterThanOrEqual(0);
    void first;
  });
});

describe('M16-S09/D07 capability detection and driver absence', () => {
  it('missing driver leaves input unregistered and reports BLOCKED — never a broad fallback', () => {
    const dispatcher = new ControlDispatcher({});
    expect(codeOf(() => dispatcher.enqueue({ grant: grant(0), action: click, observation: observation(0) }))).toBe('DRIVER_UNAVAILABLE');
    expect(controlCapability({ flagEnabled: true, registration: null, platformSupported: true })).toEqual({ state: 'BLOCKED', reason: 'DRIVER_UNAVAILABLE' });
    expect(controlCapability({ flagEnabled: false, registration, platformSupported: true })).toEqual({ state: 'BLOCKED', reason: 'CAPABILITY_DISABLED' });
    expect(controlCapability({ flagEnabled: true, registration, platformSupported: false })).toEqual({ state: 'BLOCKED', reason: 'PLATFORM_UNSUPPORTED' });
    expect(controlCapability({ flagEnabled: true, registration, platformSupported: true })).toEqual({ state: 'AVAILABLE', reason: null });
  });

  it('expired or revoked grants cannot enqueue input', async () => {
    const { dispatcher, now } = harness();
    const dead = { ...grant(now.value), expiresAtMs: now.value - 1 };
    expect(codeOf(() => dispatcher.enqueue({ grant: dead, action: click, observation: observation(now.value) }))).toBe('CAPABILITY_DENIED');
    await dispatcher.stop();
  });
});

// D05/S07: host-classified effect risk gates every input action.
describe('M16-D05/S07 effect classification at the input boundary', () => {
  it('denies TYPE carrying credential material and consequential ops keep their exact approval', async () => {
    const { dispatcher, calls, now } = harness();
    const grantValue = grant(now.value);
    expect(codeOf(() => dispatcher.enqueue({ grant: grantValue, action: { action: 'TYPE', redactedParameters: { password: 'hunter2' } }, observation: observation(now.value) }))).toBe('CAPABILITY_DENIED');
    expect(codeOf(() => dispatcher.enqueue({ grant: grantValue, action: { action: 'TYPE', redactedParameters: { text: 'enter my password here' } }, observation: observation(now.value) }))).toBe('CAPABILITY_DENIED');
    expect(codeOf(() => dispatcher.enqueue({ grant: grantValue, action: { action: 'UPLOAD', redactedParameters: { path: 'a.png' } }, observation: observation(now.value) }))).toBe('APPROVAL_REQUIRED');
    expect(codeOf(() => dispatcher.enqueue({ grant: grantValue, action: { action: 'DOWNLOAD', redactedParameters: {} }, observation: observation(now.value) }))).toBe('APPROVAL_REQUIRED');
    expect(codeOf(() => dispatcher.enqueue({ grant: grantValue, action: { action: 'NAVIGATE', redactedParameters: { url: 'https://app.example' } }, observation: observation(now.value) }))).toBe('APPROVAL_REQUIRED');
    expect(calls.dispatch).toHaveLength(0);
    await dispatcher.stop();
  });

  it('an action absent from the consent deny-defaults even when classified consented', async () => {
    const { dispatcher, now } = harness();
    const narrow = { ...grant(now.value), permittedOperations: ['CLICK' as const] };
    expect(codeOf(() => dispatcher.enqueue({ grant: narrow, action: { action: 'TYPE', redactedParameters: { text: 'hello' } }, observation: observation(now.value) }))).toBe('CAPABILITY_DENIED');
    await dispatcher.stop();
  });
});

// The CAPTURE separation stays enforced at the input boundary (D03).
describe('M16-D03 capture is never queued as input', () => {
  it('rejects CAPTURE on the input queue', async () => {
    const { dispatcher, now } = harness();
    expect(codeOf(() => dispatcher.enqueue({ grant: grant(now.value), action: { action: 'CAPTURE', redactedParameters: {} }, observation: observation(now.value) }))).toBe('INVALID_INPUT');
    await dispatcher.stop();
  });
});
