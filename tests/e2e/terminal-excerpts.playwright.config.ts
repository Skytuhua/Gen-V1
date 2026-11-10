import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({testDir:'.',testMatch:'terminal-excerpts.spec.ts',workers:1,timeout:30000,outputDir:resolve('.harness-ui-shell/terminal-excerpts'),use:{baseURL:'http://127.0.0.1:5863',viewport:{width:1440,height:900},trace:'retain-on-failure'},webServer:{cwd:resolve(import.meta.dirname,'../..'),command:'pnpm exec vite --config tests/e2e/terminal-excerpts.vite.config.ts',url:'http://127.0.0.1:5863/fixture',reuseExistingServer:false}});
