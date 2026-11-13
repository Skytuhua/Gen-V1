import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: ['table-controls.spec.ts', 'migration-redesign.spec.ts', 'operational-smoothness.spec.ts'], workers: 1, timeout: 30000,
  outputDir: '../../test-results/wo7', globalSetup: './table-controls.setup.ts',
  use: { baseURL: 'http://127.0.0.1:5480', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
});
