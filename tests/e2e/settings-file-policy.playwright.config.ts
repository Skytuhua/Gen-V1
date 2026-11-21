import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
	testDir: ".",
	workers: 1,
	projects: [
		{ name: "settings-file-policy", testMatch: "settings-file-policy.spec.ts" },
	],
	timeout: 30_000,
	expect: { timeout: 3500 },
	outputDir:
		process.env.GEN_SETTINGS_POLICY_OUTPUT ??
		".harness-settings-policy-results",
	reporter: [
		["list"],
		[
			"json",
			{
				outputFile:
					process.env.GEN_SETTINGS_POLICY_JSON ??
					".harness-settings-policy-results/results.json",
			},
		],
	],
	use: {
		baseURL: "http://127.0.0.1:5820",
		channel: "chrome",
		headless: true,
		serviceWorkers: "block",
		viewport: { width: 1280, height: 900 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command:
			"pnpm exec vite --config tests/e2e/settings-file-policy.vite.config.ts --host 127.0.0.1 --port 5820 --strictPort",
		cwd: resolve(import.meta.dirname, "../.."),
		url: "http://127.0.0.1:5820",
		reuseExistingServer: false,
	},
});
