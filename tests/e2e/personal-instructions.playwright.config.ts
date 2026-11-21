import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'personal-instructions.spec.ts', workers: 1,
  expect: {timeout: 15_000},
  outputDir: process.env.GEN_PERSONAL_INSTRUCTIONS_OUTPUT ?? '.harness-personal-instructions',
  use: {baseURL: 'http://127.0.0.1:5823', headless: true, serviceWorkers: 'block', viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/personal-instructions.vite.config.ts --host 127.0.0.1 --port 5823 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5823', reuseExistingServer: false},
});
