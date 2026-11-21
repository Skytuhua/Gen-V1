# Gen V1 audit: keep readiness diagnostic lines intact across child streams — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1179
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: keep readiness diagnostic lines intact across child streams. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
Readiness merges stdout and stderr fragments into a single line buffer. With a valid partial stdout line, a complete stderr line and the stdout remainder, its artifact invents a mixed line and loses the original two records. Keep independent partial lines until each has a newline, preserve single-stream bytes and safe log handling, and test a synthetic local child. No gate/status changes.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/verify-readiness.ts` — stdout/stderr merged line buffer
- `tests/update-readiness.test.ts` — existing readiness tests (verify)

## DESIGN
Keep independent per-stream partial lines until each has a newline; no invented mixed lines, single-stream bytes and log handling preserved.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Synthetic child: partial stdout line + complete stderr line + stdout remainder proves mixed-line artifact | NONE | red test |
| T02 | Per-stream buffers; flush on newline/close | T01 | both original records preserved; green |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1179; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1179: https://github.com/skytuhua-org/Gen-V1/issues/1179
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
