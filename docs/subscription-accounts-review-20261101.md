# Named subscription accounts: resumed review

Scope: the saved account integration after `a3b2877`, resumed on 2026-11-01. The implementation adds named provider accounts, explicit new-task defaults, native profile namespaces and immutable task ownership. Existing legacy profiles and task bindings are preserved. T3 copied/adapted sources and the full MIT notice are recorded in [third-party attribution](../third-party/t3code/README.md).

## Corrections

- A reported unconfirmed login shutdown retains a durable account hold through ordinary cleanup, expiry and restart. All abandoned login reservations now require explicit cleanup; a dead console is not evidence that its native children stopped. Automatic stale-login recovery is intentionally unavailable pending confirmed native shutdown.
- Writable Windows account directories retain pinned ordinary marker files before sharing is relaxed for native atomic file updates. Markers remain within the chosen harness data directory. The approach relies on the documented [Windows empty-directory requirement for establishing a reparse point](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points). Default resource guards remain strict.
- Account guards now reject a missing final directory before native work can begin. The ordinary missing-directory test failed before this correction.
- Model-discovery API tests now use the account-aware Service interface. The synthetic Gemini compaction test waits for settlement after native teardown.

Both initial corrections and the final review corrections were verified with failing-then-passing offline regressions. The final focused run passed **63/63 tests across five files**.

## Review and verification

Independent code review found no remaining blockers and verified the copied-source and retained-license hashes. The boundary reviewer identified the missing-directory issue above; its ordinary regression now passes. Reviewers used source inspection and synthetic checks, with no actual credential reads, sign-ins or provider requests.

The first unrestricted full unit run passed 742/748 tests. Three failures were outdated model API fakes; one checked the now-deferred settlement too early. Two host startup/PDF tests failed on their deadlines during concurrent work and passed a focused rerun. Application deadlines were not changed. Final full verification uses four unit workers to bound host contention.

The final full unit run passed **750/750 tests**, with `success:true`, no failures and no skips: `pnpm test --maxWorkers=4 --reporter=json --outputFile=.harness-accounts-resumed-unit-final.json`. The ignored local receipt and companion log retain the complete run.

The complete browser suite passed **534 tests**, with **six skips, zero failures and zero flaky results**, in 805.2 seconds. Command: `pnpm exec playwright test --output=test-results/accounts-resumed-20261101 --reporter=json`. The complete ignored receipt is `.harness-accounts-resumed-e2e.json`; its output directory's `.last-run.json` records `status: "passed"` and no failed tests. This includes the account-management, pinned catalog, theme/narrow layout and desktop/browser sign-in targeting fixtures.

Production web build (`pnpm build`), desktop shell build (`pnpm desktop:build`), final strict typecheck (`pnpm typecheck`) and `git diff --check` passed. The web build retains its existing dependency annotation and chunk-size warnings. No live sign-in or inference was performed.

## Evidence limits

This is local source and fixture acceptance. Live account-specific sign-in, entitlement/inference and a fresh packaged installer remain unverified. Marker lifetime checks and documented filesystem semantics do not establish an OS sandbox; no new native retargeting/race fixture was executed in this resumed pass. Direct Service coverage for named-account compaction/history and named side-chat inheritance remains a nonblocking coverage opportunity, with no source defect found in those paths.

Completed native review results were received and acknowledged. The host's delegated-task status lookup returned `task_not_found` for the native audit, so the required archival metadata could not be confirmed. Completed review threads remain visible; none was cancelled or deleted for cleanup.
