import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'wo5-app-integration.spec.ts',workers:1,timeout:45000,
 outputDir:'/tmp/wo5-run-d-integration-results',
 use:{baseURL:'http://127.0.0.1:5527',browserName:'chromium',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
 webServer:process.env.GEN_WO5_SERVER_EXTERNAL==='1'?undefined:{command:'pnpm exec vite --config tests/e2e/vite.config.ts --configLoader runner --port 5527 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5527',reuseExistingServer:false},
});
