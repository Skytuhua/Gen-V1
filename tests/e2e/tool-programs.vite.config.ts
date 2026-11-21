import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import base from './vite.config';

export default defineConfig({
  ...base, root: resolve('.'), cacheDir: resolve(process.env.GEN_BROWSER_OUTPUT_DIR ?? 'test-results/tool-programs', 'node_modules/.vite'),
  optimizeDeps: { entries: ['tests/e2e/tool-programs-fixture.tsx'] },
  plugins: [...base.plugins ?? [], {
    name: 'tool-programs-fixture', configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/tool-programs') return next();
        void server.transformIndexHtml(request.url!, '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/e2e/tool-programs-fixture.tsx"></script></body></html>')
          .then(html => { response.setHeader('Content-Type', 'text/html'); response.end(html); }).catch(next);
      });
    },
  }],
  server: { host: '127.0.0.1', port: 5587, strictPort: true, fs: { allow: [resolve('.'), realpathSync('node_modules')] } },
});
