/** Pure edit state machine (DESIGN §7), exported so unit tests drive it without a DOM. */
export type EditPhase =
	| "loading"
	| "clean"
	| "dirty"
	| "saving"
	| "conflict"
	| "comparing"
	| "unavailable";

export type EditEvent =
	| { type: "ready" } // editor chunk mounted, no draft
	| { type: "draftRestored" } // journaled draft for the same SHA kept
	| { type: "draftConflict" } // journaled draft whose SHA no longer matches
	| { type: "change"; dirty: boolean }
	| { type: "save" }
	| { type: "saved" }
	| { type: "saveConflict" }
	| { type: "saveFailed" }
	| { type: "diskChanged" }
	| { type: "diskGone" }
	| { type: "reload" }
	| { type: "overwrite" }
	| { type: "compare" }
	| { type: "closeCompare" };

export function editReduce(phase: EditPhase, event: EditEvent): EditPhase {
	switch (phase) {
		case "loading":
			return event.type === "ready"
				? "clean"
				: event.type === "draftRestored"
					? "dirty"
					: event.type === "draftConflict"
						? "conflict"
						: phase;
		case "clean":
			return event.type === "change" && event.dirty
				? "dirty"
				: event.type === "diskGone"
					? "unavailable"
					: phase; // diskChanged on clean reloads silently, phase stays clean
		case "dirty":
			return event.type === "change" && !event.dirty
				? "clean"
				: event.type === "save"
					? "saving"
					: event.type === "diskChanged"
						? "conflict"
						: event.type === "diskGone"
							? "unavailable"
							: phase;
		case "saving":
			return event.type === "saved"
				? "clean"
				: event.type === "saveConflict"
					? "conflict"
					: event.type === "saveFailed"
						? "dirty"
						: event.type === "diskGone"
							? "unavailable"
							: phase;
		case "conflict":
			return event.type === "reload"
				? "loading"
				: event.type === "overwrite"
					? "saving"
					: event.type === "compare"
						? "comparing"
						: event.type === "diskGone"
							? "unavailable"
							: phase;
		case "comparing":
			return event.type === "closeCompare"
				? "conflict"
				: event.type === "reload"
					? "loading"
					: event.type === "overwrite"
						? "saving"
						: phase;
		case "unavailable":
			return phase; // Keep editing / Close are handled by the component.
	}
}

/** Exact bytes the client sends: the loaded BOM (if any) plus the document text. */
export function editSaveText(bom: boolean, documentText: string): string {
	return (bom ? "\uFEFF" : "") + documentText;
}

/** The separator facet value CodeMirror joins lines with; mixed files normalize to LF on save (D10, disclosed). */
export function editLineSeparator(
	separator: "lf" | "crlf" | "mixed",
): "\n" | "\r\n" {
	return separator === "crlf" ? "\r\n" : "\n";
}

/** Strip a leading BOM for display; the flag remembers to restore it on save. */
export function splitBom(text: string): { bom: boolean; text: string } {
	return text.startsWith("\uFEFF")
		? { bom: true, text: text.slice(1) }
		: { bom: false, text };
}

/** Journal drafts are keyed by owner + path; the loaded SHA inside decides restore vs conflict. */
export function editJournalKey(
	projectId: string,
	threadId: string | null,
	path: string,
): string {
	return `files.edit:${projectId}:${threadId ?? "-"}:${path}`;
}

/** Edit-button disabled reasons (R03); absent for editable files. */
export function editDisabledReason(
	reason: NonNullable<ProjectFileReadEditReason> | undefined,
): string {
	switch (reason) {
		case "binary":
			return "Binary files can't be edited";
		case "not_utf8":
			return "This file isn't valid UTF-8";
		case "too_large":
			return "Files over 1 MB can't be edited here";
		case "protected":
			return "This file is protected";
		case "not_regular":
			return "This file can't be edited";
		default:
			return "Editing isn't available for this file.";
	}
}
export type ProjectFileReadEditReason =
	| "binary"
	| "not_utf8"
	| "too_large"
	| "protected"
	| "not_regular";

/** Save-failure copy (R19). Returns the bar text; `retry` marks transient network failures. */
export function editErrorCopy(code: string): { text: string; retry: boolean } {
	switch (code) {
		case "CAPABILITY_DENIED":
			return { text: "Editing isn't available for this file.", retry: false };
		case "RESOURCE_LIMIT":
			return {
				text: "File is over 1 MB after your edits; it can't be saved here.",
				retry: false,
			};
		case "PROJECT_NOT_CONNECTED":
			return { text: "Reconnect the project to save.", retry: false };
		default:
			return { text: "Couldn't save. Your changes are kept.", retry: true };
	}
}
