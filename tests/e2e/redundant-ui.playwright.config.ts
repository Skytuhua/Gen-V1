import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'redundant-ui.spec.ts',workers:1,timeout:60000,outputDir:'/tmp/wo5-run-d-redundant-ui-playwright',
 use:{baseURL:'http://127.0.0.1:5526',browserName:'chromium',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
 webServer:process.env.GEN_WO5_SERVER_EXTERNAL==='1'?undefined:{command:'pnpm exec vite --config tests/e2e/redundant-ui.vite.config.ts --configLoader runner',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5526/redundant-ui',reuseExistingServer:false},
});
