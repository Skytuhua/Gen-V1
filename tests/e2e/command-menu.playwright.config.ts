import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Explicit API fixtures like shell.playwright.config.ts; a dedicated Vite port
// avoids stopping another worker's development server.
export default defineConfig({
  testDir: '.', testMatch: 'command-menu.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5197', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5197 --strictPort', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:5197', reuseExistingServer: false },
});
