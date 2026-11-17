import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

// Uses the built production App through actual authenticated host routes.
export default defineConfig({
  testDir: '.', testMatch: 'verification-host.spec.ts', workers: 1, timeout: 90_000,
  outputDir: resolve('test-results/verification-host'), expect: {timeout: 10_000},
  use: {browserName: 'chromium', baseURL: 'http://127.0.0.1:5561', actionTimeout: 10_000, viewport: {width: 1440, height: 1000},
    trace: 'retain-on-failure', screenshot: 'only-on-failure'},
});
