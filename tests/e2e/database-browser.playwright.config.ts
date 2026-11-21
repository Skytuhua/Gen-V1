import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: '.', testMatch: /database-browser\.spec\.ts/, workers: 1, timeout: 30000,
  outputDir: process.env.DATABASE_BROWSER_OUTPUT ?? resolve(tmpdir(), 'gen-database-browser'),
  use: { baseURL: 'http://127.0.0.1:5400', channel: 'chrome', viewport: { width: 1024, height: 768 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --config tests/e2e/database-browser.vite.config.ts --port 5400 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5400', reuseExistingServer: false },
});
