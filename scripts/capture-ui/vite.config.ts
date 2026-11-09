import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { screens } from './screen-map';
export default defineConfig({ root: resolve('.'), plugins: [react(), {
  name: 'capture-fixture-entry', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const id = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').at(-1);
      const screen = screens.find(s => s.id === id);
      if (!req.url?.startsWith('/capture/') || !screen) return next();
      const html = `<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="height:100dvh"></div><script type="module" src="/tests/e2e/${screen.fixture}"></script></body></html>`;
      void server.transformIndexHtml(req.url, html).then(body => { res.setHeader('Content-Type', 'text/html'); res.end(body); }).catch(next);
    });
  },
}], server: { host: '127.0.0.1', port: 5498, strictPort: true } });
