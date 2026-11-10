import {defineConfig} from '@playwright/test';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// These synthetic UI tests never use the owner host or company credentials.
const evidence = process.env.GEN_COMPANY_UI_EVIDENCE ?? 'D:/GenCompanyInterfaceVerification/20261104';
export default defineConfig({
  testDir: '.', testMatch: ['company-mode.spec.ts', 'company-manager.spec.ts'], workers: 1,
  outputDir: path.join(evidence, 'test-results'),
  reporter: [['list'], ['json', {outputFile: path.join(evidence, 'playwright-results.json')}]],
  use: {baseURL: 'http://127.0.0.1:5507', channel: 'chrome', viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure'},
  webServer: {command: 'pnpm exec vite --config tests/e2e/vite.config.ts --port 5507', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:5507', reuseExistingServer: false},
});
