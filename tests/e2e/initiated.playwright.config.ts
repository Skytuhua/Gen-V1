import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({ testDir: '.', testMatch: ['proactive-copy.spec.ts'], workers: 1,
  use: { baseURL: 'http://127.0.0.1:5205', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5205 --strictPort', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:5205', reuseExistingServer: false },
});
