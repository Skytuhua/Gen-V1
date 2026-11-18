# Selection completion ownership review

No material defect was found in the narrow fix. The complete before/proposed SourceSelectionActions files, complete held-action fixture, all three completion cases and the added second-action follow-through were read. The current product bytes exactly match proposed SHA-256 `25ff6913518ae694ec629802d0ba4ca17cb5a4f56feed13e050d74d6764f02e5`; patch SHA-256 is `cfbf672945376079bdd20ceacb84ffa1c9bb226b31837245af230187f0ed8469`.

## Cause and correction

The incoming success handler awaited the original action, then cleared both the candidate and the document selection whenever its existing component revision matched. A newer selection does not necessarily change that revision. The retained failures demonstrate that a delayed acknowledgment cleared a newer foreign range and a newer range/toolbar in the same component.

The fix captures the original DOM boundary nodes and offsets before awaiting. This avoids a live Range object redefining the original boundaries during the wait. After the existing revision fence, it removes the current single DOM range only if those original boundaries still match. Its functional candidate update independently preserves a different newer candidate. The pre-action enable/text/rendering/visibility checks, revision invalidation, canonical UTF-16 mapping, host callback, IME handlers, focus handling, busy behavior and error path are unchanged.

## Observed attempt history

| Receipt | Observation |
| --- | --- |
| c4-selection-completion-red-01 | FAIL before case execution: nested trace configuration rejected, zero executed cases, two reported configuration errors. |
| c4-selection-completion-red-02 | FAIL: unchanged own range passed; newer foreign range failed. One pass, one failure; zero skips, flaky cases or top-level errors. |
| c4-selection-completion-red-03 | FAIL: own range passed; foreign and same-component newer ranges failed, including lost same-component toolbar. One pass, two failures; zero skips, flaky cases or top-level errors. |
| c4-selection-completion-green-01 | PASS: all three cases, exit0; zero failures, skips, flaky cases or top-level errors. |

All receipt log digests were independently matched to retained log bytes. Exact receipt/result hashes and case names are in review.json. The green source cut is `5f0de8a3c62b27685ac6a929f0d4fb0ec7c7d94f88bd9cc1f70ceafe1808e24a`, on parent eeda with accepted base b4aa.

The same-component fixture explicitly focuses the source root before selecting B, proves B's range and disabled toolbar while A is pending, and retains the original A payload across A's completion. It then requires B's exact range plus a visible/enabled toolbar. Seven added lines perform a second explicit action, assert B's exact offsets/text, retain disabled state while B is pending, and clear the unchanged B range only after B's own acknowledgment. Removing exactly those seven lines reproduces the red03 spec hash `e57edc4b1f2f58132f75aeb391adc0499a4b0fa86dfdefeee898da305997efa2`; green spec SHA-256 is `568eb7e4f773fc40bd18d064a7a77d2fadd955908752b75783cbd29b3c46cb3f`. Red and green test bytes are therefore intentionally distinct, with the original failing expectations preserved.

## Scope

This is actual Chromium component/DOM behavior with a scripted held callback. It does not prove host capture authorization, actual native Windows/Edge behavior, or the full App/workbench suite. The selected group does not newly exercise rejected callbacks, IME, focus traps or owner lifetime changes; those paths were unchanged by this patch. The endpoint comparison does not introduce a distinct attempt-generation identity for reselection of identical nodes/offsets. Original setup and behavioral FAIL receipts remain preserved.
