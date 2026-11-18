import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'background-work.spec.ts', workers: 1, timeout: 30_000,
  expect: { timeout: 8000 },
  outputDir: process.env.GEN_BACKGROUND_WORK_OUTPUT ?? '.harness-background-work-results',
  use: { baseURL: 'http://127.0.0.1:5821', headless: true, serviceWorkers: 'block', viewport: { width: 1100, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'pnpm exec vite --config tests/e2e/background-work.vite.config.ts --host 127.0.0.1 --port 5821 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5821/tests/e2e/fixtures/background-work.html', reuseExistingServer: false },
});
