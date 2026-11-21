<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1042 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: Gen V1 backend audit — process progress isolation, Pi session decoding, event-stream cleanup (completion plan)
- Repo: `skytuhua-org/Gen-V1`, issue #1042
- Plan revision: 1, 2026-11-20. Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (`git rev-parse HEAD` in `/home/ubuntu/repos/Gen-V1`)
- Links: PR #1044 (merged), PR #1045 (open, `dot/audit-0118-process-progress@5448a137f22f726c5ab4bfbedc3fdae99e4ed564`), PR #1046 (merged). Issue checkpoints 001–007 by `dot-cloud-75d2b1`.
- Status: all three fixes implemented and locally verified; T02 and T03 merged; T01 open awaiting final gate + merge; main-push CI for T02/T03 queued at last checkpoint.
- Provenance: reproduced bugs and fixes by `dot-cloud-75d2b1`; plan by `devin-a-cloud-4f7c1e` (review/planning, no code changes).

### OBJECTIVE

Close the audit loop: get T01 (#1045) through its remaining gates and merged, verify the main-push workflows for all three merged/open PRs, then close #1042 with evidence. Success = all three PRs merged on main, exact-head required checks green on main for each merge commit, issue closed.

### REQUIREMENTS

- In scope: gate verification and merge of PR #1045; verification of main CI for the merge commits of #1044, #1046 (and #1045 once merged); final checkpoint and issue closure.
- Out of scope: new fixes, reopening reproduced bugs, any change to `packages/capabilities/process.ts`, `packages/runtime-pi/session.ts`, `apps/server/event-stream.ts` or their tests, flag/deployment changes.
- Constraints from existing work (must not regress): private progress sink is best-effort and must not alter child exit/output/cleanup semantics; Pi session header validation rejects malformed UTF-8 without silent replacement, bounded size/path admission unchanged; fatal SSE teardown releases listener and registry slot without changing event ordering.
- Gate requirements: independent/exact-head review required per PR; protected merge only when all required checks pass on the exact head; "merged" ≠ "verified on main" — main-push CI must be observed green.

### REPO_MAP (verified on `main@7ef0710c`)

- `packages/capabilities/process.ts` + `tests/process.test.ts` — T01 fix (PR #1045), files exist.
- `packages/runtime-pi/session.ts` + `tests/runtime-pi.test.ts` — T02 fix (PR #1044, merged).
- `apps/server/event-stream.ts` + `tests/event-stream-fairness.test.ts`, `tests/event-stream.test.ts` — T03 fix (PR #1046, merged).
- Last checkpoint (007): focused suite `tests/ci-queue-guard ci-concurrency-policy ci-draft-policy terminal-opening-race runtime-pi event-stream-fairness event-stream` = 127/127 on `main@7ef0710c`; push workflows `44710003528` (#1044) and `44710010047` (#1046) queued, unverified; #1045 has 8/9 checks green with `Installed desktop memory retention and opt-in` pending (verified via `git_view_pr` 2026-11-20).

### DESIGN

No code design remains — all three fixes are written and two are merged. The remaining flow is a gating pipeline:

1. `#1045` pending check settles → if green, rerun focused `tests/process.test.ts` on the exact current-main candidate → confirm independent review + clean GitHub gates → merge.
2. For each merge commit pushed to main (#1044 already merged, #1046 already merged, #1045 when merged): observe the push-triggered required workflow to green on that exact SHA.
3. If any gate fails: do not merge/retry blindly; capture the failing job log, re-run the focused test file on the exact SHA to distinguish flake vs regression, and checkpoint BLOCKED with evidence.
4. Issue closes only after all three PRs are merged AND each main-push workflow is green AND a final VERIFIED checkpoint is posted.

### EXECUTION_DAG

- **T01 — Settle PR #1045 pending check.** Depends: none. Steps: `git_pr_checks` on PR #1045 until `Installed desktop memory retention and opt-in` completes; if failed, read job log (`git_ci_job_logs`), re-run `pnpm exec vitest run tests/process.test.ts --maxWorkers=1` on exact head `5448a137`; retry only the failed job if it is a documented flake pattern (prior checkpoint authorized a sole retry `136197156195` — confirm it consumed before any new retry). Done-when: check green or BLOCKED checkpoint with log evidence.
- **T02 — Re-verify T01 fix on current main before merge.** Depends: T01 green. Steps: fetch `origin/main`, confirm #1045 head still merges clean (`git merge-tree` or GitHub mergeable state), run `pnpm exec vitest run tests/process.test.ts tests/event-stream-fairness.test.ts tests/runtime-pi.test.ts --maxWorkers=1` on the candidate merge tree. Done-when: all pass on exact candidate SHA, recorded in checkpoint.
- **T03 — Merge #1045.** Depends: T02 + independent review present + all required checks green on exact head. Steps: standard squash/merge per repo convention; record merge SHA. Done-when: PR state merged, merge commit on `origin/main`.
- **T04 — Verify main-push CI for all three merges.** Depends: T03. Steps: `git_commit_checks` on each merge SHA (#1044, #1046, #1045 merges) until all required push workflows green; on failure read logs and re-run focused tests on that SHA. Done-when: three green push runs recorded with run IDs.
- **T05 — Final checkpoint + close.** Depends: T04. Steps: post VERIFIED checkpoint (wire format below) listing all merge SHAs, run IDs, test receipts; close #1042 (closure is authorized by the issue's own completion criteria). Done-when: issue closed with checkpoint as last comment.

### VALIDATION

- Commands (repo root, Node 24.x, pnpm 10.30.3): `pnpm exec vitest run tests/process.test.ts tests/runtime-pi.test.ts tests/event-stream-fairness.test.ts tests/event-stream.test.ts --maxWorkers=1` (expected all-pass; baseline already 51/51 + extended 127/127); `pnpm typecheck`; `git diff --check` for whitespace.
- Gate checks: `git_pr_checks` / `git_commit_checks` are the authority for required CI; local passes never substitute.
- Known environment gap: `tests/capabilities.test.ts` shows 13 native file-guard failures on Linux with and without the change — environment-bound, not a regression; CI on windows-latest is authoritative.
- Acceptance matrix: T01 merged on main (SHA recorded); #1044/#1046 push runs green (IDs recorded); focused suite green on final main; checkpoint VERIFIED posted.

### STATE

- Researched/decided/implemented: T01–T03 fixes implemented; T02/T03 merged and locally verified.
- Pending: #1045 pending check, pre-merge re-verification, #1045 merge, main-push CI for all merges, issue closure.
- Risks: pending desktop-retention job may be environment-flaky (distinguish via job log + focused rerun); main may advance under #1045 — re-verify mergeability at merge time.
- Next step: T01 (settle pending check).

### REFERENCES

- Issue #1042 checkpoints: https://github.com/skytuhua-org/Gen-V1/issues/1042 (comments 001–007)
- PRs: https://github.com/skytuhua-org/Gen-V1/pull/1044, /pull/1045, /pull/1046
- Workflow runs pending at last checkpoint: `44710003528`, `44710010047`, job `136197156195`
- Baseline `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`

