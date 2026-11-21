# Show and switch the git branch from the composer

## META

- **Feature:** a branch chip in the composer toolbar that shows the thread's current git branch and opens a searchable picker to switch to another branch or create one from the current commit.
- **Repository:** [skytuhua-org/Gen-V1](https://github.com/skytuhua-org/Gen-V1) · **Plan revision:** r1 (2026-11-21, UTC) · **Size:** medium.
- **Verified baseline:** [main at 8fa907f378127bcfc23d71b55c53625ffc43e8da](https://github.com/skytuhua-org/Gen-V1/commit/8fa907f378127bcfc23d71b55c53625ffc43e8da) (`git rev-parse HEAD` after fetching `origin/main`). Line numbers below refer to that commit.
- **Existing issues/PRs:** no open or closed issue or PR matches (searched issue titles for "branch" and the open PR list on 2026-11-21). Related, not overlapping: the Publish plan [`docs/agent-plans/thread-publish-pr.md`](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/docs/agent-plans/thread-publish-pr.md) (commit, push and PR from a thread; it reads the thread branch but never switches it).
- **Implementation status:** NOT_STARTED. This is a planning document only. Nothing in this plan is implemented or verified.
- **Provenance:** reading the repository at the baseline SHA (paths and identifiers in REPO_MAP), plus the external requests listed in REFERENCES.
- **Design and animation:** there is no separate front end design team for this work. This plan specifies the visual design and motion (DESIGN → Visual design and motion). The last task (T07) sends the finished work to the front end team for review.

## OBJECTIVE

**User problem.** Gen shows a thread's branch only in the Changes panel toolbar (`WorkspaceSurfaceBody.tsx` `DiffBody`, `value?.branch`) and in the sidebar thread hover facts (`thread-hover/facts.ts`, `branch` fact). While typing in the composer, the user cannot see which branch the agent will work on, and there is no way in the app to move the thread's working copy to another existing branch. The only branch write is a legacy `branch` action (`packages/workspace/tools.ts` line 188, `git switch -c <name>`) that creates a new branch, has no UI in the composer, validates names with a regex instead of Git's rules, and goes through the older untyped route fallback (`apps/server/workspace-routes.ts` lines 146–150) rather than the durable action-outcome path. Codex and Claude Code users ask for exactly this: an always-visible current branch and direct branch selection (see REFERENCES).

**Intended behaviour.** In a thread with a managed (app-owned, writable) working copy, the composer toolbar shows a chip with the branch glyph and the current branch name. Clicking it opens a popover with a search field, local branches (current first), remote-tracking branches under a "Remote" heading, and a "Create branch from here" row. Choosing a branch switches the working copy when it is safe: immediately when the tree is clean, or after the user picks "Bring changes" when it has uncommitted changes. Git conflicts, a running agent turn, a branch checked out by another thread's worktree, and invalid names are refused with a plain sentence that says what to do next. Read-only (legacy) working copies show the branch but do not offer switching.

**Measurable success.**
- The current branch is visible in the composer of every project thread that has a git working copy, without opening a panel (0 clicks, today ≥1).
- Switching to an existing local branch takes 2 interactions (open chip, pick branch) from a clean tree, 3 with "Bring changes"; today it is impossible in the app.
- No switch ever discards or overwrites uncommitted work: every refusal leaves `git status --porcelain=v2` output byte-identical to before the attempt (tested in T02/T06).
- A switch is never applied while the thread has an active run (`thread.runId !== null` or `status === 'working'`), enforced on the server, not only by a disabled button.

## REQUIREMENTS

### In scope

| ID | Requirement | Tasks / acceptance |
| --- | --- | --- |
| R1 | Composer branch chip: shows the live branch of the thread's working copy (from `ProjectContext.branch`), ellipsized, full name in tooltip and accessible name. Detached HEAD shows `Detached · <7-char sha>`. Hidden when the thread has no project or the project has no git root (context `branch` and `head` both null). Rendered in both composer layouts (`ComposerToolbar` with and without `separateActions`). | T04, T05 / A1 |
| R2 | Branch list read: new `GET /api/projects/:projectId/branches?threadId=` returns current branch, HEAD, revision, dirty summary, local branches and remote-tracking branches, each with short head SHA, last commit time and occupancy (checked out here / in another worktree), capped at 500 local + 500 remote with a `truncated` flag. | T01, T02, T03 / A2 |
| R3 | Popover: search field (case-insensitive substring on the full name), Local list (current branch first and marked with a check, the rest by last commit time, newest first), "Remote" heading and list (hidden when empty), and a sticky "Create branch from here" row. Fully keyboard operable (Up/Down, Home/End, Enter, Escape), IME-safe. | T05 / A3 |
| R4 | Switch to an existing local branch with new typed action `switch-branch`. Clean tree → switch immediately. Dirty tree → inline confirm "You have N uncommitted changes. Bring changes / Cancel"; "Bring changes" runs plain `git switch <branch>` (Git carries the changes when they apply cleanly). If Git refuses (local changes would be overwritten), nothing changes and the user sees "Your changes conflict with <branch>. Commit or stash them first, then switch." with an "Open Changes" button. | T01, T02, T03, T05 / A4, A5 |
| R5 | Remote branch: picking `origin/foo` with no local `foo` creates a local `foo` tracking it (`git switch --track origin/foo`); if local `foo` exists, the row switches to local `foo`. | T02, T05 / A6 |
| R6 | Create branch from here with new typed action `create-branch`: name field prefilled empty, placeholder `feature/my-change`, validated live with Git's rules (server is authoritative via `git check-ref-format --branch`); rejects names that already exist locally; creates from current HEAD and switches to it (`git switch -c <name>`), carrying uncommitted changes (always safe for a new branch from HEAD). | T01, T02, T05 / A7 |
| R7 | Guards, enforced on the server and mirrored in the UI: (a) thread has an active run → chip disabled, tooltip "Wait for the active run to finish", server returns `RUN_ACTIVE`; (b) branch checked out in another worktree (another thread's agent worktree) → row disabled with "In use by another thread"; server returns `BRANCH_IN_USE`; (c) working copy is legacy/read-only (`gitWrite !== true`) → chip shows the branch, popover lists branches read-only with the note "This working copy is read-only. Gen can switch branches only in its own working copies."; server returns `CAPABILITY_DENIED`; (d) stale view (revision or HEAD changed since the list was loaded) → `REVISION_CHANGED`, the list reloads and says "The branch changed. Pick again."; (e) only main threads (no side/delegate threads) — reuse `ProjectTools.binding` rules. | T02, T03, T05 / A8 |
| R8 | Durable, idempotent actions through the existing action-outcome service (`packages/workspace/action-outcomes.ts`): confirmed / not-applied / uncertain / revoked states, same-ID replay returns the stored result, no automatic retry after an uncertain outcome; uncertain shows "Gen couldn't confirm the switch. Check branch" which reloads the list and context. | T01, T02, T03 / A9 |
| R9 | After any confirmed switch or create: refresh the composer chip, thread hover facts, and any open Changes panel for the same project/thread (they read live git status). The agent's next turn uses the new branch automatically (it runs in the same worktree path). | T04, T05 / A10 |
| R10 | Visual design and motion as specified in DESIGN, honouring Reduce motion (OS and app setting) and the panel-animations setting; light, dark and high-contrast themes. | T05, T06 / A11 |
| R11 | Evidence and front end team review handoff. | T06, T07 / A12 |

### Out of scope (v1)

- Deleting, renaming, merging, rebasing, pushing, pulling or fetching branches; stash management; a "Discard changes and switch" option (`--discard-changes`/`--force`); `git switch --merge`.
- Switching branches in legacy (non-managed) working copies or the user's original checkout. This would change the write-authorization model (`withGitOperation` throws `CAPABILITY_DENIED` for unmanaged writes, `tools.ts` lines 133–140) and needs its own decision.
- Taking a branch away from another thread's worktree, or creating new worktrees from the picker.
- A global keyboard shortcut for the picker (no binding is added to `apps/web/src/keyboard-bindings.ts`).
- Changing the legacy `branch` fallback action or removing it (other callers may rely on it; T01 lists its callers, no behaviour change).
- Changing `WorkspaceBinding.branch` (the branch the worktree was created on). It stays as creation metadata; all displays read live git.

### Decisions

- **Decided by this plan (overridable on this issue):** server-side guards are authoritative; typed actions `switch-branch` and `create-branch` join `workspaceActionTypeSchema`; branch names validated with `git check-ref-format --branch`; plain `git switch` is the only "Bring changes" mechanism (no stash, no merge); remote list comes from refs already in the working copy's git family (no fetch); caps of 500 + 500 entries; no feature flag (the chip is read-only by default and writes require an explicit pick), but see T01 discovery item D5.
- **Proposed default left to T01 discovery:** whether remote-tracking refs exist in the app's private git family (`packages/workspace/git-storage.ts` `privateFamilyForBinding`). If they do not, the Remote group is hidden and R5 ships as a no-op with the empty state covered by tests.

### UX, accessibility, errors, security, performance

- Chip is a `<button>` with `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`, accessible name "Branch: <name>. Switch branch". Popover search is `type="search"`, `aria-label="Search branches"`, `aria-autocomplete="list"`, list is `role="listbox"` with `aria-activedescendant`; rows are `role="option"` with `aria-selected` for the active row and `aria-disabled="true"` for blocked rows, whose reason is in `aria-describedby`. Copy the `ModelPicker.tsx` patterns (lines 63–135), including its IME composition guards.
- Errors are one plain sentence plus the next action, shown inline at the bottom of the popover in `role="alert"`. Error codes and texts: `RUN_ACTIVE` "Wait for the active run to finish, then switch."; `BRANCH_IN_USE` "<branch> is open in another thread. Switch that thread first."; `BRANCH_CONFLICT` (R4 text); `BRANCH_EXISTS` "A branch named <name> already exists."; `INVALID_BRANCH_NAME` "Git doesn't allow this name: <reason>." where reason is one of: spaces, `..`, ends with `.lock` or `/`, starts with `-`, control characters, `~ ^ : ? * [ \`, `@{`; `REVISION_CHANGED` (R7d); `CAPABILITY_DENIED` (R7c); `ACTION_UNCERTAIN` (R8).
- Security: branch names and refs are passed as separate argv entries to `nativeGit` (no shell); every command includes `--` or `--end-of-options` where Git accepts it so a name starting with `-` can never be parsed as an option (also rejected by validation). Payload names are length-limited (≤ 250 bytes) and UTF-8 round-trip checked like `text()` in the contract. No network egress (no fetch). Branch lists and names are never logged outside the existing receipts.
- Performance: the list read is one `for-each-ref` plus one `worktree list --porcelain` plus the existing status call; target < 300 ms on a repo with 1,000 branches on the reference Windows machine (measured in T06). The list is fetched only when the popover opens, not on every render. The chip label comes from the existing `/context` read.
- Compatibility: Windows x64 desktop and the browser dev build; no new dependency.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | Path | What is there today |
| --- | --- | --- |
| Composer toolbar | `apps/web/src/ComposerToolbar.tsx` | `ComposerToolbarProps` (lines 6–15) has `projectLabel`, `changeSummary`, `onProject`, `onChanges`, `onCreatePR`, `working`, `disabled`, slots `leading/runtime/context/trailing`; **no branch prop**. Local `Glyph` SVG wrapper (line 29, 20×20 viewBox, 1.5 stroke, currentColor) and `branch` glyph constant (line 31), used today only by the Create PR chip (line 43). `ComposerTaskActions` (37–46) renders Changes and Create PR. Toolbar body (76–83): `.composer-project-controls` (leading/project/runtime) and `.composer-runtime-controls`. |
| Composer call sites | `apps/web/src/App.tsx` lines 264, 309, 442, 445 | `working = Boolean(thread?.runId) \|\| thread?.status === 'working'` (264); `changes` from `recordedChangeSummary` (309); `ComposerTaskActions` rendered separately (442) and `ComposerToolbar ... separateActions` (445). Both paths must show the chip. |
| Toolbar CSS | `apps/web/src/composer-toolbar.css` | `.composer-context-chip` (line 26: 25px min-height, 15px radius, 10px font, `var(--control-border)`, `var(--surface)`, `var(--muted)`), chip svg 12×12 (27), `.composer-pr>svg{color:var(--accent)}` (28), container breakpoints 610px and 355px (36–37), fine-pointer hover and reduced-motion rules (39–44), pressed scale .97 with `data-pointer-pressed` (7). |
| Popover primitive | `packages/ui-shell/Popover.tsx` | `PopoverProps` (7–23): anchor, contentRef, initialFocus, open, present, width, height, preferredSide/align, onDismiss, onReady. Used by `apps/web/src/ModelPicker.tsx` (line 2, 90–135, width 560/720, height 440, 110 ms exit presence at line 79). |
| Motion tokens | `packages/ui-shell/tokens.css` lines 20–40, 63–72 | `--ui-ease-enter`, `--ui-ease-move`, `--ui-motion-hover:120ms`, `--ui-motion-press:80ms`, `--ui-motion-status:160ms`, `--ui-motion-success:240ms`, `--ui-motion-popup-enter:180ms`, `--ui-motion-popup-exit:140ms`, `--ui-motion-stagger:30ms`; `.ui-popover[data-state=open]` keyframes (±4px shift, scale .98) with reduced-motion fade. |
| Context read | `apps/server/workspace-routes.ts` line 46 → `packages/workspace/tools.ts` `ProjectTools.context` (192–198) → `ProjectContext` in `packages/contracts/workspace.ts` line 58 | Returns live `branch` (from `git branch --show-current`, tools.ts line 144), `head`, `revision`, `workingCopy`, `capabilities.gitWrite`. Already used by `apps/web/src/thread-hover/host.ts` line 12. |
| Hover facts | `apps/web/src/thread-hover/facts.ts` lines 28, 53–59 | Copies `context.branch` into the `branch` fact for the matched working copy. |
| Changes panel | `apps/web/src/WorkspaceSurfaceBody.tsx` lines 5, 26–34, 39–44 | `GitStatus` (type from `tools.ts` lines 20–21: `head`, `branch`, `revision`, `files`, `mode`, `gitWrite`, `untrackedIncluded`); `useProjectRequest` (no polling; reloads on activation, Refresh, after actions); `apply()` posts `{id, type, payload:{paths, revision, expectedHead}, threadId}` to `/actions`. |
| Action contract | `packages/contracts/workspace-action-outcomes.ts` lines 6–36, 56–101, 113–114 | `workspaceActionTypeSchema = z.enum(['stage','unstage','commit','review-pr','create-pr'])`; `workspaceActionPayloadSchemas`; `local = {revision, expectedHead: oid}`; `text(max)` helper; operation schema with local `comparison` (branch is `z.string().max(1024)`); outcome unions. |
| Action service | `packages/workspace/action-outcomes.ts` | `authority()` (62–75) resolves project/thread/workspace and rejects delegate threads; `execute` validates envelope/payload (181–183), preflights status/head/revision (228–249), routes local operations to `projects.gitAction`, persists confirmed/not-applied (258–279); `inspect` (290–308). |
| Git backend | `packages/workspace/tools.ts` | `ProjectTools.exclusive` per-project queue (51); `binding` (71–78, main threads only, exact workspace match); `withGitOperation` (133–140, writes only on managed private family, else `CAPABILITY_DENIED`); `status` (142–154); `gitAction` (182–190: stage/unstage/commit/legacy `branch` → `git switch -c` with regex validation at 188); `prepareWorkspace` (102–129: worktree `dataDir/worktrees/<id>` on branch `gen/<thread>-<id8>` via `worktree add -b`). |
| Native git | `packages/workspace/git-storage.ts` lines 19–48; `packages/capabilities/process.ts` 19–22 | `nativeGit` (no pager, hooks disabled, explicit git-dir/work-tree, 120 s timeout, 4 MiB output cap, `shell:false`); `privateFamilyForBinding`, `withPrivateGitFamily`. |
| Routes | `apps/server/workspace-routes.ts` lines 20–23, 46–47, 129–150 | Generic envelope; `GET /context`, `GET /git`; `POST /actions` (typed actions → `actionOutcomes.execute`, 403/409 mapping; untyped fallback; legacy `branch` at 146–150). |
| Thread model | `packages/contracts/index.ts` line 3 | `Thread.projectId`, `workspaceId`, `runId`, `status`, `epoch`, `kind`. |
| UI guard | `scripts/ui-guard-policy.md`, `scripts/lint-ui.ts`, `scripts/ui-guard.ts`, `scripts/ui-overlay-legacy.json` | New overlays must use shared primitives (use `Popover`); numeric JSX children must be gated with explicit booleans; never regenerate the legacy inventory to hide new findings. |
| Tests to extend | `tests/project-tools.test.ts`, `tests/workspace-action-outcomes.test.ts`, `tests/workspace-action-outcome-routes.test.ts`, `tests/workspace-action-outcome-authority.test.ts`, `tests/ui-guard.test.ts`, `tests/e2e/model-picker.spec.ts`, `tests/e2e/composer-press.spec.ts`, `tests/e2e/composer-integration.spec.ts`, `tests/e2e/composer-motion.spec.ts`, `tests/e2e/workspace-ui.spec.ts`; suites in `scripts/browser-suites.ts` | Existing unit and Playwright coverage. |
| Source manifest | `scripts/public-source-files.json` | `{version, baseline, source:[...], runtime:[...]}`; both arrays sorted path strings. Every new source/test file is added to `source` (and server/runtime files to `runtime` where the neighbours are), per CONTRIBUTING.md. |
| DISCOVERY | — | D1: callers of the legacy `branch` action (`rg "type:'branch'\|\"branch\"" apps packages`). D2: whether the private git family holds `refs/remotes/*`. D3: whether the user's original checkout appears in `git worktree list` of the family. D4: where the store exposes the thread record to `action-outcomes.ts` for the run guard (it already reads `thread` in `authority()`). D5: whether the maintainer wants a capability flag (`packages/core/capability-flags.ts`) — default: none. D6: where App refreshes `/context` today for the composer (if nowhere, add a hook in T04). |

## DESIGN

### Data flow

1. Composer (T04) loads `ProjectContext` for the selected thread via `GET /api/projects/:projectId/context?threadId=` (same as `thread-hover/host.ts`). Reload triggers: thread or project change, a run finishing (`thread.runId` goes from non-null to null), window `focus`, and a confirmed branch action. Abort the previous request on change (copy the generation/abort pattern of `useProjectRequest`).
2. Opening the chip fetches `GET /api/projects/:projectId/branches?threadId=` (T03). Show a 3-row skeleton while loading (no spinner); keep the popover size fixed.
3. Picking a row posts an envelope to `POST /api/projects/:projectId/actions` with a fresh `crypto.randomUUID()` id, `threadId`, and the payload below. The response's confirmed receipt carries the new status; the client then reloads context and emits a `gen:workspace-changed` window event `{projectId, threadId}` that the Changes panel and hover host listen to (T04 adds listeners; if an equivalent event already exists, reuse it and record that in the PR).

### Contracts (`packages/contracts/workspace-action-outcomes.ts` and new `packages/contracts/workspace-branches.ts`)

```ts
// workspace-action-outcomes.ts
export const workspaceActionTypeSchema = z.enum(['stage','unstage','commit','review-pr','create-pr','switch-branch','create-branch']);
const branchName = z.string().min(1).max(250).refine(unicode).refine(v => !v.includes('\0'));
// added to workspaceActionPayloadSchemas:
'switch-branch': z.strictObject({ ...local, branch: branchName, source: z.enum(['local','remote']), bringChanges: z.boolean() }),
'create-branch': z.strictObject({ ...local, name: branchName }),

// workspace-branches.ts (read model)
export const branchEntrySchema = z.strictObject({
  name: z.string(),            // 'feature/x' or 'origin/feature/x'
  head: oid, subject: z.string().max(200), committedAt: z.string(), // ISO 8601
  upstream: z.string().nullable(), current: z.boolean(),
  occupiedBy: z.enum(['this','other']).nullable(),
});
export const branchListSchema = z.strictObject({
  current: z.string().nullable(), head: oid.nullable(), revision, detached: z.boolean(),
  dirty: z.strictObject({ tracked: z.number().int().min(0), untracked: z.number().int().min(0) }),
  canSwitch: z.boolean(), reason: z.enum(['run-active','read-only','no-git']).nullable(),
  local: z.array(branchEntrySchema).max(500), remote: z.array(branchEntrySchema).max(500),
  truncated: z.boolean(),
});
```

`source:'remote'` with `branch:'origin/foo'` means R5. `bringChanges` must be `true` whenever the preflight status is dirty; otherwise the server returns not-applied with `DIRTY_TREE` (the UI never sends that, it shows the confirm). The local comparison recorded for these operations uses `scope:'worktree'`, `branch` = the branch before the action.

### Backend (`packages/workspace/tools.ts`)

- `branches(projectId, threadId)`: inside `exclusive(projectId)` and `withGitOperation(..., write=false)`: run `git for-each-ref --format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)%00%(upstream:short)%00%(contents:subject) --sort=-committerdate --count=501 refs/heads` and the same for `refs/remotes` (skip `refs/remotes/*/HEAD`); `git worktree list --porcelain -z` to map `branch refs/heads/<x>` to worktree paths (path equal to this binding's path → `this`, else `other`); dirty counts from the existing `status`. `canSwitch=false` with `reason` for run-active (read the thread record), read-only (`gitWrite !== true`) or no-git.
- `gitAction` new cases (inside the existing `withGitOperation(..., true)` write path, after its revision check):
  - Shared preflight: thread has no active run (`RUN_ACTIVE`); `validateBranch(name)` = `git check-ref-format --branch <name>` exit 0 and output equals the name (`INVALID_BRANCH_NAME` otherwise, with the reason computed by a pure JS mirror of the rules for the message only); target not occupied by another worktree (`BRANCH_IN_USE`); dirty tree requires `bringChanges` (`DIRTY_TREE`).
  - `switch-branch` local: `git switch --no-guess <branch>` (validation guarantees the name cannot start with `-`, so it cannot be read as an option). On non-zero exit whose stderr contains "would be overwritten" or "Please commit your changes or stash them", map to not-applied `BRANCH_CONFLICT`. Verify afterwards that `git branch --show-current` equals the target, else uncertain.
  - `switch-branch` remote: if `refs/heads/<short>` exists, treat as local switch of `<short>`; else `git switch --track <remote>/<short>`.
  - `create-branch`: `git show-ref --verify --quiet refs/heads/<name>` must fail (`BRANCH_EXISTS`); then `git switch -c <name>`.
- Leave the legacy `branch` case unchanged.

### Action service (`packages/workspace/action-outcomes.ts`)

Route `switch-branch` and `create-branch` like `stage`/`commit` to `projects.gitAction`, with the same intent → started → confirmed/not-applied persistence. Not-applied results carry the error code. `inspect` for these operations is confirmed when `branch --show-current` equals the target and HEAD equals the target ref's object; not-applied when branch and HEAD still equal the recorded pre-action values; otherwise uncertain. Never retry automatically.

### Server route (`apps/server/workspace-routes.ts`)

Add `GET /api/projects/:projectId/branches` next to `/git` (line 47) with the same `querySchema`, `Cache-Control: no-store`, and response validated by `branchListSchema` before sending. Typed actions need no route change beyond the enum (they go through `actionOutcomes.execute`); map `RUN_ACTIVE`, `BRANCH_IN_USE`, `BRANCH_CONFLICT`, `BRANCH_EXISTS`, `INVALID_BRANCH_NAME`, `DIRTY_TREE` to HTTP 409 with `{code, message, state, operationId}`.

### Visual design and motion

- **Chip.** New `ComposerBranchChip` component in `apps/web/src/ComposerBranchChip.tsx`, rendered inside `.composer-project-controls` directly after the project chip. Reuses `.composer-context-chip` plus `.composer-branch`. Contents: the existing `branch` glyph (12×12, colour `var(--muted)`; the Create PR chip keeps its accent colour so the two are distinguishable), then the name in a `<span>` with `max-width: 160px; overflow:hidden; text-overflow:ellipsis`, then a 10×10 chevron-down glyph at 60% opacity. Monospace is not used; keep the toolbar font. Dirty indicator: a 6px dot `var(--warning, var(--accent))` before the chevron when `dirty.tracked + dirty.untracked > 0` (from context totals), with sr-only text "uncommitted changes". Detached: italic label. Disabled (run active): `opacity:.55`, `cursor:not-allowed`, still focusable for the tooltip (`aria-disabled`, not `disabled`).
- **Responsive.** Container ≤ 610px: name max-width 110px. ≤ 355px: glyph and chevron only; name moves to tooltip and accessible name.
- **Popover.** `Popover` from `packages/ui-shell/Popover.tsx`, `width=360`, `height=420`, `preferredSide="top"`, align start to the chip. Layout top to bottom: search input (32px), scrollable list, divider, sticky "Create branch from here" row (36px) that expands in place into a name input + "Create" button + Cancel. Rows 32px: check glyph column (16px, only on current), name (ellipsis, full name in `title`), right-aligned muted meta "`<sha7>` · 3d ago" (relative time via the existing formatter if one exists, else `Intl.RelativeTimeFormat`), disabled rows show "In use by another thread" instead of meta. Section headings "Local" and "Remote" 10px uppercase muted, 24px tall. Search matches are highlighted with `<mark>` using the existing mark token. Empty search: "No branches match "<query>"." plus the Create row prefilled with the query.
- **Dirty confirm.** Replaces the list area inline (no nested overlay): one sentence, primary button "Bring changes", secondary "Cancel"; focus moves to "Bring changes"; Escape returns to the list with the row still active.
- **Motion.** Popover open/close uses the existing `.ui-popover` animation (`--ui-motion-popup-enter` 180ms / `--ui-motion-popup-exit` 140ms, `--ui-ease-enter`/`--ui-ease-move`); keep it present 140ms on close like ModelPicker. Chip hover: background to `var(--control-hover)` over `--ui-motion-hover` (fine pointers only, existing rule). Press: existing `.97` scale with `data-pointer-pressed`. List rows on first open: opacity 0→1 and translateY 2px→0, `--ui-motion-insert` with `--ui-motion-stagger` 30ms for the first 8 rows only. Create row expand: height animates over `--ui-motion-panel-enter` 220ms. Pending action: the picked row shows a 12px indeterminate ring in place of the check (opacity pulse, `--ui-motion-status`), the list is `aria-busy="true"`. Success: popover closes; chip label crossfades old→new name (old fades out 80ms, new fades in 160ms, `--ui-ease-move`) and the glyph gets a one-shot accent tint for `--ui-motion-success` 240ms, announced via a polite live region "Switched to <branch>". Error: inline alert slides in 4px over `--ui-motion-status`. With OS or app Reduce motion, or panel animations off: no transforms or stagger, opacity changes only at `--ui-motion-press` duration, and the crossfade becomes an instant swap.
- **Theme.** Only semantic tokens (`--control-border`, `--surface`, `--muted`, `--text`, `--accent`, `--control-hover`); no fixed hex values; check contrast with `tests/theme-contrast.test.ts` helpers.

### Error, cancel, retry

Closing the popover while an action is pending does not cancel it; the chip shows the pending ring until the response arrives, then the success/error state. A network failure before a response is treated as uncertain: the chip offers "Check branch" (reload context + list); no automatic resend. Every new attempt after a not-applied or uncertain result uses a new envelope id, because the preflight revision and HEAD change; the old id is only ever replayed by the server's idempotency check.

### Migration and rollback

No stored-data migration. Rollback is reverting the PR; existing operations recorded with the new types remain readable only if the enum keeps them, so a revert must keep the enum values (document this in the PR).

## EXECUTION_DAG

| ID | Goal | Depends on | Files / steps | Tests (positive / negative) | Done when | Handoff |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | Discovery + contracts | — | Resolve D1–D6 and record results as an issue comment. Add `switch-branch`/`create-branch` to `workspaceActionTypeSchema` and payload schemas; add `packages/contracts/workspace-branches.ts`; manifest entry. | Contract tests in `tests/workspace-action-outcomes.test.ts`: valid payloads parse; reject names with NUL, > 250 bytes, invalid UTF-8, extra keys, bad oid/revision. | Schemas exported, `pnpm typecheck` passes, discovery comment posted. | T02, T03 |
| T02 | Backend list + actions | T01 | `packages/workspace/tools.ts` `branches()` and new `gitAction` cases; `packages/workspace/action-outcomes.ts` routing and `inspect`. | `tests/project-tools.test.ts` with real temp repos: list order, current first, caps + `truncated`, occupancy `other` from a second worktree, remote refs (or empty per D2); clean switch; dirty + bringChanges carries a non-conflicting edit; conflicting edit → `BRANCH_CONFLICT` and status byte-identical; `BRANCH_IN_USE`; `RUN_ACTIVE`; `INVALID_BRANCH_NAME` for `-x`, `a..b`, `x.lock`, `a b`, `foo/`, `@{x`; `BRANCH_EXISTS`; legacy copy → `CAPABILITY_DENIED`; delegate/side thread rejected; same-id replay; uncertain inspection never retries. | All new tests pass; existing `project-tools` and action-outcome tests pass. | T03 |
| T03 | Route | T02 | `apps/server/workspace-routes.ts`: `GET /branches`; 409 mapping for new codes. | `tests/workspace-action-outcome-routes.test.ts`: list happy path, response schema, `no-store`; each error code's status/body; CSRF and origin hooks still enforced on POST. | Route tests pass. | T04 |
| T04 | Web data layer | T03 | New `apps/web/src/useThreadBranch.ts` (context load + reload triggers, branch list fetch, action post, `gen:workspace-changed` event); listeners in `WorkspaceSurfaceBody.tsx` `DiffBody` and `thread-hover/host.ts` (reload on event). | Unit test with mocked fetch: aborts stale loads on thread change; reloads after run finishes; action success emits the event; uncertain path never re-posts. | Hook tested; no UI yet. | T05 |
| T05 | Chip + popover UI | T04 | `apps/web/src/ComposerBranchChip.tsx`, `apps/web/src/composer-branch.css` (or additions to `composer-toolbar.css`), props wired in `ComposerToolbar.tsx` and both `App.tsx` call sites; manifest entries. Follow DESIGN exactly. | New `tests/e2e/composer-branch.spec.ts` (add to the `model-picker` or `workspace` suite in `scripts/browser-suites.ts`): chip shows branch; hidden without git; detached label; search filters; keyboard nav/Escape; clean switch updates chip and Changes panel; dirty confirm; conflict message + "Open Changes"; disabled while working; "In use by another thread" row; create valid/invalid/existing; read-only note; narrow widths 610/355; reduced motion. `pnpm lint:ui` and `pnpm test:ui-guard` clean. | All browser tests and guards pass locally. | T06 |
| T06 | Validation + evidence | T05 | Run the VALIDATION commands; measure list latency on a 1,000-branch fixture; capture screenshots (light/dark/high-contrast, narrow) and a short recording of switch, bring changes, conflict and create; attach to the implementation PR. | Full commands below. | Acceptance matrix A1–A11 all PASS with evidence links in an issue checkpoint. | T07 |
| T07 | Front end team review | T06 | Send the finished work (PR link, screenshots, recording, this plan's DESIGN section) to the front end team for review, post the request as an issue comment, and apply their feedback in the same PR before asking for merge. | — | Front end team review requested and its feedback resolved or recorded on the issue. | Maintainer |

Ownership: T02 owns `packages/workspace/*`; T03 owns `apps/server/workspace-routes.ts`; T04/T05 own `apps/web/src/*` and `tests/e2e/composer-branch.spec.ts`. T01's contract edits land first; no two tasks edit the same file except the manifest (append in task order, keep sorted).

## VALIDATION

Planned (none executed for this plan):

```sh
pnpm install
pnpm typecheck
pnpm lint:ui
pnpm test:ui-guard
pnpm exec vitest run tests/project-tools.test.ts tests/workspace-action-outcomes.test.ts tests/workspace-action-outcome-routes.test.ts tests/workspace-action-outcome-authority.test.ts tests/keyboard-bindings.test.ts tests/theme-contrast.test.ts
pnpm test:browser --suite model-picker
pnpm test:browser --suite composer-press
pnpm test:browser --suite micro-motion
pnpm test:browser --suite workspace
pnpm test:browser --suite ui-shell-overlays
```

Fixtures: temporary git repos created in tests (main + 3 branches, a second worktree holding one branch, a conflicting uncommitted edit, a non-conflicting edit, an untracked file, a detached HEAD, 1,000 generated branches for the cap/latency case). No real user repositories or credentials.

| ID | Acceptance check | Requirement |
| --- | --- | --- |
| A1 | Chip shows live branch in both composer layouts; hidden without git; detached shows `Detached · sha7`. | R1 |
| A2 | `GET /branches` matches the schema, order and caps; `truncated` set at 501+. | R2 |
| A3 | Search, sections, keyboard and IME behaviour as specified; axe has no violations on the open popover. | R3 |
| A4 | Clean switch confirmed; chip, hover fact and Changes panel show the new branch. | R4, R9 |
| A5 | Dirty switch requires "Bring changes"; non-conflicting edit carried; conflict refused with status unchanged byte-for-byte. | R4 |
| A6 | Remote pick creates a tracking local branch, or switches to the existing local one; Remote hidden when empty. | R5 |
| A7 | Create validates with Git rules, refuses existing names, creates from HEAD and switches. | R6 |
| A8 | Server refuses `RUN_ACTIVE`, `BRANCH_IN_USE`, `CAPABILITY_DENIED`, `REVISION_CHANGED` even when called directly; UI mirrors each. | R7 |
| A9 | Same-id replay returns the stored result; uncertain is inspectable and never retried. | R8 |
| A10 | The next agent turn after a switch runs on the new branch (verify with a turn that runs `git branch --show-current`). | R9 |
| A11 | Visual and motion spec met in light, dark, high contrast and Reduce motion; screenshots attached. | R10 |
| A12 | Evidence attached and front end team review requested. | R11 |

Release gate: all of A1–A12 PASS, hosted CI green, repository review approved, front end team feedback resolved.

## STATE

- Researched and decided: everything in this plan, at revision r1.
- Implemented: nothing. Verified: nothing. Owners/branches: none yet.
- Risks: remote refs may be absent from the private family (D2) and reduce R5 to an empty state; Git error text used for `BRANCH_CONFLICT` detection can vary by Git version and locale, so T02 must also confirm via unchanged `branch --show-current` and HEAD, and set `LC_ALL=C` / `LANG=C` in the git environment for that call if `nativeGit` allows environment overrides; the legacy `branch` action stays as a second path to create branches.
- Next step: T01, starting with discovery items D1–D6.

## REFERENCES

- Baseline: [Gen-V1 main 8fa907f](https://github.com/skytuhua-org/Gen-V1/commit/8fa907f378127bcfc23d71b55c53625ffc43e8da); contract for plans and checkpoints: [AGENTS.md](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/AGENTS.md).
- [Codex: always-visible branch and direct selection (#58814)](https://github.com/openai/codex/issues/58814): users want the current branch always visible and switchable from the input area.
- [Codex: show current branch (#58371)](https://github.com/openai/codex/issues/58371): the branch the agent works on should be visible before sending.
- [Claude Code: choose a branch without a worktree (#104502)](https://github.com/anthropics/claude-code/issues/104502): switching branches directly instead of creating a new worktree.
- [Claude Code: switch blocked when the branch is held by a worktree (#85543)](https://github.com/anthropics/claude-code/issues/85543): the source of R7b; the picker must explain that a branch is checked out elsewhere instead of failing silently.
- Git: `git switch` carries local modifications to the new branch when they do not conflict and refuses otherwise; `git check-ref-format --branch` applies Git's branch-name rules ([git-switch docs](https://git-scm.com/docs/git-switch), [git-check-ref-format docs](https://git-scm.com/docs/git-check-ref-format)).
