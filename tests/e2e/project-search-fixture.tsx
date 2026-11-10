import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectFiles } from "../../apps/web/src/files/ProjectFiles";
import { GrantedFiles } from "../../apps/web/src/files/GrantedFiles";
import type {
	ProjectSearchAdapter,
	ProjectSearchPage,
	ProjectSearchRequest,
} from "../../apps/web/src/files/project-search-api";
import { taskFixture } from "./task-interface-fixture";
import type { Snapshot } from "../../packages/contracts";
import "../../apps/web/src/styles.css";

const params = new URLSearchParams(location.search);
const sha = "a".repeat(64);
const limits = { files: 5000, bytes: 104857600, matches: 100, timeoutMs: 2000 };
const matches: ProjectSearchPage["matches"] = [
	{
		path: "src/workspace/workspace-layout.ts",
		kind: "text",
		line: 48,
		column: 7,
		preview: "const workspace = restoreLayout();",
		sha256: sha,
	},
	{
		path: "docs/README.md",
		kind: "text",
		line: 12,
		column: 10,
		preview: "Open the workspace to continue a task.",
		sha256: sha,
	},
	{
		path: "tests/workspace.test.ts",
		kind: "path",
		preview: "expect(workspace.active).toBe(true)",
		sha256: sha,
	},
];
type Pending = {
	request: ProjectSearchRequest;
	signal: AbortSignal;
	resolve: (page: ProjectSearchPage) => void;
	reject: (error: Error) => void;
};
declare global {
	interface Window {
		projectSearchFixture: {
			requests: ProjectSearchRequest[];
			pending: Pending[];
			hold: boolean;
			mode: string;
			release: (index: number, fail?: boolean) => void;
		};
	}
}
function response(request: ProjectSearchRequest): ProjectSearchPage {
	const mode = window.projectSearchFixture.mode;
	const page: ProjectSearchPage = {
		owner: {
			...request.owner,
			workingCopyId: `copy-${request.owner.projectId}`,
			revision: "fixture-r1",
		},
		matches:
			mode === "empty"
				? []
				: mode === "stress"
					? Array.from({ length: 30 }, (_, index) => ({
							...matches[0],
							path: `src/very-long-project-and-folder-name/${"nested-folder/".repeat(5)}${index}-extraordinarily-long-file-name-with-unbroken-content-abcdefghijklmnopqrstuvwxyz0123456789.ts`,
						}))
					: request.cursor
						? [matches[2]]
						: matches,
		nextCursor: null,
		complete: true,
		exclusions: [],
		limits,
		errors: [],
	};
	if (["paged", "partial", "expired", "revision"].includes(mode)) {
		page.matches = request.cursor ? [matches[2]] : matches.slice(0, 2);
		page.nextCursor = request.cursor ? null : "fixture-page-2";
		page.complete = !!request.cursor;
	}
	if (["partial", "stress", "exclusions"].includes(mode)) {
		page.exclusions = [
			{ path: "private", reason: "Access denied" },
			{ reason: "Outside authorized root" },
			{ path: "assets/logo.png", reason: "Binary content excluded" },
		];
		if (mode !== "exclusions") {
			page.complete = false;
			page.errors = [
				{ code: "SCAN_LIMIT", message: "The scan reached its file limit." },
			];
		}
	}
	if (mode === "wrong-owner") page.owner.projectId = "another-project";
	if (mode === "revision" && request.cursor) page.owner.revision = "fixture-r2";
	return page;
}
const controls = (window.projectSearchFixture = {
	requests: [] as ProjectSearchRequest[],
	pending: [] as Pending[],
	hold: params.get("state") === "loading",
	mode: params.get("state") ?? "results",
	release(index: number, fail = false) {
		const pending = controls.pending[index];
		if (fail) pending.reject(new Error("Held search failed."));
		else pending.resolve(response(pending.request));
	},
});
let failed = false;
const adapter: ProjectSearchAdapter = {
	available: true,
	async search(request, signal) {
		controls.requests.push(structuredClone(request));
		if (controls.hold)
			return new Promise((resolve, reject) => {
				controls.pending.push({ request, signal, resolve, reject });
			});
		if (controls.mode === "error" && !failed) {
			failed = true;
			throw new Error("Project search could not be read. Retry to try again.");
		}
		if (controls.mode === "expired" && request.cursor)
			throw new Error("This search cursor expired. Restart the search.");
		return response(request);
	},
};
const source = taskFixture({
	root: "text",
	elements: {
		text: { type: "Text", props: { text: "Synthetic project search" } },
	},
});
source.resources = [
	{ id: "grant-a", threadId: "task-thread", label: "Alpha grant" },
] as Snapshot["resources"];
function Fixture() {
	const [projectId, setProject] = useState("project-one"),
		[threadId, setThread] = useState("task-thread"),
		[active, setActive] = useState(true);
	return (
		<>
			<p>Synthetic production Files renderer · no live resources</p>
			<div className="fixture-controls">
				<button
					onClick={() =>
						setProject((value) =>
							value === "project-one" ? "project-two" : "project-one",
						)
					}
				>
					Switch project
				</button>
				<button
					onClick={() =>
						setThread((value) =>
							value === "task-thread" ? "other-thread" : "task-thread",
						)
					}
				>
					Switch thread
				</button>
				<button onClick={() => setActive((value) => !value)}>
					Toggle active
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
				{params.has("granted") ? (
					<GrantedFiles snapshot={source} threadId={threadId} />
				) : (
					<ProjectFiles
						base={`/api/projects/${projectId}`}
						query={`threadId=${threadId}`}
						active={active}
						fallback={<GrantedFiles snapshot={source} threadId={threadId} />}
						searchAdapter={params.has("unavailable") ? undefined : adapter}
					/>
				)}
			</div>
		</>
	);
}
document.documentElement.dataset.theme = params.get("theme") ?? "dark";
document.documentElement.dataset.motion = params.get("motion") ?? "system";
createRoot(document.getElementById("root")!).render(<Fixture />);
