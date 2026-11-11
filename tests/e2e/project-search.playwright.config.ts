import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
	testDir: ".",
	testMatch: "project-search.spec.ts",
	workers: 1,
	timeout: 30_000,
	expect: { timeout: 4000 },
	outputDir: "/tmp/gen-wo5-project-search-results",
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:5521",
		browserName: "chromium",
		headless: true,
		serviceWorkers: "block",
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"pnpm exec vite --configLoader runner --config tests/e2e/project-search.vite.config.ts",
		cwd: resolve(import.meta.dirname, "../.."),
		url: "http://127.0.0.1:5521",
		reuseExistingServer: false,
	},
});
