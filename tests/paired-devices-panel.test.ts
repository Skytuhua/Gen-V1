import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { basename } from "node:path";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";

// Renders the real PairedDevicesPanel in a browser DOM with only the ./api
// boundary stubbed — same convention as web-guard-panels.test.ts (#1360).
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PairedDevicesPanel} from './apps/web/src/PairedDevicesPanel';
window.posts=[];window.fetches=[];
window.fetch = async (url,init)=>{const record={url:String(url),method:(init&&init.method)||'GET',body:init&&init.body?JSON.parse(init.body):undefined};(record.method==='GET'?window.fetches:window.posts).push(record);return {ok:true,status:200,json:async()=>String(url)==='/api/devices'?window.surface:(window.postResponse??{})};};
createRoot(document.getElementById('root')).render(<PairedDevicesPanel/>);
`;
const apiStub = `
export function authenticated(fn){return fn();}
export const csrfToken='synthetic';
export async function read(response){return response.json();}
export class ApiError extends Error{constructor(code,message){super(message);this.code=code;}}
`;

const emptySurface = { devices: [], pending: [], readOnly: true, submitInputAvailable: false };
const device = { grantId: 'g-1', deviceId: 'dev-9', label: 'Test laptop', fingerprint: 'fp-123', scopes: ['VIEW_TASKS'], approvedProjects: ['personal'], issuedAt: '2026-11-01T00:00:00.000Z', expiresAt: null, revokedAt: null, lastSeenAt: null, grantGeneration: 1, state: 'active' };
const revokedDevice = { ...device, grantId: 'g-2', label: 'Old tablet', state: 'revoked', revokedAt: '2026-11-10T00:00:00.000Z' };
const pendingEvidence = { pairingId: 'pair-1', deviceIdentity: { deviceId: 'dev-7', label: 'Phone', fingerprint: 'fp-777' }, requestedScopes: ['VIEW_TASKS', 'VIEW_EVIDENCE'], requestedProjects: ['personal'], claimedAt: null, expiresAt: '2100-01-01T00:00:00.000Z' };
const pendingTasks = { pairingId: 'pair-2', deviceIdentity: { deviceId: 'dev-8', label: 'Watch', fingerprint: null }, requestedScopes: ['VIEW_TASKS'], requestedProjects: [], claimedAt: null, expiresAt: '2100-01-01T00:00:00.000Z' };

describe("paired devices panel", () => {
	let browser: Browser, script: string;
	beforeAll(async () => {
		script = (await build({
			stdin: { contents: fixture, resolveDir: process.cwd(), loader: "tsx" },
			bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
			loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' },
			plugins: [{
				name: "stub-api-boundary",
				setup(plugin) {
					plugin.onResolve({ filter: /^\.\/api$/ }, (args) =>
						basename(args.importer) === "PairedDevicesPanel.tsx" ? { path: "api", namespace: "stub" } : undefined);
					plugin.onLoad({ filter: /^api$/, namespace: "stub" }, () => ({ loader: "ts", contents: apiStub }));
				},
			}],
		})).outputFiles[0]!.text;
		browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
	});
	afterAll(async () => { await browser?.close(); });
	const render = async (seed: Record<string, unknown>): Promise<Page> => {
		const page = await browser.newPage();
		await page.setContent('<div id="root"></div>');
		await page.evaluate((values) => Object.assign(window, { surface: { devices: [], pending: [], readOnly: true, submitInputAvailable: false }, postResponse: undefined }, values), seed);
		await page.addScriptTag({ content: script });
		await browserExpect(page.locator(".paired-devices")).toBeVisible();
		return page;
	};
	const posts = (page: Page) => page.evaluate(() => (window as unknown as { posts: { url: string; method: string; body?: unknown }[] }).posts);

	it("renders the empty state and never offers mutation controls", async () => {
		const page = await render({});
		await browserExpect(page.getByText("No paired devices.")).toBeVisible();
		await browserExpect(page.getByRole("button", { name: "Pair a device" })).toBeEnabled();
		await page.close();
	});

	it("renders active and revoked devices with read-only copy; revoke only for active", async () => {
		const page = await render({ surface: { ...emptySurface, devices: [device, revokedDevice] } });
		await browserExpect(page.getByText("Test laptop")).toBeVisible();
		await browserExpect(page.getByText("Fingerprint: fp-123").first()).toBeVisible();
		await browserExpect(page.getByText("Old tablet (revoked)")).toBeVisible();
		expect(await page.getByRole("button", { name: "Revoke" }).count()).toBe(1);
		await page.getByRole("button", { name: "Revoke" }).click();
		await expect.poll(() => posts(page)).toContainEqual(expect.objectContaining({ url: "/api/devices/g-1/revoke", method: "POST" }));
		await page.close();
	});

	it("gates evidence approval on the explicit consent checkbox", async () => {
		const page = await render({ surface: { ...emptySurface, pending: [pendingEvidence] } });
		const approve = page.getByRole("button", { name: "Approve read-only access" });
		await browserExpect(approve).toBeDisabled();
		await page.getByLabel("Explicitly consent to evidence read access").check();
		await browserExpect(approve).toBeEnabled();
		await approve.click();
		await expect.poll(() => posts(page)).toContainEqual(expect.objectContaining({
			url: "/api/device-pairing/pair-1/confirm", method: "POST",
			body: { scopes: ["VIEW_TASKS", "VIEW_EVIDENCE"], projects: ["personal"], evidenceConsent: true },
		}));
		await page.close();
	});

	it("approves a tasks-only request without the evidence checkbox and denies on demand", async () => {
		const page = await render({ surface: { ...emptySurface, pending: [pendingTasks] } });
		expect(await page.getByLabel("Explicitly consent to evidence read access").count()).toBe(0);
		await page.getByRole("button", { name: "Approve read-only access" }).click();
		await expect.poll(() => posts(page)).toContainEqual(expect.objectContaining({
			url: "/api/device-pairing/pair-2/confirm", method: "POST",
			body: { scopes: ["VIEW_TASKS"], projects: [] },
		}));
		await page.close();
		const denyPage = await render({ surface: { ...emptySurface, pending: [pendingTasks] } });
		await denyPage.getByRole("button", { name: "Deny" }).click();
		await expect.poll(() => posts(denyPage)).toContainEqual(expect.objectContaining({ url: "/api/device-pairing/pair-2/deny", method: "POST" }));
		await denyPage.close();
	});

	it("issues a pairing challenge and shows the one-time code", async () => {
		const page = await render({ postResponse: { pairingId: "pair-9", challenge: "X7-K2", expiresAt: "2100-01-01T00:00:00.000Z" } });
		await page.getByRole("button", { name: "Pair a device" }).click();
		await expect.poll(() => posts(page)).toContainEqual(expect.objectContaining({ url: "/api/device-pairing/challenges", method: "POST" }));
		await browserExpect(page.locator("[data-challenge]")).toHaveText("X7-K2");
		await page.close();
	});
});
