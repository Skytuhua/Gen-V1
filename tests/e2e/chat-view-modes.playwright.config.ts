import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
 testDir:'.',testMatch:'chat-view-modes.spec.ts',workers:1,timeout:30000,outputDir:resolve('test-results-chat-view-modes'),
 use:{baseURL:'http://127.0.0.1:5491',viewport:{width:1440,height:900},trace:'on-first-retry'},
 webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5491 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5491',reuseExistingServer:false,env:{GEN_E2E:'1'}},reporter:'line',
});
