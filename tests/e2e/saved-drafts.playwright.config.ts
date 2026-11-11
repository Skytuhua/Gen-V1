import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'saved-drafts.spec.ts',workers:1,timeout:30000,outputDir:resolve('.harness-ui-shell/saved-drafts'),use:{baseURL:'http://127.0.0.1:5862',viewport:{width:1440,height:900},trace:'retain-on-failure'},webServer:process.env.GEN_E2E_EXTERNAL_SERVER==='1'?undefined:{cwd:resolve(import.meta.dirname,'../..'),command:'pnpm exec vite --config tests/e2e/saved-drafts.vite.config.ts',url:'http://127.0.0.1:5862/fixture',reuseExistingServer:false}});
