import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.', testMatch: ['task-interface.spec.ts', 'artifact-style.spec.ts'], workers: 1,
  use: { baseURL: 'http://127.0.0.1:5188', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5188 --strictPort', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:5188', reuseExistingServer: false },
});
