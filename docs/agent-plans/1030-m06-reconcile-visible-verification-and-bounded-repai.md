# M06 — Reconcile visible verification and bounded repair acceptance — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1030
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M06 — Reconcile visible verification and bounded repair acceptance. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
<!-- m-series-scope:m06-controls -->
## Outcome and scope

The open M06 user-facing verification and bounded repair stack, separate from #1006 byte-witness review. Older branches are leads until compared to current main.

## Completion criteria

- [ ] **T01** Read stacked PR requirements and compare source with current main to classify retained, merged or superseded changes.
- [ ] **T02** Verify visible rerun and bounded repair through the actual host, including durable source-drift failure and restart accounting, for the precise retained scope.
- [ ] **T03** Record passing focused and required platform checks and independent review before publication.

## Ownership and current state

Existing owner or dependency owner: Existing M06 stack owners. The open draft stack has multiple exact bases. It should not be replayed as a unit until overlap and current product behavior are known.



## References

- [PR #635](https://github.com/skytuhua-org/Gen-V1/pull/635)
- [PR #651](https://github.com/skytuhua-org/Gen-V1/pull/651)
- [PR #652](https://github.com/skytuhua-org/Gen-V1/pull/652)
- [PR #653](https://github.com/skytuhua-org/Gen-V1/pull/653)
- [PR #673](https://github.com/skytuhua-org/Gen-V1/pull/673)
- [PR #687](https://github.com/skytuhua-org/Gen-V1/pull/687)
- [PR #699](https://github.com/skytuhua-org/Gen-V1/pull/699)
- [docs/implementation/v3/M06-verification.json](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v3/M06-verification.json)
- [Independent byte-witness review #1006](https://github.com/skytuhua-org/Gen-V1/issues/1006)

Issue body revision `issue-body-r1`. Use append-only checkpoints for evidence and handoffs. Existing ownership, review requirements and release permissions apply.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v3/` — M06 verification records
- `packages/core` — bounded repair / rerun paths (discovery)

## DESIGN
Reconcile the open M06 user-facing verification and bounded repair stack: classify each stacked PR's changes vs current main, verify visible rerun and bounded repair through the actual host (durable source-drift failure, restart accounting), then record checks + independent review.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Classify stacked PR changes vs main | NONE | retained/merged/superseded map |
| T02 | Verify visible rerun and bounded repair via the real host for retained scope | T01 | host evidence incl. drift failure and restart accounting |
| T03 | Record required platform checks + independent review before publication | T02 | disposition posted |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1030; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1030: https://github.com/skytuhua-org/Gen-V1/issues/1030
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
