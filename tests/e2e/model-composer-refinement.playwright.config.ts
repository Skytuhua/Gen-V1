import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'model-composer-refinement.spec.ts',workers:1,timeout:25000,outputDir:resolve('.harness-frontend-refinement/model-composer-artifacts'),use:{baseURL:'http://127.0.0.1:5389',channel:'msedge',viewport:{width:1440,height:1000},trace:'retain-on-failure'},webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5389 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5389',reuseExistingServer:false}});
