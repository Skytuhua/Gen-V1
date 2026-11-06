import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
export default defineConfig({
 testDir: '.', testMatch: 'agents-workspace.spec.ts', workers: 1, timeout: 20000,
 outputDir: process.env.AGENTSUI_EVIDENCE_DIR ?? resolve('.harness-ui-shell/agents-workspace'),
 use: {baseURL: 'http://127.0.0.1:5636', channel: 'msedge', viewport: {width: 1440, height: 900}, trace: 'retain-on-failure'},
 webServer: {command: 'pnpm exec vite --config tests/e2e/agents-workspace.vite.config.ts --port 5636 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5636', reuseExistingServer: false},
});
