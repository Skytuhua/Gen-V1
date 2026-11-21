import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'hook-activity.spec.ts', workers: 1, timeout: 45000,
  expect: {timeout: 15_000},
  use: {baseURL: 'http://127.0.0.1:5796', channel: 'chrome', headless: true, serviceWorkers: 'block', viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  webServer: {command: 'pnpm exec vite --host 127.0.0.1 --port 5796 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5796', reuseExistingServer: false},
  reporter: 'line',
});
