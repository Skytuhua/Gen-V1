import { Accessibility } from "lucide-react";
import { useState } from "react";
import type { DesktopBrowserState } from "../../../../packages/desktop-contract/index.ts";
import { ActionMenu } from "../../../../packages/ui-shell/ActionMenu";
import type { AccessibilityAuditHook } from "./useAccessibilityAudit.ts";

export function AccessibilityButton({
	audit,
	state,
	onLocalApp,
}: {
	audit: AccessibilityAuditHook;
	state?: DesktopBrowserState;
	onLocalApp: () => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	if (!audit.capable) return null;
	const pageReady =
		Boolean(state?.url) && state?.url !== "about:blank" && !state?.loading;
	return (
		<span className="a11y-button">
			<ActionMenu
				label="Accessibility check"
				icon={<Accessibility size={15} />}
				iconOnly
				open={menuOpen}
				onOpenChange={setMenuOpen}
				items={[
					{
						id: "this-page",
						label: "Check this page",
						disabled: !pageReady,
						title: pageReady ? undefined : "Open a page first",
						onSelect: () =>
							audit.run({ type: "run", target: { kind: "browser" } }),
					},
					{
						id: "local-app",
						label: "Check a local app…",
						onSelect: onLocalApp,
					},
				]}
			/>
		</span>
	);
}
