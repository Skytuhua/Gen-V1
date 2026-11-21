import { describe, expect, it } from "vitest";
import { buildFixMessage } from "../apps/web/src/accessibility/fix-message.ts";
import type { AccessibilityAuditResult } from "../packages/desktop-contract/index.ts";

const result: AccessibilityAuditResult = {
	status: "completed",
	target: { kind: "local", url: "http://localhost:5173/", title: "App" },
	viewport: { width: 1280, height: 800 },
	axeVersion: "4.14.1",
	standard: "WCAG 2.2 A/AA",
	startedAt: "2026-11-21T00:00:00.000Z",
	durationMs: 900,
	counts: { critical: 2, serious: 1, moderate: 0, minor: 0 },
	elementCount: 20,
	blockedRequests: 0,
	truncated: false,
	rules: [
		{
			ruleId: "image-alt",
			impact: "critical",
			help: "Images must have alternative text",
			description: "d",
			helpUrl: "https://dequeuniversity.com/rules/axe/4.14/image-alt",
			wcag: ["1.1.1"],
			nodeCount: 6,
			nodes: Array.from({ length: 6 }, (_, i) => ({
				target: `img.n${i}`,
				html: `<img src="x${i}.png">`,
				failureSummary: "No alt",
			})),
		},
		{
			ruleId: "color-contrast",
			impact: "serious",
			help: "Elements must meet minimum color contrast ratio thresholds",
			description: "d",
			helpUrl: "https://dequeuniversity.com/rules/axe/4.14/color-contrast",
			wcag: ["1.4.3"],
			nodeCount: 12,
			nodes: [{ target: "p.x", html: "<p>x</p>", failureSummary: "Contrast" }],
		},
		{
			ruleId: "label",
			impact: "critical",
			help: "Form elements must have labels",
			description: "d",
			helpUrl: "https://dequeuniversity.com/rules/axe/4.14/label",
			wcag: ["4.1.2"],
			nodeCount: 2,
			nodes: [{ target: "input", html: "<input>", failureSummary: "No label" }],
		},
	],
};

describe("buildFixMessage", () => {
	it("builds the DESIGN §6 message with checked rules only", () => {
		const text = buildFixMessage(result, ["image-alt", "color-contrast"]);
		expect(text).toContain(
			"automated WCAG 2.2 A/AA check (axe-core 4.14.1) of http://localhost:5173/ (1280×800, 2026-11-21T00:00:00.000Z)",
		);
		expect(text).toContain(
			"1. [critical] image-alt: Images must have alternative text (WCAG 1.1.1 Non-text Content). 6 elements, first 5 shown.",
		);
		expect(text).toContain(
			"2. [serious] color-contrast: Elements must meet minimum color contrast ratio thresholds (WCAG 1.4.3 Contrast (Minimum)). 12 elements, first 1 shown.",
		);
		expect(text).toContain('- `img.n0` `<img src="x0.png">`: No alt');
		expect(text).not.toContain("] label:");
		expect(text).toContain(
			"Rule help: https://dequeuniversity.com/rules/axe/4.14/image-alt, https://dequeuniversity.com/rules/axe/4.14/color-contrast",
		);
	});
	it("caps elements at five and escapes backticks", () => {
		const text = buildFixMessage(result, ["image-alt"]);
		expect(text.match(/- `img\.n/g)).toHaveLength(5);
		const ticked = buildFixMessage(
			{
				...result,
				rules: [
					{
						...result.rules[0],
						nodes: [{ target: "`x`", html: "`y`", failureSummary: "`z`" }],
					},
				],
			},
			["image-alt"],
		);
		expect(ticked).not.toMatch(/`[xy]`/);
	});
	it("stays under 24 KiB and reports omitted rules", () => {
		const big: AccessibilityAuditResult = {
			...result,
			rules: Array.from({ length: 40 }, (_, i) => ({
				...result.rules[0],
				ruleId: "rule-" + i,
				nodes: result.rules[0].nodes.map((node) => ({
					...node,
					failureSummary: "z".repeat(500),
				})),
			})),
		};
		const text = buildFixMessage(
			big,
			big.rules.map((rule) => rule.ruleId),
		);
		expect(text.length).toBeLessThanOrEqual(24 * 1024);
		expect(text).toMatch(/and \d+ more rules? not listed/);
	});
});
