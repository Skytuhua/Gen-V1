# CI: pin Windows checks to windows-2022 — windows-latest now ships VS 18 that node-gyp cannot parse — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1213
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
CI: pin Windows checks to windows-2022 — windows-latest now ships VS 18 that node-gyp cannot parse. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
The windows-latest runner image updated to Visual Studio 18 Enterprise ("C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise"). node-gyp reports `unknown version "undefined"` and fails to build node-pty, so `pnpm install` exits 2 and every Windows check that rebuilds node-pty fails before tests run.

Observed failing PR checks: 1082, 1109, 1178 (identical gyp 'find VS' errors in Windows checks logs).

Scope: pin `runs-on: windows-latest` -> `windows-2022` in .github/workflows/ci.yml, matching agents-ui-evidence.yml and m15-evidence.yml which already use windows-2022.

Out of scope (same risk, not blocking PR checks): release.yml, m01-m03-audit.yml still use windows-latest.

Done when: Windows checks on a PR run pnpm install + tests without the node-gyp find-VS failure.

## REPO_MAP
Verified at baseline unless marked discovery:
- `.github/workflows/ci.yml` — change runs-on: windows-latest -> windows-2022
- `.github/workflows/agents-ui-evidence.yml` — already on windows-2022 (precedent)
- `.github/workflows/m15-evidence.yml` — already on windows-2022 (precedent)

## DESIGN
Pin ci.yml Windows jobs to windows-2022 because windows-latest now ships VS 18 that node-gyp cannot parse (node-pty build fails at pnpm install). release.yml and m01-m03-audit.yml stay out of scope.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Pin runs-on in .github/workflows/ci.yml | NONE | diff limited to ci.yml |
| T02 | Confirm a PR's Windows checks pass pnpm install + tests | T01 | no node-gyp find-VS failure in checks |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1213; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1213: https://github.com/skytuhua-org/Gen-V1/issues/1213
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
