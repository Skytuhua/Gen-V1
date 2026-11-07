import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', workers: 1,
  projects: [
    {name: 'generated-controls', testMatch: ['generated-selects.spec.ts', 'work-objects.spec.ts', 'inline-diagrams.spec.ts']},
    {name: 'schema-review', testMatch: 'desktop-surfaces.spec.ts', grep: /review: clearing an enum/},
  ],
  timeout: 45_000, expect: {timeout: 15_000},
  outputDir: process.env.GEN_GENERATED_SELECTS_OUTPUT ?? '.harness-generated-selects-results',
  use: {baseURL: 'http://127.0.0.1:5796', channel: 'chrome', headless: true, serviceWorkers: 'block', viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/generated-selects.vite.config.ts --host 127.0.0.1 --port 5796 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5796', reuseExistingServer: false},
});
