# Sub-plan: In-thread PR card and check follow-up (parent #1235 task T07)

## META
- Feature: Publish — in-thread PR card with live checks.
- Repo: skytuhua-org/Gen-V1. Parent issue: #1235 (plan `docs/agent-plans/thread-publish-pr.md` r1). Design/animation owned by front-end team (T09 spec: `docs/agent-plans/1235-publish-design.md`); structure and behaviour only.
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52`.
- Status: NOT_STARTED. Depends on sub-issues T01–T02 (flag + card-placement answer) and T03–T05 (routes).

## OBJECTIVE
After a successful publish, the thread shows a card with the PR link and live check status, surviving reload.

## REQUIREMENTS (from parent)
- R6 card shows: PR number/title, "View on GitHub" link, draft state, check summary (reuse `checkSummary`/`normalizeChecks`), "Refresh checks", "Open in Pull request panel". Backed by the stored linked PR + publish operation record.
- R7 refresh on demand; while visible, auto-refresh every 30 s for up to 30 min after creation, then stop; never poll while the window is hidden.
- Card placement: per the T01 answer — append to the thread if host-authored cards are supported, else composer dock above the task actions.

## EXECUTION_DAG
| ID | Goal | Depends | Edits | Tests | Done when |
|---|---|---|---|---|---|
| T07 | Thread PR card + check follow-up | T05, T01 | new `apps/web/src/ThreadPullRequestCard.tsx`; placement per T01; `App.tsx` wiring at a distinct point from T06's | Playwright: card shows number/title/link/check summary; refresh works; polling stops after 30 min (fake clock) and while hidden; card returns after reload | spec passes |

## VALIDATION
`pnpm typecheck`; `pnpm lint`; `pnpm build && pnpm exec playwright test` on the publish spec(s).

## STATE / HANDOFF
- Handoff to: recovery-UI sub-issue (T08) and T09 design application.
- Claim on #1235 first; RELEASE checkpoint on stop.
