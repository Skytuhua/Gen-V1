# M12 — Finish bounded tool-program and Python-kernel acceptance — execution plan

## META
- Repo: skytuhua-org/Gen-V1 · Plan revision: 1 (2026-11-21)
- Baseline: main @ e883ac0327c834120d89c3697dec7380a342ba4d
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1020
- Status: plan only — no implementation authorized by this document. Source provenance: issue body reproduced verbatim under REQUIREMENTS so nothing is lost.

## OBJECTIVE
M12 — Finish bounded tool-program and Python-kernel acceptance. Success is the issue's own completion criteria met and verified on main.

## REQUIREMENTS
<!-- m-series-scope:m12-d06 -->
## Outcome and scope

Default-off bounded JavaScript/Python tool programs and D06 accepted retained-state accounting. The 64 MiB logical and allocated limits are independent and inclusive. Native Service admission must retain the original Linux x64 proof requirement.

## Completion criteria

- [x] **T01** Reconcile the published PR with the exact locally qualified test adapter and Python proof-projection commits. Verify ancestry and publish by fast-forward only when the owner and current CI state permit.
- [x] **T02** Keep the security-current Debian WSL fixture and test receipts source-bound. Verify the pre-cell and post-cell limits, RESET_REQUIRED through Service, and that refused cells preserve retained files. [47/47 verified on cdecb425](https://github.com/skytuhua-org/Gen-V1/issues/1020#issuecomment-7056983359). [Prior 47/47 on a4f8078e](https://github.com/skytuhua-org/Gen-V1/issues/1020#issuecomment-7051508378). [Prior 47/47 on 264861a0](https://github.com/skytuhua-org/Gen-V1/issues/1020#issuecomment-7046824443). [Prior 44/44 on 1e33714c](https://github.com/skytuhua-org/Gen-V1/issues/1020#issuecomment-7028432267).
- [ ] **T03** Run required checks and review the final published SHA. Keep transient filesystem quota, whole-process memory, hard I/O termination, Linux broker, browser channels, installed desktop and production runtime approval distinct and held until independently proved.

## Ownership and current state

Existing owner or dependency owner: M12 implementation owner and Windows/Linux verifier. The source-bound WSL qualification commit 2066557c0d1466c6cedc2595090d39f92ad460e0 was published to draft #355 by fast-forward. The verifier received local candidates 95aeec8ec38cac0fc341154b5bb626922e37d814 and 2066557c0d1466c6cedc2595090d39f92ad460e0 by hash-verified bundle. Only the Python adapter changed the platform representation. The shared proof policy was preserved.

Published source, redacted verification summary and staging artifacts are now retrievable from the [implementation checkpoint](https://github.com/skytuhua-org/Gen-V1/issues/1020#issuecomment-7027898054). The raw WSL receipt remains unavailable on GitHub. Native results are specific to the published WSL-tested cut. The Windows test-only follow-up stays in T03.

## References

- [PR #355](https://github.com/skytuhua-org/Gen-V1/pull/355)
- [docs/implementation/v6/M12/requirements.json](https://github.com/skytuhua-org/Gen-V1/blob/31341237781ffe158bcfc009e879eee17cede5a2/docs/implementation/v6/M12/requirements.json)

Issue body revision `issue-body-r1`. Use append-only checkpoints for evidence and handoffs. Existing ownership, review requirements and release permissions apply.

## REPO_MAP
Verified at baseline unless marked discovery:
- `docs/implementation/v6/` — M12 requirements/receipts location (exact M12 dir to verify)
- `packages/contracts` — bounded tool-program and cell-limit types (discovery)

## DESIGN
Finish M12 acceptance: default-off bounded JS/Python tool programs and D06 retained-state accounting; 64 MiB logical and allocated limits independent and inclusive; Native Service admission keeps the original Linux x64 proof requirement. T01/T02 are largely verified per issue checkpoints — remaining work is reconciling residual tasks and publishing disposition.

## EXECUTION_DAG
New plan task IDs are R01.. so they never collide with the issue's own T01/T02/... checklist IDs.

| Task | Goal | Deps | Done when |
|------|------|------|-----------|
| R01 | Map every unchecked completion criterion in the issue to required evidence | NONE | remaining-acceptance list written |
| R02 | Produce/reconcile the remaining source-bound evidence at exact cuts | R01 | each remaining criterion has evidence or a recorded gap |
| R03 | Publish reviewed disposition; do not close without authorization | R02 | disposition comment posted |

## VALIDATION
- `pnpm lint`, `pnpm typecheck` and `pnpm test` (or the focused suite named in the issue) green on each PR.
- Issue-specific acceptance reproduced and evidenced per the criteria above; browser/Windows-only checks run on a Windows worker or CI.
- Each PR linked to issue #1020; merge only through the normal gate (required CI + independent review).

## STATE
- Researched: issue scope + verified REPO_MAP entries. Not started: all tasks. Owner: unassigned (this plan's author released the claim).
- Exact next step: claim the issue per AGENTS.md, then execute T01.

## REFERENCES
- Issue #1020: https://github.com/skytuhua-org/Gen-V1/issues/1020
- AGENTS.md claim/checkpoint/handoff rules: https://github.com/skytuhua-org/Gen-V1/blob/main/AGENTS.md
