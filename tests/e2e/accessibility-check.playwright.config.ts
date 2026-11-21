import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'accessibility-check.spec.ts',workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:5249',trace:'retain-on-failure',viewport:{width:1440,height:1000}},webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5249 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5249',reuseExistingServer:false}});
