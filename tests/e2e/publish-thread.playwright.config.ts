import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: '.', testMatch: ['publish-thread.spec.ts'],
  workers: 1, timeout: 30_000,
  outputDir: resolve(tmpdir(), 't06-publish-thread-playwright'),
  use: { baseURL: 'http://127.0.0.1:5830', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --config tests/e2e/publish-thread.vite.config.ts --configLoader runner --host 127.0.0.1 --port 5830 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5830', reuseExistingServer: false,
  },
});
