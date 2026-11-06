import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'ui-shell-overlays.spec.ts', workers: 1, timeout: 20000,
  outputDir: resolve('.harness-ui-shell/overlays'),
  use: { baseURL: 'http://127.0.0.1:5393', channel: 'msedge', viewport: { width: 800, height: 600 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5393 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5393', reuseExistingServer: false },
});
