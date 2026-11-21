# Approve an OS supervisor for service-lifetime background jobs — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/575
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Approve an OS supervisor for service-lifetime background jobs. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
Background work with `APPROVED_SERVICE` lifetime is admitted as BLOCKED with `HOLD_SUPERVISOR`: no installed, operator-approved supervisor exists yet. See `packages/core/background-work.ts` and `docs/implementation/v6/M10/`.

**Done looks like:** a chosen supervisor per supported platform (e.g., systemd user units, Windows service/Task Scheduler), an operator approval flow, and acceptance evidence that a service-lifetime job is supervised, restarts correctly, and remains under host custody.

## REPO_MAP
Verified at baseline unless marked discovery:
- `packages/core/background-work.ts` — admission path that returns BLOCKED/HOLD_SUPERVISOR today
- `docs/implementation/v6/M10/` — existing M10 background-work requirements and receipts
- `packages/contracts/background-work.ts` — shared background-work types

## DESIGN
Design-time gate, not implementation: pick one supervisor per supported platform (systemd user units on Linux, Windows service/Task Scheduler), define the operator approval flow that flips APPROVED_SERVICE jobs from HOLD_SUPERVISOR to admitted, and define supervision evidence (restart, custody).

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Inventory HOLD_SUPERVISOR admission paths and the evidence M10 already records | NONE | exact call sites and blocked job states listed |
| T02 | Select and document the supervisor per platform plus the operator approval step | T01 | approved decision recorded in docs/implementation/v6/M10/ |
| T03 | Define acceptance evidence: supervised service-lifetime job restarts and stays under host custody | T02 | evidence recipe written, implementation issue filed or this issue updated |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #575; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #575: https://github.com/skytuhua-org/Gen-V1/issues/575
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
