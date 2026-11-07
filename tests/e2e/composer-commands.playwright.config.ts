import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir: '.', testMatch: 'composer-commands.spec.ts', workers: 1, use: {baseURL: 'http://127.0.0.1:5343', viewport: {width: 1280, height: 800}}, webServer: {command: 'pnpm exec vite --host 127.0.0.1 --port 5343 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5343', reuseExistingServer: false}});
