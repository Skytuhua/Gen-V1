import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'hook-settings.spec.ts', workers: 1,
  expect: {timeout: 15_000},
  outputDir: process.env.GEN_HOOK_SETTINGS_OUTPUT ?? '.harness-hook-settings',
  use: {baseURL: 'http://127.0.0.1:5795', channel: 'chrome', headless: true, serviceWorkers: 'block', viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/hook-settings.vite.config.ts --host 127.0.0.1 --port 5795 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5795', reuseExistingServer: false},
});
