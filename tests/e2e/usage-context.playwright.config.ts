import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: '.', testMatch: 'usage-context.spec.ts', workers: 1, timeout: 15000,
  outputDir: process.env.USAGE_EVIDENCE_DIR ?? resolve('.harness-ui-shell/usage-context'),
  use: { baseURL: 'http://127.0.0.1:5413', browserName: 'chromium', channel: process.platform === 'win32' ? 'msedge' : undefined, viewport: { width: 900, height: 700 }, trace: 'retain-on-failure' },
  webServer: { command: 'corepack pnpm exec vite --host 127.0.0.1 --port 5413 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5413', reuseExistingServer: false },
});
