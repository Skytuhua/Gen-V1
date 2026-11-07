import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'workspace-host.spec.ts', workers: 1, timeout: 20000,
  outputDir: process.env.WORKSPACE_HOST_EVIDENCE_DIR ?? resolve('.harness-ui-shell/workspace-host'),
  use: {baseURL: 'http://127.0.0.1:5678', channel: 'msedge', trace: 'retain-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/vite.config.ts --port 5678 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5678', reuseExistingServer: false},
});
