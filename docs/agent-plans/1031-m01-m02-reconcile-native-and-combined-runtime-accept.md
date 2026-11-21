# M01–M02 — Reconcile native and combined-runtime acceptance on current source — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1031
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M01–M02 — Reconcile native and combined-runtime acceptance on current source. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
<!-- m-series-scope:m01-m02-current-evidence -->
## Outcome and scope

Current-source M01 evidence custody and M02 combined-runtime/Windows acceptance. Keep original manifests and historical failures. M03 production backend approval stays in #774.

## Completion criteria

- [ ] **T01** Map each M01 and M02 pending native/combined gate to the current source and latest applicable receipts. Preserve both historical manifest bases.
- [ ] **T02** Reconcile MSVC/native lease, combined full-app and authenticated operation evidence against their exact execution cuts. Explicitly record missing Hermes and integration sub-effects.
- [ ] **T03** Publish a reviewed current-source evidence disposition. Ordinary CI cannot substitute for unrun native cases or release approval.

## Ownership and current state

Existing owner or dependency owner: M01/M02 evidence owners. Existing #774 comments already reference both older manifests but do not own their acceptance work. This issue keeps shared evidence reconciliation apart from the M03 backend gate.



## References

- [PR #749](https://github.com/skytuhua-org/Gen-V1/pull/749)
- [PR #661](https://github.com/skytuhua-org/Gen-V1/pull/661)
- [PR #932](https://github.com/skytuhua-org/Gen-V1/pull/932)
- [PR #908](https://github.com/skytuhua-org/Gen-V1/pull/908)
- [docs/implementation/v3/M01-verification.json](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v3/M01-verification.json)
- [docs/implementation/v3/M02-verification.json](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v3/M02-verification.json)
- [M03 backend gate #774](https://github.com/skytuhua-org/Gen-V1/issues/774)

Issue body revision `issue-body-r1`. Use append-only checkpoints for evidence and handoffs. Existing ownership, review requirements and release permissions apply.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v3/M01-verification.json` — M01 records
- `docs/implementation/v3/M02-verification.json` — M02 records

## DESIGN
Current-source M01 evidence custody and M02 combined-runtime/Windows acceptance: map pending native/combined gates to current source and latest receipts, reconcile MSVC/native lease, combined full-app and authenticated operation evidence, publish a reviewed disposition. Ordinary CI cannot substitute for unrun native cases; M03 backend approval stays in #774.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Map each pending M01/M02 gate to current source and latest applicable receipts | NONE | gate map preserving historical manifests |
| T02 | Reconcile native lease, combined full-app and authenticated-operation evidence vs exact cuts | T01 | gaps explicitly recorded incl. missing Hermes sub-effects |
| T03 | Publish reviewed current-source evidence disposition | T02 | disposition posted |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1031; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1031: https://github.com/skytuhua-org/Gen-V1/issues/1031
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
