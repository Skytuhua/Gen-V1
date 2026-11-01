import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.', testMatch: ['progressive-fidelity.spec.ts', 'graph-fidelity.spec.ts', 'signing-fidelity.spec.ts'], workers: 1,
  use: { baseURL: 'http://127.0.0.1:5199', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5199 --strictPort', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:5199', reuseExistingServer: false },
});
