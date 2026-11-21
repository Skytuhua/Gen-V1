# Clickable file references in replies

## META

| Field | Value |
| --- | --- |
| Feature | Clickable file references in replies |
| Repository | [skytuhua-org/Gen-V1](https://github.com/skytuhua-org/Gen-V1) |
| Revision | r1 · 2026-11-21 |
| Baseline | [main at `4ca1134ae1e4f354064457cb5664b545712da4a9`](https://github.com/skytuhua-org/Gen-V1/tree/4ca1134ae1e4f354064457cb5664b545712da4a9) (verified by checkout on 2026-11-21) |
| Size | Medium (labels `feature`, `medium`) |
| Related work | Separate, not dependencies: [Copy a project-relative file reference #1471](https://github.com/skytuhua-org/Gen-V1/issues/1471) (clipboard copy from the Files preview; produces the same `path:line` text this feature consumes), [@-mention project files in the composer #1242](https://github.com/skytuhua-org/Gen-V1/issues/1242) (composer input, not replies), [Edit files by hand in the Files pane #1344](https://github.com/skytuhua-org/Gen-V1/issues/1344) (may change the Files preview; see Risks). No issue or PR for clickable file references in replies was found (searched open and closed issues for "file reference" and "clickable path" on 2026-11-21). |
| Status | Plan only. Source inspected at the baseline; nothing implemented or verified. |
| Provenance | Feature research batch 7, item 3, filed directly as a plan (no approval step). External demand: [Codex bug #22585](https://github.com/openai/codex/issues/22585) ("File paths render blue but are not clickable links", open) and [Claude Code bug #69645](https://github.com/anthropics/claude-code/issues/69645) ("File paths in chat panel responses not ctrl+clickable (plain text and backtick format)", open). |
| Design ownership | There is no separate front end design team for this feature. This plan specifies the visual design and animation itself (DESIGN §D7). The final task (T08) sends the finished work to the front end team for review. |

## OBJECTIVE

**Problem.** Agents mention files all the time in replies (`apps/web/src/Markdown.tsx`, `src/app.ts:42`). In Gen these are inert text. To look at the file, the user opens the Files pane, walks the folder tree by hand and scrolls to the line. Users of Codex and Claude Code have filed bugs asking for exactly this click-through (sources above).

**Intended behavior.** In an assistant reply in a conversation that has a connected project, a project-relative file path, written either as an inline code span (`` `src/app.ts` ``) or as plain prose text (`see src/app.ts:42`), becomes a link once Gen has confirmed that the file exists inside that project. Clicking it opens the Files pane on that file and, when the reference has a line, scrolls to and highlights that line. Text that is not a confirmed project file stays exactly as it renders today.

**Measurable success.**
1. A reply containing `` `src/app.ts:42` `` for an existing file renders a link; one click shows `src/app.ts` in the Files preview with line 42 highlighted and centered (browser test, T07).
2. References to absolute paths, `..` paths, `.git` paths, or files that do not exist render byte-identical to today (browser test, T07).
3. No network request is made for a reference that never scrolls near the viewport, and at most one folder listing request is made per distinct folder per conversation within 30 seconds (unit test, T03).
4. No change to how any Markdown outside assistant replies renders (unit and existing e2e markdown tests pass, T02/T07).

## REQUIREMENTS

### In scope (agreed decisions)

| ID | Requirement |
| --- | --- |
| R1 | **Where.** Assistant messages in a main conversation transcript only: the main thread view (`App.tsx` message rows rendered through `AssistantProse`) and conversation panels in the split canvas (`CanvasThread` in `App.tsx`). The conversation must have a `projectId`. Nowhere else: not user messages, Work activity updates, side conversations, delegated agent transcripts, documents, planning questions, decision prompts, artifacts, or the agents workspace. |
| R2 | **What is detected.** (a) An inline code span whose entire content is a reference; (b) a reference in plain inline text. Fenced code blocks, link text and link targets are never scanned. |
| R3 | **Reference grammar.** `PATH` optionally followed by `:LINE` or `:LINE:COLUMN` (decimal, 1-based, no leading `0`, LINE ≤ 9,999,999). PATH is one or more `/`-separated segments; a single leading `./` is accepted and dropped. Code-span form accepts a single segment that contains a `.` (`package.json`, `README.md`) or any multi-segment path. Plain-text form requires at least one `/` **and** a last segment with an extension (`[^/.]+\.[A-Za-z0-9]{1,12}` at the end, or a dotfile like `.eslintrc.json`) to avoid matching prose such as `and/or` or `client/server`. Plain-text matches drop trailing `.`, `,`, `;`, `:`, `!`, `?`, `)`, `]`, `'`, `"` and may be preceded only by start of text, whitespace, `(`, `[`, `'`, `"`. |
| R4 | **Rejected paths (stay plain text).** Leading `/` or `~`; Windows drive or UNC (`C:\`, `C:/`, `\\`); any backslash; any empty, `.` or `..` segment after the leading `./`; any segment equal to `.git` (case-insensitive); ASCII control characters, DEL, U+2028, U+2029; whitespace inside the path; `://` anywhere; more than 1024 UTF-8 bytes. These mirror the server's own guards (`pathName` and `gitSegment` in `packages/workspace/tools.ts`) so the client never asks for something the server will refuse. |
| R5 | **Verification before linking.** A candidate becomes a link only after the existing authorized folder listing (`GET /api/projects/:projectId/files?threadId=…&path=<parent folder>`) for the conversation's project returns an entry with that exact `name` and `kind: "file"`. Directories, missing files, denied folders, failed requests, and folders whose listing hits the 500-entry cap without the name all leave the text unchanged. No new server endpoint. |
| R6 | **Cost bounds.** Verification starts only when the reference is within 200px of the viewport and only after the message has finished streaming. One listing per distinct (project, thread, folder) is shared by all references in all messages of that conversation and cached for 30 seconds; at most 4 listings in flight per conversation; at most 64 distinct candidates are considered per message (the rest stay plain). |
| R7 | **Opening.** Plain click, Enter or Space on a link opens the Files pane for the conversation's project, navigates its folder list to the file's parent folder, selects the file, opens the preview (the same state as choosing it in the list and pressing into the preview), and, when a line is given, highlights and centers that line. Ctrl/Cmd/middle click behave the same as a plain click (no new window). The link never navigates the page and never calls the desktop "open external" path. |
| R8 | **Line handling.** A line past the end of the file shows the whole file with the status "Line N is past the end of this file." and no highlight. Binary and empty files show their existing preview messages and ignore the line. The column is kept in the visible text and the accessible name but does not move a caret (the preview is read-only `<pre>`). |
| R9 | **No staleness check against the reply.** References carry no digest, so the line is applied to the file's current content. The status line reads "Line N" (not "Matching line"). |
| R10 | **Interplay with existing Files state.** A new reference click replaces the current Files selection, clears any selected Project Search match and the folder filter, and does not touch other panels. Choosing another file, folder or search result afterwards clears the reference line. |
| R11 | **Accessibility.** Links are `<button type="button">` elements styled as inline links (see D7), not `<a>`, because they navigate inside the app rather than to a URL; keyboard users get Enter/Space and screen readers announce "button". Accessible name: `Open <path> in Files` or `Open <path> at line <N> in Files`. Visible text is unchanged from the reply. Focus stays on the link after activation unless the Files preview takes focus through its existing `openPreview` focus request (that existing behavior wins). Visible focus ring uses the existing focus style. |
| R12 | **Privacy and security.** Only the conversation's own project is queried, through the existing authenticated route with its server-side worktree and `.git` guards. Nothing is sent to a model, logged, persisted or added to telemetry. No absolute path is ever displayed or requested. |
| R13 | **Visual design and motion.** As specified in D7, including reduced-motion behavior. No layout shift when a reference becomes a link. |
| R14 | **Error recovery.** If the file is deleted between verification and click, the Files preview shows its existing read error with its existing Retry; the reply link stays (it will drop back to plain text after the next cache expiry and re-verification when the message re-renders). |

### Out of scope

Absolute or home-relative paths; paths outside the conversation's project; references in user messages or any surface not in R1; terminal output links (batch 7 item 2 covers URLs only); `#L42`, `(42,7)`, `line 42` or other line syntaxes; opening files in an external editor or the OS; editing files; ranges (`:10-20`); folder links; hover previews or tooltips with file content; a setting to turn the feature off; new server routes, contracts, capability flags or dependencies; changes to Project Search itself (it is not wired with a production adapter at the baseline; see REPO_MAP).

### Proposed options not taken

- *Verify with `GET /file`:* rejected; it reads up to 1 MiB per reference. The folder listing is cheaper and shared by sibling references.
- *Link every candidate and verify on click:* rejected; batch scope requires "link only when the path resolves inside the thread's project", and false links are the exact complaint in Codex #22585.
- *Add a batched existence endpoint:* rejected for v1 (new server surface). Revisit if T03 measurements show listing cost is a problem.

### User flows

1. Agent replies "The guard lives in `packages/workspace/tools.ts:28`." → after the reply finishes, the code span gains the link style → user clicks → right panel opens on Files (or switches to the Files tab), folder `packages/workspace` is listed, `tools.ts` preview is open with line 28 highlighted and centered.
2. Agent writes "Edit src/missing.ts next." where the file does not exist → text renders as today, no link.
3. Conversation without a project → no detection, no requests, identical rendering.
4. User is in the split canvas with a conversation panel → click opens (or reuses) a Files panel bound to the same conversation and project in the canvas and reveals the file there.

## REPO_MAP

Verified at the baseline unless marked **Discovery**.

| Location | What is there | Use in this plan |
| --- | --- | --- |
| `apps/web/src/Markdown.tsx` | `inline(text)` splits on `**bold**`, `` `code` `` and `[text](http(s)…|#…)` links; renders `<code>` for code spans and `<a target="_blank">` for links. `blocks(text)` handles fences, headings, tables, lists, paragraphs and calls `inline` for prose. `Markdown({text, animate, initialReveal})` memoizes `blocks(text)` and wraps in `SentenceReveal`. | T02 adds reference detection inside `inline` and passes a flag through `blocks`. |
| `apps/web/src/markdown.css`, `apps/web/src/styles.css:115` | Markdown block styles; `.markdown code { background:var(--subtle); padding:2px 4px; border-radius:4px; }`. No `.markdown a` rule exists. | T02 adds `.markdown-file-ref` styles in `markdown.css`. |
| `apps/web/src/App.tsx:146` (`AssistantProse`) and `:1178` | Main thread rows render assistant messages as `<SourceMessage><AssistantProse …/></SourceMessage>`; `AssistantProse` returns `<Markdown text animate={active||initial} initialReveal>`. | T05 wraps the transcript in the reference provider. |
| `apps/web/src/App.tsx:463-478` (`CanvasThread`) | Canvas conversation transcripts render assistant messages as `<SourceMessage><Markdown text/></SourceMessage>`; has `thread.projectId`, `browseProject(id)` callback that calls `addCanvasPanel('files', {...binding, resourceId:id, liveProject:false})` (App.tsx:914). | T06 provides the provider and canvas open path. |
| `apps/web/src/App.tsx:1065` (`revealWorkspaceTool`) | Opens the right panel on a tab (`setLayout(... activeTab: kind ...)`); delegates to `onRequestWorkspaceTool` when the App is hosted by another surface. | T05 calls it with `'files'`. |
| `apps/web/src/App.tsx:889-917` (`reviewRequest`, `handleReviewRequest`, `openSidebarTool`) | Existing pattern for "open a panel and make it select something": an id-stamped request in App state, passed down, cleared by the receiving panel via `onReviewHandled(id)`. | T04/T05 copy this pattern for `FileRevealRequest`. |
| `apps/web/src/WorkspacePanel.tsx:29,81` | Right panel; renders `WorkspaceSurfaceBody` with `reviewRequest`/`onReviewHandled` pass-through. | T05 adds the file reveal pass-through. |
| `apps/web/src/WorkspaceSurfaceBody.tsx:35-38,53-71` | `ReviewRequest` type; `FilesBody` mounts `<ProjectFiles key={owner} base query active fallback/>` (no `searchAdapter` passed); `kind==='files'` routes there when the binding has a `projectId`, else `GrantedFiles`. | T04 adds `fileReveal` props to `WorkspaceSurfaceBody` → `FilesBody` → `ProjectFiles`. |
| `apps/web/src/files/ProjectFiles.tsx` | Owns `path`, `selected`, `selectedMatch`; reads `GET {base}/files?{query}&path=` and `GET {base}/file?{query}&path=` (returns `{text, binary, sha256}`); computes `line` from a non-stale text `selectedMatch`, splits `file.text` on line breaks, renders `<mark className="files-matching-line" ref={matchLine}>` and scrolls it into view (`block:"center"`), shows "Matching line N" / "The matching line is no longer available…". | T04 generalizes the line source to include a reveal line. |
| `apps/web/src/files/FilesView.tsx` | Presentational Files surface; internal `openPreview()` collapses the tree and focuses the preview; internal `filter` state. No prop to trigger `openPreview` from outside. | T04 adds a `revealVersion` prop that runs `openPreview` and clears the filter. |
| `apps/web/src/files/ProjectSearch.tsx`, `project-search-api.ts`, `apps/server/project-search-routes.ts` | Project Search UI, client contract (`relativePath` rules: ≤1024 bytes, no `\`, NUL, `:`) and server route. At the baseline no production code passes a `searchAdapter`, so `ProjectFiles` uses `unavailableProjectSearch`. | Not changed. The reveal reuses ProjectFiles' line highlight and scroll code, not the search service. |
| `apps/server/workspace-routes.ts:71-72` | `GET /api/projects/:projectId/files` and `/file`, query `{threadId, path}`. | Used as is. |
| `packages/workspace/tools.ts:26-28,200-204` | `pathName` schema (≤1024 chars, no NUL, no `:`, no leading slash, no `..`), `gitSegment`; `files()` lists ≤500 entries, skips `.git`, symlinks and the guard file, returns `{name, path, kind: 'directory'|'file'}`; `file()` reads ≤1 MiB inside the worktree. | Client rules R4 mirror these; R5 relies on `files()`. |
| `apps/web/src/api.ts` (`authenticated`, `read`) | Authenticated fetch helpers used by ProjectFiles. | T03 uses the same helpers. |
| `tests/e2e/markdown.spec.ts`, `tests/e2e/task-interface-fixture` | Browser tests rendering Markdown through a task fixture. | T07 regression run. |
| `tests/e2e/files-reading.spec.ts` + `files-reading.playwright.config.ts` + `files-reading-fixture.tsx` | Browser tests for Project Files with routed `/files` and `/file` responses. | T07 adds reveal tests here. |
| `package.json` scripts | `typecheck`, `lint` (`scripts/lint-ui.ts --check`), `test:ui-guard`, `test` (vitest), `test:browser`, `test:e2e`. | VALIDATION. |
| **Discovery** | How `scripts/test-browser.ts` selects Playwright configs; whether a fixture can mount a full `App` thread view with a project for the end-to-end click test. | T07 step 1. |
| **Discovery** | Whether `addCanvasPanel` can find and reuse an existing canvas Files panel for the same binding. | T06 step 1. |

## DESIGN

### D1 Architecture

```
assistant reply text
  └─ Markdown (fileRefs enabled by context, !animate)
       └─ inline(): split → candidates → <FileReference ref raw> (or plain node)
            └─ useFileReferenceStatus(ref)  ── visible? ──► FileReferenceVerifier (per conversation)
                                                             └─ GET /api/projects/:p/files?threadId&path=<dir>  (cached 30 s, ≤4 in flight)
            └─ verified → <button class="markdown-file-ref"> … onClick → context.open({path,line})
                                                   │
               main view: App.setFileReveal({id,projectId,threadId,path,line}); revealWorkspaceTool('files')
               canvas:    App.addOrFocusCanvasFiles(binding); setFileReveal({..., panelId})
                                                   ▼
               WorkspacePanel / canvasBody → WorkspaceSurfaceBody → FilesBody → ProjectFiles(fileReveal)
                    → path=dir, selected=file, revealLine=line, FilesView.revealVersion++ → onFileRevealHandled(id)
```

### D2 Reference parser (pure, new file `apps/web/src/file-references.ts`)

```ts
export interface FileReference { path: string; line: number | null; column: number | null; }
// Whole-string parse for code-span content. Returns null when not a reference.
export function parseCodeSpanReference(text: string): FileReference | null;
// Find plain-text references; returns non-overlapping ranges in the original string.
export function findTextReferences(text: string, limit?: number): Array<{ start: number; end: number; ref: FileReference }>;
export function referenceFolder(path: string): string; // '' for root files
export function referenceName(path: string): string;
```

Rules are R3/R4 exactly. Implementation notes:
- Validate the path with a single function `validReferencePath(path)` used by both entry points.
- Byte length via `new TextEncoder().encode(path).length`.
- `findTextReferences` scans with a global regex for the R3 plain form, then validates each match; it must run in linear time (no nested quantifiers over the same characters) and stops after `limit` (default 64) accepted matches.
- Examples that must parse: `src/app.ts` → `{src/app.ts,null,null}`; `src/app.ts:42` → line 42; `./src/app.ts:42:7` → path `src/app.ts`, line 42, column 7; code span `package.json` → path `package.json`; plain `(see docs/a.md).` → `docs/a.md`.
- Examples that must not parse: `/etc/hosts`, `~/x.ts`, `C:\a\b.ts`, `C:/a/b.ts`, `a\b.ts`, `../x.ts`, `src/../x.ts`, `.git/config`, `src/.GIT/x`, `a//b.ts`, `src/app.ts:0`, `src/app.ts:042`, `https://x.dev/a.ts`, plain `and/or`, plain `client/server`, plain `app.ts` (no slash), code span `README` (no dot, one segment), a path with a space.

### D3 Markdown integration

- `blocks(text, fileRefs: boolean)` threads the flag to every `inline(text, fileRefs)` call (paragraphs, headings, list items, table header and body cells). Fence branch unchanged.
- In `inline`, after the existing split: a code-span part whose content passes `parseCodeSpanReference` renders `<FileReference ref raw={content} code />`; a plain part is split by `findTextReferences` into text fragments and `<FileReference ref raw={slice} />`. Bold and link parts are not scanned (bold inner text stays plain to keep v1 small).
- `Markdown` reads `useContext(FileReferenceContext)`; `fileRefs = Boolean(context) && !animate`. The `useMemo` dependency list becomes `[text, fileRefs]`. With no provider (every surface outside R1) output is identical to today.
- Per-message candidate cap: `inline` receives a shared counter object from `blocks` and stops creating `FileReference` nodes after 64.

### D4 Verification (new file `apps/web/src/file-reference-verifier.ts`)

```ts
export interface FileReferenceOwner { projectId: string; threadId: string; }
export interface FileReferenceVerifier {
  status(path: string): 'unknown' | 'file' | 'absent';
  request(path: string): void;           // idempotent; schedules a folder listing if needed
  subscribe(listener: () => void): () => void;
  dispose(): void;                       // aborts in-flight requests
}
export function createFileReferenceVerifier(owner: FileReferenceOwner, options?: { ttlMs?: number; concurrency?: number; fetchFolder?: (folder: string, signal: AbortSignal) => Promise<{ entries: { name: string; kind: string }[] }> }): FileReferenceVerifier;
```

- Default `fetchFolder` = `authenticated(() => fetch('/api/projects/' + encodeURIComponent(projectId) + '/files?' + new URLSearchParams({threadId, ...(folder ? {path: folder} : {})}), {credentials:'same-origin', cache:'no-store', signal})).then(read)` — same shape as `ProjectFiles.readFolder`.
- Cache: `Map<folder, {at:number; files:Set<string>} | {at:number; failed:true} | Promise>`; TTL 30 000 ms (both success and failure); ≤4 concurrent; FIFO queue. Any error (including `PROJECT_NOT_CONNECTED`, `CAPABILITY_DENIED`) → every name in that folder is `absent`.
- `useFileReferenceStatus(ref, element)`: uses an `IntersectionObserver` (`rootMargin: '200px'`) on the rendered span; calls `request` on first intersection; re-renders via `useSyncExternalStore(subscribe, () => status(path))`.
- One verifier per provider (per conversation owner); provider disposes it on owner change or unmount.

### D5 Reveal request

```ts
// WorkspaceSurfaceBody.tsx, next to ReviewRequest
export type FileRevealRequest = { id: number; projectId: string; threadId: string; path: string; line: number | null; panelId?: string };
```

- App state: `const [fileReveal, setFileReveal] = useState<FileRevealRequest>()`, `handleFileReveal = useCallback((id) => setFileReveal(c => c?.id === id ? undefined : c), [])`, id from a ref counter.
- `WorkspacePanel` and `canvasBody` pass `fileReveal`/`onFileRevealHandled` to `WorkspaceSurfaceBody`, which passes them to `FilesBody` only when `kind==='files'` and the request's `projectId` and `threadId` equal the binding's (and, in the canvas, `panelId` matches).
- `ProjectFiles` adds props `reveal?: FileRevealRequest; onRevealHandled?: (id:number)=>void` and state `revealLine: {path:string; line:number} | null`. Effect when `active && reveal`: `setSelectedMatch(null)`; `setPath(referenceFolder(reveal.path))`; `setSelected({name: referenceName(reveal.path), path: reveal.path, kind:'file'})` (or `preview.refresh()` if already selected); `setRevealLine(reveal.line ? {path: reveal.path, line: reveal.line} : null)`; bump `revealVersion`; `onRevealHandled(reveal.id)`.
- Line source: `line = (selectedMatch text line, non-stale) ?? (revealLine && revealLine.path === selected?.path ? revealLine.line : undefined)`. Label: "Matching line N" for search, "Line N" for reveal. Past-end message for reveal: "Line N is past the end of this file." Existing `onSelect`, `onDirectory` and search `onSelect` handlers also `setRevealLine(null)`.
- `FilesView` adds prop `revealVersion?: number`; a `useEffect` on change (skipping the initial value) runs `setFilter('')` and `openPreview()`.
- Because `ProjectFiles` is keyed by `base + "?" + query`, a request for a different project/thread remounts it; the effect runs on mount when `reveal` is present.

### D6 Opening from each surface

- **Main view** (`App` thread rows): provider `open = ({path,line}) => { setFileReveal({id: next(), projectId, threadId, path, line}); revealWorkspaceTool('files'); }`. When `onRequestWorkspaceTool` is set (App hosted by another surface) the provider is not mounted, so no links render there (no half-working path).
- **Canvas** (`CanvasThread`): provider `open` calls a new App callback `revealCanvasFile(binding, ref)` that finds an existing canvas panel with `kind==='files'` and the same `threadId`/`projectId` (discovery T06 step 1); if none, `addCanvasPanel('files', {...binding, liveProject:false})` and uses the returned/created panel id; then `setFileReveal({..., panelId})` and focuses that panel.
- Read-only delegated canvas transcripts (`readOnly`) and side threads (`threadParent(thread)`) do not get a provider (R1).

### D7 Visual design and animation

- **Link (code-span form):** the `<button class="markdown-file-ref markdown-file-ref-code">` contains the original `<code>`; the button itself has `all: unset`-style reset (`background:none; border:0; padding:0; font:inherit; color:inherit; cursor:pointer`), so the code chip keeps its `--subtle` background, padding and radius. The code text color becomes `var(--accent-text)`; a 1px underline sits under the code chip using `text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent-text) 35%, transparent); text-underline-offset: 3px`.
- **Link (plain form):** inline button with the same reset, `color: var(--accent-text)`, same underline treatment, `overflow-wrap:anywhere` so long paths wrap like surrounding prose.
- **Hover/focus:** underline color goes to 100% `var(--accent-text)` and the code chip background to `var(--accent-soft)`, transitioning `color, background-color, text-decoration-color` over `var(--ui-motion-hover)` with `var(--ui-ease-move)`. `:focus-visible` uses the app's existing focus outline (`outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px`). `:active` applies `transform: translateY(0.5px)` over `var(--ui-motion-press)`.
- **Becoming a link:** no fade, no layout shift: the button renders inline with identical box metrics to the plain node (same font, padding only from the inner `<code>`), only color/underline change, applied instantly to avoid shimmer while scrolling.
- **Arrival in Files:** after the reveal scroll, the highlighted line (existing `.files-matching-line` with `--selection-bg/--selection-ink/--selection-border`) plays a single "locate" pulse: class `files-reveal-pulse` animates `box-shadow` from `0 0 0 3px var(--accent-soft)` to `0 0 0 0 transparent` over 700ms `var(--ui-ease-enter)`, once, then the class is removed on `animationend`. The scroll uses `behavior:"instant"` (unchanged) so the pulse is what draws the eye.
- **Reduced motion:** inside `@media (prefers-reduced-motion: reduce)` and when the app's motion preference is off (follow the existing pattern in `markdown.css` and `appearance.css`; discovery: the app-level "motion off" class name in `appearance.css`), transitions are `none`, no press transform, and the pulse is replaced by the static highlight only.
- **Themes:** only theme tokens are used, so light and dark themes follow automatically; verify contrast of `--accent-text` on `--subtle` ≥ 4.5:1 in both themes during T08 (screenshots).

### D8 Security boundaries and rollback

- The client never builds a path outside the project: R4 validation before any request, and the server re-validates (`pathName`, `realpath` + `inside`, `gitSegment`).
- No new persistence or schema; rollback is a revert of the PR. The feature is inert without a provider, so partial merges (T02/T03 without T05) change nothing visible.

## EXECUTION_DAG

Ownership boundaries: T01 owns `file-references.ts` + its unit test; T03 owns `file-reference-verifier.ts` + its unit test; T02 owns `Markdown.tsx`, `markdown.css`, new `FileReference.tsx`; T04 owns `files/*` and the `WorkspaceSurfaceBody` files plumbing; T05/T06 own `App.tsx` and `WorkspacePanel.tsx`; T07 owns tests; T08 is review. T01 and T03 and T04 can run in parallel.

### T01 Reference parser
- **Goal:** pure parser per D2.
- **Depends on:** none.
- **Edits:** create `apps/web/src/file-references.ts`; create `tests/file-references.test.ts` (vitest).
- **Tests:** every must-parse and must-not-parse example in D2; trailing punctuation stripping; 64-match limit; a 100 KB string of `a/` repeated parses in < 50 ms (linear-time guard).
- **Done when:** `pnpm vitest run tests/file-references.test.ts` passes; `pnpm typecheck` passes.
- **Handoff:** T02.

### T02 Markdown rendering and link styles
- **Goal:** detection in `inline`, `FileReference` component, `FileReferenceContext`, styles per D3/D7.
- **Depends on:** T01 (parser), T03 (hook) — may stub the hook with a status prop until T03 lands.
- **Edits:** `apps/web/src/Markdown.tsx` (flag through `blocks`/`inline`, context read, memo deps); new `apps/web/src/FileReference.tsx` exporting `FileReferenceContext` (`{owner: FileReferenceOwner; verifier: FileReferenceVerifier; open(ref: FileReference): void} | null`), `FileReferenceProvider`, and `FileReference`; `apps/web/src/markdown.css` (D7 rules).
- **Tests:** new `tests/file-reference-render.test.tsx` (vitest + the repo's existing React test setup; discovery: copy the render helper used by an existing `*.test.tsx` under `tests/`): without provider, output HTML equals the baseline for a sample containing references; with provider and a fake verifier returning `file`, a code span and a plain reference render buttons with the R11 accessible names and unchanged text; `absent`/`unknown` render the baseline nodes; fenced code and link text are untouched; `animate=true` renders no buttons. Run `pnpm lint` and `pnpm test:ui-guard`.
- **Done when:** tests above pass; existing `tests/e2e/markdown.spec.ts` still passes.
- **Handoff:** T05.

### T03 Folder-listing verifier
- **Goal:** D4 verifier and `useFileReferenceStatus` hook.
- **Depends on:** none.
- **Edits:** create `apps/web/src/file-reference-verifier.ts` (and export the hook from it or from `FileReference.tsx`); create `tests/file-reference-verifier.test.ts`.
- **Tests (fake `fetchFolder`, fake timers):** two paths in one folder → one fetch; file vs directory entry with same name → `absent` for directory; fetch rejects → `absent`, re-fetch only after 30 s; ≤4 concurrent fetches with 10 folders; `dispose` aborts pending signals; root-level file uses no `path` param.
- **Done when:** tests pass; `pnpm typecheck` passes.
- **Handoff:** T02.

### T04 Files reveal plumbing
- **Goal:** `FileRevealRequest`, ProjectFiles reveal state, FilesView `revealVersion`, reveal pulse (D5, D7 arrival).
- **Depends on:** none (T01 only for `referenceFolder`/`referenceName`; may inline equivalents and switch later).
- **Edits:** `apps/web/src/WorkspaceSurfaceBody.tsx` (type, props on `WorkspaceSurfaceBody` and `FilesBody`, owner matching), `apps/web/src/files/ProjectFiles.tsx`, `apps/web/src/files/FilesView.tsx`, `apps/web/src/files/files.css` (`.files-reveal-pulse`, reduced motion).
- **Tests:** extend `tests/e2e/files-reading.spec.ts` with a fixture prop to pass `reveal` into `ProjectFiles` (extend `files-reading-fixture.tsx`): (a) reveal `src/a.ts` line 3 → folder `src` listed, preview open, `mark.files-matching-line` has line 3 text, status "Line 3"; (b) line 99 on a 5-line file → "Line 99 is past the end of this file.", no mark; (c) binary file ignores the line; (d) selecting another file clears the line; (e) a second reveal for the same file with a new line re-reads and moves the highlight; (f) `onRevealHandled` called once per id.
- **Done when:** those tests pass with the files-reading config; existing files-reading and project-search specs still pass.
- **Handoff:** T05, T06.

### T05 Main view wiring
- **Goal:** provider around main thread assistant rows and App-level reveal state (D5, D6 main).
- **Depends on:** T02, T03, T04.
- **Edits:** `apps/web/src/App.tsx` (state, handler, provider wrapping the transcript rows rendered at line ~1178 when `thread.projectId` exists and `onRequestWorkspaceTool` is undefined), `apps/web/src/WorkspacePanel.tsx` (pass-through props).
- **Tests:** covered by T07 end-to-end; plus `pnpm typecheck`, `pnpm lint`.
- **Done when:** manual run (`pnpm dev`, see VALIDATION) shows flow 1 working.
- **Handoff:** T07.

### T06 Canvas wiring
- **Goal:** provider in `CanvasThread` for non-read-only main conversations, and `revealCanvasFile` (D6 canvas).
- **Depends on:** T04, T05.
- **Steps:** (1) Discovery: read `addCanvasPanel`, the canvas panel list and `resolvePanelBinding` in `App.tsx`; record whether an existing Files panel for the binding can be found and focused; if `addCanvasPanel` does not return the new panel id, find it after creation by kind + binding. (2) Implement per D6. (3) Pass `fileReveal` through `canvasBody` to `WorkspaceSurfaceBody` with `panelId`.
- **Tests:** T07 canvas case.
- **Done when:** flow 4 works manually; existing canvas/split workspace tests pass (`tests/split-workspace-profiles.test.ts` and related e2e).
- **Handoff:** T07.

### T07 End-to-end and regression tests
- **Goal:** prove R1–R14 in a browser.
- **Depends on:** T05, T06.
- **Steps:** (1) Discovery: how `scripts/test-browser.ts` picks configs; find or build a fixture that renders the main thread view with a project-bound thread and routed `/api/projects/:id/files` + `/file` (start from `tests/e2e/task-interface-fixture` and `files-reading-fixture.tsx`). (2) Add `tests/e2e/file-references.spec.ts` (+ config entry if the runner needs one).
- **Cases:** flow 1 (code span with line → Files preview, highlight, focus/announcement); plain-text reference; missing file stays plain (assert no button, text unchanged); `/etc/hosts`, `../x.ts`, `.git/config` never trigger a request (assert route not hit); reference in a user message stays plain; conversation without project → no requests; offscreen reference not requested until scrolled near; 3 references in one folder → one `/files` request; reduced motion (`page.emulateMedia({reducedMotion:'reduce'})`) → no `files-reveal-pulse` animation; keyboard: Tab to link, Enter opens; canvas flow 4.
- **Done when:** new spec passes; `tests/e2e/markdown.spec.ts`, `files-reading.spec.ts`, `project-search.spec.ts` pass; `pnpm test` passes.
- **Handoff:** T08.

### T08 Front end team review
- **Goal:** hand the finished work to the front end team for review.
- **Depends on:** T07.
- **Steps:** capture light and dark screenshots of (a) a reply with plain and code-span references at rest, hover and focus, (b) the Files preview right after a reveal, and a short screen recording of the click-through with motion on and with reduced motion. Post them in the implementation PR and on this issue, then request review from the front end team on the PR, listing D7 as the spec to check (colors, underline, hover/press, arrival pulse, reduced motion, contrast ≥ 4.5:1).
- **Done when:** the front end team's review is requested on the PR with the evidence attached and any requested visual changes are applied.
- **Handoff:** repository reviewers for merge.

## VALIDATION

**Setup.** `pnpm install`; `pnpm dev` for manual checks with a connected project (see CONTRIBUTING.md for the local workflow).

**Commands (planned, none executed for this plan).**

| Level | Command | Expected |
| --- | --- | --- |
| Types | `pnpm typecheck` | 0 errors |
| UI lint | `pnpm lint`, `pnpm test:ui-guard` | pass |
| Unit | `pnpm vitest run tests/file-references.test.ts tests/file-reference-verifier.test.ts tests/file-reference-render.test.tsx` | pass |
| Unit (all) | `pnpm test` | pass |
| Browser | `pnpm test:e2e` (or the targeted Playwright configs for markdown, files-reading, project-search and the new file-references spec) | pass |
| Real use | Manual: ask the agent in a project conversation "Where is the path guard? Answer with path:line." and click the reference, in the main view and in a canvas conversation panel, light and dark, motion on and reduced | Flows 1–4 behave as written |

**Acceptance matrix.**

| Requirement | Task | Check |
| --- | --- | --- |
| R1 | T02, T05, T06 | T02 no-provider equality; T07 user-message and no-project cases; canvas case |
| R2, R3, R4 | T01, T02 | T01 examples; T07 rejected-path cases (no request) |
| R5 | T03, T02 | T03 file-vs-directory, failure; T07 missing-file case |
| R6 | T03, T02 | T03 dedupe/concurrency/TTL; T07 offscreen and one-request-per-folder cases; T02 `animate` case |
| R7 | T04, T05, T06 | T07 flow 1, keyboard, canvas |
| R8, R9 | T04 | T04 cases a–c |
| R10 | T04 | T04 case d; T07 opens after a prior search/filter |
| R11 | T02, T07 | accessible-name assertions; keyboard case |
| R12 | T03, T05 | requests only to the conversation's project route (route assertions); code review: no logging/persistence |
| R13 | T02, T04, T08 | reduced-motion e2e; front end review screenshots |
| R14 | T04 | existing preview error + Retry when `/file` returns 404 after a link was verified (add to T07) |

**Release gate.** All rows above pass in CI, the front end team review (T08) is approved, and the PR is reviewed and merged through normal Git review.

## STATE

| Item | State |
| --- | --- |
| Research and decisions | Done in this plan (r1) |
| Implementation | NOT_STARTED; no branch or owner |
| Verification | NOT_RUN; no tests executed for this plan |
| Plan file | Committed in a docs-only PR (linked at the top of the issue) |

**Risks.**
- [#1344](https://github.com/skytuhua-org/Gen-V1/issues/1344) may replace the read-only `<pre>` preview with an editor; if it lands first, T04 must apply the reveal line to the editor's scroll/selection API instead of the `<mark>` path and keep R8 messages.
- Folders with more than 500 entries can hide a real file (R5 leaves it plain). Accepted for v1.
- False-positive plain-text matches (for example `config/app.ts` mentioned about another repo) only link when that file really exists in this project, which is the intended behavior.

**Exact next step.** An implementing agent claims this issue per AGENTS.md and starts T01, T03 and T04 in parallel from current main.

## REFERENCES

- [Codex bug #22585: File paths render blue but are not clickable links](https://github.com/openai/codex/issues/22585) — users expect Ctrl+click on file paths in replies.
- [Claude Code bug #69645: File paths in chat panel responses not ctrl+clickable](https://github.com/anthropics/claude-code/issues/69645) — covers both backtick and plain-text paths, which this plan supports.
- [Copy a project-relative file reference #1471](https://github.com/skytuhua-org/Gen-V1/issues/1471) — produces `path` / `path:line` text with the same grammar.
- [@-mention project files in the composer #1242](https://github.com/skytuhua-org/Gen-V1/issues/1242) — composer-side file references; independent.
- [Edit files by hand in the Files pane #1344](https://github.com/skytuhua-org/Gen-V1/issues/1344) — possible interaction with the preview (Risks).
- Baseline source: [Markdown.tsx](https://github.com/skytuhua-org/Gen-V1/blob/4ca1134ae1e4f354064457cb5664b545712da4a9/apps/web/src/Markdown.tsx), [ProjectFiles.tsx](https://github.com/skytuhua-org/Gen-V1/blob/4ca1134ae1e4f354064457cb5664b545712da4a9/apps/web/src/files/ProjectFiles.tsx), [FilesView.tsx](https://github.com/skytuhua-org/Gen-V1/blob/4ca1134ae1e4f354064457cb5664b545712da4a9/apps/web/src/files/FilesView.tsx), [WorkspaceSurfaceBody.tsx](https://github.com/skytuhua-org/Gen-V1/blob/4ca1134ae1e4f354064457cb5664b545712da4a9/apps/web/src/WorkspaceSurfaceBody.tsx), [workspace-routes.ts](https://github.com/skytuhua-org/Gen-V1/blob/4ca1134ae1e4f354064457cb5664b545712da4a9/apps/server/workspace-routes.ts), [tools.ts](https://github.com/skytuhua-org/Gen-V1/blob/4ca1134ae1e4f354064457cb5664b545712da4a9/packages/workspace/tools.ts).
