import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

export default defineConfig({
  testDir: '.', testMatch: 'sidebar-collapse.spec.ts', workers: 1, timeout: 45_000,
  outputDir: resolve(tmpdir(), 'wo-3-2-sidebar-collapse-playwright'),
  use: {baseURL: 'http://127.0.0.1:5502', viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure'},
  webServer: {
    command: 'pnpm exec vite --config tests/e2e/sidebar-collapse.vite.config.ts --configLoader runner --host 127.0.0.1 --port 5502 --strictPort',
    cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5502', reuseExistingServer: false,
  },
});
