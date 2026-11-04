import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'sidebar-compact.spec.ts',outputDir:resolve('.harness-gen-v1-workspace/sidebar-compact-artifacts'),workers:1,timeout:20000,use:{channel:'msedge',baseURL:'http://127.0.0.1:5387',viewport:{width:1280,height:800},trace:'off'},webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5387 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5387',reuseExistingServer:false}});
