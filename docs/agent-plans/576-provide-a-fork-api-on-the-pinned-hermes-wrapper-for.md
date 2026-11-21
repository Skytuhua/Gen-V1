# Provide a fork API on the pinned Hermes wrapper for review/idle jobs — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/576
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Provide a fork API on the pinned Hermes wrapper for review/idle jobs. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
Review and idle forks are blocked with `HOLD_FORK_API` (and require an approved auxiliary model budget): `BackgroundWorkCoordinator.admitReviewFork` currently returns `UNSUPPORTED_FORK` because the pinned Hermes wrapper exposes no callable fork.

**Done looks like:** a callable fork API on the pinned wrapper, wiring through the coordinator's auxiliary-budget check, and tests covering budget-required and unsupported paths.

## REPO_MAP
Verified at baseline unless marked discovery:
- `packages/core/background-work.ts` — BackgroundWorkCoordinator.admitReviewFork returns UNSUPPORTED_FORK
- `packages/contracts/background-work.ts` — shared background-work types
- `tests/background-work-v3.test.ts` — existing background-work tests

## DESIGN
Expose a callable fork on the pinned Hermes wrapper and wire it through the coordinator's auxiliary-budget check. Deferred until the wrapper contract is chosen.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Locate the pinned Hermes wrapper surface and document the fork signature it must expose | NONE | candidate files verified, signature written |
| T02 | Design the coordinator wiring: auxiliary model budget check then fork call, mapped results | T01 | state transitions for budget-required and unsupported paths written |
| T03 | Specify tests for budget-required and unsupported paths | T02 | test list written |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #576; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #576: https://github.com/skytuhua-org/Gen-V1/issues/576
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
