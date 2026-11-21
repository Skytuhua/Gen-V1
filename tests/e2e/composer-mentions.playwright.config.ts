import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir: '.', testMatch: 'composer-mentions.spec.ts', workers: 1, timeout: 30_000, use: {baseURL: 'http://127.0.0.1:5344', viewport: {width: 1280, height: 800}, trace: 'retain-on-failure'}, webServer: {command: 'pnpm exec vite --config tests/e2e/composer-mentions.vite.config.ts --configLoader runner --host 127.0.0.1 --port 5344 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5344', reuseExistingServer: false}});
