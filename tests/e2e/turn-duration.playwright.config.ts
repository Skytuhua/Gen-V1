import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.',
  testMatch: 'turn-duration.spec.ts',
  workers: 1,
  timeout: 30000,
  outputDir: '.harness-turn-duration',
  use: { baseURL: 'http://127.0.0.1:5479', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5479 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:5479',
    reuseExistingServer: false,
  },
});
