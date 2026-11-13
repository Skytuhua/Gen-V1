import { createServer } from 'vite';
import { resolve } from 'node:path';
export default async function setup() {
  const root = resolve(import.meta.dirname, '../..');
  const server = await createServer({
    configFile: resolve(root, 'vite.config.ts'), cacheDir: '/tmp/wo7-table-controls-vite',
    server: { host: '127.0.0.1', port: 5480, strictPort: true, fs: { allow: [resolve(root, '..')] } },
  });
  await server.listen();
  return async () => { await server.close(); };
}
