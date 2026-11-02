import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
 testDir:'.',testMatch:'markdown.spec.ts',workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:5488',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
 outputDir:'.harness-markdown-tests',
 webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5488 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5488',reuseExistingServer:false},
});
