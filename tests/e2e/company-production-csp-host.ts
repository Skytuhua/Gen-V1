import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, relative} from 'node:path';
import {build} from 'esbuild';

/** Test bundle only: does not write dist, desktop payloads or any owner profile. */
export async function companyCspTestHost() {
  const hostSource = await readFile('apps/server/company-mode.ts', 'utf8'), csp = /const companyCsp = "([^"]+)"/.exec(hostSource)![1];
  const output = resolve('.harness-company-evidence/company-csp-20261103/memory-bundle');
  const bundled = await build({entryPoints: {app: 'tests/e2e/fixtures/company-csp-app.tsx', validation: 'tests/e2e/fixtures/company-csp-validation.ts'}, outdir: output,
    bundle: true, write: false, format: 'esm', splitting: true, platform: 'browser', target: 'es2023', jsx: 'automatic', metafile: true, logLevel: 'silent'});
  const assets = new Map(bundled.outputFiles.map(file => ['/assets/' + relative(output, file.path).replaceAll('\\', '/'), file.contents]));
  const calls: {path: string; method: string}[] = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      response.setHeader('Content-Security-Policy', csp); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
      if (pathname.startsWith('/api/')) {
        calls.push({path: pathname, method: request.method ?? ''}); response.setHeader('Content-Type', 'application/json');
        // Read-only UI fixture, not an owner-authentication or service proof.
        // Every company operation is unavailable; no real endpoint is proxied.
        if (pathname === '/api/bootstrap' && request.method === 'GET') response.end(JSON.stringify({csrfToken: 'PUBLIC-csp-ui-fixture'}));
        else response.writeHead(request.method === 'GET' ? 503 : 403).end(JSON.stringify({error: {code: 'COMPANY_UNAVAILABLE', message: 'Company data is unavailable in this labeled UI fixture.'}}));
        return;
      }
      const asset = assets.get(pathname);
      if (asset) {response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(asset); return;}
      if (pathname !== '/company/communications' && pathname !== '/validation') {response.writeHead(404).end(); return;}
      const entry = pathname === '/validation' ? 'validation' : 'app';
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><meta charset="utf-8">${entry === 'app' ? '<link rel="stylesheet" href="/assets/app.css">' : ''}</head><body><div id="root"></div><script type="module" src="/assets/${entry}.js"></script></body></html>`);
    } catch {if (!response.headersSent) response.writeHead(500); response.end();}
  });
  await new Promise<void>((accept, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', accept);});
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('TEST_LISTENER');
  return {origin: `http://127.0.0.1:${address.port}`, csp, calls, inputs: Object.keys(bundled.metafile!.inputs), close: async () => {await new Promise<void>(accept => server.close(() => accept()));}};
}
