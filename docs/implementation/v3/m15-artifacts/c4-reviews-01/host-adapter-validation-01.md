# C4 host adapter validation and risk review

The exact two-file proposal was applied by the parent and passed the unchanged initial fixture plus the broader source-level host regression gate. No actionable core defect was found in the inspected change or those executions. This review does not grant native, browser, packaged-runtime, or whole-project typecheck approval.

## Exact source and observed results

Applied SourceWorkbench SHA-256 is `9fc076adf608a620156fc39e49c34e92f4bb69ed58da6d8e7c4fc2d915fa0227`; Service is `c65007b5f1b181d4ee7e444400e70a2fbb76afd9fdf4803c769050b41fba1909`. Both match `memory-module-proposal-01/manifest.json`. The parent applied these files; this agent did not modify or stage repository source.

| Recorded attempt | Actual outcome |
| --- | --- |
| `c4-source-memory-initial-01` | FAIL, 10 passed and 12 failed across two files. All failures remain retained. |
| `c4-source-memory-green-01` | PASS, 22 passed across the same two unchanged test files, no skips. |
| `c4-host-regression-01` | PASS, 291 passed and two skipped across 20 selected files, no failures. This larger selection includes the same 22 cases; these totals must not be added as distinct coverage. |

Both successful runs passed whole-source verification before and after execution against `docs/implementation/v3/m15-artifacts/c4-integration-green-01/source-cut.json`: 2,390 files, 55,412,423 bytes, SHA-256 `692fe4b7bfd8bf7de881d11f2a0603e82e88ad9b7c3d55b289b506893010689a`, HEAD `0f487aa82fba616131d7f9e547076d3a14d67f48`, accepted base `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`. This is a measured working source cut, not a claim that uncommitted changes are in the Git HEAD tree.

The unchanged host test has two genuine Windows-only skips: retained-file grant revocation and first-file account custody. Its actual Linux unsupported-leaf negative executed. The memory storage namespace-pin case retains its explicit mocked Linux guard; it is application call-site coverage, not native custody proof. Account routing injects controlled runtime factories, and memory HTTP tests use actual Fastify injection/Service/Store with recording runtimes and an explicit failing PTY stub.

The exact 20-file command and all selected test hashes are in `host-regression-plan-01.json`, SHA-256 `4b4a8e8dca0abaf52a4104b62c54d4a1ade6c3105e3e16172708145a5c4e0df2`. No command filters, timeout changes, skip changes, package mutations, builds, Python workers, live model calls, or browser runs were introduced by these gates.

## Core change assessment

The constructor retains the adopted request-custody-before-SourceWorkbench ordering. Its callbacks are lazy, so supplying the new readers does not initialize memory during Service construction. Existing one- and two-argument SourceWorkbench callers remain valid.

M04 projection now uses the exact Service decision, including M05-forced custody and explicit true/false host overrides. The three formerly failing effective-capability assertions now pass after their actual Service preparation and dispatch assertions. No flag is rewritten.

M05 metadata is derived from the owning view only after actual access admission. The existing memory access digest and deletion fence are checked again after the callback promise resolves, immediately before the existing SourceWorkbench logical-owner/account/root/workspace check. The account/project race tests and exact unexpected-error propagation test pass. The callback cannot expose memory text through the module result, and the state cases verify no capture, preparation, dispatch, or memory-row change during their initialized reads.

The new availability read intentionally shares the owning M05 failure boundary: unauthorized main-thread/project/working-copy scope, damaged deletion custody, storage migration failures, or unexpected reader errors reject the evidence call instead of fabricating EMPTY or AVAILABLE. An epoch, run, model, or binding change during the awaited read can also invalidate the owning access. This stricter read may require a fresh panel read after a concurrent transition; no stale result is returned.

Lazy first use of ProjectMemory may perform that existing owner's storage initialization or migration. The adapter adds no separate Store writer, mutation command, or asynchronous Store callback. Its `readOnly: true` property describes the module interaction and does not claim that existing owner initialization is physically write-free.

The broader gate covers original source admission/recovery, M04 preparation and synchronous rollback, account binding, M05 owner access and HTTP admission, request lifecycle, retained reads, deletion and restore fences, and bounded recall. Native Hermes/checkpoint/provider behavior remains a separate target-platform gate after a fresh build. The unchanged real Hermes integration test was deliberately not selected here.

## Retained artifact identities

| Artifact | SHA-256 |
| --- | --- |
| `m15-logs/c4-source-memory-green-01.json` | `f4062a9766a612f704d32c9abe052bbfd1732e36e246150b55062db1b8028745` |
| `m15-logs/c4-source-memory-green-01.log` | `0b9bad7087655798c56d05f520a2568215ec97725cb21fc88f6796c1d02a3b9b` |
| `m15-artifacts/c4-source-memory-green-01/results.json` | `71cee08747ec1c1964934533353f4c60f3f263e793b1f6dc6f447de86396f24a` |
| `m15-logs/c4-host-regression-01.json` | `1e11fe4ef61a7f4c5217d0823c632b5568b734acdb0505f80a83d88e834ac905` |
| `m15-logs/c4-host-regression-01.log` | `cf9b95b4e314526cc894ca93c0caa1ae3b3ff53e468a7cd201bf07dedde86803` |
| `m15-artifacts/c4-host-regression-01/results.json` | `ce433c1c2e00d09e8c936abc7e5d2b596e656ebe15578bc9a3c34d548c279b6f` |

Artifact paths in this table are relative to `docs/implementation/v3/`. Both receipt log digests were independently matched to raw bytes. The broader JSON contains 20 file results; its aggregate 32-suite count includes nested suites and must not be described as 32 executed files.
