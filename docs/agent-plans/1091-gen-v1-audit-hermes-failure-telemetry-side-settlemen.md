# Gen V1 audit: Hermes failure telemetry, side settlement, and pool shutdown — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1091
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: Hermes failure telemetry, side settlement, and pool shutdown. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
Scope: T01 Hermes broker marks a rejected request failed even for an empty rejection reason; T02 a side runtime that settles before native start acknowledgment is not misreported as cancelled; T03 warm transport pool shutdown attempts all idle closes even if one fails. Work is first-party backend runtime and tests, no new feature, UI or changes to permissions/configuration. One focused PR per reproduced defect. Verify red/green and merge only with exact required CI, independent review, tested current main, and protected destination.

## REPO_MAP
Verified at baseline unless marked discovery:
- `packages/core/service.ts` — Hermes broker/service surface (verify exact files)
- `packages/core` — transport pool and side-runtime settlement (discovery)
- `tests/` — synthetic fixtures only

## DESIGN
Three runtime defects, one focused PR each: T01 Hermes broker marks a rejected request failed even with empty rejection reason; T02 a side runtime settled before native start ack must not be reported cancelled; T03 warm transport pool shutdown attempts all idle closes even if one fails.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Reproduce + fix rejected-request failure marking | NONE | red/green + focused PR |
| T02 | Reproduce + fix early-settled side runtime misreport | NONE | red/green + focused PR |
| T03 | Reproduce + fix pool shutdown skipping idle closes | NONE | red/green + focused PR |
| T04 | Merge each with exact CI + independent review; verify on main | T01,T02,T03 | verified on main |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1091; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1091: https://github.com/skytuhua-org/Gen-V1/issues/1091
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
