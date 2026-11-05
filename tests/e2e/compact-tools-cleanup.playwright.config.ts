import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'compact-tools-cleanup.spec.ts',workers:1,timeout:30000,outputDir:resolve('.harness-ui-cleanup-20261104/compact-ui/browser-artifacts'),use:{baseURL:'http://127.0.0.1:5589',viewport:{width:1440,height:1000},trace:'retain-on-failure'},webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5589 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5589',reuseExistingServer:false}});
