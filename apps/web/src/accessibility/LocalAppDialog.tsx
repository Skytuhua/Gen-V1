import { useEffect, useId, useState } from "react";
import { Modal } from "../../../../packages/ui-shell/Modal";
import { Select } from "../../../../packages/ui-shell/Select";
import { localAuditUrl } from "./local-url.ts";
import type { AccessibilityAuditHook } from "./useAccessibilityAudit.ts";

export function LocalAppDialog({
	open,
	onClose,
	audit,
	storageKey,
}: {
	open: boolean;
	onClose: () => void;
	audit: AccessibilityAuditHook;
	storageKey: string;
}) {
	const [url, setUrl] = useState("");
	const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
	const [error, setError] = useState("");
	const errorId = useId();
	useEffect(() => {
		if (open) {
			setError("");
			try {
				setUrl(localStorage.getItem(storageKey) ?? "");
			} catch {
				setUrl("");
			}
		}
	}, [open, storageKey]);
	const submit = () => {
		try {
			const parsed = localAuditUrl(url.trim());
			try {
				localStorage.setItem(storageKey, parsed.href);
			} catch {}
			onClose();
			audit.run({
				type: "run",
				target: { kind: "local", url: parsed.href, viewport },
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	return (
		<Modal open={open} title="Check a local app" onClose={onClose}>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<label htmlFor={`${errorId}-url`}>Local app address</label>
				<input
					id={`${errorId}-url`}
					type="url"
					value={url}
					onChange={(event) => {
						setUrl(event.target.value);
						setError("");
					}}
					placeholder="http://localhost:5173/"
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? errorId : undefined}
				/>
				{error && (
					<p id={errorId} role="alert" className="error-text a11y-dialog-error">
						{error}
					</p>
				)}
				<Select
					aria-label="Viewport"
					value={viewport}
					onValueChange={(value) => setViewport(value as "desktop" | "mobile")}
					options={[
						{ value: "desktop", label: "Desktop 1280 × 800" },
						{ value: "mobile", label: "Mobile 390 × 844" },
					]}
				/>
				<footer className="dialog-actions">
					<button type="button" className="quiet" onClick={onClose}>
						Cancel
					</button>
					<button type="submit" className="primary" disabled={!url.trim()}>
						Check
					</button>
				</footer>
			</form>
		</Modal>
	);
}
