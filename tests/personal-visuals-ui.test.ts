import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { resolve } from "node:path";

it("keeps JSON typing focused through autosave and renders source labels as text inside an opaque frame", async () => {
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
	const bridge = `window.__PV_STATE={revision:0,document:null,draft:null,calls:[],receipts:{}};window.GenPluginUI={...window.__PV_SHARED,registerPlugin:(manifest,registration)=>{window.__PV_REGISTRATION={manifest,registration};},registerEditorHandoff:(_id,guard)=>{window.__PV_FLUSH=guard;return()=>{};},pluginReady:()=>window.__PV_READY=true,pluginRequest:async(operation,input)=>{const state=window.__PV_STATE;if(operation==='visual.document.read')return{documentId:'main',revision:state.revision,document:state.document,draft:state.draft};if(operation!=='visual.document.write')throw Error('Unknown operation');await new Promise(resolve=>setTimeout(resolve,30));if(state.receipts[input.requestId])return state.receipts[input.requestId];if(input.baseRevision!==state.revision)throw Error('Revision conflict');state.calls.push(input);state.revision++;if(input.action==='draft')state.draft=input.draft;else{state.document=input.document;state.draft=null;}const receipt={documentId:'main',revision:state.revision,requestId:input.requestId};state.receipts[input.requestId]=receipt;if(input.action==='commit'&&window.__PV_FAIL_COMMIT){window.__PV_FAIL_COMMIT=false;throw Error('Synthetic lost commit response');}return receipt;}};`;
	const script = (value: string) => value.replace(/<\/script/gi, "<\\/script"),
		child = `<!doctype html><html><head><meta name="gen-plugin-id" content="personal-visuals"><style>${css}</style></head><body><div id="root"></div><script>${script(shared.outputFiles[0].text)}</script><script>${script(bridge)}</script><script>${script(javascript)}</script></body></html>`;
	const html = `<!doctype html><html><body style="margin:0"><iframe title="Personal Visuals fixture" sandbox="allow-scripts" style="width:1100px;height:760px;border:0" srcdoc="${child.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe></body></html>`;
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
			return route.fulfill({ contentType: "text/html", body: html });
		unexpected.push(route.request().url());
		return route.abort();
	});
	try {
		await page.goto("http://127.0.0.1/personal-visuals-test");
		const frame = page.frames().find((value) => value.parentFrame())!;
		await frame.waitForSelector(".pv-header h1");
		await frame.waitForFunction(() => Boolean((window as any).__PV_READY));
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
		const document = JSON.parse(await input.inputValue());
		document.title = "Recovered visual document";
		document.nodes[0].label = '<img src="https://invalid.example/image">';
		const value = JSON.stringify(document, null, 2);
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
		document.title = "Saved after exact retry";
		await input.fill(JSON.stringify(document, null, 2));
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
		await context.close();
		await browser.close();
	}
}, 15000);
