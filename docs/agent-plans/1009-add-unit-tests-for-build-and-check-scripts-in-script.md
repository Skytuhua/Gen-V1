# Add unit tests for build and check scripts in scripts/ — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1009
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Add unit tests for build and check scripts in scripts/. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Outcome
Pure helper logic in `scripts/` (build, check, capture and lint helpers such as `check-doc-links.mjs`, `build-review-index.ts`, `browser-suites.ts`, `lint-ui.ts`, `capture-ui/helpers.ts`, `capture-ui/scope.ts`, `capture-ui/screen-map.ts`) is covered by vitest unit tests, and the bugs they find are fixed.

## Scope
- Write the tests, then fix what they find: bugs, missing error handling and invalid-input crashes in the source are in scope. Small refactors that make code testable are fine. Keep public behavior unless a fix needs it to change, and say so in the PR body.
- One concern per PR (tests for one module group, or one fix), each under 400 lines, linked to this issue.
- Skip any file changed by an open PR.

## Done when
- Every module in scope has tests, or the PR body says why it can't be unit tested.
- Every bug the tests found is fixed in its own PR or filed as a new issue linked here.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass on each PR.
- Gen Reviewer reports CLEAN and the PRs merge through the normal gate.

Picked up by a standalone session. Coordinate on this issue per AGENTS.md.

[Written by Devin](https://app.devin.ai/sessions/3ec16cd8dc2e450da822fc30c43dd218)

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/check-doc-links.mjs` — candidate module
- `scripts/build-review-index.ts` — candidate module
- `scripts/browser-suites.ts` — candidate module
- `scripts/lint-ui.ts` — candidate module
- `scripts/capture-ui/` — helpers.ts, scope.ts, screen-map.ts candidates

## DESIGN
Cover pure helper logic in scripts/ with vitest; fix bugs found. One concern per PR under 400 lines; skip files touched by open PRs.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | List scripts modules and pick untested pure helpers | NONE | module inventory with test status |
| T02 | Add vitest tests per module group | T01 | each group has tests or a documented reason |
| T03 | Fix each bug found in its own PR or file a linked issue | T02 | bugs fixed/filed; lint, typecheck, test green |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1009; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1009: https://github.com/skytuhua-org/Gen-V1/issues/1009
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
