import { defineConfig } from '@playwright/test';

// HostFixture exclusively binds 4337/4338 and serves the existing dist/web build.
// In particular, this config must not inherit the root config's pnpm dev server.
const label = process.env.SNAPSHOT_PERFORMANCE_LABEL ?? 'local';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid snapshot performance label');
export default defineConfig({
  testDir: '.',
  testMatch: 'snapshot-performance.spec.ts',
  outputDir: `../../.harness-snapshot-performance-${label}`,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4337', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
});
