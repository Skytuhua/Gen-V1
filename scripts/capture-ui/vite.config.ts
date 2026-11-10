import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { screens } from './screen-map';
import { pdfPrebundleIncludes } from './server-startup';
export default defineConfig({ root: resolve('.'), optimizeDeps: {
  include: pdfPrebundleIncludes,
  // Capture entries are middleware HTML, so Vite cannot discover their full
  // graphs from an index.html scan. Include the late module-worker entry too.
  entries: [...screens.flatMap(screen => screen.entry ? [screen.entry.slice(1)] : screen.fixture ? [`tests/e2e/${screen.fixture}`] : []), 'apps/web/src/pdf-draft.worker.ts'],
}, plugins: [react(), {
  name: 'capture-fixture-entry', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const id = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').at(-1);
      const screen = screens.find(s => s.id === id);
      if (!req.url?.startsWith('/capture/') || !screen) return next();
      const html = `<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="height:100dvh"></div><script type="module" src="${screen.entry ?? `/tests/e2e/${screen.fixture}`}"></script></body></html>`;
      void server.transformIndexHtml(req.url, html).then(body => { res.setHeader('Content-Type', 'text/html'); res.end(body); }).catch(next);
    });
  },
}], server: { host: '127.0.0.1', port: 5498, strictPort: true } });
