# M04 — Finish shadow source isolation and timeout ownership review — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1024
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M04 — Finish shadow source isolation and timeout ownership review. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
<!-- m-series-scope:m04-shadow -->
## Outcome and scope

The narrow shadow-source snapshot and in-flight ownership fix on #801. Keep existing budgets, observed receipt boundaries and flags.

## Completion criteria

- [ ] **T01** Confirm which parts of the two-file patch remain absent from current main. Review immutable captured metadata and physical in-flight ownership after timeout.
- [ ] **T02** Resolve failures or overlap, then obtain exact-head focused tests, required CI and review for the retained scope.

## Ownership and current state

Existing owner or dependency owner: Existing #801 owner. PR is open for a distinctly scoped runtime fix. Main coverage and need for any branch composition are to be verified before new edits.



## References

- [PR #801](https://github.com/skytuhua-org/Gen-V1/pull/801)
- [docs/implementation/v6/M04/requirements.json](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v6/M04/requirements.json)

Issue body revision `issue-body-r1`. Use append-only checkpoints for evidence and handoffs. Existing ownership, review requirements and release permissions apply.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v6/M04/` — M04 requirements
- `PR #801` — the two-file patch this issue reconciles

## DESIGN
Reconcile the narrow shadow-source snapshot + in-flight ownership fix from PR #801 against current main, then obtain focused tests, CI and review for retained scope.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Diff #801's two-file patch vs current main; list what remains absent | NONE | absent-vs-merged classification |
| T02 | Land retained scope (new branch if needed) and review immutable captured metadata and in-flight ownership after timeout | T01 | focused tests + required CI green |
| T03 | Publish disposition for the rest | T02 | superseded parts recorded |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1024; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1024: https://github.com/skytuhua-org/Gen-V1/issues/1024
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
