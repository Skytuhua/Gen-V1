import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.',
  testMatch: 'chart-coordinates.spec.ts',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:5482',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    viewport: {width: 1440, height: 1000},
  },
  outputDir: '.harness-chart-coordinates-tests',
  reporter: [['list'], ['json', {outputFile: resolve(import.meta.dirname, '.harness-chart-coordinates-tests/report.json')}]],
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5482 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:5482',
    reuseExistingServer: false,
  },
});
