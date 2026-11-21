import type {
	AccessibilityAuditNode,
	AccessibilityAuditResult,
	AccessibilityAuditRule,
	AccessibilityImpact,
} from "../../packages/desktop-contract/index.ts";

/** WCAG 2.2 success-criterion short names for the criteria axe-core 4.14 tags
 * with wcagNNN markers. Unknown criteria surface as their number only. */
export const WCAG_CRITERION_NAMES: Readonly<Record<string, string>> = {
	"1.1.1": "Non-text Content",
	"1.2.1": "Audio-only and Video-only (Prerecorded)",
	"1.2.2": "Captions (Prerecorded)",
	"1.2.3": "Audio Description or Media Alternative (Prerecorded)",
	"1.2.4": "Captions (Live)",
	"1.2.5": "Audio Description (Prerecorded)",
	"1.3.1": "Info and Relationships",
	"1.3.2": "Meaningful Sequence",
	"1.3.3": "Sensory Characteristics",
	"1.3.4": "Orientation",
	"1.3.5": "Identify Input Purpose",
	"1.3.6": "Identify Purpose",
	"1.4.1": "Use of Color",
	"1.4.3": "Contrast (Minimum)",
	"1.4.4": "Resize text",
	"1.4.5": "Images of Text",
	"1.4.6": "Contrast (Enhanced)",
	"1.4.8": "Visual Presentation",
	"1.4.10": "Reflow",
	"1.4.11": "Non-text Contrast",
	"1.4.12": "Text Spacing",
	"1.4.13": "Content on Hover or Focus",
	"2.1.1": "Keyboard",
	"2.1.2": "No Keyboard Trap",
	"2.1.4": "Character Key Shortcuts",
	"2.2.1": "Timing Adjustable",
	"2.2.2": "Pause, Stop, Hide",
	"2.3.1": "Three Flashes or Below Threshold",
	"2.4.1": "Bypass Blocks",
	"2.4.2": "Page Titled",
	"2.4.3": "Focus Order",
	"2.4.4": "Link Purpose (In Context)",
	"2.4.6": "Headings and Labels",
	"2.4.7": "Focus Visible",
	"2.4.11": "Focus Not Obscured (Minimum)",
	"2.4.12": "Focus Not Obscured (Enhanced)",
	"2.4.13": "Focus Appearance",
	"2.5.1": "Pointer Gestures",
	"2.5.2": "Pointer Cancellation",
	"2.5.3": "Label in Name",
	"2.5.4": "Motion Actuation",
	"2.5.7": "Dragging Movements",
	"2.5.8": "Target Size (Minimum)",
	"3.1.1": "Language of Page",
	"3.1.2": "Language of Parts",
	"3.2.1": "On Focus",
	"3.2.2": "On Input",
	"3.2.3": "Consistent Navigation",
	"3.2.4": "Consistent Identification",
	"3.2.6": "Consistent Help",
	"3.3.1": "Error Identification",
	"3.3.2": "Labels or Instructions",
	"3.3.3": "Error Suggestion",
	"3.3.4": "Error Prevention (Legal, Financial, Data)",
	"3.3.7": "Redundant Entry",
	"3.3.8": "Accessible Authentication (Minimum)",
	"4.1.2": "Name, Role, Value",
	"4.1.3": "Status Messages",
};

const IMPACT_ORDER: AccessibilityImpact[] = [
	"critical",
	"serious",
	"moderate",
	"minor",
];
const MAX_RULES = 100,
	MAX_NODES = 20,
	MAX_BYTES = 256 * 1024;
const LIMITS = {
	target: 300,
	html: 300,
	failureSummary: 600,
	help: 200,
	description: 400,
	title: 200,
	url: 2048,
};

function clip(value: unknown, max: number): string {
	const text = typeof value === "string" ? value : "";
	return text.length > max ? text.slice(0, max) : text;
}
function wcagTags(tags: unknown): string[] {
	if (!Array.isArray(tags)) return [];
	const out: string[] = [];
	for (const tag of tags) {
		if (typeof tag !== "string") continue;
		const match = /^wcag(\d)(\d)(\d+)$/.exec(tag);
		if (match && !out.includes(`${match[1]}.${match[2]}.${match[3]}`))
			out.push(`${match[1]}.${match[2]}.${match[3]}`);
	}
	return out;
}
function node(raw: unknown): AccessibilityAuditNode | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const value = raw as Record<string, unknown>;
	return {
		target: clip(
			Array.isArray(value.target)
				? value.target.filter((item) => typeof item === "string").join(" > ")
				: value.target,
			LIMITS.target,
		),
		html: clip(value.html, LIMITS.html),
		failureSummary: clip(value.failureSummary, LIMITS.failureSummary),
	};
}

export interface RawAuditMeta {
	kind: "browser" | "local";
	url: string;
	title: string;
	width: number;
	height: number;
	startedAt: string;
	durationMs: number;
	blockedRequests: number;
}

/** Defensively maps raw axe output to the contract. Returns null when the run
 * produced no recognizable result; the caller maps that to PAGE_GONE. */
export function normalizeAudit(
	raw: unknown,
	meta: RawAuditMeta,
): AccessibilityAuditResult | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const audit = raw as Record<string, unknown>;
	if (!Array.isArray(audit.violations)) return null;
	const rules: AccessibilityAuditRule[] = [];
	for (const violation of audit.violations.slice(0, MAX_RULES * 2)) {
		if (!violation || typeof violation !== "object" || Array.isArray(violation))
			continue;
		const v = violation as Record<string, unknown>;
		if (typeof v.id !== "string" || v.id.length > 120) continue;
		const nodes = Array.isArray(v.nodes)
			? v.nodes
					.map(node)
					.filter((item): item is AccessibilityAuditNode => item !== null)
			: [];
		const impact: AccessibilityImpact = (IMPACT_ORDER as string[]).includes(
			String(v.impact),
		)
			? (v.impact as AccessibilityImpact)
			: "minor";
		const helpUrl =
			typeof v.helpUrl === "string" &&
			v.helpUrl.startsWith("https://dequeuniversity.com/")
				? clip(v.helpUrl, LIMITS.url)
				: "";
		rules.push({
			ruleId: v.id,
			impact,
			help: clip(v.help, LIMITS.help),
			description: clip(v.description, LIMITS.description),
			helpUrl,
			wcag: wcagTags(v.tags),
			nodeCount: nodes.length,
			nodes: nodes.slice(0, MAX_NODES),
		});
	}
	const order = (impact: AccessibilityImpact) => IMPACT_ORDER.indexOf(impact);
	rules.sort(
		(a, b) => order(a.impact) - order(b.impact) || b.nodeCount - a.nodeCount,
	);
	const kept = rules.slice(0, MAX_RULES);
	const counts: Record<AccessibilityImpact, number> = {
		critical: 0,
		serious: 0,
		moderate: 0,
		minor: 0,
	};
	let elementCount = 0,
		truncated = rules.length > MAX_RULES;
	for (const rule of kept) {
		counts[rule.impact]++;
		elementCount += rule.nodeCount;
	}
	const result: AccessibilityAuditResult = {
		status: "completed",
		target: {
			kind: meta.kind,
			url: clip(meta.url, LIMITS.url),
			title: clip(meta.title, LIMITS.title),
		},
		viewport: {
			width: Math.trunc(meta.width),
			height: Math.trunc(meta.height),
		},
		axeVersion: clip(audit.version, 40),
		standard: "WCAG 2.2 A/AA",
		startedAt: meta.startedAt,
		durationMs: Math.max(0, Math.trunc(meta.durationMs)),
		counts,
		elementCount,
		rules: kept,
		blockedRequests: Math.max(0, Math.trunc(meta.blockedRequests)),
		truncated,
	};
	while (
		JSON.stringify(result).length > MAX_BYTES &&
		kept.some((rule) => rule.nodes.length > 0)
	) {
		const size = JSON.stringify(result).length;
		const nodeTotal = kept.reduce((sum, rule) => sum + rule.nodes.length, 0);
		const perNode = Math.max(1, Math.ceil(size / nodeTotal));
		let drop = Math.max(1, Math.ceil((size - MAX_BYTES) / perNode));
		for (const rule of [...kept].reverse()) {
			if (drop <= 0) break;
			const take = Math.min(drop, rule.nodes.length);
			rule.nodes.splice(rule.nodes.length - take, take);
			drop -= take;
		}
		truncated = true;
	}
	result.truncated = truncated;
	return result;
}

export function criterionLabel(criterion: string): string {
	const name = WCAG_CRITERION_NAMES[criterion];
	return name ? `${criterion} ${name}` : criterion;
}
