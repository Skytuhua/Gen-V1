# Gen V1 audit: continue RC session teardown when browser disconnect fails — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1153
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: continue RC session teardown when browser disconnect fails. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
The installed RC harness closes the verified browser session before terminating a still-running child. A failed browser close skips the owned child cleanup. Confirm this with synthetic rejected close and termination callbacks, then ensure the second cleanup runs and errors remain observable. Preserve all ownership checks, installed verifier behavior and required merge gates; do not launch an installer or terminate a real process.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/rc-review/installed-session.ts` — browser close then child terminate ordering (verify)

## DESIGN
If browser-session close rejects, still run the owned child cleanup; keep errors observable, ownership checks and installed-verifier behavior.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Synthetic rejected-close test proving the second cleanup is skipped today | NONE | red test |
| T02 | Run child cleanup regardless of close failure; surface both errors | T01 | green; focused PR |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1153; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1153: https://github.com/skytuhua-org/Gen-V1/issues/1153
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
