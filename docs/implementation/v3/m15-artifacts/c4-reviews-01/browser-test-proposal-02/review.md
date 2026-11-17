# C4 browser test correction proposal 02

Status: private proposal, not applied or executed. Repository source remains the verified cut `692fe4b7bfd8bf7de881d11f2a0603e82e88ad9b7c3d55b289b506893010689a` at local HEAD `0f487aa82fba616131d7f9e547076d3a14d67f48`. The last read-only verification matched all 2,390 source files and 55,412,423 bytes. This report does not adopt a newer external head.

`tests.patch` SHA256: `3446a347445bfd3f46bc4e7e075ca6701e1c23e4a31fd0fc882c98833da03fe6`.

`evidence.json` SHA256: `eb41b87628fddd75134b90867d82b39f7326a80ff2ba068c5e846218a63b5d94`.

The companion manifest contains exact before and proposed hashes for four test files. The evidence file binds every receipt, log, result, retained failure trace and error context listed below. It also contains extracted API timing, command payload/revision, and marked input-owner records.

## Observed current-cut results

| Run | Scope | Observed result |
| --- | --- | --- |
| c4-workbench-app-regression-01 | Declared Linux Chromium actual App fixture | PASS 26/26 |
| c4-project-memory-regression-01 | Declared Linux Chromium M05 fixture | PASS 15/15 |
| c4-desktop-regression-01 | Declared Linux Chromium scripted desktop bridge | FAIL: 26 passed, 4 failed |
| c4-usage-chromium-initial-01 | Private `.ts` override loader | FAIL before collection; zero tests |
| c4-usage-chromium-initial-02 | Private `.mts` Chromium override of declared Edge suite | FAIL: 9 passed, 6 failed |
| c4-workspace-chromium-initial-01 | Private `.mts` Chromium override of declared Edge suite | FAIL: 47 passed, 1 failed |
| c4-layout-chromium-initial-01 | Private `.mts` Chromium override of declared Edge suite | FAIL: 13 passed, 2 failed |

Every executed suite reported zero skips, zero flaky cases, and zero report-level errors. The configuration failure is retained separately from browser execution. The v1 wrapper was parsed as CJS and failed importing repository ESM. The v2 wrapper uses an explicit `.mts` filename with the same bytes. Its only behavioral override is Chromium in place of unavailable Edge; its relocated `testDir` is absolute. Original test membership, deadlines, ports, server commands and working directory remain unchanged. These results establish neither Edge parity nor installed-desktop behavior.

## Corrections and preserved assertions

### 1. Select B before filling B

The workspace test starts its unscoped `Message` fill at trace time 57,565.121 ms. The B placement command starts at 57,572.402 ms and finishes at 57,577.455 ms with revision 2. The fill's marked input at 57,579.568 ms is still under `data-split-view="thread:parent-a"`. The next marked input at 57,706.917 ms is that same A input under a hidden, inert ancestor with `display:none`. B is selected and has a visible enabled empty composer in the final error context.

This is a concrete selection race. The test did not type into B, return through All Agents, or reach its final draft assertion. The patch waits for B's canonical tab to have `aria-selected=true`, then uses the B split-view-scoped `Message` textbox and checks visible/enabled before filling. The original All Agents transition, return, exact draft-value assertion, 20-second overall deadline and five-second assertions remain unchanged.

### 2. Measure settled popup geometry

Both layout failures are strict row-height comparisons: 31.99517059326172 px and 31.999969482421875 px against the unchanged 32 px minimum. The dark trace records the triggering input at 25,225.482 ms, the opened popup snapshot at 25,301.954 ms, and the geometry locator snapshot at 25,400.313 ms. The shared popup enters over 180 ms from `scale(.98)`; the row CSS declares `min-height:32px`.

Timing and source support a measurement during the entrance animation. The trace does not record the computed transform, so this report does not claim the settled row was measured undersized. The patch awaits each finite animation returned by the actual popup's `getAnimations()` through its `finished` promise before both the popup bounds and row geometry reads. It does not finish, cancel, disable or replace the animation. Viewport bounds, overflow, 4 px gap, 32 px row minimum, font, keyboard navigation, screenshot and Escape focus assertions are retained exactly. The 15-second overall deadline is unchanged.

### 3. Assert the supported Usage value in its visible state

`UsageFooter.tsx` renders the metric `<dl>` only when `!threadId || !onOpenUsage`. The actual App supplies both, so the expanded summary body contains `Open Usage` and does not contain the old `dd`. `SummaryDock.tsx` renders the input-token caption only when collapsed.

Proposal 01 replaced `dd=999` with a caption assertion at an expanded point. Static review caught that mistake before any application or execution. Proposal 01 is preserved unchanged. Proposal 02 clicks `Minimize live usage`, asserts the visible exact `999 input tokens` caption, and clicks `Inspect live usage` again before the existing hide/show/Open Usage flow. The later modal title, owner, `999` value, Escape, reload and both owner-specific draft assertions remain unchanged.

The added negative case restores `activeTab:'usage'` with `rightPanelOpen:true` in the existing explicit split fixture. It requires the persisted tab to normalize to `notes`, requires no Usage dialog, verifies both scoped composers are visible and enabled, fills distinct drafts, verifies their exact independent values, and checks zero `message.send`/`thread.create` commands. This new case is unexecuted. It raises the complete Usage configuration's expected membership from 15 to 16.

### 4. Separate mobile initialization from the interaction deadline

The mobile trace's `goto` completes at 6,466.089 ms. The five-second enabled assertion starts at 6,488.135 ms and fails at 11,491.807 ms. The trace retains 279 requests, all for initialization resources, and no API requests. `App.tsx` alone is requested at 6,636.555 ms and takes 2,327.041 ms. The error context contains only an empty main element. The test never reaches a navigation, Settings, backdrop or focus interaction.

The patch registers a wait for the first successful `GET /api/snapshot` before navigating, using `Promise.all` to avoid missing the response. It then runs the original enabled assertion, fill and complete mobile flow unchanged. The original 15-second overall deadline remains the upper bound for initialization and interaction together; the enabled assertion retains its five-second deadline. This is an explicit fixture initialization precondition. It does not establish the original five-second whole-startup performance threshold, and the first API response must still be observed within the test's remaining budget.

## Parent product proposal review

Reviewed exact `browser-product-proposal-01/product.patch` SHA256 `cee80a2273fcca1065184adae23bce9af4b970a351df8613de08f3d5b8f9b408`, its manifest, and all changed source contexts. No blocking defect found in this bounded static review.

The Usage effect now waits for `convSplitState.layout` when canonical split hosting is enabled. This is sufficient for its synchronous owner derivation: `mainPlacement`, `resolvedMainId`, `candidateThread` and `thread` are computed from that layout during the same render. It does not depend on a later selected-ID effect. `pinnedThreadId` includes embedded threads, so the existing pinned/navigation exclusions retain the embedded exclusion. Explicit ordinary-chat eligibility excludes the explicit split mode, custom dock, retained canvas and selected plug-in surface. Normalization to notes remains outside the ordinary-chat opening branch. The two previously failed ordinary-restoration cases remain the product red evidence; the new split case guards the opposite mode boundary.

The other edits change only the observed error presenters to `role="alert"`: App shell error, DesktopEntry local action error, and DraftTransfer transfer error. Success/status messages, DesktopEntry backend status, exception handling, owner custody, existing editor lifetime, and transfer asset checks are unchanged. The App presenter remains outside the selected plug-in's hidden personal work area. These role changes address two shell and three desktop assertion failures while preserving the tests' semantic alert checks.

The fourth desktop failure, unrecovered composer native close returning false, is outside this three-file product proposal and remains independently assigned. This report does not mark it repaired or reinterpret the failed receipt. No product patch in this report has a post-change test result.

## Remaining validation boundary

After controlled adoption and a new complete source cut, the parent schedules one selected three-case desktop role run and complete Usage 16, workspace 48 and layout 15 runs. Those commands will continue to retain explicit Chromium proxy scope where the declared configs require Edge. The unresolved native-close case is excluded only from this selected role diagnosis, not from its eventual complete affected suite or the declared Windows workflow. All earlier complete-suite failures remain retained.
