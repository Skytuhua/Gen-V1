import { useCallback, useEffect, useState } from "react";
import { Folder } from "lucide-react";
import type { Snapshot } from "../../../../packages/contracts";
import { Select } from "../../../../packages/ui-shell/Select";
import { getResourceContent, getResourceTree } from "../api";
import { FilesView, type FilesEntry } from "./FilesView";
import { useFilesRead } from "./useFilesRead";

type GrantedPreview =
	| { kind: "text"; text: string }
	| { kind: "image"; blob: Blob }
	| { kind: "unsupported" };
export function GrantedFiles({
	snapshot,
	threadId,
	preferredResourceId,
}: {
	snapshot: Snapshot;
	threadId?: string;
	preferredResourceId?: string;
}) {
	return (
		<GrantSelection
			key={JSON.stringify([threadId, preferredResourceId])}
			grants={snapshot.resources.filter((item) => item.threadId === threadId)}
			preferredResourceId={preferredResourceId}
		/>
	);
}
function GrantSelection({
	grants,
	preferredResourceId,
}: {
	grants: Snapshot["resources"];
	preferredResourceId?: string;
}) {
	const [resourceId, setResourceId] = useState(preferredResourceId ?? "");
	const active = grants.some((item) => item.id === resourceId)
		? resourceId
		: (grants[0]?.id ?? "");
	const selector = (
		<label className="files-grant-selector">
			<span className="sr-only">Granted resource</span>
			<Select
				aria-label="Granted resource"
				value={active}
				onValueChange={setResourceId}
				disabled={!grants.length}
				options={
					grants.length
						? grants.map((grant) => ({ value: grant.id, label: grant.label }))
						: [{ value: "", label: "No granted resources" }]
				}
			/>
		</label>
	);
	if (!active)
		return (
			<div className="files-surface granted-files">
				<div className="files-toolbar panel-toolbar">{selector}</div>
				<div className="files-empty">
					<Folder size={22} />
					<strong>No granted resources</strong>
					<p>
						Use Add resource or attach a file in the composer. Only files
						explicitly granted to this thread appear here.
					</p>
				</div>
			</div>
		);
	return <GrantedReader key={active} active={active} selector={selector} />;
}
function GrantedReader({
	active,
	selector,
}: {
	active: string;
	selector: React.ReactNode;
}) {
	const [path, setPath] = useState(""),
		[selected, setSelected] = useState<FilesEntry | null>(null);
	const readFolder = useCallback(
		() => getResourceTree(active, path),
		[active, path],
	);
	const readFile = useCallback(
		async (signal: AbortSignal): Promise<GrantedPreview> => {
			if (
				/\.(pdf|zip|db|sqlite|sqlite3|exe|dll|bin|woff2?|ttf)$/i.test(
					selected!.name,
				)
			)
				return { kind: "unsupported" };
			const response = await getResourceContent(active, selected!.path, signal);
			if (!response.ok)
				throw new Error(
					response.status === 403
						? "Access to this file was denied (403)."
						: `File preview could not be read (${response.status}).`,
				);
			const mime = response.headers.get("content-type") ?? "",
				image = /^image\/(png|jpeg|gif|webp)$/.test(mime),
				limit = image ? 10 * 1024 * 1024 : 1024 * 1024;
			if (Number(response.headers.get("content-length")) > limit) {
				await response.body?.cancel();
				throw new Error(
					image
						? "Image preview is limited to 10 MiB."
						: "Text preview is limited to 1 MiB. Download the granted file to inspect it.",
				);
			}
			if (!response.body) throw new Error("The file response was empty.");
			const reader = response.body.getReader(),
				chunks: Uint8Array[] = [];
			let length = 0;
			try {
				while (true) {
					const chunk = await reader.read();
					if (chunk.done) break;
					length += chunk.value.byteLength;
					if (length > limit) {
						await reader.cancel();
						throw new Error("This file exceeds the preview size limit.");
					}
					chunks.push(chunk.value);
				}
			} finally {
				reader.releaseLock();
			}
			signal.throwIfAborted();
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.length;
			}
			if (image)
				return { kind: "image", blob: new Blob([bytes], { type: mime }) };
			if (bytes.subarray(0, 4096).includes(0)) return { kind: "unsupported" };
			return {
				kind: "text",
				text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			};
		},
		[active, selected?.path, selected?.name],
	);
	const folder = useFilesRead(path, true, readFolder),
		preview = useFilesRead(selected?.path ?? "", !!selected, readFile),
		value = preview.value;
	const download = selected
		? `/api/resources/${encodeURIComponent(active)}/content${selected.path ? "?path=" + encodeURIComponent(selected.path) : ""}`
		: undefined;
	return (
		<FilesView
			source="granted"
			rootLabel="Granted root"
			path={path}
			selector={selector}
			folder={folder}
			selected={selected}
			download={download}
			preview={{
				...preview,
				body:
					value?.kind === "image" ? (
						<GrantedImage blob={value.blob} name={selected!.name} />
					) : value?.kind === "text" ? (
						value.text === "" ? (
							<p className="files-message">Empty text file</p>
						) : (
							<pre>{value.text}</pre>
						)
					) : value?.kind === "unsupported" ? (
						<p className="files-message">
							This file has no inline preview. Download the granted file to
							inspect it.
						</p>
					) : null,
			}}
			limitNote={
				folder.value?.truncated
					? "This directory is limited to 300 entries. Open a subdirectory to continue."
					: undefined
			}
			onDirectory={(next) => {
				setPath(next);
				setSelected(null);
			}}
			onSelect={(entry) => {
				if (selected?.path === entry.path) preview.refresh();
				else setSelected(entry);
			}}
			onRefresh={() => {
				folder.refresh();
				preview.refresh();
			}}
			onRetryFolder={folder.refresh}
			onRetryFile={preview.refresh}
		/>
	);
}
function GrantedImage({ blob, name }: { blob: Blob; name: string }) {
	const [url, setUrl] = useState("");
	useEffect(() => {
		const next = URL.createObjectURL(blob);
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [blob]);
	return url ? <img src={url} alt={name} /> : null;
}
