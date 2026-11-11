import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Frame } from "@playwright/test";
import {
	diagramDocumentSchema,
	type DiagramDocument,
	type VisualDocumentRecord,
} from "../plugins/personal-visuals/src/contracts";
import { resolve } from "node:path";

async function visualFixture(record?: VisualDocumentRecord) {
	const root = process.cwd(),
		plugin = resolve(root, "plugins/personal-visuals");
	const shared = await build({
		stdin: {
			contents:
				"import * as React from 'react';import * as ReactDOMClient from 'react-dom/client';import * as JSXRuntime from 'react/jsx-runtime';globalThis.__PV_SHARED={React,ReactDOMClient,JSXRuntime};",
			resolveDir: root,
		},
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		define: { "process.env.NODE_ENV": '"production"' },
	});
	const frontend = await build({
		absWorkingDir: plugin,
		entryPoints: ["src/frontend.tsx"],
		outdir: "out",
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		jsx: "automatic",
		define: { "process.env.NODE_ENV": '"production"' },
		plugins: [
			{
				name: "shared-test-runtime",
				setup(builder) {
					builder.onResolve(
						{ filter: /^react(?:\/jsx-runtime)?$/ },
						(args) => ({
							path: resolve(
								plugin,
								args.path === "react" ? "src/react.ts" : "src/jsx-runtime.ts",
							),
						}),
					);
				},
			},
		],
	});
	const javascript = frontend.outputFiles.find((file) =>
			file.path.endsWith(".js"),
		)!.text,
		css = frontend.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
	const bridge = `window.__PV_STATE={revision:0,document:null,draft:null,...${JSON.stringify(record ?? {})},calls:[],attempts:[],receipts:{}};window.GenPluginUI={...window.__PV_SHARED,registerPlugin:(manifest,registration)=>{window.__PV_REGISTRATION={manifest,registration};},registerEditorHandoff:(_id,guard)=>{window.__PV_FLUSH=guard;return()=>{};},pluginReady:()=>window.__PV_READY=true,pluginRequest:async(operation,input)=>{const state=window.__PV_STATE;if(operation==='visual.document.read')return{documentId:'main',revision:state.revision,document:state.document,draft:state.draft,receipt:state.receipts[input.requestId]??null};if(operation!=='visual.document.write')throw Error('Unknown operation');state.attempts.push(input);await new Promise(resolve=>setTimeout(resolve,30));if(state.receipts[input.requestId])return state.receipts[input.requestId];if(input.baseRevision!==state.revision)throw Error('Revision conflict');state.calls.push(input);state.revision++;if(input.action==='draft')state.draft=input.draft;else{state.document=input.document;state.draft=null;}const receipt={documentId:'main',revision:state.revision,requestId:input.requestId};state.receipts[input.requestId]=receipt;if(input.action==='commit'&&window.__PV_FAIL_COMMIT){window.__PV_FAIL_COMMIT=false;throw Error('Synthetic lost commit response');}return receipt;}};`;
	const script = (value: string) => value.replace(/<\/script/gi, "<\\/script"),
		child = `<!doctype html><html><head><meta charset="utf-8"><meta name="gen-plugin-id" content="personal-visuals"><style>${css}</style></head><body><div id="root"></div><script>${script(shared.outputFiles[0].text)}</script><script>${script(bridge)}</script><script>${script(javascript)}</script></body></html>`;
	const attribute = (value: string) =>
		script(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
	let html = `<!doctype html><html><body style="margin:0"><iframe title="Personal Visuals fixture" sandbox="allow-scripts" style="width:1100px;height:760px;border:0" srcdoc="${child.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe></body></html>`;
	const channel =
		process.env.GEN_TEST_BROWSER_CHANNEL === "chrome" ? "chrome" : undefined;
	const browser = await chromium.launch({
			headless: true,
			...(channel ? { channel } : {}),
		}),
		context = await browser.newContext({
			viewport: { width: 1150, height: 800 },
		}),
		page = await context.newPage(),
		errors: string[] = [],
		unexpected: string[] = [];
	page.on("pageerror", (cause) => errors.push(cause.message));
	await page.route("**/*", (route) => {
		if (route.request().url() === "http://127.0.0.1/personal-visuals-test")
			return route.fulfill({
				contentType: "text/html; charset=utf-8",
				body: html,
			});
		unexpected.push(route.request().url());
		return route.abort();
	});
	await page.goto("http://127.0.0.1/personal-visuals-test");
	const frame = page.frames().find((value) => value.parentFrame())!;
	await frame.waitForSelector(".pv-header h1");
	await frame.waitForFunction(() => Boolean((window as any).__PV_READY));
	return {
		page,
		frame,
		errors,
		unexpected,
		reload: async () => {
			const saved = await frame.evaluate(() => {
				const state = (window as any).__PV_STATE;
				return {
					documentId: "main",
					revision: state.revision,
					document: state.document,
					draft: state.draft,
				};
			});
			html = html.replace(
				attribute(`...${JSON.stringify(record ?? {})},calls:`),
				attribute(`...${JSON.stringify(saved)},calls:`),
			);
			await page.reload();
			const recovered = page.frames().find((value) => value.parentFrame())!;
			await recovered.waitForFunction(() =>
				Boolean((window as any).__PV_READY),
			);
			return recovered;
		},
		close: async () => {
			await context.close();
			await browser.close();
		},
	};
}

it("keeps JSON typing focused through autosave and renders source labels as text inside an opaque frame", async () => {
	const { frame, errors, unexpected, close } = await visualFixture();
	try {
		expect(
			await frame.evaluate(() => {
				try {
					return Boolean(parent.document);
				} catch {
					return false;
				}
			}),
		).toBe(false);
		await frame.getByRole("button", { name: "Edit", exact: true }).click();
		const input = frame.locator("#pv-json");
		const diagram = JSON.parse(await input.inputValue());
		diagram.title = "Recovered visual document";
		diagram.nodes[0].label = '<img src="https://invalid.example/image">';
		const value = JSON.stringify(diagram, null, 2);
		await input.fill(value);
		await frame.waitForFunction(() =>
			Boolean((window as any).__PV_STATE.draft),
		);
		expect(
			await input.evaluate((element) => document.activeElement === element),
		).toBe(true);
		await frame
			.getByRole("button", { name: "Preview diagram", exact: true })
			.click();
		expect(await frame.locator(".pv-node").first().textContent()).toContain(
			'<img src="https://invalid.example/image">',
		);
		expect(await frame.locator("img").count()).toBe(0);
		diagram.title = "Saved after exact retry";
		await input.fill(JSON.stringify(diagram, null, 2));
		await frame.evaluate(() => {
			(window as any).__PV_FAIL_COMMIT = true;
		});
		await frame.getByRole("button", { name: "Save", exact: true }).click();
		await frame
			.getByRole("button", { name: "Retry exact save", exact: true })
			.click();
		await frame.waitForFunction(
			() =>
				document.querySelector(".pv-header h1")?.textContent ===
				"Saved after exact retry",
			{},
			{ timeout: 3000 },
		);
		await frame.waitForFunction(() =>
			Boolean((window as any).__PV_STATE.document),
		);
		expect(
			await frame.evaluate(
				() => (window as any).__PV_REGISTRATION.manifest.workspaces,
			),
		).toMatchObject([{ id: "visuals", title: "Visuals" }]);
		const currentDraft =
			'{"version":1,"title":"Export draft still being edited"';
		await input.fill(currentDraft);
		await frame.waitForFunction(
			(value) => (window as any).__PV_STATE.draft === value,
			currentDraft,
		);
		await frame.evaluate(() => (window as any).__PV_FLUSH());
		const writesBeforeExport = await frame.evaluate(
			() => (window as any).__PV_STATE.calls.length,
		);
		await frame
			.getByRole("button", { name: "Export JSON", exact: true })
			.click();
		const exportDialog = frame.getByRole("dialog", {
			name: "Export JSON",
			exact: true,
		});
		await exportDialog.waitFor({ timeout: 3000 });
		const exported = exportDialog.getByRole("textbox", {
			name: "JSON to copy",
			exact: true,
		});
		expect(await exported.inputValue()).toBe(currentDraft);
		expect(
			await exported.evaluate(
				(element) => (element as HTMLTextAreaElement).readOnly,
			),
		).toBe(true);
		await exportDialog
			.getByRole("button", { name: "Select all", exact: true })
			.click();
		expect(
			await exported.evaluate((element) => {
				const input = element as HTMLTextAreaElement;
				return (
					input.selectionStart === 0 &&
					input.selectionEnd === input.value.length
				);
			}),
		).toBe(true);
		await exportDialog
			.getByRole("button", { name: "Close export", exact: true })
			.click();
		expect(await input.inputValue()).toBe(currentDraft);
		expect(
			await frame.evaluate(() => (window as any).__PV_STATE.calls.length),
		).toBe(writesBeforeExport);
		expect(
			await frame.evaluate(() => (window as any).__PV_STATE.document.title),
		).toBe("Saved after exact retry");
		expect(unexpected).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await close();
	}
}, 15000);

function nearLimitDocument(): DiagramDocument {
	const value: DiagramDocument = {
		version: 1,
		title: "Imported near limit",
		kind: "architecture",
		provenance: "provided",
		nodes: Array.from({ length: 128 }, (_, i) => ({
			id: `n${i}`,
			label: `Node ${i}`,
			kind: "component",
			sourceIds: [],
			description: "",
		})),
		edges: [],
		sources: [],
	};
	let remaining = 98_367 - Buffer.byteLength(JSON.stringify(value, null, 2));
	for (const node of value.nodes) {
		const count = Math.min(remaining, 4000);
		node.description = "x".repeat(count);
		remaining -= count;
	}
	expect(remaining).toBe(0);
	expect(Buffer.byteLength(JSON.stringify(value))).toBe(91_935);
	expect(Buffer.byteLength(JSON.stringify(value, null, 2))).toBe(98_367);
	return diagramDocumentSchema.parse(value);
}

async function importDocument(frame: Frame, document: DiagramDocument) {
	await frame.locator('input[type="file"]').setInputFiles({
		name: "diagram.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(document)),
	});
}

async function snapshot(frame: Frame) {
	return frame.evaluate(() => ({
		title: document.querySelector(".pv-header h1")!.textContent,
		canvas: document.querySelector(".pv-canvas")!.outerHTML,
		text: (document.querySelector("#pv-json") as HTMLTextAreaElement).value,
		selected: [
			...document.querySelectorAll('.pv-node[aria-pressed="true"]'),
		].map((node) => node.getAttribute("title")),
		state: structuredClone((window as any).__PV_STATE),
	}));
}

async function exportDraft(frame: Frame) {
	await frame.getByRole("button", { name: "Export JSON", exact: true }).click();
	const value = await frame
		.getByRole("textbox", { name: "JSON to copy", exact: true })
		.inputValue();
	await frame
		.getByRole("button", { name: "Close export", exact: true })
		.click();
	return value;
}

it("oversized formatted import retains every previous state owner", async () => {
	const fixture = await visualFixture();
	const { frame } = fixture;
	try {
		await frame.getByRole("button", { name: "Edit", exact: true }).click();
		await frame.locator(".pv-node").nth(1).click();
		await frame.getByRole("button", { name: "Save", exact: true }).click();
		await frame.waitForFunction(() =>
			Boolean((window as any).__PV_STATE.document),
		);
		const before = await snapshot(frame);
		await importDocument(frame, nearLimitDocument());
		await frame.getByRole("alert").waitFor();
		expect(await snapshot(frame)).toEqual(before);
		expect(await frame.getByRole("alert").textContent()).toContain(
			"The draft exceeds the 96 KiB limit.",
		);
		expect(await frame.getByRole("dialog").count()).toBe(0);
		expect(await exportDraft(frame)).toBe(before.text);
		await frame.waitForTimeout(350);
		await frame.evaluate(() => (window as any).__PV_FLUSH());
		expect(await snapshot(frame)).toEqual(before);
		expect(fixture.errors).toEqual([]);
		expect(fixture.unexpected).toEqual([]);
	} finally {
		await fixture.close();
	}
});

it("accepted import survives replacement confirmation autosave handoff reload save and export", async () => {
	const fixture = await visualFixture();
	let { frame } = fixture;
	try {
		await frame.getByRole("button", { name: "Edit", exact: true }).click();
		const input = frame.locator("#pv-json");
		const direct = JSON.parse(await input.inputValue()) as DiagramDocument;
		direct.title = "Initial accepted import";
		direct.provenance = "provided";
		await importDocument(frame, direct);
		const original = JSON.stringify(direct, null, 2);
		await frame.waitForFunction(
			(value) => (window as any).__PV_STATE.draft === value,
			original,
		);
		expect(await input.inputValue()).toBe(original);
		expect(await frame.locator(".pv-header h1").textContent()).toBe(
			direct.title,
		);
		expect(await frame.getByRole("dialog").count()).toBe(0);
		const accepted = structuredClone(direct);
		accepted.title = "Accepted imported document";
		accepted.provenance = "provided";
		await input.fill(original + "\n");
		await frame.evaluate(() => (window as any).__PV_FLUSH());
		const before = await snapshot(frame);
		await importDocument(frame, accepted);
		await frame
			.getByRole("dialog", { name: "Replace the current draft?" })
			.waitFor();
		expect(await snapshot(frame)).toEqual(before);
		// Rejection must also preserve an already offered valid replacement.
		await importDocument(frame, nearLimitDocument());
		await frame
			.getByRole("alert")
			.filter({ hasText: "The draft exceeds the 96 KiB limit." })
			.waitFor();
		expect(await snapshot(frame)).toEqual(before);
		expect(
			await frame
				.getByRole("dialog", { name: "Replace the current draft?" })
				.count(),
		).toBe(1);
		await frame
			.getByRole("button", { name: "Keep editing", exact: true })
			.click();
		expect(await snapshot(frame)).toEqual(before);
		await importDocument(frame, accepted);
		await frame
			.getByRole("button", { name: "Replace draft", exact: true })
			.click();
		expect(await frame.locator(".pv-header h1").textContent()).toBe(
			accepted.title,
		);
		const expected = JSON.stringify(accepted, null, 2);
		expect(await input.inputValue()).toBe(expected);
		expect(await frame.getByRole("alert").count()).toBe(0);
		await frame.waitForFunction(
			(value) => (window as any).__PV_STATE.draft === value,
			expected,
		);
		await frame.evaluate(() => (window as any).__PV_FLUSH());
		expect(await exportDraft(frame)).toBe(expected);
		frame = await fixture.reload();
		await frame.getByRole("button", { name: "Edit", exact: true }).click();
		expect(await frame.locator("#pv-json").inputValue()).toBe(expected);
		await frame.getByRole("button", { name: "Save", exact: true }).click();
		await frame.waitForFunction(
			(value) => (window as any).__PV_STATE.document?.title === value,
			accepted.title,
		);
		expect(
			await frame.evaluate(() => (window as any).__PV_STATE.document),
		).toEqual(accepted);
		expect(JSON.parse(await exportDraft(frame))).toEqual(accepted);
		expect(fixture.errors).toEqual([]);
		expect(fixture.unexpected).toEqual([]);
	} finally {
		await fixture.close();
	}
});

it("rejected import preserves pending autosave and unconfirmed save identity", async () => {
	const fixture = await visualFixture();
	const { frame } = fixture;
	try {
		await frame.getByRole("button", { name: "Edit", exact: true }).click();
		const input = frame.locator("#pv-json"),
			original = await input.inputValue();
		await fixture.page.clock.install({
			time: new Date("2026-01-01T00:00:00Z"),
		});
		await fixture.page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
		// FileReader finishes within the original edit's 250ms autosave window.
		await input.fill(original + "\n");
		await importDocument(frame, nearLimitDocument());
		await frame.getByRole("alert").waitFor();
		expect(await frame.getByRole("dialog").count()).toBe(0);
		expect(await input.inputValue()).toBe(original + "\n");
		expect(
			await frame.evaluate(() => (window as any).__PV_STATE.calls),
		).toEqual([]);
		await fixture.page.clock.runFor(350);
		await fixture.page.clock.resume();
		await frame.waitForFunction(
			(value) => (window as any).__PV_STATE.draft === value,
			original + "\n",
		);
		const state = await frame.evaluate(() =>
			structuredClone((window as any).__PV_STATE),
		);
		expect(state.calls).toHaveLength(1);
		expect(state.calls[0]).toMatchObject({
			action: "draft",
			baseRevision: 0,
			draft: original + "\n",
		});
		expect(await exportDraft(frame)).toBe(original + "\n");
		await frame.evaluate(() => {
			(window as any).__PV_FAIL_COMMIT = true;
		});
		await frame.getByRole("button", { name: "Save", exact: true }).click();
		await frame
			.getByRole("button", { name: "Retry exact save", exact: true })
			.waitFor();
		const failed = await snapshot(frame);
		expect(
			await frame
				.getByRole("button", { name: "Import JSON", exact: true })
				.isDisabled(),
		).toBe(true);
		// An already selected file may complete after Save becomes unconfirmed.
		await importDocument(frame, nearLimitDocument());
		await frame
			.getByRole("alert")
			.filter({ hasText: "The draft exceeds the 96 KiB limit." })
			.waitFor();
		expect(await snapshot(frame)).toEqual(failed);
		const late = JSON.parse(original) as DiagramDocument;
		late.title = "Late import must remain held";
		await importDocument(frame, late);
		await frame.waitForFunction(
			() =>
				(document.querySelector('input[type="file"]') as HTMLInputElement)
					.value === "",
		);
		expect(await snapshot(frame)).toEqual(failed);
		expect(await frame.getByRole("dialog").count()).toBe(0);
		await frame
			.getByRole("button", { name: "Retry exact save", exact: true })
			.click();
		await frame.waitForFunction(
			() => (window as any).__PV_STATE.attempts.length === 3,
		);
		const retried = await frame.evaluate(() =>
			structuredClone((window as any).__PV_STATE),
		);
		expect(retried.attempts[2]).toEqual(failed.state.attempts[1]);
		expect(retried.attempts[2]).toEqual(retried.attempts[1]);
		expect(retried.calls).toHaveLength(2);
		expect(retried.revision).toBe(2);
		expect(retried.receipts[retried.attempts[1].requestId]).toMatchObject({
			revision: 2,
		});
		expect(fixture.errors).toEqual([]);
	} finally {
		await fixture.close();
	}
});

it("keeps a preexisting compact near-limit durable record and raw draft recoverable", async () => {
	const document = nearLimitDocument(),
		raw = JSON.stringify(document);
	const fixture = await visualFixture({
		documentId: "main",
		revision: 7,
		document,
		draft: raw,
	});
	try {
		const { frame } = fixture;
		await frame.getByRole("button", { name: "Edit", exact: true }).click();
		expect(await frame.locator("#pv-json").inputValue()).toBe(raw);
		expect(await frame.locator(".pv-header h1").textContent()).toBe(
			document.title,
		);
		await frame.evaluate(() => (window as any).__PV_FLUSH());
		expect(await exportDraft(frame)).toBe(raw);
		const state = await frame.evaluate(() => (window as any).__PV_STATE);
		expect(state).toMatchObject({
			revision: 7,
			document,
			draft: raw,
			calls: [],
			attempts: [],
		});
		expect(fixture.errors).toEqual([]);
	} finally {
		await fixture.close();
	}
});
