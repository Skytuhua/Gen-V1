import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'read-aloud.spec.ts', workers: 1, timeout: 30_000,
  expect: { timeout: 8000 },
  outputDir: process.env.GEN_READ_ALOUD_OUTPUT ?? '.harness-read-aloud-results',
  use: { baseURL: 'http://127.0.0.1:5833', headless: true, serviceWorkers: 'block', viewport: { width: 800, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'pnpm exec vite --config tests/e2e/read-aloud.vite.config.ts --host 127.0.0.1 --port 5833 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5833/tests/e2e/fixtures/read-aloud.html', reuseExistingServer: false },
});
