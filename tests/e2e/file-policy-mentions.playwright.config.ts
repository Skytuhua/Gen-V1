import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
	testDir: ".",
	workers: 1,
	projects: [{ name: "file-policy-mentions", testMatch: "file-policy-mentions.spec.ts" }],
	timeout: 30_000,
	expect: { timeout: 3500 },
	outputDir:
		process.env.GEN_FILE_POLICY_OUTPUT ?? ".harness-file-policy-results",
	reporter: [
		["list"],
		[
			"json",
			{
				outputFile:
					process.env.GEN_FILE_POLICY_JSON ??
					".harness-file-policy-results/results.json",
			},
		],
	],
	use: {
		baseURL: "http://127.0.0.1:5818",
		channel: "chrome",
		headless: true,
		serviceWorkers: "block",
		viewport: { width: 1280, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"pnpm exec vite --config tests/e2e/file-policy-mentions.vite.config.ts --host 127.0.0.1 --port 5818 --strictPort",
		cwd: resolve(import.meta.dirname, "../.."),
		url: "http://127.0.0.1:5818",
		reuseExistingServer: false,
	},
});
