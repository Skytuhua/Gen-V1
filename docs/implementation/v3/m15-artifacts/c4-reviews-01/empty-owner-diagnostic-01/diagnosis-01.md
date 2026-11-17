# Empty-owner handoff progress diagnosis

The current journal handoff policy has a reproduced progress defect when two same-thread guards validate an absent source record through asynchronous IndexedDB requests. This is separate from a missing or failed persistence operation. The fixture starts with healthy empty storage, performs no source mutation, and starts the actual App-shaped and SourceWorkbench-shaped registry guards.

## Observed evidence

`c4-empty-owner-diagnostic-01` ran the actual journal, recovery and editor registry modules with only IndexedDB and staging scripted. Each empty request was delivered with `setImmediate`. Both guards started; neither reached ready. The diagnostic stopped deliberately at its bounded progress sentinel after 66 source reads, 68 reads total, and returned exit 1. Before and after verification matched the 2,391-path source cut `5f0de8a3c62b27685ac6a929f0d4fb0ec7c7d94f88bd9cc1f70ceafe1808e24a`. Its observed FAIL remains preserved. The 64-read sentinel is a test stop condition, not an observed production storage error.

Root then applied only the two additive regressions. Normal `c4-empty-owner-red-01` failed 2 of 27 cases: both new empty-owner schedules hit the 64-observation progress sentinel. The original 22 source-handoff cases and all 3 editor registry cases passed. One new case begins after successful empty hydration; the other begins while the first source hydration is held. Existing deadlines and original case bodies were retained.

The complete prior browser attempts remain separate: App `c4-workbench-app-final-01` is 22 passed / 4 failed; desktop `c4-desktop-final-01` is 26 passed / 5 failed; renderer `c4-workbench-final-01` is 21 passed / 0 failed. None has errors, skips or flaky outcomes in its JSON report.

## Source mechanism

`journalReadRecord` caches recovered records, but an absent record remains uncached. Each later absent-source read therefore creates a new IndexedDB request. The observation layer records every read before its first await and increments `revision` and `pending` on entry and settlement. `prepareEditorHandoff` invokes all registered guards concurrently. Both App's composer guard and SourceWorkbench's source guard invoke `prepareSourceOwnerHandoff` for their owner.

That helper compares all observed revisions around `journalFlush`, then rejects a final snapshot while any key is pending. With empty reads delivered in separate event-loop tasks, each validator can observe the other's read as pending or as a revision change, retry, and issue another absent-source read. No source generation or authored value changed in either reproducer. The reproduced feedback is between validation reads themselves. Earlier passing double-guard fixtures cached retained source records and used microtask delivery; those bounded passes did not establish this empty-store schedule.

## Browser trace boundary

The activity case clicked Other at trace time 92212.569 ms and never issued a split-workspace command. Its final snapshot still selected the original task. The source-aware case successfully opened Other at 112128.186 ms with a 200 `split-workspace.view.open` receipt, then clicked the original task at 112625.643 ms without issuing a return command; its final snapshot still selected Other. Those observations are consistent with the reproduced pre-command handoff defect. The browser traces do not contain journal stage instrumentation, so they do not independently identify every blocked await.

The stale-source case began reload at 42013.265 ms and has no post-reload snapshot or workbench request in the retained network trace. The rollback case has no snapshot request in its initial-load trace. Their startup/reload causes remain unclassified. Do not attribute them to this repair or relabel their original failures.

## Proposed correction and remaining verification

The proposed wrapper queues separate validation operations by thread ID because different logical owners of one thread share the text and pending-send journal keys. Every call parses and retains its own logical owner and runs the unchanged strict validator. A prior rejection is caught only for advancing the queue; the original promise still rejects. Cleanup removes the queue entry only when it is still the exact operation being completed.

No cached readiness is shared. No feature-flag bypass, generation-only shortcut, blanket IndexedDB catch, sticky-error reset or recovery-barrier relaxation is proposed. Four additional boundaries cover a failed actual CAS beginning after an earlier validation snapshot, ordered different owners on one thread, first hydration with retained source and uncertain send, and progress after a prior owner rejection. They are proposed source fixtures at this review point, not passing observations. Version 1 of that addition had a potential fixture wait if neither validator reached the injection point; unexecuted version 1 is retained, and version 2 bounds that wait by the two actual settlements before asserting injection occurred.

Exact source, receipt, result, trace-readback and patch hashes are in `diagnosis-01.json`. The copied validator body is byte-for-byte unchanged. Current browser and target-platform verification must follow application; this diagnosis does not approve the wider feature or reinterpret earlier evidence.
