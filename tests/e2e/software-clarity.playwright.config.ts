import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:['software-development.spec.ts','software-clarity.spec.ts'],workers:1,timeout:45000,use:{baseURL:'http://127.0.0.1:5221',trace:'retain-on-failure'},webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5221 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5221',reuseExistingServer:false}});
