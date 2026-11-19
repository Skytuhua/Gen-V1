import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'visual-matrix.spec.ts', fullyParallel: true, workers: 2, timeout: 45000,
  outputDir: '.harness-visual-matrix/results',
  use: {baseURL: 'http://127.0.0.1:5816', trace: 'retain-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/vite.config.ts --port 5816 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5816', reuseExistingServer: false},
});
