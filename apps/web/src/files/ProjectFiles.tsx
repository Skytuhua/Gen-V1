import {
	Fragment,
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { Check, Pencil } from "lucide-react";
import { authenticated, read } from "../api";
import { Modal } from "../../../../packages/ui-shell/Modal";
import { matchesShortcut } from "../shell-layout";
import { chordFor } from "../keyboard-bindings";
import { FilesView, type FilesEntry } from "./FilesView";
import { ProjectSearch } from "./ProjectSearch";
import {
	unavailableProjectSearch,
	type ProjectSearchAdapter,
	type ProjectSearchMatch,
} from "./project-search-api";
import { useFilesRead } from "./useFilesRead";
import { readEditCapability } from "./manual-edit-api";
import { editDisabledReason } from "./manual-edit-state";
import {
	ProjectFileEditor,
	type EditorApi,
	type EditorUiState,
} from "./ProjectFileEditor";

interface ProjectFile {
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
interface ProjectFilesProps {
	base: string;
	query: string;
	active: boolean;
	fallback: ReactNode;
	searchAdapter?: ProjectSearchAdapter;
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
}: ProjectFilesProps) {
	const [path, setPath] = useState(""),
		[selected, setSelected] = useState<FilesEntry | null>(null),
		[selectedMatch, setSelectedMatch] = useState<ProjectSearchMatch | null>(
			null,
		),
		[searchRefresh, setSearchRefresh] = useState(0),
		[editing, setEditing] = useState(false),
		[editorUi, setEditorUi] = useState<EditorUiState | null>(null),
		[confirm, setConfirm] = useState<{
			name: string;
			action: () => void;
		} | null>(null);
	const matchLine = useRef<HTMLElement>(null);
	const editorApi = useRef<EditorApi | undefined>(undefined);
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
	const readCapability = useCallback(
		(signal: AbortSignal) => readEditCapability(base, query, signal),
		[base, query],
	);
	const folder = useFilesRead(path, active, readFolder),
		preview = useFilesRead(
			selected?.path ?? "",
			active && !!selected,
			readFile,
		),
		capability = useFilesRead(
			"edit-capability",
			active,
			readCapability,
		);
	const file = preview.value;
	const canEdit = capability.value?.available === true;
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
	// Leaving edit mode clears the header toolbar copy for the next open.
	useEffect(() => {
		if (!editing) setEditorUi(null);
	}, [editing]);
	if (folder.errorCode === "PROJECT_NOT_CONNECTED") return fallback;
	const line =
		selectedMatch?.kind === "text" && !stale ? selectedMatch.line : undefined;
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
	/** R13: run an action now when clean, or after the unsaved-changes dialog. */
	const guarded = (action: () => void) => {
		if (editing && editorApi.current?.isDirty())
			setConfirm({ name: selected?.name ?? "file", action });
		else action();
	};
	const exitEdit = () => setEditing(false);
	const requestExit = () => {
		if (editorApi.current?.isDirty())
			setConfirm({ name: selected?.name ?? "file", action: exitEdit });
		else exitEdit();
	};
	const editable =
		canEdit && !!file?.edit?.editable && !!file && file.text !== null;
	const editReason = file?.edit?.editable
		? ""
		: editDisabledReason(file?.edit?.reason);
	const headerActions = editing ? (
		<div className="files-edit-toolbar">
			{editorUi?.dirty && (
				<span className="files-edit-dirty">
					<i className="files-dirty-dot" aria-hidden="true" />
					Edited
				</span>
			)}
			{editorUi?.conflict && (
				<small className="files-edit-conflict">Conflict</small>
			)}
			<button
				type="button"
				className="primary"
				disabled={
					!editorUi?.dirty || editorUi.saving || editorUi.unavailable
				}
				onClick={() => void editorApi.current?.save()}
			>
				{editorUi?.saved ? (
					<>
						<Check size={13} /> Saved
					</>
				) : (
					"Save"
				)}
			</button>
			<button type="button" onClick={requestExit}>
				Done
			</button>
		</div>
	) : canEdit && file ? (
		<button
			type="button"
			className="files-edit-open"
			disabled={!editable}
			title={editable ? `Edit ${selected?.name} (E)` : editReason}
			aria-label={editable ? "Edit file" : `Edit file: ${editReason}`}
			onClick={() => editable && setEditing(true)}
		>
			<Pencil size={14} />
			<span>Edit</span>
		</button>
	) : undefined;
	const previewKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
		const target = event.target as HTMLElement;
		if (
			target.closest("input,textarea,[contenteditable=true],.cm-editor") ||
			!matchesShortcut(event, chordFor('files.edit'))
		)
			return;
		if (canEdit && editable && !editing) {
			event.preventDefault();
			setEditing(true);
		}
	};
	const previewBody = file ? (
		editing ? (
			<ProjectFileEditor
				base={base}
				query={query}
				projectId={owner.projectId}
				threadId={owner.threadId}
				path={selected!.path}
				name={selected!.name}
				initial={file}
				active={active}
				apiRef={editorApi}
				onState={setEditorUi}
				onRequestExit={requestExit}
				onForceExit={exitEdit}
			/>
		) : (
			<>
				{stale && (
					<p className="files-message" role="status">
						This file changed since the search. Showing current content;
						refresh search results before using the matching line.
					</p>
				)}
				{line !== undefined && lines && lineIndex >= lines.length && (
					<p className="files-message" role="status">
						The matching line is no longer available. Refresh the search.
					</p>
				)}
				{line !== undefined && lines && lineIndex < lines.length && (
					<p className="files-message files-limit">Matching line {line}</p>
				)}
				{file.binary ? (
					<p className="files-message">
						Binary file; no text preview.
					</p>
				) : file.text === "" ? (
					<p className="files-message">Empty text file</p>
				) : (
					<pre>
						{lines && line !== undefined && lineIndex < lines.length ? (
							<>
								{renderParts(lines.slice(0, lineIndex))}
								<mark className="files-matching-line" ref={matchLine}>
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
		)
	) : null;
	return (
		<>
			<FilesView
				source="project"
				rootLabel="Project files"
				path={path}
				folder={folder}
				selected={selected}
				headerActions={headerActions}
				dirtyPath={editing && editorUi?.dirty ? selected?.path : undefined}
				onPreviewKeyDown={previewKeyDown}
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
								setSelectedMatch(match);
								guarded(() => {
									if (selected?.path === match.path) preview.refresh();
									else
										setSelected({
											name: match.path.split("/").at(-1)!,
											path: match.path,
											kind: "file",
										});
								});
								openPreview();
							}}
						/>
					),
				}}
				preview={{
					...preview,
					body: previewBody,
				}}
				limitNote={
					(folder.value?.entries.length ?? 0) >= 500
						? "Showing up to 500 entries; more files may exist."
						: undefined
				}
				onDirectory={(next) => {
					setSelectedMatch(null);
					guarded(() => {
						setEditing(false);
						setPath(next);
						setSelected(null);
					});
				}}
				onSelect={(entry) => {
					setSelectedMatch(null);
					guarded(() => {
						if (selected?.path === entry.path) preview.refresh();
						else {
							setEditing(false);
							setSelected(entry);
						}
					});
				}}
				onRefresh={() => {
					setSearchRefresh((value) => value + 1);
					folder.refresh();
					if (!editing) preview.refresh();
				}}
				onRetryFolder={folder.refresh}
				onRetryFile={preview.refresh}
			/>
			<Modal
				open={!!confirm}
				title={confirm ? `Save changes to ${confirm.name}?` : ""}
				onClose={() => setConfirm(null)}
			>
				{confirm && (
					<>
						<p>Your unsaved edits will be kept in the editor draft.</p>
						<footer className="dialog-actions">
							<button
								type="button"
								className="primary"
								onClick={() => {
									const pending = confirm;
									setConfirm(null);
									void editorApi.current
										?.save()
										.then((saved) => {
											if (saved) pending.action();
										});
								}}
							>
								Save
							</button>
							<button
								type="button"
								onClick={() => {
									const pending = confirm;
									setConfirm(null);
									editorApi.current?.discardDraft();
									pending.action();
								}}
							>
								Don't save
							</button>
							<button type="button" onClick={() => setConfirm(null)} autoFocus>
								Cancel
							</button>
						</footer>
					</>
				)}
			</Modal>
		</>
	);
}
