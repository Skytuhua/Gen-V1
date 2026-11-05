import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
 testDir:'.',testMatch:['artifact-style.spec.ts','document-smoothness.spec.ts','conversation-scroll.spec.ts','frontend-refinement.spec.ts','canvas-clarity.spec.ts','no-detach-canvas.spec.ts','sidebar-compact.spec.ts','free-floating.spec.ts','floating-windows.spec.ts','reserved-rail.spec.ts','right-tools.spec.ts','context-compact.spec.ts','model-composer-refinement.spec.ts','drag-detach.spec.ts','composer-app-refinement.spec.ts'],
 outputDir:resolve('.harness-frontend-refinement/browser-artifacts'),workers:1,timeout:45000,
 use:{baseURL:'http://127.0.0.1:5377',channel:'msedge',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
 webServer:{command:'pnpm exec vite --host 127.0.0.1 --port 5377 --strictPort',cwd:resolve(import.meta.dirname,'../..'),url:'http://127.0.0.1:5377',reuseExistingServer:false},
});
