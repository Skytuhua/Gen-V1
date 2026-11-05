import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:['drag-detach.spec.ts','free-floating.spec.ts','canvas-clarity.spec.ts'],workers:1,timeout:20000,use:{baseURL:'http://127.0.0.1:5391',channel:'msedge',trace:'off'},outputDir:resolve('.harness-gen-v1-workspace/drag-detach-tests'),webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5391 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5391',reuseExistingServer:false}});
