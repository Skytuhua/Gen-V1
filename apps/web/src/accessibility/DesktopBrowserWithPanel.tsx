import { type ReactNode, useState } from "react";
import type { DesktopBrowserState } from "../../../../packages/desktop-contract/index.ts";
import { useDesktop } from "../desktop-context";
import { AccessibilityButton } from "./AccessibilityButton.tsx";
import { AccessibilityPanel } from "./AccessibilityPanel.tsx";
import type { FixInThread } from "./AccessibilityPanel.tsx";
export type { FixInThread } from "./AccessibilityPanel.tsx";
import { LocalAppDialog } from "./LocalAppDialog.tsx";
import { useAccessibilityAudit } from "./useAccessibilityAudit.ts";

// Wraps [slot | panel] in a grid so the slot's measured rect shrinks while
// the panel is open and the existing bounds effect resizes the native view.
export function DesktopBrowserWithPanel({
	state,
	toolbar,
	projectId,
	onFixInThread,
	children,
}: {
	state?: DesktopBrowserState;
	toolbar: (actions: ReactNode) => ReactNode;
	projectId?: string;
	onFixInThread?: FixInThread | null;
	children: ReactNode;
}) {
	const desktop = useDesktop();
	const audit = useAccessibilityAudit(desktop?.bridge);
	const [dialogOpen, setDialogOpen] = useState(false);
	const projectKey = projectId ?? "default";
	const actions = audit.capable ? (
		<AccessibilityButton
			audit={audit}
			state={state}
			onLocalApp={() => setDialogOpen(true)}
		/>
	) : null;
	return (
		<div className="a11y-browser-layout">
			{toolbar(actions)}
			<div className="a11y-browser-body">
				<div className="a11y-browser-slot">{children}</div>
				{audit.open && (
					<AccessibilityPanel audit={audit} onFixInThread={onFixInThread} />
				)}
			</div>
			<LocalAppDialog
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
				audit={audit}
				storageKey={`gen.a11y.lastLocalUrl.${projectKey}`}
			/>
		</div>
	);
}
