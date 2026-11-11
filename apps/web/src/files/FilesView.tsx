import { useId, useRef, useState, type ReactNode } from "react";
import {
	ArrowLeft,
	ChevronRight,
	File,
	Folder,
	PanelLeft,
	RefreshCw,
	Search,
} from "lucide-react";
import type { FilesRead } from "./useFilesRead";
import "./files.css";

export interface FilesEntry {
	name: string;
	path: string;
	kind: string;
	bytes?: number;
}
export function FilesView({
	source,
	rootLabel,
	path,
	folder,
	selected,
	preview,
	selector,
	download,
	limitNote,
	onDirectory,
	onSelect,
	onRefresh,
	onRetryFolder,
	onRetryFile,
}: {
	source: "project" | "granted";
	rootLabel: string;
	path: string;
	folder: FilesRead<{ entries: FilesEntry[] }>;
	selected: FilesEntry | null;
	preview: FilesRead<unknown> & { body: ReactNode };
	selector?: ReactNode;
	download?: string;
	limitNote?: string;
	onDirectory: (path: string) => void;
	onSelect: (entry: FilesEntry) => void;
	onRefresh: () => void;
	onRetryFolder: () => void;
	onRetryFile: () => void;
}) {
	const previewElement = useRef<HTMLElement>(null);
	const [filter, setFilter] = useState(""),
		[treeOpen, setTreeOpen] = useState(true),
		listId = useId(),
		filterId = useId();
	const entries = folder.value?.entries ?? [],
		visible = entries.filter((entry) =>
			entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
		);
	const directory = (next: string) => {
		setFilter("");
		onDirectory(next);
	};
	const parts = path.split("/").filter(Boolean);
	return (
		<div
			className={`files-surface ${source === "project" ? "live-files" : "granted-files"}`}
		>
			<div className="files-toolbar panel-toolbar">
				{selector ?? <strong>Project files</strong>}
				<div className="files-actions">
					<button
						className="files-tree-toggle"
						type="button"
						aria-label="Toggle file list"
						aria-controls={listId}
						aria-expanded={treeOpen}
						onClick={() => setTreeOpen((value) => !value)}
					>
						<PanelLeft size={15} />
						<span>Files</span>
					</button>
					<button
						type="button"
						aria-label={
							source === "project" ? "Refresh" : "Refresh granted files"
						}
						onClick={onRefresh}
					>
						<RefreshCw size={14} />
						<span>Refresh</span>
					</button>
				</div>
				<nav className="files-breadcrumb" aria-label="Folder breadcrumb">
					<button
						type="button"
						aria-label="Parent directory"
						disabled={!path}
						onClick={() => directory(parts.slice(0, -1).join("/"))}
					>
						<ArrowLeft size={14} />
					</button>
					<button
						type="button"
						onClick={() => directory("")}
						aria-current={!path ? "location" : undefined}
					>
						{rootLabel}
					</button>
					{parts.map((part, index) => (
						<span key={parts.slice(0, index + 1).join("/")}>
							<ChevronRight size={12} />
							<button
								type="button"
								aria-current={
									index === parts.length - 1 ? "location" : undefined
								}
								onClick={() => directory(parts.slice(0, index + 1).join("/"))}
							>
								{part}
							</button>
						</span>
					))}
				</nav>
			</div>
			<div className="files-content" data-tree-open={treeOpen}>
				<nav
					className="files-directory"
					id={listId}
					aria-label={source === "project" ? "Project files" : "Granted files"}
					aria-busy={folder.pending}
				>
					<label className="files-filter" htmlFor={filterId}>
						<span>Filter this folder</span>
						<div>
							<Search size={14} />
							<input
								id={filterId}
								type="search"
								value={filter}
								onChange={(event) => setFilter(event.target.value)}
								placeholder="File or folder name"
								title="Filters only entries returned for this folder"
							/>
						</div>
					</label>
					<div className="files-list" tabIndex={0} aria-label="Folder entries">
						{folder.pending && (
							<p className="files-message" role="status">
								{folder.value ? "Refreshing…" : "Loading…"}
							</p>
						)}
						{folder.error && (
							<div className="files-message files-error" role="alert">
								<p>{folder.error}</p>
								<button type="button" onClick={onRetryFolder}>
									Retry
								</button>
							</div>
						)}
						{!folder.value && folder.pending && (
							<div className="files-skeleton" aria-hidden="true">
								<i />
								<i />
								<i />
							</div>
						)}
						<ul>
							{visible.map((entry) => (
								<li key={entry.path}>
									<button
										type="button"
										title={entry.path}
										aria-label={entry.name}
										aria-current={
											selected?.path === entry.path ? "true" : undefined
										}
										onClick={() => {
											if (entry.kind === "directory") directory(entry.path);
											else {
												onSelect(entry);
												setTreeOpen(false);
												previewElement.current?.focus({ preventScroll: true });
											}
										}}
									>
										{entry.kind === "directory" ? (
											<Folder size={15} />
										) : (
											<File size={15} />
										)}
										<span>{entry.name}</span>
										{entry.kind === "directory" ? (
											<ChevronRight size={12} />
										) : entry.bytes !== undefined ? (
											<small>
												{new Intl.NumberFormat().format(entry.bytes)} B
											</small>
										) : null}
									</button>
								</li>
							))}
						</ul>
						{folder.value &&
							!folder.pending &&
							!folder.error &&
							visible.length === 0 && (
								<p className="files-message">
									{filter
										? "No matches."
										: "Folder is empty."}
								</p>
							)}
						{limitNote && (
							<p className="files-message files-limit">{limitNote}</p>
						)}
					</div>
				</nav>
				<section
					className="files-preview"
					ref={previewElement}
					tabIndex={-1}
					aria-label="File content"
					aria-busy={preview.pending}
				>
					{selected ? (
						<>
							<header>
								<strong title={selected.path}>{selected.name}</strong>
								{download && (
									<a href={download} download={selected.name}>
										Download
									</a>
								)}
							</header>
							<div
								className="files-preview-content"
								tabIndex={0}
								aria-label="File preview"
							>
								{preview.pending && (
									<p className="files-message" role="status">
										{preview.value ? "Refreshing…" : "Loading…"}
									</p>
								)}
								{preview.error && (
									<div className="files-message files-error" role="alert">
										<p>{preview.error}</p>
										<button type="button" onClick={onRetryFile}>
											Retry
										</button>
									</div>
								)}
								{!preview.value && preview.pending && (
									<div className="files-skeleton" aria-hidden="true">
										<i />
										<i />
										<i />
									</div>
								)}
								{preview.body}
							</div>
						</>
					) : (
						<div className="files-message files-unselected">
							<File size={22} />
							<strong>Choose a file</strong>
							<p>
								{source === "project"
									? "Shows current working copy content."
									: "Preview or download a file from this granted resource."}
							</p>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
