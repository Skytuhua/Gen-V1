import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'tabs-identity.spec.ts', workers: 1, timeout: 30_000,
  outputDir: resolve(import.meta.dirname, '../../test-results/tabs-identity'),
  use: { baseURL: 'http://127.0.0.1:5483', browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5483 --strictPort', cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:5483', reuseExistingServer: false,
  },
  reporter: 'line',
});
