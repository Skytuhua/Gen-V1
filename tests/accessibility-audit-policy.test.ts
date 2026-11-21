import { describe, expect, it } from "vitest";
import {
	loopbackAuditUrl,
	parseAccessibilityAuditCommand,
	remoteBrowserUrl,
} from "../apps/desktop/window-policy.ts";

describe("accessibility audit command parsing", () => {
	it("accepts the four command shapes and nothing else", () => {
		expect(parseAccessibilityAuditCommand({ type: "capability" })).toEqual({
			type: "capability",
		});
		expect(parseAccessibilityAuditCommand({ type: "cancel" })).toEqual({
			type: "cancel",
		});
		expect(
			parseAccessibilityAuditCommand({
				type: "run",
				target: { kind: "browser" },
			}),
		).toEqual({ type: "run", target: { kind: "browser" } });
		expect(
			parseAccessibilityAuditCommand({
				type: "run",
				target: {
					kind: "local",
					url: "http://localhost:5173/",
					viewport: "desktop",
				},
			}),
		).toEqual({
			type: "run",
			target: {
				kind: "local",
				url: "http://localhost:5173/",
				viewport: "desktop",
			},
		});
	});
	it("rejects script-shaped and extra keys", () => {
		for (const value of [
			{ type: "run", target: { kind: "browser" }, script: "x" },
			{ type: "run", target: { kind: "browser", code: "x" } },
			{
				type: "run",
				target: {
					kind: "local",
					url: "http://localhost:5173/",
					viewport: "desktop",
					options: {},
				},
			},
			{
				type: "run",
				target: {
					kind: "local",
					url: "http://localhost:5173/",
					viewport: "wide",
				},
			},
			{ type: "run" },
			{ type: "eval" },
			{},
			null,
			[],
			"run",
			{ type: "cancel", now: 1 },
			{ type: "capability", verbose: true },
			{ type: "run", target: { kind: "local", url: 42, viewport: "desktop" } },
			{
				type: "run",
				target: {
					kind: "local",
					url: "http://localhost/",
					viewport: "desktop",
					extra: 1,
				},
			},
		])
			expect(() => parseAccessibilityAuditCommand(value)).toThrow();
	});
});

describe("loopbackAuditUrl", () => {
	it("accepts loopback hosts with valid ports", () => {
		for (const url of [
			"http://localhost:5173/",
			"http://127.0.0.1:3000/x?y",
			"http://[::1]:8080/",
			"https://localhost/",
			"http://localhost:65535/",
		])
			expect(() => loopbackAuditUrl(url)).not.toThrow();
		expect(loopbackAuditUrl("http://localhost:5173/app#frag").hash).toBe("");
	});
	it("rejects public, private, credential and malformed targets", () => {
		for (const url of [
			"http://example.com",
			"http://192.168.1.2:3000",
			"http://localhost.evil.com",
			"file:///etc/passwd",
			"http://user:pw@localhost:3000",
			"http://localhost:0",
			"http://localhost:70000",
			"ftp://localhost/",
			"localhost:5173",
			"",
			"http://" + "a".repeat(2100),
		])
			expect(() => loopbackAuditUrl(url)).toThrow("localhost");
	});
	it("keeps remoteBrowserUrl rejecting loopback (R20 unchanged)", () => {
		expect(() => remoteBrowserUrl("http://localhost:5173")).toThrow();
		expect(() => remoteBrowserUrl("http://127.0.0.1:3000")).toThrow();
	});
});
