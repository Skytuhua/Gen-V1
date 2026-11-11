import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
	testDir: ".",
	workers: 1,
	projects: [
		{ name: "files-reading", testMatch: "files-reading.spec.ts" },
		{
			name: "files-shared-panels",
			testMatch: "shared-panels.spec.ts",
			grep: /directory navigation rejects a file response/,
		},
		{
			name: "files-grant-select",
			testMatch: "ui-shell-controls.spec.ts",
			grep: /actual resource selector/,
		},
		{
			name: "files-host-binding",
			testMatch: "workspace-host.spec.ts",
			grep: /Custom arranges Terminal below Files/,
		},
		{
			name: "files-frontend-snapshot",
			testMatch: "frontend.spec.ts",
			grep: /workspace files, diffs and executor output show actual scoped snapshot evidence/,
		},
	],
	timeout: 30_000,
	expect: { timeout: 3500 },
	outputDir:
		process.env.GEN_FILES_READING_OUTPUT ?? ".harness-files-reading-results",
	reporter: [
		["list"],
		[
			"json",
			{
				outputFile:
					process.env.GEN_FILES_READING_JSON ??
					".harness-files-reading-results/results.json",
			},
		],
	],
	use: {
		baseURL: "http://127.0.0.1:5810",
		channel: "chrome",
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
