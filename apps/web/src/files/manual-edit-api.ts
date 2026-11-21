import { authenticated, csrfToken, read } from "../api";
import {
	manualEditCapabilityV1,
	manualEditSaveResponseV1,
	type ManualEditCapabilityV1,
	type ManualEditSaveRequestV1,
	type ManualEditSaveResponseV1,
} from "../../../../packages/contracts/manual-edit";

/** The read response plus the flag-gated edit state added by T02. */
export interface ProjectFileRead {
	text: string | null;
	binary: boolean;
	sha256: string;
	edit?: {
		editable: boolean;
		reason?: "binary" | "not_utf8" | "too_large" | "protected" | "not_regular";
		bom: boolean;
		lineSeparator: "lf" | "crlf" | "mixed";
	};
}

export function readProjectFile(
	base: string,
	query: string,
	path: string,
	signal: AbortSignal,
): Promise<ProjectFileRead> {
	const params = new URLSearchParams(query);
	params.set("path", path);
	return authenticated(() =>
		fetch(base + "/file?" + params, {
			credentials: "same-origin",
			cache: "no-store",
			signal,
		}),
	).then(read<ProjectFileRead>);
}

export function readEditCapability(
	base: string,
	query: string,
	signal: AbortSignal,
): Promise<ManualEditCapabilityV1> {
	const params = new URLSearchParams(query);
	return authenticated(() =>
		fetch(base + "/file/edit-capability?" + params, {
			credentials: "same-origin",
			cache: "no-store",
			signal,
		}),
	)
		.then(read<unknown>)
		.then((value) => manualEditCapabilityV1.parse(value));
}

export function saveFile(
	base: string,
	input: ManualEditSaveRequestV1,
	signal?: AbortSignal,
): Promise<ManualEditSaveResponseV1> {
	return authenticated(() =>
		fetch(base + "/file/save", {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				"x-harness-csrf": csrfToken,
			},
			body: JSON.stringify(input),
			signal,
		}),
	)
		.then(read<unknown>)
		.then((value) => manualEditSaveResponseV1.parse(value));
}
