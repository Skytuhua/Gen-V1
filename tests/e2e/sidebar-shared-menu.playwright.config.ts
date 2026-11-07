import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';

export default defineConfig({
  testDir: '.', workers: 1, timeout: 30_000, expect: {timeout: 7_000},
  projects: [
    {name: 'sidebar-menu', testMatch: ['sidebar-shared-menu.spec.ts', 'sidebar-compact.spec.ts']},
    {name: 'caller-handoff', timeout: 45_000, expect: {timeout: 20_000}, testMatch: ['composer-app-refinement.spec.ts', 'frontend.spec.ts', 'workspace-host.spec.ts'],
      grep: /chat header omits retired|sidebar presentation, ordering|dirty widgets require a checkpoint|monitor preserves unpin|monitor honors disabled archive|Settings close waits for an accepted preference|Custom sidebar offers/},
  ],
  outputDir: process.env.GEN_SIDEBAR_MENU_OUTPUT ?? '.harness-sidebar-menu-results',
  use: {baseURL: 'http://127.0.0.1:5804', channel: 'chrome', headless: true, serviceWorkers: 'block', viewport: {width: 1280, height: 800}, trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/sidebar-shared-menu.vite.config.ts --host 127.0.0.1 --port 5804 --strictPort', cwd: resolve(import.meta.dirname, '../..'), url: 'http://127.0.0.1:5804', reuseExistingServer: false},
});
