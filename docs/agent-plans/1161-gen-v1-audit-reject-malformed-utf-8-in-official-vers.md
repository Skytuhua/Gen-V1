# Gen V1 audit: reject malformed UTF-8 in official version evidence — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1161
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: reject malformed UTF-8 in official version evidence. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
A CLI can exit successfully while reporting invalid UTF-8; the version probe currently replaces those bytes and accepts the replacement character as evidence. Require actual well-formed nonempty stdout, preserve combined output/deadline behavior and valid Unicode, and test synthetic Node stdout only. Do not invoke any provider, authenticate, or run live inference. Separate from historical empty-output and runtime framing fixes.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/verify-packaged-providers.ts` — version probe accepts replacement char (verify)
- `tests/packaged-providers.test.ts` — existing tests

## DESIGN
Require well-formed nonempty stdout from the version probe — reject malformed UTF-8 rather than accepting the replacement character; preserve combined output/deadline behavior and valid Unicode. Synthetic Node stdout only.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Synthetic stdout with invalid UTF-8 proves silent acceptance | NONE | red test |
| T02 | Validate UTF-8 before accepting version evidence | T01 | green; valid Unicode still accepted |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1161; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1161: https://github.com/skytuhua-org/Gen-V1/issues/1161
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
