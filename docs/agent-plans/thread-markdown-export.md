# Plan: Export a thread to Markdown

## META

| Field | Value |
|---|---|
| Feature | Export a thread to Markdown: save the whole thread, plans and tool activity included |
| Size | small (labels `feature`, `small`) |
| Repo | skytuhua-org/Gen-V1 |
| Issue | https://github.com/skytuhua-org/Gen-V1/issues/1236 |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52` (verified by fetch on 2026-11-21) |
| Related work | No existing issue or PR for thread export found (title search for "export" / "markdown": #1229, #1058, #1177, #1178, #951 are unrelated). Sibling feature plans from the same approval: #1234 (Windows signing), #1235 (commit/push/PR from a thread). |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from a researched feature proposal ("Export a thread to Markdown (small): save the whole thread, plans and tool activity included"). Every repository fact below was read from the baseline SHA; line numbers refer to that SHA. Items not verifiable from source are marked **DISCOVERY**. |

**Design and animation ownership.** Leonardo's separate front-end team defines the animation and visual design for this feature: the look of the menu entries, any progress/success/error feedback, icons, and any motion. This plan covers behavior, data, contracts and wiring only. Implementers must reuse existing components (`ActionMenu`, the existing `toast`) with no new visual treatment or motion, and leave every visual/animation decision to that team. If the front-end team's design lands before implementation, it overrides the placeholder UI choices in T05.

## OBJECTIVE

**Problem.** A Gen V1 thread holds the user's prompts, the assistant's answers, the plan (with steps, checks and delegated agents), tool activity and operations. Today the only way to take that out of the app is copying one message at a time (`apps/web/src/CopyButton.tsx`, used per message at `apps/web/src/App.tsx:1178`). Users want to save a whole thread to share it, archive it, attach it to an issue, or paste it into another tool.

**Intended behavior.** From a thread's header actions or its sidebar "Options" menu, the user picks **Export as Markdown…**. Gen V1 builds one Markdown document from the host's stored thread (not from what happens to be rendered on screen) and saves it as a `.md` file through a native save dialog (desktop) or a browser download (web).

**Measurable success.**
- The exported file contains every stored message of the thread in order, even when the UI only shows the last 300 (snapshot window, `packages/storage/store.ts:3,78-95`).
- It contains the plan (every stored revision) and every tool-activity entry and operation, with status.
- It renders as valid CommonMark/GFM: no message content can break out of its block (fence-escaping tests).
- Known secret patterns and the user's home directory do not appear in the output (redaction tests).
- Export of a 5,000-message thread completes in under 2 s on the host in a unit benchmark (T02).

## REQUIREMENTS

### In scope (agreed decisions)
- R1. **Whole thread.** All stored `message` entities of the thread, in store rowid (insertion) order, regardless of the 300-message snapshot window or UI paging.
- R2. **Plans included.** Every stored plan revision (`dataVersion` entities `plan:<threadId>@<n>`), rendered in full (title, run state, authority, steps with status/state/objective/details/result/outputs/checks/blockers/dependsOn/requirements, agent jobs with status/progress/summary/error/child thread title). Each revision appears at its chronological position among messages.
- R3. **Tool activity included.** Every `activity`-role message (e.g. `bash: running`, `bash: finished`) and every `operation` (kind, description, status, approved, args, result/error) and, when present, every `toolEffect` record (toolId, state, publicRedactedSummary, transitions, outcome.error). Consecutive activity entries are grouped into one "Tool activity" block.
- R4. **Other thread records summarized, not dropped.** Input requests (title, prompt, status, response), artifacts (title, kind, purpose, and the note "Interactive artifact; not exported"), attachments/resources (label and file name only), task memory entries (key, author, content), source references on user messages (kind and label).
- R5. **Header.** Thread title, project name, model id, thinking level, mode (plan/build), status, created/updated timestamps (UTC ISO 8601), message count, export timestamp, Gen V1 version (`package.json` `version`), and a format marker line `<!-- gen-v1-thread-export v1 -->`.
- R6. **Entry points.** (a) thread header actions in `ChatView` (`apps/web/src/App.tsx:1155`), (b) sidebar thread "Options" menu (`apps/web/src/ShellSidebar.tsx:205-221`). The sidebar entry exports the row's thread, never the active thread.
- R7. **Save.** Desktop (Electron): native save dialog with suggested file name; the user can cancel. Web: browser download. Suggested file name: `<slugified title>-<YYYY-MM-DD>.md` (slug: lowercase ASCII letters/digits/hyphens, max 60 chars, fallback `thread`).
- R8. **Feedback.** Success, cancel and failure are reported with the existing `toast` (error tone on failure). Exact wording/visuals are the front-end team's; placeholder copy: "Exported “<title>”", "Export failed: <reason>".
- R9. **Privacy.** Redact secret-looking text with the existing `memoryContainsSecret` detector (`packages/core/memory-publication.ts:2`) applied per line and replace matching lines' secret tokens with `[redacted]` (see DESIGN §Redaction); replace the user's home directory prefix in any text with `~`; never include attachment bytes, absolute attachment paths, `privateArgumentCommitment`, account ids, session paths, tokens, or `toolEffect.outcome.value`.
- R10. **Bounds.** Document capped at 32 MiB UTF-8. Per-field caps: operation `args`/`result`/request `response` JSON 64 KiB each, plan step `details` already ≤4096 by schema. Truncated fields end with `… [truncated N bytes]`. If the whole document would exceed the cap, the export fails with a clear error instead of silently cutting the thread.
- R11. **Read-only.** Export never mutates the store and works while a run is active (it exports what is committed at request time; a run in progress gets a header note "Run in progress at export time").

### Out of scope (v1)
- Reasoning / chain-of-thought: not stored in the host `Message` model (Pi adapter keeps only `text` parts, `packages/runtime-pi/events.ts:25-26,55-64`). Not exported.
- Raw tool inputs/outputs beyond what is stored: activity messages carry only `<tool>: <status>` strings (`packages/runtime-pi/events.ts:55-70`, persisted by `packages/core/service.ts:1830-1843`). No new runtime capture is added by this feature.
- Inlining child/delegate threads' transcripts (only their title/status/summary appear under the agent job). Side threads are separate threads with their own export.
- Archived threads (the thread-scoped read rejects them, `apps/server/server.ts:145`); the menu entry is not shown for archived threads.
- Import of the exported file, HTML/PDF/JSON export, copy-to-clipboard of the whole thread, keyboard shortcut, multi-thread export, attachment bytes / images embedded.
- Any visual or animation design (front-end team).

### Compatibility, security, accessibility, errors
- Works for main, side and delegate threads that are not archived.
- Host route uses the same authentication as other `/api/threads/:id/*` routes (`authenticated(...)` client helper, `apps/web/src/api.ts:103`).
- Desktop save keeps the deny-by-default download guard; a new export lane must be admitted explicitly like project-memory export (`apps/desktop/memory-export.ts:54-78`), never a generic "write any file" IPC.
- Menu items are reachable by keyboard through the existing `ActionMenu` semantics (`packages/ui-shell/ActionMenu.tsx:7-28,63-81`).
- Errors: thread missing/archived → 404 "Thread unavailable"; over cap → 413-style `EXPORT_TOO_LARGE`; desktop owner window closed or navigated mid-save → cancelled with toast; dialog cancel → no error toast (neutral "Export cancelled").

## REPO_MAP (verified at baseline)

| Path | Fact relevant to this feature |
|---|---|
| `packages/contracts/index.ts:1-32` | `Thread`, `Message` (`role: "user" \| "assistant" \| "activity"`, plain `content: string`, optional `sourceRefs`), `Operation`, `ResourceGrant`, `ArtifactRecord`, `InputRequest`, `TaskMemory`, `DataRecord`, `Snapshot` (`messagesTruncated`). |
| `packages/contracts/planning.ts:1-100` | `PlanRecordSchema` (version 1, title, run, authority, runState, steps ≤24, agents ≤24), `PlanStepSchema`, `PlanCheckSchema`, `AgentJobSchema`, `planDataId(threadId)` = `plan:<threadId>`, `agentProgress(job)`. |
| `packages/core/planning.ts:168-174` | Every plan write stores `data` `plan:<id>` and `dataVersion` `plan:<id>@<revision>`. `createdAt` is copied from the first revision, so it is **not** a per-revision timestamp. |
| `packages/storage/store.ts:69-75,97,141` | Entities table; rowid is insertion order; `put` is an upsert (`ON CONFLICT DO UPDATE`) so a row keeps its rowid when updated (streaming assistant deltas keep their position); `all(kind, threadId)` returns rowid order per kind. |
| `packages/contracts/tool-effects.ts:38-55,86-94` | `ToolEffectRecord` (toolId, state, publicRedactedSummary, transitions, outcome). Entity kind `toolEffect`; present only when ledger features ran. |
| `apps/server/server.ts:131-163` | `/api/threads/:id/messages` (paged) and `/api/threads/:id/snapshot` (full per-thread `store.all` read; rejects archived). Pattern for the new route. |
| `apps/web/src/api.ts:103,127,143` | `authenticated`, `read`, snapshot and message-page clients. |
| `apps/web/src/project-memory-api.ts:90-111` | Precedent: desktop bridge save with filename/bytes/sha256 receipt verification; browser fallback via `Blob` + `<a download>`. |
| `packages/desktop-contract/index.ts:51` | `DESKTOP_CHANNELS` incl. `memoryExport: 'harness-desktop:memory-export'`; `DesktopBridge` interface. |
| `apps/desktop/preload.ts:15` | `exportProjectMemory` bridge method via `ipcRenderer.invoke`. |
| `apps/desktop/main.ts:26,121-122,237-241` | `createMemoryExportDownloads()`, session guard, authorized `handle(...)` wrapper, memory-export handler binding window/surface/URL/isCurrent. |
| `apps/desktop/memory-export.ts:31-124` | One-use admitted download: payload validation, filename, sha256, `will-download` guard, `DownloadItem.setSaveDialogOptions`, cancel/timeout/owner checks, receipt. JSON-schema specific; cannot be reused unchanged. |
| `packages/core/memory-publication.ts:2` | `memoryContainsSecret(text): boolean`. |
| `apps/web/src/ShellSidebar.tsx:205-221,331` | `renderMenu(item)` `ActionMenu` items (place, detach, rename, settle …) and `toast`. |
| `apps/web/src/App.tsx:1155-1180` | `ChatView` header (breadcrumb, title, `ConversationFind`, `SessionBranchMenu`) and message list. |
| `apps/web/src/SessionBranchMenu.tsx:167,187-221` | Existing header `ActionMenu` for history actions; a sibling location for an export item. |
| `tests/desktop-memory-export.test.ts`, `tests/memory-export-client-v3.test.ts`, `tests/conversation-read-http.test.ts`, `tests/plan-timeline.test.ts` | Test patterns to copy for desktop download, renderer client, HTTP route and plan fixtures. |
| `scripts/browser-suites.ts:3,19,53` | Browser suite registry (`rootBrowserSpecs`, per-suite configs). New e2e spec must be registered here. |
| `vitest.config.ts`, `playwright.config.ts`, `package.json` scripts | `pnpm test:no-lease`, `pnpm exec vitest run <files>`, `pnpm typecheck`, `pnpm lint`, `pnpm test:browser`. Node ≥ 24.10.0, pnpm 10.30.3. |

**DISCOVERY (verify during T01, do not assume):** the exact export of the home directory used by the host (`os.homedir()` is acceptable if no project helper exists); whether `packages/core/service.ts` exposes a version string (else read `package.json` at build time like other server code does, or pass it from `apps/server`); whether `ChatView`'s header already receives a `toast` function.

## DESIGN

### Architecture
```
Renderer (App.tsx header / ShellSidebar menu)
  └─ exportThreadMarkdown(threadId)            apps/web/src/thread-export-api.ts  (new)
       ├─ GET /api/threads/:id/export.md      apps/server/server.ts (new route)
       │     └─ buildThreadExport(store, id)  packages/core/thread-export.ts (new: gather, pure)
       │           └─ renderThreadMarkdown(model, opts)  packages/core/thread-markdown.ts (new: pure)
       └─ save
            ├─ desktop: window.harnessDesktop.exportThreadMarkdown({filename, content})
            │     └─ DESKTOP_CHANNELS.threadExport → apps/desktop/thread-export.ts (new admitted download)
            └─ web: Blob(text/markdown) + <a download>
```
The host builds the document because only the host can read the full store (all messages, all plan revisions, tool effects) in a single consistent read; the renderer's snapshot is windowed.

### Data gathering (`buildThreadExport`)
1. `thread = store.get('thread', id)`; reject if missing or `store.get('archivedThread', id)` (same as `server.ts:145`).
2. Read in one synchronous pass (node:sqlite is synchronous; no awaits between reads gives a consistent view): add a store method `timelineFor(threadId, kinds)` that runs `SELECT kind, body FROM entities WHERE thread_id=? AND kind IN (...) ORDER BY rowid` for kinds `message`, `dataVersion`, `operation`, `request`, `artifact`, `resource`, `toolEffect`. Filter `dataVersion` to ids starting with `plan:<threadId>@`. Rowid order gives one chronological timeline across kinds (upsert keeps rowid; each plan revision is a new row).
3. Separately read `taskMemory` (rendered as an appendix) and child threads for agent jobs (`store.get('thread', job.childThreadId)` title/status).
4. Output a typed `ThreadExportModel { thread, version, exportedAt, runInProgress, timeline: TimelineEntry[], memory: TaskMemory[], childThreads: Record<id,{title,status}> }` where `TimelineEntry` is a discriminated union by `kind`.

### Markdown format (v1, normative)
```markdown
<!-- gen-v1-thread-export v1 -->
# <thread title>

| | |
|---|---|
| Project | <projectName or —> |
| Model | <modelId or —> (thinking: <level or default>) |
| Mode | plan \| build |
| Status | <status> |
| Created | <ISO UTC> |
| Updated | <ISO UTC> |
| Messages | <n> |
| Exported | <ISO UTC> by Gen V1 <version> |

> Run in progress at export time.        (only when thread.runId != null)

---

## User · 2026-11-21T03:12:09Z
<message content verbatim>
_Context: file `src/a.ts` L10–20; message …_   (only when sourceRefs present; kind + label only)

## Assistant · 2026-11-21T03:12:15Z
<message content verbatim>

<details><summary>Tool activity (3)</summary>

- 03:12:16Z `bash: running`
- 03:12:18Z `bash: finished`
- 03:12:18Z `read: failed`

</details>

### Plan · revision 2 — <plan title>
_Authority: approved · Run state: running_
1. **[completed] <step title>** — <objective>
   - Details: <details>
   - Result: <result>
   - Checks: ✔ verified_passed <label>; ✖ reported_failed <label> — <details>
   - Blockers: …   - Depends on: step ids   - Requirements: [x] label, [ ] label
   - Agents: <job name> (<status>, <progress>%) — <summary or error>; child thread “<title>”

### Operation · <kind> · <status>
<description>  (approved: yes/no)
````json
<args JSON, redacted, ≤64 KiB>
````
Result / Error: …

### Tool effect · <toolId> · <state>
<publicRedactedSummary>; transitions: PREPARED→DISPATCHED→SUCCEEDED (times); error: <outcome.error>

### Input request · <title> · <status>
<prompt>; Response: ```json …```

### Artifact · <title> (<kind>)
<purpose> — Interactive artifact; not exported.

### Attachment · <label>
File: <basename>   (never the absolute path)

---
## Task memory
- **<key>** (<author>, rev <n>): <content>
```
Rules:
- Message content is emitted verbatim (it is already Markdown) after redaction. It is never wrapped in a fence, so formatting is preserved; to keep headings in content from colliding with the export's structure, each message is preceded by the `## Role · time` heading and followed by a blank line; content headings are left as written (accepted trade-off, documented in the file format note).
- Every JSON/code block uses a fence of backticks one longer than the longest backtick run in its body, minimum 3 (`fenceFor(text)`).
- Inline values in headings/tables/`<summary>` escape `|`, `<`, `>`, `` ` ``, `*`, `_`, `[`, `]`, and newlines become spaces.
- Timestamps are the stored ISO strings; activity lines show the time part only.
- Activity grouping: consecutive `activity` messages (no user/assistant message between them) form one `<details>` block. Count shown in the summary.
- Plan revisions are rendered in full each time (accepted: revisions are bounded by `PLAN_LIMITS`, steps ≤24, jobs ≤24).
- Empty thread: header plus `_No messages._`.
- Line endings `\n`; file ends with exactly one `\n`; UTF-8 without BOM.

### Redaction
- `redact(text, home)`: (1) replace every occurrence of `home` (and the same path with `\` separators on Windows) followed by a separator with `~`; (2) for each whitespace-separated token where `memoryContainsSecret(token)` is true, replace the token with `[redacted]`; if `memoryContainsSecret(line)` is still true for the whole line, replace the line with `[redacted line]`. Applied to every text field emitted (messages, plan text, operation JSON after serialization, summaries, request prompts/responses, memory).
- Known limitation stated in the file note: redaction is best-effort pattern matching, not a guarantee.

### HTTP contract
- `GET /api/threads/:id/export.md` → `200`, `Content-Type: text/markdown; charset=utf-8`, `Cache-Control: no-store`, header `X-Gen-Export-Filename: <suggested filename>`, body = document.
- Errors use the existing `HarnessError` mapping: `NOT_FOUND` (missing/archived), `INVALID_INPUT` (bad id), new code `EXPORT_TOO_LARGE` when > 32 MiB. **DISCOVERY:** confirm how `HarnessError` codes map to HTTP statuses and add `EXPORT_TOO_LARGE` to that map/enum.

### Desktop save lane
- New channel `DESKTOP_CHANNELS.threadExport = 'harness-desktop:thread-export'`; `DesktopBridge.exportThreadMarkdown?(payload: {filename: string; content: string}): Promise<DesktopThreadExportResult>` where result is `{status: 'saved' | 'cancelled'; filename; bytes; sha256}` (mirror `DesktopMemoryExportResult`).
- `apps/desktop/thread-export.ts` mirrors `memory-export.ts`: validate `filename` matches `^[a-z0-9-]{1,60}-\d{4}-\d{2}-\d{2}\.md$`, content is a string ≤ 32 MiB with no NUL; compute bytes/sha256; one pending permit per WebContents; data-URL download started by main; `will-download` guard admits only the exact pending URL/filename/frame; `item.setSaveDialogOptions({defaultPath: filename, filters: [{name: 'Markdown', extensions: ['md']}]})`; owner checks, cancel, timeout, receipt. Factor shared helpers out of `memory-export.ts` only if it does not change memory-export behavior (its tests must stay green); otherwise duplicate the minimal logic.
- Surface ownership: allow `main`, and `thread`/`plan`/`workspace` surfaces whose `threadId` equals the exported thread (same rule as `surfaceOwns`, `memory-export.ts:43-45`); the payload therefore also carries `threadId`.
- Register in `apps/desktop/main.ts` next to `channels.memoryExport` (line 241) using `handle(...)`, and add the guard to `secureSessionDownloads` (line 122). Plug-in windows: deny (not in `pluginDesktopChannelAllowed`).

### Renderer flow (`exportThreadMarkdown(thread, isCurrent)`)
1. Fetch the route via `authenticated(...)`; read text; read filename header (fallback computed client-side with the same slug rule).
2. Desktop: if `window.harnessDesktop` exists but lacks `exportThreadMarkdown` → error "This desktop version cannot export threads." Else compute sha256, call bridge, verify receipt filename/bytes/sha256 equal (same as `project-memory-api.ts:98-104`).
3. Web: `Blob([content], {type: 'text/markdown;charset=utf-8'})`, anchor download, revoke URL.
4. Return `{status}`; caller toasts. Guard against owner change with `isCurrent()` between steps like `downloadProjectMemory`.

### Rollback
Additive only: one route, one store read method, two pure modules, one desktop lane, two menu items. Revert = revert the PR(s). No schema or data migration.

## EXECUTION_DAG

| ID | Goal | Depends on | Owner boundary (files) |
|---|---|---|---|
| T01 | Discovery checks + store `timelineFor` read | — | `packages/storage/store.ts`, `tests/thread-export-store.test.ts` |
| T02 | Pure renderer `renderThreadMarkdown` + redaction + fences | — | `packages/core/thread-markdown.ts`, `tests/thread-markdown.test.ts` |
| T03 | `buildThreadExport` gather + host route | T01, T02 | `packages/core/thread-export.ts`, `apps/server/server.ts`, error-code map, `tests/thread-export-http.test.ts` |
| T04 | Desktop admitted save lane | — | `packages/desktop-contract/index.ts`, `apps/desktop/thread-export.ts`, `apps/desktop/main.ts`, `apps/desktop/preload.ts`, `tests/desktop-thread-export.test.ts` |
| T05 | Renderer client + menu entries | T03, T04 | `apps/web/src/thread-export-api.ts`, `apps/web/src/ShellSidebar.tsx`, `apps/web/src/App.tsx` (or `SessionBranchMenu.tsx`), `tests/thread-export-client.test.ts` |
| T06 | Browser e2e + docs | T05 | `tests/e2e/thread-export.spec.ts`, `scripts/browser-suites.ts`, `docs/` user doc line, `CHANGELOG.md` |

T01, T02 and T04 can run in parallel (disjoint files).

### T01 — Discovery + `Store.timelineFor`
- Steps: (1) Resolve the three DISCOVERY items in REPO_MAP and the `HarnessError` status mapping; record answers in the issue checkpoint. (2) Add `timelineFor(threadId: string, kinds: readonly string[]): {kind: string; value: unknown}[]` to `Store` as a prepared statement with a fixed kind list (no string-built SQL from input; validate kinds against an allowlist).
- Tests (vitest): insertion order across kinds is preserved; updating an existing message (upsert) does not move it; other threads' rows excluded; unknown kind rejected.
- Done when: `pnpm exec vitest run tests/thread-export-store.test.ts` passes and `pnpm typecheck` passes.

### T02 — `renderThreadMarkdown(model, {home})`
- Input: `ThreadExportModel` (define the type in `packages/core/thread-markdown.ts` or `packages/contracts/thread-export.ts`). Output: string. No I/O, no clock (`exportedAt` comes in the model).
- Implement exactly the format in DESIGN, plus `fenceFor`, `escapeInline`, `redact`, `slugFilename(title, date)`, truncation helper.
- Tests: golden-file test for a fixture thread with user/assistant/activity messages, 2 plan revisions with checks and agents, an operation with failure, a tool effect, a request, an artifact, an attachment and memory (`tests/fixtures/thread-export/basic.md`); content containing ``` and ```` stays inside its block; `|` and newlines in titles escaped; empty thread; a GitHub-token-looking string and an `sk-` key are replaced by `[redacted]`; home path replaced by `~`; field over 64 KiB truncated with marker; Unicode (emoji, CJK, RTL) preserved; output ends with a single `\n`; 5,000-message model renders < 2 s.
- Done when: `pnpm exec vitest run tests/thread-markdown.test.ts` passes.

### T03 — Gather + route
- `buildThreadExport(store, threadId, {version, now, home})` uses `timelineFor`, filters plan dataVersions, parses plan values with `PlanRecordSchema.safeParse` (invalid revisions rendered as `_Plan revision N could not be read._`), resolves child thread titles, sets `runInProgress = thread.runId !== null`.
- Route `GET /api/threads/:id/export.md` in `apps/server/server.ts` beside the snapshot route; validates id with the same rules as other routes; throws `EXPORT_TOO_LARGE` when `Buffer.byteLength(doc) > 32 * 1024 * 1024`.
- Tests (pattern: `tests/conversation-read-http.test.ts`): 200 with markdown content type and filename header; includes message #1 of a 350-message thread (beyond the 300 window); includes plan revision 1 and 2; 404 for unknown and archived thread; unauthenticated request rejected like sibling routes; over-cap returns `EXPORT_TOO_LARGE`; export during an active run includes the in-progress note and does not change `store.sequence`.
- Done when: those tests and `pnpm typecheck` pass.

### T04 — Desktop save lane
- Add channel, bridge method and result type to `packages/desktop-contract/index.ts`; preload method in `apps/desktop/preload.ts`; `apps/desktop/thread-export.ts` per DESIGN; register in `apps/desktop/main.ts`.
- Tests (pattern: `tests/desktop-memory-export.test.ts`): saved receipt has matching filename/bytes/sha256; cancel → `cancelled`; invalid filename, NUL content, oversize content rejected before any download; a second concurrent export from the same window rejected; unrelated downloads still denied; owner window navigated/destroyed mid-save → rejected; plug-in surface denied; thread surface for another thread denied. Existing `tests/desktop-memory-export.test.ts` still passes unchanged.
- Done when: `pnpm exec vitest run tests/desktop-thread-export.test.ts tests/desktop-memory-export.test.ts` passes.

### T05 — Renderer client + entry points
- `apps/web/src/thread-export-api.ts` per DESIGN §Renderer flow.
- Sidebar: add `{id: 'export-markdown', label: 'Export as Markdown…', onSelect: () => …}` to `renderMenu` items in `ShellSidebar.tsx`, using the row `item` (not the active thread); hide for archived threads. Toast on result.
- Header: add the same action to the thread header actions in `ChatView` (`App.tsx:1155`), preferably as an item in the existing `SessionBranchMenu` `ActionMenu` if that menu is the header's action menu; otherwise a new `ActionMenu` item list — no new visual components (front-end team owns visuals).
- Tests (pattern: `tests/memory-export-client-v3.test.ts`): web path creates a `text/markdown` Blob with the server filename; desktop path verifies receipt and throws on mismatch; old desktop without the method → clear error; owner change between fetch and save aborts; HTTP error surfaces message.
- Done when: client tests pass, `pnpm typecheck` and `pnpm lint` pass.

### T06 — E2E + docs
- `tests/e2e/thread-export.spec.ts` using the Vite fixture server: open a fixture thread, choose "Export as Markdown…" from the sidebar Options menu, capture the download (`page.waitForEvent('download')`), assert file name pattern and that the content contains the first and last message, a plan heading and a tool-activity block. Register the spec in `scripts/browser-suites.ts` (`rootBrowserSpecs` or the matching suite).
- Add one line to `CHANGELOG.md` (Unreleased) and a short "Export a thread" section to the user-facing docs (**DISCOVERY:** pick the existing user guide page, e.g. under `docs/public/`).
- Done when: `pnpm test:browser` (or the single registered suite) passes the new spec, and `pnpm check:docs-links` passes.

## VALIDATION

| Requirement | Task | Acceptance check |
|---|---|---|
| R1 whole thread | T01, T03 | 350-message route test includes message 1 and 350 in order |
| R2 plans | T02, T03 | golden file has revisions 1 and 2 at their timeline positions |
| R3 tool activity | T02, T03 | golden file has grouped activity block, operation with error, tool effect |
| R4 other records | T02 | golden file sections for request/artifact/attachment/memory |
| R5 header | T02 | golden file header table + format marker |
| R6 entry points | T05, T06 | sidebar e2e; header action unit/render test |
| R7 save | T04, T05, T06 | desktop receipt tests; web Blob test; e2e download |
| R8 feedback | T05 | toast called with success/cancel/error |
| R9 privacy | T02, T04 | redaction tests; no absolute paths; desktop rejects NUL |
| R10 bounds | T02, T03, T04 | truncation marker; `EXPORT_TOO_LARGE`; oversize desktop rejection |
| R11 read-only | T03 | `store.sequence` unchanged; in-progress note |

Commands (from repo root, Node ≥ 24.10.0, `pnpm install`): `pnpm typecheck`; `pnpm lint`; `pnpm exec vitest run tests/thread-export-store.test.ts tests/thread-markdown.test.ts tests/thread-export-http.test.ts tests/desktop-thread-export.test.ts tests/desktop-memory-export.test.ts tests/thread-export-client.test.ts`; `pnpm test:no-lease` (full regression); `pnpm test:browser`. Manual real-user check on the packaged desktop app (Windows): export a long real thread, open the file in a Markdown viewer, confirm the save dialog, cancel path and file name. **None of these have been run; this is a plan.**

Release gate: all of the above green in CI, manual desktop check recorded on the issue, front-end team sign-off on the UI treatment.

## STATE
- Researched and decided: everything in REQUIREMENTS and DESIGN (r1).
- Implemented: nothing. Verified: nothing.
- Owners/branches: none yet. Plan file on branch for the docs PR linked from the issue.
- Risks: (1) activity messages carry little detail (tool name + status only), so "tool activity" in the export is limited to what the host stores; richer capture is a separate feature. (2) Pattern-based redaction can miss secrets; documented in the file. (3) `dataVersion.createdAt` is not per revision, so plan ordering relies on rowid (verified upsert semantics).
- Next step: T01, T02 and T04 in parallel.

## REFERENCES
- AGENTS.md "Complete Markdown plan publication" contract (this plan's structure).
- Precedent implementation: project-memory export (`apps/web/src/project-memory-api.ts`, `apps/desktop/memory-export.ts`, `tests/desktop-memory-export.test.ts`).
- CommonMark fenced code blocks (fence must be longer than any backtick run inside): https://spec.commonmark.org/0.31.2/#fenced-code-blocks
- GFM `<details>` rendering and tables: https://github.github.com/gfm/
- Electron `DownloadItem.setSaveDialogOptions`: https://www.electronjs.org/docs/latest/api/download-item
