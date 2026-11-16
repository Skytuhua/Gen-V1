import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import base from './vite.config';

export default defineConfig({...base, root: resolve('.'), cacheDir: resolve(process.env.GEN_BROWSER_OUTPUT_DIR ?? 'test-results/project-memory', 'node_modules/.vite'),
  optimizeDeps: {entries: ['tests/e2e/project-memory-fixture.tsx']},
  plugins: [...base.plugins ?? [], {name: 'project-memory-fixture', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/project-memory') return next();
      void server.transformIndexHtml(request.url!, '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/e2e/project-memory-fixture.tsx"></script></body></html>').then(html => {response.setHeader('Content-Type', 'text/html'); response.end(html);}).catch(next);
    });
  }}], server: {...base.server, port: 5538, strictPort: true},
});
