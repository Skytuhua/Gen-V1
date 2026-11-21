# Sub-plan: Publish review UI structure (parent #1235 task T06)

## META
- Feature: Publish — review sheet and composer chip (structure only, no visual design).
- Repo: skytuhua-org/Gen-V1. Parent issue: #1235 (plan `docs/agent-plans/thread-publish-pr.md` r1). Design/animation is owned by the front-end team (T09 spec: `docs/agent-plans/1235-publish-design.md`); build structure, states, accessibility and behaviour only.
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52`.
- Status: NOT_STARTED. Depends on sub-issues T01–T02 (flag + card-placement answer) and T03–T05 (routes).

## OBJECTIVE
One "Publish" action from a thread with a managed copy opens a review of exactly what will be sent; one approval runs the operation.

## REQUIREMENTS (from parent)
- R2 review sheet: managed branch, changed files (path, +/−, untracked marker), commit message, base branch (editable, default = GitHub default), PR title/body prefilled by the R5 template.
- R3 whole-file include/exclude via existing `stage`/`unstage`; hunk-level only when `workspace.provenanceV1` is on.
- R8 composer "Create PR" chip (`ComposerToolbar.tsx` `ComposerTaskActions`, `App.tsx` `preparePR`): flag on + writable managed copy → opens the review instead of inserting prompt text; otherwise current behaviour unchanged.
- UX/a11y: keyboard-operable; approval button names the action ("Commit, push and open draft PR"); step progress `role="status"`; `GITHUB_AUTH_REQUIRED` shows `GitHubSignIn` inline; `REVISION_CHANGED` → re-review.
- Performance: draft loads in one `gitStatus` + one `defaultBranch` call.

## EXECUTION_DAG
| ID | Goal | Depends | Edits | Tests | Done when |
|---|---|---|---|---|---|
| T06 | Publish review UI (structure only) | T05, T01 | new `apps/web/src/PublishReview.tsx`, `apps/web/src/publish-api.ts`; `ComposerToolbar.tsx` (`onPublish`), `App.tsx` wiring | Playwright `tests/e2e/publish-thread.spec.ts` (route mocks, pattern `m08-pr-checks.spec.ts`): chip opens review when flag on; chip inserts prompt when off; fields prefilled; excluding a file updates the list; sign-in required shows `GitHubSignIn`; keyboard-only approval | spec passes; `pnpm lint` passes |

Draft persists in the panel journal (same pattern as `prJournalSchema`) so edits survive reload. Coordinate `App.tsx` wiring with the T07 worker via #1235 comments.

## VALIDATION
`pnpm typecheck`; `pnpm lint`; `pnpm build && pnpm exec playwright test tests/e2e/publish-thread.spec.ts`.

## STATE / HANDOFF
- Handoff to: recovery-UI sub-issue (T08) and T09 design application.
- Claim on #1235 first; RELEASE checkpoint on stop.
