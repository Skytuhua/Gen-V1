# Automate or retire the skipped agents-grid UI evidence check — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/585
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
Automate or retire the skipped agents-grid UI evidence check. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
The `Agents grid UI evidence (Windows, pinned Edge)` job reports `skipped` on every run — the evidence is not actually being produced in CI. Either wire `tests/e2e/agents-workspace-evidence.spec.ts` into the pipeline (pinned Edge, evidence upload) or remove the job and document the manual evidence path.

## REPO_MAP
Verified at baseline unless marked discovery:
- `tests/e2e/agents-workspace-evidence.spec.ts` — the spec the skipped job refers to
- `.github/workflows/` — workflow that defines the 'Agents grid UI evidence (Windows, pinned Edge)' job
- `.github/workflows/ci.yml` — main CI workflow for comparison

## DESIGN
Decide one of two paths: wire the spec into CI with pinned Edge and evidence upload, or remove the job and document the manual evidence path. Prefer automation only if the spec is already green.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Run the spec locally/in CI harness to learn whether it passes today | NONE | verdict: automatable or retire |
| T02a | If automatable: add a workflow job running the spec on pinned Edge with artifact upload | T01 | workflow diff, job produces non-skipped result |
| T02b | If not: delete the always-skipped job and document the manual evidence procedure | T01 | job removed; docs updated |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #585; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #585: https://github.com/skytuhua-org/Gen-V1/issues/585
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
