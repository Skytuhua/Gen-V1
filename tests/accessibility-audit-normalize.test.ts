import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
	criterionLabel,
	normalizeAudit,
} from "../apps/desktop/accessibility-normalize.ts";

const meta = {
	kind: "local" as const,
	url: "http://localhost:5173/",
	title: "App",
	width: 1280,
	height: 800,
	startedAt: "2026-11-21T00:00:00.000Z",
	durationMs: 1200,
	blockedRequests: 3,
};
const violation = (
	id: string,
	impact: string,
	nodes: number,
	tags: string[] = ["wcag2a", "wcag111"],
) => ({
	id,
	impact,
	help: `Help ${id}`,
	description: `Desc ${id}`,
	helpUrl: "https://dequeuniversity.com/rules/axe/4.14/" + id,
	tags,
	nodes: Array.from({ length: nodes }, (_, i) => ({
		target: `#el-${i}`,
		html: `<div id="el-${i}">`,
		failureSummary: "Fix this",
	})),
});

describe("normalizeAudit", () => {
	it("maps axe violations to sorted rules with WCAG criteria", () => {
		const result = normalizeAudit(
			{
				version: "4.14.1",
				violations: [
					violation("color-contrast", "serious", 12, ["wcag2aa", "wcag143"]),
					violation("image-alt", "critical", 4),
					violation("html-has-lang", "minor", 1),
				],
			},
			meta,
		)!;
		expect(result.status).toBe("completed");
		expect(result.rules.map((rule) => rule.ruleId)).toEqual([
			"image-alt",
			"color-contrast",
			"html-has-lang",
		]);
		expect(result.rules[0].wcag).toEqual(["1.1.1"]);
		expect(result.rules[1].wcag).toEqual(["1.4.3"]);
		expect(result.counts).toEqual({
			critical: 1,
			serious: 1,
			moderate: 0,
			minor: 1,
		});
		expect(result.elementCount).toBe(17);
		expect(result.blockedRequests).toBe(3);
		expect(result.truncated).toBe(false);
	});
	it("caps rules at 100 and nodes at 20 while keeping true counts", () => {
		const result = normalizeAudit(
			{
				version: "4.14.1",
				violations: Array.from({ length: 150 }, (_, i) =>
					violation("rule-" + i, "serious", 50),
				),
			},
			meta,
		)!;
		expect(result.rules).toHaveLength(100);
		expect(result.rules[0].nodes).toHaveLength(20);
		expect(result.rules[0].nodeCount).toBe(50);
		expect(result.truncated).toBe(true);
	});
	it("enforces the 256 KiB result cap by dropping nodes", () => {
		const big = {
			id: "big",
			impact: "critical",
			help: "h",
			description: "d",
			helpUrl: "https://dequeuniversity.com/x",
			tags: ["wcag2a"],
			nodes: Array.from({ length: 20 }, (_, i) => ({
				target: "x".repeat(290) + i,
				html: "y".repeat(290),
				failureSummary: "z".repeat(590),
			})),
		};
		const result = normalizeAudit(
			{
				version: "4.14.1",
				violations: Array.from({ length: 100 }, (_, i) => ({
					...big,
					id: "big-" + i,
				})),
			},
			meta,
		)!;
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(256 * 1024);
		expect(result.truncated).toBe(true);
	});
	it("maps null impact to minor and drops non-Deque help links", () => {
		const result = normalizeAudit(
			{
				version: "4.14.1",
				violations: [
					violation("no-impact", null as unknown as string, 1),
					{
						...violation("bad-url", "critical", 1),
						helpUrl: "https://evil.example/x",
					},
				],
			},
			meta,
		)!;
		expect(
			result.rules.find((rule) => rule.ruleId === "no-impact")!.impact,
		).toBe("minor");
		expect(
			result.rules.find((rule) => rule.ruleId === "bad-url")!.helpUrl,
		).toBe("");
	});
	it("normalizes the recorded T09 real-axe fixture to exactly five rules", () => {
		const raw = JSON.parse(
			readFileSync(
				new URL("./fixtures/axe-violations-4.14.json", import.meta.url),
				"utf8",
			),
		);
		const result = normalizeAudit(raw, {
			kind: "local",
			url: raw.url,
			title: raw.title,
			width: raw.width,
			height: raw.height,
			startedAt: "2026-11-21T12:00:00.000Z",
			durationMs: 40,
			blockedRequests: 0,
		});
		expect(result).not.toBeNull();
		expect(result!.rules.map((rule) => rule.ruleId).sort()).toEqual([
			"button-name",
			"color-contrast",
			"html-has-lang",
			"image-alt",
			"label",
		]);
		expect(result!.axeVersion).toBe("4.14.1");
		const contrast = result!.rules.find(
			(rule) => rule.ruleId === "color-contrast",
		);
		expect(contrast!.wcag).toContain("1.4.3");
	});
	it("rejects malformed input", () => {
		for (const raw of [null, undefined, 42, "x", [], {}, { violations: "x" }])
			expect(normalizeAudit(raw, meta)).toBeNull();
	});
	it("joins frame-chain targets and clips long strings", () => {
		const result = normalizeAudit(
			{
				version: "4.14.1",
				violations: [
					{
						id: "frame",
						impact: "minor",
						help: "h",
						description: "d",
						helpUrl: "",
						tags: [],
						nodes: [
							{
								target: ["iframe", "img"],
								html: "x".repeat(400),
								failureSummary: "y".repeat(700),
							},
						],
					},
				],
			},
			meta,
		)!;
		expect(result.rules[0].nodes[0].target).toBe("iframe > img");
		expect(result.rules[0].nodes[0].html).toHaveLength(300);
		expect(result.rules[0].nodes[0].failureSummary).toHaveLength(600);
	});
	it("labels known criteria and falls back to the number", () => {
		expect(criterionLabel("1.4.3")).toBe("1.4.3 Contrast (Minimum)");
		expect(criterionLabel("9.9.9")).toBe("9.9.9");
	});
});
