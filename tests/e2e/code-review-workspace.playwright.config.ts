import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
  testDir: '.', testMatch: 'code-review-workspace.spec.ts', workers: 1, timeout: 20000,
  outputDir: process.env.REVIEWUI_EVIDENCE_DIR ?? resolve('.harness-ui-shell/code-review-workspace'),
  use: {baseURL: 'http://127.0.0.1:5543', channel: 'msedge', viewport: {width: 1200, height: 800}, trace: 'retain-on-failure'},
  webServer: {command: 'pnpm exec vite --host 127.0.0.1 --port 5543 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5543', reuseExistingServer: false},
});
