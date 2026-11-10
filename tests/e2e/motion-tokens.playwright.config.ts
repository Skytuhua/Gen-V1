import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: '.',
  testMatch: ['motion-tokens.spec.ts', 'document-smoothness.spec.ts'],
  workers: 1, timeout: 45_000,
  outputDir: resolve(tmpdir(), 'wo-2-6-playwright'),
  use: { baseURL: 'http://127.0.0.1:5496', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5496 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5496', reuseExistingServer: false,
  },
});
