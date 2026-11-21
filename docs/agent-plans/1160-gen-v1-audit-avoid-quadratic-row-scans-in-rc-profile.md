# Gen V1 audit: avoid quadratic row scans in RC profile comparisons — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1160
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: avoid quadratic row scans in RC profile comparisons. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
RC upgrade comparison checks every prior SQLite row, and currently rescans all current rows from the start for each one. Prove the repeated work with a synthetic long-lived profile table and fix it with a per-table lookup, keeping existing missing/changed/multiset diagnostics and Chromium exclusions. No installer, live profile, release or schema change. Red/green operation-count regression, existing suite and mandatory GitHub gates.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/rc-review/upgrade-check.ts` — per-row rescan comparison (verify)
- `tests/rc-review.test.ts` — existing RC tests

## DESIGN
Replace per-prior-row full rescans in RC upgrade comparison with a per-table lookup; keep missing/changed/multiset diagnostics and Chromium behavior.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Prove the repeated work with a synthetic long-lived profile table | NONE | instrumented timing/count evidence |
| T02 | Refactor to per-table lookup; diagnostics unchanged | T01 | same outputs, linear scans; focused PR |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1160; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1160: https://github.com/skytuhua-org/Gen-V1/issues/1160
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
