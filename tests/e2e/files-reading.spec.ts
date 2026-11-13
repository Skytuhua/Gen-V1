import { test, expect, type Page, type Route } from "@playwright/test";

const fixtureRoot = encodeURI("/@fs/" + process.cwd().replaceAll("\\", "/"));
const entry = (name: string, kind = "file") => ({
	name,
	path: name,
	kind,
	bytes: 10,
});
const text = (value = "Current file") => ({
	text: value,
	binary: false,
	sha256: "a".repeat(64),
});
const deny = (route: Route, code = "CAPABILITY_DENIED") =>
	route.fulfill({
		status: 403,
		json: { error: { code, message: "Denied by owning project" } },
	});

async function settled(page: Page, route: Route) {
	const response = await route.request().response();
	await response?.finished();
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
}
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
	await page.route("**/files-reading-check*", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<html><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('${fixtureRoot}/tests/e2e/files-reading-fixture.tsx');</script></body></html>`,
		}),
	);
	return () => page.goto("/files-reading-check" + query);
}
async function project(
	page: Page,
	names = [entry("denied.txt"), entry("ok.txt"), entry("next", "directory")],
) {
	await page.route("**/api/projects/*/files?*", (route) =>
		route.fulfill({
			json: {
				entries: new URL(route.request().url()).searchParams.has("path")
					? []
					: names,
			},
		}),
	);
	await page.route("**/api/projects/*/file?*", (route) =>
		new URL(route.request().url()).searchParams.get("path") === "denied.txt"
			? deny(route)
			: route.fulfill({ json: text() }),
	);
}
async function granted(
	page: Page,
	names = [entry("empty.txt"), entry("retry.txt"), entry("next", "directory")],
) {
	await page.route("**/api/resources/*/tree*", (route) =>
		route.fulfill({ json: { path: "", entries: names, truncated: false } }),
	);
	await page.route("**/api/resources/*/content*", (route) =>
		route.fulfill({ contentType: "text/plain", body: "" }),
	);
}

test("RED source: denied A then successful B clears the project preview error", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page);
	await go();
	await page.getByRole("button", { name: "denied.txt", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Denied");
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("Current file");
	await expect(page.getByRole("alert")).toHaveCount(0);
});
test("RED source: held project directory and file requests expose separate pending states", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page);
	let tree: Route | undefined, file: Route | undefined;
	await page.route("**/api/projects/*/files?*", (route) => {
		tree = route;
	});
	await go();
	await expect.poll(() => !!tree).toBe(true);
	await expect(page.getByRole("status")).toContainText(
		/Loading…/,
	);
	await tree!.fulfill({ json: { entries: [entry("held.txt")] } });
	await page.route("**/api/projects/*/file?*", (route) => {
		file = route;
	});
	await page.getByRole("button", { name: "held.txt", exact: true }).click();
	await expect.poll(() => !!file).toBe(true);
	await expect(
		page.getByRole("region", { name: "File content" }).getByRole("status"),
	).toContainText(/Loading…/);
	await file!.fulfill({ json: text() });
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("Current file");
});
test("RED source: unrelated preview cleanup cannot clear a held granted directory indicator", async ({
	page,
}) => {
	const go = await fixture(page, "?granted=1");
	await granted(page);
	let held: Route | undefined;
	await page.route("**/api/resources/*/tree*", (route) => {
		held = route;
	});
	await go();
	await expect.poll(() => !!held).toBe(true);
	await expect(page.getByRole("status")).toContainText(
		/Loading…/,
	);
	await held!.fulfill({ json: { path: "", entries: [], truncated: false } });
});
test("RED source: zero-byte UTF8 is a successful text preview", async ({
	page,
}) => {
	const go = await fixture(page, "?granted=1");
	await granted(page);
	await go();
	await page.getByRole("button", { name: /^empty.txt/ }).click();
	await expect(page.locator(".granted-files")).toContainText("Empty text file");
	await expect(page.getByText(/no inline preview/)).toHaveCount(0);
});

test("RED source: a held project file identifies the pending selection", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page);
	let held: Route | undefined;
	await page.route("**/api/projects/*/file?*", (route) => {
		held = route;
	});
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await expect.poll(() => !!held).toBe(true);
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("ok.txt");
	await expect(
		page.getByRole("region", { name: "File content" }).getByRole("status"),
	).toContainText(/Loading…/);
	await held!.fulfill({ json: text() });
});

test("folder filter is local, breadcrumb navigates, and empty folders are explicit", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page);
	const requests: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/projects/")) requests.push(request.url());
	});
	await go();
	await page.getByRole("searchbox", { name: "Filter this folder" }).fill("OK");
	await expect(
		page.getByRole("button", { name: "ok.txt", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "denied.txt", exact: true }),
	).toHaveCount(0);
	expect(requests).toHaveLength(1);
	await page
		.getByRole("searchbox", { name: "Filter this folder" })
		.fill("no match");
	await expect(
		page.getByText("No matches."),
	).toBeVisible();
	await page.getByRole("searchbox", { name: "Filter this folder" }).fill("");
	await page.getByRole("button", { name: "next", exact: true }).click();
	await expect(page.getByText("Folder is empty.")).toBeVisible();
	await page
		.getByRole("navigation", { name: "Folder breadcrumb" })
		.getByRole("button", { name: "Project files", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "ok.txt", exact: true }),
	).toBeVisible();
});

test("refresh retains the selected project content and retry recovers directory failure", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("Current file");
	let held: Route | undefined;
	await page.route("**/api/projects/*/files?*", (route) => {
		held = route;
	});
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect.poll(() => !!held).toBe(true);
	await expect(
		page.getByRole("button", { name: "ok.txt", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("Current file");
	await held!.fulfill({
		status: 500,
		json: { error: { message: "Folder read failed" } },
	});
	await expect(page.getByRole("alert")).toContainText("Folder read failed");
	await page.route("**/api/projects/*/files?*", (route) =>
		route.fulfill({ json: { entries: [entry("ok.txt")] } }),
	);
	await page.getByRole("button", { name: "Retry" }).click();
	await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const code of ["CAPABILITY_DENIED", "PROJECT_NOT_CONNECTED"])
	test(
		"only disconnected projects fall back to thread grants: " + code,
		async ({ page }) => {
			const go = await fixture(page);
			await granted(page);
			await page.route("**/api/projects/*/files?*", (route) =>
				deny(route, code),
			);
			await go();
			if (code === "PROJECT_NOT_CONNECTED")
				await expect(
					page.getByRole("combobox", { name: "Granted resource" }),
				).toBeVisible();
			else {
				await expect(page.getByRole("alert")).toContainText(
					"Denied by owning project",
				);
				await expect(
					page.getByRole("combobox", { name: "Granted resource" }),
				).toHaveCount(0);
			}
		},
	);

test("no project or grants gives a useful scoped empty state", async ({
	page,
}) => {
	const go = await fixture(page, "?granted=1&no-grants=1");
	await go();
	await expect(
		page.getByText("No granted resources", { exact: true }).last(),
	).toBeVisible();
	await expect(
		page.getByRole("combobox", { name: "Granted resource" }),
	).toBeDisabled();
	await expect(
		page.getByText(/Only files explicitly granted to this thread/),
	).toBeVisible();
});

test("granted preferred selection and keyboard Select retain the exact thread owner", async ({
	page,
}) => {
	const go = await fixture(page, "?granted=1&preferred=grant-b");
	await granted(page);
	const urls: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/resources/")) urls.push(request.url());
	});
	await go();
	const select = page.getByRole("combobox", { name: "Granted resource" });
	await expect(select).toContainText("Beta grant");
	expect(urls.every((url) => url.includes("/grant-b/"))).toBe(true);
	await select.click();
	await page.keyboard.press("a");
	await page.keyboard.press("Enter");
	await expect(select).toContainText("Alpha grant");
	await expect(page.getByRole("option", { name: "Other owner" })).toHaveCount(
		0,
	);
});

for (const source of ["project", "granted"])
	for (const late of ["success", "error"])
		test(`${source} ignores stale file ${late} after another selection or directory`, async ({
			page,
		}) => {
			const go = await fixture(page, source === "granted" ? "?granted=1" : "");
			await project(page);
			await granted(page, [
				entry("ok.txt"),
				entry("late.txt"),
				entry("next", "directory"),
			]);
			let held: Route | undefined;
			const pattern =
				source === "project"
					? "**/api/projects/*/file?*"
					: "**/api/resources/*/content*";
			if (source === "project")
				await project(page, [
					entry("ok.txt"),
					entry("late.txt"),
					entry("next", "directory"),
				]);
			await page.route(pattern, (route) => {
				if (
					new URL(route.request().url()).searchParams.get("path") === "late.txt"
				) {
					held = route;
					return;
				}
				return source === "project"
					? route.fulfill({ json: text("Accepted B") })
					: route.fulfill({ contentType: "text/plain", body: "Accepted B" });
			});
			await go();
			await page.getByRole("button", { name: "late.txt", exact: true }).click();
			await expect.poll(() => !!held).toBe(true);
			await page.getByRole("button", { name: "ok.txt", exact: true }).click();
			await expect(
				page.getByRole("region", { name: "File content" }),
			).toContainText("Accepted B");
			if (late === "error") await deny(held!);
			else
				await held!.fulfill(
					source === "project"
						? { json: text("Stale A") }
						: { contentType: "text/plain", body: "Stale A" },
				);
			await settled(page, held!);
			await expect(
				page.getByRole("region", { name: "File content" }),
			).toContainText("Accepted B");
			await expect(page.getByRole("alert")).toHaveCount(0);
			held = undefined;
			await page.getByRole("button", { name: "late.txt", exact: true }).click();
			await expect.poll(() => !!held).toBe(true);
			await page.getByRole("button", { name: "next", exact: true }).click();
			await held!.fulfill({
				status: 500,
				json: { error: { message: "Stale directory selection failure" } },
			});
			await expect(
				page.getByRole("region", { name: "File content" }),
			).not.toContainText("Accepted B");
			await expect(page.getByRole("alert")).toHaveCount(0);
		});

for (const source of ["project", "granted"])
	for (const late of ["success", "error"])
		test(`${source} rejects a late directory ${late} after breadcrumb navigation`, async ({
			page,
		}) => {
			const go = await fixture(page, source === "granted" ? "?granted=1" : "");
			await project(page);
			await granted(page, [entry("ok.txt"), entry("next", "directory")]);
			let held: Route | undefined;
			const pattern =
				source === "project"
					? "**/api/projects/*/files?*"
					: "**/api/resources/*/tree*";
			await page.route(pattern, (route) => {
				if (
					new URL(route.request().url()).searchParams.get("path") === "next"
				) {
					held = route;
					return;
				}
				return route.fulfill({
					json: {
						entries: [entry("ok.txt"), entry("next", "directory")],
						truncated: false,
					},
				});
			});
			await go();
			await page.getByRole("button", { name: "next", exact: true }).click();
			await expect.poll(() => !!held).toBe(true);
			await page.getByRole("button", { name: "Parent directory" }).click();
			await expect(
				page.getByRole("button", { name: "ok.txt", exact: true }),
			).toBeVisible();
			if (late === "error") await deny(held!);
			else
				await held!.fulfill({
					json: { entries: [entry("stale.txt")], truncated: false },
				});
			await settled(page, held!);
			await expect(
				page.getByRole("button", { name: "ok.txt", exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "stale.txt", exact: true }),
			).toHaveCount(0);
			await expect(page.getByRole("alert")).toHaveCount(0);
		});

for (const change of ["project", "thread"])
	test(
		"project binding change rejects previous preview and retains exact query: " +
			change,
		async ({ page }) => {
			const go = await fixture(page);
			await project(page);
			let held: Route | undefined;
			const requests: URL[] = [];
			await page.route("**/api/projects/*/file?*", (route) => {
				requests.push(new URL(route.request().url()));
				if (requests.length === 1) {
					held = route;
					return;
				}
				return route.fulfill({ json: text("New owner file") });
			});
			await go();
			await page.getByRole("button", { name: "ok.txt", exact: true }).click();
			await expect.poll(() => !!held).toBe(true);
			await page.getByRole("button", { name: "Switch " + change }).click();
			await expect(
				page.getByRole("region", { name: "File content" }),
			).not.toContainText("ok.txt");
			await page.getByRole("button", { name: "ok.txt", exact: true }).click();
			await expect(
				page.getByRole("region", { name: "File content" }),
			).toContainText("New owner file");
			await deny(held!);
			await expect(page.getByRole("alert")).toHaveCount(0);
			expect(requests[1].pathname).toBe(
				"/api/projects/" +
					(change === "project" ? "project-two" : "project-one") +
					"/file",
			);
			expect(requests[1].searchParams.get("threadId")).toBe(
				change === "thread" ? "other-thread" : "task-thread",
			);
		},
	);

for (const change of ["grant", "thread"])
	test(
		"granted binding change discards previous directory and preview: " + change,
		async ({ page }) => {
			const go = await fixture(page, "?granted=1");
			await granted(page, [entry("ok.txt")]);
			let held: Route | undefined;
			await page.route("**/api/resources/*/content*", (route) => {
				if (route.request().url().includes("/grant-a/")) {
					held = route;
					return;
				}
				return route.fulfill({
					contentType: "text/plain",
					body: "Accepted new grant",
				});
			});
			await go();
			await page.getByRole("button", { name: "ok.txt", exact: true }).click();
			await expect.poll(() => !!held).toBe(true);
			if (change === "thread")
				await page.getByRole("button", { name: "Switch thread" }).click();
			else {
				await page.getByRole("combobox", { name: "Granted resource" }).click();
				await page.getByRole("option", { name: "Beta grant" }).click();
			}
			await expect(
				page.getByRole("region", { name: "File content" }),
			).not.toContainText("ok.txt");
			await page.getByRole("button", { name: "ok.txt", exact: true }).click();
			await expect(
				page.getByRole("region", { name: "File content" }),
			).toContainText("Accepted new grant");
			await deny(held!);
			await expect(page.getByRole("alert")).toHaveCount(0);
		},
	);

for (const mode of [
	"denied",
	"large-header",
	"large-stream",
	"binary",
	"invalid-utf8",
])
	test(
		"granted " + mode + " preview keeps download and recovery available",
		async ({ page }) => {
			const go = await fixture(page, "?granted=1");
			await granted(page, [entry("sample.txt")]);
			await page.route("**/api/resources/*/content*", (route) => {
				if (mode === "denied") return deny(route);
				if (mode === "large-header")
					return route.fulfill({
						headers: {
							"content-type": "text/plain",
							"content-length": String(2 * 1024 * 1024),
						},
						body: "large",
					});
				if (mode === "large-stream")
					return route.fulfill({
						headers: { "content-type": "text/plain", "content-length": "1" },
						body: "x".repeat(1024 * 1024 + 1),
					});
				return route.fulfill({
					contentType: "application/octet-stream",
					body:
						mode === "binary" ? Buffer.from([65, 0, 66]) : Buffer.from([255]),
				});
			});
			await go();
			await page
				.getByRole("button", { name: "sample.txt", exact: true })
				.click();
			const preview = page.getByRole("region", { name: "File content" });
			await expect(
				preview.getByRole("link", { name: "Download" }),
			).toHaveAttribute(
				"href",
				"/api/resources/grant-a/content?path=sample.txt",
			);
			if (mode === "binary")
				await expect(preview).toContainText("no inline preview");
			else {
				await expect(preview.getByRole("alert")).toBeVisible();
				if (mode.startsWith("large"))
					await expect(preview).toContainText(/limit/);
				await page.route("**/api/resources/*/content*", (route) =>
					route.fulfill({ contentType: "text/plain", body: "Retry succeeded" }),
				);
				await page.getByRole("button", { name: "Retry" }).click();
				await expect(preview).toContainText("Retry succeeded");
				await expect(preview.getByRole("alert")).toHaveCount(0);
			}
		},
	);

test("direct image grant returns to root without retaining a preview or crashing", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	const go = await fixture(page, "?granted=1");
	await granted(page, [{ ...entry("photo.png"), path: "" }]);
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
		"base64",
	);
	await page.route("**/api/resources/*/content*", route =>
		route.fulfill({ contentType: "image/png", body: png }),
	);
	await go();
	await page.getByRole("button", { name: "photo.png", exact: true }).click();
	await expect(page.getByRole("img", { name: "photo.png" })).toBeVisible();
	await page.getByRole("button", { name: "Granted root", exact: true }).click();
	await expect(page.getByRole("region", { name: "File content" })).toContainText("Choose a file");
	await expect(page.getByRole("img", { name: "photo.png" })).toHaveCount(0);
	await page.getByRole("button", { name: "photo.png", exact: true }).click();
	await expect(page.getByRole("img", { name: "photo.png" })).toBeVisible();
	expect(errors).toEqual([]);
});

test("granted images revoke object URLs on refresh, selection and owner change", async ({
	page,
}) => {
	const go = await fixture(page, "?granted=1");
	await granted(page, [entry("photo.png"), entry("empty.txt")]);
	await page.addInitScript(() => {
		const created: string[] = [],
			revoked: string[] = [];
		Object.assign(window, { __filesUrls: { created, revoked } });
		const create = URL.createObjectURL.bind(URL),
			revoke = URL.revokeObjectURL.bind(URL);
		URL.createObjectURL = (blob) => {
			const url = create(blob);
			created.push(url);
			return url;
		};
		URL.revokeObjectURL = (url) => {
			revoked.push(url);
			revoke(url);
		};
	});
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
		"base64",
	);
	await page.route("**/api/resources/*/content*", (route) =>
		route.fulfill({ contentType: "image/png", body: png }),
	);
	await go();
	await page.getByRole("button", { name: "photo.png", exact: true }).click();
	await expect(page.getByRole("img", { name: "photo.png" })).toBeVisible();
	await page.getByRole("button", { name: "Refresh granted files" }).click();
	await expect
		.poll(() => page.evaluate(() => (window as any).__filesUrls.revoked.length))
		.toBe(1);
	await page.getByRole("button", { name: "empty.txt", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => (window as any).__filesUrls.revoked.length))
		.toBe(2);
	await expect(page.getByRole("img", { name: "empty.txt" })).toBeVisible();
	await page.getByRole("button", { name: "Switch thread" }).click();
	await expect
		.poll(() => page.evaluate(() => (window as any).__filesUrls.revoked.length))
		.toBe(3);
});

for (const theme of ["dark", "light"])
	for (const width of [920, 460, 300])
		test(`container geometry, independent scrolling and keyboard: ${theme} ${width}`, async ({
			page,
		}, info) => {
			const go = await fixture(page, `?theme=${theme}&width=${width}`);
			await project(
				page,
				Array.from({ length: 90 }, (_, index) => entry(`source-${index}.txt`)),
			);
			await page.route("**/api/projects/*/file?*", (route) =>
				route.fulfill({
					json: text(
						Array.from(
							{ length: 120 },
							(_, index) => `${index}: ${"source ".repeat(60)}`,
						).join("\n"),
					),
				}),
			);
			await page.emulateMedia({ reducedMotion: "reduce" });
			await go();
			const list = page.getByRole("navigation", {
					name: "Project files",
					exact: true,
				}),
				preview = page.getByRole("region", { name: "File content" }),
				toggle = page.getByRole("button", { name: "Toggle file list" });
			const file = page.getByRole("button", {
				name: "source-0.txt",
				exact: true,
			});
			await file.focus();
			await page.keyboard.press("Enter");
			await expect(preview.locator("pre")).toBeVisible();
			if (width <= 560) {
				await expect(list).toBeHidden();
				await toggle.focus();
				await page.keyboard.press("Enter");
				await expect(list).toBeVisible();
				await expect(toggle).toHaveAttribute("aria-expanded", "true");
			} else await expect(toggle).toBeHidden();
			const geometry = await page
				.getByTestId("files-owner")
				.evaluate((owner) => {
					const list = owner.querySelector(".files-list")!,
						preview = owner.querySelector(".files-preview-content")!,
						pre = preview.querySelector("pre")!,
						rect = owner.getBoundingClientRect();
					return {
						owner: rect.toJSON(),
						surface: owner.firstElementChild!.getBoundingClientRect().toJSON(),
						listScroll: list.scrollHeight - list.clientHeight,
						previewScroll: preview.scrollHeight - preview.clientHeight,
						padding: parseFloat(getComputedStyle(pre).paddingLeft),
						pageWidth: document.documentElement.scrollWidth,
						viewport: innerWidth,
						animation: getComputedStyle(pre).animationName,
						color: getComputedStyle(pre).color,
						background: getComputedStyle(owner.firstElementChild!)
							.backgroundColor,
					};
				});
			expect(geometry.surface.bottom).toBeLessThanOrEqual(
				geometry.owner.bottom,
			);
			expect(geometry.surface.right).toBeLessThanOrEqual(geometry.owner.right);
			expect(geometry.listScroll).toBeGreaterThan(0);
			expect(geometry.previewScroll).toBeGreaterThan(0);
			expect(geometry.padding).toBe(width <= 400 ? 12 : 16);
			expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
			expect(geometry.animation).toBe("none");
			expect(geometry.background).toBe(
				theme === "dark" ? "rgb(15, 15, 15)" : "rgb(255, 255, 255)",
			);
			const listScroll = await page.locator(".files-list").evaluate((node) => {
				node.scrollTop = 90;
				return node.scrollTop;
			});
			await page
				.locator(".files-preview-content")
				.evaluate((node) => (node.scrollTop = 200));
			expect(
				await page.locator(".files-list").evaluate((node) => node.scrollTop),
			).toBe(listScroll);
			await page.screenshot({
				path: info.outputPath(`files-${theme}-${width}.png`),
			});
		});
test("RED source: granted refresh retries the selected failed preview", async ({
	page,
}) => {
	const go = await fixture(page, "?granted=1");
	await granted(page);
	let reads = 0;
	await page.route("**/api/resources/*/content*", (route) =>
		++reads === 1
			? route.fulfill({ status: 500, body: "failed" })
			: route.fulfill({ contentType: "text/plain", body: "Recovered preview" }),
	);
	await go();
	await page.getByRole("button", { name: /^retry.txt/ }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await page.getByRole("button", { name: "Refresh granted files" }).click();
	await expect(page.locator(".granted-files")).toContainText(
		"Recovered preview",
	);
});

test("narrow keyboard selection keeps focus in the visible preview", async ({
	page,
}) => {
	const go = await fixture(page, "?width=320");
	await project(page);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toBeFocused();
	await expect(
		page.getByRole("navigation", { name: "Project files", exact: true }),
	).toBeHidden();
	await page.keyboard.press("Shift+Tab");
	await expect(
		page.getByRole("button", { name: "Project files", exact: true }),
	).toBeFocused();
});

test("project empty text, binary and too-large errors remain distinct", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page, [
		entry("empty.txt"),
		entry("binary.dat"),
		entry("large.txt"),
	]);
	await page.route("**/api/projects/*/file?*", (route) => {
		const path = new URL(route.request().url()).searchParams.get("path");
		return path === "empty.txt"
			? route.fulfill({ json: text("") })
			: path === "binary.dat"
				? route.fulfill({
						json: { text: null, binary: true, sha256: "b".repeat(64) },
					})
				: route.fulfill({
						status: 413,
						json: {
							error: {
								code: "FILE_TOO_LARGE",
								message: "File exceeds the 1 MiB read limit.",
							},
						},
					});
	});
	await go();
	const preview = page.getByRole("region", { name: "File content" });
	await page.getByRole("button", { name: "empty.txt", exact: true }).click();
	await expect(preview).toContainText("Empty text file");
	await page.getByRole("button", { name: "binary.dat", exact: true }).click();
	await expect(preview).toContainText("Binary file");
	await page.getByRole("button", { name: "large.txt", exact: true }).click();
	await expect(preview.getByRole("alert")).toContainText("1 MiB");
	await expect(
		preview.getByRole("button", { name: "Retry" }),
	).toBeVisible();
	await expect(
		page.getByRole("combobox", { name: "Granted resource" }),
	).toHaveCount(0);
});

test("granted refresh retains folder and preview with independent pending feedback", async ({
	page,
}) => {
	const go = await fixture(page, "?granted=1");
	await granted(page, [entry("ok.txt")]);
	await page.route("**/api/resources/*/content*", (route) =>
		route.fulfill({ contentType: "text/plain", body: "Retained granted text" }),
	);
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("Retained granted text");
	let tree: Route | undefined, file: Route | undefined;
	await page.route("**/api/resources/*/tree*", (route) => {
		tree = route;
	});
	await page.route("**/api/resources/*/content*", (route) => {
		file = route;
	});
	await page.getByRole("button", { name: "Refresh granted files" }).click();
	await expect.poll(() => !!tree && !!file).toBe(true);
	await expect(
		page.getByRole("button", { name: "ok.txt", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("Retained granted text");
	await file!.fulfill({ contentType: "text/plain", body: "Refreshed text" });
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("Refreshed text");
	await expect(
		page.getByRole("navigation", { name: "Granted files" }).getByRole("status"),
	).toContainText("Refreshing…");
	await tree!.fulfill({
		json: { entries: [entry("ok.txt")], truncated: false },
	});
	await expect(page.getByRole("status")).toHaveCount(0);
});

test("preferred grant change resets a held directory and invalid preference falls back within thread", async ({
	page,
}) => {
	const go = await fixture(page, "?granted=1&preferred=not-owned");
	await granted(page);
	let held: Route | undefined;
	await page.route("**/api/resources/grant-a/tree*", (route) => {
		held = route;
	});
	await go();
	await expect.poll(() => !!held).toBe(true);
	await expect(
		page.getByRole("combobox", { name: "Granted resource" }),
	).toContainText("Alpha grant");
	await page.getByRole("button", { name: "Prefer Beta grant" }).click();
	await expect(
		page.getByRole("combobox", { name: "Granted resource" }),
	).toContainText("Beta grant");
	await expect(
		page.getByRole("button", { name: "empty.txt", exact: true }),
	).toBeVisible();
	await deny(held!);
	await settled(page, held!);
	await expect(page.getByRole("alert")).toHaveCount(0);
});

test("project inactive state aborts its read and resumes without stale content", async ({
	page,
}) => {
	const go = await fixture(page);
	await project(page);
	let held: Route | undefined;
	await page.route("**/api/projects/*/file?*", (route) => {
		held = route;
	});
	await go();
	await page.getByRole("button", { name: "ok.txt", exact: true }).click();
	await expect.poll(() => !!held).toBe(true);
	await page.getByRole("button", { name: "Toggle active" }).click();
	await held!.fulfill({ json: text("Inactive stale result") });
	await settled(page, held!);
	await expect(
		page.getByRole("region", { name: "File content" }),
	).not.toContainText("Inactive stale result");
	await expect(page.getByRole("status")).toHaveCount(0);
	await page.route("**/api/projects/*/file?*", (route) =>
		route.fulfill({ json: text("Resumed file") }),
	);
	await page.getByRole("button", { name: "Toggle active" }).click();
	await expect(
		page.getByRole("region", { name: "File content" }),
	).toContainText("Resumed file");
});

for (const source of ["project", "granted"])
	test(
		"returned folder limits stay explicit without a recursive-search claim: " +
			source,
		async ({ page }) => {
			const go = await fixture(page, source === "granted" ? "?granted=1" : "");
			await project(
				page,
				Array.from({ length: 500 }, (_, i) => entry("file-" + i + ".txt")),
			);
			await granted(page);
			if (source === "granted")
				await page.route("**/api/resources/*/tree*", (route) =>
					route.fulfill({
						json: { entries: [entry("only-returned.txt")], truncated: true },
					}),
				);
			await go();
			await expect(
				page.getByText(
					source === "project"
						? /up to 500 entries/
						: /limited to 300 entries/,
				),
			).toBeVisible();
			await page
				.getByRole("searchbox", { name: "Filter this folder" })
				.fill("not-returned");
			await expect(
				page.getByText("No matches."),
			).toBeVisible();
		},
	);
