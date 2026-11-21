# Gen V1 audit: restore sameDocumentLocation export removed while export-evidence test landed — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1229
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Gen V1 audit: restore sameDocumentLocation export removed while export-evidence test landed. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
On main, #971 (`e2b5721c` knip unused-export sweep) removed the `export` keyword from `sameDocumentLocation` in `packages/ui-catalog/document-export-evidence.ts` while `tests/export-research-evidence.test.ts` (landed in `7a3d9579` / #960/#963) imports it. Same root cause as #1177, which covers the four backend exports and explicitly leaves this UI-catalog error out of scope.

**Current diagnostic (fails `pnpm typecheck` and now Windows checks since #1214 pinned windows-2022):**
```
tests/export-research-evidence.test.ts(7,34): error TS2724: '"../packages/ui-catalog/document-export-evidence.ts"' has no exported member named 'sameDocumentLocation'. Did you mean 'DocumentLocation'?
```

**Scope:** restore only the `export` keyword on the existing `sameDocumentLocation` const — no value, validation, test, or behavior changes; no UI edits.

**Acceptance:**
- Show exact existing TypeScript diagnostic(s).
- `vitest run tests/export-research-evidence.test.ts` passes.
- The TS2724 `sameDocumentLocation` diagnostic disappears from `tsc --noEmit`; remaining baseline errors (e.g. #1148 Pi `providerId`, anything left after #1178 merges) are distinguished, not claimed green.

## REPO_MAP
Verified at baseline unless marked discovery:
- `packages/ui-catalog/document-export-evidence.ts` — restore `export` on sameDocumentLocation
- `tests/export-research-evidence.test.ts` — importer (TS2724 today)

## DESIGN
Restore only the `export` keyword on the existing sameDocumentLocation const — no value, validation, test or behavior changes. Sibling of #1177.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Record the exact TS2724 diagnostic | NONE | diagnostic captured |
| T02 | Restore export keyword; run affected suite + typecheck | T01 | diagnostic gone; gates green |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1229; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1229: https://github.com/skytuhua-org/Gen-V1/issues/1229
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
