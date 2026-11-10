import {defineConfig} from '@playwright/test';
export default defineConfig({testDir: '.', testMatch: 'company-approved-job-read.spec.ts', workers: 1,
  use: {channel: 'chrome', bypassCSP: false, viewport: {width: 1280, height: 900}, trace: 'retain-on-failure'}});
