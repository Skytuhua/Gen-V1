# M05 — Verify installed Windows memory retention and enabled recall — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1026
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M05 — Verify installed Windows memory retention and enabled recall. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
<!-- m-series-scope:m05-installed -->
## Outcome and scope

Source-bound Windows installed-memory outcomes, outside closed review-work issue #1004. Default-off retention and enabled recall/extraction/checkpoint are distinct results. No production flag or real provider execution without separate authorization.

## Completion criteria

- [ ] **T01** Verify installed Windows package identity, retained records, restart/export and cleanup on the exact named workflow cut.
- [ ] **T02** Record independent enabled recall/extraction/checkpoint observations or the limiting fixture/provider gap.
- [ ] **T03** Reconcile #782's stack base and review/merge state after #737 disposition. Preserve historical cancellation.

## Ownership and current state

Existing owner or dependency owner: Existing #782 installed verifier and qualification owner. #1004 completed its review work. #782 is still an open draft stacked on #737.



## References

- [PR #782](https://github.com/skytuhua-org/Gen-V1/pull/782)
- [PR #737](https://github.com/skytuhua-org/Gen-V1/pull/737)
- [docs/implementation/v3/M05-verification.json](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v3/M05-verification.json)
- [Closed review scope #1004](https://github.com/skytuhua-org/Gen-V1/issues/1004)

Issue body revision `issue-body-r1`. Use append-only checkpoints for evidence and handoffs. Existing ownership, review requirements and release permissions apply.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v3/` — M05 verification records (exact file to verify)
- `scripts/verify-installed-desktop.ts` — installed verification harness
- `PR #782` — installed verifier draft, still open on stacked base

## DESIGN
Source-bound Windows installed-memory outcomes: T01 verify installed package identity, retained records, restart/export and cleanup on an exact workflow cut; T02 record enabled recall/extraction/checkpoint or the limiting gap; T03 reconcile #782 after #737 disposition. Flags off; no real provider without separate authorization.

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Identify the named workflow cut and verify installed retention outcomes | NONE | T01 evidence at exact SHA |
| T02 | Record enabled recall/extraction/checkpoint observations or the fixture/provider gap | T01 | T02 evidence or gap |
| T03 | Reconcile #782 base and review/merge state after #737 | T02 | disposition recorded |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1026; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1026: https://github.com/skytuhua-org/Gen-V1/issues/1026
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
