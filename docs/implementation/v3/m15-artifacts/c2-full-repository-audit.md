# C2 full repository result audit

`c2-full-repository-test-01` remains **FAIL**, exit code 1. The command ran from 2026-11-16T00:53:39.421Z to 2026-11-16T01:00:39.918Z. This audit reads the retained results; it did not rerun tests or modify product code.

## Exact outcome

| Measure | Passed | Failed | Skipped | Total |
| --- | ---: | ---: | ---: | ---: |
| Assertions | 3,344 | 271 | 56 | 3,671 |
| Test files | 299 | 44 | 4 | 347 |

There are **4 additional unhandled rejections**. Three are GitHub authentication-expiry expectation mismatches receiving file-access denial; one is a file-access denial during account login. Vitest identifies the latest associated tests, which is context rather than proven rejection origin.

JSON reports 555 suites because that count includes nested suites. Its file statuses call four entirely skipped files passed. Recomputing outcomes from each file's assertions gives the 299/44/4 file counts above, matching the console. The retained log contains no recorder truncation marker.

## Failure grouping

These groups describe recorded symptoms. They do not attribute failures to an accepted baseline or prove that every failure has the same platform cause.

| Observed group | Failed assertions |
| --- | ---: |
| guard-denial | 188 |
| catalogue-or-invocation-assertion | 58 |
| target-package-or-executable | 10 |
| timeout | 4 |
| http-403 | 4 |
| other-assertion | 3 |
| desktop-startup | 2 |
| hermes-callback | 2 |

Of the 188 file-access-denial assertions, **141 contain a direct Linux guard stack** and 47 expose the same denial through a wrapper or expectation. The owning Linux implementation requires its verified broker/kernel custody boundary and refuses unsupported leaf/read-only/tree operations. This evidence supports identifying guard refusals. It does not authorize weakening the contract or establish a Windows outcome.

The 10 explicit package/executable failures are 5 missing `@cursor/sdk-win32-x64/package.json` failures, 4 missing pinned Graphify/Spec Kit Python payload failures, and 1 attempt to execute the Windows Biome binary on Linux. The complete log supplies the full ENOENT paths for the two assertions whose JSON messages abbreviate the unavailable-payload error.

The remaining **73 assertions retain unclassified underlying causes**. They include 58 catalogue/invocation assertions, of which 43 dereference an absent `ref` and one an absent `files`; 4 approximately 60-second timeouts; 4 HTTP 403 responses where 200 was expected; 2 generic desktop startup failures; 2 uncalled Hermes callback assertions; and 3 other assertions. The other assertions are a missing prepared repository operation, bundled integration availability, and `INVALID_RESOURCE` where `CAPABILITY_DENIED` was expected for a Windows-style path. The desktop IPC helper intentionally suppresses raw startup details, so the generic startup errors cannot be classified as missing assets from this receipt.

## M15 and touched-test reconciliation

All **24 files from `c2-final-focused-01`** occur in the full result with identical ordered assertion names and statuses: **334 passed, 0 failed, 3 skipped**. That earlier focused command independently passed and has its own receipt/result identities in the machine-readable audit.

The ten explicit M15 source/workbench/activity-output v3 files contain **114 passed, 0 failed, 3 skipped** assertions. Source host coverage is 45 passed plus the two Windows-native cases skipped; the real Hermes source test is the third Windows skip. The M04 preparation file has 34 passes. All 15 unit-test files listed in the preserved source-cut manifest are present and total **198 passed, 0 failed, 3 skipped**. None of the 271 failed assertions belongs to those touched unit files or the 24-file focused selection. This is an observed test-outcome comparison, not a claim that changes cannot affect other tests.

`tests/public-source.test.ts` has **11 passes** in the full run and is separate from the focused 334. The touched browser specs are outside this Vitest run and require their own browser receipts. No skipped Windows case counts as native acceptance.

## Source and receipt identities

This result belongs to the **pre-UI-correction source cut**. Later UI primitive, workflow, and public allowlist changes require later evidence. The original cut is preserved, and its source hashes are not required to match the subsequently edited working tree.

| Evidence | SHA-256 |
| --- | --- |
| Full JSON results | `873f1a369e71a5a3776e3f0cfe3b5d81bbe85f9c2638dce5b49fec386e384684` |
| Full receipt | `567290aa12014f1d075b31e4ba0a38fbd5effc3dd0f34308a1ad278e02145e46` |
| Full log | `be94231d1943b5932552c90c7a13f0c6b0e936ff394fa0782229f7c86abc36ae` |
| Preserved pre-UI source cut | `9a3b3177520471b915902bf7d017b296885a679834d2c626ae67150b692eb0d5` |
| Focused JSON results | `f372d5871a22c7ca863c8f558b9985e1e3e48547567085cae8ff92d3c03fd110` |
| Focused log | `3fdcbef8c4859817b6b90c8ba9a71a3b5f29e88ca5391ad257183df3f749fb74` |

[The complete machine-readable audit](c2-full-repository-audit.json) preserves every failed assertion with its original result pointer, stable case ID, failure messages, signature grouping, file outcome, all four unhandled-error excerpts, all skipped test names, the focused comparison, and source/receipt digests. No accepted-base test run was performed; no failure is labeled pre-existing or introduced by this patch.
