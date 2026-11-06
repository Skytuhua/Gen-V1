import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: ['settings-controls.spec.ts', 'settings-loading.spec.ts'], workers: 1,
  outputDir: process.env.GEN_SETTINGS_TEST_OUTPUT ?? '.harness-settings-controls',
  use: { baseURL: 'http://127.0.0.1:5593', channel: process.env.GEN_TEST_BROWSER_CHANNEL ?? 'chrome', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5593 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5593', reuseExistingServer: false },
});
