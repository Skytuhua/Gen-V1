import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
  testDir: '.', testMatch: 'scoped-conversation.spec.ts', workers: 1, timeout: 20000,
  outputDir: resolve('.harness-ui-shell/scoped-conversation'),
  use: {baseURL: 'http://127.0.0.1:5576', channel: 'msedge', viewport: {width: 1000, height: 720}, trace: 'retain-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/scoped-conversation.vite.config.ts', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5576/tests/e2e/fixtures/scoped-conversation.html', reuseExistingServer: false, timeout: 30000},
});
