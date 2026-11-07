import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({testDir:'.',testMatch:'browser-action.spec.ts',workers:1,timeout:60000,expect:{timeout:2500},outputDir:process.env.GEN_BROWSER_ACTION_OUTPUT??'.harness-browser-action-results',use:{baseURL:'http://127.0.0.1:5812',channel:'chrome',headless:true,serviceWorkers:'block',viewport:{width:1000,height:760},trace:'retain-on-failure',screenshot:'only-on-failure'},webServer:{command:'pnpm exec vite --config tests/e2e/browser-action.vite.config.ts --host 127.0.0.1 --port 5812 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5812/tests/e2e/fixtures/browser-action.html',reuseExistingServer:false}});
