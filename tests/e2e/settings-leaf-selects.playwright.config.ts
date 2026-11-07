import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: ['settings-leaf-selects.spec.ts', 'settings-controls.spec.ts', 'settings-loading.spec.ts'], workers: 1,
  // The first host page includes cold Vite source transforms before React mounts.
  expect: {timeout: 15_000},
  outputDir: process.env.GEN_SETTINGS_LEAF_SELECTS_OUTPUT ?? '.harness-settings-leaf-selects',
  use: {baseURL: 'http://127.0.0.1:5794', channel: 'chrome', headless: true, serviceWorkers: 'block', viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/settings-leaf-selects.vite.config.ts --host 127.0.0.1 --port 5794 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5794', reuseExistingServer: false},
});
