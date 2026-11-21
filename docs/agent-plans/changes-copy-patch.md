# Plan: Copy or save changes as a patch

## META
- Feature: "Copy patch" and "Save .patch…" on the workspace Changes panel, for the whole current diff or for one file, producing a patch that `git apply` accepts.
- Repo: skytuhua-org/Gen-V1
- Plan revision: r1, 2026-11-21 (UTC)
- Baseline: `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da` (verified with `git log -1` after `git fetch origin main`).
- Size: small. Labels: `feature`, `small`.
- Existing issues/PRs: no matching issue (searched all issues for "patch", "copy diff", "save diff" on 2026-11-21). Related but distinct: #1288 Comment on the diff (review comments, no export), #1582 word-level diff highlight (rendering only), #1235 / `docs/agent-plans/thread-publish-pr.md` (commit/push/PR, no patch export), #1471 Copy a project-relative file reference (path only).
- Implementation status: NOT_STARTED. Planning only; this issue does not implement anything.
- Source provenance: repository reading at the baseline SHA (file:line references below) and the competitor reports listed in REFERENCES.
- Design and animation: there is no separate front-end design team for this feature. This plan specifies the visual design and animation itself (DESIGN §D6–D7). The last task (T07) hands the finished work to the front end team for review.

## OBJECTIVE
**User problem.** The Changes panel (`live-review` in `apps/web/src/WorkspaceSurfaceBody.tsx`) shows the thread's unified diff as raw text in `<pre className="live-diff">` with no copy or save action. To move an agent's changes to another checkout, attach them to a bug, send them to a colleague or keep a backup before discarding, a user must select text by hand (unreliable for long diffs) or open a terminal and run `git diff` in the private managed working copy, which most users cannot locate. Codex users asked for exactly this ("Copy patch", openai/codex#26758) and report review/undo gaps when they cannot take a diff out (openai/codex#10503).

**Intended behavior.** The Changes toolbar gets two buttons, "Copy patch" and "Save .patch…". Each file row gets the same two actions as compact icon buttons. The patch matches the view the user is looking at (the existing Staged checkbox): unstaged view = working tree vs index, staged view = index vs HEAD. The output is text that `git apply` (and `git apply --check`) accepts on a checkout at the same HEAD. Binary files are never silently dropped: they are listed as skipped. Line endings (CRLF) and "No newline at end of file" markers are preserved byte-exact. On desktop "Save .patch…" opens the native save dialog; in a browser it downloads a file.

**Measurable success.**
- Copying the whole diff takes 1 click (today: manual selection or a terminal).
- For every fixture in VALIDATION (modified, added untracked text, deleted, renamed, CRLF, no trailing newline, non-ASCII UTF-8 path and content, executable bit), `git apply --check` of the copied text and of the saved file succeeds on a clean clone at the same HEAD, and after `git apply` the working tree equals the source tree for every included file.
- Saved file bytes equal the server patch bytes (sha256 match) in browser and desktop.
- No regression in the existing Changes panel tests (`tests/e2e/redundant-ui.spec.ts`, `tests/e2e/wo5-app-integration.spec.ts`, `tests/project-tools.test.ts`).

## REQUIREMENTS

### In scope
- R1 Toolbar actions: "Copy patch" and "Save .patch…" in the Changes toolbar, acting on the whole diff of the current view (Staged checkbox state).
- R2 Per-file actions: each row of `live-change-list` gets icon buttons "Copy patch for <path>" and "Save patch for <path>" producing the patch for that one file (both paths for a rename) in the current view.
- R3 View fidelity: unstaged view = `git diff` (index → worktree) plus untracked text files (managed mode only, where the status already lists them); staged view = `git diff --cached HEAD` (HEAD → index). Untracked files are never part of the staged view. In legacy mode untracked files are not listed and not included (current tracked-only behavior, `WorkspaceSurfaceBody.tsx:43–44`).
- R4 `git apply` compatibility: every patch uses `diff --git` headers with `--full-index`, `--no-color`, `--no-ext-diff`, `--no-textconv`, `--find-renames`; new untracked files get a synthesized `diff --git` header with `new file mode` and an `index 0000000…000..<blob-sha>` line so `git apply` and `git apply --index` both accept them.
- R5 Binary files: not encoded (no `--binary` in v1). They are excluded from the patch and reported in a `skipped` list with reason `binary`. A whole-diff action whose view contains only binary files is disabled with the title "Only binary files changed; they cannot be copied as a patch".
- R6 Byte exactness: the server returns the exact Git output bytes (base64 in JSON), not a UTF-8-decoded string. Saving writes those bytes unchanged. CRLF, lone CR, trailing-newline markers and file content are preserved. Text whose bytes are not valid UTF-8 can still be saved; for copy (clipboard holds text only) such files are skipped with reason `not-utf8` and listed.
- R7 Size bound: the existing 4 MiB Git output bound (`packages/workspace/git-storage.ts`, `RESOURCE_LIMIT` "Git output exceeds the 4 MiB review limit.") applies. Over the limit the action fails with the message "This patch is larger than 4 MiB. Use git diff in a terminal for changes this large." No partial patch is ever produced.
- R8 Freshness: the request carries the `revision` from the status the user is looking at. If the working copy changed since (`revision` mismatch), the server refuses with code `STALE_REVISION`; the client reloads the panel and shows "Changes were updated. Review them and try again." Nothing is copied or saved from a different state than the one displayed.
- R9 Empty view: both toolbar buttons are disabled when the current view has no changes (title "No changes in this view"). A per-file button is disabled when that file has no changes in the current view (title "No staged changes for this file" / "No unstaged changes for this file").
- R10 Desktop save: a new narrow desktop bridge method `savePatch` opens the native save dialog with title "Save patch", default name from R11, filters Patch (`*.patch`, `*.diff`) and All files, and overwrite confirmation. It follows the same owned, one-use, guarded download policy as project memory export (`apps/desktop/memory-export.ts`). Cancel is silent.
- R11 File names: whole diff `<project-name>-<branch-or-short-head>-<staged|unstaged>.patch`; one file `<file-basename>.patch`. Characters outside `[A-Za-z0-9._-]` become `-`, runs of `-` collapse, max 120 characters before `.patch`, empty → `changes.patch`. Branch empty (detached) → first 10 chars of HEAD.
- R12 Browser save: Blob download with MIME `text/x-diff`, `link.download` = R11 name, object URL revoked after the click (pattern from `apps/web/src/project-memory-api.ts:89–110`).
- R13 Feedback: success of copy shows the existing CopyButton feedback (icon becomes a check for 1600 ms, "Copied" in a live region). Success of save shows a success toast "Saved <filename>" (desktop only, when the bridge returns saved; browser downloads give no completion signal and show no toast). If anything was skipped, an info toast lists up to 3 paths with reasons and "+N more" (e.g. "Skipped 2 files: logo.png (binary), data.bin (binary)").
- R14 Errors: clipboard failure → error toast "Copy failed. Use Save .patch… instead." with an action button "Save .patch…" that runs the save for the same scope. Server/IPC errors → error toast with the server message (R7/R8 texts above, otherwise "Could not create the patch.").
- R15 Accessibility: all buttons are native `<button type="button">` with visible text (toolbar) or `aria-label` (row icons), reachable by Tab in DOM order, focus ring visible, row icon buttons visible whenever the row is hovered, has focus-within, or the device has no hover (`@media (hover: none)`); never `display:none` while focused. Busy state sets `aria-busy="true"` and `disabled`.
- R16 Security: the new endpoint uses the same project/thread binding, managed/legacy boundary and path validation as `GET /api/projects/:projectId/git` (`tools.ts:156`, `withGitOperation`) and per-file paths use `:(literal)` pathspecs. Untracked file reads use the same bound-read path guard as the status digest (`untrackedDigest`) and comparison file reads (`code-review.ts:258–262`). The endpoint is read-only: no index, worktree or ref change.
- R17 Privacy: patches are produced only on explicit click and never logged, persisted, sent to the model or included in diagnostics.

### Out of scope (v1)
- Binary patches (`git diff --binary`), hunk-level or line-level export, `git format-patch` with commit metadata, applying/importing patches, exporting recorded per-turn diffs or thread export, sharing to a URL or GitHub gist, keyboard shortcuts for these actions, a context-menu entry.

### Agreed decisions (this plan)
- D-a Base64 byte transport instead of a JSON string (R6), because `runProcess` decodes stdout as UTF-8 (`packages/capabilities/process.ts`, `stream.setEncoding('utf8')`) and would replace invalid bytes.
- D-b A new dedicated endpoint instead of reusing `value.diff`/`stagedDiff` from the status response: status diffs lack `--find-renames`, untracked patches and byte exactness, and changing their flags would change the review `revision` hash for every client.
- D-c A new desktop method instead of reusing `exportProjectMemory`, which is JSON-specific (filters, filename and payload validation).
- D-d Untracked files are synthesized server-side (not via `git add -N` or `git diff --no-index`) so the endpoint stays read-only and does not depend on nonzero exit handling.

## REPO_MAP (verified at baseline unless marked DISCOVERY)
| Area | Location | Fact |
|---|---|---|
| Changes UI | `apps/web/src/WorkspaceSurfaceBody.tsx:39–45` (`DiffBody`), `:46–51` (`ChangesBody`) | `useProjectRequest<GitStatus>(base+'/git?'+query,active)`; `staged` state from a checkbox, default false; toolbar `<div className="panel-toolbar"><strong>Changes</strong><span>{value?.branch}</span><button>Refresh</button><label><input type="checkbox"/>Staged</label></div>`; file list `ul.live-change-list` with per-row Stage/Unstage (`disabled={pending||value.gitWrite!==true}`); diff in `<pre className="live-diff" aria-label={staged?'Staged diff':'Unstaged diff'}>`; revision line `small.review-revision`. |
| Status types | `packages/workspace/tools.ts:20–21` | `GitFile{path,oldPath?,index,worktree,staged,untracked,binary,added,removed}`; `GitStatus{head,branch,revision,files,diff,stagedDiff,truncated,mode?,gitWrite?,untrackedIncluded?}`. |
| Status implementation | `packages/workspace/tools.ts:142–156` | Runs `rev-parse HEAD`, `branch --show-current`, `status --porcelain=v1 -z`, `diff --full-index --no-ext-diff --no-textconv` (and `--cached`), `diff --numstat -z … HEAD`; `revision = hash(JSON.stringify([head,branch,raw,diff,stagedDiff,untracked]))`; `gitStatus(projectId,threadId)` wraps in `exclusive` + `withGitOperation`. |
| Git runner | `packages/workspace/git-storage.ts:28–33` (`nativeGit`) | Fixed safety prefix (`--no-pager`, hooks off, `diff.external=` etc.), `runProcess(...,120000,environment,4*1024*1024)`; truncated → `RESOURCE_LIMIT`; nonzero → `GIT_ERROR`; returns `result.stdout` string. |
| Process capture | `packages/capabilities/process.ts` (`runProcess`, `capture`) | `stream.setEncoding('utf8')`; output limit counted in UTF-8 bytes; no raw Buffer mode today. |
| Git routes | `apps/server/workspace-routes.ts:47` (`/git`), `:49–57` (`/git/comparison`, `/git/comparison/file`) | zod `identifier` params and `querySchema` with optional `threadId`; comparison routes set no-store. |
| Untracked patch precedent | `packages/workspace/code-review.ts:231–240` | Synthesizes `--- /dev/null` / `+++ "b/<name>"` hunks for untracked text, with "\ No newline at end of file". It lacks a `diff --git` header and mode line; T01 must not reuse it verbatim (see D3). |
| Comparison limits | `packages/contracts/code-review.ts:4–9` | `CODE_REVIEW_LIMITS` patchBytes 256 KiB (comparison only; not used by this feature). |
| Copy UI | `apps/web/src/CopyButton.tsx:1–26` | `CopyButton({text,label})`, `navigator.clipboard.writeText`, Copied for 1600 ms, generation fence, error toast "Copy failed. Select the text and copy manually."; lucide `Copy`/`Check` size 14; classes `icon-button copy-button`; synchronous `text` prop only. |
| Toast | `packages/ui-shell/Toast.tsx:6–22` | `toast(message,{tone:'info'|'success'|'error',action?,durationMs?})`, default 6000 ms, max 3 visible. |
| Browser download precedent | `apps/web/src/project-memory-api.ts:89–110`, `apps/web/src/DraftTransfer.tsx:12` | Blob + anchor `download` + revoke. |
| Desktop export precedent | `apps/desktop/memory-export.ts:54–118`, `apps/desktop/main.ts:121–122,241`, `apps/desktop/preload.ts:15`, `packages/desktop-contract/index.ts:26,51` | `createMemoryExportDownloads()` guards `will-download`, denies unowned downloads, `item.setSaveDialogOptions({title,defaultPath,filters,properties:['showOverwriteConfirmation']})`, data-URL download, receipt with saved/cancelled. Bridge `window.harnessDesktop.exportProjectMemory`, channel `harness-desktop:memory-export` in `DESKTOP_CHANNELS`. |
| Styles | `apps/web/src/workspace-tools.css:1–7`, `apps/web/src/styles.css:53–55,351,375–378`, `packages/ui-shell/tokens.css:23–40,58,70` | `.live-review`, `.live-diff`, `.live-change-list`, toolbar buttons 12px / padding 4px 6px / min-height 28px; `.icon-button`; motion tokens (hover 120 ms, press 80 ms, toast 200/160 ms) with reduced-motion overrides; global reduced-motion rule. |
| Tests | `tests/project-tools.test.ts:23,35–38`, `tests/code-review-comparisons.test.ts` (fixture sets `core.autocrlf false` at :25), `tests/workspace-linked-pr.test.ts:99–107`, `tests/desktop-memory-export.test.ts`, `tests/memory-export-client-v3.test.ts`, `tests/e2e/redundant-ui.spec.ts:56,71,104,140`, `tests/e2e/wo5-app-integration.spec.ts:63`, suites in `scripts/browser-suites.ts` | Patterns to copy for unit, route, desktop and browser tests. |
| Commands | `package.json` | `pnpm test`, `pnpm typecheck`, `pnpm lint` (`scripts/lint-ui.ts --check`), `pnpm test:ui-guard`, `pnpm test:browser --suite <name>`, `pnpm test:e2e`. |
| Source manifest | `scripts/public-source-files.json` (sorted `source` and `runtime` arrays), `CONTRIBUTING.md:48` | Every new source file needs a `source` entry (and `runtime` when packaged). |
| DISCOVERY | managed repository config | Whether the private Git family sets `core.autocrlf`/`core.eol` or `.gitattributes` conversion applies to diff output. T01 must check `nativeGit` config for the managed and legacy paths and record the result in the PR; fixtures pin `core.autocrlf=false`. |
| DISCOVERY | project display name | Where the web app has the current project's display name for R11 (search `WorkspaceSurfaceBody.tsx` props and the project store hooks). If none is in scope, use the last segment of the project path, else `project`. |

## DESIGN

### D1 Data flow
1. User clicks an action in `DiffBody`. Client knows `scope` (`staged` | `worktree` from the checkbox), optional `path` (row), `revision` and `threadId`.
2. Client calls `GET /api/projects/:projectId/git/patch?scope=…&revision=…[&path=…][&threadId=…]` (no-store).
3. Server: `projects.gitPatch(projectId,{scope,revision,path},threadId)` → `exclusive` + `withGitOperation` (read-only) → recompute the status `revision` exactly as `status()` does; if different → `HarnessError('STALE_REVISION','Changes were updated. Review them and try again.')` (HTTP 409).
4. Server builds the patch bytes (D3), returns `WorkspacePatch` (D2).
5. Client: Copy → decode base64 → `TextDecoder('utf-8',{fatal:true})` on the included bytes (server already excludes non-UTF-8 files when `purpose=copy`) → `navigator.clipboard.writeText`. Save → bytes → desktop `savePatch` or browser Blob download.

### D2 Contract (new file `packages/contracts/workspace-patch.ts`)
```ts
import {z} from 'zod';
export const WORKSPACE_PATCH_LIMIT_BYTES = 4 * 1024 * 1024;
export const workspacePatchQuerySchema = z.object({
  scope: z.enum(['staged', 'worktree']),
  purpose: z.enum(['copy', 'save']),
  revision: z.string().min(1).max(128),
  path: z.string().min(1).max(4096).refine(p => !p.includes('\0')).optional(),
  threadId: z.string().optional(), // reuse the existing identifier schema used by querySchema
});
export const workspacePatchSkipSchema = z.object({
  path: z.string(),
  reason: z.enum(['binary', 'not-utf8', 'unreadable', 'unsupported-file']),
});
export const workspacePatchSchema = z.object({
  scope: z.enum(['staged', 'worktree']),
  revision: z.string(),
  head: z.string(),
  branch: z.string(),
  paths: z.array(z.string()),            // files included, in patch order
  skipped: z.array(workspacePatchSkipSchema),
  bytes: z.number().int().nonnegative(), // decoded length of contentBase64
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentBase64: z.string(),
});
export type WorkspacePatch = z.infer<typeof workspacePatchSchema>;
```
Use the repository's existing zod import and identifier schema (match `packages/contracts/code-review.ts` style). `path` must also pass the same `pathName` check used in `tools.ts` status parsing.

### D3 Patch construction (new file `packages/workspace/patch-export.ts`)
- Raw bytes: add an opt-in raw capture to `runProcess` (e.g. a trailing `options:{rawStdout?:boolean}={}` parameter that, when set, collects `Buffer` chunks without `setEncoding`, counts raw bytes against the same limit and returns `stdoutBytes: Buffer` on `ProcessResult`), and a `nativeGitBytes(...)` sibling of `nativeGit` that returns that Buffer with the identical prefix, limit and error mapping. Existing callers are unchanged.
- Tracked part: `nativeGitBytes(['diff','--full-index','--no-color','--no-ext-diff','--no-textconv','--find-renames', ...(scope==='staged'?['--cached','HEAD']:[]), '--', ...pathspecs])`. Pathspecs: none for the whole diff; for one file `':(literal)'+path` plus `':(literal)'+oldPath` for a rename.
- Binary detection: run the same command with `--numstat -z`; rows `-\t-\t` are binary. Split the raw tracked diff at `\ndiff --git ` boundaries (first block starts at offset 0) into per-file blocks; map each block to its path via the numstat order (same order, same flags) — do NOT parse paths from quoted headers. Drop binary blocks (they contain only "Binary files … differ") and add `{path, reason:'binary'}` to `skipped`.
- Untracked part (scope `worktree`, managed mode only, files with `untracked:true` from the same status pass): read bytes with the same bound file reader as `untrackedDigest`; if binary (same classification as status) → skip `binary`; if unreadable/not a regular file → skip `unreadable`/`unsupported-file`; else synthesize:
  ```
  diff --git a/<p> b/<p>
  new file mode <100644|100755>
  index 0000000000000000000000000000000000000000..<blob sha1 of the bytes>
  --- /dev/null
  +++ b/<p>
  @@ -0,0 +1,<n> @@
  +<line 1 including its own line ending bytes>
  ...
  \ No newline at end of file        (only when the last byte is not LF)
  ```
  Lines split after each LF on the raw Buffer (CRLF stays inside the line). Blob sha1 = sha1 of `blob <len>\0` + bytes (Git object id; compute in Node with `crypto`, no Git call). Mode 100755 when the file is executable on POSIX, else 100644. Empty file: header lines up to `index`, no `---/+++`/hunk (Git's own form for empty new files). Paths needing quoting (control chars, `"`, `\`, non-ASCII when `core.quotePath` would quote) must be quoted exactly like Git: C-style quoting in double quotes with octal escapes for bytes ≥ 0x80 and controls, applied to `a/<p>` and `b/<p>` as whole tokens. Unit-test against `git diff --no-index` output for the same file in a temp repo to prove identical headers.
- Order: tracked blocks in Git order, then untracked files sorted by path (byte order). Single-file request returns only that file.
- purpose `copy`: any included block whose bytes fail `new TextDecoder('utf-8',{fatal:true})` is moved to `skipped` with `not-utf8`.
- Total size > `WORKSPACE_PATCH_LIMIT_BYTES` → `RESOURCE_LIMIT` with the R7 message. Empty result with nothing skipped → HTTP 200 with `paths:[]`, `bytes:0` (client treats as "No changes in this view" toast; normally prevented by R9).
- `sha256` over the final bytes; `contentBase64 = bytes.toString('base64')`.

### D4 Server route
In `apps/server/workspace-routes.ts` next to `/git`: `app.get('/api/projects/:projectId/git/patch', …)` parsing params with the existing `identifier` and query with `workspacePatchQuerySchema`; set `cache-control: no-store`; map `STALE_REVISION` → 409, `RESOURCE_LIMIT` → 413, `UNSUPPORTED_PATH`/validation → 400, binding/authority failures as the `/git` route already does. Add `gitPatch` to the projects service next to `gitStatus` in `tools.ts`, sharing the status computation through a small extracted helper so the `revision` hash is computed by the same code (no copy of the hash expression).

### D5 Desktop bridge
- `packages/desktop-contract/index.ts`: `savePatch?(request:{filename:string;contentBase64:string;sha256:string}):Promise<{status:'saved'|'cancelled';filename?:string}>` and `DESKTOP_CHANNELS.patchSave='harness-desktop:patch-save'`.
- `apps/desktop/preload.ts`: `savePatch:request=>ipcRenderer.invoke(channels.patchSave,request)`.
- New `apps/desktop/patch-save.ts` mirroring `memory-export.ts` (owned one-use download, guard on `will-download`, frame/origin/URL/filename validation, pending limit, completion receipt) with `setSaveDialogOptions({title:'Save patch',defaultPath:filename,filters:[{name:'Patch',extensions:['patch','diff']},{name:'All files',extensions:['*']}],properties:['showOverwriteConfirmation']})`, MIME `text/x-diff`. Validate: filename matches R11 charset and ends `.patch`; decoded size ≤ 4 MiB; sha256 matches. Do not refactor `memory-export.ts`; if a pure helper there is exported and fits unchanged, import it, otherwise duplicate the minimal logic and note it in the PR.
- `apps/desktop/main.ts`: create the guard next to `memoryExports` (line 121), include it in `secureSessionDownloads`, and `handle(channels.patchSave, …)` beside line 241 with the same window/ownership arguments.

### D6 Visual design
- Toolbar (left to right): `Changes` · branch · [Copy patch] [Save .patch…] · Refresh · ☐ Staged. The two new buttons sit in a `span.live-patch-actions` group with `gap: 4px`, using the existing toolbar button style (12px text, padding 4px 6px, min-height 28px, `var(--border)` 1px border, 6px radius as the Refresh button has) plus a 14px lucide icon before the label (`Copy` for Copy patch, `Download` for Save .patch…), icon-to-label gap 4px, icon color `var(--muted)`, label `var(--text)`.
- At panel widths below 420px (container query on `.live-review` if the file already uses container queries, otherwise a width check via the existing panel-size class — DISCOVERY in T05) the labels hide visually (`sr-only`) and the buttons become 28×28 icon buttons with the label as `aria-label` and `title`.
- File rows: after the counts `small` and before Stage/Unstage, a `span.live-row-patch` with two `.icon-button` 24×24 buttons (lucide `Copy`, `Download`, 13px). Hidden state = `opacity:0`, not removed; shown on row `:hover`, `:focus-within`, and always under `@media (hover:none)`.
- Busy: the clicked button's icon is replaced by lucide `Loader2` with the existing spin utility if one exists (DISCOVERY; otherwise a CSS `@keyframes live-patch-spin` 0.8 s linear rotation using no off-token durations — check `scripts/ui-guard.ts` off-token-motion rule and use a token). Busy shows only after 150 ms to avoid flicker.
- Disabled: existing disabled button styling (opacity and `cursor:not-allowed`) with the R9 title.
- Colors and radii use only existing tokens (`--border`, `--muted`, `--text`, `--accent`, hover token from `.icon-button`); no new color tokens.

### D7 Animation
- Row icons fade `opacity 0→1` over the hover motion token (120 ms, ease-out) on row hover/focus; fade out over the same token.
- Copy success: icon cross-fades Copy → Check (`opacity` + `transform: scale(0.85→1)`) over the press token (80 ms) and holds 1600 ms (CopyButton timing), then reverts over 120 ms; the Check uses `var(--accent)` (or the success token if one exists in `tokens.css`).
- Toasts use the existing Toast motion (200/160 ms).
- `prefers-reduced-motion: reduce`: no scale, no fades, no spinner rotation (static `Loader2` with `aria-busy`), instant state swaps; the global reduced-motion rule in `styles.css:351` must cover these, and add explicit overrides like `styles.css:375–378` for any new transition.

### D8 Client code
- New `apps/web/src/patch-export.ts`: `requestPatch(base,{scope,purpose,revision,path,threadId},signal)` (authenticated GET via the same helper `useProjectRequest` uses, `credentials:'same-origin'`, `cache:'no-store'`, parse with `workspacePatchSchema`), `patchFilename(...)` (R11), `decodePatch(p)` (base64 → `Uint8Array`, verify `bytes` and sha256 via `crypto.subtle.digest`), `savePatchBytes(filename,bytes,sha256)` (desktop bridge when `window.harnessDesktop?.savePatch` exists, else Blob download), `skippedSummary(skipped)` (R13 text).
- `CopyButton` gets an optional async mode without breaking existing callers: e.g. `text: string | (() => Promise<string | null>)`; when a function, show busy while pending, write the returned text, treat `null` as "nothing copied" (no Copied state), and allow a custom `onError`. Keep the current error toast as default. Existing usages compile unchanged.
- `DiffBody`: a small `PatchActions` component (same file or `apps/web/src/PatchActions.tsx`) rendering the toolbar group; a `RowPatchActions` for rows. Abort in-flight requests on unmount and when `revision` or the Staged checkbox changes (generation fence like `useProjectRequest`). On `STALE_REVISION` call `load()` then toast R8.

### D9 Errors, cancel, retry
- No automatic retries. Each click is one request. A second click while busy is ignored (button disabled).
- Desktop save cancel → no toast, button returns to idle.
- Stale → reload + toast; the user clicks again on the fresh view.

### D10 Compatibility, rollback
- Additive: new endpoint, new bridge method (optional in the contract, so older desktop shells fall back to Blob download), new UI. No flags needed; rollback = revert the PR. No schema migration, no stored data.

## EXECUTION_DAG
| ID | Goal | Depends | Edits | Tests (positive / negative) | Done when | Handoff |
|---|---|---|---|---|---|---|
| T01 | Server patch builder with byte-exact output | — | `packages/capabilities/process.ts` (opt-in raw stdout), `packages/workspace/git-storage.ts` (`nativeGitBytes`), new `packages/workspace/patch-export.ts`, new `packages/contracts/workspace-patch.ts`, `packages/workspace/tools.ts` (`gitPatch`, shared revision helper); record the autocrlf DISCOVERY result | New `tests/workspace-patch-export.test.ts` using temp repos like `tests/code-review-comparisons.test.ts` (`core.autocrlf false`): modified, staged-only, unstaged-only, rename (`--find-renames`), deletion, untracked text, untracked empty, untracked executable, CRLF file, no trailing newline, non-ASCII UTF-8 path and content, path with spaces and quotes, binary tracked and untracked (skipped), non-UTF-8 text (saved; skipped for copy), single-file of a rename. For each: write bytes to a file, `git apply --check` and `git apply` in a fresh clone at the same HEAD, compare trees. Negative: stale revision → STALE_REVISION; >4 MiB → RESOURCE_LIMIT; invalid/absolute/`..` path → rejected; legacy mode excludes untracked; endpoint leaves `git status --porcelain` and index mtime unchanged. Existing `tests/project-tools.test.ts` still passes (revision hash unchanged). | All listed tests pass; `pnpm typecheck` passes | T02 owner (route) and T04 owner (contract) |
| T02 | HTTP route | T01 | `apps/server/workspace-routes.ts` | Extend `tests/workspace-linked-pr.test.ts` style route tests or add `tests/workspace-patch-route.test.ts`: 200 shape (schema-parse), `cache-control: no-store`, 409 stale, 413 limit, 400 bad scope/path/revision, thread binding rejection like comparison routes | Route tests pass | T04 |
| T03 | Desktop `savePatch` bridge | — (parallel with T01) | `packages/desktop-contract/index.ts`, `apps/desktop/preload.ts`, new `apps/desktop/patch-save.ts`, `apps/desktop/main.ts` | New `tests/desktop-patch-save.test.ts` modeled on `tests/desktop-memory-export.test.ts`: saved receipt with exact bytes, cancel, unowned download denied, wrong sha256 rejected, bad filename rejected, >4 MiB rejected, second concurrent save bounded, window closed mid-save → cancelled. `tests/desktop-preload-accounts.test.ts`/bridge-shape tests updated if they snapshot the bridge | Tests pass; memory export tests unchanged and passing | T04 |
| T04 | Web client helpers | T01 (contract), T03 (bridge type) | new `apps/web/src/patch-export.ts`; `apps/web/src/CopyButton.tsx` async mode | Unit tests (new `tests/patch-export-client.test.ts`, pattern of `tests/memory-export-client-v3.test.ts`): filename rules (R11 cases incl. detached HEAD, long, unicode, empty), base64 decode + sha256 verify (mismatch → error), desktop bridge used when present, Blob fallback otherwise with revoke, skipped summary text (0, 1, 3, 5 items), async CopyButton: success, null, rejection toast, unmount during pending, existing sync usage unchanged | Tests pass | T05 |
| T05 | Changes panel UI, design and animation | T02, T04 | `apps/web/src/WorkspaceSurfaceBody.tsx` (`DiffBody`), optional new `apps/web/src/PatchActions.tsx`, `apps/web/src/workspace-tools.css`; resolve D6 DISCOVERY items (container queries, spinner utility, project name) | Browser tests (extend `tests/e2e/redundant-ui.spec.ts` or new spec registered in `scripts/browser-suites.ts`): buttons present with names; disabled states (empty view, binary-only, per-file no changes in view); copy whole/per-file puts expected text on clipboard (grant clipboard permissions in Playwright); staged toggle changes output; Save triggers a download whose bytes sha256-match the response; stale revision path reloads and toasts; skipped toast lists binary; keyboard-only: Tab reaches row icons and they become visible; reduced-motion emulation shows no transitions. `pnpm lint`, `pnpm test:ui-guard` pass (no numeric JSX child, no ad-hoc overlay, no off-token motion) | Browser suite and guards pass; screenshots of toolbar (wide/narrow, light/dark), row hover, busy, copied, toasts attached to PR | T06 |
| T06 | Manifest, docs and full validation | T01–T05 | `scripts/public-source-files.json` (sorted `source` entries for every new file; `runtime` where packaged), user docs if a Changes panel doc exists (DISCOVERY: search `docs/` for "Changes panel"/"Staged") | `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm test:ui-guard`, `pnpm test:browser --suite <changes suites>`; manual desktop check of save dialog on Windows (title, filters, overwrite prompt, cancel) | All green; manual checks recorded in PR with evidence | T07 |
| T07 | Front end team review | T06 | none (PR description) | — | PR posted with the design/animation spec from D6–D7, screenshots and a short screen recording of hover, copy, save, busy, reduced-motion; the finished work is sent to the front end team for review and their feedback is addressed or recorded on the issue | Front end team |

Ownership boundaries: T01/T02 own `packages/capabilities`, `packages/workspace`, `packages/contracts/workspace-patch.ts`, `apps/server`; T03 owns `apps/desktop` and `packages/desktop-contract`; T04/T05 own `apps/web`. T01 and T03 can run in parallel; nothing else overlaps.

## VALIDATION
- Setup: `pnpm install`; Node and pnpm versions per `package.json` `engines`/`packageManager`.
- Unit/integration: `pnpm exec vitest run tests/workspace-patch-export.test.ts tests/workspace-patch-route.test.ts tests/desktop-patch-save.test.ts tests/patch-export-client.test.ts tests/project-tools.test.ts tests/code-review-comparisons.test.ts tests/desktop-memory-export.test.ts`.
- Full: `pnpm typecheck && pnpm test && pnpm lint && pnpm test:ui-guard`.
- Browser: `pnpm build && pnpm test:browser --suite redundant-ui` (plus the suite that holds any new spec).
- Real-user check (desktop, Windows): open a thread with modified, renamed, untracked and binary files; Copy patch → paste into a file in a separate clone → `git apply --check` passes; Save .patch… → dialog title "Save patch", Patch filter, overwrite confirmation, cancel silent; saved file sha256 equals response; binary toast shown.
- Acceptance matrix:

| Req | Task | Check |
|---|---|---|
| R1, R2 | T05 | browser test: buttons and outputs |
| R3 | T01, T05 | unit: staged vs worktree vs legacy; browser: toggle |
| R4 | T01 | unit: `git apply --check` + tree compare for all fixtures |
| R5 | T01, T05 | unit: binary skipped; browser: binary-only disabled + toast |
| R6 | T01, T03, T04 | unit: CRLF/no-EOL/non-UTF-8 byte compare; desktop/browser sha256 |
| R7 | T01, T02 | unit + route 413 message |
| R8 | T01, T02, T05 | unit/route 409; browser reload + toast |
| R9 | T05 | browser disabled titles |
| R10 | T03, T06 | desktop tests + manual dialog |
| R11 | T04 | unit filename cases |
| R12 | T04, T05 | unit Blob + browser download |
| R13, R14 | T04, T05 | unit summary; browser toasts; clipboard-denied case |
| R15 | T05 | keyboard and hover:none tests, focus visible |
| R16 | T01, T02 | unit/route: binding, literal pathspec, path traversal, read-only |
| R17 | T01, T02 | review: no logging/persistence of patch content; grep for logger calls in new code |
| D6, D7 | T05, T07 | screenshots, reduced-motion test, front end review |

- Release gate: all checks above pass on CI, manual desktop check recorded, front end team review requested (T07).
- Executed so far: none. All tests above are planned, not run.

## STATE
- Researched/decided: everything in REQUIREMENTS and DESIGN (r1).
- Implemented: nothing. Verified: nothing.
- Owners/branches: none yet. This plan's docs PR only adds this file.
- Risks: (1) Git path quoting in synthesized untracked headers must match Git exactly — mitigated by comparing against `git diff --no-index` in tests; (2) Electron download guard is security-sensitive — mirror `memory-export.ts` and its tests rather than inventing a new policy; (3) clipboard API may be denied in some browser contexts — R14 offers Save instead; (4) `--find-renames` makes the whole-diff output differ from the displayed `value.diff` text for renames (displayed text has no rename detection); acceptable, as the patch is still equivalent and applies.
- Next step: T01 and T03 in parallel, starting from current `main`.

## REFERENCES
- openai/codex#26758 — request for a step-level "Copy patch" action on agent changes: https://github.com/openai/codex/issues/26758
- openai/codex#10503 — Undo/review gaps when agent changes cannot be taken out or reverted: https://github.com/openai/codex/issues/10503
- Git documentation for the formats used: `git diff` (`--full-index`, `--find-renames`, `--cached`), `git apply`, diff-format "generating patches with -p" (new file mode, index line, quoting of paths): https://git-scm.com/docs/git-diff, https://git-scm.com/docs/git-apply, https://git-scm.com/docs/diff-format
- Repository files listed in REPO_MAP at baseline `8fa907f378127bcfc23d71b55c53625ffc43e8da`.
- Related Gen issues: #1288, #1582, #1235, #1471.
