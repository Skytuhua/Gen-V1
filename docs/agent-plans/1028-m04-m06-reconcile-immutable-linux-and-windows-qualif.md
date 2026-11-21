# M04–M06 — Reconcile immutable Linux and Windows qualification evidence — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1028
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M04–M06 — Reconcile immutable Linux and Windows qualification evidence. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
<!-- m-series-scope:m04-m06-immutable -->
## Outcome and scope

Shared qualification of immutable M04–M06 sources on the existing #737 stack. Individual M04, M05 and M06 product changes and installed acceptance keep independent evidence.

## Completion criteria

- [ ] **T01** Map the pinned input stack and distinguish already merged or superseded changes from the remaining workflow/evidence scope.
- [ ] **T02** Review immutable Linux and Windows evidence against the exact retained source. Preserve cancelled runs and file any platform-specific blockers with the owning issue.
- [ ] **T03** Decide review/merge disposition for the verified scope, including #782's base dependency, without duplicating runner work.

## Ownership and current state

Existing owner or dependency owner: Existing qualification stack owner. #737 is still draft on its stacked base. #782 depends on it. Historical older component work is tracked as leads, without implied ownership change.



## References

- [PR #737](https://github.com/skytuhua-org/Gen-V1/pull/737)
- [PR #782](https://github.com/skytuhua-org/Gen-V1/pull/782)
- [docs/implementation/v6/M04/requirements.json](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v6/M04/requirements.json)

Issue body revision `issue-body-r1`. Use append-only checkpoints for evidence and handoffs. Existing ownership, review requirements and release permissions apply.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v3/M04-M06-review-20261117.md` — existing review note
- `PR #737` — the pinned qualification stack (still draft)
- `PR #782` — depends on #737

## DESIGN
Shared qualification of immutable M04-M06 sources on the #737 stack: map the pinned stack, review immutable Linux and Windows evidence against exact retained source, then decide review/merge disposition including #782's base dependency.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Map the pinned input stack; classify merged vs superseded vs remaining | NONE | stack map posted |
| T02 | Review immutable evidence per platform; file platform blockers with owning issues | T01 | evidence verdict per lane |
| T03 | Decide disposition for verified scope incl. #782 base | T02 | disposition posted |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1028; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1028: https://github.com/skytuhua-org/Gen-V1/issues/1028
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
