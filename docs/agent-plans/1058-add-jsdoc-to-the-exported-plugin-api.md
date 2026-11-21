# Add JSDoc to the exported plugin API — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1058
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Add JSDoc to the exported plugin API. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Outcome
Every exported function and type in the plugin API (`packages/plugins` and `docs/plugin-api.md`) has accurate JSDoc.

## Scope
- Describe parameters, return values and thrown errors from what the code actually does, and fix `docs/plugin-api.md` where it disagrees with the code.
- Fix what you find in the source when it is a clear bug. Keep public behavior unless a fix needs it to change, and say so in the PR body.
- One concern per PR, each under 400 lines, linked to this issue. Skip any file changed by an open PR.

## Done when
- No exported plugin API symbol lacks JSDoc, and the doc matches the code.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass on each PR, and the PRs merge through the normal gate.

Mechanical work for a free session or smaller model. Coordinate on this issue per AGENTS.md.

[Written by Devin](https://app.devin.ai/sessions/3ec16cd8dc2e450da822fc30c43dd218)

## REPO_MAP
Verified at baseline unless marked discovery:
- `packages/plugins` — exported plugin API
- `docs/plugin-api.md` — doc to keep in sync

## DESIGN
Add accurate JSDoc to every exported plugin API symbol: params, returns, throws from actual behavior; fix docs/plugin-api.md where it disagrees; fix clear bugs. One concern per PR under 400 lines.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | List exported symbols lacking JSDoc | NONE | symbol inventory |
| T02 | Add JSDoc + fix doc disagreements per PR | T01 | no export lacks JSDoc; doc matches code |
| T03 | Fix/file bugs found | T02 | gates green |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1058; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1058: https://github.com/skytuhua-org/Gen-V1/issues/1058
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
