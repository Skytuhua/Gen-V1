import { resolve } from 'node:path';
import type { InlineConfig, ViteDevServer } from 'vite';

// The main app and fixture roots share package.json, so Vite's default cacheDir
// resolves to the same node_modules/.vite for both. Never let either optimizer
// replace the other server's chunks (or another capture invocation's chunks).
export function captureServerOptions(configFile: string, cacheRoot: string, role: 'fixtures' | 'app-shell'): InlineConfig {
  return { configFile: resolve(configFile), cacheDir: resolve(cacheRoot, 'node_modules', '.vite', role), server: { port: 0, strictPort: false } };
}
export const pdfPrebundleIncludes = ['pdf-lib', 'pdfjs-dist/legacy/build/pdf.mjs'];
export const pdfWarmupFiles = [
  'apps/web/src/DocumentPreview.tsx',
  'apps/web/src/pdf-draft.worker.ts',
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
] as const;
export function pdfWarmupRequests(root = resolve('.')) {
  return pdfWarmupFiles.map(file => `/@fs/${resolve(root, file).replaceAll('\\', '/')}${file.endsWith('pdf-draft.worker.ts') ? '?worker_file&type=module' : ''}`);
}
type WarmableServer = Pick<ViteDevServer, 'transformRequest' | 'waitForRequestsIdle'>;
export async function warmPdfCapture(server: WarmableServer, requests = pdfWarmupRequests()): Promise<void> {
  // Explicitly transform the lazy draft worker and PDF.js worker before any page
  // can trigger their first dependency discovery. A warmup error is fatal.
  await Promise.all(requests.map(async url => {
    if (!await server.transformRequest(url)) throw Error(`PDF warmup returned no module: ${url}`);
  }));
  await server.waitForRequestsIdle();
}
