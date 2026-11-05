import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:['shared-panels.spec.ts'],workers:1,timeout:30000,outputDir:'../../.harness-shared-panels-results',use:{baseURL:'http://127.0.0.1:5371',viewport:{width:1500,height:1000},trace:'off'},webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5371 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5371',reuseExistingServer:false}});
