# C4 memory UI and panel opener review

No blocking defect was found in the reviewed delta. The applied UI proposal 03 retains existing M05 ownership and source validation while exposing a read-only review from M15. The ordinary-main opener duplication is repaired by restricting the additional Chat header control to a pinned, non-embedded thread.

## Immutable inputs

The source head is `0f487aa82fba616131d7f9e547076d3a14d67f48`. Proposal 02 was reviewed and proposal 03 was verified after application; its only follow-up is accurate dynamic-import failure guidance. Exact patch and source hashes are in `review.json`.

The initial cut is `45c8c271338bfda89e8411636d0786430ae387a204cf1187d1f2eed5f7e38141`. The green cut is `692fe4b7bfd8bf7de881d11f2a0603e82e88ad9b7c3d55b289b506893010689a`. The latter verified before the memory run, between the runs, and after the panel run. No source or test edits were made by this reviewer.

## Review result

Mutation handlers and disabled controls both enforce `readOnly`. Configuration, edits, accept/reject/expire/forget and conflict resolution cannot act through this entry. Pinned source reads remain usable, including an older conflict revision. Existing project-overview callers retain their default writable behavior. Export remains an explicit retained read.

The launcher requires an exact current-owner M05 read URL and a supported read-only module. It supports retained records in DISABLED and EMPTY states. The dialog derives the current account from the exact thread/project/working-copy snapshot. Existing owner-key remounts, abort and generation checks, and the surrounding account/epoch provider fence remain intact.

The runtime import is behind explicit launch. Its loading or failure state leaves the existing workbench shell and composer subtree mounted. Both dialogs use the shared native Modal. Its focus retention only rescues focus dropped to body, so it does not steal a deliberate move into the top dialog. Browser assertions verify Escape returns first to the memory launcher and then to the Sources and evidence opener.

## Recorded observations

| Run | Observed result | Meaning |
| --- | --- | --- |
| c4-workbench-memory-initial-01 | 1 passed, 3 failed | The queue integration already passed. All three review cases stopped at the missing launcher. |
| c4-panel-opener-initial-01 | 1 passed, 1 failed | Main exposed two matching controls; the pinned native fixture retained one working control. |
| c4-workbench-memory-green-01 | 4 passed | Held acknowledgment preserves source and authored draft; exact token/source/mode command, read-only controls, pinned reads, stacked focus, module states and owner rejection all passed. |
| c4-panel-opener-green-01 | 2 passed | Main has one control, pinned native still has its control, and open/close retains the composer node, draft and focus. |

Both green commands exited zero with no skips, flaky cases or report errors. Original deadlines and assertions were retained. Raw result and log hashes are in the JSON map. Decoded attachment files preserve their exact embedded bytes.

## Limits

The old-account in-flight source read ended with `net::ERR_ABORTED`; fixture fulfillment does not prove that response reached application code. A separate reopening deliberately returned the old-account view to the current owner and the real client rejected that envelope. These are distinct assertions.

The browser fixtures use typed scripted memory/source HTTP and a scripted desktop bridge. Host authorization, model dispatch, installed desktop, Windows and Edge proof are separate. Only six selected cases were executed here. Complete current suites remain separate gates.
