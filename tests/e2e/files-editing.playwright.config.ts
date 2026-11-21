import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
	testDir: ".",
	testMatch: "files-editing.spec.ts",
	workers: 1,
	timeout: 30_000,
	expect: { timeout: 4000 },
	outputDir: ".harness-files-editing-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5811",
		browserName: "chromium",
		headless: true,
		serviceWorkers: "block",
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
		screenshot: "on",
		video: "on",
	},
	webServer: process.env.GEN_FILES_EDITING_EXTERNAL === '1' ? undefined : {
		command:
			(process.platform === "win32" ? "" : "exec timeout --kill-after=5s 300s ") + "pnpm exec vite --config tests/e2e/files-editing.vite.config.ts --host 127.0.0.1 --port 5811 --strictPort",
		cwd: resolve(import.meta.dirname, "../.."),
		url: "http://127.0.0.1:5811",
		reuseExistingServer: false,
	},
});
