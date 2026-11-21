# Discard changes to one file

## META

- Repository: `skytuhua-org/Gen-V1`; feature size: **small**; batch 9 item 4. Plan revision **1**, 2026-11-21.
- Verified baseline: `main@8fa907f378127bcfc23d71b55c53625ffc43e8da`. Every code fact below refers to that SHA.
- Canonical coordination issue: the GitHub issue whose body contains this entire plan (labels `feature`, `small`). The docs PR that adds this file at `docs/agent-plans/discard-file-changes.md` and its SHA-pinned URL are linked in the issue preface; they are publication artifacts, not implementation.
- Status: researched and specified only. **Nothing is implemented.** No feature test, browser run or visual check has been executed by the planner.
- Provenance: batch 9 proposal (pitch, scope notes below) screened against batches 1–8, all `feature` issues through #1594, the M01–M17 ledger in `docs/progress.md` and the baseline source. Title searches for "discard" found only unrelated fixes (#94, #167, #168, #927); no existing discard/restore-file feature issue or PR.

## OBJECTIVE

In the live Changes panel a user can Stage or Unstage each changed file, but cannot throw away an unwanted edit an agent made to one file. Today they must open a terminal and type `git restore` or delete the file by hand, which is error-prone and is the gap reported against Codex ("Undo" that skips a tracked file or does nothing) and Claude Code (hidden Undo on a file entry).

Intended behavior: each changed-file row in the Changes panel gets a **Discard…** button after Stage/Unstage. It opens a confirmation dialog that names the file and states the consequence. Confirming restores a tracked file to `HEAD` (both index and working tree) or moves an untracked file to the Windows Recycle Bin. The list then refreshes and the row disappears.

Measurable success:
1. A modified, deleted, staged-added, renamed and untracked file can each be discarded from the UI in two clicks (Discard…, confirm), leaving `git status --porcelain` with no entry for it and other files untouched.
2. The action is refused (button disabled and server error) while the thread's run is active, in the legacy read-only working copy, for conflicted entries, and when the reviewed revision is stale.
3. Untracked files are never permanently deleted by Gen; they land in the Recycle Bin, or the action fails with a clear message and the file stays.

## REQUIREMENTS

Decisions for revision 1 (not options):

| ID | Requirement | Tasks / acceptance |
| --- | --- | --- |
| R1 | New workspace action type `discard`, admitted through the same `WorkspaceActionOutcomes` path as `stage`/`unstage` (envelope, owner fence, revision + `expectedHead` check, idempotent receipt, recovery). Payload `{revision, expectedHead, paths}` with **exactly one** path. | T01, T02 / A1, A6 |
| R2 | Tracked file semantics: restore index and working tree to `HEAD` for that path. Index-added (`A`) file not in `HEAD`: remove from index, then move the working file to the Recycle Bin. Rename/copy (`R`/`C`): discard both sides — restore `oldPath` from `HEAD` and treat `path` as index-added. Worktree-deleted (`D`) file: recreated from `HEAD`. | T02 / A1, A2 |
| R3 | Untracked (`??`) file: move to the Recycle Bin (Windows), never `unlink`. If the Recycle Bin is unavailable (non-Windows host, PowerShell failure, file locked), fail with `TRASH_UNAVAILABLE` / `TRASH_FAILED` and leave the file in place. | T02 / A3 |
| R4 | Refuse with `RUN_ACTIVE` while the owning thread's run is active (`thread.runId !== null` or `thread.status === 'working'`); refuse conflicted entries (`U` in either column, or `AA`/`DD`) with `CONFLICTED_PATH`; refuse gitlinks (mode `160000`) with `UNSUPPORTED_PATH`; refuse in legacy mode via the existing `withGitOperation(..., write=true)` `CAPABILITY_DENIED`. | T02, T03 / A4 |
| R5 | UI: "Discard…" button per row, after Stage/Unstage; disabled when `pending`, `gitWrite!==true`, or the panel's thread run is active (tooltip explains why). Confirmation dialog names the file path, says what will happen for that file state, and defaults focus to Cancel. | T03 / A5, A7 |
| R6 | No hunk-level or multi-file discard, no "Discard all", no new keyboard shortcut, no undo of a tracked-file discard beyond the optional checkpoint in R7. | — (out of scope) |
| R7 | When file checkpoints are enabled for this owner (`GET /api/projects/:projectId/checkpoints/capability` returns `available: true`, i.e. M08 `workspace.checkpointsV1` on), capture the file's current bytes in a checkpoint before writing, and the dialog says so. When off (the default), the dialog says the change "can't be undone" for tracked files. | T04 / A8 |
| R8 | Accessibility: dialog uses the shared `Modal` (focus trap, Escape, focus return to the Discard… button or, if the row is gone, to the list); destructive button is not the default; status announced in the existing `role="status"` error line or toast; all text reachable by keyboard; reduced motion respected. | T03 / A7 |
| R9 | Security/privacy: paths are validated with the existing `pathName` schema and must be an entry of the freshly computed status at the reviewed revision; nothing outside the managed working copy is touched; no shell interpolation of paths. | T02 / A2, A6 |

Out of scope: hunk discard, discard in recorded (historical) diffs, discard from Files/Project Search, pull-request diffs, non-Windows Recycle Bin support (dev hosts get `TRASH_UNAVAILABLE` for untracked files only), M08 checkpoint restore UI changes (it is off and separate), #1288 comment-on-diff.

### User flows

1. **Modified file.** Changes panel → row `src/a.ts  M +3 −1  [Stage] [Discard…]` → Discard… → dialog "Discard changes" with `src/a.ts` and "Restore this file to the last commit (abc1234). Your edits to it can't be undone." → **Discard changes** → row animates out, list refreshes, toast "Discarded changes to a.ts".
2. **Untracked file.** Row shows `Untracked` → dialog text "Move this new file to the Recycle Bin." → button **Move to Recycle Bin** → row removed, toast "Moved new.txt to the Recycle Bin".
3. **Stale review.** Agent edits the file after the dialog opened → confirm → server `REVISION_CHANGED` (409) → dialog closes, panel error line shows the existing out-of-date message, list reloads; nothing was written.
4. **Run active.** While the thread is working the Discard… button is disabled with tooltip "Stop the run to discard files."; a forced request returns `RUN_ACTIVE`.

## REPO_MAP (verified at baseline)

- `apps/web/src/WorkspaceSurfaceBody.tsx`
  - `DiffBody` (line ~39): loads `GET {base}/git?threadId=` via `useProjectRequest<GitStatus>`; `apply(type,path)` posts `{id,type,payload:{paths:[path],revision,expectedHead},threadId}` to `{base}/actions`, then `load()`. Each `value.files` row renders path, state `<small>` and one Stage/Unstage button disabled on `pending||value.gitWrite!==true`. Legacy note text: "Original working copy · tracked changes only…".
  - `ChangesBody` wraps `DiffBody` in `FileCheckpoints`, using `{base}/checkpoints/capability`.
  - `WorkspaceSurfaceBody` has `thread` (from `snapshot.threads`) but does not pass it to `ChangesBody`/`DiffBody`.
- `apps/web/src/workspace-tools.css` line 1: `.live-change-list li{display:flex;gap:8px;padding:6px;border-bottom:1px solid var(--border)}`, `.live-change-list small{color:var(--muted);font-size:11px}`.
- `packages/ui-shell/Modal.tsx`: `<Modal open title onClose className>`; native `<dialog>`, focus trap, Escape, focus return, CSS enter/exit (`packages/ui-shell/controls.css` lines 91–104 use `--ui-motion-popup-enter`, `--ui-ease-enter`, scale .97, reduced-motion override). Pattern for a destructive confirm: `apps/web/src/SavedLayoutChooser.tsx` "Delete layout" dialog.
- `packages/ui-shell/Toast.tsx`: `toast(message,{tone,action,durationMs})`; `<Toaster/>` mounted in `App.tsx`.
- `packages/ui-shell/tokens.css`: `--ui-motion-remove:140ms`, `--ui-motion-status:160ms`, `--ui-ease-move`, `--ui-ease-enter`.
- `packages/contracts/workspace-action-outcomes.ts`: `workspaceActionTypeSchema = z.enum(['stage','unstage','commit','review-pr','create-pr'])`; `workspaceActionPayloadSchemas.stage/unstage = {revision, expectedHead, paths}` where `paths` is 1–1000 strings; operation schema local target scope `'staged'|'worktree'`.
- `packages/workspace/action-outcomes.ts`: `WorkspaceActionOutcomes.execute` validates payload, fences the owner (thread must be non-delegate with a private Git family), re-checks `expectedHead`/`revision`, then calls `this.projects.gitAction(projectId, threadId, {type, ...payload})` for non-PR types; `recover()` handles local comparisons generically.
- `packages/workspace/tools.ts`
  - `GitFile {path, oldPath?, index, worktree, staged, untracked, binary, added, removed}`; `status()` parses `git status --porcelain=v1 -z` (`--untracked-files=all` in managed mode) and skips `.harness-directory-guard`.
  - `gitAction()` runs inside `exclusive(projectId)` + `withGitOperation(..., write=true)`, rejects `revision` mismatch with `REVISION_CHANGED`, validates `paths` with `pathName`, implements `stage` (`git add --`), `unstage` (`git restore --staged --`), `commit`, `branch`, else `INVALID_INPUT`; returns fresh status.
  - `ProjectTools` constructor `(store, options: ProjectToolOptions = {})` — injection point for a trash function.
- `apps/server/workspace-routes.ts`: `POST /api/projects/:projectId/actions` routes `workspaceActionTypeSchema` types to `actionOutcomes.execute`; maps `revoked`→403 `CAPABILITY_DENIED`, `not-applied`→409 `REVISION_CHANGED`, `uncertain`→409 `ACTION_UNCERTAIN`. `checkpoints = new CheckpointService(service.store)` (line 93); capability flags via `capabilityEnabled('workspace.restoreV1')` etc.
- `packages/workspace/checkpoints.ts`: `CheckpointService.create({owner, root, paths, label?, provenance?})` and `createFromBytes(...)`; provenance kinds `guarded_write | restore_backup` (`apps/web/src/file-checkpoint-api.ts` schema line 13).
- Windows PowerShell precedent (fixed system path, no profile, no interpolation): `packages/core/file-access.ts` line ~46, `packages/storage/secret-codec.ts` line 13.
- Thread run state: `Thread.status: TaskStatus` (`ready|working|awaiting_input|stopped|interrupted|completed|failed`) and `Thread.runId: string|null` in `packages/contracts/index.ts`.
- Tests: `tests/project-tools.test.ts` (real git; stage against stale revision), `tests/workspace-action-outcomes.test.ts` (fixture `operation(type)`; unstage/commit replay test line ~518), `tests/workspace-action-outcome-routes.test.ts`, `tests/workspace-action-outcome-authority.test.ts`, `tests/e2e/shared-panels.spec.ts` (`pullRequestFixture(page,{kind:'diff',dirty:true,gitWrite:true})`, test "Diff actions reject false and missing write capability while writable worktrees still stage").
- Discovery (not verified): whether `thread.runId` is always cleared when a run ends normally (agent-work.ts clears it on cancel/interrupt); T01 confirms and picks the run-active predicate accordingly.

Related work: M08 checkpoints (`workspace.checkpointsV1`, `workspace.restoreV1`) are present but **off** and not verified; #1288 comment-on-diff is unrelated. Batch 9 item 3 "Copy or save changes as a patch" will add buttons to the same Changes toolbar/rows; whichever lands second rebases and keeps both (row order: Stage/Unstage, Discard…; patch buttons live in the toolbar or per-row overflow as that plan specifies).

## DESIGN

### Contract (T01)

```ts
// packages/contracts/workspace-action-outcomes.ts
export const workspaceActionTypeSchema = z.enum(['stage', 'unstage', 'discard', 'commit', 'review-pr', 'create-pr']);
// in workspaceActionPayloadSchemas:
discard: z.strictObject({ ...local, paths: z.array(z.string().min(1).max(1024)).length(1) }),
```
Comparison scope for a discard operation journal entry is `'worktree'` (same as stage). No other enum or schema changes except R7's provenance value (T04).

### Host action (T02)

In `ProjectTools.gitAction`, add `input.type === 'discard'` after the existing revision check, using the freshly computed `current` status:

1. `const [path] = paths` (exactly one, else `INVALID_INPUT` "Choose one file to discard."). `const file = current.files.find(f => f.path === path)`; missing → `REVISION_CHANGED` ("That file has no changes. Refresh the review.").
2. Run guard: look up the thread (`this.store.get<Thread>('thread', threadId)`); if run active (predicate from T01) → `HarnessError('RUN_ACTIVE', 'Stop the run before discarding files.')`.
3. Conflict guard: `file.index==='U'||file.worktree==='U'||file.index+file.worktree==='AA'||file.index+file.worktree==='DD'` → `CONFLICTED_PATH` "Resolve the conflict in this file first.".
4. Gitlink guard: `git ls-files -s -- <path>` and `git ls-tree HEAD -- <path>`; mode `160000` → `UNSUPPORTED_PATH`.
5. Dispatch:
   - Untracked (`file.untracked`): `await this.trash(join(path, ...file.path.split('/')))` inside `withPathGuard([{path: target, leaf: true}], signal, …)`.
   - Rename/copy (`file.oldPath`): `git restore --source=HEAD --staged --worktree -- <oldPath>` (copy `C`: `oldPath` still exists in `HEAD`, restoring is a no-op-safe call), then handle `path` as index-added below.
   - Index-added (`file.index==='A'`, or the new side of a rename): `git rm --cached --quiet -- <path>` then trash the working file if it exists.
   - Otherwise (tracked in `HEAD`: `M`, `D`, `T`, staged or not): `git restore --source=HEAD --staged --worktree -- <path>`.
   Paths are passed as argv after `--` via the existing `nativeGit` helper; no shell.
6. Return `this.status(...)` like other actions.

Trash implementation: new file `packages/workspace/recycle-bin.ts` exporting `moveToRecycleBin(absolutePath: string, signal: AbortSignal): Promise<void>`. On `process.platform !== 'win32'` throw `HarnessError('TRASH_UNAVAILABLE', 'The Recycle Bin is only available on Windows. The file was not changed.')`. On Windows spawn `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -Command <fixed script>` with the path passed through an environment variable (`GEN_TRASH_PATH`), never in the script text. Fixed script:
```powershell
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:GEN_TRASH_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')
```
Non-zero exit or timeout (10 s) → `HarnessError('TRASH_FAILED', "Couldn't move the file to the Recycle Bin. It was not changed.")`; afterwards verify with `lstat` that the path is gone, else `TRASH_FAILED`. `ProjectToolOptions` gains `trash?: (absolutePath: string, signal: AbortSignal) => Promise<void>`, defaulting to `moveToRecycleBin`; tests inject a fake.

Ordering and atomicity: index changes run before trashing so a trash failure leaves the file present and unstaged (still recoverable, shown as untracked after refresh); the error message says so. All work runs inside the existing `exclusive(projectId)` queue and private Git family guard, so it cannot race with stage/commit.

Outcome/recovery: `discard` follows the non-PR branch of `WorkspaceActionOutcomes.execute` unchanged (receipt replay returns the stored result; no second write). `recover()` treats it as a local `worktree` comparison. Routes need no change because they already dispatch any `workspaceActionTypeSchema` member; add the new HarnessError codes to the route's pass-through (they surface as their own codes through the existing error handler — T02 verifies the HTTP status is 409 for `RUN_ACTIVE`/`CONFLICTED_PATH` and 422 or the existing default for `TRASH_*`; reuse whatever mapping `HarnessError` codes already get, do not add a new mapping table).

### Web UI (T03)

`WorkspaceSurfaceBody` passes `runActive` (from `thread` using the T01 predicate) into `ChangesBody` → `DiffBody`. `DiffBody` adds `const [discarding, setDiscarding] = useState<GitFile|null>(null)` and a `discard(file)` that reuses `apply('discard', file.path)` semantics but also closes the dialog, shows the toast on success and keeps the dialog's error inline on failure (except `REVISION_CHANGED`, which closes the dialog and reloads, per flow 3).

Row markup (after the Stage/Unstage button):
```tsx
<button type="button" className="live-discard" aria-haspopup="dialog"
  aria-label={`Discard changes to ${file.path}`}
  title={runActive ? 'Stop the run to discard files.' : undefined}
  disabled={pending || value.gitWrite !== true || runActive}
  onClick={() => setDiscarding(file)}>Discard…</button>
```

Dialog (`<Modal open={discarding!==null} title="Discard changes" className="discard-dialog" onClose={…}>`), content by state:

| File state | Body text | Confirm label |
| --- | --- | --- |
| Tracked (M/D/T, staged or not) | "Restore this file to the last commit ({head.slice(0,7)}). Your edits to it can't be undone." | Discard changes |
| Index-added | "Remove this new file from Git and move it to the Recycle Bin." | Move to Recycle Bin |
| Rename/copy | "Undo the rename: restore {oldPath} and move {path} to the Recycle Bin." | Discard changes |
| Untracked | "Move this new file to the Recycle Bin." | Move to Recycle Bin |
| Any, checkpoints available (R7) | Replace "can't be undone" with "A checkpoint of the current file is saved first; restore it from History." | unchanged |

The path is shown above the text in a `<code className="discard-path">` (monospace, wraps with `overflow-wrap:anywhere`). Actions row: `Cancel` (receives initial focus via `autoFocus`) then the confirm button. While the request runs both buttons are disabled, confirm label becomes "Discarding…", `aria-busy="true"`; `onClose` is ignored while busy (same pattern as `SavedLayoutChooser`).

### Visual design and animation specification

- **Discard… button:** same size as the Stage button (inherits panel button styles: `font-size:12px; padding:4px 6px; min-height:28px` inside `.canvas-panel`); text colour `var(--danger, #e05d5d)`; background transparent; border `1px solid transparent`. Hover: `background: color-mix(in srgb, var(--danger, #e05d5d) 12%, transparent)`; transition `background var(--ui-motion-hover) var(--ui-ease-move)`. Active: `transform: scale(.97)` for `var(--ui-motion-press)`. `:focus-visible`: `outline:2px solid var(--ui-focus-ring); outline-offset:1px`. Disabled: `opacity:.45; cursor:not-allowed`, no hover fill.
- **Row:** no layout change except the extra button; `gap:8px` already applies. Path span keeps ellipsis.
- **Dialog:** `.discard-dialog` width `min(440px, calc(100vw - 32px))`; body `display:grid; gap:12px; padding:0 20px 20px`; `.discard-path` `font:12px/1.5 var(--font-mono,monospace); padding:8px 10px; border-radius:6px; background:var(--surface-hover,#242424); overflow-wrap:anywhere`; text `font-size:13px; line-height:1.55; color:var(--text)`; actions `display:flex; justify-content:flex-end; gap:8px; margin-top:4px`. Confirm button: `background:var(--danger, #e05d5d); color:#fff; border:0; border-radius:var(--control-radius,6px); padding:6px 12px; font-weight:550`; hover `filter:brightness(1.08)`; focus ring as above. Cancel uses the default secondary button. Inline error uses the existing `ErrorState` component as in `SavedLayoutChooser`.
- **Animation:** dialog uses the existing `Modal` enter/exit (no new keyframes). On a successful discard the row exits before the list reloads: add `data-leaving` to the `<li>` and CSS `.live-change-list li[data-leaving]{opacity:0; transform:translateX(8px); transition: opacity var(--ui-motion-remove) var(--ui-ease-move), transform var(--ui-motion-remove) var(--ui-ease-move)}`; the reload is awaited in parallel, and the new list replaces rows when it arrives (no wait longer than 140 ms is added; if the reload returns first, the row simply disappears). `@media (prefers-reduced-motion: reduce)` → no transform, `transition-duration: var(--ui-motion-press)`.
- **Feedback:** success toast via `toast('Discarded changes to ' + basename)` or `toast('Moved ' + basename + ' to the Recycle Bin')`, default tone, default duration, no action button. Failures use `tone:'error'` only when the dialog is already closed (REVISION_CHANGED); otherwise the inline dialog error.
- Light and dark themes: only tokens above; verify contrast of `--danger` text on panel background ≥ 4.5:1 in both themes (T05 evidence).

### Checkpoint integration (T04, gated)

Only when `capabilityEnabled('workspace.checkpointsV1')` and the owner resolves as in the existing `checkpointOwner(projectId, threadId)` route helper. Before the write in step 5, call `checkpoints.create({owner, root, paths: [path, ...(oldPath ? [oldPath] : [])], label: 'Before discard', provenance: {kind: 'discard_backup', operationId: input.id}})`; add `'discard_backup'` to the provenance enum in both the host checkpoint schema and `apps/web/src/file-checkpoint-api.ts`. If checkpoint creation fails, abort the discard with the checkpoint error (nothing written). `GitStatus` gains no field; the UI already knows availability from `ChangesBody`'s capability request and passes `checkpointsAvailable` to `DiffBody` for the dialog copy. With the flag off (default) this code path is inert.

### Security boundaries, rollback

- Only the managed private working copy is writable (`withGitOperation(write=true)`); delegate threads are refused by the outcome fence; legacy mode refused.
- The path must equal an entry of the freshly computed status at the reviewed revision, so a crafted request cannot target arbitrary files; `pathName` blocks `..`, absolute and `.git` paths.
- Rollback: revert the PR; no data migration. Receipts for `project.discard` remain inert history.

## EXECUTION_DAG

### T01 — Contract and run-active predicate
- Depends on: none.
- Edits: `packages/contracts/workspace-action-outcomes.ts` (enum + payload schema as in DESIGN). Discovery: read `packages/core/*` run lifecycle (`rg "runId:" packages/core`) to confirm `runId` is cleared on normal completion; record the predicate (`runId !== null || status === 'working'` unless evidence shows one alone is exact) in a shared helper `isRunActive(thread)` in `packages/contracts/index.ts` or the nearest existing thread-helper module.
- Tests: contract unit test (extend `tests/workspace-action-outcomes.test.ts` or a contract test) — `discard` with one path parses; zero or two paths rejected; unknown keys rejected.
- Done when: types compile (`pnpm exec tsc -p . --noEmit` or the repo's typecheck script) and new tests pass.
- Handoff: T02, T03.

### T02 — Host discard action and Recycle Bin helper
- Depends on: T01.
- Edits: `packages/workspace/tools.ts` (`gitAction` discard branch, `ProjectToolOptions.trash`), new `packages/workspace/recycle-bin.ts`, add the new file to `scripts/public-source-files.json` if that manifest lists source files (check with `rg "packages/workspace/tools.ts" scripts/public-source-files.json`).
- Positive tests (real git, `tests/project-tools.test.ts` style, fake `trash` that records the path and deletes it): modified → restored bytes equal HEAD; staged-modified → index and worktree clean; worktree-deleted → recreated; index-added → not in index, trash called; rename → old restored, new trashed; untracked → trash called, file gone; binary modified → restored. Other changed files unchanged in every case.
- Negative tests: stale revision → `REVISION_CHANGED`, no change; path not in status → `REVISION_CHANGED`; run active → `RUN_ACTIVE`; conflicted (create a merge conflict) → `CONFLICTED_PATH`; legacy mode → `CAPABILITY_DENIED`; trash throws → `TRASH_FAILED`, file still present; non-Windows default trash → `TRASH_UNAVAILABLE`.
- Outcome tests (`tests/workspace-action-outcomes.test.ts`): `operation('discard')` confirmed; replaying the same command returns the receipt without a second write; route test returns the receipt via `POST /actions`.
- Done when: all above pass; `pnpm exec vitest run tests/project-tools.test.ts tests/workspace-action-outcomes.test.ts tests/workspace-action-outcome-routes.test.ts tests/workspace-action-outcome-authority.test.ts` green.
- Handoff: T03, T04.

### T03 — Changes panel button, dialog, animation
- Depends on: T01 (contract), T02 for live testing (UI can be built against the e2e fixture in parallel).
- Edits: `apps/web/src/WorkspaceSurfaceBody.tsx` (`runActive` prop plumbing, row button, dialog, toast, row exit), `apps/web/src/workspace-tools.css` (styles above). Use `Modal`, `ErrorState`, `toast`; no new dependencies.
- Tests (`tests/e2e/shared-panels.spec.ts`, extend `pullRequestFixture` with file variants): Discard… visible and enabled for a managed dirty file; opens dialog with the path and the tracked-file text; Cancel focused; Escape closes with no action; confirm posts exactly one `{type:'discard',payload:{paths:['source.ts'],expectedHead,revision}}`; untracked variant shows "Move to Recycle Bin"; `gitWrite:false`/missing → disabled; run-active fixture → disabled with title; 409 `REVISION_CHANGED` closes the dialog and shows the panel error; `TRASH_FAILED` keeps the dialog open with the error. Run `pnpm lint` and `pnpm test:ui-guard` (UI guard covers overlays/numeric children).
- Done when: e2e tests pass in `pnpm test:browser` (or the targeted Playwright spec) and lint/ui-guard pass.
- Handoff: T05.

### T04 — Optional pre-discard checkpoint (flag-gated)
- Depends on: T02, T03.
- Edits: `apps/server/workspace-routes.ts` / `packages/workspace/action-outcomes.ts` wiring so `gitAction` can call `CheckpointService.create` (pass a `beforeDiscard` hook through `ProjectToolOptions` rather than importing the route), provenance enum `discard_backup` in `packages/workspace/checkpoints.ts` schema and `apps/web/src/file-checkpoint-api.ts`; dialog copy switch.
- Tests: with `workspace.checkpointsV1` enabled in a test, discard creates one checkpoint containing the pre-discard bytes and provenance `discard_backup`; checkpoint failure aborts the discard; with the flag off, no checkpoint is created and dialog copy says "can't be undone".
- Done when: tests pass; flag-off behavior identical to T02/T03.
- Handoff: T05.

### T05 — Integrated validation and visual evidence
- Depends on: T02–T04.
- Steps: full `pnpm test` (or `pnpm test:no-lease` if credential lease cannot build), `pnpm lint`, `pnpm check:docs-links`; on a Windows build, real-user check: create a thread, let the agent edit two files and add one, discard one modified and the new file, confirm `git status` in the working copy, confirm the new file is in the Recycle Bin. Capture screenshots: row with button (dark + light), dialog for tracked and untracked, disabled state during a run, reduced-motion check.
- Done when: evidence posted on the issue as a checkpoint; acceptance matrix all PASS.
- Handoff: T06.

### T06 — Send the finished work to the front end team for review
- Depends on: T05.
- Steps: request review from the front end team on the implementation PR (mention in the PR and the issue), attach the T05 screenshots and a short recording of flows 1–4, and list the exact visual tokens used. Address their feedback before merge.
- Done when: front end team review is recorded on the PR.

## VALIDATION

Planned commands (not executed by the planner): `pnpm install`; `pnpm exec vitest run <files from T02>`; `pnpm lint`; `pnpm test:ui-guard`; `pnpm test:browser` (Playwright, includes `tests/e2e/shared-panels.spec.ts`); `pnpm test`; manual Windows build check (T05).

Fixtures: temp git repositories created in tests (as `tests/project-tools.test.ts` does), fake trash function, Playwright route fixtures in `shared-panels.spec.ts`.

| ID | Acceptance criterion | Evidence |
| --- | --- | --- |
| A1 | Tracked modified / staged / deleted file is restored to HEAD; other files untouched | T02 unit tests |
| A2 | Index-added and rename cases leave no status entry; path outside status refused | T02 unit tests |
| A3 | Untracked file goes to Recycle Bin; trash failure leaves file and reports `TRASH_FAILED`; non-Windows `TRASH_UNAVAILABLE` | T02 tests + T05 Windows check |
| A4 | Refusals: run active, conflict, gitlink, legacy, stale revision | T02 tests, T03 e2e |
| A5 | Button placement, label, disabled states and tooltip | T03 e2e + screenshots |
| A6 | Exactly one request per confirm; replay returns receipt, no second write | T02 outcome test, T03 e2e |
| A7 | Dialog focus/Escape/focus return, copy per state, reduced motion | T03 e2e + T05 screenshots |
| A8 | Checkpoint captured only when checkpoints enabled | T04 tests |
| A9 | Front end team review recorded | T06 |

Release gate: A1–A9 PASS, CI green, no new UI guard findings.

## STATE

- Researched and decided: everything above (revision 1).
- Implemented: nothing. Verified: nothing (no feature tests run).
- Owners/branches: none yet; the implementing agent claims the issue per AGENTS.md.
- Risks: Recycle Bin via PowerShell adds ~300–800 ms latency for untracked files (acceptable; button shows "Discarding…"); exact run-active predicate pending T01 discovery; batch 9 item 3 touches the same rows (rebase conflict only).
- Next step: T01.

## REFERENCES

- Baseline: https://github.com/skytuhua-org/Gen-V1/tree/8fa907f378127bcfc23d71b55c53625ffc43e8da
- Motivating reports: [Codex: Undo skips tracked file #28506](https://github.com/openai/codex/issues/28506); [Codex: Undo does nothing #10503](https://github.com/openai/codex/issues/10503); [Claude Code: hidden Undo on file entry #103690](https://github.com/anthropics/claude-code/issues/103690).
- Repo docs: `AGENTS.md` (plan and checkpoint contract), `CONTRIBUTING.md`, `docs/progress.md` (M08 row: checkpoints off, not verified).
- Git semantics used: `git restore --source=HEAD --staged --worktree -- <path>` restores both index and worktree; `git rm --cached -- <path>` removes an added path from the index only.
