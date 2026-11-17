# C2 canonical App readiness failure attribution

`c2-browser-chat-view-green-02` remains **FAIL: 5 passed, 1 failed**. The first canonical App case exhausted the original 5,000 ms enabled-textbox assertion. This is a completed readiness assertion failure, unlike the earlier UI cases whose assertions were interrupted by whole-test teardown.

## Recorded order

| Event | Trace time (ms) | Meaning |
| --- | ---: | --- |
| `page.goto('/')` returned at document load | 13,543.924 | The recorded root was still empty at 13,542.975. |
| Runner enabled-textbox assertion began | 13,545.964 | The expected textbox belongs to `thread:task-thread`. |
| Library assertion began | 13,547.566 | Original timeout: 5,000 ms. |
| Bootstrap request began | 17,461.794 | 3,915.830 ms after the runner assertion began. |
| Initial snapshot request began | 17,848.166 | HTTP 200; request duration 6.126 ms. |
| Split layout request began | 18,037.062 | HTTP 200; request duration 13.414 ms. |
| Library assertion failed | 18,554.063 | Elapsed 5,006.497 ms; element not found. |
| After snapshot captured the composer | 18,662.594 | Correct split view and Message textarea, with no disabled or inert ancestor. |
| Runner reported assertion failure | 18,675.949 | Failure preceded teardown. |
| After Hooks began | 18,678.901 | No whole-test timeout caused this assertion to terminate. |

The composer is present in the snapshot 108.531 ms after the library expectation ended. This bounds when it was captured, not its precise mount time. It does not convert the failed expectation into a pass.

## Startup and fixture attribution

The canonical App is initialized through an asynchronous `import('./DesktopEntry')` in `main.tsx`. Document load can finish before that import graph and App initialization finish. The trace records 308 network resource snapshots; App.tsx delivery took 1,215.394 ms, and several other module requests took roughly 0.6 to 0.75 seconds. These timings identify elapsed module delivery and application startup, not a measured breakdown of transform CPU time or host contention. Bootstrap did not begin until almost four seconds into the readiness assertion.

Bootstrap, snapshot, models, workspace and split-layout routes returned HTTP 200. The synthetic fixture deliberately returns 404 for unimplemented API routes. The two recorded 404s are `/api/plugins` and `/api/workbench/threads/task-thread`; neither prevented the eventual recorded composer. There is no non-GET request in this trace and no source capture, source open or message-send operation. The failed first case never authored a draft or reached its message/attachment assertions.

The preceding three passed Escape/IME cases use a direct component fixture. They do not initialize canonical App. The subsequent two canonical App cases passed draft, selection, scroll and DOM identity preservation, and reduced-motion/focus checks. Those results remain separate from the failed cold-start case.

The embedded chat-view test and fixture bytes match the inspected worktree. The canonical App spec and fixture, `main.tsx`, and `DesktopEntry.tsx` are byte-identical to accepted main `138b1356495bb3a2c9b35020240513f8faa84964`. App and its dependency graph contain candidate changes, and this static comparison does not prove accepted-main runtime parity. The config adds the direct Escape/IME cases and retained failure traces. The generic task-fixture diff changes only the separate split-layout helper, which this chat fixture does not call.

## Disposition and limits

The attributable symptom is a canonical App startup readiness miss on this candidate Linux Chromium run. No specific source-selection, draft-preservation or permanent missing-composer defect is established by the trace. A causal delta from accepted main is unresolved because no accepted-main runtime evidence is part of this audit. The planned exact-head Windows/Edge workflow and paired root comparison remain future evidence.

This audit ran no tests, changed no product or test source, and changed no deadline. The original receipt, result, failure trace and error context are preserved. The companion JSON records their byte lengths and SHA-256 seals, trace member seals, complete API timings, exact assertion identities, and source comparison hashes. Production response bodies are absent from the retained network trace, so non-embedded production source hashes are explicitly audit-time observations rather than a reconstructed run source cut.
