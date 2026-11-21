# Sub-plan: Publish contracts, service and routes (parent #1235 tasks T03–T05)

## META
- Feature: Publish — server-side slice (contracts, `PublishService`, routes).
- Repo: skytuhua-org/Gen-V1. Parent issue: #1235 (plan `docs/agent-plans/thread-publish-pr.md` r1).
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52`.
- Status: NOT_STARTED. Depends on sub-issue "Discovery + capability flag" (T01–T02).

## OBJECTIVE
The durable operation behind Publish: deterministic draft, fenced step execution (commit → push+PR → link), and read/recovery state, exposed over the existing workspace routes.

## REQUIREMENTS (from parent)
- R2 Publish review data: managed branch, changed files (path, +/−, untracked marker), commit message, base branch (GitHub default, editable), PR title/body via the R5 template.
- R4 One approval runs steps in order, each recording a receipt and state NOT_STARTED/CONFIRMED/NOT_APPLIED/UNCERTAIN.
- R5 Draft text: commit subject = thread title truncated to 72 chars; PR title same; PR body = summary line + changed-file list with +/− + "Created from Gen V1 thread <thread title>" + plan items when present.
- R9 Recovery data: `read` returns the latest operation for the thread.
- Errors: `GITHUB_AUTH_REQUIRED`, `GITHUB_REMOTE_REQUIRED`, `PROJECT_READ_ONLY`, `REVISION_CHANGED`, `BRANCH_REQUIRED`, `UNCERTAIN` (inspect, never auto-retry), push rejected → "The GitHub branch changed. Refresh and review again."
- Token stays in `GitHubAuth`; PR body via the existing private input file in `withInput`. No new egress.

## DESIGN (from parent, normative)
- Contracts `packages/contracts/workspace-publish.ts` (new): `PublishDraftV1`, `PublishRequestV1`, `PublishOperationV1` shapes exactly as in the parent DESIGN section; Zod schemas follow `workspace-action-outcomes.ts` (regexes, unicode refinement, title 200 / body 64000 / message 4000).
- `PublishService` in new `packages/workspace/publish.ts`:
  - `draft(projectId, threadId)`: flag + `gitWrite` required; `gitStatus`, `GitHubTools.defaultBranch()` (new: `gh repo view <repo> --json defaultBranchRef`, fallback `main` plus a visible note), thread title, plan items → R5 template.
  - `execute(projectId, request)`: store `PublishOperationV1` (store kind `workspacePublish`) before any write; steps run through `WorkspaceActionOutcomes.execute` with derived command ids `<id>:stage`, `<id>:commit`, `<id>:pr`. Push runs inside `create-pr` (`push:true`) so push+PR share one fenced outcome. After `create-pr` confirmed, call the existing `link-pr` path.
  - Fences: `revision` must equal the reviewed one before commit; after commit, the new head becomes PR head/revision. An uncertain outcome stops the run, never retried.
  - `read(projectId, threadId)`: latest operation for the thread.
- Routes in `apps/server/workspace-routes.ts`: `GET /api/projects/:id/publish/draft?threadId=`, `POST /api/projects/:id/publish` (`no-store`, 128 KB body), `GET /api/projects/:id/publish?threadId=`; all `CAPABILITY_DENIED` when flag off; existing host/origin/cookie/CSRF hooks.
- Rollback: flag off hides UI; stored records inert.

## EXECUTION_DAG
| ID | Goal | Depends | Edits | Tests | Done when |
|---|---|---|---|---|---|
| T03 | Contracts | T02 | new `packages/contracts/workspace-publish.ts`; export per pattern; add to `scripts/public-source-files.json` | schema accepts valid, rejects NUL/unicode/length/bad oid | lands in same PR as T04 |
| T04 | `GitHubTools.defaultBranch()` + `draft()` | T03 | `packages/workspace/github.ts`, `packages/workspace/publish.ts` | fake gh: branch parsed; fallback sets note; template has file list; read-only → `PROJECT_READ_ONLY` | new `tests/workspace-publish.test.ts` passes |
| T05 | `execute`/`read` + routes | T04 | `packages/workspace/publish.ts`, `apps/server/workspace-routes.ts` | happy path confirmed+linked; revision change → nothing written; uncertain create-pr → stops; duplicate id → same result; flag off → 403; CSRF/origin (pattern `tests/workspace-linked-pr.test.ts`) | all pass; existing tests unchanged |

## VALIDATION
`pnpm typecheck`; `pnpm exec vitest run tests/workspace-publish.test.ts tests/github-workspace.test.ts tests/workspace-linked-pr.test.ts tests/workspace-action-outcome-routes.test.ts --maxWorkers=1`. Fixtures: temp git repo + fake `origin` + fake gh (pattern `tests/github-workspace.test.ts`).

## STATE / HANDOFF
- Handoff to: publish-review-UI sub-issue (T06), PR-card sub-issue (T07), optional model-draft sub-issue (T11).
- Claim on #1235 first; RELEASE checkpoint on stop.
