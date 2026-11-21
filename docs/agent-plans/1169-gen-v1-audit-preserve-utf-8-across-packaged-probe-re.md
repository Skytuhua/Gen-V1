# Gen V1 audit: preserve UTF-8 across packaged probe report chunks — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1169
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: preserve UTF-8 across packaged probe report chunks. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Scope
T01: the outer packaged-provider verifier independently converts each stdout Buffer to text before parsing the JSON report. A legitimate Unicode file path can be silently altered if a character spans two stdout chunks. Fix only the outer report capture in `scripts/verify-packaged-providers.ts` and add a deterministic synthetic child-output regression in `tests/packaged-providers.test.ts`. Distinct from #1161, which concerns malformed stdout from a version-only child in a different verifier. No provider login, real accounts, external API calls, installers, or scope changes.

## Acceptance
Repeatably split a legal UTF-8 character within a JSON report across Buffer chunks and prove the current verifier fails to preserve it; preserve exact report bytes without changing the existing combined byte limit, exit/timeout behavior, or report and path validation. Check relevant local tests and exact required CI/independent approval before compliant merge and push verification.

## REPO_MAP
Verified at baseline unless marked discovery:
- `scripts/verify-packaged-providers.ts` — outer verifier converts each chunk separately
- `tests/packaged-providers.test.ts` — regression test target

## DESIGN
Buffer full stdout before decoding so a UTF-8 character split across chunks is preserved; keep combined byte limit, exit/timeout behavior, report and path validation.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Regression test splitting a legal UTF-8 char across chunks | NONE | red test showing altered path/JSON |
| T02 | Concatenate chunks then decode | T01 | green; exact report bytes preserved |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1169; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1169: https://github.com/skytuhua-org/Gen-V1/issues/1169
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
