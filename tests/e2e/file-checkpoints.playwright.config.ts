import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'file-checkpoints.spec.ts',workers:1,timeout:20000,
  outputDir:resolve('test-results/file-checkpoints'),
  use:{baseURL:'http://127.0.0.1:5525',browserName:'chromium',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  webServer:process.env.GEN_WO5_SERVER_EXTERNAL==='1'?undefined:{command:'exec timeout --kill-after=5s 300s pnpm exec vite --config tests/e2e/file-checkpoints.vite.config.ts --configLoader runner',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5525/file-checkpoints',reuseExistingServer:false,timeout:30000},
});
