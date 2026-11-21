import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// Serves the production dist/web build through the real host on exclusive ports.
// Run pnpm build first. No Vite server or browser API interception is involved.
export default defineConfig({
  testDir: '.', testMatch: 'review-comments.spec.ts', workers: 1, timeout: 90_000,
  outputDir: resolve('test-results/review-comments'),
  expect: { timeout: 10_000 },
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5561', viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
