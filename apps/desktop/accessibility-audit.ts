import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AccessibilityAuditOutcome } from "../../packages/desktop-contract/index.ts";
import { normalizeAudit } from "./accessibility-normalize.ts";

export const AUDIT_WORLD_ID = 1099;
export const AUDIT_RUNNER = `(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']},resultTypes:['violations'],iframes:false,elementRef:false,selectors:true,ancestry:false,xpath:false,absolutePaths:false});return {version:axe.version,url:location.href,title:document.title,width:innerWidth,height:innerHeight,violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,description:v.description,helpUrl:v.helpUrl,tags:v.tags,nodes:v.nodes.map(n=>({target:n.target,html:n.html,failureSummary:n.failureSummary}))}))};})()`;

const LOAD_TIMEOUT_MS = 30_000,
	RUN_TIMEOUT_MS = 30_000,
	IDLE_WINDOW_MS = 500,
	IDLE_BUDGET_MS = 5_000;

export interface AuditWebContents {
	executeJavaScriptInIsolatedWorld(
		world: number,
		scripts: { code: string }[],
	): Promise<unknown>;
	isDestroyed(): boolean;
	getURL(): string;
	loadURL(url: string): Promise<unknown>;
	on(event: string, listener: (...args: never[]) => void): void;
	removeListener?(event: string, listener: (...args: never[]) => void): void;
	setWindowOpenHandler?(
		handler: (details: { url: string }) => { action: "deny" },
	): void;
	setWebRTCIPHandlingPolicy?(policy: string): void;
	enableDeviceEmulation?(parameters: unknown): void;
}
export interface AuditSession {
	setPermissionRequestHandler(
		handler:
			| null
			| ((
					contents: unknown,
					permission: string,
					callback: (granted: boolean) => void,
			  ) => void),
	): void;
	setPermissionCheckHandler(
		handler: null | ((...args: unknown[]) => boolean),
	): void;
	setProxy(config: { mode: string }): Promise<unknown>;
	clearStorageData(): Promise<unknown>;
	clearCache(): Promise<unknown>;
	on(
		event: string,
		listener: (event: { preventDefault(): void }) => void,
	): void;
	webRequest: {
		onBeforeRequest(
			listener: (
				details: { url: string },
				callback: (response: { cancel?: boolean }) => void,
			) => void,
		): void;
		onCompleted(listener: (details: { url: string }) => void): void;
		onErrorOccurred(listener: (details: { url: string }) => void): void;
	};
}
export interface AuditWindow {
	webContents: AuditWebContents;
	isDestroyed(): boolean;
	destroy(): void;
}
export interface AuditHost {
	createSession(partition: string): AuditSession;
	createWindow(options: Record<string, unknown>): AuditWindow;
}

export interface RawAudit {
	version: string;
	url: string;
	title: string;
	width: number;
	height: number;
	violations: unknown[];
}
export type AuditRunResult =
	| { ok: true; raw: RawAudit }
	| AccessibilityAuditOutcome;

export function auditFailed(
	code:
		| "LOAD_FAILED"
		| "LOAD_TIMEOUT"
		| "RUN_TIMEOUT"
		| "PAGE_GONE"
		| "DISABLED"
		| "ASSET_MISSING"
		| "BUSY"
		| "NO_PAGE"
		| "INVALID_URL",
	message: string,
): AccessibilityAuditOutcome {
	return { status: "failed", code, message };
}

/** Reads the bundled axe source once; the caller maps absence to ASSET_MISSING. */
export async function loadAxeSource(
	resolveModule: () => string,
): Promise<string> {
	const text = await readFile(resolveModule(), "utf8");
	if (text.length < 100 * 1024 || text.length > 2 * 1024 * 1024)
		throw Error("Unexpected axe bundle size");
	return text;
}

/** Runs axe in the fixed isolated world on an existing page; raw shape is the
 * RUNNER return value. Cancel/timeout simply stop waiting: for in-place checks
 * axe finishes harmlessly in the background (DESIGN §4). */
export async function runAudit(
	contents: AuditWebContents,
	axeSource: string,
	signal: AbortSignal,
	timeoutMs = RUN_TIMEOUT_MS,
): Promise<AuditRunResult> {
	if (signal.aborted) return { status: "cancelled" };
	if (contents.isDestroyed())
		return auditFailed("PAGE_GONE", "The page stopped while being checked.");
	let timer: ReturnType<typeof setTimeout> | undefined,
		onAbort: (() => void) | undefined;
	try {
		const run = contents.executeJavaScriptInIsolatedWorld(AUDIT_WORLD_ID, [
			{ code: axeSource },
			{ code: AUDIT_RUNNER },
		]);
		const outcome = await new Promise<unknown>((resolve, reject) => {
			timer = setTimeout(() => reject(Error("run-timeout")), timeoutMs);
			onAbort = () => reject(Error("aborted"));
			signal.addEventListener("abort", onAbort, { once: true });
			run.then(resolve, reject);
		});
		const raw = outcome as RawAudit;
		if (
			!raw ||
			typeof raw !== "object" ||
			Array.isArray(raw) ||
			!Array.isArray(raw.violations)
		)
			return auditFailed(
				"PAGE_GONE",
				"The checks returned an unexpected result.",
			);
		return { ok: true, raw };
	} catch (error) {
		if (signal.aborted) return { status: "cancelled" };
		if (error instanceof Error && error.message === "run-timeout")
			return auditFailed("RUN_TIMEOUT", "The checks took too long.");
		return auditFailed(
			"PAGE_GONE",
			"The checks returned an unexpected result.",
		);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}

function sameOrigin(url: string, origin: string): boolean {
	try {
		return new URL(url).origin === origin;
	} catch {
		return false;
	}
}
/** R04 request filter: same origin, same-host websockets and inline schemes only. */
export function auditRequestAllowed(raw: string, origin: string): boolean {
	try {
		const url = new URL(raw);
		if (["about:", "data:", "blob:"].includes(url.protocol)) return true;
		if (
			(url.protocol === "ws:" || url.protocol === "wss:") &&
			url.host === new URL(origin).host
		)
			return true;
		return url.origin === origin;
	} catch {
		return (
			raw.startsWith("about:") ||
			raw.startsWith("data:") ||
			raw.startsWith("blob:")
		);
	}
}

export async function runLocalAudit(
	target: URL,
	viewport: "desktop" | "mobile",
	axeSource: string,
	signal: AbortSignal,
	host: AuditHost,
): Promise<AccessibilityAuditOutcome> {
	if (signal.aborted) return { status: "cancelled" };
	const session = host.createSession("a11y-audit-" + randomUUID());
	let blockedRequests = 0,
		lastRequestAt = 0,
		pendingRequests = 0;
	session.setPermissionRequestHandler((_c, _p, callback) => callback(false));
	session.setPermissionCheckHandler(() => false);
	session.on("will-download", (event) => event.preventDefault());
	session.webRequest.onBeforeRequest((details, callback) => {
		lastRequestAt = Date.now();
		if (auditRequestAllowed(details.url, target.origin)) {
			pendingRequests++;
			callback({});
		} else {
			blockedRequests++;
			callback({ cancel: true });
		}
	});
	session.webRequest.onCompleted(() => {
		lastRequestAt = Date.now();
		pendingRequests = Math.max(0, pendingRequests - 1);
	});
	session.webRequest.onErrorOccurred(() => {
		lastRequestAt = Date.now();
		pendingRequests = Math.max(0, pendingRequests - 1);
	});
	await session.setProxy({ mode: "direct" });
	const width = viewport === "mobile" ? 390 : 1280,
		height = viewport === "mobile" ? 844 : 800;
	const window_ = host.createWindow({
		show: false,
		width,
		height,
		paintWhenInitiallyHidden: true,
		webPreferences: {
			session,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
			spellcheck: false,
			backgroundThrottling: false,
		},
	});
	const contents = window_.webContents;
	contents.setWindowOpenHandler?.(() => ({ action: "deny" }));
	contents.setWebRTCIPHandlingPolicy?.("disable_non_proxied_udp");
	const preventLeave = (event: { preventDefault(): void }, url: string) => {
		if (!sameOrigin(url, target.origin)) event.preventDefault();
	};
	contents.on("will-attach-webview", (event: never) => {
		(event as { preventDefault: () => void }).preventDefault();
	});
	contents.on("will-navigate", (event: never, url: string) =>
		preventLeave(event as { preventDefault: () => void }, url),
	);
	contents.on("will-redirect", (event: never, url: string) =>
		preventLeave(event as { preventDefault: () => void }, url),
	);
	if (viewport === "mobile")
		contents.enableDeviceEmulation?.({
			screenPosition: "mobile",
			screenSize: { width: 390, height: 844 },
			viewSize: { width: 390, height: 844 },
			deviceScaleFactor: 3,
			viewPosition: { x: 0, y: 0 },
			scale: 1,
		});
	const startedAt = new Date().toISOString(),
		started = Date.now();
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("load-timeout")),
				LOAD_TIMEOUT_MS,
			);
			const abort = () => {
				clearTimeout(timer);
				reject(Error("aborted"));
			};
			signal.addEventListener("abort", abort, { once: true });
			contents.loadURL(target.href).then(
				() => {
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
					resolve();
				},
				(error: unknown) => {
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
					reject(error instanceof Error ? error : Error(String(error)));
				},
			);
		});
		// Network idle: quiet for 500 ms, capped at 5 s extra (DESIGN §4).
		const idleDeadline = Date.now() + IDLE_BUDGET_MS;
		while (Date.now() < idleDeadline) {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(50, idleDeadline - Date.now())),
			);
			if (
				pendingRequests === 0 &&
				Date.now() - lastRequestAt >= IDLE_WINDOW_MS
			)
				break;
		}
		if (signal.aborted) return { status: "cancelled" };
		const run = await runAudit(contents, axeSource, signal);
		if (!("ok" in run)) return run;
		const normalized = normalizeAudit(
			{ version: run.raw.version, violations: run.raw.violations },
			{
				kind: "local",
				url: run.raw.url || target.href,
				title: run.raw.title || target.hostname,
				width: run.raw.width || width,
				height: run.raw.height || height,
				startedAt,
				durationMs: Date.now() - started,
				blockedRequests,
			},
		);
		return (
			normalized ??
			auditFailed("PAGE_GONE", "The checks returned an unexpected result.")
		);
	} catch (error) {
		if (signal.aborted) return { status: "cancelled" };
		return error instanceof Error && error.message === "load-timeout"
			? auditFailed("LOAD_TIMEOUT", "The page took too long to load.")
			: auditFailed(
					"LOAD_FAILED",
					`Couldn't load ${target.origin}: ${String(error instanceof Error ? error.message : error).slice(0, 200)} Is the dev server running?`,
				);
	} finally {
		if (!window_.isDestroyed()) window_.destroy();
		await session.clearStorageData().catch(() => {});
		await session.clearCache().catch(() => {});
	}
}
