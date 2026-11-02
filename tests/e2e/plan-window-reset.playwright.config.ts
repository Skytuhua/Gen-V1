import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:['plan-window-reset.spec.ts'],workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:5245',trace:'retain-on-failure',hasTouch:true},webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5245 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5245',reuseExistingServer:false}});
