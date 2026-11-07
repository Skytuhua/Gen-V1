import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({testDir:'.',testMatch:'terminal-read.spec.ts',workers:1,timeout:20000,expect:{timeout:4000},outputDir:process.env.GEN_TERMINAL_READ_OUTPUT??'.harness-terminal-read-results',use:{baseURL:'http://127.0.0.1:5814',channel:'chrome',headless:true,serviceWorkers:'block',viewport:{width:1000,height:760},trace:'retain-on-failure',screenshot:'only-on-failure'},webServer:{command:'pnpm exec vite --config tests/e2e/terminal-read.vite.config.ts --host 127.0.0.1 --port 5814 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5814/tests/e2e/fixtures/terminal-read.html',reuseExistingServer:false}});
