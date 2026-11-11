import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'ui-shell-controls.spec.ts', workers: 1, timeout: 15000,
  outputDir: resolve('.harness-ui-shell/controls'),
  use: { baseURL: 'http://127.0.0.1:5394', channel: 'msedge', viewport: { width: 800, height: 600 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5394 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5394', reuseExistingServer: false },
});
