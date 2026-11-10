import { defineConfig } from 'vite';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import isolated from './vite.config';

const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  ...isolated,
  cacheDir: resolve(tmpdir(), 'wo-3-1-artifact-settle-vite'),
  server: { ...isolated.server, port: 5501, fs: { allow: [root, realpathSync(resolve(root, 'node_modules'))] } },
});
