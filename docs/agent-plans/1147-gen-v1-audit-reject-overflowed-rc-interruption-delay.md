# Gen V1 audit: reject overflowed RC interruption delays before scheduling — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1147
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: reject overflowed RC interruption delays before scheduling. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
The failed-setup RC dry-run accepts any positive integer as an interruption delay. Node timers coerce delays above 2,147,483,647 ms to 1 ms, so a large operator-supplied value can interrupt a disposable test at the wrong time and invalidate the evidence. Validate the existing option before setup, preserving supported positive integer delays and all installer authorization gates. Confirm with pure parser tests and a synthetic timer-only probe; no installer, process termination, machine settings, or live profiles.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/rc-review/run-rc-review.ts` — interruption-delay option parsing (verify)
- `scripts/rc-review/` — delay scheduling site (discovery)

## DESIGN
Reject interruption delays above 2,147,483,647 ms before setup (Node coerces to 1 ms). Validate the existing option; keep supported positive integers and installer gates.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Add pure parser tests: reject >INT32_MAX, accept valid positives | NONE | red test proving coercion path |
| T02 | Validate option before setup; synthetic timer-only probe | T01 | green; focused PR |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1147; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1147: https://github.com/skytuhua-org/Gen-V1/issues/1147
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
