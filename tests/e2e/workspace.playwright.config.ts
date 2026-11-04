import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:['workspace-components.spec.ts','workspace-ui.spec.ts'],outputDir:resolve('.harness-gen-v1-workspace/browser-artifacts'),workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:5369',viewport:{width:1700,height:1050},trace:'off'},webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5369 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5369',reuseExistingServer:false}});
