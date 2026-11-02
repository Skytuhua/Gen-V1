# T3 account integration

Implement the requested T3-style provider account system without replacing the harness runtime, changing model IDs, copying existing credentials or starting authentication. Pin T3 source at `8760d063e903406c8e8f695b0852c0a15fc1e00f` and retain its MIT notice.

1. Copy/adapt the verified provider/binding hash and account picker mechanics, documenting original source hashes.
2. Add nonsecret account metadata and selection commands to the existing Store/receipt boundary. Soft removal preserves native profiles and established work.
3. Keep the legacy profile unchanged. Route named accounts through separate guarded profile namespaces and persist an immutable account binding before task startup.
4. Scope model discovery, history, compaction, side chats and planning readers to their owning account. Default-account changes affect new tasks only.
5. Extend fixed desktop/CLI login targets with validated opaque account IDs. Reserve credential mutation through a bounded login lease and retain account-use authority until native teardown is proven.
6. Add compact account management to Settings and identify the pinned account in the composer. Invalidate new-task catalogs on default changes without disturbing existing chats.
7. Reproduce cross-account, cancellation, lease-expiry and stale-discovery failures with fake adapters and synthetic/native filesystem fixtures. No live credentials, sign-ins, quota retries or provider requests.
8. Run full units, typecheck, web/desktop builds and browser checks. Complete independent code/security review, preserve source attribution in packaging, document evidence limits, and commit the coherent result.

## Resumed verification

The previous thread stopped before its final reviews were addressed. The resumed pass reproduced two remaining failures using offline tests, then fixed both: unconfirmed native login shutdown now retains a durable hold; writable Windows account directories retain an ordinary pinned marker before write sharing is allowed. The marker is restricted to the harness data directory and descendants. Its lifetime enforces the Windows requirement that a directory be empty before establishing a reparse point ([Microsoft documentation](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points)). Existing strict resource guards retain their default behavior.

Both regressions failed before the corrections; the corrected focused run passed 14 tests. Full verification and independent final reviews are required before committing. Live account sign-in, inference and a newly packaged installer remain separate acceptance gates.

Final review also identified a missing final directory that could be skipped at guard acquisition. An ordinary missing-directory regression failed before the helper was corrected to always open account directories. Login reservation recovery was made conservative: an expired deadline or dead owner is never sufficient to release it; only exact cleanup can do so. This intentionally defers abandoned-login recovery until native shutdown is confirmed.

The resumed pass preserves the existing checkout and its uncommitted integration rather than creating a checkout without those saved changes. Independent final source review found no remaining blockers after these corrections. The focused final run passed 63 tests across five files. Three old model-discovery API fakes were migrated to the account-aware Service boundary; the synthetic compaction test now awaits the deferred settlement event after teardown. Final full-suite evidence is recorded in the subscription account review report.

Complete: 750/750 unit tests, 534 browser tests (six skips, zero failures/flaky results), strict typecheck, production web build and desktop shell build passed. See [review report](../../subscription-accounts-review-20261101.md) for commands, retained local receipts, review scope and live/package acceptance limits.
