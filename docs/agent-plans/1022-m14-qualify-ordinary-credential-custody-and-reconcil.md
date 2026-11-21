# M14 — Qualify ordinary credential custody and reconcile the combined fixture — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1022
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M14 — Qualify ordinary credential custody and reconcile the combined fixture. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
<!-- m-series-scope:m14-custody -->
## Outcome and scope

Exact-cut Linux x64 ext4 custody verification for the ledgered read-only mounts and normal synthetic credential lease in #869. Keep the old combined barrier, credential-loss and historical X1 evidence as separate lanes.

## Completion criteria

- [x] **T01** Verify the `credential-lease` mode on the exact draft head in the owned disposable WSL broker environment. Record write, acquire, assert/read, release/settled, post-release write and cleanup. Verified at `c6d27a0303e83765459518f4815f6a2fb76b652e`. [Prior acceptance checkpoint](https://github.com/skytuhua-org/Gen-V1/issues/1022#issuecomment-7026982413). Rechecked at `dde425bc396ecef6eb7442f70c9ee3e8e8272ef5`. [Exact follow-up checkpoint](https://github.com/skytuhua-org/Gen-V1/issues/1022#issuecomment-7056462713). [Prior 9eb010aa checkpoint](https://github.com/skytuhua-org/Gen-V1/issues/1022#issuecomment-7052096245). [Prior b81fd059 checkpoint](https://github.com/skytuhua-org/Gen-V1/issues/1022#issuecomment-7047195589)
- [ ] **T02** Preserve the combined-fixture `EBUSY` and original ledger receipts. Resolve any remaining normal-lifecycle issue only with evidence. Keep the opening-call attribution qualified and the existing fence intact.
- [ ] **T03** Review the scoped draft and exact-head checks. Keep original X1 63-file evidence unverified unless the original manifest is recovered. Credential-loss remains NOT_RUN.

## Ownership and current state

Existing owner or dependency owner: M14 implementation owner and WSL verifier. c6d27a0303e83765459518f4815f6a2fb76b652e adds a separate ordinary fixture mode and handoff notes. This commit leaves broker logic, production code and old combined assertions unchanged.

Earlier scratch WSL receipts are summarized here. Original X1 manifest is missing and cannot establish its acceptance.

## References

- [PR #869](https://github.com/skytuhua-org/Gen-V1/pull/869)
- [PR #343](https://github.com/skytuhua-org/Gen-V1/pull/343)
- [docs/implementation/v6/M14/requirements.json](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v6/M14/requirements.json)
- [docs/implementation/v6/M14/handoff.md](https://github.com/skytuhua-org/Gen-V1/blob/5cde22a7d48cc0a5f0f24884f862e64781575ebd/docs/implementation/v6/M14/handoff.md)
- [Current M14 follow-up handoff](https://github.com/skytuhua-org/Gen-V1/blob/c6d27a0303e83765459518f4815f6a2fb76b652e/docs/implementation/v6/M14/handoff-followup-x1.md)

Issue body revision `issue-body-r1`. Use append-only checkpoints for evidence and handoffs. Existing ownership, review requirements and release permissions apply.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v6/M14/` — M14 requirements/receipts
- `scripts/` — credential-lease verification scripts (discovery)

## DESIGN
Finish M14: exact-cut Linux x64 ext4 custody verification for ledgered read-only mounts and normal synthetic credential lease (#869); keep combined barrier, credential-loss and X1 lanes separate.

## EXECUTION_DAG
New plan task IDs are R01.. so they never collide with the issue's own T01/T02/... checklist IDs.

| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| R01 | Map unchecked completion criteria to required evidence | NONE | remaining-acceptance list |
| R02 | Produce/reconcile remaining evidence at exact cuts | R01 | evidence or recorded gap per criterion |
| R03 | Publish reviewed disposition | R02 | disposition posted; not closed without authorization |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1022; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1022: https://github.com/skytuhua-org/Gen-V1/issues/1022
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
