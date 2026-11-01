# Codebase audit and performance cleanup — 2026-11-01

This is a local React/Node/SQLite coding harness with trusted task interfaces, durable artifacts and several runtime adapters. The audit assumed one local user, multiple windows/agents and long histories. Baseline: `2ce8aaf`. Source inventory, import reachability, strict compiler checks, dependency advisories, main flows and high-risk boundaries were reviewed; this is not a claim that every third-party SDK or live account was exercised.

## Measured changes

| Measurement | Before | After | Scope |
|---|---:|---:|---|
| Empty thread search | 21.88 ms | 0.0091 ms | Median, same 200-thread/20,000-message microbenchmark |
| Nonempty thread search | 21.66 ms | 1.2361 ms | Same fixture; message order and cross-message phrases preserved |
| Snapshot SQL queries | 213 | 13 | Same 100-thread/5,000-message/20-dataset fixture |
| Repeated snapshot response | 65.33 ms | 25.29 ms | Median warmed HTTP injection, same 15,664,687-byte payload |
| Initial production entry JS | 822,571 B | 769,030 B | Actual Vite output; Settings is deferred, not removed |
| Initial entry JS, gzip | 254,605 B | 237,877 B | Same compression method |
| Initial stylesheet | 139,431 B | 134,031 B | Actual Vite output |
| Pinned settings source | 842 lines | 167 lines | All 136 rows and their order have an identical content hash |

The snapshot-query correction alone did not improve the large JSON serialization benchmark measurably: median 45.52 → 46.50 ms in this run. The repeated-response improvement comes from reusing one immutable serialized response per committed sequence. This helps multiple windows reading the same state; it does not make the first response after every commit faster. These are local synthetic measurements, not live inference or a device-performance guarantee. Raw local measurements are retained under `.harness-lean-audit/` and excluded from Git.

## Findings resolved

1. **Repeated history scans:** App built every thread's full message history on every render, even with no search. Empty searches skip message access; nonempty searches group messages once. Unused derived arrays and imports were removed.
2. **Eager settings loading:** Settings, its inventory and connection UI loaded before the composer could be ready. On-demand loading now keeps the conversation available. Failed downloads stay in a dismissible dialog; explicit reload requires pending marks, native handoff guards and journal persistence to be settled.
3. **Retained schema identities:** Fresh snapshot objects accumulated in module-global Ajv caches. Frontend validators use one 64-entry content cache; native registries are released. Host compilation also releases its registry. Validation remains Ajv-based, with the original format/error options.
4. **Async schemas accepted by synchronous commands:** `$async` validators returned truthy promises, accepting invalid responses and causing unhandled rejections. Admission rejects async schemas; host and frontend require synchronous results. Recovered invalid requests stay pending instead of being silently accepted or deleted. Exact operation approval remains a separate authority boundary.
5. **Workspace reads for settings changes:** `settings.update` built the complete snapshot merely to read settings. It now reads the settings entity directly.
6. **Thread-count-dependent snapshot queries:** Threads were deserialized twice and archive markers fetched twice per thread. One thread read and one archive-ID set preserve visible/archived content and pinned data versions without a mutable entity cache.
7. **Repeated response serialization:** Authorized local windows independently rebuilt identical snapshots. One server-owned response, capped at 16 MiB, is reused only while the committed sequence is unchanged. Authentication still precedes access; content/resource reads retain their existing grant checks.
8. **Corrupted/unbounded process output:** Decoding each chunk independently damaged split Unicode characters, and the character-based truncation could exceed its byte limit. Continuous decoding now keeps a valid UTF-8 prefix within 256 KiB per stream, preserving termination, cancellation and actual exit status.
9. **Malformed CSRF and growing sessions:** Non-ASCII tokens could produce HTTP 500 because character and byte lengths differ. Byte comparisons now return 403. Valid sessions are capped at 1,000 after expiry cleanup, evicting the oldest issued session.
10. **Unused verification processes and stale tooling:** The default browser command launched an unnecessary real runtime on the user's development ports. It now builds the web assets and starts a dedicated Vite without a fallback proxy to the live host. Strict no-unused compiler checks prevent dead imports/locals from returning.
11. **SSE ignores writable backpressure:** The original route queued approximately 4.94 MB during a 100-event burst/replay probe even after `write()` returned false. The durable ledger now supplies one event at a time; a single cursor pump waits for `drain`, preserves order and releases subscriptions and waiters on disconnect or shutdown. Healthy and paused loopback clients drained the original probe by 700 ms, so this establishes transient buffering, not a persistent leak. Five actual-endpoint regressions cover replay, live arrivals, disconnection, shutdown and complete/unpaged ledger compatibility.

## Removed source

Five unreferenced historical tools were retired: `assemble-initiated-review.ts`, `finalize-review.ts`, `build-centered-review-index.ts`, `build-smooth-review.ts` and `capture-centered-comparison.ts`. The first four embed superseded dated inputs/claims; the last still is covered by the current image-annotation chapter. Together they remove 347 lines before other small compiler cleanups. Their source is recoverable from the baseline commit.

Current recorders, generic probes/analyzers, all 48 components, provider adapters, test scenarios, pinned references, historical user material and the separate review site remain. No recordings, evidence, installations or user task data were deleted. A root dependency listing was not removed merely to lower its count when the package remains required transitively. The production dependency advisory check reported zero known advisories among 339 dependencies at audit time.

## Verification and production boundary

Focused regressions reproduced the search, schema, process, HTTP and loading failures before correction. Independent code/security reviews approved the coherent changes and the SSE addition, with no unresolved material finding in this patch. The first full unit run passed 693 tests. A later run including five SSE regressions hit the migration integration test's 15-second outer timeout and caused two subsequent shared-host FAQ failures. That integration test contains two separately bounded 12-second phases plus database work and 3.8 seconds of presentation holds. Only its outer budget was corrected to 30 seconds; all condition waits and production deadlines remain unchanged. Its isolated rerun passed all eight cases before the final full-suite confirmation.

The full browser sweep ran 526 cases: 518 passed, six policy skips and two failures. One motion test measured the temporary loading dialog instead of the loaded Settings dialog; its selector now measures the actual surface. The other was an intermittent table-selection failure during a large snapshot burst: one of four trusted clicks did not toggle, and the final selection was empty. The unchanged isolated case passed three times; two instrumented runs covering 80 toggles showed no overwrite or missing native input. No cause or justified production selection fix was established. The test now asserts each click and eventual durable selection, retaining the final assertion. The final affected-browser run passed 23 cases with two policy skips, including HTTP/SSE, latency, snapshot/selection, Settings recovery and motion. Across the sweep and affected reruns, all 520 distinct runnable cases have passing results; this does not erase the initial intermittent observation or establish that its cause is fixed.

Final confirmation: **698/698 unit tests passed**, no skips; strict `pnpm typecheck`, `pnpm build`, `pnpm desktop:build` and `git diff --check` passed. The production build retains upstream Zod annotation warnings and a main-chunk size warning; the warning threshold was not raised to hide them. The desktop shell was compiled, with no installer rebuild. Production acceptance remains qualified by the intermittent selection observation above.

| Text source group | Baseline lines | Final lines | Net change |
|---|---:|---:|---:|
| Application and packages | 16,490 | 15,947 | −543 |
| Tooling scripts | 4,611 | 4,261 | −350 |
| Tests and browser fixtures/config | 14,652 | 15,060 | +408 |

Application plus tooling removes **893 net lines and 59,601 bytes**. This includes new bounded-stream/validation/search helpers and the Settings recovery path; reductions are not minification. Test growth preserves and extends the safety coverage. Root configuration adds four lines, and audit/plan documentation is counted separately. Including tests, documentation and the unchanged lockfile, tracked text decreases from 44,026 to 43,648 lines (378 net), counting a nonempty final line without a newline. The two documentation files intentionally add reviewable evidence rather than inflating the code-reduction claim. There are no deleted components, weakened tests, removed providers or dependency changes.

Completed native-agent results were received and acknowledged. T3 task-status lookups for those native tasks returned `task_not_found`, so no matching child-thread IDs were available for recoverable archiving; no unrelated threads were archived.

Live subscriptions, real provider quality, physical mixed-DPI/multi-monitor behavior and installer rebuilding remain deferred. Generated-code applications remain disabled. External atomic saves can still race approved file replacement; competing editors must be paused for exact replacement. Source/test readiness must not be promoted to unconditional production-release acceptance.
