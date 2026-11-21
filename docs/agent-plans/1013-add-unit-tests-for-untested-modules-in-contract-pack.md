# Add unit tests for untested modules in contract packages — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1013
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Add unit tests for untested modules in contract packages. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Outcome
Modules in `packages/contracts`, `packages/desktop-contract` and `packages/capabilities` are covered by vitest unit tests, and the bugs they find are fixed.

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
- `packages/contracts` — target package
- `packages/desktop-contract` — target package
- `packages/capabilities` — target package

## DESIGN
Cover untested modules in contracts, desktop-contract and capabilities with vitest; fix bugs found.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Inventory modules and existing coverage | NONE | untested module list |
| T02 | Add tests per module group | T01 | coverage or documented gaps |
| T03 | Fix/file findings | T02 | gates green |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1013; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1013: https://github.com/skytuhua-org/Gen-V1/issues/1013
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
