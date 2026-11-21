# Plan: Real commit, push and PR from a thread

## META
- Feature: One reviewed action in a thread that commits the thread's changes, pushes its branch and opens a real GitHub draft PR, then tracks checks in the thread.
- Repo: skytuhua-org/Gen-V1
- Plan revision: r1, 2026-11-21 (UTC)
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52` (verified by `git rev-parse HEAD` after `git pull`)
- Existing issues/PRs: no open issue matches (searched "pull request worktree commit push"). Related scope: M08 managed workspaces (`docs/progress.md` row M08, flags off, not verified).
- Implementation status: NOT_STARTED. Approved by the owner (Leonardo) for planning only. Implementation needs a separate go-ahead.
- Source provenance: this plan comes from reading the repository at the baseline SHA, plus the competitor research listed in REFERENCES.
- **Design and animation owner: Leonardo's front-end team defines the visual design and animation for every new surface in this plan (publish review sheet, in-thread PR card, step-progress states, transitions). Implementing workers build the structure, states, accessibility and behaviour with existing tokens/components and add no new motion or visual styling until the front-end team's spec is linked on this issue (task T09).**

## OBJECTIVE
**User problem.** Gen's README PR demo is scripted ("The PR workflow simulates check results and merging; nothing is sent to GitHub", `README.md` line 57, `docs/public/media/launch-demos.md` line 72). The real building blocks exist but are spread over several surfaces. Today a user has to:
1. stage files and type a commit message in the Project context card (`apps/web/src/ProjectContextCard.tsx`, `commit` row),
2. open the Pull request panel and press "New draft PR" (`apps/web/src/WorkspaceSurfaceBody.tsx`, `PullRequestsBody`),
3. type a title and description, fix the base branch (hard-coded default `main`), tick "Push this reviewed branch to GitHub", and press "Create draft PR",
4. link the new PR to the thread by number by hand to see it later.

The composer's "Create PR" chip (`ComposerToolbar.tsx` `ComposerTaskActions`) only inserts the text "Create a pull request for the current changes." into the draft (`App.tsx` `preparePR`). The agent has no host tool for PR creation (no match in `packages/runtime-*`, `packages/agent-projection`, `packages/core`; to be confirmed in T01).

**Intended behaviour.** From a thread with a managed working copy, one "Publish" action opens a review of exactly what will be sent: files, commit message, branch, base, PR title and body (prefilled). One approval runs commit → push → create draft PR → link to thread as a single durable operation with per-step receipts. The thread then shows a PR card with the PR link and live check status. Every step is exact-revision fenced and recoverable, matching existing `create-pr` guarantees.

**Measurable success.**
- From a thread with uncommitted changes, a signed-in user reaches an open draft PR on GitHub with 1 review screen and 1 approval (down from 3 surfaces and at least 6 manual inputs today).
- The created PR's head SHA equals the reviewed local commit (already enforced by `GitHubTools.create`) and the PR is linked to the thread without manual entry.
- No step is ever blindly retried after an uncertain outcome; recovery uses the existing action-outcome inspection.
- Under default settings nothing changes: the feature is behind a new capability flag that is off by default.

## REQUIREMENTS
### In scope
- R1 Capability flag `workspace.publishV1`, default off. When off, every current surface behaves byte-for-byte as today.
- R2 Publish review: shows the thread's managed branch, the changed files (path, +/−, untracked marker), the commit message, the base branch (default: the repository's GitHub default branch, editable), and the PR title and body. Prefilled by the deterministic template (R5).
- R3 File selection: whole-file include/exclude via the existing `stage`/`unstage` actions. Hunk-level selection reuses `SelectiveCommitService` only when `workspace.provenanceV1` is on; otherwise it is not offered (out of scope to verify M08 here).
- R4 One approval runs the steps in order: (a) stage the selected files and commit (skipped when the tree is clean and the branch is ahead of base), (b) push `HEAD:refs/heads/<branch>`, (c) create the draft PR, (d) link the PR to the thread. Each step records a receipt and a state: NOT_STARTED / CONFIRMED / NOT_APPLIED / UNCERTAIN.
- R5 Draft text. The deterministic template is required. Commit subject = thread title (truncated to 72 chars). PR title = same. PR body = a short summary line, the changed-file list with +/−, "Created from Gen V1 thread <thread title>", and the plan items if the thread has a task plan. An optional model-drafted text (R11) may replace the template only after the user accepts it.
- R6 In-thread PR card after success: PR number/title, link "View on GitHub", draft state, check summary (reuse `checkSummary`/`normalizeChecks`), "Refresh checks", and "Open in Pull request panel". The card survives reload (it is backed by the stored linked PR plus the publish operation record).
- R7 Check follow-up: refresh on demand. While the card is visible, auto-refresh every 30 s for up to 30 min after creation, then stop. Never poll while the window is hidden.
- R8 Composer "Create PR" chip: when R1 is on and the thread has a writable managed copy, it opens the publish review instead of inserting prompt text. Otherwise current behaviour stays.
- R9 Recovery: if the app closes or a step is uncertain, reopening the thread shows the operation with its last confirmed step and offers "Check what happened" (uses `/api/projects/:projectId/action-outcomes/inspect`), then "Continue from <next step>" only once the previous step is CONFIRMED or NOT_APPLIED.
- R10 Docs: once verified, update the README demo sentence and `docs/public/media/launch-demos.md` to describe the real flow. The scripted demo stays labelled as scripted until a real recording exists.
- R11 (optional, last) Model-drafted commit message and PR body. Uses the thread's selected account/model in a tool-free request, like composer predictions. Shown as a suggestion the user must accept. Off unless the user turns it on.

### Out of scope
- Merging PRs, auto-merge, force-push, rebases, conflict resolution, GitHub Enterprise hosts, non-GitHub remotes, signing commits (existing code passes `commit.gpgsign=false`), forks or cross-repo PRs, issue linking, and the agent creating PRs without the user's approval.
- Verifying or turning on the M08 flags. Changing the GitHub sign-in flow (`GitHubAuth` device flow stays as is).
- Visual design and animation of new surfaces. That belongs to the front-end team (T09).

### Agreed decisions vs proposed options
- Agreed by the owner: build this feature (planning approved). The front-end team defines animation and design.
- Proposed (plan defaults, overridable on this issue): the PR is always created as a draft (matches `GitHubTools.create`, which passes `--draft`). Whole-file selection in v1. Deterministic template before any model drafting. Flag name `workspace.publishV1`.

### UX, accessibility, errors
- Review and card are keyboard-operable. The approval button names the action ("Commit, push and open draft PR"). Step progress uses `role="status"` with text per step. Errors are plain sentences that name the next action, matching existing `HarnessError` messages.
- Known errors to surface: `GITHUB_AUTH_REQUIRED` (show `GitHubSignIn` inline), `GITHUB_REMOTE_REQUIRED`, `PROJECT_READ_ONLY`, `REVISION_CHANGED` (re-review), `BRANCH_REQUIRED`, `UNCERTAIN` (inspect, never auto-retry), push rejected (remote branch moved: "The GitHub branch changed. Refresh and review again.").
- Security and privacy: the token stays in `GitHubAuth` (DPAPI-protected) and in the existing redacting `run()`. PR body text goes through the existing private input file in `withInput`. No new egress except GitHub endpoints already used.
- Performance: the review loads in one `gitStatus` plus one `defaultBranch` call. Diff bodies are not re-sent to the client beyond the existing status payload.
- Compatibility: Windows x64 only (bundled `gh.exe`), like today.

## REPO_MAP (verified at baseline unless marked DISCOVERY)
| Area | Path | What is there today |
|---|---|---|
| Per-thread worktree | `packages/workspace/tools.ts` `prepareWorkspace` | Creates `dataDir/worktrees/<id>` on branch `gen/<threadId>-<id8>` for project threads with a git root. `gitStatus` gives `gitWrite:true` only for managed copies. `gitAction` supports `stage`, `unstage`, `commit` (`-c commit.gpgsign=false commit -m`) and `branch`. |
| GitHub tools | `packages/workspace/github.ts` `GitHubTools` | `repo()`, `list()`, `create()` (optional push with gh credential helper, remote ref check, `gh pr create --draft`, head verification), `details()` (checks via `statusCheckRollup`), `review()`, `comparison()`. The base defaults to `'main'`. |
| GitHub sign-in | `packages/workspace/github-auth.ts`, `apps/server/github-auth-routes.ts`, `apps/web/src/GitHubSignIn.tsx` | Device flow, scope `repo read:org`, profile-private credential. |
| Action outcomes | `packages/workspace/action-outcomes.ts`, `packages/contracts/workspace-action-outcomes.ts` | Durable, idempotent `stage`/`unstage`/`commit`/`review-pr`/`create-pr` with confirmed/not-applied/uncertain/revoked states and `inspect`. |
| Routes | `apps/server/workspace-routes.ts` | `/api/projects/:id/git`, `/pull-requests`, `/pull-requests/:n`, `/actions` (outcome actions plus `link-pr`, `branch`, …), `/action-outcomes/inspect`. |
| Selective commit | `packages/workspace/selective-commit.ts` | Hunk-exact commit with a private index. **No HTTP route found** (DISCOVERY in T01: confirm and decide whether to expose it behind `workspace.provenanceV1`). |
| Flags | `packages/core/capability-flags.ts` | `hostDefinitions` and per-milestone key unions (`M08FlagKey`, …). |
| PR panel UI | `apps/web/src/WorkspaceSurfaceBody.tsx` `PullRequestsBody` | Draft form (title, base, body, push), journal-backed recovery (`prJournalSchema`), checks list, review compose. |
| Commit UI | `apps/web/src/ProjectContextCard.tsx` | Commit message form calling `commit`. |
| Composer chip | `apps/web/src/ComposerToolbar.tsx` `ComposerTaskActions`; `apps/web/src/App.tsx` `preparePR` | "Create PR" inserts prompt text. |
| Thread hover PR facts | `apps/web/src/thread-hover/facts.ts` | Shows linked PRs. |
| In-thread typed controls | `packages/ui-catalog/software-development.ts`, `workflow.ts` | Catalog components used by agent-rendered UI. DISCOVERY (T01): whether a host-authored (not model-authored) card can be appended to a thread, or whether the PR card must live in the thread header/composer dock. |
| Agent PR tool | — | DISCOVERY (T01): confirm the agent has no PR/push tool, so the chip's prompt cannot complete a PR today. |
| Tests | `tests/github-workspace.test.ts`, `tests/workspace-linked-pr.test.ts`, `tests/selective-commit-v3.test.ts`, `tests/workspace-action-outcome-routes.test.ts`, `tests/e2e/m08-pr-checks.spec.ts`, `tests/e2e/shared-panels-fixture.tsx` | Existing unit and Playwright coverage to extend. |
| Source manifest | `scripts/public-source-files.json` | Every new source file must be added (CONTRIBUTING.md). |

## DESIGN
**Contracts (`packages/contracts/workspace-publish.ts`, new).**
- `PublishDraftV1 = {version:1, projectId, threadId, branch, head, revision, base, files:[{path,added,removed,untracked}], commitMessage, title, body}`
- `PublishRequestV1 = {id, threadId, head, revision, selectedPaths[], commitMessage, title, body, base}`
- `PublishOperationV1 = {id, owner:{projectId,threadId}, createdAt, request, steps:{commit,push,pr,link}: {state:'not-started'|'confirmed'|'not-applied'|'uncertain', receiptId?, at?, error?}, result?:{url, number, head, repo}}`
- Zod schemas follow `workspace-action-outcomes.ts` (identifier/oid/revision regexes, unicode text refinement, same max lengths: title 200, body 64000, message 4000).

**Server (`packages/workspace/publish.ts`, new `PublishService`).**
- `draft(projectId, threadId)`: requires the flag and `gitWrite`. Reads `gitStatus`, `GitHubTools.defaultBranch()` (new: `gh repo view <repo> --json defaultBranchRef`, with a fallback to `main` plus a visible note), the thread title and the plan items. Builds the R5 template.
- `execute(projectId, request)`: stores `PublishOperationV1` (store kind `workspacePublish`) before any write. Then runs the steps in order through `WorkspaceActionOutcomes.execute` with derived command ids `<id>:stage`, `<id>:commit`, `<id>:pr`, so the existing idempotency and receipts are reused. Push is done inside `create-pr` (`push:true`), so push and PR share one fenced outcome. The plan keeps them as one step "push + PR", with the sub-state taken from the error code. After `create-pr` is confirmed, it calls the existing `link-pr` path with the created number. Each transition updates the operation record in `service.store.internal(...)`.
- Fences: before commit, `revision` must equal the reviewed one. After commit, the new head becomes the PR `head`/`revision` (read from the commit outcome's returned status). An uncertain outcome stops the run and is surfaced, never retried.
- `read(projectId, threadId)`: returns the latest operation for the thread, for the card and recovery.

**Routes (`apps/server/workspace-routes.ts`).** `GET /api/projects/:id/publish/draft?threadId=`, `POST /api/projects/:id/publish` (`no-store`, body limit 128 KB), `GET /api/projects/:id/publish?threadId=`. All return `CAPABILITY_DENIED` when the flag is off. They sit under the existing host/origin/cookie/CSRF hooks.

**Web.** New `apps/web/src/PublishReview.tsx` (review sheet), `apps/web/src/ThreadPullRequestCard.tsx` (card), `apps/web/src/publish-api.ts`. The draft persists in the panel journal (same pattern as `prJournalSchema`) so edits survive a reload. `ComposerTaskActions` gets an optional `onPublish`. `App.tsx` wires it when `capabilities.pullRequests && flag`. Card placement follows the T01 discovery outcome: append to the thread if host-authored cards are supported, else show it in the composer dock above the task actions.

**State transitions.** `not-started → confirmed | not-applied | uncertain`. `uncertain → confirmed | not-applied` only via inspect. Continue is allowed only from a step whose predecessor is confirmed.

**Rollback.** Turning the flag off hides the new UI. Stored `workspacePublish` records are inert. Nothing deletes commits or remote branches.

## EXECUTION_DAG
| ID | Goal | Depends | Edits / discovery | Tests (positive / negative) | Done when | Handoff |
|---|---|---|---|---|---|---|
| T01 | Discovery: confirm the agent has no PR tool; confirm no route for `SelectiveCommitService`; find whether a host can append a typed card to a thread (search `packages/core/service.ts`, `packages/agent-projection`, thread message types in `packages/contracts`); read the M08 flag union shape | — | Read only. Post findings as a checkpoint comment | n/a | Comment lists each answer with file:line | T02, T06 |
| T02 | Add flag `workspace.publishV1` (default off) | T01 | `packages/core/capability-flags.ts` (definition plus key union) | Unit: flag is off by default; routes deny when off | `pnpm typecheck` passes; tests pass | T03 |
| T03 | Contracts | T02 | New `packages/contracts/workspace-publish.ts`; export from `packages/contracts/index.ts` if that is the pattern; add to `scripts/public-source-files.json` | Unit: schema accepts valid input, rejects NUL/invalid Unicode/over-length/bad oid | Schemas land with their readers (T04) in the same PR | T04 |
| T04 | `GitHubTools.defaultBranch()` and `PublishService.draft()` | T03 | `packages/workspace/github.ts`, new `packages/workspace/publish.ts` | Unit with fake gh: default branch is parsed; fallback to `main` sets a note; the template contains the file list; read-only copy → `PROJECT_READ_ONLY` | Tests in new `tests/workspace-publish.test.ts` pass | T05 |
| T05 | `PublishService.execute/read` plus routes | T04 | `packages/workspace/publish.ts`, `apps/server/workspace-routes.ts` | Unit/route: happy path (temp repo plus fake gh) reaches confirmed for all steps and links the PR; revision change before commit → nothing written; uncertain create-pr → stops, no retry; duplicate request id → same result (idempotent); flag off → 403; CSRF/origin hooks enforced (pattern from `tests/workspace-linked-pr.test.ts`) | All pass; no change to existing tests | T06, T07 |
| T06 | Publish review UI (structure only) | T05, T01 | New `apps/web/src/PublishReview.tsx`, `publish-api.ts`; `ComposerToolbar.tsx` (`onPublish`), `App.tsx` wiring | Playwright `tests/e2e/publish-thread.spec.ts` with route mocks (pattern: `m08-pr-checks.spec.ts`): chip opens the review when flag on; chip inserts the prompt when flag off; fields prefilled; excluding a file updates the list; sign-in required shows `GitHubSignIn`; keyboard-only approval | Spec passes; `pnpm lint` passes | T09 |
| T07 | Thread PR card plus check follow-up | T05, T01 | New `apps/web/src/ThreadPullRequestCard.tsx`; placement per T01 | Playwright: card shows number/title/link/check summary; refresh works; polling stops after 30 min (fake clock) and while hidden; card returns after reload | Spec passes | T09 |
| T08 | Recovery UI | T06, T07 | `PublishReview.tsx` / card | Playwright: an uncertain step shows "Check what happened", calls inspect, and "Continue" appears only after a confirmed predecessor | Spec passes | T10 |
| T09 | Front-end team design and animation spec | T06, T07 (structure exists to style) | Owned by Leonardo's front-end team. They define visual design and motion for the review sheet, step progress, card and transitions. Implementers then apply it | Visual review by the front-end team; reduced-motion respected | Spec linked on this issue and applied | T10 |
| T10 | Real-user verification and docs | T08, T09 | Windows x64 source build, signed-in test GitHub account, throwaway repo. Update `README.md` line 57 and `docs/public/media/launch-demos.md` only after passing | Manual: real draft PR created, head matches, checks appear; kill the app mid-push and recover | Evidence (redacted screenshots, PR URL on the test repo) posted on this issue | Owner |
| T11 (optional) | Model-drafted message/body (R11) | T05 | DISCOVERY: reuse the composer-prediction session owner (search `prediction` in `packages/core`) | Unit: the suggestion never enters fields without acceptance; disabled when the setting is off | Spec plus unit pass | Owner |

Parallel scopes: T06 and T07 touch different new files; both edit `App.tsx` only at distinct wiring points, so they should coordinate on that file through this issue.

## VALIDATION
- Setup: Windows x64, Node ≥ 24.10.0, pnpm 10.30.3, CPython 3.14 (README). `pnpm install`, `pnpm exec playwright install chromium`.
- Commands: `pnpm typecheck`; `pnpm lint`; `pnpm build:widgets && pnpm exec vitest run tests/workspace-publish.test.ts tests/github-workspace.test.ts tests/workspace-linked-pr.test.ts tests/workspace-action-outcome-routes.test.ts --maxWorkers=1`; `pnpm build && pnpm exec playwright test tests/e2e/publish-thread.spec.ts tests/e2e/m08-pr-checks.spec.ts`; `pnpm check:docs-links` when docs change.
- Fixtures: a temp git repo with a fake `origin` and a fake gh executable (pattern in `tests/github-workspace.test.ts`); Playwright route mocks (pattern in `tests/e2e/m08-pr-checks.spec.ts`).
- Regressions: the existing PR panel draft form, linking, review and checks are unchanged when the flag is off.
- Acceptance matrix: R1→T02/T05; R2→T04/T06; R3→T06; R4→T05; R5→T04; R6→T07; R7→T07; R8→T06; R9→T08; R10→T10; R11→T11. Each is checked by the tests named in its task.
- Release gate: all of the above pass in CI, the T10 real-user evidence is posted, and the owner approves turning the flag on. Planned tests are not executed yet.

## STATE
- Researched/decided: this plan (r1). Implemented: none. Verified: none. Pending: owner go-ahead for implementation; the front-end design/animation spec (T09).
- Owners: none assigned. Branches: none for code.
- Risks: (1) the M08 code is unverified and flags are off; this plan avoids depending on them except optional hunk selection. (2) The host-authored thread card may not exist (T01), which would move the card to the composer dock. (3) Push-rejection error codes from gh/git are generic today (`GITHUB_CLI_FAILED`); T05 may need clearer mapping.
- Exact next step: T01 discovery by the first implementing worker after the owner approves implementation.

## REFERENCES
- Repo docs: `README.md` (demo note, line 57), `docs/public/media/launch-demos.md` (line 72), `docs/progress.md` (M08 row), `CONTRIBUTING.md` (working agreements), `.github/pull_request_template.md`.
- Competitors making commit → push → PR a one-click core flow: T3 Code ("one-button commit, push and PR", per-thread worktrees) https://t3.codes/ and https://github.com/pingdotgg/t3code/ ; OpenAI Codex app (parallel agents in worktrees, review and create PRs) https://openai.com/index/introducing-the-codex-app/ .
- User trust: 87% of developers worry about agent accuracy and 81% about security/privacy (Stack Overflow 2025) https://stackoverflow.co/internal/resources/2025-stack-overflow-developer-survey-for-leaders/ai-agents/ . This supports the exact-revision review before any GitHub write.
