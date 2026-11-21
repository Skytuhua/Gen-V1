import { TriangleAlert } from "lucide-react";
import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { ApiError } from "../api";
import { journalRead, journalWrite } from "../journal";
import { matchesShortcut } from "../shell-layout";
import { chordFor } from "../keyboard-bindings";
import {
	editErrorCopy,
	editJournalKey,
	editReduce,
	editSaveText,
	splitBom,
	type EditPhase,
} from "./manual-edit-state";
import {
	readProjectFile,
	saveFile,
	type ProjectFileRead,
} from "./manual-edit-api";
import type { CodeEditorHandle } from "./CodeEditor";

const CodeEditor = lazy(() => import("./CodeEditor"));
const CompareView = lazy(() => import("./CompareView"));

/** What the parent toolbar needs to render (dirty dot, Compare, Save, Done). */
export interface EditorUiState {
	phase: EditPhase;
	dirty: boolean;
	saving: boolean;
	conflict: boolean;
	unavailable: boolean;
	saved: boolean;
}

/** Imperative surface the parent uses for the unsaved-changes dialog and Done. */
export interface EditorApi {
	isDirty(): boolean;
	save(expectedSha256?: string): Promise<boolean>;
	discardDraft(): void;
}

interface ProjectFileEditorProps {
	base: string;
	query: string;
	projectId: string;
	threadId: string | null;
	path: string;
	name: string;
	initial: ProjectFileRead;
	active: boolean;
	apiRef: { current: EditorApi | undefined };
	onState: (state: EditorUiState) => void;
	onRequestExit: () => void;
	onForceExit: () => void;
}

interface Draft {
	text: string;
	sha256: string;
}

const POLL_MS = 5000;
const JOURNAL_DEBOUNCE_MS = 500;
/** Normalize every separator to LF for the in-editor document model. */
const displayText = (text: string) =>
	text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export function ProjectFileEditor({
	base,
	query,
	projectId,
	threadId,
	path,
	name,
	initial,
	active,
	apiRef,
	onState,
	onRequestExit,
	onForceExit,
}: ProjectFileEditorProps) {
	const [phase, setPhase] = useState<EditPhase>("loading");
	const [boot, setBoot] = useState<{ text: string; draft: Draft | null } | null>(
		null,
	);
	const [savedFlash, setSavedFlash] = useState(false);
	const [notice, setNotice] = useState("");
	const [errorBar, setErrorBar] = useState<{
		text: string;
		retry: boolean;
	} | null>(null);
	const [restoredBar, setRestoredBar] = useState(false);
	const [unavailableDismissed, setUnavailableDismissed] = useState(false);
	const [comparing, setComparing] = useState<string | null>(null);

	const journalKey = editJournalKey(projectId, threadId, path);
	const { bom, text: loadedDisplay } = splitBom(initial.text ?? "");
	const shaRef = useRef(initial.sha256);
	const bomRef = useRef(bom);
	const phaseRef = useRef<EditPhase>("loading");
	const draftRef = useRef<Draft | null>(null);
	const handleRef = useRef<CodeEditorHandle | undefined>(undefined);
	const loadedText = useRef(loadedDisplay);
	const diskConflictSha = useRef<string | undefined>(undefined);
	const journalTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	const setPhaseBoth = (next: EditPhase) => {
		phaseRef.current = next;
		setPhase(next);
	};
	const announce = (message: string) => {
		setNotice(message);
		clearTimeout(announceTimer.current);
		announceTimer.current = setTimeout(() => setNotice(""), 4000);
	};

	// Boot: check the journal draft before mounting the editor (R13).
	useEffect(() => {
		let cancelled = false;
		void journalRead<Draft>(journalKey)
			.catch(() => undefined)
			.then((record) => {
				if (cancelled) return;
				const draft =
					record &&
					typeof record === "object" &&
					typeof record.text === "string" &&
					typeof record.sha256 === "string" &&
					record.text !== loadedText.current
						? { text: record.text, sha256: record.sha256 }
						: null;
				draftRef.current = draft;
				if (draft) {
					if (draft.sha256 === shaRef.current) {
						// Same base: restore as dirty with the restore bar.
						setBoot({ text: draft.text, draft });
						setRestoredBar(true);
						setPhaseBoth("dirty");
					} else {
						// Disk moved since the draft: show the draft but conflict.
						setBoot({ text: draft.text, draft });
						diskConflictSha.current = shaRef.current;
						setPhaseBoth("conflict");
					}
				} else {
					setBoot({ text: displayText(loadedText.current), draft: null });
					setPhaseBoth("clean");
				}
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const writeDraft = useCallback(
		(text: string, sha256: string) => {
			void journalWrite(journalKey, { text, sha256 }).catch(() => {});
		},
		[journalKey],
	);

	const onDirty = useCallback(
		(dirty: boolean) => {
			if (phaseRef.current === "dirty" || phaseRef.current === "clean")
				setPhaseBoth(editReduce(phaseRef.current, { type: "change", dirty }));
			clearTimeout(journalTimer.current);
			journalTimer.current = setTimeout(() => {
				const handle = handleRef.current;
				if (handle)
					writeDraft(handle.document(), shaRef.current);
			}, JOURNAL_DEBOUNCE_MS);
		},
		[writeDraft],
	);

	const save = useCallback(
		async (expected?: string): Promise<boolean> => {
			const handle = handleRef.current;
			if (!handle || phaseRef.current === "saving") return false;
			setPhaseBoth("saving");
			setErrorBar(null);
			try {
				const text = editSaveText(bomRef.current, handle.document());
				const result = await saveFile(base, {
					...(threadId ? { threadId } : {}),
					path,
					text,
					expectedSha256: expected ?? shaRef.current,
				});
				shaRef.current = result.sha256;
				handle.rebase();
				loadedText.current = handle.document();
				writeDraft(handle.document(), result.sha256);
				setPhaseBoth("clean");
				setSavedFlash(true);
				setTimeout(() => setSavedFlash(false), 1200);
				announce(`Saved ${name}`);
				return true;
			} catch (cause) {
				if (cause instanceof ApiError && cause.code === "PRECONDITION_FAILED") {
					const details = cause.details as { sha256?: string } | undefined;
					diskConflictSha.current = details?.sha256;
					setPhaseBoth("conflict");
				} else {
					const copy = editErrorCopy(
						cause instanceof ApiError ? cause.code : "",
					);
					setErrorBar(copy);
					setPhaseBoth("dirty");
				}
				return false;
			}
		},
		[base, name, path, threadId, writeDraft],
	);

	const applyDisk = useCallback(
		(disk: ProjectFileRead) => {
			const { bom: nextBom, text } = splitBom(disk.text ?? "");
			const display = displayText(text);
			bomRef.current = nextBom;
			shaRef.current = disk.sha256;
			loadedText.current = display;
			handleRef.current?.replaceAll(display);
			writeDraft(display, disk.sha256);
			setPhaseBoth("clean");
		},
		[writeDraft],
	);

	// Poll the disk SHA while the editor can still absorb a change (R12).
	useEffect(() => {
		if (!active || (phase !== "clean" && phase !== "dirty")) return;
		let closed = false;
		const controller = new AbortController();
		const probe = async () => {
			try {
				const disk = await readProjectFile(
					base,
					query,
					path,
					controller.signal,
				);
				if (closed || disk.sha256 === shaRef.current) return;
				if (phaseRef.current === "clean") {
					applyDisk(disk);
					announce(`Reloaded ${name}: changed on disk`);
				} else if (phaseRef.current === "dirty") {
					diskConflictSha.current = disk.sha256;
					setPhaseBoth("conflict");
				}
			} catch (cause) {
				if (closed) return;
				if (
					cause instanceof ApiError &&
					(cause.code === "CAPABILITY_DENIED" ||
						cause.code === "NOT_FOUND" ||
						cause.code === "PROJECT_NOT_CONNECTED")
				)
					setPhaseBoth("unavailable");
			}
		};
		const timer = setInterval(() => void probe(), POLL_MS);
		const focus = () => {
			if (document.visibilityState === "visible") void probe();
		};
		window.addEventListener("focus", focus);
		return () => {
			closed = true;
			controller.abort();
			clearInterval(timer);
			window.removeEventListener("focus", focus);
		};
	}, [active, phase, base, query, path, name, applyDisk]);

	// Keep the unsaved-draft promise during window unload (R13).
	const dirtyNow =
		phase === "dirty" || phase === "saving" || phase === "conflict";
	useEffect(() => {
		if (!dirtyNow) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirtyNow]);

	// Inside the editor its own Escape handler closes the search panel first.
	const done = onRequestExit;

	useEffect(() => {
		apiRef.current = {
			isDirty: () => phaseRef.current !== "clean" && phaseRef.current !== "unavailable",
			save,
			discardDraft: () =>
				writeDraft(loadedText.current, shaRef.current),
		};
		return () => {
			apiRef.current = undefined;
		};
	}, [apiRef, save, writeDraft]);

	useEffect(() => {
		onState({
			phase,
			dirty: dirtyNow,
			saving: phase === "saving",
			conflict: phase === "conflict" || phase === "comparing",
			unavailable: phase === "unavailable",
			saved: savedFlash,
		});
	}, [phase, dirtyNow, savedFlash, onState]);

	const reloadFromDisk = useCallback(async () => {
		try {
			const disk = await readProjectFile(
				base,
				query,
				path,
				new AbortController().signal,
			);
			applyDisk(disk);
			setComparing(null);
			announce(`Reloaded ${name}`);
		} catch {
			setErrorBar({
				text: "Couldn't reload the file. Your changes are kept.",
				retry: false,
			});
			setPhaseBoth("conflict");
		}
	}, [applyDisk, base, name, path, query]);

	const compare = useCallback(async () => {
		try {
			const disk = await readProjectFile(
				base,
				query,
				path,
				new AbortController().signal,
			);
			setComparing(disk.text ?? "");
			setPhaseBoth("comparing");
		} catch {
			setErrorBar({
				text: "Couldn't load the disk copy for comparison.",
				retry: false,
			});
		}
	}, [base, path, query]);

	const onKeyDownCapture = (event: React.KeyboardEvent) => {
		const insideEditor = (event.target as HTMLElement).closest?.(
			".cm-editor",
		);
		if (!insideEditor && matchesShortcut(event, chordFor('files.save'))) {
			event.preventDefault();
			void save();
		} else if (!insideEditor && matchesShortcut(event, chordFor('files.doneEditing'))) {
			event.preventDefault();
			done();
		}
	};

	const bar = (
		message: string,
		kind: "info" | "conflict" | "error",
		actions: React.ReactNode,
	) => (
		<div
			className={`files-edit-bar files-edit-bar-${kind}`}
			role={kind === "info" ? "status" : "alert"}
		>
			<div className="files-edit-bar-inner">
				{kind !== "info" && (
					<TriangleAlert size={13} aria-hidden="true" />
				)}
				<span>{message}</span>
				<div className="files-edit-bar-actions">{actions}</div>
			</div>
		</div>
	);

	return (
		<div className="files-edit-host" onKeyDownCapture={onKeyDownCapture}>
			<div className="files-edit-announce" role="status" aria-live="polite">
				{notice}
			</div>
			{restoredBar &&
				bar(
					"Restored unsaved changes.",
					"info",
					<>
						<button type="button" onClick={() => setRestoredBar(false)}>
							Keep
						</button>
						<button
							type="button"
							onClick={() => {
								setRestoredBar(false);
								handleRef.current?.replaceAll(loadedText.current);
								writeDraft(loadedText.current, shaRef.current);
								setPhaseBoth("clean");
							}}
						>
							Discard
						</button>
					</>,
				)}
			{(phase === "conflict" || phase === "comparing") &&
				bar(
					`${name} changed on disk since you opened it.`,
					"conflict",
					<>
						{phase === "comparing" ? (
							<button
								type="button"
								onClick={() => setPhaseBoth("conflict")}
							>
								Close
							</button>
						) : (
							<button type="button" onClick={() => void compare()}>
								Compare
							</button>
						)}
						<button type="button" onClick={() => void reloadFromDisk()}>
							Reload
						</button>
						<button
							type="button"
							onClick={() =>
								void save(diskConflictSha.current ?? shaRef.current)
							}
						>
							Overwrite
						</button>
					</>,
				)}
			{phase === "unavailable" &&
				!unavailableDismissed &&
				bar(
					`${name} is no longer available.`,
					"error",
					<>
						<button
							type="button"
							onClick={() => setUnavailableDismissed(true)}
						>
							Keep editing
						</button>
						<button type="button" onClick={onForceExit}>
							Close
						</button>
					</>,
				)}
			{errorBar &&
				bar(
					errorBar.text,
					"error",
					<>
						{errorBar.retry && (
							<button type="button" onClick={() => void save()}>
								Retry
							</button>
						)}
						<button type="button" onClick={() => setErrorBar(null)}>
							Close
						</button>
					</>,
				)}
			{initial.edit?.lineSeparator === "mixed" &&
				bar("This file mixes line endings; saving will use LF.", "info", <></>)}
			{boot ? (
				<>
					<div hidden={phase === "comparing"}>
						<Suspense
							fallback={
								<p className="files-message" role="status">
									Loading…
								</p>
							}
						>
							<CodeEditor
								path={path}
								initialText={boot.text}
								lineSeparator={
									initial.edit?.lineSeparator ?? "lf"
								}
								wordWrap={
									document
										.querySelector(".app-shell")
										?.getAttribute("data-word-wrap") === "true"
								}
								baselineText={loadedDisplay}
								onDirty={onDirty}
								onSave={() => void save()}
								onDone={done}
								handleRef={handleRef}
							/>
						</Suspense>
					</div>
					{phase === "comparing" && comparing !== null && (
						<Suspense
							fallback={
								<p className="files-message" role="status">
									Loading…
								</p>
							}
						>
							<CompareView
								left={displayText(comparing)}
								right={handleRef.current?.document() ?? ""}
							/>
						</Suspense>
					)}
				</>
			) : (
				<p className="files-message" role="status">
					Loading…
				</p>
			)}
		</div>
	);
}
