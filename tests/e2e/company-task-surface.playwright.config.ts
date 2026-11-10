import {defineConfig} from '@playwright/test';

export default defineConfig({testDir: '.', testMatch: 'company-task-surface.spec.ts', workers: 1,
  use: {channel: 'chrome', bypassCSP: false, viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure'}});
