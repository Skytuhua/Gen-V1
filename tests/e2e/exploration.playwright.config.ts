import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'exploration-ui.spec.ts',workers:1,timeout:45000,use:{baseURL:'http://127.0.0.1:5443',trace:'retain-on-failure',viewport:{width:1440,height:1000}},outputDir:'.harness-exploration-tests',webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5443 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5443',reuseExistingServer:false}});
