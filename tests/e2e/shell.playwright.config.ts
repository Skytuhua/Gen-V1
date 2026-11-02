import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// API and widget routes in frontend.spec.ts are explicit protocol fixtures.
// A dedicated Vite port avoids stopping another worker's development server.
export default defineConfig({
  testDir: '.', testMatch: 'frontend.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5198', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5198 --strictPort', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:5198', reuseExistingServer: false },
});
