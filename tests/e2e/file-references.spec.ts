import { test, expect, type Page } from "@playwright/test";

const fixtureRoot = encodeURI("/@fs/" + process.cwd().replaceAll("\\", "/"));
const entry = (name: string, path: string, kind = "file", bytes = 10) => ({ name, path, kind, bytes });
const text = (value = "line1\nline2\nline3\nline4\nline5") => ({ text: value, binary: false, sha256: "a".repeat(64) });

const folders: Record<string, { name: string; kind: string; bytes: number }[]> = {
	"": [entry("src", "src", "directory", 0), entry("docs", "docs", "directory", 0), entry("package.json", "package.json")],
	src: [entry("a.ts", "src/a.ts"), entry("b.ts", "src/b.ts"), entry("big.ts", "src/big.ts"), entry("bin.dat", "src/bin.dat")],
	docs: [entry("readme.md", "docs/readme.md")],
};

async function fixture(page: Page, query = "") {
	const hits: string[] = [];
	await page.route("**/api/**", (route) =>
		route.fulfill({ status: 404, json: { error: { message: "Unconfigured synthetic request" } } }),
	);
	await page.route("**/api/bootstrap", (route) =>
		route.fulfill({ json: { csrfToken: "synthetic-file-refs" } }),
	);
	await page.route("**/files-reading-check*", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureRoot}/tests/e2e/files-reading-fixture.tsx');</script></body></html>`,
		}),
	);
	await page.route("**/api/projects/*/files?*", (route) => {
		const url = new URL(route.request().url());
		const folder = url.searchParams.get("path") ?? "";
		hits.push(folder);
		route.fulfill({ json: { entries: folders[folder] ?? [] } });
	});
	await page.route("**/api/projects/*/file?*", (route) => {
		const url = new URL(route.request().url());
		const path = url.searchParams.get("path") ?? "";
		if (path === "src/bin.dat") return route.fulfill({ json: { text: null, binary: true, sha256: "b".repeat(64) } });
		return route.fulfill({ json: text() });
	});
	await page.route("**/api/projects/*/search?*", (route) =>
		route.fulfill({ json: { available: false, matches: [] } }),
	);
	return { open: () => page.goto("/files-reading-check" + query), hits };
}

const link = (page: Page, name: string) => page.getByRole("button", { name });

test("code span and plain references link after verification and reveal the line", async ({ page }) => {
	const { open, hits } = await fixture(page, "?refs");
	await open();
	const codeRef = link(page, "Open src/a.ts at line 3 in Files");
	const plainRef = link(page, "Open docs/readme.md in Files");
	await expect(codeRef).toBeVisible();
	await expect(plainRef).toBeVisible();
	await expect(page.locator(".files-message", { hasText: "Line 3" })).toHaveCount(0);
	// Verification requests one listing per folder before the click.
	expect(hits.filter((folder) => folder === "src").length).toBe(1);
	await codeRef.click();
	await expect(page.locator(".files-message", { hasText: "Line 3" })).toBeVisible();
	await expect(page.locator("mark.files-reveal-line", { hasText: "line3" })).toBeVisible();
	await expect(page.getByTestId("reveal-handled")).toHaveText("handled:1");
});

test("references in one folder share a single listing request", async ({ page }) => {
	const { open, hits } = await fixture(page, "?refs&reply=" + encodeURIComponent("See `src/a.ts` then `src/b.ts` and `src/big.ts` too."));
	await open();
	await expect(link(page, "Open src/a.ts in Files")).toBeVisible();
	await expect(link(page, "Open src/b.ts in Files")).toBeVisible();
	await expect(link(page, "Open src/big.ts in Files")).toBeVisible();
	expect(hits.filter((folder) => folder === "src").length).toBe(1);
});

test("past-EOF line reports a status instead of highlighting", async ({ page }) => {
	const { open } = await fixture(page, "?refs&reply=" + encodeURIComponent("Check `src/big.ts:99`."));
	await open();
	await link(page, "Open src/big.ts at line 99 in Files").click();
	await expect(page.getByRole("status").filter({ hasText: "Line 99 is past the end of this file." })).toBeVisible();
	await expect(page.locator("mark.files-reveal-line")).toHaveCount(0);
});

test("binary files ignore the requested line", async ({ page }) => {
	const { open } = await fixture(page, "?refs&reply=" + encodeURIComponent("Check `src/bin.dat:2`."));
	await open();
	await link(page, "Open src/bin.dat at line 2 in Files").click();
	await expect(page.getByText("Binary file; no text preview.")).toBeVisible();
	await expect(page.locator(".files-message", { hasText: "Line 2" })).toHaveCount(0);
});

test("rejected candidates stay plain and trigger no folder requests", async ({ page }) => {
	const { open, hits } = await fixture(page, "?refs&reply=" + encodeURIComponent("Look at /etc/hosts and https://x.dev/a.ts and ../up.ts and C:/win/f.ts and a\\b.ts."));
	await open();
	await page.waitForTimeout(400);
	expect(hits.filter((folder) => folder !== "").length).toBe(0);
	await expect(page.locator(".markdown-file-ref")).toHaveCount(0);
});

test("references without a project context stay plain", async ({ page }) => {
	const { open, hits } = await fixture(page);
	await open();
	await page.waitForTimeout(400);
	await expect(page.locator(".markdown-file-ref")).toHaveCount(0);
	expect(hits.filter((folder) => folder === "src").length).toBe(0);
});

test("absent and denied files never become links", async ({ page }) => {
	const { open } = await fixture(page, "?refs&reply=" + encodeURIComponent("See `src/missing.ts` here."));
	await open();
	await expect(link(page, "Open src/missing.ts in Files")).toHaveCount(0);
});

test("offscreen references are not verified until near the viewport", async ({ page }) => {
	const { open, hits } = await fixture(page, "?refs&tall");
	await open();
	await page.waitForTimeout(400);
	expect(hits.filter((folder) => folder === "src").length).toBe(0);
	await page.getByTestId("reply-scroll").evaluate((node) => node.scrollTo(0, 800));
	await expect(link(page, "Open src/a.ts at line 3 in Files")).toBeVisible();
	expect(hits.filter((folder) => folder === "src").length).toBe(1);
});

test("keyboard focus and Enter opens the reference", async ({ page }) => {
	const { open } = await fixture(page, "?refs");
	await open();
	const codeRef = link(page, "Open src/a.ts at line 3 in Files");
	await expect(codeRef).toBeVisible();
	await codeRef.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".files-message", { hasText: "Line 3" })).toBeVisible();
});

test("a second reveal re-reads and selecting another file clears the line", async ({ page }) => {
	const { open } = await fixture(page, "?refs");
	await open();
	const codeRef = link(page, "Open src/a.ts at line 3 in Files");
	await codeRef.click();
	await expect(page.locator("mark.files-reveal-line")).toBeVisible();
	await page.getByTestId("files-owner").getByRole("button", { name: "b.ts" }).click();
	await expect(page.locator("mark.files-reveal-line")).toHaveCount(0);
	await codeRef.click();
	await expect(page.locator(".files-message", { hasText: "Line 3" })).toBeVisible();
	await expect(page.getByTestId("reveal-handled")).toHaveText("handled:2");
});

test("reveals deliver only to the targeted panel", async ({ page }) => {
	const { open } = await fixture(page, "?refs&two&panel=files-b");
	await open();
	await link(page, "Open src/a.ts at line 3 in Files").click();
	const surfaces = page.locator(".files-surface");
	await expect(surfaces.nth(1).locator(".files-message", { hasText: "Line 3" })).toBeVisible();
	await expect(surfaces.nth(0)).toContainText("Choose a file");
});

test("reduced motion drops the reveal pulse", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const { open } = await fixture(page, "?refs");
	await open();
	await link(page, "Open src/a.ts at line 3 in Files").click();
	const mark = page.locator("mark.files-reveal-line");
	await expect(mark).toBeVisible();
	expect(await mark.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
});
