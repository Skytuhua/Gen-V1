# Sub-plan (optional): Model-drafted commit message and PR body (parent #1235 task T11)

## META
- Feature: Publish — optional model-drafted text for the commit message and PR body.
- Repo: skytuhua-org/Gen-V1. Parent issue: #1235 (plan `docs/agent-plans/thread-publish-pr.md` r1). This task is explicitly optional and last.
- Baseline: `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52`.
- Status: NOT_STARTED. Depends on sub-issue T03–T05 (publish service).

## OBJECTIVE
Offer a model-drafted commit message and PR body as a suggestion the user must accept; the deterministic R5 template always runs first and is the default.

## REQUIREMENTS (from parent)
- R11: uses the thread's selected account/model in a tool-free request, like composer predictions. Shown as a suggestion; replaces the template text only after the user accepts it. Off unless the user turns it on.
- Security: no new egress; the request carries only what the review already shows.

## EXECUTION_DAG
| ID | Goal | Depends | Edits | Tests | Done when |
|---|---|---|---|---|---|
| T11 (optional) | Model-drafted message/body | T05 | DISCOVERY: reuse the composer-prediction session owner (search `prediction` in `packages/core`); suggestion UI in `apps/web/src/PublishReview.tsx` | Unit: the suggestion never enters fields without acceptance; nothing is sent when the setting is off | spec + unit pass |

## VALIDATION
`pnpm typecheck`; unit tests; Playwright assertion that acceptance is required.

## STATE / HANDOFF
- Optional; safe to skip or defer. Claim on #1235 first; RELEASE checkpoint on stop.
