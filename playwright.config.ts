import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:5499", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  webServer: { command: "pnpm exec vite --config tests/e2e/vite.config.ts", url: "http://127.0.0.1:5499", reuseExistingServer: false },
  workers: 1
});
