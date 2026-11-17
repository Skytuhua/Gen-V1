# C2 UI timeout attribution

The retained full controls attempt remains **FAIL: 17 passed, 1 timed out**. Its final error at `dialog.evaluate(node => node.matches(':modal'))` occurred after timeout teardown began. The long outstanding operation was the preceding opener click. One authorized unchanged filtered reproduction passed the complete case in **2,533 ms**, with the original **15,000 ms** test deadline and all existing assertions.

The retained full App attempt remains **FAIL: 19 passed, 2 failed**. This audit addresses the deferred-source-view case. It does not reclassify the separately reproduced 200-percent-zoom sizing defect. In the deferred-view trace, the final reload value assertion was interrupted by teardown after approximately 902 ms while the page showed “Opening workspace”. It does not establish a lost draft.

The companion [machine-readable audit](c2-ui-timeout-attribution-01.json) contains original receipts, result records, trace-call identities and timelines, network observations, source hashes, and hashes of all referenced evidence. Both original failure traces remain unchanged.

## Controls: click delay precedes the secondary modal error

Times below are the trace's monotonic milliseconds. The runner trace's clock anchor is wall time `2026-11-16T01:21:03.230Z` at monotonic `27013.860`.

| Event | Start | End or observed time | Evidence |
| --- | ---: | ---: | --- |
| Test before hooks | 27014.574 | 27121.326 | `test.trace`, `hook@1` |
| Navigate to modal fixture | 27122.851 | 27243.947 | `pw:api@40` |
| Opener click | 27245.357 | 55166.653 | `pw:api@58`, elapsed 27,921.296 ms |
| Opener locator resolves | | 33809.816 | Library log for `call@1324` |
| Element visible, enabled, stable | | 33825.588 | Same library call |
| Performing click action | | 34541.714 | Last recorded library event |
| Timeout teardown begins | 45389.852 | | `hook@105` |
| Close context starts | 55119.108 | 55583.602 | `pw:api@108` |
| Evaluate modal predicate | 55535.382 | 55552.533 | `pw:api@109`; context already closing |

The modal predicate ran for 17.151 ms and returned “Target page, context or browser has been closed”. No false `:modal` result was observed. The error context shows the Controls dialog, its focused Close dialog button, and its controls. That snapshot establishes a mounted dialog; it is not a substitute for the interrupted predicate.

The fixture performs a navigation in `beforeEach` followed by the case's modal-query navigation. Ten module requests have status `-1`; every one has a subsequent request for the same URL returning HTTP 200. They include Modal, Select, ActionMenu, React DOM and CSS. The trace contains no host API request for this primitive fixture. These records do not support a persistent missing-module or API failure.

The library trace ends while the click is outstanding. The later runner trace shows timeout handling and context teardown. The cause of the long action/instrumentation gap is not proven. There is no CPU profile or independent scheduling measurement that distinguishes contention, browser scheduling, or tracing overhead.

## Unchanged controls reproduction

`c2-ui-shell-controls-ime-repro-01` ran from `2026-11-16T01:24:22.005Z` to `2026-11-16T01:24:31.227Z`, exit code 0. The one selected test passed in 2,533 ms. It used the same documented Chromium adapter and port 5394. Assertions, fixture and the inherited 15-second deadline were unchanged. Browser work was coordinated so the shared CSS repair was held until this reproduction finished.

The before-launch source record is [c2-ui-shell-controls-ime-repro-01-source.json](c2-ui-shell-controls-ime-repro-01-source.json). The original trace's embedded controls spec has the same SHA-256 as that record. The spec, fixture, configuration, Modal implementation and old controls stylesheet also match accepted main138 byte for byte. The candidate Popover delta adds only the optional `getAnchorRect` support and its corresponding effect dependency; existing controls callers provide no override.

This filtered pass establishes that the unchanged selected case can complete under its declared deadline. It does not turn the earlier full run into PASS, prove all controls cases, or establish an accepted-base runtime result. Root owns the complete controls rerun after the independently reproduced modal-sizing repair.

## App: reload ran after the whole-test timeout

The runner trace's wall-clock anchor is `2026-11-16T01:17:53.457Z` at monotonic `84412.615`. The case's whole-test deadline is 30 seconds.

| Event | Start | End or observed time | Evidence |
| --- | ---: | ---: | --- |
| Before hooks | 84416.066 | 84477.011 | `hook@1` |
| Initial editor ready assertion | 84710.581 | 87784.597 | `expect@37` |
| Open Sources and evidence | 88061.099 | 92669.190 | `pw:api@56` |
| Native modal and expected failure alert captured | | 92665.565 | `after@call@2027` frame snapshot |
| Alert assertion, runner | 92673.025 | 116231.750 | `expect@60`, no assertion error |
| Alert assertion, library call begins | 92819.163 | | `call@2035` |
| Library before-snapshot finally recorded | | 109692.992 | `before@call@2035` |
| Whole-test timeout teardown begins | 116061.677 | | `hook@61` |
| Focus, Escape, identity, draft and no-send checks complete | 116232.931 | 119625.844 | `expect@64` through `expect@71`, no errors |
| Reload | 119626.301 | 119787.733 | `pw:api@72` |
| Final editor value assertion | 119788.404 | 120690.832 | `expect@73`, elapsed 902.428 ms |
| Context close | 120684.128 | 120691.531 | `pw:api@74` |

The source-view module failure was intentional: the test aborted `WorkbenchPanelContent.tsx`. Before the stalled alert assertion, the trace captured a native dialog with the expected “The source views could not be loaded” alert. The corresponding evidence and inputs API requests returned HTTP 200. The initial `/api/plugins` response was 404; the editor subsequently became enabled and the intended modal failure UI appeared.

The alert assertion and the later focus, connected-editor, retained-value and no-send checks completed without errors, although the whole-test timeout had already started teardown. The reload completed, then the final value assertion received only 902.428 ms before context closure. Its error says the editor element was absent. The error context shows the startup placeholder, not an empty editor.

The browser-library trace and network recording end before this reload. They therefore cannot identify the reload's module/API completion state or establish a storage-persistence defect. The report's configured five-second expectation timeout does not mean this final assertion received five seconds of usable execution.

## Exact source and trace identities

| Original source snapshot | SHA-256 |
| --- | --- |
| Controls spec embedded in failed trace | `9a42065c096f99751d9d4c3c33fc6fc3ae054ef17a5f931e25c0dc002a6fc342` |
| App spec embedded in failed trace | `c6bc1cf0166e1f38521d13e6391bc7f63c809040f7147406a0b6b10bd828e155` |
| App host fixture embedded in failed trace | `d06775ef1f79e435e602e547130530d8c9d9759e2c285168e90ec3c45b25c05d` |
| Controls fixture before unchanged reproduction | `7e5dd7b25aab10dcdd2003a9df43820760c7023e1999e477eaf13ec1767a96b0` |
| Controls config before unchanged reproduction | `8cc1c1dbb71ec3248270895310a9cd705d7766cb069dc089e2a139da27621795` |
| Chromium adapter before unchanged reproduction | `fde0a6c87c6b32b8443fb5d5714d2f7ff864f2a694338ae38557162cd461aedb` |
| Candidate Popover before unchanged reproduction | `fb5c94be1a32ba8d77d0dd919fab3a2917d207cba8096e56f47622535c9b6b4a` |
| Modal before unchanged reproduction | `3b07a74846a4c15c9e7497ee8d8d1ffee8e17ea95d089d2db68026b018cba4eb` |
| Old shared controls CSS | `f9b0798408972e5b931a87dafb5cbfb92670d2cb0186484dfae221c0e9ff30d8` |
| Old M15 source-workbench CSS | `61e90e24151b466536dab9a5803d4edf859efcfcdb3e2fd377027173364e2940` |
| Original controls failure trace ZIP | `c11f65eec67c51f5fad5b7980572357df3f9656b8d275a17e96e300e7ed2b560` |
| Original App deferred-view trace ZIP | `a6dfc8db6250cc6c166f5b71db133fcd98f14c9f158ac135795297280199f778` |

The old CSS hashes intentionally identify the cut before the later zoom repair. They are not asserted to match the corrected working tree.

## Coverage boundary

The original checkout at `/workspace/scratch/1b47eb428672/gen-v1` remains at `399cde39ff4ee82272c7a7700944325c44b36070`; it is not the accepted main138 baseline. No worktree was changed or created, and no accepted-base browser run was performed. A future baseline execution would need a separate checkout pinned to `138b1356495bb3a2c9b35020240513f8faa84964`.

This audit changes no product or test code and no deadlines. The unchanged single-case reproduction is the only additional browser job owned by this audit. Complete corrected-source browser suites and exact-head Windows/Edge execution remain separate evidence.
