# Gen V1 audit: terminal startup rollback and Pi worker settlement — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1081
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: terminal startup rollback and Pi worker settlement. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
Scope: backend terminal host startup and the Pi runtime’s tool-response and worker-exit paths. Audit terminal registration when durable status cannot be written, Pi tool replies with a present but empty diagnostic, and Pi worker exit cleanup if an event observer throws. One focused PR for each verified defect; synthetic fixtures only. Existing terminal exit retention/settlement PRs #1077 and #1079 own separate exit behavior, and #1068 is standalone coverage. Acceptance: reproduce each confirmed defect; local regression tests, typecheck/build, exact required CI, independent review, clean tested combined tree and compliant merge; verify on main before closing. No frontend, features or platform enforcement changes.

## REPO_MAP
Verified at baseline unless marked discovery:
- `packages/runtime-pi/index.ts` — Pi runtime tool-response and worker-exit paths
- `apps/server` — terminal host registration (exact file = discovery)
- `tests/` — synthetic fixtures only

## DESIGN
Audit three backend paths, one focused PR per verified defect: (a) terminal registration when durable status cannot be written, (b) Pi tool replies with present-but-empty diagnostic, (c) Pi worker exit cleanup when an event observer throws. #1077/#1079 own separate exit behavior; #1068 standalone coverage.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Reproduce defect (a): registration without durable status write | NONE | red test + focused PR |
| T02 | Reproduce defect (b): empty-diagnostic tool reply | NONE | red test + focused PR |
| T03 | Reproduce defect (c): exit cleanup when observer throws | NONE | red test + focused PR |
| T04 | Verify each fix on main before closing | T01,T02,T03 | merged + verified on main |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1081; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1081: https://github.com/skytuhua-org/Gen-V1/issues/1081
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
