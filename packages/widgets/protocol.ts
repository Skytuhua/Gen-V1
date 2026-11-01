export const WIDGET_WORKER_PATH = '/widget-runtime/worker.js';
// Defense in depth if this import-free asset is fetched directly as a worker.
// The runtime fetches it as data, then creates an opaque data: worker inside the
// sandboxed trusted receiver. That worker inherits WIDGET_SHELL_CSP.
export const WIDGET_WORKER_CSP = "default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'";
