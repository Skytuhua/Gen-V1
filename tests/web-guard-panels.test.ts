import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { basename } from "node:path";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";

// Exercises the real components in a browser DOM; only the two API boundary
// modules are substituted (same convention as credential-entry-ime and
// files-read-commit-owner fixtures).
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ControlConsentPanel} from './apps/web/src/ControlConsentPanel';
import {OperationProjectTrust} from './apps/web/src/OperationProjectTrust';
window.commands=[];window.decisions=[];window.revocations=[];window.fetchUrls=[];window.readiness=null;
window.fetch = async (url)=>{window.fetchUrls.push(String(url));return {ok:true,status:200,json:async()=>window.controlResponse};};
function App(){return <>
 <OperationProjectTrust operation={window.operation} owner={window.owner} ownerKey="k1" onReady={v=>{window.readiness=v;}}/>
 <ControlConsentPanel threadId="t1"/>
</>;}
createRoot(document.getElementById('root')).render(<App/>);
`;

const apiStub = `
export function authenticated(fn){return fn();}
export const csrfToken='synthetic';
export async function read(response){return response.json();}
export async function command(type,payload,threadId){window.commands.push({type,payload,threadId});return {result:{control:window.controlModel}};}
export class ApiError extends Error{constructor(code,message){super(message);this.code=code;}}
`;
const trustApiStub = `
export const getOperationProjectTrust=async()=>window.trustView;
export const getOperationProjectTrustStatus=async()=>window.trustStatus;
export const decideOperationProjectTrust=async(args)=>{window.decisions.push(args);return {};};
export const revokeOperationProjectTrust=async(args)=>{window.revocations.push(args);return {};};
`;

const unavailableMode = { state: "unavailable", reason: "No approved driver", modes: [
	{ mode: "FRESH_VERIFICATION_BROWSER", reason: "No driver" },
	{ mode: "CONSENTED_EXISTING_TAB", reason: "No driver" },
] };
const consentModel = { state: "consent", modes: [], pendingConsent: {
	mode: "CONSENTED_EXISTING_TAB", requestedObserve: true,
	requestedOperations: ["click", "type"], allowedOrigins: ["https://example.test"],
} };
const activeModel = { state: "active", modes: [], expiryMs: 45_000, activeGrant: {
	mode: "FRESH_VERIFICATION_BROWSER",
	target: { kind: "BROWSER_TAB" },
	capturePermission: true,
	permittedOperations: ["click"],
	allowedOrigins: ["https://example.test"],
} };
const trustView = (decision: string, enabled = true) => ({
	enabled, reviewId: "rv-1", expiresAt: "2100-01-01T00:00:00.000Z",
	current: { trustId: "trust-1", revision: 5, decision },
	owner: { threadId: "t1", runId: "run-1", epoch: 1, accountBinding: null, projectId: null, workspaceId: null },
	root: { canonicalPath: "/project", identity: { dev: 1, ino: 2 } },
	execution: { label: "Unrestricted host", executable: { path: "/bin/tool", sha256: "a".repeat(64) }, cwd: "/project", argv: ["tool"] },
	approvedDigests: [{ kind: "config", path: "/project/tool.json", sha256: "b".repeat(64) }],
	requestedScope: { read: true, write: true, network: "none" },
});

describe("web guard panels", () => {
	let browser: Browser, script: string;
	beforeAll(async () => {
		script = (await build({
			stdin: { contents: fixture, resolveDir: process.cwd(), loader: "tsx" },
			bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
			loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
			plugins: [{
				name: "stub-api-boundaries",
				setup(plugin) {
					plugin.onResolve({ filter: /^\.\/api$/ }, (args) =>
						basename(args.importer) === "ControlConsentPanel.tsx" ? { path: "api", namespace: "stub" } : undefined);
					plugin.onResolve({ filter: /^\.\/operation-project-trust-api$/ }, (args) =>
						basename(args.importer) === "OperationProjectTrust.tsx" ? { path: "trust-api", namespace: "stub" } : undefined);
					plugin.onLoad({ filter: /^api$/, namespace: "stub" }, () => ({ loader: "ts", contents: apiStub }));
					plugin.onLoad({ filter: /^trust-api$/, namespace: "stub" }, () => ({ loader: "ts", contents: trustApiStub }));
				},
			}],
		})).outputFiles[0]!.text;
		browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
	});
	afterAll(async () => { await browser?.close(); });
	const render = async (seed: Record<string, unknown>): Promise<Page> => {
		const page = await browser.newPage();
		await page.setContent('<div id="root"></div>');
		await page.evaluate(
			(values) => Object.assign(window, {
				operation: { threadId: "t1", id: "op-1", revision: 3, status: "running" },
				owner: undefined,
			}, values),
			seed,
		);
		await page.addScriptTag({ content: script });
		return page;
	};

	it("consent: stays silent while control is unavailable without pending consent", async () => {
		const page = await render({ controlResponse: { control: { ...unavailableMode, pendingConsent: null } }, controlModel: null, trustView: trustView("required", false) });
		await expect.poll(() => page.evaluate(() => (window as any).fetchUrls.length)).toBeGreaterThan(0);
		await browserExpect(page.locator(".control-consent-panel")).toHaveCount(0);
		await page.close();
	});
	it("consent: unavailable with pending consent lists per-mode reasons and disables Stop", async () => {
		const page = await render({ controlResponse: { control: { ...unavailableMode, pendingConsent: consentModel.pendingConsent } }, controlModel: null, trustView: trustView("required", false) });
		const panel = page.locator(".control-consent-panel");
		await browserExpect(panel).toContainText("Unavailable");
		await browserExpect(panel).toContainText("Fresh verification browser: unavailable (No driver)");
		await browserExpect(panel.getByRole("button", { name: "Stop" })).toBeDisabled();
		await page.close();
	});
	it("consent: pending consent names mode, observe/interact and origins; Stop stays disabled", async () => {
		const page = await render({ controlResponse: { control: consentModel }, controlModel: null, trustView: trustView("required", false) });
		const panel = page.locator(".control-consent-panel");
		await browserExpect(panel).toContainText("Needs permission");
		await browserExpect(panel).toContainText("Consented existing tab");
		await browserExpect(panel).toContainText("Observe: requested · Interact: click, type");
		await browserExpect(panel).toContainText("Origins: https://example.test");
		await browserExpect(panel.getByRole("button", { name: "Stop" })).toBeDisabled();
		await page.close();
	});
	it("consent: an active grant shows the controlled target and Stop sends control.stop", async () => {
		const page = await render({ controlResponse: { control: activeModel }, controlModel: activeModel, trustView: trustView("required", false) });
		const panel = page.locator(".control-consent-panel");
		await browserExpect(panel).toContainText("Controlled tab");
		await browserExpect(panel).toContainText("Observe allowed · Interact click");
		await panel.getByRole("button", { name: "Stop" }).click();
		await expect.poll(() => page.evaluate(() => (window as any).commands)).toEqual([{ type: "control.stop", payload: {}, threadId: "t1" }]);
		await page.close();
	});

	it("project trust: a disabled review renders nothing", async () => {
		const page = await render({ controlResponse: { control: { ...unavailableMode, pendingConsent: null } }, trustView: trustView("required", false) });
		await expect.poll(() => page.evaluate(() => (window as any).readiness?.key)).toBe("k1");
		await browserExpect(page.locator(".project-trust-summary")).toHaveCount(0);
		await page.close();
	});
	it("project trust: a required review shows the label and enables approval only after the host checkbox", async () => {
		const page = await render({ controlResponse: { control: { ...unavailableMode, pendingConsent: null } }, trustView: trustView("required") });
		const panel = page.locator(".project-trust-summary");
		await browserExpect(panel).toContainText("Project trust required");
		await browserExpect(page.getByRole("button", { name: "Revoke project trust" })).toHaveCount(0);
		await panel.getByRole("button", { name: "Review project trust" }).click();
		const dialog = page.locator(".project-trust-dialog");
		const trust = dialog.getByRole("button", { name: "Trust these bytes" });
		await browserExpect(trust).toBeDisabled();
		await dialog.getByRole("checkbox").check();
		await browserExpect(trust).toBeEnabled();
		await trust.click();
		await expect.poll(() => page.evaluate(() => (window as any).decisions)).toEqual([{
			threadId: "t1", operationId: "op-1", operationRevision: 3,
			reviewId: "rv-1", expectedTrustRevision: 5, decision: "trusted", executionMode: "TRUSTED_HOST",
		}]);
		await page.close();
	});
	it("project trust: a trusted decision offers revoke with the recorded trust identity", async () => {
		const page = await render({ controlResponse: { control: { ...unavailableMode, pendingConsent: null } }, trustView: trustView("trusted") });
		const panel = page.locator(".project-trust-summary");
		await browserExpect(panel).toContainText("Trusted reviewed bytes");
		await expect.poll(() => page.evaluate(() => (window as any).readiness)).toEqual({ key: "k1", allowed: true });
		await panel.getByRole("button", { name: "Revoke project trust" }).click();
		await expect.poll(() => page.evaluate(() => (window as any).revocations)).toEqual([{
			threadId: "t1", operationId: "op-1", operationRevision: 3,
			trustId: "trust-1", expectedTrustRevision: 5,
		}]);
		await page.close();
	});
});
