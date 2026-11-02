import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: /model-picker\.spec\.ts|subscription-accounts\.spec\.ts|composer-reference\.spec\.ts|composer-motion\.spec\.ts/,
  workers: 1, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5527', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --config tests/e2e/vite.config.ts --port 5527', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5527', reuseExistingServer: false },
});
