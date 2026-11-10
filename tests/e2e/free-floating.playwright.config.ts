import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'free-floating.spec.ts',workers:1,timeout:20000,use:{baseURL:'http://127.0.0.1:5237',channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',trace:'off'},outputDir:resolve('.harness-gen-v1-workspace/free-floating-tests'),webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5237 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5237',reuseExistingServer:false}});
