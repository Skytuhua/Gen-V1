# C3 activity synchronization validation

`c3-activity-sync-full-01` passed all **22 cases**, with exit `0`, no skipped or flaky cases, and no report errors. The recorder ran from `2026-11-16T02:46:17.342Z` to `02:48:16.032Z`. Its log SHA-256 is `150f5838ba3334eaabbdaf164102cd8e069a278da36057c195e46f8e867b5f0c`.

## Exact change and scope

Only the activity/full-read test in `tests/e2e/workbench-app.spec.ts` changed from the restored pre-diagnostic source cut. The diagnostic trace had shown a successful Other placement, a click on A, then reload only 16.736 ms after that click ended, with no A placement command. The reloaded canonical layout therefore still selected Other. The unchanged hidden A activity assertion timed out.

The corrected test now observes Other's selected tab, then waits for the actual return-to-A split-command response. It requires status 200, focused active view A in the returned canonical layout, selected A tab, and visible A view before reload. The mounted-row bound, searches across the authorized full read, retained final-row assertion, and reload assertion remain unchanged. The original 30-second test deadline and 5-second expectation deadline remain; the added response wait is bounded at 5 seconds. No product, handoff, native fixture, or timeout change was made.

The pre-fix spec SHA-256 was `ef9c4c806be3f007830e08fd85f2c6d64c86fe4e6bda4fcf911ef4d153ac4feb`. The corrected spec is `8d04a76f53259f4b6778b01d0d59509a1c6f7cd509bb5fdfecb903e3963e4449`. All six files in the pre-run source-cut record still matched after this run. App remains `9eb5a0241349cdf64c6860b63080fea3ca29c155dd1c6ffed7ccf6a6cf7e3ee4`; native fixture remains `73b87d3a1f3a46978052777c2cac2335928f447f2ba93ff6a718e7e6267e7ffb`. The temporary diagnostic instrumentation was already restored exactly.

## Observed results

| Case | Current result | Duration |
| --- | --- | --- |
| Corrected activity/full-read case | PASS | 7290 ms |
| Unchanged accepted stale-input recovery case | PASS | 6809 ms |
| Unchanged native-return/source-isolation case | PASS | 8193 ms |
| Complete App suite | 22 PASS, 0 skipped, 0 flaky | Report duration 115821.454 ms |

The current native attachment preserves exactly equal A/B draft records before return, after return, and after the final explicit B selection. There are exactly two owner-specific captures and zero ordinary `/api/commands` requests, including `message.send`, `thread.create`, `run.stop`, and `run.resume`. Canonical split `view.open` commands are separately recorded and expected. Its event record contains the A `split-workspace.view.open` at base revision 2 after held layout release. The old A description request still records `net::ERR_ABORTED`; resolving the fixture response does not establish delivery of a stale response to application code. This is a real App with scripted browser desktop/source transport, not installed-desktop execution.

## Retained failures and limits

`c3-workbench-app-01` remains **FAIL: 21 passed, 1 failed**, with the original native-return A-selection failure unclassified. The current pass validates the current source cut; it is not evidence of a native-return product repair.

`c3-native-return-diagnostic-01` remains **FAIL: 20 passed, 2 timed out** on its instrumented source cut. Its native case passed. Its activity failure established the premature-reload sequencing defect repaired here. Its stale-recovery final action started after the whole-test deadline had triggered teardown, so that trace does not establish lost draft data or a failed recovery response. The sealed diagnostic report, original traces, source snapshots, and exact restoration record remain unchanged. No common product or IndexedDB cause for all failures was established.

This was the one authorized full-suite validation after the demonstrated activity fixture repair. Windows, Edge, and installed-desktop execution remain separate gates. The unchanged `retain-on-failure` configuration does not preserve traces for passing cases; the JSON report and decoded native/zoom attachments are retained.

The companion `validation.json` records every current test outcome, source hash, artifact digest, and bounded attribution. The recorder and report are `../../m15-logs/c3-activity-sync-full-01.json` and `results.json`.
