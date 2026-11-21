import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: '.', testMatch: ['composer-overflow.spec.ts'],
  workers: 1, timeout: 60_000,
  outputDir: resolve(tmpdir(), 'composer-overflow-playwright'),
  use: { baseURL: 'http://127.0.0.1:5504', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --config tests/e2e/composer-overflow.vite.config.ts --configLoader runner --host 127.0.0.1 --port 5504 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5504', reuseExistingServer: false,
  },
});
