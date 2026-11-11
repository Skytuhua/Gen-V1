import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'saved-layout-chooser.spec.ts',workers:1,timeout:15000,
 outputDir:process.env.GEN_LAYOUT_EVIDENCE??resolve('.harness-layout'),
 use:{baseURL:'http://127.0.0.1:5416',channel:'msedge',viewport:{width:800,height:600},trace:'retain-on-failure'},
 webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5416 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5416',reuseExistingServer:false}});
