import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
 testDir:'.',testMatch:['clarity-schedule-logs.spec.ts','task-scheduling.spec.ts','exploration-ui.spec.ts'],workers:1,timeout:45000,
 outputDir:'.harness-clarity-schedule-logs-results',
 use:{baseURL:'http://127.0.0.1:5467',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
 webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5467 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5467',reuseExistingServer:false},
});
