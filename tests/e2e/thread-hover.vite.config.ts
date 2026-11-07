import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

export default defineConfig({
  root: resolve(import.meta.dirname, 'thread-hover'), plugins: [react()],
  server: {host: '127.0.0.1', port: 5419, strictPort: true, fs: {allow: [resolve(import.meta.dirname, '../..')]}},
  build: {outDir: process.env.HOVER_BUILD_OUTPUT ?? resolve(tmpdir(), 'gen-thread-hover-build'), emptyOutDir: false},
});
