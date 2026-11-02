import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
 testDir:'.',testMatch:'conversation-scroll.spec.ts',fullyParallel:false,workers:1,
 timeout:20000,use:{baseURL:'http://127.0.0.1:5481',headless:true,viewport:{width:1000,height:800}},
 webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5481 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5481',reuseExistingServer:false,timeout:30000},
});
