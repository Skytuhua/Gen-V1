# Selection completion regression

The incoming success cleanup reproduced a selection ownership defect. A delayed action cleared a newer foreign range and also cleared a newer range and toolbar in the same source. The scoped fix passed all three focused cases, including an explicit second action on the retained newer range. Full-suite validation remains pending.

| Run | Source cut | Actual result |
| --- | --- | --- |
| c4-selection-completion-red-01 | 6aba19ffe3d09264b598c82bad4d89628a9ac9a2d0ef1c0bda0ee8ef3738db85 | FAIL before cases: two worker/setup errors, zero tests executed |
| c4-selection-completion-red-02 | 26c677d8e2b4a8c77a06d09a8b8938fa9c21f685b5ebcdc6485d85620fd1776a | 1 passed, 1 failed; no skips, flaky cases or runner errors |
| c4-selection-completion-red-03 | dea6c23b758c9a04fe822b971fdb9529d29708a90f82c41ed2d1cc95bbb16be9 | 1 passed, 2 failed; no skips, flaky cases or runner errors |
| c4-selection-completion-green-01 | 5f0de8a3c62b27685ac6a929f0d4fb0ec7c7d94f88bd9cc1f70ceafe1808e24a | 3 passed; no failures, skips, flaky cases or runner errors |

Red01 rejected the nested trace override before execution. Root removed only that override, retaining the file's original top-level trace setting, then recorded red02 under a new identity. It supplies no product-failure evidence.

Red02 confirms the exact foreign selection at offsets 2..25 before completion. The original action payload is still the initial source range at 8..21. After completion, the foreign selection has zero ranges and empty text. The own-range cleanup control passes. Red03 additionally confirms that the newer same-source range `Visible` at 0..7 and its pending toolbar exist before completion; afterward both the range and toolbar disappear in one combined observation.

The production change snapshots the original range's start/end node identities and offsets before awaiting the action. After the existing revision fence, it removes a live single range only if those original boundaries still match, and clears candidate state only if that candidate still matches. A newer candidate remains available when the existing busy state settles. Source authorization, text/visibility checks, revision changes, IME, focus and error paths are unchanged.

SourceSelectionActions changes from SHA 691c685e96dee5ff1d4f76f1a0d4ab498b9ef15c71cd2725685a242e34896f5f to 25ff6913518ae694ec629802d0ba4ca17cb5a4f56feed13e050d74d6764f02e5. The fixture is identical across all four runs: 64b33ce48704c5bfb9ad205c58209ea7808fc5d3d2d7a7c01fc5ab43cbc6e7b9. Red03 spec e57edc4b1f2f58132f75aeb391adc0499a4b0fa86dfdefeee898da305997efa2 becomes green spec 568eb7e4f773fc40bd18d064a7a77d2fadd955908752b75783cbd29b3c46cb3f through seven added lines after the unchanged failing assertion. Those lines click the retained Attach action, verify the second held payload's exact 0..7 offsets and `Visible` text, then complete it and verify own-range cleanup plus toolbar closure. This is stronger downstream coverage, not an assertion replacement or an identical-whole-spec claim.

The green receipt log SHA is 30c34c77ed597f47aee148d6f2b5a49e7b81a38e329606892454df89089e7a1a; results SHA is c60e7fef78836343b635d4855f15a995bae64abb59e0a354eff224793ffb74d7. The structured companion retains every receipt, result, cut, case and raw hash. Current source matches the green cut for the product, fixture and spec. Root's post-run whole-source verification passed.

This is real React/DOM selection and shared-Popover behavior with a deliberately held fixture callback. It is not host capture, installed desktop or provider evidence. No deadline changed. The incoming toolbar overflow rule remains subject to the existing internal-scroll regression during the complete 21-case renderer run, without weakened expectations.
