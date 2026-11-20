import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

// Synthetic renderer coverage. An executable override does not establish native desktop proof.
export default defineConfig({testDir: '.', testMatch: 'project-memory.spec.ts', workers: 1, timeout: 25000,
  outputDir: resolve('test-results/project-memory'),
  use: {baseURL: 'http://127.0.0.1:5538', browserName: 'chromium', viewport: {width: 1280, height: 900}, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: process.env.GEN_MEMORY_BROWSER_EXECUTABLE ? {executablePath: process.env.GEN_MEMORY_BROWSER_EXECUTABLE} : {}},
  webServer: {command: 'pnpm exec vite --config tests/e2e/project-memory.vite.config.ts --configLoader runner', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5538/project-memory', reuseExistingServer: false, stdout: 'pipe'},
});
