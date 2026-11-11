import { useCallback, useId, useRef, useState } from "react";
import { File, Search } from "lucide-react";
import {
	isComposing,
	useListNavigation,
} from "../../../../packages/ui-shell/list-navigation";
import { useFilesRead } from "./useFilesRead";
import {
	appendProjectSearch,
	projectSearchMatchKey,
	projectSearchQueryError,
	readProjectSearch,
	type ProjectSearchAdapter,
	type ProjectSearchMatch,
	type ProjectSearchOwner,
	type ProjectSearchPage,
} from "./project-search-api";

export interface ProjectSearchProps {
	adapter: ProjectSearchAdapter;
	owner: ProjectSearchOwner;
	active: boolean;
	refreshVersion: number;
	selected: ProjectSearchMatch | null;
	onSelect: (match: ProjectSearchMatch) => void;
}

export function ProjectSearch(props: ProjectSearchProps) {
	const [draft, setDraft] = useState(""),
		[query, setQuery] = useState("");
	const input = useRef<HTMLInputElement>(null),
		results = useRef<HTMLDivElement>(null),
		composing = useRef(false);
	const id = useId(),
		error = projectSearchQueryError(query);
	return (
		<>
			<label className="files-filter project-search-field" htmlFor={id}>
				<span>Search project</span>
				<div>
					<Search size={14} aria-hidden="true" />
					<input
						id={id}
						ref={input}
						type="search"
						value={draft}
						placeholder="File names and text"
						autoComplete="off"
						spellCheck={false}
						aria-invalid={!!error}
						aria-describedby={error ? `${id}-error` : undefined}
						onCompositionStart={() => {
							composing.current = true;
						}}
						onCompositionEnd={(event) => {
							composing.current = false;
							setQuery(event.currentTarget.value.trim());
						}}
						onChange={(event) => {
							setDraft(event.target.value);
							if (!composing.current) setQuery(event.target.value);
						}}
						onKeyDown={(event) => {
							if (isComposing(event)) return;
							if (event.key === "ArrowDown") {
								event.preventDefault();
								results.current
									?.querySelector<HTMLButtonElement>(".project-search-hit")
									?.focus();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								setDraft("");
								setQuery("");
							}
						}}
					/>
				</div>
			</label>
			<div
				className="files-list project-search-results"
				ref={results}
				onKeyDown={(event) => {
					if (event.key === "Escape" && !isComposing(event)) {
						event.preventDefault();
						event.stopPropagation();
						input.current?.focus();
					}
				}}
			>
				{error ? (
					<p
						id={`${id}-error`}
						className="files-message files-error"
						role="alert"
					>
						{error}
					</p>
				) : !query.trim() ? (
					<p className="files-message">
						Search file names and text in this project.
					</p>
				) : (
					<SearchResults
						key={JSON.stringify([props.owner, query])}
						{...props}
						query={query}
					/>
				)}
			</div>
		</>
	);
}

function SearchResults({
	adapter,
	owner,
	query,
	active,
	refreshVersion,
	selected,
	onSelect,
}: ProjectSearchProps & { query: string }) {
	const accepted = useRef<ProjectSearchPage | null>(null);
	const request = useRef<{ cursor?: string }>({}),
		refresh = useRef(refreshVersion);
	if (refresh.current !== refreshVersion) {
		refresh.current = refreshVersion;
		request.current = {};
	}
	const read = useCallback(
		async (signal: AbortSignal) => {
			const cursor = request.current.cursor,
				previous = accepted.current;
			const next = await readProjectSearch(
				adapter,
				{ owner, q: query, cursor, limit: 100 },
				signal,
				cursor ? (previous ?? undefined) : undefined,
			);
			return cursor && previous ? appendProjectSearch(previous, next) : next;
		},
		[adapter, owner.projectId, owner.threadId, query, refreshVersion],
	);
	const page = useFilesRead(JSON.stringify([owner, query]), active, read);
	accepted.current = page.value;
	const matches = active ? (page.value?.matches ?? []) : [];
	const navigation = useListNavigation(
		matches.map((match) => ({ label: match.path })),
		(index) => onSelect(matches[index]),
		() => {},
	);
	const incomplete = page.value && !page.value.complete;
	return (
		<>
			<p className="project-search-summary" role="status" aria-live="polite">
				{!active
					? "Project search is paused."
					: page.pending
						? page.value
							? "Refreshing results…"
							: "Searching project…"
						: page.value
							? `${matches.length} ${matches.length === 1 ? "result" : "results"} · ${incomplete ? "Incomplete results" : page.value.nextCursor ? "More results available" : "Project files and text"}`
							: ""}
			</p>
			{page.error && (
				<div className="files-message files-error" role="alert">
					<p>{page.error}</p>
					<button type="button" onClick={page.refresh}>
						Retry search
					</button>
					{page.value && (
						<button
							type="button"
							onClick={() => {
								request.current = {};
								page.refresh();
							}}
						>
							Restart search
						</button>
					)}
				</div>
			)}
			{!page.value && page.pending && (
				<div className="files-skeleton" aria-hidden="true">
					<i />
					<i />
					<i />
				</div>
			)}
			<ul
				aria-label="Project search results"
				aria-busy={page.pending}
				onKeyDown={navigation.onKeyDown}
			>
				{matches.map((match, index) => (
					<li key={projectSearchMatchKey(match)}>
						<button
							className="project-search-hit"
							title={match.path}
							type="button"
							ref={(node) => {
								navigation.rows.current[index] = node;
							}}
							onFocus={() => navigation.onFocus(index)}
							aria-current={
								selected &&
								projectSearchMatchKey(selected) === projectSearchMatchKey(match)
									? "true"
									: undefined
							}
							onClick={() => onSelect(match)}
						>
							<File size={15} aria-hidden="true" />
							<span>
								<strong>{match.path.split("/").at(-1)}</strong>
								<small>
									{match.path.split("/").slice(0, -1).join("/") ||
										"Project root"}
									{match.kind === "text"
										? ` · line ${match.line}`
										: " · File name"}
								</small>
								<span
									className={
										match.kind === "text" ? "project-search-snippet" : undefined
									}
								>
									{match.preview}
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>
			{active &&
				page.value &&
				!page.pending &&
				!page.error &&
				!matches.length && (
					<p className="files-message">
						{incomplete
							? "No matches in the searched portion of this project."
							: "No results in this project."}{" "}
						Try a different file name or phrase.
					</p>
				)}
			{active && page.value && (
				<>
					{incomplete && (
						<p className="files-message files-limit">
							Results are incomplete.{" "}
							{page.value.nextCursor && matches.length < 1000
								? "Load more to continue."
								: "Refine the query or refresh to search again."}
						</p>
					)}
					{page.value.nextCursor && matches.length < 1000 && (
						<button
							className="project-search-more"
							type="button"
							disabled={page.pending}
							onClick={() => {
								request.current = { cursor: page.value!.nextCursor! };
								page.refresh();
							}}
						>
							Load more results
						</button>
					)}
					{matches.length >= 1000 && (
						<p className="files-message">
							Showing 1,000 results. Refine your query to see fewer matches.
						</p>
					)}
					<details className="project-search-details">
						<summary>
							Search details
							{page.value.exclusions.length
								? ` · ${page.value.exclusions.length} exclusions`
								: ""}
						</summary>
						<p>Binding {page.value.owner.binding}</p>
						<p>
							Limits: {page.value.limits.files.toLocaleString()} files ·{" "}
							{page.value.limits.bytes.toLocaleString()} bytes ·{" "}
							{page.value.limits.matches} matches ·{" "}
							{page.value.limits.timeoutMs.toLocaleString()} ms ·{" "}
							{page.value.limits.fileBytes.toLocaleString()} bytes per file
						</p>
						{page.value.exclusions.map((item, index) => (
							<p key={index}>{item}</p>
						))}
						{page.value.issues.map((item, index) => (
							<p key={index}>
								{item.path ? `${item.path}: ` : ""}
								{item.reason.replaceAll("_", " ")}
							</p>
						))}
						{page.value.issuesTruncated && (
							<p>
								More issues were omitted. Refine the query or refresh to inspect
								fewer files.
							</p>
						)}
					</details>
				</>
			)}
		</>
	);
}
