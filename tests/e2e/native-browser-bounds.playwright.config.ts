import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'native-browser-bounds.spec.ts',workers:1,timeout:15000,
 outputDir:process.env.GEN_BROWSER_GEOMETRY_EVIDENCE??resolve('.harness-browser-geometry'),use:{baseURL:'http://127.0.0.1:5788',channel:'msedge',trace:'retain-on-failure'},
 webServer:{command:'pnpm exec vite --config tests/e2e/vite.config.ts --port 5788 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5788',reuseExistingServer:false}});
