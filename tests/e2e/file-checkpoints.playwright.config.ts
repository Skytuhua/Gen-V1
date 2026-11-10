import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'file-checkpoints.spec.ts',workers:1,timeout:20000,
  outputDir:'/tmp/gen-wo5-file-checkpoints-playwright',
  use:{baseURL:'http://127.0.0.1:5525',browserName:'chromium',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  webServer:{command:'pnpm exec vite --config tests/e2e/file-checkpoints.vite.config.ts --configLoader runner',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5525/file-checkpoints',reuseExistingServer:false},
});
