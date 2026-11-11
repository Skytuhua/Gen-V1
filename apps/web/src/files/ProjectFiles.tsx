import { useCallback, useState, type ReactNode } from "react";
import { authenticated, read } from "../api";
import { FilesView, type FilesEntry } from "./FilesView";
import { useFilesRead } from "./useFilesRead";

interface ProjectFile {
	text: string | null;
	binary: boolean;
	sha256: string;
}
export function ProjectFiles({
	base,
	query,
	active,
	fallback,
}: {
	base: string;
	query: string;
	active: boolean;
	fallback: ReactNode;
}) {
	const [path, setPath] = useState(""),
		[selected, setSelected] = useState<FilesEntry | null>(null);
	const readFolder = useCallback(
		(signal: AbortSignal) => {
			const params = new URLSearchParams(query);
			if (path) params.set("path", path);
			return authenticated(() =>
				fetch(base + "/files?" + params, {
					credentials: "same-origin",
					cache: "no-store",
					signal,
				}),
			).then(read<{ entries: FilesEntry[] }>);
		},
		[base, query, path],
	);
	const readFile = useCallback(
		(signal: AbortSignal) => {
			const params = new URLSearchParams(query);
			params.set("path", selected!.path);
			return authenticated(() =>
				fetch(base + "/file?" + params, {
					credentials: "same-origin",
					cache: "no-store",
					signal,
				}),
			).then(read<ProjectFile>);
		},
		[base, query, selected?.path],
	);
	const folder = useFilesRead(path, active, readFolder),
		preview = useFilesRead(
			selected?.path ?? "",
			active && !!selected,
			readFile,
		);
	if (folder.errorCode === "PROJECT_NOT_CONNECTED") return fallback;
	const file = preview.value;
	return (
		<FilesView
			source="project"
			rootLabel="Project files"
			path={path}
			folder={folder}
			selected={selected}
			preview={{
				...preview,
				body: file ? (
					<>
						{file.binary ? (
							<p className="files-message">
								Binary file; no text preview.
							</p>
						) : file.text === "" ? (
							<p className="files-message">Empty text file</p>
						) : (
							<pre>{file.text}</pre>
						)}
						<small className="files-checksum">SHA-256 {file.sha256}</small>
					</>
				) : null,
			}}
			limitNote={
				(folder.value?.entries.length ?? 0) >= 500
					? "Showing up to 500 entries; more files may exist."
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
