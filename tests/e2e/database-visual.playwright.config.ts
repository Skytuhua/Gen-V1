import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: '.', testMatch: /database-visual\.spec\.ts/, workers: 1, timeout: 20000,
  outputDir: process.env.DATABASE_VISUAL_OUTPUT ?? resolve(tmpdir(), 'gen-database-visual'),
  use: { baseURL: 'http://127.0.0.1:5399', channel: 'msedge', viewport: { width: 1024, height: 768 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --config tests/e2e/database-visual.vite.config.ts --port 5399 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5399', reuseExistingServer: false },
});
