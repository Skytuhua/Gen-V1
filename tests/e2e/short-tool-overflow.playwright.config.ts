import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir: '.', testMatch: 'short-tool-overflow.spec.ts', workers: 1, timeout: 20000,
  outputDir: process.env.SHELL_SHORT_EVIDENCE_DIR ?? resolve('.harness-ui-shell/short-tools'), use: {baseURL: 'http://127.0.0.1:5668', channel: 'msedge', trace: 'retain-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/vite.config.ts --port 5668 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5668', reuseExistingServer: false}});
