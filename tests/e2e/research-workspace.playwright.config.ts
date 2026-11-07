import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
  testDir: '.', testMatch: 'research-workspace*.spec.ts', workers: 1, timeout: 25000,
  outputDir: process.env.RESEARCHUI_EVIDENCE_DIR ?? resolve('.harness-ui-shell/research-workspace'),
  use: {baseURL: 'http://127.0.0.1:5529', channel: 'msedge', viewport: {width: 1120, height: 740}, trace: 'retain-on-failure'},
  webServer: {command: 'pnpm exec tsx tests/e2e/research-workspace-fixture-server.ts', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5529', reuseExistingServer: false, timeout: 60000},
});
