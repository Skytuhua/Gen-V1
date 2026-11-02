import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.',
  testMatch: 'runtime-presentation.spec.ts',
  workers: 1,
  timeout: 30000,
  outputDir: '.harness-runtime-presentation',
  use: { baseURL: 'http://127.0.0.1:5461', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5461 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:5461',
    reuseExistingServer: false,
  },
});
