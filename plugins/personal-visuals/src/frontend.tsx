import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import manifest from "../plugin.json";
import { runtime } from "./runtime";
import {
	parseDiagramJson,
	type DiagramDocument,
	type DocumentWrite,
	type VisualDocumentRecord,
	VISUAL_LIMITS,
} from "./contracts";
import { diagramLayout, exampleDiagram, nodeColors } from "./diagram";
import { prepareVisualDraft } from "./draft";
import "./visuals.css";

const host = runtime!;
const unavailable = async () => {
	throw Error("Personal Visuals does not send messages or run models.");
};
host.registerPlugin(manifest, {
	navigation: [{ id: "visuals", title: "Personal Visuals" }],
	workspaces: manifest.workspaces,
	conversation: {
		load: unavailable,
		send: unavailable,
		submitArtifactAction: unavailable,
		cancel: unavailable,
	},
});
type Receipt = { documentId: string; revision: number; requestId: string };
function VisualCanvas({
	document,
	selected,
	select,
}: {
	document: DiagramDocument;
	selected: string;
	select: (id: string) => void;
}) {
	const layout = useMemo(() => diagramLayout(document), [document]),
		viewportRef = useRef<HTMLDivElement>(null),
		autoFit = useRef(true),
		[view, setView] = useState({ x: 12, y: 12, zoom: 1 });
	const viewRef = useRef(view);
	viewRef.current = view;
	const fit = useCallback(() => {
		const rect = viewportRef.current?.getBoundingClientRect();
		if (rect && rect.width > 0 && rect.height > 0)
			setView({
				x: 16,
				y: 16,
				zoom: Math.max(
					0.2,
					Math.min(
						1.5,
						(rect.width - 32) / layout.width,
						(rect.height - 32) / layout.height,
					),
				),
			});
	}, [layout.width, layout.height]);
	useLayoutEffect(() => {
		autoFit.current = true;
		fit();
		const observer = new ResizeObserver(() => {
			if (autoFit.current) fit();
		});
		if (viewportRef.current) observer.observe(viewportRef.current);
		return () => observer.disconnect();
	}, [fit, document]);
	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			autoFit.current = false;
			const rect = element.getBoundingClientRect(),
				x = event.clientX - rect.left,
				y = event.clientY - rect.top;
			setView((value) => {
				const zoom = Math.max(
					0.2,
					Math.min(2.5, value.zoom * Math.exp(-event.deltaY * 0.001)),
				);
				return {
					zoom,
					x: x - ((x - value.x) * zoom) / value.zoom,
					y: y - ((y - value.y) * zoom) / value.zoom,
				};
			});
		};
		element.addEventListener("wheel", wheel, { passive: false });
		return () => element.removeEventListener("wheel", wheel);
	}, []);
	function pan(event: ReactPointerEvent<HTMLDivElement>) {
		if (
			event.button !== 0 ||
			(event.target as Element).closest('button,[role="button"]')
		)
			return;
		const element = event.currentTarget,
			initial = viewRef.current,
			start = { x: event.clientX, y: event.clientY };
		autoFit.current = false;
		element.setPointerCapture(event.pointerId);
		const move = (next: PointerEvent) =>
			setView({
				...initial,
				x: initial.x + next.clientX - start.x,
				y: initial.y + next.clientY - start.y,
			});
		const end = () => {
			element.removeEventListener("pointermove", move);
			element.removeEventListener("pointerup", end);
			element.removeEventListener("pointercancel", cancel);
			element.removeEventListener("lostpointercapture", cancel);
		};
		const cancel = () => {
			setView(initial);
			end();
		};
		element.addEventListener("pointermove", move);
		element.addEventListener("pointerup", end);
		element.addEventListener("pointercancel", cancel);
		element.addEventListener("lostpointercapture", cancel);
	}
	return (
		<section className="pv-canvas" aria-label={document.title}>
			<div className="pv-canvas-tools">
				<span>
					{document.kind === "dependencies"
						? "Dependency map"
						: document.kind === "flow"
							? "System flow"
							: document.kind === "timeline"
								? "Timeline"
								: "Architecture"}
				</span>
				<button
					onClick={() => {
						autoFit.current = true;
						fit();
					}}
				>
					Fit
				</button>
				<button
					aria-label="Zoom out diagram"
					onClick={() => {
						autoFit.current = false;
						setView((value) => ({
							...value,
							zoom: Math.max(0.2, value.zoom - 0.1),
						}));
					}}
				>
					−
				</button>
				<span>{Math.round(view.zoom * 100)}%</span>
				<button
					aria-label="Zoom in diagram"
					onClick={() => {
						autoFit.current = false;
						setView((value) => ({
							...value,
							zoom: Math.min(2.5, value.zoom + 0.1),
						}));
					}}
				>
					+
				</button>
			</div>
			<div className="pv-canvas-viewport" ref={viewportRef} onPointerDown={pan}>
				<div
					className="pv-world"
					style={{
						width: layout.width,
						height: layout.height,
						transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})`,
					}}
				>
					<svg
						width={layout.width}
						height={layout.height}
						className="pv-connections"
						aria-label="Diagram relationships"
					>
						<defs>
							<marker
								id="pv-arrow"
								viewBox="0 0 10 10"
								refX="9"
								refY="5"
								markerWidth="7"
								markerHeight="7"
								orient="auto-start-reverse"
							>
								<path d="M0 0 10 5 0 10Z" fill="currentColor" />
							</marker>
						</defs>
						{layout.timeRange && (
							<g className="pv-time-axis">
								<path d="M130 28H930" />
								<text x="130" y="18">
									{layout.timeRange.start} {document.timeUnit ?? "units"}
								</text>
								<text x="930" y="18" textAnchor="end">
									{layout.timeRange.end} {document.timeUnit ?? "units"}
								</text>
							</g>
						)}
						{document.edges.map((edge) => {
							const a = layout.nodes[edge.from],
								b = layout.nodes[edge.to],
								path = `M${a.x + a.width},${a.y + a.height / 2} C${a.x + a.width + 50},${a.y + a.height / 2} ${b.x - 50},${b.y + b.height / 2} ${b.x},${b.y + b.height / 2}`;
							return (
								<g
									key={edge.id}
									className={
										selected === "edge:" + edge.id ? "is-selected" : ""
									}
								>
									<path d={path} markerEnd="url(#pv-arrow)" />
									<path
										className="pv-edge-hit"
										d={path}
										role="button"
										tabIndex={0}
										aria-label={`${document.nodes.find((node) => node.id === edge.from)?.label} ${edge.label || "connects to"} ${document.nodes.find((node) => node.id === edge.to)?.label}`}
										onClick={() => select("edge:" + edge.id)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												select("edge:" + edge.id);
											}
										}}
									/>
									{edge.label && (
										<text
											x={(a.x + a.width + b.x) / 2}
											y={(a.y + a.height / 2 + b.y + b.height / 2) / 2 - 8}
										>
											{edge.label}
										</text>
									)}
								</g>
							);
						})}
					</svg>
					{document.nodes.map((node) => {
						const rect = layout.nodes[node.id];
						return (
							<button
								key={node.id}
								className={
									"pv-node" +
									(document.kind === "timeline" ? " pv-timeline-node" : "") +
									(selected === "node:" + node.id ? " is-selected" : "")
								}
								style={
									{
										left: rect.x,
										top: rect.y,
										width: rect.width,
										height: rect.height,
										"--node-color": nodeColors[node.kind],
									} as CSSProperties
								}
								onClick={() => select("node:" + node.id)}
								aria-pressed={selected === "node:" + node.id}
								title={node.label}
							>
								<span className="pv-node-kind" aria-hidden="true">
									{node.kind === "data"
										? "▱"
										: node.kind === "actor"
											? "◉"
											: node.kind === "event"
												? "◆"
												: "◇"}
								</span>
								<strong>{node.label}</strong>
								{document.kind !== "timeline" && <small>{node.kind}</small>}
							</button>
						);
					})}
				</div>
			</div>
			<div className="pv-legend">
				{[...new Set(document.nodes.map((node) => node.kind))].map((kind) => (
					<span key={kind}>
						<i style={{ background: nodeColors[kind] }} />
						{kind}
					</span>
				))}
				<small>Structure and supplied sources · no live status inferred</small>
			</div>
		</section>
	);
}

function App() {
	const initial = useMemo(() => exampleDiagram("architecture"), []),
		[diagram, setDiagram] = useState(initial),
		[text, setText] = useState(JSON.stringify(initial, null, 2)),
		[selected, setSelected] = useState("node:" + initial.nodes[0].id),
		[ready, setReady] = useState(false),
		[editing, setEditing] = useState(false),
		// The sandboxed frame has no storage; the host persists dismissal.
		[introOpen, setIntroOpen] = useState(
			() => !host.pluginPresentation().introDismissed,
		),
		[status, setStatus] = useState("Recovering visual document…"),
		[error, setError] = useState(""),
		[writeFailed, setWriteFailed] = useState(false),
		[exportText, setExportText] = useState<string>(),
		[pendingReplace, setPendingReplace] = useState<DiagramDocument>();
	const revision = useRef(0),
		latest = useRef(text),
		persistedDraft = useRef<string | null>(null),
		committed = useRef<DiagramDocument | null>(null),
		timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
		tail = useRef<Promise<unknown>>(Promise.resolve()),
		unconfirmed = useRef<DocumentWrite | undefined>(undefined),
		alive = useRef(true),
		readyRef = useRef(false),
		hasEdits = useRef(false),
		file = useRef<HTMLInputElement>(null),
		exportButton = useRef<HTMLButtonElement>(null),
		exportInput = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (exportText !== undefined) exportInput.current?.focus();
	}, [exportText]);
	// Host presentation is hide-only: a persisted dismissal never reopens the intro.
	useEffect(
		() =>
			host.onPluginPresentation((presentation) => {
				if (presentation.introDismissed) setIntroOpen(false);
			}),
		[],
	);
	const send = useCallback(async (intent: DocumentWrite) => {
		unconfirmed.current = intent;
		try {
			const receipt = await host.pluginRequest<Receipt>(
				"visual.document.write",
				intent,
			);
			if (
				receipt.documentId !== "main" ||
				receipt.requestId !== intent.requestId ||
				receipt.revision !== intent.baseRevision + 1
			)
				throw Error("The save receipt does not match this visual document.");
			revision.current = receipt.revision;
			unconfirmed.current = undefined;
			if (intent.action === "draft") persistedDraft.current = intent.draft;
			else {
				committed.current = intent.document;
				persistedDraft.current = null;
			}
			if (alive.current) {
				setStatus(
					intent.action === "draft"
						? "Draft saved on this device"
						: "Visual document saved",
				);
				setError("");
				setWriteFailed(false);
			}
		} catch {
			if (alive.current) {
				setStatus("Save unconfirmed");
				setWriteFailed(true);
				setError(
					"Keep this editor open. Retry the same save before making another change.",
				);
			}
			throw Error("A visual save remains unconfirmed.");
		}
	}, []);
	const enqueue = useCallback(
		(action: "draft" | "commit", value: string | DiagramDocument) => {
			const execute = async () => {
				if (unconfirmed.current)
					throw Error("Retry the unconfirmed save first.");
				const fields = {
						documentId: "main",
						requestId: crypto.randomUUID(),
						baseRevision: revision.current,
					},
					intent =
						action === "draft"
							? { ...fields, action: "draft" as const, draft: value as string }
							: {
									...fields,
									action: "commit" as const,
									document: value as DiagramDocument,
								};
				await send(intent);
			};
			const result = tail.current.then(execute, execute);
			tail.current = result.catch(() => {});
			return result;
		},
		[send],
	);
	const flush = useCallback(async () => {
		if (timer.current) {
			clearTimeout(timer.current);
			timer.current = undefined;
		}
		await tail.current;
		if (unconfirmed.current)
			throw Error("Retry saving the visual draft before leaving.");
		const saved =
			persistedDraft.current ??
			(committed.current ? JSON.stringify(committed.current, null, 2) : null);
		if (readyRef.current && hasEdits.current && latest.current !== saved)
			await enqueue("draft", latest.current);
	}, [enqueue]);
	useEffect(() => {
		alive.current = true;
		const controller = new AbortController();
		void host
			.pluginRequest<VisualDocumentRecord>(
				"visual.document.read",
				{ documentId: "main" },
				controller.signal,
			)
			.then((record) => {
				if (!alive.current || controller.signal.aborted) return;
				if (
					record.documentId !== "main" ||
					!Number.isSafeInteger(record.revision) ||
					record.revision < 0
				)
					throw Error("Visual document recovery is unavailable.");
				revision.current = record.revision;
				committed.current = record.document;
				persistedDraft.current = record.draft;
				const source = record.document ?? initial,
					raw = record.draft ?? JSON.stringify(source, null, 2);
				setDiagram(source);
				setText(raw);
				latest.current = raw;
				setSelected("node:" + source.nodes[0].id);
				setReady(true);
				readyRef.current = true;
				setStatus(
					record.draft
						? "Recovered saved draft"
						: record.document
							? "Visual document saved"
							: "Example · import your own structure",
				);
				host.pluginReady();
			})
			.catch(() => {
				if (!controller.signal.aborted && alive.current)
					setError(
						"Saved visual data could not be recovered. It has not been replaced.",
					);
			});
		const remove = host.registerEditorHandoff(
			"personal-visuals:document:main",
			flush,
		);
		return () => {
			alive.current = false;
			controller.abort();
			if (timer.current) clearTimeout(timer.current);
			remove();
		};
	}, [initial, flush]);
	function edit(value: string) {
		if (new TextEncoder().encode(value).length > VISUAL_LIMITS.documentBytes) {
			setError("The draft exceeds the 96 KiB limit.");
			return;
		}
		acceptEdit(value);
	}
	function acceptEdit(
		value: string,
		staged?: ReturnType<typeof prepareVisualDraft>,
	) {
		if (staged) {
			setDiagram(staged.document);
			setSelected(staged.selected);
		}
		hasEdits.current = true;
		latest.current = value;
		setText(value);
		if (staged) setError("");
		setStatus("Saving draft…");
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			timer.current = undefined;
			void enqueue("draft", latest.current).catch(() => {});
		}, 250);
	}
	function stage(value: DiagramDocument) {
		try {
			const prepared = prepareVisualDraft(value);
			if (!readyRef.current || unconfirmed.current) return;
			acceptEdit(prepared.text, prepared);
			setPendingReplace(undefined);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The diagram could not be staged.",
			);
		}
	}
	function propose(value: DiagramDocument) {
		try {
			const prepared = prepareVisualDraft(value);
			if (!readyRef.current || unconfirmed.current) return;
			if (
				latest.current !==
				(committed.current
					? JSON.stringify(committed.current, null, 2)
					: JSON.stringify(initial, null, 2))
			)
				setPendingReplace(prepared.document);
			else stage(prepared.document);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The diagram could not be staged.",
			);
		}
	}
	async function importFile(selectedFile: File | undefined) {
		if (!selectedFile) return;
		try {
			if (selectedFile.size > VISUAL_LIMITS.documentBytes)
				throw Error("The diagram exceeds the 96 KiB import limit.");
			propose(parseDiagramJson(await selectedFile.text()));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The diagram could not be imported.",
			);
		} finally {
			if (file.current) file.current.value = "";
		}
	}
	function preview() {
		try {
			const next = parseDiagramJson(latest.current);
			setDiagram(next);
			setSelected("node:" + next.nodes[0].id);
			setError("");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The draft is not a valid diagram.",
			);
		}
	}
	async function save() {
		try {
			const expected = latest.current,
				next = parseDiagramJson(expected);
			await flush();
			if (latest.current !== expected)
				throw Error(
					"The draft changed while saving. Save its latest version again.",
				);
			await enqueue("commit", next);
			setDiagram(next);
			if (latest.current === expected) {
				hasEdits.current = false;
				latest.current = JSON.stringify(next, null, 2);
				setText(latest.current);
			} else await enqueue("draft", latest.current);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The visual document could not save.",
			);
		}
	}
	async function retry() {
		const intent = unconfirmed.current;
		if (!intent) return;
		try {
			await send(intent);
			if (intent.action === "draft" && latest.current !== intent.draft)
				await enqueue("draft", latest.current);
			if (intent.action === "commit") {
				setDiagram(intent.document);
				let matches = false;
				try {
					matches =
						JSON.stringify(parseDiagramJson(latest.current)) ===
						JSON.stringify(intent.document);
				} catch {
					/* Keep a newer partial JSON draft. */
				}
				if (matches) {
					hasEdits.current = false;
					latest.current = JSON.stringify(intent.document, null, 2);
					setText(latest.current);
				} else await enqueue("draft", latest.current);
			}
		} catch {
			/* Exact intent stays available for recovery. */
		}
	}
	async function recover() {
		const intent = unconfirmed.current;
		if (!intent) return;
		try {
			const record = await host.pluginRequest<VisualDocumentRecord>(
				"visual.document.read",
				{ documentId: "main", requestId: intent.requestId },
			);
			if (
				record.documentId !== "main" ||
				record.revision < revision.current ||
				record.pending
			)
				throw Error(
					"The current save remains unconfirmed. Retry its exact request.",
				);
			if (
				record.receipt &&
				(record.receipt.requestId !== intent.requestId ||
					record.receipt.revision !== intent.baseRevision + 1)
			)
				throw Error("The saved receipt does not match this editor.");
			revision.current = record.revision;
			committed.current = record.document;
			persistedDraft.current = record.draft;
			unconfirmed.current = undefined;
			setError("");
			setWriteFailed(false);
			setStatus("Saved revision recovered ? your local draft is kept");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The saved revision is unavailable.",
			);
		}
	}
	function closeExport() {
		setExportText(undefined);
		requestAnimationFrame(() => exportButton.current?.focus());
	}
	const [type, id] = selected.split(":"),
		node =
			type === "node"
				? diagram.nodes.find((value) => value.id === id)
				: undefined,
		edge =
			type === "edge"
				? diagram.edges.find((value) => value.id === id)
				: undefined,
		item = node ?? edge,
		sourceIds = item?.sourceIds ?? [];
	return (
		<main className="pv-app">
			<header className="pv-header">
				<div>
					<h1>{diagram.title}</h1>
					<span className={"pv-provenance " + diagram.provenance}>
						{diagram.provenance === "example"
							? "Example"
							: diagram.provenance === "derived"
								? "Derived document"
								: "Provided document"}
					</span>
				</div>
				<input
					ref={file}
					type="file"
					accept="application/json,.json"
					hidden
					onChange={(event) => void importFile(event.target.files?.[0])}
				/>
				<button
					disabled={!ready || writeFailed}
					onClick={() => file.current?.click()}
				>
					Import JSON
				</button>
				<button
					disabled={!ready}
					onClick={() => setEditing(!editing)}
					aria-expanded={editing}
				>
					Edit
				</button>
				<button
					ref={exportButton}
					disabled={!ready}
					onClick={() => setExportText(latest.current)}
				>
					Export JSON
				</button>
				<button disabled={!ready || writeFailed} onClick={() => void save()}>
					Save
				</button>
			</header>
			{introOpen && (
				<section className="pv-intro" role="note" aria-label="About this workspace">
					<div>
						<strong>Diagrams from your own JSON</strong>
						<p>
							Visuals draws architecture, dependency, flow and timeline
							diagrams from structured JSON. It runs no models and shows no
							live agent activity. Documents stay on this device. Try an
							example, Import JSON, or Edit the JSON inline.
						</p>
					</div>
					<button
						onClick={() => {
							setIntroOpen(false);
							void host
								.pluginRequest("presentation.set", { introDismissed: true })
								.catch(() => {});
						}}
					>
						Dismiss
					</button>
				</section>
			)}
			<div className="pv-status">
				<span role="status">{status}</span>
				{!introOpen && (
					<button className="pv-about" onClick={() => setIntroOpen(true)}>
						About Visuals
					</button>
				)}
				<details>
					<summary>Examples</summary>
					<div>
						{(
							["architecture", "dependencies", "flow", "timeline"] as const
						).map((kind) => (
							<button
								key={kind}
								disabled={!ready || writeFailed}
								onClick={() => propose(exampleDiagram(kind))}
							>
								{kind === "flow"
									? "System flow"
									: kind[0].toUpperCase() + kind.slice(1)}
							</button>
						))}
					</div>
				</details>
			</div>
			{error && (
				<div className="pv-error" role="alert">
					{error}
					{writeFailed && (
						<>
							<button onClick={() => void retry()}>Retry exact save</button>
							<button onClick={() => void recover()}>
								Recover saved revision
							</button>
						</>
					)}
				</div>
			)}
			<div className="pv-body">
				<div className="pv-main">
					<VisualCanvas
						document={diagram}
						selected={selected}
						select={setSelected}
					/>
					{editing && (
						<section className="pv-editor">
							<label htmlFor="pv-json">Structured diagram JSON</label>
							<textarea
								id="pv-json"
								spellCheck={false}
								value={text}
								disabled={!ready || writeFailed}
								onChange={(event) => edit(event.target.value)}
							/>
							<div>
								<button onClick={preview}>Preview diagram</button>
								<span>128 nodes · 256 edges · 96 KiB · data only</span>
							</div>
						</section>
					)}
				</div>
				<aside className="pv-inspector" aria-label="Visual source inspector">
					<h2>{item?.label || "Select a node or connection"}</h2>
					{node && (
						<>
							<span
								className="pv-kind"
								style={{ color: nodeColors[node.kind] }}
							>
								{node.kind}
							</span>
							{node.description && <p>{node.description}</p>}
							{diagram.kind === "timeline" && (
								<dl>
									<dt>Start</dt>
									<dd>
										{node.start} {diagram.timeUnit ?? "units"}
									</dd>
									<dt>End</dt>
									<dd>
										{node.end} {diagram.timeUnit ?? "units"}
									</dd>
								</dl>
							)}
						</>
					)}
					{edge && (
						<p>
							{diagram.nodes.find((value) => value.id === edge.from)?.label} →{" "}
							{diagram.nodes.find((value) => value.id === edge.to)?.label}
						</p>
					)}
					<h3>Sources</h3>
					{sourceIds.length ? (
						sourceIds.map((sourceId) => {
							const source = diagram.sources.find(
								(value) => value.id === sourceId,
							)!;
							return (
								<details
									key={source.id}
									open={diagram.provenance === "example"}
								>
									<summary>{source.title}</summary>
									{source.locator && <code>{source.locator}</code>}
									{source.excerpt && <p>{source.excerpt}</p>}
								</details>
							);
						})
					) : (
						<p className="pv-muted">
							No supporting source was supplied for this selection.
						</p>
					)}
					<details>
						<summary>Accessible document list</summary>
						<ul>
							{diagram.nodes.map((value) => (
								<li key={value.id}>
									<button
										onClick={() => setSelected("node:" + value.id)}
										aria-pressed={selected === "node:" + value.id}
									>
										{value.label}
									</button>
								</li>
							))}
						</ul>
						<ul>
							{diagram.edges.map((value) => (
								<li key={value.id}>
									<button onClick={() => setSelected("edge:" + value.id)}>
										{
											diagram.nodes.find((node) => node.id === value.from)
												?.label
										}{" "}
										→{" "}
										{diagram.nodes.find((node) => node.id === value.to)?.label}
									</button>
								</li>
							))}
						</ul>
					</details>
				</aside>
			</div>
			{exportText !== undefined && (
				<div className="pv-dialog-backdrop">
					<section
						role="dialog"
						aria-modal="true"
						aria-labelledby="pv-export-title"
						aria-describedby="pv-export-instructions"
						className="pv-dialog"
						style={{ width: "100%", maxWidth: 640 }}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								event.stopPropagation();
								closeExport();
							} else if (event.key === "Tab") {
								const controls =
										event.currentTarget.querySelectorAll<HTMLElement>(
											"textarea,button",
										),
									first = controls[0],
									last = controls[controls.length - 1];
								if (event.shiftKey && document.activeElement === first) {
									event.preventDefault();
									last?.focus();
								} else if (!event.shiftKey && document.activeElement === last) {
									event.preventDefault();
									first?.focus();
								}
							}
						}}
					>
						<h2 id="pv-export-title">Export JSON</h2>
						<p id="pv-export-instructions">
							This is your current draft. Select all, copy it, then save the
							text as a .json file. No download or clipboard permission is
							needed.
						</p>
						<label htmlFor="pv-export-json">JSON to copy</label>
						<textarea
							ref={exportInput}
							id="pv-export-json"
							readOnly
							value={exportText}
							spellCheck={false}
							rows={12}
							style={{
								display: "block",
								width: "100%",
								maxHeight: "45vh",
								marginTop: 7,
								padding: 10,
								resize: "vertical",
								border: "1px solid var(--border,#393939)",
								borderRadius: 7,
								background: "var(--canvas,#000)",
								fontFamily: "ui-monospace,monospace",
								fontSize: 11,
							}}
						/>
						<button
							onClick={() => {
								exportInput.current?.focus();
								exportInput.current?.select();
							}}
						>
							Select all
						</button>
						<button onClick={closeExport}>Close export</button>
					</section>
				</div>
			)}
			{pendingReplace && (
				<div className="pv-dialog-backdrop">
					<section
						role="dialog"
						aria-modal="true"
						aria-labelledby="pv-replace-title"
						className="pv-dialog"
					>
						<h2 id="pv-replace-title">Replace the current draft?</h2>
						<p>
							The committed document stays unchanged until you save. Export the
							current draft first if you want another copy.
						</p>
						<button onClick={() => setPendingReplace(undefined)}>
							Keep editing
						</button>
						<button onClick={() => stage(pendingReplace)}>Replace draft</button>
					</section>
				</div>
			)}
		</main>
	);
}
host.ReactDOMClient.createRoot(document.getElementById("root")!).render(
	<App />,
);
