# C3 native-return diagnostic review

## Result and source attribution

`c3-native-return-diagnostic-01` completed with exit 1: **20 passed, 2 timed out, 0 skipped, 0 flaky**. The native-return case passed in 9,501 ms on temporary instrumentation. The earlier unchanged-source `c3-workbench-app-01` remains **21 passed / 1 failed**. The diagnostic pass does not supersede that failure or establish a repair.

The four exact pre-diagnostic files were restored and their SHA-256 values verified. `restoration.json` identifies both source versions. Exact pre/diagnostic bytes are retained as non-executable text files under `source-snapshots/`; `pre-source.json` and `source-cut.json` retain provenance. No production fix, deadline change, assertion weakening, handoff bypass or second attempt was made.

## Native-return observation

Relative to the injected return-to-A event, the root waited for canonical split readiness at +23.7 ms, consumed the B-active revision-2 layout at +96.6 ms, completed the first source/editor barrier at +473.8 ms, completed the second placement barrier at +715.3 ms, and received A placement revision 3 at +724.7 ms. All 65 post-reload IndexedDB transactions and 79 observed requests completed. No abort/error or native focus call occurred.

The root correctly retained the return intent while the layout was held. Its child conversation instances were initially unloaded, but their pinned state did not take over root placement. The successful trace shows both repeated barriers; it does not identify the exact uncompleted operation in the original failed trace. The original failure had no A placement command, while already-rendered split mode and B selection rule against treating the startup `loaded=false` branch as its established cause.

## Activity/full-read timeout

The output assertions succeeded before navigation: 29 rows were mounted, both authorized full-read searches completed, and the last requested line was visible. The test then clicked Other and the original task, followed immediately by reload.

| Observation | Trace time, ms |
| --- | ---: |
| Other placement response, revision 2 | 58,505.836 |
| Back-to-original click completed | 59,089.391 |
| Reload started | 59,106.127 |
| Reloaded canonical layout returned Other active, revision 2 | 60,120.934 |
| Enabled-composer assertion completed | 61,139.192 |
| Activity-summary click began | 61,160.372 |
| Whole-test teardown began | 84,689.470 |

Only the Other placement POST exists. No original-task placement POST was sent before reload. Reload started 16.736 ms after the back click completed and restored the last acknowledged Other layout. The generic enabled-composer assertion therefore passed for Other. The requested activity summary remained in hidden original-task content, and its click waited until timeout. There is no recorded revision conflict or loss of the output data.

This exposes a missing canonical-navigation prerequisite in that test sequence. A bounded future correction would assert Other's selected tab after the first click and the original selected tab after the second, at the existing assertion deadline, before reloading. That correction was not applied.

## Accepted stale-input recovery timeout

The test spent 22.524 seconds before its reload within the unchanged 30-second test deadline. Initial enabled-composer readiness alone took 9.875 seconds after navigation returned. After reload, canonical owner state loaded and both input responses returned HTTP 200 with `accepted-input` and `canKeepCaptured=true`.

| Observation | Trace time, ms |
| --- | ---: |
| Test origin | 128,887.522 |
| Reload started | 151,411.592 |
| Last recorded library event | 158,887.487 |
| Whole-test teardown began | 158,995.043 |
| Inspect-inputs click completed in runner | 160,306.801 |
| Final Keep-captured click began | 160,311.473 |

The final recovery click began 1,316.430 ms after teardown started. Its reported timeout does not establish a failed recovery response, changed command identity or lost source. The error context preserves the correct owner and unconfirmed acknowledgment and shows `Loading source views`. The library/network trace ended before that final action, so later module completion and retry behavior are unobserved.

## Bounded common-cause conclusion

No single product or IndexedDB cause is established. The activity failure has an observed incomplete-navigation prerequisite. The stale recovery case exhausted its whole-test budget before the last action. The original native-return failure lacks internal stage timing, and its one diagnostic reproduction passed. IndexedDB instrumentation was enabled only for native return and cannot establish transaction behavior in the other two cases.

These Linux failures remain retained and unresolved at their recorded source cuts. Actual Windows execution is separate platform evidence and cannot retrospectively turn these failures into a repair. `analysis.json` contains exact action/network timelines, source restoration records and artifact hashes.
