import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'conversation-find.spec.ts',workers:1,timeout:30000,outputDir:'.harness-ui-shell/conversation-find',use:{baseURL:'http://127.0.0.1:5864',viewport:{width:1440,height:900},trace:'retain-on-failure'},webServer:{cwd:resolve(import.meta.dirname,'../..'),command:'pnpm exec vite --config tests/e2e/conversation-find.vite.config.ts',url:'http://127.0.0.1:5864/fixture',reuseExistingServer:false}});
