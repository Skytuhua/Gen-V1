import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: '.', testMatch: 'summary-dock.spec.ts', workers: 1, timeout: 20000,
  outputDir: resolve('.harness-summary-dock/artifacts'),
  use: { baseURL: 'http://127.0.0.1:5421', channel: 'msedge', viewport: { width: 1000, height: 650 }, contextOptions: { reducedMotion: 'reduce' }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5421 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5421', reuseExistingServer: false },
});
