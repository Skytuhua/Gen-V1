import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'wo8.spec.ts', workers: 1, timeout: 30000,
  outputDir: resolve('test-results/wo8'),
  use: { baseURL: 'http://127.0.0.1:5488', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: { command: 'timeout 300s env COREPACK_HOME=/tmp/wo8-corepack pnpm exec vite --config tests/e2e/vite.config.ts --port 5488', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5488', reuseExistingServer: false },
});
