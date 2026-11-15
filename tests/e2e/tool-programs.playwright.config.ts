import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: ['tool-programs.spec.ts'], workers: 1, timeout: 15000,
  outputDir: resolve('test-results/tool-programs'),
  use: { baseURL: 'http://127.0.0.1:5587', browserName: 'chromium', viewport: { width: 1100, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'corepack pnpm@10.30.3 exec vite --config tests/e2e/tool-programs.vite.config.ts --configLoader runner',
    cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5587/tool-programs', reuseExistingServer: false, timeout: 30000,
  },
});
