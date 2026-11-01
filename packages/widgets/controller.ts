import { validateRender, validateBridgePayload } from './policy.ts';
import { WIDGET_WORKER_PATH } from './protocol.ts';

export interface WidgetRuntimeOptions {
  iframe: HTMLIFrameElement;
  identity: { token: string; mountId: string; artifactId: string };
  html: string;
  stateSchemaVersion: number;
  onBridge: (message: Record<string, unknown>) => void;
  onFailure: (message: string) => void;
}
export function createWidgetRuntime(options: WidgetRuntimeOptions) {
  const { iframe, identity, html, stateSchemaVersion } = options;
  let disposed = false, frameReady = false, workerReady = false, lastRender: unknown, published: unknown, pendingPing = '', lastPong = performance.now(), windowStart = performance.now(), messages = 0;
  let workerSource: string | undefined, workerStarted = false;
  const pendingMessages: Record<string, unknown>[] = [];
  const abort = new AbortController();
  const frame = (type: string, payload: unknown) => iframe.contentWindow?.postMessage({ channel: 'harness-widget', ...identity, type, payload }, '*');
  const postWorker = (message: Record<string, unknown>) => frame('worker.post', message);
  function startWorker() {
    if (disposed || !frameReady || !workerSource || workerStarted) return;
    workerStarted = true; lastPong = performance.now();
    frame('worker.start', { source: workerSource }); workerSource = undefined;
  }
  // Only this fixed trusted host asset is fetched, never a model-provided URL.
  // It is relayed as data to the sandboxed receiver, which creates an opaque
  // data Worker. The host never starts a host-origin generated-code worker.
  void fetch(WIDGET_WORKER_PATH, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: abort.signal }).then(async response => {
    if (!response.ok) throw new Error('Missing trusted runtime');
    const source = await response.text();
    if (!source || source.length > 2_000_000) throw new Error('Invalid trusted runtime');
    if (!disposed) { workerSource = source; startWorker(); }
  }).catch(() => { if (!disposed) fail('The trusted generated-app worker asset is unavailable. Run pnpm build:widgets.'); });
  function fail(message: string) {
    if (disposed) return;
    disposed = true; abort.abort(); clearInterval(watchdog); clearInterval(renderer); window.removeEventListener('message', receive);
    frame('runtime.stopped', {}); options.onFailure(message);
  }
  function receive(event: MessageEvent) {
    const data = event.data;
    if (disposed || event.source !== iframe.contentWindow || !data || data.channel !== 'harness-widget' || Object.entries(identity).some(([key, value]) => data[key] !== value)) return;
    if (data.type === 'receiver.error') { fail('Generated app sent an invalid DOM update.'); return; }
    if (data.type === 'worker.bridge-error') { fail('Generated app exceeded its bridge limit.'); return; }
    if (data.type === 'worker.error') { fail('Generated app worker failed to start or exceeded its update limit.'); return; }
    if (data.type === 'ready') { if (frameReady) { fail('Generated app sent a duplicate receiver startup.'); return; } frameReady = true; startWorker(); return; }
    if (data.type === 'ui.event') postWorker({ type: 'ui.event', payload: data.payload });
    if (data.type === 'worker.message') receiveWorker(data.payload);
  }
  // Coalesce even forged worker snapshots; the untrusted sender cannot force
  // more than twenty foreground DOM applications per second.
  const renderer = setInterval(() => { if (frameReady && lastRender && lastRender !== published) { published = lastRender; frame('render', lastRender); } }, 50);
  const watchdog = setInterval(() => {
    if (performance.now() - lastPong > 2000) { fail('Generated app exceeded its execution limit. Its worker was terminated.'); return; }
    if (workerReady && !pendingPing) { pendingPing = crypto.randomUUID(); postWorker({ type: 'ping', nonce: pendingPing }); }
  }, 250);
  function receiveWorker(data: any) {
    if (disposed) return;
    const now = performance.now(); if (now - windowStart >= 1000) { windowStart = now; messages = 0; }
    if (++messages > 80) { fail('Generated app exceeded its update limit.'); return; }
    if (!data || typeof data !== 'object') { fail('Generated app sent an invalid message.'); return; }
    if (data.type === 'pong') { if (data.nonce === pendingPing) { lastPong = now; pendingPing = ''; } return; }
    if (data.type === 'ready') { if (workerReady) { fail('Generated app sent a duplicate startup message.'); return; } workerReady = true; postWorker({ type: 'start', html, stateSchemaVersion }); for (const message of pendingMessages.splice(0)) postWorker(message); return; }
    if (data.type === 'fatal') { fail('Generated app exceeded a runtime limit or used an unsupported capability.'); return; }
    if (data.type === 'render') { if (!validateRender(data.payload)) { fail('Generated app sent an invalid DOM update.'); return; } lastRender = data.payload; return; }
    if (data.type === 'bridge' && ['action', 'dirty', 'checkpoint'].includes(data.event)) {
      if (!validateBridgePayload(data.payload)) { fail('Generated app exceeded its bridge limit.'); return; }
      options.onBridge({ channel: 'harness-widget', ...identity, type: data.event, payload: data.payload });
    }
  }
  window.addEventListener('message', receive);
  return {
    post(message: Record<string, unknown>) { if (!disposed) { if (workerReady) postWorker(message); else if (pendingMessages.length < 16) pendingMessages.push(message); else { fail('Generated app exceeded its startup update limit.'); return; } if (message.type === 'init') iframe.contentWindow?.postMessage(message, '*'); } },
    dispose() { if (!disposed) { frame('worker.dispose', {}); disposed = true; abort.abort(); clearInterval(watchdog); clearInterval(renderer); window.removeEventListener('message', receive); } },
  };
}
