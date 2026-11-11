import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'wo8.spec.ts', workers: 1, timeout: 30000,
  outputDir: resolve('test-results/wo8'),
  webServer: { command: 'pnpm exec vite --config tests/e2e/vite.config.ts --port 5488', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5488', reuseExistingServer: true, timeout: 120000 },
  use: { baseURL: 'http://127.0.0.1:5488', viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' }, trace: 'retain-on-failure' },

});
