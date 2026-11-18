import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'workbench.spec.ts',workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:5591',viewport:{width:1280,height:800},trace:'retain-on-failure'},webServer:{cwd:resolve(import.meta.dirname,'../..'),command:'pnpm exec vite --config tests/e2e/workbench.vite.config.ts',url:'http://127.0.0.1:5591/fixture',reuseExistingServer:false}});
