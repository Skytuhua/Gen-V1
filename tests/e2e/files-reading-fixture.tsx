import { useRef, useState } from "react";
import { FileReferenceProvider, useFileReferenceContext } from "../../apps/web/src/FileReference";
import { Markdown } from "../../apps/web/src/Markdown";
import type { FileRevealRequest } from "../../apps/web/src/files/file-reveal";
import { createRoot } from "react-dom/client";
import type { Snapshot } from "../../packages/contracts";
import { WorkspaceSurfaceBody } from "../../apps/web/src/WorkspaceSurfaceBody";
import { taskFixture } from "./task-interface-fixture";
import "../../apps/web/src/styles.css";

const params = new URLSearchParams(location.search);
const source = taskFixture({
	root: "text",
	elements: {
		text: { type: "Text", props: { text: "Synthetic Files fixture" } },
	},
});
source.artifacts = [];
source.resources = params.has("no-grants")
	? []
	: ([
			{ id: "grant-a", threadId: "task-thread", label: "Alpha grant" },
			{ id: "grant-b", threadId: "task-thread", label: "Beta grant" },
			{ id: "other-grant", threadId: "other-thread", label: "Other owner" },
		] as Snapshot["resources"]);
function Fixture() {
	const [threadId, setThread] = useState("task-thread"),
		[projectId, setProject] = useState("project-one"),
		[active, setActive] = useState(true),
		[preferred, setPreferred] = useState(params.get("preferred") ?? undefined),
		[reveal, setReveal] = useState<FileRevealRequest | null>(null),
		[handled, setHandled] = useState(0);
	const revealId = useRef(0);
	const fileRefContext = useFileReferenceContext(
		params.has("refs") ? { projectId, threadId } : null,
		(ref) =>
			setReveal({
				id: ++revealId.current,
				projectId,
				threadId,
				path: ref.path,
				line: ref.line ?? undefined,
				panelId: params.get("panel") ?? "sidebar",
			}),
	);
	const reply =
		params.get("reply") ??
		"See `src/a.ts:3` and also docs/readme.md plus /etc/hosts for details.";
	const assistantReply = (
		<div data-testid="assistant-reply">
			{fileRefContext ? (
				<FileReferenceProvider value={fileRefContext}>
					<Markdown text={reply} />
				</FileReferenceProvider>
			) : (
				<Markdown text={reply} />
			)}
		</div>
	);
	const snapshot = { ...source, activeThreadId: threadId };
	return (
		<>
			<p>Synthetic production Files renderer · no live resources</p>
			{params.has("tall") ? (
				<div
					data-testid="reply-scroll"
					style={{ height: 180, overflowY: "auto" }}
				>
					<div style={{ height: 900 }} aria-hidden="true" />
					{assistantReply}
				</div>
			) : (
				assistantReply
			)}
			<p data-testid="reveal-handled">handled:{handled}</p>
			<div className="fixture-controls">
				<button
					onClick={() =>
						setThread((value) =>
							value === "task-thread" ? "other-thread" : "task-thread",
						)
					}
				>
					Switch thread
				</button>
				<button
					onClick={() =>
						setProject((value) =>
							value === "project-one" ? "project-two" : "project-one",
						)
					}
				>
					Switch project
				</button>
				<button onClick={() => setActive((value) => !value)}>
					Toggle active
				</button>
				<button onClick={() => setPreferred("grant-b")}>
					Prefer Beta grant
				</button>
			</div>
			<div
				data-testid="files-owner"
				style={{
					width: Number(params.get("width") ?? 920),
					height: 540,
					maxWidth: "100%",
					border: "1px solid var(--border)",
				}}
			>
				<WorkspaceSurfaceBody
					kind="files"
					binding={{
						authority: { kind: "local" },
						threadId,
						...(!params.has("granted") ? { projectId } : {}),
						...(preferred ? { resourceId: preferred } : {}),
					}}
					snapshot={snapshot}
					refresh={async () => {}}
					active={active}
					fileReveal={reveal}
					onFileRevealHandled={() => setHandled((value) => value + 1)}
				/>
				{params.has("two") && (
					<WorkspaceSurfaceBody
						kind="files"
						panelId="files-b"
						binding={{
							authority: { kind: "local" },
							threadId,
							projectId,
						}}
						snapshot={snapshot}
						refresh={async () => {}}
						active={active}
						fileReveal={reveal}
						onFileRevealHandled={() => setHandled((value) => value + 1)}
					/>
				)}
			</div>
		</>
	);
}
document.documentElement.dataset.theme = params.get("theme") ?? "dark";
createRoot(document.getElementById("root")!).render(<Fixture />);
