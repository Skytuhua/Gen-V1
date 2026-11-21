import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
 testDir:'.',testMatch:['test-results.spec.ts','test-results-shots.spec.ts'],workers:1,timeout:30000,outputDir:resolve('test-results-test-results'),
 use:{baseURL:'http://127.0.0.1:5492',viewport:{width:1280,height:800},trace:'retain-on-failure'},
 webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5492 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5492',reuseExistingServer:false,env:{GEN_E2E:'1'}},reporter:'line',
});
