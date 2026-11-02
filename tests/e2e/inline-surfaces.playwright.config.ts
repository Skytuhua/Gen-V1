import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir:'.',testMatch:'inline-surfaces.spec.ts',workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:5457',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5457 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5457',reuseExistingServer:false},
});
