import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

export default defineConfig({
  testDir: '.', testMatch: 'thread-hover.spec.ts', workers: 1, timeout: 20000,
  outputDir: process.env.HOVER_OUTPUT ?? resolve(tmpdir(), 'gen-thread-hover-renderer'),
  use: {baseURL: 'http://127.0.0.1:5419', channel: 'msedge', viewport: {width: 1120, height: 740}, trace: 'retain-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/thread-hover.vite.config.ts', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5419', reuseExistingServer: false},
});
