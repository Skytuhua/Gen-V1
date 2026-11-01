import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
/** PDF fixtures intercept every API request; a dedicated Vite avoids shared-server teardown races. */
export default defineConfig({
  testDir: '.', testMatch: 'document-preview.spec.ts', workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:5187', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5187 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5187', reuseExistingServer: false },
});
