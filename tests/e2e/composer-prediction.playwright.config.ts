import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({ testDir: '.', testMatch: 'composer-prediction.spec.ts', workers: 1, use: { baseURL: 'http://127.0.0.1:5327', viewport: { width: 1440, height: 1000 } }, webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5327 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5327', reuseExistingServer: false } });
