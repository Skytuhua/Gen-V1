# Stabilize migration-redesign browser spec boot on Windows CI — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/989
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Stabilize migration-redesign browser spec boot on Windows CI. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
Browser tests failed on main 0ec8525 ([run](https://github.com/skytuhua-org/Gen-V1/actions/runs/44628082741/job/135927120905)) at `tests/e2e/migration-redesign.spec.ts` › "generic tables keep unchanged values plain and reject untrusted change metadata": `.task-table-value` not found in 5 s.

**Outcome:** the spec boots the app through the shared readiness helper so a dev-server transport miss during boot cannot leave a blank page and fail the test.

**Scope:** `tests/e2e/app-ready.ts`, `tests/e2e/migration-redesign.spec.ts` (test harness only; no product change).

**Done when:** the spec passes locally and in Browser tests on the PR, and a simulated boot request miss is recovered with an annotation.

## REPO_MAP
Verified at baseline unless marked discovery:
- `tests/e2e/app-ready.ts` — shared readiness helper to reuse
- `tests/e2e/migration-redesign.spec.ts` — failing spec: .task-table-value not found in 5 s

## DESIGN
Boot the app through the shared readiness helper so a dev-server transport miss cannot leave a blank page. Test-harness change only.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Route the spec's app boot through app-ready.ts | NONE | spec uses readiness helper for navigation |
| T02 | Simulate a boot request miss and confirm recovery with annotation | T01 | injected miss recovers and is annotated |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #989; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #989: https://github.com/skytuhua-org/Gen-V1/issues/989
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
