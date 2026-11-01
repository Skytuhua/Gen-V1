export const WIDGET_WORKER_PATH = '/widget-runtime/worker.js';
// Defense in depth if this import-free asset is fetched directly as a worker.
// The runtime fetches it as data, then creates an opaque data: worker inside the
// sandboxed trusted receiver. That worker inherits WIDGET_SHELL_CSP.
export const WIDGET_WORKER_CSP = "default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
export const WIDGET_RUNTIME = {
  version: 'opaque-worker-dom-subset-v2',
  execution: 'Opaque-origin data Web Worker created by a sandboxed trusted receiver; no generated main-thread JavaScript; native persistence getters denied by origin',
  supported: 'Inline classic JavaScript, DOM creation/query/text/classList/dataset/events, local forms and controls, bounded HTML layouts and static CSS, harness.onUpdate/emit/setDirty/checkpoint',
  unsupported: 'Network, navigation, external or module scripts, imports, nested workers, persistence APIs, images/media/SVG/canvas, inline event attributes, arbitrary CSS, synchronous layout and browser window APIs',
  limits: { nodes: 800, depth: 24, renderBytes: 65536, cssBytes: 16384, rendersPerSecond: 20, heartbeatTimeoutMs: 2000, hardMemoryLimit: false },
  memory: 'No per-worker hard memory quota. Worker termination and bounded accepted messages do not prevent allocations or structured-clone exhaustion in the browser process.',
} as const;
