import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";

const fixtureRoot = encodeURI("/@fs/" + process.cwd().replaceAll("\\", "/"));
const shots = "/tmp/gen-v1-journal/shots-1344";
mkdirSync(shots, { recursive: true });
const sha = (c: string) => c.repeat(64);
const entry = (name: string, kind = "file") => ({
	name,
	path: name,
	kind,
	bytes: 10,
});
const editableFile = (over: Record<string, unknown> = {}) => ({
	text: "alpha\nbeta\ngamma\n",
	binary: false,
	sha256: sha("a"),
	edit: { editable: true, bom: false, lineSeparator: "lf" },
	...over,
});
const saved = (digest = "b") => ({
	sha256: sha(digest),
	bytes: 16,
	checkpoint: "captured" as const,
});

async function fixture(page: Page, query = "") {
	await page.route("**/api/**", (route) =>
		route.fulfill({
			status: 404,
			json: { error: { message: "Unconfigured synthetic request" } },
		}),
	);
	await page.route("**/api/bootstrap", (route) =>
		route.fulfill({ json: { csrfToken: "synthetic-files" } }),
	);
	await page.route("**/files-editing-check*", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureRoot}/tests/e2e/files-reading-fixture.tsx');</script></body></html>`,
		}),
	);
	return () => page.goto("/files-editing-check" + query);
}
/** Route the Files surface endpoints; `fileBody` lets a test swap the disk copy. */
async function project(
	page: Page,
	{
		names = [entry("ok.txt"), entry("next.txt")],
		file = editableFile(),
		capability = { available: true, checkpoints: true } as Record<
			string,
			unknown
		>,
		saveStatus = 200,
	}: {
		names?: { name: string; path: string; kind: string; bytes: number }[];
		file?: Record<string, unknown>;
		capability?: Record<string, unknown>;
		saveStatus?: number;
	} = {},
) {
	const saves: Route[] = [];
	let fileBody = file;
	await page.route("**/api/projects/*/files?*", (route) =>
		route.fulfill({
			json: {
				entries: new URL(route.request().url()).searchParams.has("path")
					? []
					: names,
				truncated: false,
			},
		}),
	);
	await page.route("**/api/projects/*/file/edit-capability*", (route) =>
		route.fulfill({ json: capability }),
	);
	await page.route("**/api/projects/*/file/save*", (route) => {
		saves.push(route);
		if (saveStatus === 200) return route.fulfill({ json: saved("b") });
		return route.fulfill({
			status: 403,
			json: {
				error: {
					code: "PRECONDITION_FAILED",
					message: "File changed on disk.",
					details: { sha256: sha("c") },
				},
			},
		});
	});
	await page.route("**/api/projects/*/file?*", (route) =>
		route.fulfill({ json: fileBody }),
	);
	return {
		saves,
		setDisk: (next: Record<string, unknown>) => {
			fileBody = next;
		},
	};
}
const preview = (page: Page) =>
	page.getByRole("region", { name: "File content" });
const editButton = (page: Page) =>
	page.getByRole("button", { name: "Edit file", exact: false });

test("flow 1: Edit opens the editor, typing dirties, Ctrl+S saves and announces Saved", async ({
	page,
}) => {
	const requested: string[] = [];
	page.on("request", (request) => requested.push(request.url()));
	const go = await fixture(page);
	const { saves } = await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await expect(editButton(page)).toBeVisible();
	await page.screenshot({ path: `${shots}/t08-view-dark.png` });
	// Chunk loads only after Edit: no CodeMirror module request before click.
	expect(requested.filter((url) => /codemirror|lezer/i.test(url))).toEqual(
		[],
	);
	// Ctrl+S outside the editor does not save.
	await page.keyboard.press("Control+s");
	await page.waitForTimeout(300);
	expect(saves).toHaveLength(0);
	// Keyboard-only open: E on the focused preview.
	await page.locator(".files-preview").focus();
	await page.keyboard.press("e");
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	expect(
		requested.filter((url) => /codemirror|lezer/i.test(url)).length,
	).toBeGreaterThan(0);
	await page.locator(".cm-content").focus();
	await page.keyboard.press("End");
	await page.keyboard.type("delta");
	await expect(page.locator(".files-edit-dirty")).toContainText("Edited");
	await page.screenshot({ path: `${shots}/t08-editing-dirty-dark.png` });
	await page.keyboard.press("Control+s");
	await expect
		.poll(() => saves.length, { timeout: 4000 })
		.toBeGreaterThan(0);
	const body = saves[0]!.request().postDataJSON() as {
		path: string;
		text: string;
		expectedSha256: string;
	};
	expect(body.path).toBe("ok.txt");
	expect(body.expectedSha256).toBe(sha("a"));
	expect(body.text).toContain("delta");
	await expect(page.locator(".files-edit-saved")).toContainText("Saved");
	await expect(page.locator(".files-edit-announce")).toContainText("Saved");
});

test("conflict: stale save raises the bar; Compare shows both panes; Overwrite saves", async ({
	page,
}) => {
	const go = await fixture(page);
	const { setDisk } = await project(page, { saveStatus: 403 });
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await editButton(page).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	await page.locator(".cm-content").click();
	await page.keyboard.press("End");
	await page.keyboard.type("x");
	await page.keyboard.press("Control+s");
	await expect(page.locator(".files-edit-bar-conflict")).toContainText(
		"changed on disk",
	);
	await page.screenshot({ path: `${shots}/t08-conflict-dark.png` });
	await page.getByRole("button", { name: "Compare", exact: true }).click();
	await expect(page.locator(".files-compare-panes")).toBeVisible();
	await expect(page.locator(".files-compare-labels")).toContainText(
		"On disk",
	);
	await page.screenshot({ path: `${shots}/t08-compare-dark.png` });
	// Overwrite retries the save against the disk SHA the server reported.
	const { saves: retries } = await project(page);
	const overwrite = page.waitForResponse("**/api/projects/*/file/save*");
	await page.getByRole("button", { name: "Overwrite", exact: true }).click();
	await overwrite;
	const last = retries.at(-1)!.request().postDataJSON() as {
		expectedSha256: string;
	};
	expect(last.expectedSha256).toBe(sha("c"));
	await expect(page.locator(".files-edit-bar-conflict")).toHaveCount(0);
	void setDisk;
});

test("poll: clean editor reloads silently; dirty editor shows the conflict bar", async ({
	page,
}) => {
	test.slow();
	const go = await fixture(page);
	const { setDisk } = await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await editButton(page).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	// Clean: the disk copy changes under a clean editor → silent reload.
	setDisk(editableFile({ text: "alpha\nbeta\ngamma\nfresh\n", sha256: sha("d") }));
	await expect(page.locator(".cm-content")).toContainText("fresh", {
		timeout: 7000,
	});
	await expect(page.locator(".files-edit-bar-conflict")).toHaveCount(0);
	// Dirty: a second disk change must raise the conflict bar instead.
	await page.locator(".cm-content").click();
	await page.keyboard.press("End");
	await page.keyboard.type("mine");
	setDisk(
		editableFile({ text: "alpha\nbeta\ngamma\nfresh\nother\n", sha256: sha("e") }),
	);
	await expect(page.locator(".files-edit-bar-conflict")).toBeVisible({
		timeout: 7000,
	});
});

test("switching files while dirty asks first: Save / Don't save / Cancel", async ({
	page,
}) => {
	const go = await fixture(page);
	const { saves } = await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await editButton(page).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	await page.locator(".cm-content").click();
	await page.keyboard.type("draft");
	await page.getByRole("button", { name: "next.txt", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: /Save changes to ok\.txt/ }),
	).toBeVisible();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	// Don't save discards the draft and moves to the other file.
	await page.getByRole("button", { name: "next.txt", exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Don't save", exact: true })
		.click();
	await expect(preview(page)).toContainText("alpha");
	expect(saves).toHaveLength(0);
});

test("journal draft: unsaved edits restore after reload with the bar", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await editButton(page).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	await page.locator(".cm-content").click();
	await page.keyboard.type("restored-words");
	await page.waitForTimeout(700); // 500 ms journal debounce + flush slack
	await page.reload();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await editButton(page).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	await expect(page.locator(".files-edit-bar-info")).toContainText(
		"Restored unsaved changes",
	);
	await page.screenshot({ path: `${shots}/t08-restore-dark.png` });
	await expect(page.locator(".cm-content")).toContainText("restored-words");
});

test("disabled Edit shows the reason; capability off hides Edit entirely", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page, {
		file: editableFile({
			edit: {
				editable: false,
				reason: "protected",
				bom: false,
				lineSeparator: "lf",
			},
		}),
	});
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	const button = editButton(page);
	await expect(button).toBeVisible();
	await expect(button).toBeDisabled();
	await expect(button).toHaveAttribute("title", /protected/);
	// Capability unavailable: no Edit affordance, no capability-dependent calls.
	const go2 = await fixture(page);
	const { saves } = await project(page, {
		capability: { available: false, checkpoints: false, reason: "flag_off" },
	});
	await go2();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await expect(page.locator(".files-edit-open")).toHaveCount(0);
	await page.keyboard.press("e");
	await expect(page.locator(".gen-code-editor")).toHaveCount(0);
	await page.keyboard.press("Control+s");
	await page.waitForTimeout(300);
	expect(saves).toHaveLength(0);
});

test("reduced motion: bars animate with opacity only, no transforms", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const go = await fixture(page);
	await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await editButton(page).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	// §8.5: under reduced motion every bar/transform animation degrades to the
	// opacity-only keyframe at ≤ the press duration.
	const host = await page
		.locator(".files-edit-host")
		.evaluate((element) => getComputedStyle(element).animationDuration);
	expect(parseFloat(host)).toBeLessThanOrEqual(0.09);
	await page.locator(".cm-content").click();
	await page.keyboard.type("x");
	const dot = page.locator(".files-edit-toolbar .files-dirty-dot");
	await expect(dot).toBeVisible();
	const name = await dot.evaluate(
		(element) => getComputedStyle(element).animationName,
	);
	expect(name).toBe("files-toolbar-in");
});

test("narrow container collapses Done into More and keeps Save visible", async ({
	page,
}) => {
	const go = await fixture(page, "?width=420");
	await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await editButton(page).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	await expect(page.locator(".files-edit-done")).toBeHidden();
	await expect(page.locator(".files-edit-save")).toBeVisible();
	await page.locator(".files-edit-more > button").click();
	await page.getByRole("menuitem", { name: "Done" }).click();
	await expect(
		page.getByRole("dialog", { name: /Save changes|Leave/ }).or(editButton(page)),
	).toBeVisible();
	await page.screenshot({ path: `${shots}/t08-narrow-dark.png` });
});

test("light theme screenshots for the §8.3 table", async ({ page }) => {
	const go = await fixture(page);
	await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await page.evaluate(() => {
		document.documentElement.setAttribute("data-theme", "light");
	});
	await page.screenshot({ path: `${shots}/t08-view-light.png` });
	await editButton(page).click();
	await expect(page.locator(".gen-code-editor")).toBeVisible();
	await page.locator(".cm-content").click();
	await page.keyboard.type("light-check");
	await page.screenshot({ path: `${shots}/t08-editing-dirty-light.png` });
	await page.evaluate(() => {
		document.documentElement.removeAttribute("data-theme");
	});
});
