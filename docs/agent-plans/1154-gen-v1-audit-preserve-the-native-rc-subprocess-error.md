# Gen V1 audit: preserve the native RC subprocess error when no usable receipt exists — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1154
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: preserve the native RC subprocess error when no usable receipt exists. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
The RC native phase can lose its original subprocess failure while trying to collect a JSON receipt from incomplete stdout. The capture path already records exit error and stdout; a best-effort receipt must not overwrite that diagnostic log or replace its primary failure. Verify with synthetic callbacks and logs, preserve successful-path behavior and all release gates. No installer, live profile or release actions.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/rc-review/build-candidate.ts` — native phase subprocess + receipt capture (verify)

## DESIGN
A best-effort JSON receipt parse must not overwrite the recorded subprocess failure (exit error + stdout) in the RC native phase.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Synthetic callbacks/logs showing the original failure is lost | NONE | red test |
| T02 | Keep primary failure; attach receipt best-effort | T01 | green; success path unchanged |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1154; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1154: https://github.com/skytuhua-org/Gen-V1/issues/1154
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
