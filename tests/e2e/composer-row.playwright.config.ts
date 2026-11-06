import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'composer-app-refinement.spec.ts',grep:/text entry shares|attachment band/,
  workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:5437',channel:'msedge',viewport:{width:1440,height:900},trace:'retain-on-failure'},
  webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5437 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5437',reuseExistingServer:false}});
