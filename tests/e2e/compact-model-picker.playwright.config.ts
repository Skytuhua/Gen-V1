import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: '.', testMatch: /(?:compact-model-picker|model-composer-refinement|ui-shell-overlays|subscription-accounts)\.spec\.ts/, workers: 1, timeout: 20000,
  outputDir: process.env.MODEL_PICKER_OUTPUT ?? resolve(tmpdir(), 'gen-compact-model-picker'),
  use: { baseURL: 'http://127.0.0.1:5397', channel: 'msedge', viewport: { width: 1024, height: 768 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --config tests/e2e/compact-model-picker.vite.config.ts --port 5397 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5397', reuseExistingServer: false },
});
