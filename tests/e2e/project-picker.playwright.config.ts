import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'project-picker.spec.ts', workers: 1, timeout: 15000,
  outputDir: process.env.PROJECT_EVIDENCE_DIR ?? resolve('.harness-ui-shell/project-picker'),
  use: { baseURL: 'http://127.0.0.1:5407', channel: 'msedge', viewport: { width: 800, height: 600 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5407 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5407', reuseExistingServer: false },
});
