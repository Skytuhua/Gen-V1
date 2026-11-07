import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'inbox-controls.spec.ts', workers: 1, timeout: 30_000,
  expect: {timeout: 8000},
  outputDir: process.env.GEN_INBOX_CONTROLS_OUTPUT ?? '.harness-inbox-controls-results',
  use: {baseURL: 'http://127.0.0.1:5802', channel: 'chrome', headless: true, serviceWorkers: 'block', viewport: {width: 1100, height: 760}, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/inbox-controls.vite.config.ts --host 127.0.0.1 --port 5802 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5802/tests/e2e/fixtures/inbox-controls.html', reuseExistingServer: false},
});
