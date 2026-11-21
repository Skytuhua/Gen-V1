import { test, expect, type Page } from "@playwright/test";

const fixtureRoot = encodeURI("/@fs/" + process.cwd().replaceAll("\\", "/"));

async function fixture(page: Page, query = "") {
	await page.route("**/file-policy-check*", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureRoot}/tests/e2e/file-policy-mentions-fixture.tsx');</script></body></html>`,
		}),
	);
	return () => page.goto("/file-policy-check" + query);
}

test("default shipped rules hide denied names from suggestions", async ({ page }) => {
	const go = await fixture(page);
	await go();
	const suggestions = page.locator("[data-suggestion]");
	await expect(suggestions).toHaveCount(2);
	await expect(suggestions).toHaveText(["src/app.ts", "docs/notes.md"]);
});

test("custom project rules filter additional candidates", async ({ page }) => {
	const go = await fixture(page, "?project=" + encodeURIComponent("docs/**\n*.txt"));
	await go();
	const suggestions = page.locator("[data-suggestion]");
	await expect(suggestions).toHaveText(["src/app.ts"]);
});

test("allowed selection stages and sends; denied-after-save blocks and keeps the draft", async ({ page }) => {
	const go = await fixture(page);
	await go();
	await page.locator('[data-suggestion="src/app.ts"]').click();
	await page.locator('[data-suggestion="docs/notes.md"]').click();
	await page.locator('[data-testid="send"]').click();
	await expect(page.locator('[data-chip="src/app.ts"]')).toHaveCount(1);
	await expect(page.locator('[data-blocked-chip]')).toHaveCount(0);
	await page.locator('[data-suggestion="docs/notes.md"]').click();
	await page.locator('[data-testid="rules"]').fill("docs/**");
	await page.locator('[data-testid="send"]').click();
	await expect(page.locator('[data-blocked-chip="docs/notes.md"]')).toHaveCount(1);
	await expect(page.locator('[data-chip="docs/notes.md"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="draft"]')).toHaveValue("check the config");
});
