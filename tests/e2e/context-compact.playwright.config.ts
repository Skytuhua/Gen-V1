import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'context-compact.spec.ts',workers:1,timeout:20000,use:{baseURL:'http://127.0.0.1:5390',channel:'msedge',viewport:{width:1440,height:844},trace:'off'},outputDir:resolve('.harness-frontend-refinement/context-compact-artifacts'),webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5390 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5390',reuseExistingServer:false}});
