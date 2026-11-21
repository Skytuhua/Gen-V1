# M04 — Qualify retained compaction through the App and installed desktop — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1027
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M04 — Qualify retained compaction through the App and installed desktop. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
<!-- m-series-scope:m04-compaction -->
## Outcome and scope

Retained compaction history/cost evidence through the real App and installed desktop. Windows context-result custody is a separate host verification case. Keep existing flags off and model/provider execution subject to separate authorization.

## Completion criteria

- [ ] **T01** Compare the two older actual-App drafts to main and retain only verified distinct work. Capture real App evidence for supported retained history and cost display.
- [ ] **T02** Identify a supported installed verifier scenario and an authorized provider or owned fixture. Qualify installed compaction apply/custody/rollback at an exact source cut.
- [ ] **T03** Record Windows context-result custody separately. If host restart is the blocker, use #993 for the existing CI failure investigation.

## Ownership and current state

Existing owner or dependency owner: M04 owner with installed and Windows verification owners. The component/body and installed gaps are separate from merged #839 and chronology #772. #709 and #733 are historical draft leads, with distinct downstream bases.



## References

- [PR #709](https://github.com/skytuhua-org/Gen-V1/pull/709)
- [PR #733](https://github.com/skytuhua-org/Gen-V1/pull/733)
- [PR #839](https://github.com/skytuhua-org/Gen-V1/pull/839)
- [docs/implementation/v6/M04/requirements.json](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v6/M04/requirements.json)
- [docs/implementation/v6/M04/continuation-handoff.md](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v6/M04/continuation-handoff.md)
- [Existing CI stall investigation #993](https://github.com/skytuhua-org/Gen-V1/issues/993)

Issue body revision `issue-body-r1`. Use append-only checkpoints for evidence and handoffs. Existing ownership, review requirements and release permissions apply.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v3/` — M04/M06 verification records
- `apps/desktop` — installed desktop acceptance path

## DESIGN
Qualify retained compaction through the real App and installed desktop: T01 compare two older actual-App drafts to main, retain verified distinct work, capture real App evidence; T02 qualify installed compaction apply/custody/rollback at an exact cut; T03 record Windows context-result custody separately (use #993 for host-restart blockers).

## EXECUTION_DAG
| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| T01 | Compare the two actual-App drafts vs main; classify retained/merged/superseded | NONE | classification posted |
| T02 | Identify supported installed verifier + authorized provider/fixture; qualify apply/custody/rollback | T01 | exact-cut evidence |
| T03 | Record Windows context-result custody separately | T02 | custody evidence or blocker linked to #993 |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1027; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1027: https://github.com/skytuhua-org/Gen-V1/issues/1027
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
