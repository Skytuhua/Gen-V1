import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'project-app-integration.spec.mjs',workers:1,timeout:20000,
 outputDir:process.env.PROJECT_APP_EVIDENCE??resolve('.harness-ui-shell/project-app-integration'),
 use:{baseURL:'http://127.0.0.1:5440',channel:'msedge',viewport:{width:1000,height:720},trace:'retain-on-failure'},
 webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5440 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5440',reuseExistingServer:false}});
