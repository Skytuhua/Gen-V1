# Gen V1 audit: restore backend exports removed while new tests landed — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1177
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: restore backend exports removed while new tests landed. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
On main, #971 removed four backend exports concurrently used by tests landed in #960 and #963. Restore only researchAuthoritySchema, researchHashSchema, RESEARCH_PASSAGE_BYTES and MEMORY_LIMITS as exports, without changing values, validation, or weakening tests. Acceptance: show exact existing TypeScript diagnostics, run both affected suites and confirm those four diagnostics disappear; distinguish unrelated Pi fixture and UI-catalog type errors, keep other gates mandatory. No UI edits or changes to product behavior.

## REPO_MAP
Verified at baseline unless marked discovery:
- `packages/contracts/research.ts` — researchAuthoritySchema, researchHashSchema, RESEARCH_PASSAGE_BYTES homes (verify)
- `packages/contracts/project-memory.ts` — MEMORY_LIMITS (verify)
- `tests/` — the #960/#963 suites that import them

## DESIGN
Restore only the four removed exports (researchAuthoritySchema, researchHashSchema, RESEARCH_PASSAGE_BYTES, MEMORY_LIMITS) — no value/validation/test changes. #1229 owns the separate sameDocumentLocation error.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Capture current TypeScript diagnostics for the affected suites | NONE | exact diagnostics recorded |
| T02 | Restore the four exports; run both suites + typecheck | T01 | the four diagnostics disappear; unrelated Pi/UI-catalog errors noted separately |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1177; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1177: https://github.com/skytuhua-org/Gen-V1/issues/1177
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
