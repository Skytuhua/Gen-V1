import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({ testDir: '.', testMatch: 'context-connections.spec.ts', workers: 1, timeout: 30000, use: { baseURL: 'http://127.0.0.1:5455', viewport: { width: 1600, height: 1000 }, trace: 'retain-on-failure' }, outputDir: '.harness-context-connections', webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5455 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5455', reuseExistingServer: false } });
