# Empty-owner FIFO validation addendum

The one-file FIFO repair passed the normal 31-case handoff gate and the full planned 28-file host/caller gate. The exact red02-to-green source-cut comparison changes only `apps/web/src/workbench-recovery.ts`; the final source-handoff test bytes and all 31 selected case identities are identical across that red and green. The strict validation loop is byte-for-byte unchanged behind the new wrapper.

| Receipt | Observed result | Scope |
| --- | --- | --- |
| c4-empty-owner-diagnostic-01 | FAIL, exit 1 | Actual journal/recovery/registry with scripted empty asynchronous reads. Both guards started; neither completed before the bounded progress sentinel. |
| c4-empty-owner-red-01 | 25 passed, 2 failed | The two new absent-source schedules fail; original 22 source cases and 3 registry cases pass. |
| c4-empty-owner-red-02 | 27 passed, 4 failed | Same two progress cases plus intervening-failure and same-thread ordering boundaries fail. All 31 case identities match green. |
| c4-empty-owner-green-01 | 31 passed, 0 failed | 28 source-handoff cases and 3 editor registry cases on the FIFO implementation. |
| c4-final-host-regression-02 | 410 passed, 0 failed, 2 skipped | Exact prior 28-file host/caller selection, with only receipt and JSON output IDs changed. |

The final host run started at 05:59:16.185 UTC and ended at 06:00:03.328 UTC on 16 November 2026. Before and after verification matched cut `0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260`: 2,391 source paths, 55,491,032 bytes, HEAD eeda4a89879aa1f3baaa04e60dd4a2d9c520761c, accepted base b4aa2caa5a3cedb29a0fddb510e49b5abd802a73. The JSON has 44 describe suites but 28 actual test files. Both skipped identities explicitly require Windows file guards; they are not native passes.

## What the change guarantees in the exercised boundaries

Each handoff invocation retains its own parsed logical owner and performs a fresh strict validation. The queue is keyed by thread because text and pending-send journal keys are shared across that thread's project/workspace owners. No ready promise is reused as another call's approval. An earlier rejection advances the queue without being hidden from its caller or substituted for the next call's result. Queue cleanup checks exact promise identity so an earlier completion cannot remove a newer tail.

The new cases exercise empty storage after settled hydration and while initial hydration is pending; a real failed CAS scheduled after an earlier validation snapshot; ordered validation of two logical owners on one thread; a queued owner's first hydration containing retained source plus an uncertain pending send; and fresh validation after a prior owner rejects. The original cold-owner, failed write, first CAS, import preprocessing, sticky failure, explicit retry, ownership, and retained-record cases remain present and pass. Journal transactions, observation metadata, global recovery barriers, cold-owner criteria and source failure handling were not modified by this repair.

Boundary proposal version 1 was never executed. Root's review identified a possible fixture wait after both old validators had ended. Version 2 races the injection signal against both actual settlements and asserts the injection occurred. Both proposal versions and their hashes remain preserved; this is a static fixture correction before execution, not a red runtime attempt.

## Limits retained

These cases execute actual journal/recovery/registry code with a clearly labeled IndexedDB adapter. They do not prove an installed desktop or Edge result. Current complete browser gates at cut0c4 remain pending at this review point. The earlier complete App22/4 and desktop26/5 attempts remain failures, and the earlier renderer21 pass remains its own source-cut evidence. The two startup/reload failures with no snapshot request remain unclassified. No broad browser repair or latest-main compatibility conclusion follows from this unit pass.

Exact receipts, log/result digests, failed and skipped identities, source-cut identities and preserved proposal hashes are recorded in `red-green-review-01.json`. No further tests or source changes were performed during this readback.
