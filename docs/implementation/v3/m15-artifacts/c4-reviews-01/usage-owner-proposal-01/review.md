# Shared live Usage owner correction

This is an unexecuted, outside-repository proposal against source cut `f542de949b162bf343058a77b2cbb6091d7f6ebb10ef1df1926776a3d3e5006a`. The active repository has not been edited by this proposal. `implementation.patch` SHA256 is `34c331588970e8ed447f18db772674932151121989d63540c9c7481d14ca98dd`. The four exact before/proposed file identities are in `manifest.json`.

## Observed defect

The retained `c4-usage-chromium-corrected-01` result is FAIL: 13 passed and 3 failed. Its complete command/result/source binding and trace extracts are sealed in `../browser-corrections-review-01/review.json`, SHA256 `914ffd84151b70e7f3e6bb6bdb3d5ffa74f83817a30723778b7fc25a6060058b`.

In the split Usage case, filling B produces a root models request for B at 44,129.111 ms and the exact visible `999 input tokens` assertion passes at 44,339.486 ms. B's Hide launcher then sends `pane.focus(other)` at 44,536.698 ms; revision 4 returns at 44,576.933 ms. The root requests models for A at 44,731.656 ms. B's last Show launcher and Open Usage follow at input snapshots 44,845.705 ms and 45,007.221 ms, and the modal reports A's title and 7 tokens.

`convSendSplitCommand` first records B focus, then publishes the canonical main selection from pane-main A. A stored main-placement record causes `thread` to resolve to A, while `selectedId` still remembers B focus. This canonical main behavior supports existing main navigation and native return. The defect is that the shared live-Usage footer also uses `thread` as its displayed owner. Its wrapper additionally discards the footer callback's owner argument. Fixing only that wrapper would still use A after the observed main-selection publication.

## Product scope

The proposal leaves `thread`, `resolvedMainId`, `mainPlacement`, `publishMainSelection`, focus/placement commands, provider boundaries, source custody and handoff guards unchanged.

`WorkspaceSplitLayout` already computes whether each view is active from the current pane/tab membership, collapse state, responsive folding, measured slot and floating rectangle. The proposal extracts that exact existing computation into `viewPlacements`, used by the same keyed surface DOM and the same `renderView(view, active)` calls. It adds an optional `onActiveViewsChange(workspaceId, viewIds)` notification. Other callers omit it and retain their existing behavior.

The notification runs in `useLayoutEffect`, never during render. Its dependencies are the workspace identity, callback identity and a sorted active-ID key. Unchanged active membership does not emit another notification because of unrelated renders, position changes or object iteration order. App supplies a stable `useCallback` and also returns its previous state for identical workspace/ID values.

The shared footer then chooses its owner only from currently eligible candidates:

| Condition | Candidate behavior |
| --- | --- |
| View is hidden, inactive, collapsed, folded away, or no longer present | Not eligible in the renderer's active-view membership/current layout |
| View is not a local conversation or its project binding differs from the current thread | Not eligible |
| Thread was removed or archived | Not eligible because lookup uses current `snapshot.threads`, not archived or cached objects |
| Thread is detached or moving to a native window | Not eligible through existing `detachedSurface` and `pendingSurface` helpers |
| Desktop is closing, canonical split hosting is disabled, or a plug-in owns the visible work area | No shared-footer candidates |
| Current `selectedId` is eligible | Use that focused conversation |
| Current `selectedId` is ineligible | Use the canonical main `thread` only if it is independently eligible; otherwise no shared footer |

The shared footer receives that owner's ID and usage and forwards `onOpenUsage={openUsage}`. When there is no eligible owner, it does not expose an opener that could fall through to an old default. The ordinary footer, including pinned and embedded behavior, is unchanged. An already-open Usage modal keeps the existing captured-scope behavior; this proposal changes only the shared live-summary owner's selection and its explicit launch.

### Reset behavior

The notification cleanup emits an empty membership for its workspace on active-membership change, layout change or unmount. The new layout effect publishes the new membership. App rejects cached IDs whose workspace identity differs from the currently rendered conversation plane, and revalidates each ID against the current layout and live snapshot on every render. An empty split has no candidates. Switching layouts cannot preserve a removed B merely because B remains in `selectedId`. Snapshot and native-ownership changes independently revalidate candidates even if the set of rendered view IDs does not change.

No new wrapper surrounds the composer subtree. The keyed surface elements, parent path, active booleans, styles, float controls and provider lifetime remain the same. The notification is presentation state and does not call any host or placement command.

## Evidence-backed test changes

The split Usage case adds an exact visible B-caption assertion after the existing B hide/show sequence, then restores its expanded state and runs the unchanged modal owner/value, reload and two draft assertions. The added check isolates the point where the retained trace had already switched to A.

The shell error case now locates `iframe` inside the exact `Studio` region. Its retained trace proves the same iframe frame identity and bounds remain after dismissal, while shared Tooltip adopts `title='Studio'` into an empty native title, `data-tooltip='Studio'` and `aria-label='Studio'`. All retained-frame, Usage-modal, hidden-composer and zero-create assertions stay intact. No Tooltip or plug-in implementation change is proposed.

The new restored-split negative case sets a 1920 by 900 viewport before startup. At the previous 1440 by 900 viewport, the intentionally open workspace panel caused the existing responsive split to fold to B, making the helper's first A textarea hidden. The wider viewport is an explicit prerequisite for this case's two-visible-composer requirement. The no-Usage-modal, normalization-to-notes, both scoped visible/enabled composers, exact distinct drafts and zero-send/create assertions are unchanged. Responsive folding itself is not changed.

No assertion timeout, overall deadline, geometry threshold, browser channel or case count is changed. The complete Usage configuration remains 16 cases. No post-proposal pass is claimed. Typecheck, the affected actual-App/Usage/split browser scopes and the existing target Windows gates remain validation work after review and application.
