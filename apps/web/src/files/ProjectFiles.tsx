import {
	Fragment,
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { authenticated, read } from "../api";
import { FilesView, type FilesEntry } from "./FilesView";
import { referenceFolder, referenceName } from "../file-references";
import type { FileRevealRequest } from "./file-reveal";
import { ProjectSearch } from "./ProjectSearch";
import {
	unavailableProjectSearch,
	type ProjectSearchAdapter,
	type ProjectSearchMatch,
} from "./project-search-api";
import { useFilesRead } from "./useFilesRead";

interface ProjectFile {
	text: string | null;
	binary: boolean;
	sha256: string;
}
interface ProjectFilesProps {
	base: string;
	query: string;
	active: boolean;
	fallback: ReactNode;
	searchAdapter?: ProjectSearchAdapter;
	reveal?: FileRevealRequest | null;
	onRevealHandled?: (id: number) => void;
}
export function ProjectFiles(props: ProjectFilesProps) {
	return <ProjectFilesReader key={props.base + "?" + props.query} {...props} />;
}
function ProjectFilesReader({
	base,
	query,
	active,
	fallback,
	searchAdapter = unavailableProjectSearch,
	reveal = null,
	onRevealHandled,
}: ProjectFilesProps) {
	const [path, setPath] = useState(""),
		[selected, setSelected] = useState<FilesEntry | null>(null),
		[selectedMatch, setSelectedMatch] = useState<ProjectSearchMatch | null>(
			null,
		),
		[searchRefresh, setSearchRefresh] = useState(0),
		[revealLine, setRevealLine] = useState<number>(),
		[revealVersion, setRevealVersion] = useState(0);
	const matchLine = useRef<HTMLElement>(null);
	const owner = {
		projectId: decodeURIComponent(base.split("/").at(-1) ?? ""),
		threadId: new URLSearchParams(query).get("threadId") ?? null,
	};
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
	const file = preview.value;
	const stale = !!(
		selectedMatch &&
		file &&
		file.sha256.toLowerCase() !== selectedMatch.sha256.toLowerCase()
	);
	useEffect(() => {
		if (!stale && !preview.pending)
			matchLine.current?.scrollIntoView({
				block: "center",
				behavior: "instant",
			});
	}, [file, selectedMatch, stale, preview.pending]);
	// Reveal requests arrive from assistant file references; one-shot per id.
	useEffect(() => {
		if (
			!active ||
			!reveal ||
			reveal.projectId !== owner.projectId ||
			(reveal.threadId !== null && reveal.threadId !== owner.threadId)
		)
			return;
		setSelectedMatch(null);
		setPath(referenceFolder(reveal.path));
		if (selected?.path === reveal.path) preview.refresh();
		else
			setSelected({
				name: referenceName(reveal.path),
				path: reveal.path,
				kind: "file",
			});
		setRevealLine(reveal.line);
		setRevealVersion((value) => value + 1);
		onRevealHandled?.(reveal.id);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [reveal, active]);
	if (folder.errorCode === "PROJECT_NOT_CONNECTED") return fallback;
	const line =
		selectedMatch?.kind === "text" && !stale
			? selectedMatch.line
			: revealLine;
	const lines =
		line && file?.text ? file.text.split(/(\r\n|\r|\n)/) : undefined;
	const lineIndex = line ? (line - 1) * 2 : -1;
	// DOM carriage returns need an explicit visual break; retain the source text.
	const renderParts = (parts: string[]) =>
		parts.map((part, index) =>
			part === "\r" ? (
				<Fragment key={index}>
					{part}
					<br aria-hidden="true" />
				</Fragment>
			) : (
				part
			),
		);
	return (
		<FilesView
			source="project"
			rootLabel="Project files"
			path={path}
			folder={folder}
			selected={selected}
			revealVersion={revealVersion}
			projectSearch={{
				available: searchAdapter.available,
				body: (openPreview) => (
					<ProjectSearch
						adapter={searchAdapter}
						owner={owner}
						active={active}
						refreshVersion={searchRefresh}
						selected={selectedMatch}
						onSelect={(match) => {
							setRevealLine(undefined);
							setSelectedMatch(match);
							if (selected?.path === match.path) preview.refresh();
							else
								setSelected({
									name: match.path.split("/").at(-1)!,
									path: match.path,
									kind: "file",
								});
							openPreview();
						}}
					/>
				),
			}}
			preview={{
				...preview,
				body: file ? (
					<>
						{stale && (
							<p className="files-message" role="status">
								This file changed since the search. Showing current content;
								refresh search results before using the matching line.
							</p>
						)}
						{line && lines && lineIndex >= lines.length && (
							<p className="files-message" role="status">
								{revealLine
									? `Line ${line} is past the end of this file.`
									: "The matching line is no longer available. Refresh the search."}
							</p>
						)}
						{line && lines && lineIndex < lines.length && (
							<p className="files-message files-limit">
								{revealLine ? "Line" : "Matching line"} {line}
							</p>
						)}
						{file.binary ? (
							<p className="files-message">
								Binary file; no text preview.
							</p>
						) : file.text === "" ? (
							<p className="files-message">Empty text file</p>
						) : (
							<pre>
								{lines && line && lineIndex < lines.length ? (
									<>
										{renderParts(lines.slice(0, lineIndex))}
										<mark
											className={
												revealLine
													? "files-reveal-line"
													: "files-matching-line"
											}
											key={`line-${line}-${revealVersion}`}
											ref={matchLine}
										>
											{lines[lineIndex]}
										</mark>
										{renderParts(lines.slice(lineIndex + 1))}
									</>
								) : (
									file.text
								)}
							</pre>
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
				setSelectedMatch(null);
				setRevealLine(undefined);
				setPath(next);
				setSelected(null);
			}}
			onSelect={(entry) => {
				setSelectedMatch(null);
				setRevealLine(undefined);
				if (selected?.path === entry.path) preview.refresh();
				else setSelected(entry);
			}}
			onRefresh={() => {
				setSearchRefresh((value) => value + 1);
				folder.refresh();
				preview.refresh();
			}}
			onRetryFolder={folder.refresh}
			onRetryFile={preview.refresh}
		/>
	);
}
