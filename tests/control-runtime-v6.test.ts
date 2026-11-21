import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Store } from '../packages/storage/store.ts';
import { BrowserConsentHost, ControlDriverRegistry } from '../packages/core/browser-consent.ts';
import { ControlRuntime } from '../packages/core/control-runtime.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import { HarnessError } from '../packages/contracts/index.ts';
import type { ControlDriverOperations } from '../packages/core/desktop-control.ts';
import type { ControlDriverRegistrationV1, ControlTargetIdentityV1 } from '../packages/contracts/interactive-control.ts';
import type { ToolOwner } from '../packages/contracts/tool-effects.ts';

afterEach(() => vi.restoreAllMocks());

const owner: ToolOwner = { threadId: 'thread-1', runId: null, epoch: 1, projectId: 'p1', workspaceId: null, accountBinding: null };
const device = { deviceId: 'device-test', sessionId: 'session-test' };
const target: ControlTargetIdentityV1 = { kind: 'BROWSER_TAB', creationIdentity: 'tab:b@1', sessionIdentity: 'nav|0|geo|0|0|400|300|dpi|1', origin: 'https://public.example' };
const registration: ControlDriverRegistrationV1 = {
  driverId: 'gen-v1-windows-control-bridge:browser-tab', packageDigest: 'c'.repeat(64), apiProtocol: 'browser-tab',
  backendProofRef: 'electron/test', targetIdentityFormat: 'gen-v1.control-target.v1',
  captureBounds: { maxWidth: 8192, maxHeight: 8192, maxBytes: 33554432 },
  supportsInputCancellation: true, stopRoute: 'HOST_CANCEL',
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function driver(over: Partial<ControlDriverOperations> = {}): ControlDriverOperations {
  return {
    candidates: async () => [{ target, title: 'Example' }],
    pickTarget: async () => null,
    observe: async () => ({ observationId: 'obs-1', target, geometry: { x: 0, y: 0, width: 400, height: 300, dpiScale: 1 }, observedAtMs: Date.now() }),
    capture: async () => ({ data: PNG, width: 400, height: 300, mimeType: 'image/png' }),
    dispatch: async () => ({ receipt: 'r1' }),
    cancelInput: async () => {},
    ...over,
  };
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'm16-runtime-'));
  const store = new Store(dir);
  const registry = new ControlDriverRegistry();
  const consent = new BrowserConsentHost(store, { registry });
  const runtime = new ControlRuntime(store, consent, { registry, device, artifactRoot: dir });
  // The pending request has to be recorded while the capability is enabled;
  // the tests themselves drive the flag from here on.
  __setCapabilityFlagForTests('control.consentedBrowserV1', true);
  const request = consent.requestConsent(owner, { mode: 'CONSENTED_EXISTING_TAB', observe: true, operations: ['CLICK'], allowedOrigins: ['https://public.example'] });
  __setCapabilityFlagForTests('control.consentedBrowserV1', false);
  return { dir, store, registry, consent, runtime, request };
}

describe('M16 ControlRuntime host ownership', () => {
  it('D01/D02 unattached driver still resolves DRIVER_UNAVAILABLE for targets', async () => {
    const { dir, store, registry, runtime } = harness();
    try {
      __setCapabilityFlagForTests('control.consentedBrowserV1', true);
      await expect(runtime.targets('CONSENTED_EXISTING_TAB')).rejects.toMatchObject({ code: 'DRIVER_UNAVAILABLE' });
      expect(() => registry.resolve('CONSENTED_EXISTING_TAB')).toThrow(HarnessError);
    } finally {
      __setCapabilityFlagForTests('control.consentedBrowserV1', false);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('targets require the capability flag even with a driver attached', async () => {
    const { dir, store, registry, runtime } = harness();
    try {
      registry.register(registration);
      runtime.attachDriver(driver());
      await expect(runtime.targets('CONSENTED_EXISTING_TAB')).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
      __setCapabilityFlagForTests('control.consentedBrowserV1', true);
      const targets = await runtime.targets('CONSENTED_EXISTING_TAB');
      expect(targets[0]!.target).toEqual(target);
    } finally {
      __setCapabilityFlagForTests('control.consentedBrowserV1', false);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('grant → capture stores a digested PNG under the host artifact root only', async () => {
    const { dir, store, registry, runtime, request } = harness();
    try {
      __setCapabilityFlagForTests('control.consentedBrowserV1', true);
      registry.register(registration);
      runtime.attachDriver(driver());
      const grant = runtime.grant(request.consentId, owner, target);
      const { capture, artifactRef } = await runtime.capture(owner.threadId);
      const absolute = join(dir, artifactRef);
      expect(existsSync(absolute)).toBe(true);
      expect(createHash('sha256').update(readFileSync(absolute)).digest('hex')).toBe(capture.sha256);
      expect(store.get('controlCapture', capture.artifactId)).toMatchObject({ artifactRef, sha256: capture.sha256 });
      expect(grant.target).toEqual(target);
    } finally {
      __setCapabilityFlagForTests('control.consentedBrowserV1', false);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('capture without consent for observation is denied (D03)', async () => {
    const { dir, store, registry, consent, runtime } = harness();
    try {
      __setCapabilityFlagForTests('control.consentedBrowserV1', true);
      const observeOff = consent.requestConsent(owner, { mode: 'CONSENTED_EXISTING_TAB', observe: false, operations: ['CLICK'], allowedOrigins: ['https://public.example'] });
      registry.register(registration);
      runtime.attachDriver(driver());
      runtime.grant(observeOff.consentId, owner, target);
      await expect(runtime.capture(owner.threadId)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
      expect(store.all('controlCapture', owner.threadId)).toHaveLength(0);
    } finally {
      __setCapabilityFlagForTests('control.consentedBrowserV1', false);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('action enqueues through the dispatcher and persists the settled record', async () => {
    const { dir, store, registry, runtime, request } = harness();
    try {
      __setCapabilityFlagForTests('control.consentedBrowserV1', true);
      registry.register(registration);
      runtime.attachDriver(driver());
      runtime.grant(request.consentId, owner, target);
      const observation = { observationId: 'obs-fresh', target, geometry: { x: 0, y: 0, width: 400, height: 300, dpiScale: 1 }, observedAtMs: Date.now() };
      const result = await runtime.action(owner.threadId, owner, { action: 'CLICK', parameters: { x: 5, y: 5 }, observation });
      expect(result.outcome).toBe('DISPATCHED');
      const records = store.all<unknown>('controlAction', owner.threadId);
      expect(records).toHaveLength(1);
    } finally {
      __setCapabilityFlagForTests('control.consentedBrowserV1', false);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stop revokes the grant and drops the thread dispatcher', async () => {
    const { dir, store, registry, runtime, request, consent } = harness();
    try {
      __setCapabilityFlagForTests('control.consentedBrowserV1', true);
      registry.register(registration);
      runtime.attachDriver(driver());
      runtime.grant(request.consentId, owner, target);
      const surface = await runtime.stop(owner.threadId);
      expect(surface.state).toBe('unavailable');
      await expect(runtime.capture(owner.threadId)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
      expect(consent.activeGrant(owner.threadId)).toBeNull();
    } finally {
      __setCapabilityFlagForTests('control.consentedBrowserV1', false);
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
