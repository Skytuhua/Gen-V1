// Test-only playwright config for the M08 restore-UI and PR-checks specs.
import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:['m08-restore-ui.spec.ts','m08-pr-checks.spec.ts'],workers:1,timeout:20000,
  outputDir:resolve('test-results/m08-restore'),
  use:{baseURL:'http://127.0.0.1:5530',browserName:'chromium',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  webServer:{command:'pnpm exec vite --config tests/e2e/m08-restore.vite.config.ts --configLoader runner',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5530/m08-restore',reuseExistingServer:false,timeout:30000},
});
