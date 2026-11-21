import { test, expect, type Page } from "@playwright/test";
import { AGENT_FILE_POLICY_DEFAULTS } from "../../packages/contracts/agent-file-policy";

const fixtureRoot = encodeURI("/@fs/" + process.cwd().replaceAll("\\", "/"));

interface ScopeState { revision: number; rules: string[] }

async function fixture(page: Page, options: { conflictOnce?: boolean } = {}) {
	const policies: Record<string, ScopeState> = {
		global: { revision: 1, rules: [".env", "secrets/**"] },
		"project:alpha": { revision: 3, rules: ["alpha/**"] },
	};
	let conflictOnce = options.conflictOnce ?? false;
	await page.route("**/api/bootstrap", (route) =>
		route.fulfill({ contentType: "application/json", body: JSON.stringify({ csrfToken: "fixture" }) }));
	await page.route("**/api/agent-file-policy*", (route) => {
		const request = route.request();
		if (request.method() === "GET") {
			const scope = new URL(request.url()).searchParams.get("scope") ?? "global";
			const state = policies[scope] ?? { revision: 0, rules: [] };
			return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...state, explicit: true }) });
		}
		const body = request.postDataJSON() as { scope: string; baseRevision: number; rulesText: string };
		const state = policies[body.scope] ?? { revision: 0, rules: [] };
		if (conflictOnce || body.baseRevision !== state.revision) {
			conflictOnce = false;
			state.revision += 1;
			state.rules = ["latest/**"];
			return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "AGENT_FILE_POLICY_CHANGED", message: "changed" } }) });
		}
		state.revision += 1;
		state.rules = body.rulesText.split("\n").filter(Boolean);
		return route.fulfill({ contentType: "application/json", body: JSON.stringify({ scope: body.scope, revision: state.revision }) });
	});
	await page.route("**/settings-policy-check*", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureRoot}/tests/e2e/settings-file-policy-fixture.tsx');</script></body></html>`,
		}));
	await page.goto("/settings-policy-check");
	await expect(page.getByText("Agent file protection")).toBeVisible();
	return policies;
}

const editor = (page: Page) => page.locator(".afp-editor textarea");
const pickScope = async (page: Page, label: string) => {
	await page.getByLabel("Rules scope").click();
	await page.getByRole("option", { name: label }).click();
};

test("global scope shows default rules; dirty scope switch requires a choice", async ({ page }) => {
	await fixture(page);
	await expect(editor(page)).toHaveValue(".env\nsecrets/**");
	await editor(page).fill(".env\nsecrets/**\ndocs/**");
	await pickScope(page, "Alpha project");
	await expect(page.getByText("Unsaved rule changes")).toBeVisible();
	await page.locator(".dialog-actions").getByRole("button", { name: "Discard changes" }).click();
	await expect(editor(page)).toHaveValue("alpha/**");
	await expect(page.getByText("Inherited from all local projects")).toBeVisible();
	await expect(page.locator(".afp-inherited code").first()).toHaveText(".env");
});

test("keyboard-only scope switch works and a clean switch never prompts", async ({ page }) => {
	await fixture(page);
	await page.getByLabel("Rules scope").focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(editor(page)).toHaveValue("alpha/**");
	await expect(page.getByText("Unsaved rule changes")).toHaveCount(0);
});

test("conflict keeps the draft and reload adopts the newer revision", async ({ page }) => {
	await fixture(page, { conflictOnce: true });
	await editor(page).fill("conflict/**");
	await page.getByRole("button", { name: "Save rules" }).click();
	await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
	await expect(editor(page)).toHaveValue("conflict/**");
	await page.getByRole("button", { name: "Reload" }).click();
	await expect(editor(page)).toHaveValue("latest/**");
});

test("invalid lines report errors; reset defaults restores shipped rules", async ({ page }) => {
	await fixture(page);
	await editor(page).fill("..");
	await page.getByRole("button", { name: "Save rules" }).click();
	await expect(editor(page)).toHaveAttribute("aria-invalid", "true");
	await expect(page.locator(".afp-errors li").first()).toContainText("Line 1");
	await page.getByRole("button", { name: "Reset defaults" }).click();
	await expect(editor(page)).toHaveValue(AGENT_FILE_POLICY_DEFAULTS.join("\n"));
	await expect(page.locator(".afp-status")).toContainText("Rules saved.");
});
