import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'workbench-app.spec.ts',workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:5592',viewport:{width:1280,height:800},trace:'retain-on-failure'},
 webServer:{command:'pnpm exec vite --config tests/e2e/vite.config.ts --port 5592 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5592',reuseExistingServer:false}});
