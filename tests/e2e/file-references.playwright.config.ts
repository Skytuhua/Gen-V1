import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
	testDir: ".",
	workers: 1,
	projects: [{ name: "file-references", testMatch: "file-references.spec.ts" }],
	timeout: 30_000,
	expect: { timeout: 3500 },
	outputDir: ".harness-file-references-results",
	reporter: [["list"]],
	use: {
		baseURL: "http://127.0.0.1:5810",
		headless: true,
		serviceWorkers: "block",
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"pnpm exec vite --config tests/e2e/files-reading.vite.config.ts --host 127.0.0.1 --port 5810 --strictPort",
		cwd: resolve(import.meta.dirname, "../.."),
		url: "http://127.0.0.1:5810",
		reuseExistingServer: false,
	},
});
