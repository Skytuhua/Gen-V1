import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: ".",
  testMatch: "plan-timeline.spec.ts",
  workers: 1,
  timeout: 20000,
  outputDir: process.env.PLANUI_EVIDENCE_DIR ?? resolve(".harness-ui-shell/plan-timeline"),
  use: {
    baseURL: "http://127.0.0.1:5637",
    channel: "msedge",
    viewport: { width: 1000, height: 780 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --config tests/e2e/plan-timeline.vite.config.ts",
    cwd: resolve(import.meta.dirname, "../.."),
    url: "http://127.0.0.1:5637/plan-timeline.html",
    reuseExistingServer: false,
  },
});
