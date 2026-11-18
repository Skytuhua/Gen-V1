import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createControlBridge, handleRegisterReply, type BridgeBrowser, type BridgeWebContents, type WindowsWindowBridge } from '../apps/desktop/control-bridge.ts';
import { createControlSidecarChannel, createSidecarControlDriver } from '../packages/core/control-sidecar-driver.ts';
import type { ControlTargetIdentityV1 } from '../packages/contracts/interactive-control.ts';

afterEach(() => vi.restoreAllMocks());

const TOKEN = 'a'.repeat(64);

/** Wires the real backend-side channel straight into the real desktop-side
 * bridge — every driver op traverses the production IPC protocol shapes. */
function harness(options: { native?: WindowsWindowBridge | null; browsers?: BridgeBrowser[] } = {}) {
  const sent: Record<string, unknown>[] = [];
  const bridge = createControlBridge({
    browsers: () => options.browsers ?? [],
    native: options.native ?? null,
    ownerWindowHandle: () => null,
    send: value => { sent.push(value); },
    token: TOKEN,
    artifactPath: join(tmpdir(), 'nonexistent-artifact.node'),
    adapterModulePath: null,
    apiVersion: 'test',
    allowNavigateUrl: async url => /^https:\/\/public\.example\//.test(url),
    now: () => 1_000_000,
  });
  const channel = createControlSidecarChannel({
    send: value => {
      sent.push(value);
      void bridge.handleCall(value).catch(() => {});
    },
    token: TOKEN,
  });
  // Complete the round trip: bridge replies flow back into the channel.
  const replies = () => sent.splice(0).filter(v => v.type === 'harness.control.result');
  const call = async <T>(request: Promise<T>): Promise<T> => {
    const pending = request.catch(error => error);
    // The bridge answers on a later tick; keep feeding its replies into the
    // channel until the driver's request settles.
    for (;;) {
      for (const reply of replies()) channel.handleReply(reply);
      if (await Promise.race([pending.then(() => true), new Promise(resolve => setImmediate(() => resolve(false)))])) break;
    }
    const result = await pending;
    if (result instanceof Error) throw result;
    return result as T;
  };
  const driver = createSidecarControlDriver(channel);
  return { bridge, channel, driver, sent, call };
}

function fakeContents(over: Partial<BridgeWebContents> = {}): BridgeWebContents & { inputs: Record<string, unknown>[] } {
  const inputs: Record<string, unknown>[] = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  return {
    inputs,
    id: 42,
    isDestroyed: () => false,
    isFocused: () => true,
    getURL: () => 'https://public.example/page',
    capturePage: async () => ({ toPNG: () => png, getSize: () => ({ width: 400, height: 300 }) }),
    sendInputEvent: event => { inputs.push(event); },
    loadURL: async () => ({}),
    ...over,
  };
}

function fakeBrowser(over: { generation?: () => number; focused?: boolean; geometry?: ReturnType<BridgeBrowser['geometry']>; contents?: BridgeWebContents } = {}): BridgeBrowser {
  const contents = over.contents ?? fakeContents();
  return {
    id: 'browser-1',
    get generation() { return over.generation ? over.generation() : 0; },
    contents,
    geometry: () => (over.geometry === undefined ? { x: 10, y: 20, width: 400, height: 300, dpiScale: 1 } : over.geometry),
    focused: () => over.focused ?? true,
    title: () => 'Example tab',
  };
}

const targetOf = (candidate: { target: ControlTargetIdentityV1 }): ControlTargetIdentityV1 => candidate.target;

describe('M16 C3 browser adapter via sidecar driver', () => {
  it('lists existing in-app browsers as bound candidates', async () => {
    const { driver, call } = harness({ browsers: [fakeBrowser()] });
    const candidates = await call(driver.candidates('CONSENTED_EXISTING_TAB'));
    expect(candidates).toHaveLength(1);
    const target = targetOf(candidates[0]!);
    expect(target.kind).toBe('BROWSER_TAB');
    expect(target.creationIdentity).toBe('tab:browser-1@42');
    expect(target.sessionIdentity).toContain('nav|0|geo|10|20|400|300|dpi|1');
    expect(target.origin).toBe('https://public.example');
  });

  it('observes with the bound identity and geometry', async () => {
    const { driver, call } = harness({ browsers: [fakeBrowser()] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    const observation = await call(driver.observe(target));
    expect(observation.target).toEqual(target);
    expect(observation.geometry).toEqual({ x: 10, y: 20, width: 400, height: 300, dpiScale: 1 });
  });

  it('captures a PNG frame through capturePage', async () => {
    const { driver, call } = harness({ browsers: [fakeBrowser()] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    const frame = await call(driver.capture(target));
    expect(frame.mimeType).toBe('image/png');
    expect(frame.width).toBe(400);
    expect(frame.data.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('refuses a stale navigation generation (TARGET_MISMATCH, no input)', async () => {
    const state = { generation: 0 };
    const { driver, call } = harness({ browsers: [fakeBrowser({ generation: () => state.generation })] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    state.generation = 7; // simulate navigation after consent
    await expect(call(driver.observe(target))).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
  });

  it('refuses a moved or DPI-changed target', async () => {
    const geo = { x: 10, y: 20, width: 400, height: 300, dpiScale: 1 };
    const browser = fakeBrowser();
    const { driver, call } = harness({ browsers: [browser] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    const moved = { ...browser, geometry: () => ({ ...geo, x: 99 }) };
    const { driver: driver2, call: call2 } = harness({ browsers: [moved] });
    await expect(call2(driver2.observe(target))).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
  });

  it('refuses a destroyed target', async () => {
    const contents = fakeContents();
    const browser = fakeBrowser({ contents });
    const { driver, call } = harness({ browsers: [browser] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    contents.isDestroyed = () => true;
    await expect(call(driver.observe(target))).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
  });

  it('dispatches a click as a target-bound sendInputEvent sequence', async () => {
    const contents = fakeContents();
    const { driver, call } = harness({ browsers: [fakeBrowser({ contents })] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    const action = { actionId: 'a1', grantId: 'g1', target, action: 'CLICK' as const, redactedParameters: { x: 50, y: 60 }, preObservationRef: null, postObservationRef: null, effectReceipt: null };
    const result = await call(driver.dispatch(action));
    expect(result.receipt).toContain('gen-v1-browser:a1');
    expect(contents.inputs.map(i => i.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp']);
    expect(contents.inputs[0]).toMatchObject({ x: 50, y: 60 });
  });

  it('refuses to dispatch input when focus is not provable', async () => {
    const { driver, call } = harness({ browsers: [fakeBrowser({ focused: false })] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    const action = { actionId: 'a2', grantId: 'g1', target, action: 'CLICK' as const, redactedParameters: { x: 1, y: 1 }, preObservationRef: null, postObservationRef: null, effectReceipt: null };
    await expect(call(driver.dispatch(action))).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
  });

  it('refuses UPLOAD/DOWNLOAD at the driver even if classified upstream', async () => {
    const { driver, call } = harness({ browsers: [fakeBrowser()] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    const action = { actionId: 'a3', grantId: 'g1', target, action: 'UPLOAD' as const, redactedParameters: { path: '/tmp/x' }, preObservationRef: null, postObservationRef: null, effectReceipt: null };
    await expect(call(driver.dispatch(action))).rejects.toMatchObject({ code: 'CONTROL_OP_UNSUPPORTED' });
  });

  it('navigates only through the same public-URL guard as the browser UI', async () => {
    const contents = fakeContents();
    const urls: string[] = [];
    contents.loadURL = async url => { urls.push(url); };
    const { driver, call } = harness({ browsers: [fakeBrowser({ contents })] });
    const target = targetOf((await call(driver.candidates('CONSENTED_EXISTING_TAB')))[0]!);
    const go = (url: string) => ({ actionId: 'a4', grantId: 'g1', target, action: 'NAVIGATE' as const, redactedParameters: { url }, preObservationRef: null, postObservationRef: null, effectReceipt: null });
    await expect(call(driver.dispatch(go('http://169.254.169.254/meta')))).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await call(driver.dispatch(go('https://public.example/next')));
    expect(urls).toEqual(['https://public.example/next']);
  });
});

describe('M16 C4 window adapter via sidecar driver (HOLD_PICKER_BINDING)', () => {
  const windowId = { handle: 0x1f00, processId: 4321, title: 'Notepad', bounds: { x: 5, y: 6, width: 640, height: 480 }, dpiScale: 1 };
  const native = (over: Partial<WindowsWindowBridge> = {}): WindowsWindowBridge => ({
    pickWindow: async () => windowId,
    windowIdentity: async handle => (handle === windowId.handle ? windowId : null),
    captureWindow: async () => ({ data: Buffer.from([1, 2, 3]), width: 640, height: 480 }),
    ...over,
  });
  // An identity only the picker path could have minted — fabricated here to
  // prove every downstream op fails closed rather than trusting it.
  const fabricated: ControlTargetIdentityV1 = { kind: 'APPLICATION', creationIdentity: 'win:7936:4321', sessionIdentity: 'wgc|wgc-abc|geo|5|6|640|480|dpi|1', origin: null };

  it('picker path refuses: no authoritative window identity can be minted', async () => {
    const { driver, call } = harness({ native: native() });
    await expect(call(driver.pickTarget('SELECTED_DESKTOP_APPLICATION'))).rejects.toMatchObject({ code: 'DRIVER_UNAVAILABLE' });
  });

  it('observe refuses a window target even when a native bridge is present', async () => {
    const { driver, call } = harness({ native: native() });
    await expect(call(driver.observe(fabricated))).rejects.toMatchObject({ code: 'DRIVER_UNAVAILABLE' });
  });

  it('capture refuses a window target even when a native bridge is present', async () => {
    const { driver, call } = harness({ native: native() });
    await expect(call(driver.capture(fabricated))).rejects.toMatchObject({ code: 'DRIVER_UNAVAILABLE' });
  });

  it('cancel on a window target stays a safe no-op (DRIVER_UNAVAILABLE tolerated)', async () => {
    const { driver, call } = harness({ native: native() });
    await expect(call(driver.cancelInput(fabricated))).resolves.toBeUndefined();
  });

  it('native input dispatch stays unsupported (no proven delivery path)', async () => {
    const { driver, call } = harness({ native: native() });
    const action = { actionId: 'a5', grantId: 'g1', target: fabricated, action: 'CLICK' as const, redactedParameters: { x: 1, y: 1 }, preObservationRef: null, postObservationRef: null, effectReceipt: null };
    await expect(call(driver.dispatch(action))).rejects.toMatchObject({ code: 'CONTROL_OP_UNSUPPORTED' });
  });

  it('no native bridge => DRIVER_UNAVAILABLE, never a fallback', async () => {
    const { driver, call } = harness({ native: null });
    await expect(call(driver.pickTarget('SELECTED_DESKTOP_APPLICATION'))).rejects.toMatchObject({ code: 'DRIVER_UNAVAILABLE' });
  });
});

describe('M16 D02 manifest → registration', () => {
  it('register() ships the artifact digest computed from the real file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm16-bridge-'));
    try {
      const artifact = join(dir, 'bridge.node');
      writeFileSync(artifact, 'binary-bytes');
      const sent: Record<string, unknown>[] = [];
      const bridge = createControlBridge({
        browsers: () => [], native: null, ownerWindowHandle: () => null,
        send: value => {
          sent.push(value);
          if (value.type === 'harness.control.register') {
            void Promise.resolve().then(() => {
              handleRegisterReply({ type: 'harness.control.register.result', token: TOKEN, requestId: String(value.requestId), registered: true });
            });
          }
        },
        token: TOKEN, artifactPath: artifact, adapterModulePath: null, apiVersion: 'test',
        allowNavigateUrl: async () => false, now: () => 0,
      });
      const result = await bridge.register();
      expect(result.registered).toBe(true);
      const manifest = (sent.find(v => v.type === 'harness.control.register') as { manifest: { artifactSha256: string; apiProtocols: string[] } }).manifest;
      expect(manifest.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.apiProtocols).toEqual(['browser-tab']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
