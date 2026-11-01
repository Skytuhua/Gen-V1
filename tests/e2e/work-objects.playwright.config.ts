import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'work-objects.spec.ts',workers:1,timeout:45000,use:{baseURL:'http://127.0.0.1:5453',trace:'retain-on-failure',viewport:{width:1440,height:1000}},outputDir:'.harness-work-objects-tests',webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5453 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5453',reuseExistingServer:false}});
