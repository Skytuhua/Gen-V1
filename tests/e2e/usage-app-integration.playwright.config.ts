import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
 testDir:'.',testMatch:['usage-app-integration.spec.ts','shell-error-ownership.spec.ts','mobile-navigation.spec.ts'],workers:1,timeout:15000,
 outputDir:process.env.USAGE_APP_EVIDENCE_DIR??resolve('.harness-ui-shell/usage-app'),
 use:{baseURL:'http://127.0.0.1:5623',channel:'msedge',viewport:{width:1440,height:900},trace:'retain-on-failure'},
 webServer:{command:'pnpm exec vite --config tests/e2e/vite.config.ts --port 5623 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5623',reuseExistingServer:false},
});
