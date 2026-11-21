# Remove any casts in packages/widgets — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1103
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Remove any casts in packages/widgets. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
## Outcome
Remove every `as any` and explicit `: any` in `packages/widgets/` (currently `worker.ts` and `controller.ts`) and replace them with precise types.

## Scope
- `packages/widgets/` only. The apps/web `any` cleanup is a separate issue — do not touch apps/web.
- Mechanical typing only; no behavior changes.

## Done when
- `rg -n "as any|: any\\b" packages/widgets` returns no non-test hits.
- `pnpm typecheck` passes on the PR.

## REPO_MAP
Verified at baseline unless marked discovery:
- `packages/widgets/worker.ts` — contains any casts
- `packages/widgets/controller.ts` — contains any casts

## DESIGN
Remove every `as any` and explicit `: any` in packages/widgets/, replaced with precise types. Mechanical; no behavior change; apps/web untouched.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Replace casts in worker.ts and controller.ts | NONE | rg 'as any|: any\\b' packages/widgets clean |
| T02 | Run pnpm typecheck on the PR | T01 | typecheck green |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1103; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1103: https://github.com/skytuhua-org/Gen-V1/issues/1103
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
