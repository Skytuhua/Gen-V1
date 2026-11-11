import { expect, test, type Page } from "@playwright/test";

const fixtureRoot = encodeURI("/@fs/" + process.cwd().replaceAll("\\", "/"));
const search = (page: Page) =>
	page.getByRole("searchbox", { name: "Search project" });
const hits = (page: Page) => page.locator(".project-search-hit");
const preview = (page: Page) =>
	page.getByRole("region", { name: "File content" });
async function fixture(page: Page, query = "") {
	await page.route("**/api/**", (route) =>
		route.fulfill({
			status: 404,
			json: { error: { message: "Unconfigured synthetic request" } },
		}),
	);
	await page.route("**/api/bootstrap", (route) =>
		route.fulfill({ json: { csrfToken: "synthetic-search" } }),
	);
	await page.route("**/api/projects/*/files?*", (route) =>
		route.fulfill({
			json: {
				entries: new URL(route.request().url()).searchParams.has("path")
					? []
					: [
							{ name: "src", path: "src", kind: "directory" },
							{ name: "README.md", path: "README.md", kind: "file", bytes: 48 },
							{
								name: "workspace.test.ts",
								path: "workspace.test.ts",
								kind: "file",
								bytes: 1024,
							},
						],
			},
		}),
	);
	await page.route("**/api/projects/*/file?*", (route) => {
		const path = new URL(route.request().url()).searchParams.get("path"),
			line = path === "docs/README.md" ? 12 : 48;
		return route.fulfill({
			json: {
				text: Array.from({ length: 100 }, (_, index) =>
					index === line - 1
						? "const workspace = restoreLayout();"
						: `// File line ${index + 1}`,
				).join("\n"),
				binary: false,
				sha256: (query.includes("state=stale") ? "b" : "a").repeat(64),
			},
		});
	});
	await page.route("**/api/resources/*/tree*", (route) =>
		route.fulfill({
			json: {
				path: "",
				entries: [{ name: "granted.txt", path: "granted.txt", kind: "file" }],
				truncated: false,
			},
		}),
	);
	await page.route("**/api/resources/*/content*", (route) =>
		route.fulfill({ contentType: "text/plain", body: "Granted content" }),
	);
	await page.route("**/project-search-check*", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureRoot}/tests/e2e/project-search-fixture.tsx');</script></body></html>`,
		}),
	);
	await page.goto("/project-search-check" + query);
	await page
		.getByRole("button", {
			name: query.includes("granted=1") ? "Refresh granted files" : "Refresh",
			exact: true,
		})
		.waitFor();
}
async function projectScope(page: Page, q = "workspace") {
	await page.getByRole("combobox", { name: "Search scope" }).click();
	await page.getByRole("option", { name: "Project", exact: true }).click();
	await search(page).fill(q);
}
async function settled(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
}

test("production keeps the fast folder filter and exposes Project unavailable", async ({
	page,
}) => {
	const requests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/")) requests.push(request.url());
	});
	await fixture(page, "?unavailable=1");
	await page
		.getByRole("searchbox", { name: "Filter this folder" })
		.fill("README");
	await expect(
		page.getByRole("button", { name: "README.md", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "workspace.test.ts", exact: true }),
	).toHaveCount(0);
	await page.getByRole("combobox", { name: "Search scope" }).click();
	await expect(
		page.getByRole("option", { name: "Project (unavailable)" }),
	).toBeDisabled();
	expect(requests.filter((url) => url.includes("/search"))).toEqual([]);
	expect(
		await page.evaluate(() => window.projectSearchFixture.requests.length),
	).toBe(0);
});

test("folder/project scopes keep path and text hits distinct and open a matching line", async ({
	page,
}) => {
	await fixture(page);
	await page.getByRole("button", { name: "src", exact: true }).click();
	await expect(page.getByText("This folder is empty.")).toBeVisible();
	await projectScope(page);
	await expect(hits(page)).toHaveCount(3);
	await expect(hits(page).nth(2)).toContainText("File name");
	await hits(page).first().click();
	await expect(preview(page)).toContainText("Matching line 48");
	await expect(page.locator(".files-matching-line")).toHaveText(
		"const workspace = restoreLayout();",
	);
	const text = await preview(page).locator("pre").textContent();
	expect(text?.split("\n")).toHaveLength(100);
	expect(text?.split("\n")[47]).toBe("const workspace = restoreLayout();");
	const request = await page.evaluate(
		() => window.projectSearchFixture.requests[0],
	);
	expect(request).toEqual({
		owner: { projectId: "project-one", threadId: "task-thread" },
		q: "workspace",
		limit: 100,
	});
	await page.getByRole("combobox", { name: "Search scope" }).click();
	await page.getByRole("option", { name: "This folder", exact: true }).click();
	await expect(
		page.getByRole("searchbox", { name: "Filter this folder" }),
	).toBeVisible();
});

test("keyboard-only scope selection, result navigation, line preview and Escape focus", async ({
	page,
}) => {
	await fixture(page);
	const scope = page.getByRole("combobox", { name: "Search scope" });
	await scope.focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(scope).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(search(page)).toBeFocused();
	await page.keyboard.type("workspace");
	await expect(hits(page)).toHaveCount(3);
	await page.keyboard.press("ArrowDown");
	await expect(hits(page).first()).toBeFocused();
	await page.keyboard.press("End");
	await expect(hits(page).last()).toBeFocused();
	await page.keyboard.press("Home");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Escape");
	await expect(search(page)).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await expect(preview(page)).toBeFocused();
	await expect(page.locator(".files-matching-line")).toBeVisible();
});

test("IME does not submit partial composition or treat composing keys as navigation", async ({
	page,
}) => {
	await fixture(page);
	await projectScope(page, "");
	await search(page).dispatchEvent("compositionstart");
	await search(page).fill("workspace");
	await search(page).dispatchEvent("keydown", {
		key: "ArrowDown",
		isComposing: true,
	});
	await expect(search(page)).toBeFocused();
	expect(
		await page.evaluate(() => window.projectSearchFixture.requests.length),
	).toBe(0);
	await search(page).dispatchEvent("compositionend");
	await expect(hits(page)).toHaveCount(3);
});

test("empty, failed and retry states are actionable", async ({ page }) => {
	await fixture(page, "?state=empty");
	await projectScope(page);
	await expect(
		page.getByText("No results in this project.", { exact: false }),
	).toBeVisible();
	await fixture(page, "?state=error");
	await projectScope(page);
	await expect(page.getByRole("alert")).toContainText("could not be read");
	await page.getByRole("button", { name: "Retry search" }).click();
	await expect(hits(page)).toHaveCount(3);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("overlong queries are bounded and blank queries cancel without a request", async ({
	page,
}) => {
	await fixture(page);
	await projectScope(page, "x".repeat(201));
	await expect(page.getByRole("alert")).toContainText("200");
	expect(
		await page.evaluate(() => window.projectSearchFixture.requests.length),
	).toBe(0);
	await search(page).fill("   ");
	await expect(hits(page)).toHaveCount(0);
	expect(
		await page.evaluate(() => window.projectSearchFixture.requests.length),
	).toBe(0);
});

test("loading and refresh retain accepted results while requests are held", async ({
	page,
}) => {
	await fixture(page, "?state=loading");
	await projectScope(page);
	await expect(page.getByRole("status")).toContainText("Searching project");
	await expect(hits(page)).toHaveCount(0);
	await page.evaluate(() => {
		window.projectSearchFixture.hold = false;
		window.projectSearchFixture.release(0);
	});
	await expect(hits(page)).toHaveCount(3);
	await page.evaluate(() => {
		window.projectSearchFixture.hold = true;
	});
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(page.getByRole("status")).toContainText("Refreshing results");
	await expect(hits(page)).toHaveCount(3);
	await page.evaluate(() => window.projectSearchFixture.release(1));
	await expect(page.getByRole("status")).toContainText("3 results");
});

for (const late of ["success", "error"])
	test(`query changes fence a late ${late} even if the adapter ignores abort`, async ({
		page,
	}) => {
		await fixture(page, "?state=loading");
		await projectScope(page, "old query");
		await expect
			.poll(() =>
				page.evaluate(() => window.projectSearchFixture.pending.length),
			)
			.toBe(1);
		await search(page).fill("new query");
		await expect
			.poll(() =>
				page.evaluate(() => window.projectSearchFixture.pending.length),
			)
			.toBe(2);
		await page.evaluate(() => window.projectSearchFixture.release(1));
		await expect(hits(page)).toHaveCount(3);
		await page.evaluate(
			(fail) => window.projectSearchFixture.release(0, fail),
			late === "error",
		);
		await settled(page);
		await expect(hits(page)).toHaveCount(3);
		await expect(page.getByRole("alert")).toHaveCount(0);
		expect(
			await page.evaluate(
				() => window.projectSearchFixture.pending[0].signal.aborted,
			),
		).toBe(true);
	});

for (const change of ["project", "thread"])
	test(`owner ${change} changes cancel search and selected file reads`, async ({
		page,
	}) => {
		await fixture(page, "?state=loading");
		await projectScope(page);
		await expect
			.poll(() =>
				page.evaluate(() => window.projectSearchFixture.pending.length),
			)
			.toBe(1);
		await page.getByRole("button", { name: `Switch ${change}` }).click();
		await page.evaluate(() => window.projectSearchFixture.release(0));
		await settled(page);
		await expect(hits(page)).toHaveCount(0);
		await expect(page.getByRole("alert")).toHaveCount(0);
		await page.evaluate(() => {
			window.projectSearchFixture.hold = false;
		});
		await projectScope(page);
		await expect(hits(page)).toHaveCount(3);
		const owner = await page.evaluate(
			() => window.projectSearchFixture.requests.at(-1)!.owner,
		);
		expect(owner).toEqual({
			projectId: change === "project" ? "project-two" : "project-one",
			threadId: change === "thread" ? "other-thread" : "task-thread",
		});
	});

test("deactivation rejects held results until the owner is active again", async ({
	page,
}) => {
	await fixture(page, "?state=loading");
	await projectScope(page);
	await page.getByRole("button", { name: "Toggle active" }).click();
	await page.evaluate(() => window.projectSearchFixture.release(0));
	await settled(page);
	await expect(hits(page)).toHaveCount(0);
	await expect(page.getByRole("status")).toContainText("paused");
	await page.evaluate(() => {
		window.projectSearchFixture.hold = false;
	});
	await page.getByRole("button", { name: "Toggle active" }).click();
	await expect(hits(page)).toHaveCount(3);
});

test("partial pages retain exclusions, scan errors and limits", async ({
	page,
}) => {
	await fixture(page, "?state=partial");
	await projectScope(page);
	await expect(hits(page)).toHaveCount(2);
	await expect(page.getByRole("status")).toContainText("Incomplete");
	await page.getByText("Search details", { exact: false }).click();
	for (const text of [
		"private: unreadable",
		"protected host storage",
		"assets/logo.png: binary",
		"file limit",
		"10,000 files",
		"1000 matches",
		"More issues were omitted",
	])
		await expect(page.locator(".project-search-details")).toContainText(text);
	await page.getByRole("button", { name: "Load more results" }).click();
	await expect(hits(page)).toHaveCount(3);
	await expect(page.getByRole("status")).toContainText("Incomplete");
});

test("paged results complete without duplication; refresh restarts from the first page", async ({
	page,
}) => {
	await fixture(page, "?state=paged");
	await projectScope(page);
	await page.getByRole("button", { name: "Load more results" }).click();
	await expect(hits(page)).toHaveCount(3);
	await expect(page.getByRole("status")).not.toContainText("Incomplete");
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(hits(page)).toHaveCount(2);
	expect(
		await page.evaluate(() =>
			window.projectSearchFixture.requests.map((request) => request.cursor),
		),
	).toEqual([undefined, "fixture-page-2", undefined]);
});

test("the client cap reports incomplete final results without a continuation cursor", async ({
	page,
}, testInfo) => {
	await fixture(page, "?state=loading");
	await projectScope(page);
	for (let index = 0; index < 11; index++) {
		await expect
			.poll(() =>
				page.evaluate(() => window.projectSearchFixture.pending.length),
			)
			.toBe(index + 1);
		await page.evaluate((pageIndex) => {
			const pending = window.projectSearchFixture.pending[pageIndex];
			pending.resolve({
				owner: {
					...pending.request.owner,
					workingCopyId: "copy",
					binding: "b".repeat(64),
				},
				matches: Array.from(
					{ length: pageIndex === 9 ? 50 : 100 },
					(_, matchIndex) => ({
						path: `file-${pageIndex}-${matchIndex}.txt`,
						kind: "path",
						line: null,
						column: null,
						preview: "workspace",
						sha256: "a".repeat(64),
					}),
				),
				nextCursor: pageIndex === 10 ? null : `page-${pageIndex + 1}`,
				complete: true,
				exclusions: [],
				issues: [],
				issuesTruncated: false,
				limits: {
					files: 10000,
					bytes: 33554432,
					matches: 1000,
					timeoutMs: 2000,
					fileBytes: 1048576,
				},
			});
		}, index);
		if (index < 10)
			await page.getByRole("button", { name: "Load more results" }).click();
	}
	await expect(hits(page)).toHaveCount(1000);
	await expect(page.getByRole("status")).toContainText("Incomplete results");
	await expect(
		page.getByText("Showing 1,000 results.", { exact: false }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Load more results" }),
	).toHaveCount(0);
	await expect(
		page.getByText("Results are incomplete.", { exact: false }),
	).not.toContainText("Load more");
	await page
		.getByText("Showing 1,000 results.", { exact: false })
		.scrollIntoViewIfNeeded();
	await page.screenshot({
		path: testInfo.outputPath("1-after-cap-1440.png"),
		fullPage: true,
	});
});

for (const state of ["expired", "binding", "wrong-owner"])
	test(`${state} results fail visibly and cannot replace accepted matches`, async ({
		page,
	}) => {
		await fixture(page, `?state=${state}`);
		await projectScope(page);
		if (state !== "wrong-owner")
			await page.getByRole("button", { name: "Load more results" }).click();
		await expect(page.getByRole("alert")).toContainText(
			state === "expired"
				? "expired"
				: state === "binding"
					? "working copy changed"
					: "another project or thread",
		);
		await expect(hits(page)).toHaveCount(state === "wrong-owner" ? 0 : 2);
		if (state !== "wrong-owner") {
			await page.getByRole("button", { name: "Restart search" }).click();
			await expect(page.getByRole("alert")).toHaveCount(0);
		}
	});

test("a changed checksum shows current file content without a misleading line highlight", async ({
	page,
}) => {
	await fixture(page, "?state=stale");
	await projectScope(page);
	await hits(page).first().click();
	await expect(preview(page)).toContainText("changed since the search");
	await expect(preview(page).locator("pre")).toContainText("workspace");
	await expect(page.locator(".files-matching-line")).toHaveCount(0);
});

test("a denied preview retries and a late file read cannot replace another result", async ({
	page,
}) => {
	await fixture(page);
	await projectScope(page);
	let denied = true,
		held: import("@playwright/test").Route | undefined;
	await page.route("**/api/projects/*/file?*", (route) => {
		if (
			new URL(route.request().url()).searchParams.get("path") ===
			"src/workspace/workspace-layout.ts"
		) {
			if (denied)
				return route.fulfill({
					status: 403,
					json: {
						error: { code: "CAPABILITY_DENIED", message: "Access denied" },
					},
				});
			held = route;
			return;
		}
		return route.fulfill({
			json: { text: "Accepted README", binary: false, sha256: "a".repeat(64) },
		});
	});
	await hits(page).first().click();
	await expect(page.getByRole("alert")).toContainText("Access denied");
	denied = false;
	await page.getByRole("button", { name: "Retry file" }).click();
	await expect.poll(() => !!held).toBe(true);
	await hits(page).nth(1).click();
	await expect(preview(page)).toContainText("Accepted README");
	await held!.fulfill({
		json: { text: "Stale file", binary: false, sha256: "a".repeat(64) },
	});
	await settled(page);
	await expect(preview(page)).toContainText("Accepted README");
	await expect(preview(page)).not.toContainText("Stale file");
});

test("GrantedFiles retains its filter, grant owner and preview without Project scope", async ({
	page,
}) => {
	await fixture(page, "?granted=1");
	await expect(
		page.getByRole("combobox", { name: "Search scope" }),
	).toHaveCount(0);
	await page
		.getByRole("searchbox", { name: "Filter this folder" })
		.fill("granted");
	await page.getByRole("button", { name: "granted.txt", exact: true }).click();
	await expect(preview(page)).toContainText("Granted content");
	expect(
		await page.evaluate(() => window.projectSearchFixture.requests.length),
	).toBe(0);
});

for (const width of [1440, 1024, 768])
	test(`states and long paths fit at ${width}px; capture production TSX fixture`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 1000 });
		for (const state of [
			"results",
			"empty",
			"error",
			"loading",
			"stress",
			"partial",
		]) {
			await fixture(page, `?state=${state}`);
			await projectScope(page);
			if (state === "loading")
				await expect(page.getByRole("status")).toContainText("Searching");
			else if (state === "error")
				await expect(page.getByRole("alert")).toBeVisible();
			else if (state === "empty")
				await expect(page.getByRole("status")).toContainText("0 results");
			else await expect(hits(page).first()).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width);
			expect(
				await page
					.locator(".files-surface")
					.evaluate((element) => element.scrollWidth <= element.clientWidth),
			).toBe(true);
			await search(page).blur();
			await page.mouse.move(width - 8, 990);
			await page.screenshot({
				path: testInfo.outputPath(
					`1-after${state === "results" ? "" : `-${state}`}-${width}.png`,
				),
				fullPage: true,
			});
			if (state === "results") {
				await hits(page).first().hover();
				await page.screenshot({
					path: testInfo.outputPath(`1-after-hover-${width}.png`),
					fullPage: true,
				});
				await search(page).focus();
				await page.keyboard.press("ArrowDown");
				await page.screenshot({
					path: testInfo.outputPath(`1-after-focus-${width}.png`),
					fullPage: true,
				});
				await hits(page).first().click();
				await expect(page.locator(".files-matching-line")).toBeVisible();
				await page.screenshot({
					path: testInfo.outputPath(`1-after-open-${width}.png`),
					fullPage: true,
				});
			}
		}
	});

for (const motion of ["system", "reduced", "off"])
	test(`narrow keyboard preview is immediate with OS reduced and app ${motion} motion`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await fixture(page, `?width=420&motion=${motion}`);
		await projectScope(page);
		await search(page).press("ArrowDown");
		await page.keyboard.press("Enter");
		await expect(preview(page)).toBeFocused();
		await expect(page.locator(".files-matching-line")).toBeVisible();
		expect(
			await page
				.locator(".files-surface")
				.evaluate((element) => element.getAnimations({ subtree: true }).length),
		).toBe(0);
		const toggle = page.getByRole("button", { name: "Toggle file list" });
		await toggle.focus();
		await page.keyboard.press("Enter");
		await expect(search(page)).toBeVisible();
	});

for (const theme of ["dark", "light"])
	for (const zoom of [1.25, 1.5])
		test(`${theme} at ${zoom * 100}% keeps long names, actions and focus visible`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1024, height: 1000 });
			await fixture(page, `?state=stress&width=420&theme=${theme}`);
			await page.evaluate((value) => {
				document.body.style.zoom = String(value);
			}, zoom);
			await projectScope(page);
			await search(page).press("ArrowDown");
			await expect(hits(page).first()).toBeFocused();
			expect(
				await hits(page)
					.first()
					.evaluate((element) => getComputedStyle(element).outlineStyle),
			).toBe("solid");
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(1024);
			expect(
				await hits(page)
					.first()
					.evaluate((element) => element.scrollWidth <= element.clientWidth),
			).toBe(true);
		});

for (const theme of ["dark", "light"])
	test(`${theme} search text, metadata and placeholders meet AA contrast`, async ({
		page,
	}) => {
		await fixture(page, `?theme=${theme}`);
		await projectScope(page);
		const ratios = await page.evaluate(() => {
			const luminance = (color: string) => {
				const values = color
					.match(/[\d.]+/g)!
					.slice(0, 3)
					.map(Number)
					.map((value) => {
						const channel = value / 255;
						return channel <= 0.04045
							? channel / 12.92
							: ((channel + 0.055) / 1.055) ** 2.4;
					});
				return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
			};
			return [
				".project-search-hit strong",
				".project-search-hit small",
				".project-search-summary",
				".project-search-field input",
			]
				.map((selector) => {
					const element = document.querySelector<HTMLElement>(selector)!;
					let background = element;
					while (
						getComputedStyle(background).backgroundColor ===
							"rgba(0, 0, 0, 0)" &&
						background.parentElement
					)
						background = background.parentElement;
					const foreground = luminance(getComputedStyle(element).color),
						surface = luminance(getComputedStyle(background).backgroundColor);
					const contrast = (color: number) =>
						(Math.max(color, surface) + 0.05) /
						(Math.min(color, surface) + 0.05);
					return selector.endsWith("input")
						? [
								contrast(foreground),
								contrast(
									luminance(getComputedStyle(element, "::placeholder").color),
								),
							]
						: [contrast(foreground)];
				})
				.flat();
		});
		for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
	});

test("QA r1 displays frozen binding, issues and complete paged results", async ({
	page,
}, testInfo) => {
	await fixture(page, "?state=loading");
	await projectScope(page);
	await page.evaluate(() => {
		const pending = window.projectSearchFixture.pending[0];
		pending.resolve({
			owner: {
				...pending.request.owner,
				workingCopyId: null,
				binding: "b".repeat(64),
			},
			matches: [
				{
					path: "workspace.ts",
					kind: "path",
					line: null,
					column: null,
					preview: "workspace.ts",
					sha256: "a".repeat(64),
				},
			],
			nextCursor: "next-page",
			complete: true,
			issues: [{ path: "logo.png", reason: "binary" }],
			issuesTruncated: true,
			exclusions: [".git", "node_modules"],
			limits: {
				files: 10000,
				bytes: 33554432,
				matches: 1000,
				timeoutMs: 2000,
				fileBytes: 1048576,
			},
		});
	});
	await expect(hits(page)).toHaveCount(1);
	await expect(page.getByRole("status")).toContainText(
		"More results available",
	);
	await expect(page.getByRole("status")).not.toContainText("Incomplete");
	await expect(
		page.getByRole("button", { name: "Load more results" }),
	).toBeVisible();
	await page.locator(".project-search-details summary").click();
	for (const text of [
		"Binding",
		"b".repeat(64),
		"logo.png: binary",
		"node_modules",
		"1,048,576 bytes per file",
		"More issues were omitted",
	])
		await expect(page.locator(".project-search-details")).toContainText(text);
	await page.screenshot({
		path: testInfo.outputPath("qa-r1-contract-details-1440.png"),
		fullPage: true,
	});
});

test("QA r1 uses the trimmed 200-code-point input boundary", async ({
	page,
}) => {
	await fixture(page);
	await projectScope(page, "x".repeat(201));
	await expect(page.getByRole("alert")).toContainText("200");
	expect(
		await page.evaluate(() => window.projectSearchFixture.requests.length),
	).toBe(0);
	await search(page).fill(" ".repeat(600) + "😀".repeat(200) + " ".repeat(600));
	await expect(hits(page)).toHaveCount(3);
	expect(
		await page.evaluate(() => window.projectSearchFixture.requests.at(-1)?.q),
	).toBe("😀".repeat(200));
});

test("QA r2 valid control paths stay visible and retain the exact read target", async ({
	page,
}, testInfo) => {
	await fixture(page, "?state=loading");
	await projectScope(page);
	await page.evaluate(() => {
		const pending = window.projectSearchFixture.pending[0];
		pending.resolve({
			owner: {
				...pending.request.owner,
				workingCopyId: null,
				binding: "b".repeat(64),
			},
			matches: [
				{
					path: "src/notes\t2026.txt",
					kind: "text",
					line: 1,
					column: 1,
					preview: "needle",
					sha256: "a".repeat(64),
				},
				{
					path: "src/path\n2026.txt",
					kind: "path",
					line: null,
					column: null,
					preview: "src/path\n2026.txt",
					sha256: "a".repeat(64),
				},
			],
			nextCursor: null,
			complete: false,
			issues: [{ path: "src/unreadable\n2026.txt", reason: "unreadable" }],
			issuesTruncated: false,
			exclusions: [],
			limits: {
				files: 10000,
				bytes: 33554432,
				matches: 1000,
				timeoutMs: 2000,
				fileBytes: 1048576,
			},
		});
	});
	await expect(hits(page)).toHaveCount(2);
	await expect(hits(page).nth(1).locator("span").last()).toHaveText(
		"src/path\\n2026.txt",
	);
	await expect(hits(page).first()).toContainText("notes\\t2026.txt");
	await page.locator(".project-search-details summary").click();
	await expect(page.locator(".project-search-details")).toContainText(
		"src/unreadable\\n2026.txt: unreadable",
	);
	await page.screenshot({
		path: testInfo.outputPath("qa-r2-control-paths-1440.png"),
		fullPage: true,
	});
	let readTarget: string | null = null;
	await page.route("**/api/projects/*/file?*", (route) => {
		readTarget = new URL(route.request().url()).searchParams.get("path");
		return route.fulfill({
			json: { text: "needle", binary: false, sha256: "a".repeat(64) },
		});
	});
	await hits(page).first().click();
	await expect(page.locator(".files-matching-line")).toHaveText("needle");
	await expect(preview(page).locator("header strong")).toHaveText(
		"notes\\t2026.txt",
	);
	expect(readTarget).toBe("src/notes\t2026.txt");
	await page.screenshot({
		path: testInfo.outputPath("qa-r2-control-preview-1440.png"),
		fullPage: true,
	});
});

for (const { name, text, line } of [
	{ name: "CR-only", text: "first\rneedle", line: 2 },
	{ name: "mixed", text: "first\r\nsecond\rneedle\nfourth", line: 3 },
])
	test(`QA r2 ${name} line breaks reveal the host matching line without changing copied text`, async ({
		page,
	}, testInfo) => {
		await fixture(page, "?state=loading");
		await projectScope(page, "needle");
		await page.evaluate(
			({ line }) => {
				const pending = window.projectSearchFixture.pending[0];
				pending.resolve({
					owner: {
						...pending.request.owner,
						workingCopyId: null,
						binding: "b".repeat(64),
					},
					matches: [
						{
							path: "notes.txt",
							kind: "text",
							line,
							column: 1,
							preview: "needle",
							sha256: "a".repeat(64),
						},
					],
					nextCursor: null,
					complete: true,
					issues: [],
					issuesTruncated: false,
					exclusions: [],
					limits: {
						files: 10000,
						bytes: 33554432,
						matches: 1000,
						timeoutMs: 2000,
						fileBytes: 1048576,
					},
				});
			},
			{ line },
		);
		await page.route("**/api/projects/*/file?*", (route) =>
			route.fulfill({ json: { text, binary: false, sha256: "a".repeat(64) } }),
		);
		await hits(page).first().click();
		await expect(page.locator(".files-matching-line")).toHaveText("needle");
		await expect(preview(page)).toContainText(`Matching line ${line}`);
		expect(await preview(page).locator("pre").textContent()).toBe(text);
		const position = await preview(page)
			.locator("pre")
			.evaluate((element) => {
				const first = document.createRange();
				first.setStart(element.firstChild!, 0);
				first.setEnd(element.firstChild!, 1);
				return {
					offset:
						element.querySelector("mark")!.getBoundingClientRect().top -
						first.getBoundingClientRect().top,
					height: Number.parseFloat(getComputedStyle(element).lineHeight),
				};
			});
		expect(position.offset).toBeCloseTo((line - 1) * position.height, 0);
		await page.screenshot({
			path: testInfo.outputPath(`qa-r2-${name.toLowerCase()}-preview-1440.png`),
			fullPage: true,
		});
	});
