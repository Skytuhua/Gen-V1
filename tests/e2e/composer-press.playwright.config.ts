import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: '.', testMatch: ['composer-press.spec.ts'],
  workers: 1, timeout: 30_000,
  outputDir: resolve(tmpdir(), 'wo-3-3-composer-press-playwright'),
  use: { baseURL: 'http://127.0.0.1:5503', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --config tests/e2e/composer-press.vite.config.ts --configLoader runner --host 127.0.0.1 --port 5503 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5503', reuseExistingServer: false,
  },
});
