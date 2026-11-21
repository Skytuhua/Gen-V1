import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
	AccessibilityAuditCommand,
	AccessibilityAuditOutcome,
	AccessibilityAuditResult,
	DesktopBridge,
} from "../../../../packages/desktop-contract/index.ts";

export type AuditPhase = "loading" | "checking";

export type AuditUiState =
	| { status: "idle" }
	| { status: "running"; phase: AuditPhase }
	| { status: "done"; result: AccessibilityAuditResult }
	| {
			status: "failed";
			code: Extract<AccessibilityAuditOutcome, { status: "failed" }>["code"];
			message: string;
	  }
	| { status: "cancelled" };

export type AuditUiAction =
	| { type: "run"; phase: AuditPhase }
	| { type: "cancel" }
	| { type: "outcome"; outcome: AccessibilityAuditOutcome };

export function auditReducer(
	state: AuditUiState,
	action: AuditUiAction,
): AuditUiState {
	switch (action.type) {
		case "run":
			return { status: "running", phase: action.phase };
		case "cancel":
			return state.status === "running" ? { status: "cancelled" } : state;
		case "outcome": {
			if (state.status !== "running") return state;
			const outcome = action.outcome;
			if (outcome.status === "completed")
				return { status: "done", result: outcome };
			if (outcome.status === "cancelled") return { status: "cancelled" };
			return { status: "failed", code: outcome.code, message: outcome.message };
		}
	}
}

async function hostCapability(): Promise<boolean> {
	try {
		const response = await fetch(
			"/api/browser/accessibility-audit/capability",
			{
				credentials: "same-origin",
				cache: "no-store",
			},
		);
		if (!response.ok) return false;
		const body = (await response.json()) as { available?: unknown };
		return body.available === true;
	} catch {
		return false;
	}
}

export interface AccessibilityAuditHook {
	capable: boolean;
	state: AuditUiState;
	open: boolean;
	setOpen: (open: boolean) => void;
	run: (command: Extract<AccessibilityAuditCommand, { type: "run" }>) => void;
	cancel: () => void;
	retry: () => void;
	sent: boolean;
	setSent: (sent: boolean) => void;
}

// Capability is the AND of the host route and the desktop bridge so the
// button also hides in web mode and when the flag is off mid-session.
export function useAccessibilityAudit(
	bridge?: DesktopBridge,
): AccessibilityAuditHook {
	const [capable, setCapable] = useState(false);
	const [open, setOpen] = useState(false);
	const [sent, setSent] = useState(false);
	const [state, dispatch] = useReducer(auditReducer, { status: "idle" });
	const generation = useRef(0);
	const last = useRef<Extract<
		AccessibilityAuditCommand,
		{ type: "run" }
	> | null>(null);
	useEffect(() => {
		let active = true;
		const check = async () => {
			const route = await hostCapability();
			if (!route || !bridge?.accessibilityAudit) {
				if (active) setCapable(false);
				return;
			}
			try {
				const reply = await bridge.accessibilityAudit({ type: "capability" });
				if (active)
					setCapable(
						typeof reply === "object" &&
							"available" in reply &&
							reply.available === true,
					);
			} catch {
				if (active) setCapable(false);
			}
		};
		void check();
		return () => {
			active = false;
		};
	}, [bridge]);
	const cancel = useCallback(() => {
		generation.current += 1;
		if (bridge?.accessibilityAudit)
			void bridge.accessibilityAudit({ type: "cancel" }).catch(() => {});
		dispatch({ type: "cancel" });
	}, [bridge]);
	const run = useCallback(
		(command: Extract<AccessibilityAuditCommand, { type: "run" }>) => {
			if (!bridge?.accessibilityAudit) return;
			const id = ++generation.current;
			last.current = command;
			setSent(false);
			setOpen(true);
			dispatch({
				type: "run",
				phase: command.target.kind === "local" ? "loading" : "checking",
			});
			void bridge
				.accessibilityAudit(command)
				.then((outcome) => {
					if (generation.current !== id || !("status" in outcome)) return;
					dispatch({
						type: "outcome",
						outcome: outcome as AccessibilityAuditOutcome,
					});
				})
				.catch(() => {
					if (generation.current !== id) return;
					dispatch({
						type: "outcome",
						outcome: {
							status: "failed",
							code: "PAGE_GONE",
							message: "The page stopped while being checked.",
						},
					});
				});
		},
		[bridge],
	);
	const retry = useCallback(() => {
		if (last.current) run(last.current);
	}, [run]);
	useEffect(() => {
		if (!open && state.status === "running") cancel();
	}, [open, state.status, cancel]);
	useEffect(
		() => () => {
			if (bridge?.accessibilityAudit)
				void bridge.accessibilityAudit({ type: "cancel" }).catch(() => {});
		},
		[bridge],
	);
	return { capable, state, open, setOpen, run, cancel, retry, sent, setSent };
}
