import {
	AlertTriangle,
	Check,
	CheckCircle2,
	ChevronRight,
	ExternalLink,
	LoaderCircle,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
	AccessibilityAuditRule,
	AccessibilityImpact,
} from "../../../../packages/desktop-contract/index.ts";
import { criterionLabel } from "../../../desktop/accessibility-normalize.ts";
import { buildFixMessage } from "./fix-message.ts";
import type { AccessibilityAuditHook } from "./useAccessibilityAudit.ts";
import "./accessibility.css";

export interface FixInThread {
	threadTitle: string;
	send: (content: string) => Promise<void>;
}

const IMPACTS: readonly AccessibilityImpact[] = [
	"critical",
	"serious",
	"moderate",
	"minor",
];
const IMPACT_LABELS: Record<AccessibilityImpact, string> = {
	critical: "Critical",
	serious: "Serious",
	moderate: "Moderate",
	minor: "Minor",
};

function RuleRow({
	rule,
	expanded,
	checked,
	onToggleExpand,
	onToggleChecked,
}: {
	rule: AccessibilityAuditRule;
	expanded: boolean;
	checked: boolean;
	onToggleExpand: () => void;
	onToggleChecked: () => void;
}) {
	const shown = rule.nodes.slice(0, 5);
	return (
		<li className={`a11y-rule${checked ? " a11y-rule-checked" : ""}`}>
			<div className="a11y-rule-row">
				<input
					type="checkbox"
					checked={checked}
					onChange={onToggleChecked}
					aria-label={`Include ${rule.ruleId} in fixes`}
				/>
				<button
					type="button"
					className="a11y-rule-expand"
					aria-expanded={expanded}
					aria-label={`${expanded ? "Collapse" : "Expand"} ${rule.ruleId}`}
					onClick={onToggleExpand}
				>
					<ChevronRight
						size={16}
						className={expanded ? "a11y-chevron-open" : ""}
					/>
				</button>
				<span className={`a11y-badge a11y-badge-${rule.impact}`}>
					{IMPACT_LABELS[rule.impact]}
				</span>
				<span className="a11y-rule-text">
					<span className="a11y-rule-help">{rule.help}</span>
					<span className="a11y-rule-criteria">
						{rule.wcag.map(criterionLabel).join(", ")}
					</span>
					<span
						className={`a11y-rule-elements-wrap${expanded ? " open" : ""}`}
					>
						<span className="a11y-rule-elements">
							{shown.map((node, index) => (
								<span className="a11y-element" key={index}>
									<code className="a11y-element-target">{node.target}</code>
									{node.html && (
										<code className="a11y-element-html">{node.html}</code>
									)}
									{node.failureSummary && (
										<span className="a11y-element-summary">
											Fix: {node.failureSummary}
										</span>
									)}
								</span>
							))}
							{rule.nodeCount > shown.length && (
								<span className="a11y-element-more">
									…and {rule.nodeCount - shown.length} more
								</span>
							)}
							{rule.helpUrl && (
								<a
									className="a11y-learn-more"
									href={rule.helpUrl}
									target="_blank"
									rel="noreferrer"
								>
									Learn more <ExternalLink size={12} />
								</a>
							)}
						</span>
					</span>
				</span>
				<span
					className="a11y-rule-count"
					aria-label={`${rule.nodeCount} elements`}
				>
					{rule.nodeCount}
				</span>
			</div>
		</li>
	);
}

export function AccessibilityPanel({
	audit,
	onFixInThread,
}: {
	audit: AccessibilityAuditHook;
	onFixInThread?: FixInThread | null;
}) {
	const { state, cancel, retry, setOpen, sent, setSent } = audit;
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [sendError, setSendError] = useState("");
	const [sending, setSending] = useState(false);
	const result = state.status === "done" ? state.result : null;
	useEffect(() => {
		setChecked(new Set(result?.rules.map((rule) => rule.ruleId) ?? []));
		setExpanded(new Set());
		setSendError("");
	}, [result]);
	const checkedIds = useMemo(
		() =>
			result
				? result.rules.filter((r) => checked.has(r.ruleId)).map((r) => r.ruleId)
				: [],
		[result, checked],
	);
	const close = () => setOpen(false);
	const sendFixes = () => {
		if (!result || !onFixInThread || sending) return;
		setSending(true);
		setSendError("");
		void onFixInThread
			.send(buildFixMessage(result, checkedIds))
			.then(() => {
				setSent(true);
				setTimeout(() => setSent(false), 1500);
			})
			.catch((cause) =>
				setSendError(
					cause instanceof Error
						? cause.message
						: "The message could not be sent.",
				),
			)
			.finally(() => setSending(false));
	};
	const header = result && (
		<div className="a11y-meta">
			<p className="a11y-target" title={result.target.url}>
				{result.target.url}
			</p>
			<p className="a11y-submeta">
				axe {result.axeVersion} · {result.standard} ·{" "}
				{new Date(result.startedAt).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
				})}
				{result.truncated ? " · truncated" : ""}
				{result.blockedRequests > 0
					? ` · ${result.blockedRequests} requests blocked`
					: ""}
			</p>
		</div>
	);
	let body = (
		<div className="a11y-empty">
			<p className="a11y-hint">
				Check the page for common WCAG issues, then send fixes to the thread.
			</p>
		</div>
	);
	if (state.status === "running")
		body = (
			<div className="a11y-running" role="status">
				<div className="a11y-progress" aria-hidden="true" />
				<p className="a11y-phase">
					<LoaderCircle size={14} className="spinning" />{" "}
					{state.phase === "loading" ? "Loading page…" : "Running checks…"}
				</p>
				<button type="button" className="secondary" onClick={cancel}>
					Cancel
				</button>
			</div>
		);
	else if (state.status === "cancelled")
		body = (
			<div className="a11y-empty">
				<p className="a11y-hint">Check cancelled.</p>
			</div>
		);
	else if (state.status === "failed")
		body = (
			<div className="a11y-error" role="alert">
				<p>
					<AlertTriangle size={16} /> {state.message}
				</p>
				<button type="button" className="secondary" onClick={retry}>
					Retry
				</button>
			</div>
		);
	else if (result) {
		const total = result.rules.length;
		body =
			total === 0 ? (
				<div className="a11y-empty" role="status">
					<CheckCircle2 size={20} className="a11y-success" />
					<p>No WCAG A or AA violations found by automated checks.</p>
					<p className="a11y-hint">
						Automated checks find some issues, not all. Test with a keyboard and
						a screen reader too.
					</p>
				</div>
			) : (
				<>
					<div className="a11y-summary">
						<p className="a11y-headline">
							{total} {total === 1 ? "issue" : "issues"} on{" "}
							{result.elementCount} elements
						</p>
						<div className="a11y-chips">
							{IMPACTS.map((impact) => (
								<span
									key={impact}
									className={`a11y-badge a11y-badge-${result.counts[impact] ? impact : "none"}`}
								>
									{result.counts[impact]} {IMPACT_LABELS[impact]}
								</span>
							))}
						</div>
					</div>
					<ul className="a11y-rules">
						{result.rules.map((rule) => (
							<RuleRow
								key={rule.ruleId}
								rule={rule}
								expanded={expanded.has(rule.ruleId)}
								checked={checked.has(rule.ruleId)}
								onToggleExpand={() =>
									setExpanded((current) => {
										const next = new Set(current);
										if (next.has(rule.ruleId)) next.delete(rule.ruleId);
										else next.add(rule.ruleId);
										return next;
									})
								}
								onToggleChecked={() =>
									setChecked((current) => {
										const next = new Set(current);
										if (next.has(rule.ruleId)) next.delete(rule.ruleId);
										else next.add(rule.ruleId);
										return next;
									})
								}
							/>
						))}
					</ul>
				</>
			);
	}
	const canRun = state.status !== "running" && state.status !== "done";
	return (
		<aside className="a11y-panel" aria-label="Accessibility">
			<header className="a11y-header">
				<h2>Accessibility</h2>
				<button
					type="button"
					className="icon-button"
					aria-label="Close"
					onClick={close}
				>
					<X size={14} />
				</button>
			</header>
			{header}
			<div className="a11y-body">{body}</div>
			<footer className="a11y-footer">
				{sendError && (
					<p role="alert" className="error-text a11y-send-error">
						{sendError}
					</p>
				)}
				{sent && (
					<p role="status" className="a11y-sent">
						<Check size={13} /> Sent to {onFixInThread?.threadTitle}
					</p>
				)}
				{result && result.rules.length > 0 && (
					<button
						type="button"
						className="primary"
						disabled={sending || !onFixInThread || checkedIds.length === 0}
						title={
							!onFixInThread
								? "Open a thread to send fixes"
								: checkedIds.length === 0
									? "Select at least one issue"
									: undefined
						}
						onClick={sendFixes}
					>
						{sent ? "Sent" : sending ? "Sending…" : "Fix in thread"}
					</button>
				)}
				{canRun && state.status !== "idle" && (
					<button type="button" className="secondary" onClick={retry}>
						Check again
					</button>
				)}
				{state.status === "done" && (
					<button type="button" className="secondary" onClick={retry}>
						Check again
					</button>
				)}
			</footer>
		</aside>
	);
}
