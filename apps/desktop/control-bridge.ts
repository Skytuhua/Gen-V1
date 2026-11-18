import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

/** M16 C3/C4 first-party Windows control bridge — the desktop-main half of the
 * single approved driver. The backend attaches a sidecar proxy; every driver
 * operation lands here over the launch-token IPC channel as a
 * 'harness.control.call' message and is answered with
 * 'harness.control.result'.
 *
 * Browser slice (C3): only the existing in-app docked/owned BrowserRecords —
 * the exact WebContents already created by browserRecord(). No external
 * Chrome/Edge profile, no remote debugging port, no page scripting. Identity
 * binds the WebContents creation id, navigation generation, origin, geometry
 * and DPI; any change makes the granted identity unprovable and the driver
 * refuses (NEEDS_NEW_PERMISSION upstream).
 *
 * Window slice (C4): the injected native bridge runs the system
 * GraphicsCapturePicker and binds the result to a unique live HWND by exact
 * identity proof. Absent or unprovable → DRIVER_UNAVAILABLE, never a fallback.
 * Native input dispatch stays UNSUPPORTED this milestone (no proven
 * selected-target delivery): only observation/capture register for
 * 'native-window'. */

export interface ControlBridgeError extends Error { code?: string }
function fail(code: string, message: string): never {
  const error: ControlBridgeError = new Error(message);
  error.code = code;
  throw error;
}

export interface BridgeWebContents {
  id: number;
  isDestroyed(): boolean;
  isFocused(): boolean;
  getURL(): string;
  capturePage(): Promise<{ toPNG(): Buffer; getSize(): { width: number; height: number } }>;
  sendInputEvent(event: Record<string, unknown>): void;
  loadURL(url: string): Promise<unknown>;
}

/** The seam the BrowserRecord map adapts onto — everything the adapter needs
 * to prove target identity without reaching into Electron types. */
export interface BridgeBrowser {
  id: string;
  generation: number;
  contents: BridgeWebContents;
  /** Current view bounds in DIP + scale factor, or null when unparented. */
  geometry(): { x: number; y: number; width: number; height: number; dpiScale: number } | null;
  /** Focus proof: the owning window and contents must both hold focus. */
  focused(): boolean;
  title(): string | null;
  /** Bumps the navigation generation after a driver-initiated navigate so a
   * pre-navigation grant identity can never satisfy a post-navigation state. */
  navigated?(): void;
}

export interface BridgeWindowIdentity {
  handle: number;
  processId: number;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  dpiScale: number;
}

/** Native seam — implemented by windows-control-bridge.node on Windows. */
export interface WindowsWindowBridge {
  /** Runs the system GraphicsCapturePicker; resolves null on user cancel.
   * Must bind the picked item to one unique live application HWND — displays,
   * zero or ambiguous matches reject. */
  pickWindow(ownerHandle: Buffer | null): Promise<BridgeWindowIdentity | null>;
  /** Live identity for a previously picked window; resolves null when the
   * window no longer exists or identity cannot be proven. */
  windowIdentity(handle: number): Promise<BridgeWindowIdentity | null>;
  /** PNG bytes + dimensions of the selected window via Windows.Graphics.Capture. */
  captureWindow(handle: number): Promise<{ data: Buffer; width: number; height: number }>;
}

export interface ControlBridgeDeps {
  browsers(): Iterable<BridgeBrowser>;
  native: WindowsWindowBridge | null;
  /** The owning main window's native handle for the picker's parent. */
  ownerWindowHandle(): Buffer | null;
  /** Sends one IPC frame to the backend (child.send equivalent). */
  send(value: Record<string, unknown>): void | Promise<unknown>;
  token: string;
  /** Absolute paths of the built artifacts that qualify this driver (D02). */
  artifactPath: string;
  adapterModulePath: string | null;
  apiVersion: string;
  /** Public-URL guard reused for NAVIGATE; same policy as the browser UI. */
  allowNavigateUrl(url: string): Promise<boolean>;
  now(): number;
}

type Identity = { kind: 'APPLICATION' | 'BROWSER_TAB'; creationIdentity: string; sessionIdentity: string; origin: string | null };

const SESSION_BIND = (parts: readonly (string | number)[]) => parts.join('|');

function browserIdentity(browser: BridgeBrowser): Identity {
  const contents = browser.contents;
  if (contents.isDestroyed()) fail('TARGET_MISMATCH', 'The consented browser target was destroyed.');
  const geometry = browser.geometry();
  if (!geometry) fail('TARGET_MISMATCH', 'The consented browser target is no longer placed on screen.');
  const origin = browserOrigin(contents.getURL());
  return {
    kind: 'BROWSER_TAB',
    // webContents.id is the per-creation identity: a recreated view cannot
    // reuse it, so a stale grant can never silently rebind (C01).
    creationIdentity: `tab:${browser.id}@${contents.id}`,
    sessionIdentity: SESSION_BIND(['nav', browser.generation, 'geo', geometry.x, geometry.y, geometry.width, geometry.height, 'dpi', geometry.dpiScale]),
    origin,
  };
}

function browserOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl || 'about:blank');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export interface ControlBridge {
  /** Routes one 'harness.control.call' frame; returns true when handled. */
  handleCall(value: Record<string, unknown>): Promise<boolean>;
  /** Pushes the built-artifact manifest to the backend and resolves when the
   * host accepted the registration. Rejects without registering otherwise. */
  register(): Promise<{ registered: boolean }>;
}

export function createControlBridge(deps: ControlBridgeDeps): ControlBridge {

  const findBrowser = (identity: Identity): BridgeBrowser => {
    const wanted = String(identity.creationIdentity);
    for (const browser of deps.browsers()) {
      // Dead or unplaced siblings must not mask the consented record.
      let live: Identity;
      try { live = browserIdentity(browser); } catch { continue; }
      if (live.creationIdentity === wanted) return browser;
    }
    fail('TARGET_MISMATCH', 'The consented browser target no longer exists.');
  };

  const requireLiveBrowser = (identity: Identity) => {
    const browser = findBrowser(identity);
    const live = browserIdentity(browser);
    if (live.sessionIdentity !== identity.sessionIdentity || live.origin !== identity.origin) {
      fail('TARGET_MISMATCH', 'The consented browser target changed since consent was granted.');
    }
    return { browser, live };
  };

  const requireLiveWindow = async (_identity: Identity): Promise<BridgeWindowIdentity> => {
    // HOLD_PICKER_BINDING (D02/D04): the system GraphicsCapturePicker cannot
    // return an authoritative HWND for the picked item, so no 'win:' identity
    // is provable and every window path is unavailable until an approved
    // same-object binding exists.
    fail('DRIVER_UNAVAILABLE', 'Selected-window control is held: the capture picker cannot return an authoritative window identity.');
  };

  const observation = (target: Identity) => ({ observationId: `obs-${randomUUID()}`, target, geometry: geometryOf(target), observedAtMs: deps.now() });

  const geometryOf = (target: Identity) => {
    const geo = /geo\|(-?\d+)\|(-?\d+)\|(\d+)\|(\d+)\|dpi\|([\d.]+)$/.exec(String(target.sessionIdentity));
    if (geo) return { x: Number(geo[1]), y: Number(geo[2]), width: Number(geo[3]), height: Number(geo[4]), dpiScale: Number(geo[5]) };
    fail('TARGET_MISMATCH', 'The consented target has an unproven geometry binding.');
  };

  const ops: Record<string, (payload: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
    async candidates(payload) {
      const mode = String(payload.mode);
      if (mode !== 'CONSENTED_EXISTING_TAB') return { candidates: [] };
      const candidates = [...deps.browsers()].map(browser => {
        try { return { target: browserIdentity(browser), title: browser.title() }; }
        catch { return null; }
      }).filter(Boolean);
      return { candidates };
    },
    async pickTarget(payload) {
      if (String(payload.mode) !== 'SELECTED_DESKTOP_APPLICATION') return { candidate: null };
      // HOLD_PICKER_BINDING: the picker cannot return an authoritative window
      // identity — refuse rather than mint an unprovable 'win:' identity.
      fail('DRIVER_UNAVAILABLE', 'Selected-window control is held: the capture picker cannot return an authoritative window identity.');
    },
    async observe(payload) {
      const target = payload.target as Identity;
      if (target.kind === 'BROWSER_TAB') {
        const { live } = requireLiveBrowser(target);
        return { observation: observation(live) };
      }
      await requireLiveWindow(target);
      return { observation: observation(target) };
    },
    async capture(payload) {
      const target = payload.target as Identity;
      if (target.kind === 'BROWSER_TAB') {
        const { browser } = requireLiveBrowser(target);
        const image = await browser.contents.capturePage();
        const size = image.getSize();
        const png = image.toPNG();
        if (!size.width || !size.height || !png.byteLength) fail('DRIVER_ERROR', 'The browser target produced an empty capture.');
        return { pngBase64: png.toString('base64'), width: size.width, height: size.height };
      }
      const native = await requireLiveWindow(target);
      const frame = await deps.native!.captureWindow(native.handle);
      return { pngBase64: frame.data.toString('base64'), width: frame.width, height: frame.height };
    },
    async dispatch(payload) {
      const action = payload.action as { actionId: string; action: string; target: Identity; redactedParameters?: Record<string, unknown> } | undefined;
      if (!action || typeof action !== 'object') fail('INVALID_INPUT', 'The control action is malformed.');
      const target = action.target as Identity;
      const params = action.redactedParameters ?? {};
      if (target.kind === 'APPLICATION') {
        // No proven selected-target native input exists this milestone —
        // refuse rather than reach for global injection (mandate).
        fail('CONTROL_OP_UNSUPPORTED', 'Native window input is not supported by this driver.');
      }
      const { browser } = requireLiveBrowser(target);
      if (!browser.focused()) fail('TARGET_MISMATCH', 'The consented browser target no longer holds proven focus.');
      const contents = browser.contents;
      const kind = String(action.action);
      if (kind === 'CLICK') {
        const x = Number(params.x), y = Number(params.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) fail('INVALID_INPUT', 'A click needs numeric coordinates.');
        contents.sendInputEvent({ type: 'mouseMove', x, y });
        contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      } else if (kind === 'TYPE') {
        const text = String(params.text ?? '');
        if (!text.length || text.length > 2000) fail('INVALID_INPUT', 'Typed text must be 1-2000 characters.');
        for (const char of text) contents.sendInputEvent({ type: 'char', keyCode: char });
      } else if (kind === 'KEYPRESS') {
        const keyCode = String(params.key ?? '');
        if (!/^[A-Za-z0-9]{1,32}$/.test(keyCode)) fail('INVALID_INPUT', 'A keypress needs a single named key.');
        const modifiers = Array.isArray(params.modifiers) ? (params.modifiers as unknown[]).filter((m): m is string => typeof m === 'string' && ['shift', 'control', 'alt', 'meta'].includes(m)) : [];
        contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      } else if (kind === 'NAVIGATE') {
        const url = String(params.url ?? '');
        if (!(await deps.allowNavigateUrl(url))) fail('CAPABILITY_DENIED', 'Only public HTTP and HTTPS pages are allowed.');
        await contents.loadURL(url);
        browser.navigated?.();
      } else {
        // UPLOAD/DOWNLOAD are session-blocked surfaces; unknown kinds are
        // classified before the driver — either way refuse here too.
        fail('CONTROL_OP_UNSUPPORTED', `The driver does not support ${kind}.`);
      }
      return { receipt: `gen-v1-browser:${action.actionId}` };
    },
    async cancel(payload) {
      const target = payload.target as Identity;
      try {
        if (target.kind === 'BROWSER_TAB') requireLiveBrowser(target);
        else await requireLiveWindow(target);
      } catch (error) {
        // Stop on a dead target (or a driver that has already gone) is a
        // successful cancel: no input can remain in flight to it (D06).
        const code = (error as ControlBridgeError).code;
        if (code !== 'TARGET_MISMATCH' && code !== 'DRIVER_UNAVAILABLE') throw error;
      }
      return {};
    },
  };

  return {
    async handleCall(value) {
      if (value.type !== 'harness.control.call' || value.token !== deps.token) return false;
      const requestId = String(value.requestId ?? '');
      const op = String(value.op ?? '');
      const payload = (value.payload ?? {}) as Record<string, unknown>;
      const reply = async (body: Record<string, unknown>) => deps.send({ type: 'harness.control.result', token: deps.token, requestId, ...body });
      const handler = ops[op];
      if (!handler) { await reply({ error: { code: 'INVALID_INPUT', message: `Unknown control driver operation: ${op}` } }); return true; }
      try { await reply({ result: await handler(payload) }); }
      catch (error) {
        const known = error as ControlBridgeError;
        await reply({ error: { code: typeof known.code === 'string' ? known.code : 'DRIVER_ERROR', message: String(error instanceof Error ? error.message : error).slice(0, 500) } });
      }
      return true;
    },
    async register() {
      const artifactSha256 = createHash('sha256').update(await readFile(deps.artifactPath)).digest('hex');
      const adapterModuleSha256 = deps.adapterModulePath ? createHash('sha256').update(await readFile(deps.adapterModulePath)).digest('hex') : null;
      const manifest = {
        driverId: 'gen-v1-windows-control-bridge',
        artifact: deps.artifactPath,
        artifactSha256,
        adapterModule: deps.adapterModulePath,
        adapterModuleSha256,
        // HOLD_PICKER_BINDING: 'native-window' is not registered — the picker
        // cannot return an authoritative window identity (D02/D04).
        apiProtocols: ['browser-tab'],
        backendProofRef: `electron/${deps.apiVersion}`,
        targetIdentityFormat: 'gen-v1.control-target.v1',
        captureBounds: { maxWidth: 8192, maxHeight: 8192, maxBytes: 33554432 },
        stopRoute: 'HOST_CANCEL',
      };
      // The register reply itself arrives on this same channel; the caller
      // routes 'harness.control.register.result' before invoking us.
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const requestId = `control-register-${randomUUID()}`;
        const timer = setTimeout(() => reject(new Error('The backend did not acknowledge the control driver registration.')), 15000);
        const finish = (value: Record<string, unknown>) => {
          clearTimeout(timer);
          const failure = value.error as { message?: unknown } | undefined;
          if (failure) reject(new Error(String(failure.message ?? 'The control driver registration failed.').slice(0, 500)));
          else resolve(value);
        };
        registerWaiters.set(requestId, finish);
        void Promise.resolve(deps.send({ type: 'harness.control.register', token: deps.token, requestId, manifest })).catch(error => {
          registerWaiters.delete(requestId);
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
      return { registered: result.registered === true };
    },
  };
}

/** Registration replies share the call channel's custody. */
const registerWaiters = new Map<string, (value: Record<string, unknown>) => void>();
export function handleRegisterReply(value: Record<string, unknown>): boolean {
  if (value.type !== 'harness.control.register.result' || typeof value.requestId !== 'string') return false;
  const finish = registerWaiters.get(value.requestId);
  if (!finish) return true;
  registerWaiters.delete(value.requestId);
  finish(value);
  return true;
}

/** Loads the optional native half. Absent build ⇒ window slice unregistered —
 * never a substitute implementation (D01/D02). */
export function loadWindowsWindowBridge(searchRoot: string): WindowsWindowBridge | null {
  try {
    const require = createRequire(searchRoot);
    const addon = require('./windows-control-bridge.node') as Partial<WindowsWindowBridge>;
    if (typeof addon.pickWindow !== 'function' || typeof addon.windowIdentity !== 'function' || typeof addon.captureWindow !== 'function') return null;
    return addon as WindowsWindowBridge;
  } catch {
    return null;
  }
}
