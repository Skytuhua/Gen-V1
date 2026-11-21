# Sub-plan: Recovery UI (parent #1235 task T08)

## META
- Feature: Publish — uncertain-state recovery in the review sheet and card.
- Repo: skytuhua-org/Gen-V1. Parent issue: #1235 (plan `docs/agent-plans/thread-publish-pr.md` r1). Design owned by front-end team (T09 spec: `docs/agent-plans/1235-publish-design.md`).
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52`.
- Status: NOT_STARTED. Depends on sub-issues T06 and T07.

## OBJECTIVE
If the app closes or a step ends UNCERTAIN, reopening the thread shows the operation's last confirmed step, offers "Check what happened", and allows "Continue from <next step>" only once the predecessor is CONFIRMED or NOT_APPLIED.

## REQUIREMENTS (from parent)
- R9 recovery: uses `GET /api/projects/:projectId/action-outcomes/inspect`; never auto-retries an uncertain step; errors are plain sentences naming the next action (matching `HarnessError` style).
- State transitions (normative): `not-started → confirmed | not-applied | uncertain`; `uncertain → confirmed | not-applied` only via inspect; continue only from a step whose predecessor is confirmed.

## EXECUTION_DAG
| ID | Goal | Depends | Edits | Tests | Done when |
|---|---|---|---|---|---|
| T08 | Recovery UI | T06, T07 | `apps/web/src/PublishReview.tsx` and/or `ThreadPullRequestCard.tsx` | Playwright: an uncertain step shows "Check what happened", calls inspect, and "Continue" appears only after a confirmed predecessor | spec passes |

## VALIDATION
`pnpm typecheck`; `pnpm lint`; `pnpm build && pnpm exec playwright test` on the publish spec(s).

## STATE / HANDOFF
- Handoff to: verification sub-issue (T10).
- Claim on #1235 first; RELEASE checkpoint on stop.
