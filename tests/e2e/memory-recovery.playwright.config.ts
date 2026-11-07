import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const mode = process.env.GEN_MEMORY_MODE;
export default defineConfig({
  testDir: '.', testMatch: mode === 'app' ? 'memory-recovery-app.spec.ts' : mode === 'journal' ? 'memory-recovery-journal.spec.ts' : 'memory-recovery.spec.ts',
  workers: 1, timeout: 20000, expect: { timeout: 4000 },
  outputDir: process.env.GEN_MEMORY_OUTPUT ?? '.harness-memory-recovery/results',
  use: { baseURL: 'http://127.0.0.1:5816', channel: 'chrome', headless: true, serviceWorkers: 'block', viewport: { width: 1000, height: 760 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'pnpm exec vite --config tests/e2e/memory-recovery.vite.config.ts --host 127.0.0.1 --port 5816 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: mode ? 'http://127.0.0.1:5816' : 'http://127.0.0.1:5816/tests/e2e/fixtures/memory-recovery.html', reuseExistingServer: false },
});
