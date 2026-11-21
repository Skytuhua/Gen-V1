# Plan: Edit files by hand

## META

| Field | Value |
|---|---|
| Feature | Manual file editing: open a project file from the Files surface in an editor with syntax highlighting, edit it, and save it to disk, so small fixes do not need an agent turn |
| Size | medium (labels `feature`, `medium`); no sub-issues (one DAG, ownership boundaries below) |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue (number assigned at publication; the issue header links it) |
| Plan file | `docs/agent-plans/manual-file-editor.md` (identical to this issue body) |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git log -1` on a fresh clone, 2026-11-21) |
| Related work | No existing issue or PR for a code editor or manual save (searched issues/PRs for "editor", "edit file", "save file", "codemirror", "monaco"; repo-wide `package.json` search for `codemirror|monaco|shiki|prism|highlight.js` found nothing). Sibling batch 3 features (keep awake, quick-ask hotkey, taskbar progress, fix failing CI, secret check before commit, image generation, database browser, dev containers) are planned in their own issues and do not overlap. Related machinery reused here: read-only Files surface (`apps/web/src/files/*`), guarded atomic replacement (`packages/core/file-access.ts`), M08 checkpoints (`packages/workspace/checkpoints.ts`). |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 3, item 6: "Edit files by hand (M): Open a project file in an editor pane with syntax highlighting and save, so small fixes don't need an agent turn." Owner instructions for batch 3: there is no separate front end team designing these features, so this plan specifies the visual design and animation itself; when the work is finished the implementing agent hands it to the front end team for review (task T10). All repository facts were read by static inspection of the baseline SHA; line numbers refer to that SHA. Decisions marked **DECIDED** were made by the planner (the owner delegates non-approval decisions); options not taken are recorded. No code was built or tested while planning. |

**Design ownership.** This plan defines the visual design and motion (DESIGN §8). Implementers build exactly that, using existing tokens. When all tasks are verified, the implementing agent hands the finished work to Leonardo's front end team for review (T10) before the issue can close.

## OBJECTIVE

**User problem.** The Files surface shows project files read-only: `ProjectFiles` renders the text in a plain `<pre>` with no editing, no dirty state and no write request (`apps/web/src/files/ProjectFiles.tsx:147–188`). To fix a typo, change a constant or tweak a config value, the user must either describe the change to the agent (a full model turn, cost and latency) or leave Gen for another editor. Competitors ship this: Claude Code Desktop has a file pane where users "can edit files inside the session's working directory", with auto save and a "file changed on disk" warning offering Override or Discard (https://code.claude.com/docs/en/desktop, section "Open and edit files"). It is an open request for Codex: "Add a real code editor to Codex App like Cursor" (https://github.com/openai/codex/issues/19636, open, 15 reactions: "file tree, tabs, syntax highlighting, manual code editing") and in-place Markdown editing in the side file viewer (https://github.com/openai/codex/issues/28644, open).

**Intended behavior.** With the flag on, in a project-bound main thread, the user selects a text file in Files and clicks **Edit** (or presses `E` on the focused preview). The preview becomes a CodeMirror 6 editor with syntax highlighting for the file's language, line numbers, search, undo/redo and the user's code font and word-wrap settings. Edits mark the file dirty. **Save** (button or Ctrl/Cmd+S) writes the full text atomically to disk only if the file still has the SHA-256 it had when loaded. If the file changed on disk (typically an agent edit), Gen shows a conflict bar with **Reload** (drop my edits) and **Overwrite** (write mine). Unsaved edits survive reload of the window and are never lost silently when switching files. With M08 checkpoints on, each save first captures the previous bytes as a checkpoint so the edit can be reviewed and restored like agent edits.

**Measurable success.**
1. From a file preview, a user can change one line and save in ≤ 3 interactions (Edit, type, Ctrl+S), keyboard-only included (T09 browser test).
2. A saved file's bytes equal the editor text encoded as UTF-8 with the original line endings and BOM preserved (T03 unit test byte-compares CRLF, LF, BOM and no-trailing-newline fixtures).
3. A save whose `expectedSha256` no longer matches the disk never writes and returns `PRECONDITION_FAILED` with the current SHA (T03 unit test).
4. Opening the editor adds no CodeMirror code to the initial web bundle: the editor chunk loads only on first Edit (T07 build check).
5. All acceptance rows R01–R20 in VALIDATION pass; existing files-reading, checkpoints, keyboard-bindings, reduced-motion and UI-guard suites still pass; with the flag off the Files surface and server routes behave exactly as at baseline.

## REQUIREMENTS

### In scope

- **R01 Surface.** The project Files surface only: `ProjectFiles` → `FilesView` (`apps/web/src/WorkspaceSurfaceBody.tsx:35–38,65–71`). Editing happens in place in the selected-file preview area; there is no new surface, tab type or pane kind.
- **R02 Not for granted files.** `GrantedFiles` (`apps/web/src/files/GrantedFiles.tsx:73–95`, files shared through resource grants when no project is bound) stays read-only. No write authority is added to resource-grant reads.
- **R03 Editable files.** A file is editable when all hold: the read returned `binary:false`; its bytes decode as strict (fatal) UTF-8; size ≤ 1 MiB (the existing read cap, `readBoundFile(target,1024*1024)` in `packages/workspace/tools.ts:204`); the path is not inside `.git` (already denied for reads) and not in the protected list (R04). Otherwise the Edit button is disabled with the reason as its accessible description: "Binary files can't be edited", "This file isn't valid UTF-8", "Files over 1 MB can't be edited here", "This file is protected".
- **R04 Protected paths.** Gen's own project configuration and secrets are view-only, mirroring Claude's view-only `.mcp.json`/settings files: any path segment `.git`; files matched by the checkpoint secret exclusions (`packages/workspace/checkpoints.ts:41–66`, reuse that predicate, do not copy it); `.harness-directory-guard`. Discovery item X5 confirms whether Gen keeps per-project config files that must be added.
- **R05 Existing files only.** v1 edits existing regular files. No create, rename, delete, chmod or directory operations. Symlinks are denied (the read path already rejects non-regular and multi-link files through `readBoundFile`, `packages/core/file-access.ts:145–161`).
- **R06 Editor.** CodeMirror 6 with: line numbers, active-line highlight, bracket matching, auto-indent, undo/redo history, search and replace panel (Ctrl/Cmd+F, Ctrl/Cmd+H is not bound; replace is inside the search panel), Tab indents with the Escape-then-Tab focus escape (CodeMirror `indentWithTab` documented behavior), selection highlight, the user's `--code-font`/`--code-font-size` (`apps/web/src/useAppearance.ts:21,34`) and `wordWrap` setting (`useAppearance.ts:29`, `data-word-wrap` on the shell).
- **R07 Languages.** Highlighting by file extension through `@codemirror/language-data` (lazy per-language loading). Must cover at least: TypeScript/TSX/JavaScript/JSX/MJS/CJS, JSON/JSONC, Markdown, CSS, HTML, Python, YAML, Rust, Go, Java, C/C++, C#, Shell, SQL, TOML, XML. Unknown extensions open as plain text (still editable).
- **R08 Dirty state.** The editor tracks dirty = current text ≠ loaded text. Dirty files show the dirty marker (DESIGN §8) in the preview header and in the folder list row. Undoing back to the loaded text clears dirty.
- **R09 Save.** Save button and Ctrl/Cmd+S (scoped to the editor, R15) send the full text with the loaded SHA-256 to the save route (DESIGN §3). Success replaces the loaded text and SHA with the server's response, clears dirty, keeps cursor/scroll, and announces "Saved <name>". Save is disabled when not dirty or a save is in flight; a second Ctrl+S during a save is ignored.
- **R10 Byte fidelity.** Saving writes exactly: original BOM (if the loaded file started with U+FEFF, it is kept), the editor text with the original dominant line separator (CRLF if the loaded file contained `\r\n` and no lone `\n`, else LF; mixed files keep LF for new lines and the plan does not rewrite existing ones, see DESIGN §5), and the original trailing-newline state is whatever the user's text contains. No reformatting, no trimming, no tab/space conversion.
- **R11 Conflict.** If the disk SHA ≠ `expectedSha256` at save, nothing is written and the UI shows the conflict bar: "<name> changed on disk since you opened it." with **Reload** (discard my edits, load disk) and **Overwrite** (save mine with the new SHA as precondition, after which a new conflict is again possible). A **Compare** action opens a read-only side-by-side view of disk vs mine (DESIGN §6, `@codemirror/merge`) — DECIDED as part of v1 because Overwrite without seeing the agent's change is risky.
- **R12 External change detection.** While the editor is open and the surface is active and the document visible, the client re-reads the file's SHA every 5 s and on window focus. Clean editor + changed SHA → reload silently, keeping cursor line and scroll position, and announce "Reloaded <name>: changed on disk". Dirty editor + changed SHA → show the conflict bar before the user tries to save. Deleted/unreadable file → bar "<name> is no longer available." with **Keep editing** (save is disabled) and **Close**.
- **R13 Unsaved-edit safety.** Switching to another file, navigating folders, closing the surface/pane or changing thread with a dirty editor opens the shared confirm dialog "Save changes to <name>?" with **Save**, **Don't save**, **Cancel** (Cancel default focus). Window unload with dirty editors triggers the browser/Electron `beforeunload` prompt. In addition, the dirty text is written to the client journal (`apps/web/src/journal.ts`) keyed by project, thread, path and loaded SHA, debounced 500 ms, and restored on next open of that file with a bar "Restored unsaved changes." (**Keep**, **Discard**). If the disk SHA differs from the journaled one, restore shows the conflict bar instead.
- **R14 Exit edit mode.** **Done** (or Escape when the search panel is closed and the editor is not dirty) returns to the read-only preview. Done with a dirty editor behaves like R13.
- **R15 Keyboard.** New registry entries in `KEYBOARD_BINDINGS` (`apps/web/src/keyboard-bindings.ts:25–48`): `files.edit` (`E`, scope Files preview, not while typing), `files.save` (Mod+S, scope editor), `files.doneEditing` (Escape, scope editor, conditions R14). Mod+S must `preventDefault` only when the editor (or its toolbar) has focus, so the browser/Electron "Save page" is suppressed there and nowhere else. IME composition must not trigger shortcuts. They appear in the keyboard reference (`harness-keyboard-reference`).
- **R16 Checkpoints.** When `workspace.checkpointsV1` is on, the server captures the pre-save bytes with `CheckpointService.createFromBytes` (`packages/workspace/checkpoints.ts:306–312`) under the thread's checkpoint owner (`workspaceOwnerScope`, `apps/server/workspace-routes.ts:82–84`) with new provenance kind `manual_edit` and label "Manual edit: <path>". Capture failure does **not** block the save (same policy as the approved-agent path, `packages/core/service.ts:2263–2279`), and the response says `checkpoint: 'captured'|'excluded'|'unavailable'|'disabled'`. Secret-excluded paths cannot be edited (R04), so `excluded` only occurs for limits.
- **R17 Flag.** New host capability flag `workspace.manualEditV1`, owner `m08`, default **false**, registered beside the M08 keys (`packages/core/capability-flags.ts:55–60,133–137`). Flag off: no Edit button, `GET …/file/edit-capability` returns `{available:false}`, `POST …/file/save` returns `CAPABILITY_DENIED`, editor chunk never loads.
- **R18 Thread kinds.** Same ownership as reads: the save route calls the same `ProjectTools.binding` (`packages/workspace/tools.ts:71–77`), so side and delegate threads are denied and the physical root identity is rechecked. Archived threads (DISCOVERY X6) are view-only.
- **R19 Errors.** Every failure keeps the editor text and shows a specific inline message in the bar area: `PRECONDITION_FAILED` → conflict bar (R11); `CAPABILITY_DENIED` → "Editing isn't available for this file."; `RESOURCE_LIMIT` → "File is over 1 MB after your edits; it can't be saved here."; `PROJECT_NOT_CONNECTED`/root changed → "Reconnect the project to save."; network/5xx → "Couldn't save. Your changes are kept." with **Retry**. Never a toast only.
- **R20 Performance.** Opening a 1 MiB file in the editor takes < 300 ms scripting after the chunk is cached (CI browser); typing latency stays under one frame for a 10,000-line file (CodeMirror viewport rendering). The editor chunk is code-split (dynamic `import()`), and language modes load on demand.

### Out of scope (v1)

- Creating, renaming, deleting files or folders; multi-file tabs; split editors; minimap; code intelligence (go-to-definition, diagnostics, completion, LSP). M07 code intelligence (`docs/progress.md:27`) may plug in later.
- Editing granted files, remote/cloud workspaces, or files over 1 MiB; binary or non-UTF-8 encodings (UTF-16, Latin-1).
- Auto save. Claude Desktop defaults to auto save; Gen v1 uses explicit save (D3).
- Telling the agent about manual edits automatically (agents re-read files they edit; `file_replace_prepare` already requires the current SHA, `packages/capabilities/schemas.ts:15,33`, so a stale agent write fails rather than clobbering). Follow-up candidate: an optional "I edited <path>" note in the next message.
- Editing from the Changes diff or checkpoint views.
- Vim/Emacs keymaps, user-configurable editor themes beyond light/dark.

### Decisions (DECIDED) and options not taken

| ID | Decision | Options not taken (why) |
|---|---|---|
| D1 | CodeMirror 6 (`@codemirror/*`, MIT) | Monaco (≈ several MB, web workers, AMD loader, harder to theme to DESIGN tokens and to code-split in Vite/Electron); a highlighted `<textarea>` overlay (poor for large files, no undo/search) |
| D2 | Edit in place in the existing Files preview | New "Editor" surface kind / tabs (larger layout and persistence change in `split-workspace`; out of medium scope) |
| D3 | Explicit save + journaled drafts | Auto save (agents write the same files concurrently; silent overwrites would race them) |
| D4 | Optimistic concurrency on the raw-byte SHA-256 already returned by reads | mtime/ETag (not returned today; mtime unreliable across atomic saves); file locks (Windows/agent interference) |
| D5 | Polling the existing read route every 5 s while open | `fs.watch` + SSE (no project content watcher exists, research found none; new host subsystem, platform quirks); poll only on focus (misses agent edits while the user types) |
| D6 | New narrow route `POST /api/projects/:projectId/file/save` | Reusing `file_replace_prepare` + approval (`packages/capabilities/index.ts:116–181`): designed for agent operations with approvals, resource grants and running-thread status; a user's own keystroke save needs no approval step |
| D7 | Reuse guarded atomic replacement `replaceOwnedFile` (`packages/core/file-access.ts:108–119`) with expected destination hash | Plain `writeFile` (non-atomic, no guard) |
| D8 | Checkpoint capture best effort, provenance `manual_edit` | Block save on capture failure (save would fail for unrelated checkpoint limits); no checkpoint (manual edits would be the only unrestorable edits) |
| D9 | Flag `workspace.manualEditV1` (m08), default false | Always on (unverified write path); a user setting instead of a host flag (flags gate unverified code in this repo) |
| D10 | Strict UTF-8 only, BOM and line separator preserved | Encoding detection/conversion (scope, data loss risk) |
| D11 | Compare view with `@codemirror/merge` on conflict | Overwrite/Discard only like Claude (user cannot see the agent's change before overwriting) |

### UX flows

1. **Edit and save.** Files → select `src/config.ts` → preview → **Edit** → editor with cursor at line 1 (or at the preview's current scroll line) → type → dirty dot appears → Ctrl+S → spinner on Save ≤ the request → "Saved" check → dirty clears.
2. **Conflict.** User edits; meanwhile the agent edits the same file → within 5 s the conflict bar slides in → **Compare** shows disk vs mine → user chooses **Overwrite** or **Reload**.
3. **Switch with unsaved edits.** User clicks another file → dialog "Save changes to config.ts?" → **Save** saves then opens the other file; **Don't save** discards; **Cancel** stays.
4. **Crash/reload.** Window reloads with a dirty editor → reopen file → "Restored unsaved changes." bar with **Keep**/**Discard**.
5. **Not editable.** Select `logo.png` → Edit disabled, tooltip "Binary files can't be edited".

### Compatibility, security, privacy, accessibility

- Windows x64 (supported beta platform per `CONTRIBUTING.md`) and Linux dev. CRLF preservation is a Windows must.
- Security boundary: the save route accepts only paths the read route accepts for the same binding, plus R03–R05 checks, under the same host/origin/cookie/CSRF hooks as other workspace routes (`apps/server/workspace-routes.ts:20–26`). Body limit 2 MiB (1 MiB UTF-8 text JSON-escaped can grow; server rechecks encoded byte length ≤ 1 MiB). Content is never executed or logged; no telemetry; no network calls.
- Accessibility: the editor has `aria-label="Edit <path>"`; toolbar buttons have accessible names; bars use `role="status"` (polite) except conflict/error which use `role="alert"`; all actions keyboard reachable; contrast follows DESIGN.md semantic colors; reduced motion honored (DESIGN §8.5).
- Third-party code: CodeMirror and Lezer packages are MIT (npm registry `license` field checked 2026-11-21: `codemirror` 6.0.2, `@codemirror/view` 6.43.15, `@codemirror/state` 6.7.6, `@codemirror/language` 6.13.1, `@codemirror/commands` 6.11.1, `@codemirror/search` 6.7.2, `@codemirror/language-data` 6.5.2, `@lezer/highlight` 1.2.5). Add entries to `THIRD_PARTY_NOTICES.md` (T07).

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | Location | Fact |
|---|---|---|
| Files surface entry | `apps/web/src/WorkspaceSurfaceBody.tsx:35–38,65–71` | `FilesBody({base,query,active,fallback})`; `GrantedFiles` when no project, else `ProjectFiles` with base `/api/projects/${encodeURIComponent(projectId)}` and optional `threadId`. |
| Project reader | `apps/web/src/files/ProjectFiles.tsx:19–40,41–85,87–104,147–188,195–211` | Local type `ProjectFile {text:string|null,binary:boolean,sha256:string}`; `readFolder`/`readFile` GET `base+'/files?'` and `base+'/file?'` with `authenticated`, `cache:'no-store'`, AbortSignal; text rendered literally in `<pre>` with optional `<mark>`; binary → "Binary file; no text preview."; SHA shown; Refresh/Retry reread. No edit/dirty/save. |
| Reusable view | `apps/web/src/files/FilesView.tsx:36–77,78–104,172–297,298–351` | `FilesEntry {name,path,kind,bytes?}`; props include preview body supplied by caller and navigation/refresh/retry callbacks; renders folder list and selected-file header + caller-owned preview body. TS/MD badges are labels only. |
| Read hook | `apps/web/src/files/useFilesRead.ts:4–9,12–79` | `FilesRead<T> {value,pending,error,errorCode}`; stale-key guard, abort, `refresh()`. No polling/subscription. |
| Granted files | `apps/web/src/files/GrantedFiles.tsx:73–95` | Separate `GrantedReader` (`getResourceTree/getResourceContent`); stays read-only. |
| Files CSS | `apps/web/src/files/files.css:193,390–393,406–410` | Preview font `12px / 1.65 var(--font-mono,monospace)`; selection tokens; container-query layout. |
| Read routes | `apps/server/workspace-routes.ts:20–26,69–70` | Identifier regex `[a-zA-Z0-9:_.-]{1,200}`; strict `querySchema {threadId?,path?(≤1024)}`; GET `/api/projects/:projectId/files` and `/file` → `ProjectTools.files/file`. |
| Project tools | `packages/workspace/tools.ts:24–28,70–77,200–205` | `pathName` (non-empty ≤1024, denies NUL, colon, leading slash/backslash, `..`); `gitSegment` denies `.git`; `binding()` checks thread ownership (denies side/delegate), workspace ownership, enrolled root, canonical realpath + dev/ino identity; `file()` confines realpath inside root, `withPathGuard([{path,leaf:true,readOnly:true}])`, `readBoundFile(target,1MiB)`, NUL → binary, else `toString('utf8')` (non-fatal decode), SHA over raw bytes. |
| Bounded read | `packages/core/file-access.ts:145–161` | `readBoundFile` opens once, requires regular single-link file, caps size (`RESOURCE_LIMIT`), detects growth. |
| Guarded replace | `packages/core/file-access.ts:108–119` | `replaceOwnedFile(source,destination,identity,sha256,signal,expectedDestinationHash?)`: path guard on both parent dirs, rereads destination and throws `PRECONDITION_FAILED` "File changed before guarded replacement" on hash mismatch, then guard RPC `replaceOwned` bound to identity and hash. Comment: an external atomic save can still replace the pathname. |
| Agent write path (template only) | `packages/capabilities/index.ts:61,116–120,156–181`; `packages/capabilities/schemas.ts:15,33` | Fatal UTF-8 decode; exact original SHA; same-directory random temp with `wx` and original mode, write, fsync, close, re-resolve, reread preimage, `preWrite`, `replaceOwnedFile`; temp cleanup on failure. Copy this write sequence into the manual save handler (or extract a shared helper, T03). |
| Containment | `packages/core/security.ts:27–30` | `inside(root,target)` via `relative`. |
| Checkpoints | `packages/workspace/checkpoints.ts:41–66,48,137,294,306–312,343` | Secret/size/binary exclusions; `StoredCheckpoint.provenance: {kind:"guarded_write"|"restore_backup"; operationId}`; `CheckpointService`; `createFromBytes({owner,files:[{path,data,identity?}],label?,provenance?,signal?})`. |
| Checkpoint contracts | `packages/contracts/workspace-checkpoints.ts:40–48` | `checkpointScopeSchema {projectId,threadId,workingCopyId,binding}`. DISCOVERY X3: whether provenance kind is also enumerated in a contract schema/reader (grep `restore_backup`). |
| Checkpoint routes/owner | `apps/server/workspace-routes.ts:78–125` | `checkpointOwner(projectId,threadId)` → `{root,owner:workspaceOwnerScope(...)}`; capability GET at `/checkpoints/capability` returns `{available,restore,owner}` — template for the new capability route; POST routes set `Cache-Control: no-store`, check `capabilityEnabled`, strict Zod bodies, `bodyLimit`. |
| Agent preimage capture | `packages/core/service.ts:2224,2263–2279` | Approved writes capture preimages via `createFromBytes`, gated on checkpoint/provenance flags; failures best effort. |
| Checkpoint UI | `apps/web/src/FileCheckpoints.tsx`; `apps/web/src/file-checkpoint-api.ts` | Lists checkpoints; must display the new `manual_edit` provenance (T05). |
| Flags | `packages/core/capability-flags.ts:55–60,93,127,133–137,199,202` | `M08_FLAG_KEYS`, `hostDefinitions` entries `{key,owner,description}`, `capabilityEnabled`, `registeredCapabilityFlags`, `__setCapabilityFlagForTests`; env override `HARNESS_FLAG_*` via `capabilityFlagEnvName`. |
| Keyboard | `apps/web/src/keyboard-bindings.ts:8–20,25–48,55–83`; `tests/keyboard-bindings.test.ts` | Single registry for handlers/settings/reference; no Mod+S binding today. |
| Appearance | `apps/web/src/useAppearance.ts:21,29,34`; `apps/web/src/settings-inventory.ts` (`code-font`, `word-wrap`, `panel-animations`) | `--code-font`, `--code-font-size`, `data-word-wrap` on the shell; motion preferences `motion`, `panelAnimations`. |
| Motion tokens | `packages/ui-shell/tokens.css:1–75`; `DESIGN.md:64–81` | `--ui-motion-hover 120ms`, `-press 80ms`, `-status 160ms`, `-success 240ms`, `-panel-enter 220ms`, `-panel-exit 180ms`, `-popup-enter 180ms`; `--ui-ease-enter cubic-bezier(.16,1,.3,1)`, `--ui-ease-move cubic-bezier(.4,0,.2,1)`; reduced: `:root[data-motion="reduced"|"off"]`, `.app-shell[data-panel-animations="false"]`, `prefers-reduced-motion`. |
| Visual rules | `DESIGN.md:7–9,19,44–58,99` | Black workspace, `#0F0F0F` task surfaces, `#1F1F1F` selected; semantic status colors with text; neutral focus; shared Popover/Select/ActionMenu/Modal only (no custom overlays). |
| Client journal | `apps/web/src/journal.ts` | Durable client drafts (composer, PR draft). DISCOVERY X4: exact API and size limits. |
| Event stream | `apps/web/src/api.ts:196–210` | SSE `/api/events?after=`; not used by Files (D5 polls). |
| Manifest | `scripts/public-source-files.json`; `CONTRIBUTING.md:40–49` | New source files must be listed (`source`, and `runtime` if packaged). |
| Tests | `tests/files-read-commit-owner.test.ts`, `tests/project-tools.test.ts`, `tests/file-checkpoints.test.ts`, `tests/checkpoint-restore-v3.test.ts`, `tests/keyboard-bindings.test.ts`, `tests/reduced-motion-coverage.test.ts`, `tests/ui-guard.test.ts`, `tests/ui-numeric-children.test.ts`; browser `tests/e2e/files-reading.spec.ts`, `files-reading-fixture.tsx`, `files-reading.vite.config.ts`, `files-reading.playwright.config.ts` (Chrome channel, port 5810, one worker) | Existing regression boundaries. |
| UI guards | `scripts/lint-ui.ts`, `scripts/ui-guard.ts`, `scripts/ui-overlay-legacy.json` | `pnpm lint`, `pnpm test:ui-guard`; new overlays must not be added to the legacy inventory. |
| Progress matrix | `docs/progress.md:13–37` | No manual editor milestone; M07/M08 related, flags off. |

**DISCOVERY items** (resolve in the named task, record findings in the issue checkpoint):
- X1 (T03): how `tests/project-tools.test.ts` and `files-read-commit-owner.test.ts` build a bound project on Linux; whether the path guard backend (`packages/core/file-access.ts:29–44`, `linux-path-guard.ts`) must be started in unit tests for `replaceOwnedFile`.
- X2 (T03): `replaceOwnedFile` identity argument is the *temp source* file identity (as in `packages/capabilities/index.ts:156–181`); confirm by reading that call site.
- X3 (T05): every reader/validator of `StoredCheckpoint.provenance.kind` (grep `restore_backup` across `packages`, `apps`, `tests`).
- X4 (T06): `apps/web/src/journal.ts` API (keys, quota, eviction) for editor drafts.
- X5 (T02): Gen project config files that must be protected (grep for files Gen writes into project roots, e.g. `.gen`, `.harness`).
- X6 (T02): how an archived/read-only thread is represented, so the capability route can return `available:false` for it.
- X7 (T07): Vite/Electron CSP: confirm dynamic `import()` chunks load under the desktop app's CSP (`apps/desktop/main.ts`) and in `scripts/build.mjs` output.

## DESIGN

### 1. Contracts (`packages/contracts/manual-edit.ts`, new)

```ts
import { z } from "zod";
export const MANUAL_EDIT_LIMITS = { bytes: 1024 * 1024, bodyLimit: 2 * 1024 * 1024 } as const;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const manualEditCapabilityV1 = z.strictObject({
  available: z.boolean(),
  checkpoints: z.boolean(),          // workspace.checkpointsV1 on and owner computable
  reason: z.enum(["flag_off", "no_project", "thread_kind", "archived"]).optional(),
});
export const manualEditFileStateV1 = z.strictObject({
  editable: z.boolean(),
  reason: z.enum(["binary", "not_utf8", "too_large", "protected", "not_regular"]).optional(),
  bom: z.boolean(),
  lineSeparator: z.enum(["lf", "crlf", "mixed"]),
});
export const manualEditSaveRequestV1 = z.strictObject({
  threadId: z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/).optional(),
  path: z.string().min(1).max(1024),
  text: z.string(),                   // already contains the chosen separators and BOM char if any
  expectedSha256: sha256,
});
export const manualEditSaveResponseV1 = z.strictObject({
  sha256,
  bytes: z.number().int().nonnegative(),
  checkpoint: z.enum(["captured", "excluded", "unavailable", "disabled"]),
  checkpointId: z.string().optional(),
});
```

Add the file to `scripts/public-source-files.json` and export it from the contracts index the same way sibling contract files are exported (follow `workspace-checkpoints.ts`).

### 2. Read response extension

`ProjectTools.file()` (`packages/workspace/tools.ts:204`) gains an additive field `edit: ManualEditFileStateV1` computed from the same bytes: `binary` → `{editable:false,reason:"binary"}`; `new TextDecoder("utf-8",{fatal:true}).decode(data)` throws → `not_utf8`; protected path (R04) → `protected`; else editable. `bom = data starts with EF BB BF`; `lineSeparator`: count `\r\n` vs lone `\n` → `crlf` if only CRLF, `lf` if only LF or none, `mixed` otherwise. The field is included only when `workspace.manualEditV1` is on (so the baseline response is byte-identical with the flag off; files-reading tests stay valid). Files over the cap already fail the read with `RESOURCE_LIMIT`; the client maps that to "too_large" for the disabled Edit reason.

### 3. Routes (`apps/server/workspace-routes.ts`)

- `GET /api/projects/:projectId/file/edit-capability?threadId=` → `manualEditCapabilityV1`. Flag off → `{available:false,checkpoints:false,reason:"flag_off"}`. Else `projects.binding(projectId,threadId)` (errors → `available:false` with mapped reason), `checkpoints = capabilityEnabled('workspace.checkpointsV1')`.
- `POST /api/projects/:projectId/file/save` with `{bodyLimit: MANUAL_EDIT_LIMITS.bodyLimit}`, `Cache-Control: no-store`, flag check → `CAPABILITY_DENIED` "Manual editing is disabled.", `manualEditSaveRequestV1.parse(body)`, then `projects.saveFile(projectId, threadId, path, text, expectedSha256)`; if checkpoints are on, pass a `preWrite(preimage)` callback that runs `checkpoints.createFromBytes({owner, files:[{path, data:preimage, identity}], label:"Manual edit: "+path, provenance:{kind:"manual_edit", operationId:"man-"+randomUUID()}})` inside try/catch (failure → `checkpoint:"unavailable"`; all files excluded → `"excluded"`).
- Both routes are registered inside `registerWorkspaceRoutes` so they inherit the host/origin/cookie/CSRF hooks (verify the client sends the CSRF header for this POST like checkpoint POSTs do in `file-checkpoint-api.ts:106–`).

### 4. `ProjectTools.saveFile` (`packages/workspace/tools.ts`, new method beside `file()`)

```
saveFile(projectId, threadId, relativePath, text, expectedSha256, preWrite?):
  {path:root} = await this.binding(projectId, threadId)            // same ownership as reads
  target = join(root, pathName.parse(relativePath)); resolved = await realpath(target)
  deny unless inside(root, resolved) && !gitSegment(relative(root,resolved)) && !gitSegment(relativePath) && !protectedPath(relativePath)
  data = Buffer.from(text, "utf8"); if data.length > 1 MiB -> RESOURCE_LIMIT
  if data.includes(0) -> CAPABILITY_DENIED "Text can't contain NUL characters."
  withPathGuard([{path:target, leaf:true}], signal, async () => {
    current = await readBoundFile(target, 1 MiB)                     // regular, single-link
    if sha256(current) !== expectedSha256 -> HarnessError('PRECONDITION_FAILED', 'File changed on disk.', {sha256: sha256(current)})
    stat = lstat(target); temp = join(dirname(target), '.' + basename(target) + '.gen-' + randomHex(8) + '.tmp')
    write temp with flag 'wx', mode = stat.mode & 0o777; fsync; close; tempId = lstat(temp,{bigint:true})
    await preWrite?.(current, {dev, ino})                            // best-effort checkpoint (caller catches)
    await replaceOwnedFile(temp, target, tempId, sha256(data), signal, expectedSha256)
  }) finally remove temp if it still exists (use removeOwnedFile with the temp identity)
  return { sha256: sha256(data), bytes: data.length }
```

Follow the exact sequence and guard nesting of `executeDomainOperation` (`packages/capabilities/index.ts:156–181`); if extracting a shared helper is cleaner, do it in T03 without changing the agent path's behavior (its tests must stay green). Windows: the temp name stays in the same directory so the rename is same-volume.

### 5. Client text model

- Load: `text` from the read; if `edit.bom`, strip the leading U+FEFF for display and remember `bom=true`.
- CodeMirror: `EditorState.lineSeparator.of(edit.lineSeparator === "crlf" ? "\r\n" : "\n")` so `state.doc.toString()` re-joins lines with the original separator. For `mixed`, use `"\n"` as separator facet **unset** behavior is wrong (CodeMirror splits on all separators and joins with `\n`), so for `mixed` files the editor opens with a non-blocking notice "This file mixes line endings; saving will use LF." (DECIDED: normalizing is acceptable and disclosed).
- Save text = (`bom` ? "\uFEFF" : "") + `state.doc.toString()`.
- Dirty = `state.doc.toString() !== loadedText` evaluated on doc change (cheap enough up to 1 MiB; optimize with `doc.eq` against the loaded `Text` instance).

### 6. Client components (`apps/web/src/files/`)

- `manual-edit-api.ts` (new): `editCapability(base, threadId)`, `saveFile(base, payload)` using the same authenticated + CSRF POST helper checkpoint POSTs use; parses responses with the contracts; maps `ApiError.code`.
- `CodeEditor.tsx` (new, default export, only imported via `React.lazy(() => import('./CodeEditor'))`): props `{path, initialText, lineSeparator, readOnly, onChange(dirty), onSave(), editorRef}`; builds extensions: `lineNumbers()`, `highlightActiveLine()`, `history()`, `drawSelection()`, `indentOnInput()`, `bracketMatching()`, `highlightSelectionMatches()`, `search({top:true})`, `keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab])`, the Gen theme (§8.3), `EditorView.lineWrapping` when `data-word-wrap="true"`, and the language from `LanguageDescription.matchFilename(languages, path)` loaded asynchronously into a `Compartment`.
- `CompareView.tsx` (new, lazy): `MergeView` from `@codemirror/merge`, both sides read-only, left "On disk", right "Your changes", Gen theme.
- `ProjectFileEditor.tsx` (new): owns edit state machine (§7), toolbar, bars, polling, journal; renders `CodeEditor` inside the existing preview body slot of `FilesView`.
- `ProjectFiles.tsx` (edit): fetch capability once per base/thread; pass Edit button + editor into the preview body when available; route file/folder switches through the unsaved-changes guard; show dirty marker on the selected row.
- `FilesView.tsx` (edit, minimal): accept an optional `headerActions` node and `dirtyPath` to show the dirty marker; no behavior change when absent.
- Unsaved dialog uses the shared Modal from `packages/ui-shell` (DESIGN.md:44–58); no custom overlay.

### 7. Edit state machine (client)

```
viewing --Edit--> loading_editor --chunk ready--> editing(clean)
editing(clean) --type--> editing(dirty) --undo to loaded--> editing(clean)
editing(dirty) --Save--> saving --200--> editing(clean, new sha)
saving --PRECONDITION_FAILED--> conflict(dirty)
saving --other error--> editing(dirty, error bar)
editing(*) --poll sha changed--> clean: reload silently | dirty: conflict(dirty)
conflict --Reload--> editing(clean, disk text) | --Overwrite--> saving (expected = disk sha) | --Compare--> conflict + CompareView
editing(*) --poll 404/denied--> unavailable (save disabled; Keep editing / Close)
editing(clean) --Done/Escape--> viewing ; editing(dirty) --Done/switch/close--> confirm dialog
```

Polling uses the existing GET `/file` (abortable, `cache:'no-store'`), interval 5,000 ms, paused when `active` is false, `document.visibilityState !== 'visible'`, a save is in flight, or a conflict is already shown; also fires on `window` `focus`.

### 8. Visual design and motion (normative; no separate design team)

**8.1 Layout.** In edit mode the preview header (from `FilesView.tsx:298–351`) keeps the file name and path on the left and shows a toolbar on the right, height `--ui-row-compact` (32px), gap `--ui-space-2`: [dirty dot + "Edited" text when dirty] [Compare, only in conflict] [Save (primary)] [Done (secondary)]. In view mode the toolbar shows a single secondary **Edit** button with a pencil icon (`lucide-react` `Pencil`, 14px). Bars (restore/conflict/error/unavailable) sit between header and editor, full width, padding `--ui-space-2` `--ui-space-3`, text 12px, actions right-aligned as compact buttons. The editor fills the remaining preview area; no extra border inside the pane; the pane's existing container-query layout (`files.css:406–410`) still applies — below the narrow container breakpoint the toolbar collapses Compare/Done into an ActionMenu ("More") and keeps Save visible.

**8.2 Colors (use existing tokens; dark values first, light in parentheses).** Editor background = task surface `#0F0F0F` (light: the existing light task-surface token); gutter background same as editor, gutter text `var(--muted)`, active line background `#1F1F1F` at 60% (light: selected-surface token at 60%), active line gutter number `var(--text)` (DISCOVERY: exact text token name in `files.css`), selection = existing selection tokens (`files.css:390–393`), cursor `var(--text)` 2px wide, matching-bracket outline 1px `var(--muted)`, search match background semantic warning color at 25%, current match 45%. Dirty dot: 6px circle in the accent color (`appearanceAccent`) with "Edited" text in `var(--muted)`; conflict bar: semantic warning background at 12% with warning text color and a warning icon; error bar: semantic danger at 12%; restore/info bar: neutral `#1F1F1F`. Status color is always paired with text (DESIGN.md rule). Focus ring: `--ui-focus-ring`, 2px, offset 2px on buttons; the editor shows focus with a 1px inset outline in `--ui-focus-ring`.

**8.3 Syntax theme.** A `HighlightStyle` built from Lezer tags mapped to CSS custom properties defined once in `files.css` under `.gen-code-editor` (dark / `[data-theme=light]` overrides):

| Tag(s) | Dark | Light |
|---|---|---|
| keyword, controlKeyword, modifier | `#C586C0` | `#AF00DB` |
| string, special(string) | `#CE9178` | `#A31515` |
| number, bool, null | `#B5CEA8` | `#098658` |
| comment, lineComment, blockComment | `#7F848E` italic | `#6A737D` italic |
| function(variableName), function(propertyName) | `#DCDCAA` | `#795E26` |
| typeName, className, namespace | `#4EC9B0` | `#267F99` |
| propertyName, attributeName | `#9CDCFE` | `#0451A5` |
| variableName, definition(variableName) | `#D4D4D4` | `#1F2328` |
| tagName, heading | `#569CD6` bold for heading | `#800000` / bold |
| operator, punctuation | `#D4D4D4` | `#1F2328` |
| link, url | `#4FC1FF` underline | `#0066BF` underline |
| invalid | danger color | danger color |

These meet ≥ 4.5:1 contrast on `#0F0F0F` and on white respectively (T08 verifies with the existing contrast tooling if present, otherwise a unit test computing WCAG contrast for each pair). Font: `var(--code-font)` at `var(--code-font-size)`, line-height 1.65 (matches the preview, `files.css:193`), so entering edit mode does not shift text.

**8.4 Motion (tokens only).**
- Enter edit mode: the read-only `<pre>` is replaced by the editor with a crossfade of opacity 0→1 over `--ui-motion-tab` (140ms) `--ui-ease-move`; no spatial movement because the text stays in place (same font/line-height). While the chunk loads (> 150 ms only), show the existing pending treatment of the Files preview, no spinner flash under 150 ms.
- Toolbar swap (Edit ↔ Save/Done): opacity crossfade `--ui-motion-hover` (120ms).
- Dirty dot appears: scale .6→1 + opacity over `--ui-motion-status` (160ms) `--ui-ease-enter`; disappears with opacity only, `--ui-motion-press` (80ms).
- Save: button shows an inline 12px spinner only if the request exceeds 200 ms; on success the button label changes to a check + "Saved" for 1,200 ms using `--ui-motion-success` (240ms) opacity, then returns to "Save" (disabled while clean). Never delay the save itself.
- Bars: insert with height 0→auto (use `grid-template-rows: 0fr→1fr`) + opacity over `--ui-motion-insert` (180ms) `--ui-ease-enter`; remove over `--ui-motion-remove` (140ms) `--ui-ease-move`. The conflict bar does **not** shake or pulse.
- Compare view: opens in the preview area with `--ui-motion-panel-enter` (220ms) opacity + 8px translateY; closes with `--ui-motion-panel-exit` (180ms).
- Unsaved dialog: shared Modal motion as-is.
- No idle, looping or attention animation anywhere; the 5 s poll is invisible unless something changes.

**8.5 Reduced motion.** Under `:root[data-motion="reduced"|"off"]`, `.app-shell[data-panel-animations="false"]` or `prefers-reduced-motion: reduce`: no transforms (scale/translate), no grid-row height animation (bars appear instantly), only opacity fades ≤ 80ms (`--ui-motion-press`); `data-motion="off"` disables all of them. Add the new selectors to whatever `tests/reduced-motion-coverage.test.ts` inspects (T08).

**8.6 Copy.** Button labels: Edit, Save, Saved, Done, Compare, Reload, Overwrite, Keep editing, Close, Keep, Discard, Retry. Bar and dialog texts exactly as in R11–R13, R19. Sentence case, no exclamation marks.

### 9. Error/cancel/retry

Save requests carry an AbortSignal tied to the editor lifetime; unmount aborts in-flight polls but **not** an in-flight save (the save completes; the result is applied if the same file is still open, else only the journal entry is cleared). Retries are user-initiated only (Retry button); the server is idempotent per (path, expectedSha256, text) because a repeated save after success fails with `PRECONDITION_FAILED` and the client treats a conflict whose disk SHA equals the SHA of its own text as success.

### 10. Migration/rollback

Additive only: new flag (default off), new routes, new optional read field behind the flag, new provenance enum value. Rollback = flag off. Old checkpoint readers must tolerate `manual_edit` (X3); if any strict reader exists, update it in the same PR (CONTRIBUTING: same-PR schema readers/writers).

## EXECUTION_DAG

| ID | Goal | Depends on | Owner boundary |
|---|---|---|---|
| T01 | Flag + contracts | — | `packages/core/capability-flags.ts`, `packages/contracts/manual-edit.ts`, contracts index, manifest |
| T02 | Read extension + capability route + protected-path predicate | T01 | `packages/workspace/tools.ts` (`file()` only + predicate), `apps/server/workspace-routes.ts` (capability GET) |
| T03 | `saveFile` + save route | T01, T02 | `packages/workspace/tools.ts` (`saveFile`), `apps/server/workspace-routes.ts` (save POST), optional shared helper in `packages/core/file-access.ts` |
| T04 | Unit tests for T02/T03 | T03 | `tests/manual-edit-*.test.ts` |
| T05 | Checkpoint provenance `manual_edit` | T01 | `packages/workspace/checkpoints.ts`, readers found by X3, `FileCheckpoints.tsx` label |
| T06 | Client API, state machine, editor integration | T01 (contracts), T07 (deps) | `apps/web/src/files/*` |
| T07 | Dependencies, code-split, notices | — | `package.json`, `pnpm-lock.yaml`, `THIRD_PARTY_NOTICES.md`, build config |
| T08 | Visual design and motion | T06 | `apps/web/src/files/files.css`, editor theme module, reduced-motion coverage |
| T09 | Browser tests + evidence | T06, T08 | `tests/e2e/files-editing.*` |
| T10 | Front end team review handoff | T04, T05, T09 | issue comment + PR |

### T01 Flag and contracts
- Add `"workspace.manualEditV1"` to `M08_FLAG_KEYS` (`capability-flags.ts:55–60`) and a `hostDefinitions` entry `{ key: "workspace.manualEditV1", owner: "m08", description: "User-initiated text file edits from the Files surface with SHA precondition and guarded atomic save." }`.
- Create `packages/contracts/manual-edit.ts` exactly as DESIGN §1; export it; add to `scripts/public-source-files.json` (`source`, and `runtime` if contracts are packaged — mirror `workspace-checkpoints.ts`'s entry).
- Tests: flag registry test (find the existing test asserting registered keys, e.g. grep `workspace.restoreV1` in `tests/`) updated; schema parse positive/negative (bad SHA, extra key, path > 1024).
- Done when: `pnpm typecheck` passes and flag default is false in `registeredCapabilityFlags()`.

### T02 Read extension and capability
- Implement `protectedPath(relativePath)` reusing the checkpoint exclusion predicate (export it from `checkpoints.ts` if private) plus `.harness-directory-guard` and X5 results.
- Extend `file()` per DESIGN §2, behind `capabilityEnabled('workspace.manualEditV1')`.
- Add the capability GET per DESIGN §3; resolve X6.
- Tests (T04 file): flag off → response has no `edit` key (deep-equal baseline shape); binary, invalid UTF-8 (`Buffer.from([0xC3,0x28])`), BOM, CRLF, LF, mixed, protected `.env` → expected `edit` values; capability for side/delegate thread → `available:false`.
- Done when: those tests pass and `tests/files-read-commit-owner.test.ts` + `tests/project-tools.test.ts` stay green.

### T03 Save
- Implement `saveFile` (DESIGN §4) and the POST route (DESIGN §3); resolve X1, X2.
- Positive tests: LF/CRLF/BOM round trip byte-equal; mode preserved (POSIX); returns new SHA; checkpoint `captured` with flag on and preimage equals old bytes; `disabled` with checkpoints off.
- Negative tests: flag off → `CAPABILITY_DENIED`; wrong SHA → `PRECONDITION_FAILED` with `details.sha256` = disk SHA and file unchanged; path `../x`, `.git/config`, absolute, NUL in path, symlink target, hard-linked file, directory → denied and nothing written; text > 1 MiB encoded → `RESOURCE_LIMIT`; NUL in text → denied; side thread → denied; no leftover `.gen-*.tmp` after each failure; checkpoint capture throwing → save still succeeds with `unavailable`.
- Done when: all pass on Linux; Windows run recorded as pending real-user check if not available.

### T04 Unit test file
- Create `tests/manual-edit-host.test.ts` (T02/T03 cases) following the fixture setup of `tests/project-tools.test.ts`; add to manifest if tests are listed there.
- Done when: `pnpm exec vitest run tests/manual-edit-host.test.ts --maxWorkers=1` passes.

### T05 Checkpoint provenance
- Extend `StoredCheckpoint.provenance.kind` with `"manual_edit"`; update every reader found by X3; `FileCheckpoints.tsx` shows label "Manual edit" for that kind (same row style as others).
- Tests: `tests/file-checkpoints.test.ts` gains a case listing a `manual_edit` checkpoint; restore of a manual-edit checkpoint works via the existing restore tests' path.
- Done when: checkpoint suites pass.

### T06 Client
- `manual-edit-api.ts`, `ProjectFileEditor.tsx`, `CodeEditor.tsx` (lazy), `CompareView.tsx` (lazy), edits to `ProjectFiles.tsx` and `FilesView.tsx` per DESIGN §5–7; keyboard entries per R15 in `keyboard-bindings.ts`; journal drafts per R13 (X4); `beforeunload` while any editor is dirty.
- Unit tests (vitest + existing React test setup, find via `tests/*.test.tsx`): state machine transitions (pure reducer exported for testing), line separator/BOM save text, dirty via `doc.eq`, keyboard registry test updated.
- Done when: unit tests pass, `pnpm typecheck`, `pnpm lint`.

### T07 Dependencies and bundling
- Add pinned exact versions (repo pins exact versions in `package.json`): `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/language-data`, `@codemirror/merge`, `@lezer/highlight` (use current latest at implementation; versions above were current on 2026-11-21). Do not add the `codemirror` meta package.
- Update `THIRD_PARTY_NOTICES.md` with MIT notices for each (and transitive `@lezer/*`, `style-mod`, `w3c-keyname`, `crelt` — list exactly what `pnpm why`/lockfile shows).
- Verify code split: after `pnpm build`, the entry chunk contains no `@codemirror` code (grep built entry JS for `EditorView`), and a separate chunk exists; resolve X7 for desktop CSP.
- Done when: build passes and the grep check is recorded.

### T08 Visual design and motion
- Implement DESIGN §8 in `files.css` (scoped `.gen-code-editor`, `.files-edit-toolbar`, `.files-edit-bar`) and a `code-editor-theme.ts` (CodeMirror `EditorView.theme` + `HighlightStyle` reading the CSS variables).
- Contrast unit test for §8.3 table; reduced-motion coverage updated; `pnpm lint:ui`/`pnpm test:ui-guard` pass with no additions to `scripts/ui-overlay-legacy.json`.
- Capture screenshots: dark + light, view mode, editing dirty, conflict bar, compare view, narrow container — via `pnpm capture:ui` if it supports the Files fixture, else Playwright screenshots in T09.
- Done when: screenshots attached to the issue checkpoint.

### T09 Browser tests
- New `tests/e2e/files-editing.spec.ts` reusing `files-reading-fixture.tsx`/vite/playwright config patterns (new config `files-editing.playwright.config.ts` or add the spec to the existing config's `testMatch`; prefer adding to the existing config). Route-mock `/file`, `/file/edit-capability`, `/file/save`.
- Cases: flow 1 keyboard-only (Tab to Edit, `E`, type, Ctrl+S, "Saved" announced); Mod+S outside editor does not call save; conflict flow with Compare/Overwrite/Reload; poll-detected change clean vs dirty; switch-file dialog Save/Don't save/Cancel; journal restore after reload; disabled Edit reasons; flag off shows no Edit and makes no capability-dependent save calls; reduced motion (`page.emulateMedia({reducedMotion:'reduce'})`) has no transform animations on bars; chunk loads only after Edit (assert no `@codemirror` request before click).
- Real-user check (pending, not CI): Windows desktop build with flag `HARNESS_FLAG_*` for `workspace.manualEditV1` on, edit a CRLF file in a real project, verify bytes with `certutil -hashfile` against the returned SHA.
- Done when: spec passes in CI config and a screen recording of flows 1–3 is attached.

### T10 Front end team review (owner requirement)
- After T01–T09 are VERIFIED and the PR is ready for review, post a HANDOFF checkpoint on this issue addressed to Leonardo's front end team: PR link, commit SHA, screenshots and recording from T08/T09, and the DESIGN §8 spec; request their review of the visual design and motion. Apply their requested changes (update this plan's revision if they change decisions). The issue is not complete until the front end team has reviewed.
- Done when: the front end team review is recorded on the PR/issue and requested changes are resolved.

## VALIDATION

**Setup.** Node ≥ 24.10.0, pnpm 10.30.3 (`package.json`), `pnpm install`; Chrome installed for the files fixture channel (`CONTRIBUTING.md:78–87`).

**Commands (planned; none executed while planning).**

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm exec vitest run tests/manual-edit-host.test.ts tests/files-read-commit-owner.test.ts tests/project-tools.test.ts tests/file-checkpoints.test.ts tests/checkpoint-restore-v3.test.ts tests/keyboard-bindings.test.ts tests/reduced-motion-coverage.test.ts --maxWorkers=1
pnpm test:ui-guard
pnpm exec playwright test --config tests/e2e/files-reading.playwright.config.ts
pnpm test --maxWorkers=1
pnpm check:docs-links
```

**Acceptance matrix.**

| Req | Task(s) | Check |
|---|---|---|
| R01 | T06, T09 | Edit appears only in project Files preview (browser) |
| R02 | T06, T09 | Granted files show no Edit (browser) |
| R03 | T02, T09 | `edit` reasons unit + disabled tooltip browser |
| R04 | T02, T03 | `.env`, `.git/*` denied (unit) |
| R05 | T03 | symlink/hardlink/directory/new path denied (unit) |
| R06 | T06, T09 | search panel, undo, Tab/Escape-Tab (browser) |
| R07 | T06, T09 | `.ts`, `.py`, `.md` get highlighting tokens; `.xyz` plain (browser) |
| R08 | T06 | reducer + browser dirty marker |
| R09 | T03, T06, T09 | save round trip (unit + browser) |
| R10 | T03, T06 | byte-equal CRLF/LF/BOM (unit) |
| R11 | T03, T06, T09 | PRECONDITION_FAILED unit; conflict bar/Compare/Overwrite browser |
| R12 | T06, T09 | poll clean reload vs dirty conflict (browser, fake timers) |
| R13 | T06, T09 | dialog + journal restore (browser) |
| R14 | T06, T09 | Done/Escape (browser) |
| R15 | T06, T09 | keyboard registry test + Mod+S scope browser |
| R16 | T03, T05 | captured/disabled/unavailable (unit) |
| R17 | T01, T02, T03, T09 | flag-off unit + browser |
| R18 | T02, T03 | side/delegate denied (unit) |
| R19 | T06, T09 | each error message (browser mocks) |
| R20 | T07, T09 | chunk split grep; 1 MiB open timing (browser, `performance.now`) |
| Visual §8 | T08, T10 | screenshots, contrast test, reduced-motion test, front end team review |

**Regressions.** files-reading spec unchanged with flag off; checkpoint and restore suites; keyboard-bindings; UI guard; agent `file_replace_prepare` tests if a shared helper is extracted.

**Evidence.** Unit/browser output pasted into the issue checkpoints; screenshots and one recording (flows 1–3) attached; Windows real-user check recorded separately as PASS/NOT_RUN.

**Release gate.** All rows pass in CI, Windows CRLF real-user check done, front end team review (T10) resolved; flag stays default false until the owner enables it.

## STATE

| Item | State |
|---|---|
| Research and design | DONE (this plan r1) |
| Implementation T01–T10 | NOT_STARTED; no owner, no branch |
| Verification | NOT_RUN |
| Risks | Path-guard behavior in unit tests (X1); CodeMirror line separator handling for mixed files (disclosed normalization, DESIGN §5); desktop CSP for lazy chunks (X7); concurrent agent writes between hash check and rename (mitigated by `replaceOwnedFile` identity/hash checks; external atomic saves can still race, documented at `file-access.ts:108–119`) |
| Next step | An implementing agent claims the issue per AGENTS.md and starts T01 and T07 in parallel |

## REFERENCES

- Batch 3 proposal, item 6 (approved 2026-11-21): "Open a project file in an editor pane with syntax highlighting and save, so small fixes don't need an agent turn … `apps/web/src/files` is read-only today and the repo has no code editor (no CodeMirror or Monaco)."
- Claude Code Desktop file pane: https://code.claude.com/docs/en/desktop ("Open and edit files": local sessions can edit files in the working directory except view-only config files; Auto save on by default; Save/Cancel when off; on-disk change warning with Override/Discard).
- Codex requests: https://github.com/openai/codex/issues/19636, https://github.com/openai/codex/issues/28644.
- CodeMirror 6 docs: https://codemirror.net/docs/ (EditorState.lineSeparator, indentWithTab focus escape, @codemirror/language-data, @codemirror/merge).
- Repo: `AGENTS.md` (plan, checkpoint and handoff contract), `CONTRIBUTING.md`, `DESIGN.md`, `docs/progress.md`.
