import { describe, expect, it } from "vitest";
import { localAuditUrl } from "../apps/web/src/accessibility/local-url.ts";
import {
	type AuditUiState,
	auditReducer,
} from "../apps/web/src/accessibility/useAccessibilityAudit.ts";
import type { AccessibilityAuditOutcome } from "../packages/desktop-contract/index.ts";

const result = {
	status: "completed",
	target: { kind: "browser", url: "https://example.com", title: "x" },
	viewport: { width: 1280, height: 800 },
	axeVersion: "4.14.1",
	standard: "WCAG 2.2 A/AA",
	startedAt: "2026-11-21T00:00:00Z",
	durationMs: 10,
	counts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
	elementCount: 0,
	rules: [],
	blockedRequests: 0,
	truncated: false,
} satisfies AccessibilityAuditOutcome;

describe("auditReducer", () => {
	const running: AuditUiState = { status: "running", phase: "checking" };
	it("idle -> running with target phase", () => {
		expect(
			auditReducer({ status: "idle" }, { type: "run", phase: "loading" }),
		).toEqual({ status: "running", phase: "loading" });
	});
	it("running -> done on completed outcome", () => {
		expect(auditReducer(running, { type: "outcome", outcome: result })).toEqual(
			{
				status: "done",
				result,
			},
		);
	});
	it("running -> failed on failed outcome", () => {
		const failed: AccessibilityAuditOutcome = {
			status: "failed",
			code: "LOAD_TIMEOUT",
			message: "The page took too long to load.",
		};
		expect(auditReducer(running, { type: "outcome", outcome: failed })).toEqual(
			{
				status: "failed",
				code: "LOAD_TIMEOUT",
				message: "The page took too long to load.",
			},
		);
	});
	it("running -> cancelled on cancel and on cancelled outcome", () => {
		expect(auditReducer(running, { type: "cancel" })).toEqual({
			status: "cancelled",
		});
		expect(
			auditReducer(running, {
				type: "outcome",
				outcome: { status: "cancelled" },
			}),
		).toEqual({ status: "cancelled" });
	});
	it("ignores outcomes that arrive after cancel", () => {
		const cancelled = auditReducer(running, { type: "cancel" });
		expect(
			auditReducer(cancelled, { type: "outcome", outcome: result }),
		).toEqual(cancelled);
	});
	it("cancel is a no-op outside running", () => {
		expect(auditReducer({ status: "idle" }, { type: "cancel" })).toEqual({
			status: "idle",
		});
	});
});

describe("localAuditUrl (R03 renderer check)", () => {
	it("accepts loopback http/https addresses", () => {
		for (const url of [
			"http://localhost:5173/",
			"http://127.0.0.1:3000/x?y",
			"http://[::1]:8080/",
			"https://localhost/",
			"http://localhost:65535/",
		])
			expect(localAuditUrl(url).href).toBeTruthy();
	});
	it("rejects non-loopback, credentials, files and bad ports", () => {
		for (const url of [
			"http://example.com",
			"http://192.168.1.2:3000",
			"http://localhost.evil.com",
			"file:///etc/passwd",
			"ftp://localhost/",
			"http://user:pw@localhost:3000",
			"http://localhost:0",
			"http://localhost:70000",
			"not a url",
		])
			expect(() => localAuditUrl(url)).toThrow(
				"Use a localhost address. Public pages can be checked from the browser with Check this page.",
			);
	});
	it("strips the fragment and enforces the length limit", () => {
		expect(localAuditUrl("http://localhost:5173/#frag").hash).toBe("");
		expect(() => localAuditUrl("http://localhost/" + "a".repeat(2048))).toThrow(
			"localhost",
		);
	});
});
