import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI, env: { HARNESS_DATA_DIR: ".harness-e2e", HARNESS_TEST_MODE: "1" } },
  workers: 1
});
