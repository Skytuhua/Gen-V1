import { defineConfig } from "@playwright/test";
import { rootBrowserSpecs } from "./scripts/browser-suites.ts";
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: rootBrowserSpecs,
  use: { baseURL: "http://127.0.0.1:5499", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  webServer: { command: "pnpm exec vite --config tests/e2e/vite.config.ts", url: "http://127.0.0.1:5499", reuseExistingServer: false },
  workers: 1,
  // 45 s contains the 30 s boot budget in tests/e2e/app-ready.ts (cold Vite module
  // graph plus the first snapshot render on a loaded runner); the rest is the test.
  timeout: 45_000
});
