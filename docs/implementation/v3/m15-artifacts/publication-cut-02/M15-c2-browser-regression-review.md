# M15 C2 browser reconciliation

## Result

The corrected complete App, workbench, shared-overlay, shared-control and saved-draft configurations pass 21, 18, 15, 18 and 27 cases respectively. The final ChatView attempt is FAIL, five passed and one failed: the first canonical App case misses its original five-second input-readiness assertion. All three direct Escape/IME cases and the other two canonical cases pass. The final serial focused aggregate passes 334 cases with three genuine Windows-only skips; final typecheck/build/UI policy pass. Its preceding build-overlapping focused failure remains retained. The active ChatView failure retains its source/platform attribution and current-root/native comparison gates. Earlier passing cuts are not substituted for it.

The initial C2 artifact acknowledgment case passed, the complete agents configuration passed all 22 cases, and the combined ChatView suite passed all six cases before the primitive migration. Those earlier source-cut results have no skipped, unexpected or flaky cases. Every later and earlier failure remains unchanged in its original receipt, JSON result, snapshot and trace.

The source under test combines published M15 commit `fd17d9f1b3931eb2b974b86ccc5a3892da47ba33` with accepted upstream `138b1356495bb3a2c9b35020240513f8faa84964` and the focused corrections described here. Exact source digests, result digests, log digests, request timing observations, and artifact references are in `m15-artifacts/c2-browser-trace-provenance.json`.

These initial C2 runs and the App source comparisons below precede the later shared-primitive migration required by the UI policy gate. Their receipts and file hashes remain evidence for that earlier source cut. The final section records the migration and its focused scroll regression; post-migration aggregate/browser gates require their own receipts.

This establishes Chromium behavioral coverage. It does not establish Edge, Windows, installed-desktop coverage, or a five-second whole-application startup guarantee.

## Artifact acknowledgment: two distinct failures

The published quiet failure occurred before acknowledgment assertions. Its first bootstrap request began about 4,770 ms after navigation, and the terminal snapshot eventually contained the expected checked checkbox. That evidence identified cold startup work, rather than an observed failure of revision or acknowledgment ordering.

The first unchanged merged run exposed an additional fixture contract gap. The application requested `/api/split-workspace` and `/api/split-workspace/profiles`, both received 404, and the terminal snapshot remained at “New conversation.” Upstream canonical placement no longer selects a conversation solely from `Snapshot.activeThreadId`.

The existing opt-in `serveTaskSplitLayout` helper now accepts an optional initial thread ID and seeds that thread into the canonical main pane. The acknowledgment case supplies its task thread. Existing callers that omit the argument retain an empty layout, and generic `serveTaskFixture` behavior remains unchanged.

After that fixture correction, the stable `c2-browser-artifact-green-02` attempt returned the correct canonical layout and displayed the task message, but cold development-server loading still exhausted the initial five-second checkbox assertion. Bootstrap began at about 4,885 ms, the canonical layout arrived at about 5,183 ms, and the embedded conversation's snapshot request was still pending at teardown. This attempt is retained as a failure.

The final test explicitly waits for the real “Review records” table inside the canonical task-thread view to mount before starting its original behavioral assertions. No sleep, assertion deadline, or test timeout was increased. No user action or host mutation occurs before the first checked-state assertion. The successful trace records that assertion at about 5,545 ms from navigation, still with its original 5,000 ms timeout. The test then exercises both held save receipts, revision 2 and revision 3 ordering, the acknowledged selection, a genuinely later revision 4 update, and the no-extra-autosave observation.

The parent task also deferred optional workbench panels and the windowed activity view. The final artifact trace contains none of the `WorkbenchPanelContent`, `WorkbenchPanels`, `WorkbenchInputsPanel`, `WorkbenchOutput`, or `WorkbenchActivity` module requests. This confirms the optional import boundary. It does not prove that whole-application cold startup meets five seconds.

## Agents workspace: fixture isolation and receipt contracts

The unchanged merged reproduction passed both originally failing selected cases. Upstream had already corrected the child follow-up receipt to contain `commandId`, `eventSeq`, and `result`. That correction is attributed to upstream, not this repair.

The isolated fixture still eagerly imported the entire application even when the case requested only `AgentsWorkspace`. The App import now occurs only in the candidate branch. In the retained first-loading traces, non-API requests fell from 297 to 73, and neither App nor SourceWorkbench was requested by the isolated case. Bootstrap began at approximately 4,372 ms before the change and 1,132 ms afterward. These are diagnostic observations, not a controlled performance benchmark; non-API counts include documents, styles, fonts, and scripts.

The generic parent-command fixture still returned `{id, status, result}` after the merge. An added acceptance assertion demonstrated the issue: the real composer retained its retry button and reported an unexpected host response. The corrected fixture returns a type-checked `CommandReceipt` with `commandId`, `eventSeq`, and `result`. The original IME, command identity, owner, content, and later-draft assertions remain. The new assertion additionally requires the accepted retry to clear its retry UI.

The first complete run passed 21 cases and failed the actual-App candidate case while its deferred App graph was still downloading. Candidate setup now waits for the existing rendered fixture mount marker before returning. All API requests made during startup stay in the same request history, and the original five-second polls and no-snapshot/no-events assertions remain unchanged. The second complete run passes all 22 cases, including the two upstream grid-evidence cases.

## ChatView and portable test startup

The three Escape and IME cases now run in a direct fixture mounting the real `ChatView` and shared `TooltipLayer`. They verify cancellation before the tooltip's document listener, subsequent release of Escape ownership, and no cancellation or preference write for both an active composition flag and legacy key code 229. The canonical three-case `chat-view-modes.spec.ts` remains identical to upstream blob `2aab5d30fb70e73eab431239a26b24ec14122520`.

The existing chat-view configuration and registry include both spec files. Its trace policy now retains failures even with zero retries. The validation run retained traces for all six passing cases.

The saved-drafts web-server command now invokes `pnpm exec vite --config tests/e2e/saved-drafts.vite.config.ts --configLoader runner` directly. The Unix-only `exec timeout` wrapper was removed for Windows compatibility. Test settings, the external-server environment bypass, and the Playwright-owned server lifecycle are otherwise unchanged. The later parent-owned `c2-saved-drafts-02` receipt records all 27 cases passing, exit 0, with zero skipped, unexpected, or flaky cases; its bounded-log SHA-256 is `86dcb9d9a68d3507fb64df634e7a5032051eeadf6e7ad76b372309be396485eb`. The earlier `c2-saved-drafts-01` result remains 23 passed and four failed. These Linux results do not establish exact-head Windows or Edge coverage, which remains pending.

## Recorded attempts

Attempt names describe intent; the exit codes and outcomes below describe what actually happened.

| Receipt ID | Exit | Actual result |
| --- | ---: | --- |
| `c2-browser-agents-merged-red-01` | 0 | Two unchanged merged cases passed. |
| `c2-browser-artifact-merged-red-01` | 1 | Canonical split fixture endpoints were missing. |
| `c2-browser-parent-receipt-red-01` | 1 | Accepted retry remained visible with the invalid parent receipt. |
| `c2-browser-parent-receipt-green-01` | 0 | Loading and corrected parent retry passed, two cases. |
| `c2-browser-artifact-green-01` | 1 | Attempt overlapped fixture edits; retained without stable-source attribution. |
| `c2-browser-artifact-green-02` | 1 | Correct canonical layout, cold startup exceeded the initial assertion window. |
| `c2-browser-artifact-green-03` | 0 | Full acknowledgment behavior passed after explicit initial readiness. |
| `c2-browser-agents-full-green-01` | 1 | 21 passed; actual-App cold import exhausted the initial API poll. |
| `c2-browser-agents-full-green-02` | 0 | All 22 agents configuration cases passed. |
| `c2-browser-chat-view-green-01` | 0 | All six direct and canonical ChatView cases passed. |

All runs use the repository's Playwright settings and recorded commands. The agents adapter changes only the unavailable Edge channel and the relative test directory, while retaining `AGENTSUI_APP_CANDIDATE=1`. Explicit trace recording overrides affect evidence capture only. No skipped case is counted as success.

## Read-only App merge review before UI-policy migration

No actionable merge defect was found in the requested routing, provider, handoff, or composer boundaries at the pre-migration source cut. Receipt `c2-browser-app-merge-review-01` exits 0 and records ten source comparisons, both parent identities, and the reviewed file digests. This is a source review, not another browser result. Its exact-equality statements describe those recorded bytes, not the subsequent Modal/Select composition changes.

The reviewed App host/embedded dispatch, canonical main-pane resolution, detached-thread selection, split-view dispatch, conditional split root, and layout error branches match accepted upstream exactly. Both Artifact call sites retain `active={thread?.id===resolvedMainId}`. The fallback SummaryLayout properties also match upstream after removing only the inserted source provider tag. The `splitRoot ? renderSplitRoot() : <SummaryLayout ...>` branch is still exclusive, and embedded conversations set `pinnedThreadId`, which disables a second split root. The two existing Composer sites remain in the separate canvas and conversation paths; opening source context adds no composer. App.tsx itself was not changed by the later primitive migration.

At the reviewed cut, the source-aware `prepareSourceJournal` and `prepareWorkspace` block matches published M15 exactly. It composes the retained source draft, requires a READY handoff, preserves the pending-acknowledgment check, flushes the journal, and invokes registered editor handoffs. The SourceWorkbenchProvider body, SourceMessage, and WorkbenchComposer also matched published M15 exactly then. The later UI-policy correction replaces WorkbenchComposer's native delivery selector with shared Select while leaving provider and handoff custody unchanged.

The provider keeps the conversation as its first child and places WorkbenchDialog alongside it. `show()` changes panel state without changing the logical-owner scope or the conversation element key. At the reviewed cut, the eager dialog shell used a custom body portal; only panel content was imported lazily, with loading and failure inside that shell. The later policy migration replaces that shell with shared native Modal while retaining the child order, owner scope and guarded lazy import. The original source review is not a runtime proof of this newer native-modal composition; post-migration App checks cover that boundary separately.

The reviewed App SHA-256 is `35c85b82775d7268a1ff7d412b2bc328b38121b6defbafd45dca2068391d862b`; SourceWorkbench SHA-256 is `16595a6ab717aa4b0a25aa882b4b63c95e337487ec54a564ebc1aa753e7c608f`. The receipt's log digest is `da7fbf09bdd2f4e0746771db843762e9b13495a234de8da4b0c6c84bafdfd101`.


## Saved-draft merge assertion correction

The first complete merged saved-draft run (`c2-saved-drafts-01`) reported
23 passing and four failing cases. The source merge retained M15's accessible
error alerts, but the test resolution mistakenly retained upstream's ordinary
status locators for conflict, quota and capacity errors. Each retained failure
snapshot contains the expected error text with `role=alert`; draft protection
was not the failed boundary. The four published alert assertions and the
capacity test's descriptive name are restored. No product error role, expected
message, deadline, or draft-preservation assertion changes in this correction.
The fresh complete `c2-saved-drafts-02` rerun passed all 27 cases, exit 0, with
zero skipped, unexpected or flaky cases. Its bounded-log SHA-256 is
`86dcb9d9a68d3507fb64df634e7a5032051eeadf6e7ad76b372309be396485eb`.
The four-failure first attempt remains unchanged. This result precedes the
shared-primitive policy migration and does not establish Windows or Edge coverage.

## Shared-primitive UI-policy correction

`c2-final-ui-policy-01` failed with eight M15 violations: custom backdrop/toolbar geometry, direct source-toolbar and workbench portals, a custom dialog surface, and native delivery/diff selectors. Product source remained frozen through the complete repository attempt before these repairs began. `m15-artifacts/c2-pre-ui-policy-source-cut.json` preserves that earlier implementation identity; its full repository attempt remains 3,344 passed, 271 failed, 56 skipped and four unhandled errors, exit 1.

WorkbenchDialog now uses the existing shared Modal; delivery and diff-hunk choices use shared Select with the same values, disabled options and range mapping. SourceSelectionActions uses shared Popover. A minimal optional `getAnchorRect` callback supplies the validated selection's viewport geometry while a real HTMLElement still owns document identity, nearest-modal portal placement, resize observation, dismissal and focus return. The getter changes with the candidate, so changing a selection while the popup stays open updates placement. Existing Popover callers retain their default element geometry. No UI guard or legacy inventory exemption was added.

The selection reader still revalidates exact canonical text, visibility, clipped ranges and owner state at action time. Pointer-down preservation, document-level Shift+F10/Escape/IME handling, and the provider's child order and lazy-content failure containment remain. The toolbar is focusable for shared retention when every action is disabled; pointer selection supplies no initial-focus request. Tests operate the actual combobox/options and shared Close dialog button, retaining the underlying send, recovery, draft and focus assertions.

Independent inspection identified an interaction introduced by the popup's bounded scrolling surface: the old capture-phase source scroll listener also dismissed internal toolbar scrolling. The narrow 280x400 browser case first proved overflow, then reproduced dismissal when focusing its lower Open source action. The handler now ignores only targets inside the toolbar; source and ancestor scrolling still dismiss selection.

| Migration receipt | Actual result |
| --- | --- |
| `c2-ui-toolbar-scroll-red-01` | Exit 1 before discovery because Playwright disallowed a describe-local trace override; no behavior was tested. |
| `c2-ui-toolbar-scroll-red-02` | Exit 1 at the toolbar-preservation assertion after focus caused internal scrolling. |
| `c2-ui-toolbar-scroll-green-01` | Exit 0, one case passed with the identical assertions: internal scroll retains the exact Open action; ancestor scroll dismisses. |

The red-02 log SHA-256 is `cd08744b086967c80223ec8e3a3afdf39a46a02f459f064821eaecb69a259afc`; green-01 is `9f86e9f07819a1266624d2632506d1079ec85f754a6999a44c5acb3d1fa12f88`. The suite retains its existing benchmark trace-off setting; the behavioral red includes its failure context, without a trace claim.

The updated suites contain 21 actual-App cases and 18 workbench cases. New coverage includes the real source dialog at 1280x800 and 200% CSS zoom, plus a tall canonical root inside native Modal at normal/200% zoom, changed range placement, keyboard/IME ownership and exact pointer-action offsets. Before the subsequent modal sizing correction, `c2-final-focused-02` passed 334 cases with three genuine Windows-only skips, `c2-final-typecheck-02` and `c2-final-build-02` passed, and `c2-final-ui-policy-02` reported 542 sources, zero violations and unchanged inventory. The complete App run at that cut failed as recorded below. Later corrected-source results have their own receipts in the final section, including the failed concurrent focused attempt and complete serial correction.

The independent full-suite audit of the preserved pre-migration cut groups 188 file-access denials, 10 explicit dependency/executable failures and 73 cause-unclassified assertions, plus four additional unhandled errors. No accepted-base execution establishes a baseline attribution. Exact case and source references remain in `m15-artifacts/c2-full-repository-audit.json` and its companion review.

## Measured modal zoom correction and interrupted reload

The first complete post-migration App attempt, `c2-workbench-app-02`, exited 1 with 19 passed and two failed cases. Both failures, original traces and snapshots remain retained. The failures reached different boundaries and are not assigned one common cause.

The real source-dialog case initially passed the Sources-view bounds, Close reachability and navigation checks at 200% CSS zoom. Switching to the taller Evidence view then made Sources unreachable. The filtered `c2-ui-modal-zoom-red-01` retained the same actions and strengthened the existing case with post-Evidence bounds and a geometry attachment. It failed with the dialog at y=-384 and height 1,568 in an 800-pixel viewport; Close was at y=-334 and navigation at y=-143.8125. The computed shared modal limit was 784 CSS pixels, which inherited zoom doubled physically. The shorter Sources content had fit at y=76.53125 and height 646.9375.

`packages/ui-shell/controls.css` now sizes the fixed native modal relative to its containing block using percentages, including its native-titlebar constraint. `apps/web/src/source-workbench.css` uses the same basis for its width, height and mobile constraints. The Modal component, native dialog ownership, focus retention and Escape handling are unchanged by this correction. The identical filtered test passes in `c2-ui-modal-zoom-green-01`: Evidence is bounded at y=16, height 768 and bottom=784; Close and navigation are visible at y=66 and y=256.1875. Sources geometry is unchanged. The case then returns to Sources, closes and restores focus, retains the draft, reopens a source, attaches its exact canonical range, and confirms no send. No deadline, click or bounds assertion was relaxed.

| Sizing evidence | Result | Bounded-log SHA-256 |
| --- | --- | --- |
| `c2-ui-modal-zoom-red-01` | Exit 1, one failed geometry case before the CSS correction | `3f4f7c934e96af5d2dc2a79edfa7ae6e8968a7b3550c7b4126f2a0153679c67f` |
| `c2-ui-modal-zoom-green-01` | Exit 0, one passed case with identical test bytes | `e34f501313e8f3ba53918f93fe9de4cd2d06f31d9f03fedb60f758cecd3cb9b6` |
| `c2-ui-app-reload-recheck-01` | Exit 0, one unchanged deferred-load/reload case, before the CSS correction | `e6cdcc158765712afbea5bdc7aaaa732e30fc9f9fb68b9b0b6726f52f636ebe0` |

The red and green directories each contain `source-and-geometry.json`, which binds their exact CSS/test digests, result digest and measured rectangles. The test SHA-256 is identical in both: `f7d8151795a3ee1706f65d381aa1f6c5df9d5e3f1993229ada00ee0065e73912`. These measurements establish the observed native-modal sizing correction, not a general desktop DPI certification.

The other App-02 failure does not demonstrate lost draft data or a completed five-second reload assertion. Its trace records a long scheduling gap during the failure-alert check, then starts test teardown at 116,061.677 ms on the trace clock. The later mounted-composer identity, focus, retained draft and no-send assertions pass. Reload runs from 119,626.301 to 119,787.733 ms; its value assertion begins at 119,788.404 and is interrupted at 120,690.832 ms, about 902 ms later, by the overall 30-second test timeout. The terminal snapshot says “Opening workspace.” This is insufficient to assign a draft-custody defect or a whole-App readiness threshold. The isolated recheck passes the unchanged case in 9.1 seconds before any CSS correction, including reload retention. No timeout was increased and no readiness or retention assertion was waived. The original complete App attempt remains a failure; complete post-correction reruns remain separate evidence.

## Complete post-correction results

`c2-workbench-app-03` passes all 21 cases on the corrected source, exit 0, with zero skipped, unexpected or flaky cases. This includes the unchanged deferred-load/reload case and the strict post-Evidence zoom checks, source attachment, focus and draft retention. Its bounded-log SHA-256 is `4165b025c4f23e6ef3b31d37ce55bf53ca7cf282dba9231fcccde739fbff4a32`; result JSON SHA-256 is `962a2df2e4fa3d2a94272e9fc4a61f36da9a116af7c2b3f6aa99bf0846773386`. The full App-02 failure and filtered reproductions remain unchanged.

`c2-workbench-browser-02` passes all 18 cases on the corrected source, exit 0, with zero skipped, unexpected or flaky cases. It includes real tall-range/native-modal ownership at normal and 200% CSS zoom, changed-selection placement, keyboard/IME behavior, internal toolbar scrolling, exact action offsets, and the complete existing renderer/recovery cases. Its bounded-log SHA-256 is `52af05cd9d72cd2a36a8bc28d513efe61309678f220c97396fe16bac006ce989`.

The controlled renderer report in that run retains 10,000 message metadata entries, 500 tasks and 100,000 output lines. The windowed component mounts 29 rows with p95 9.9 ms; the unwindowed reference mounts 100,000 rows with p95 901.6 ms. Each condition uses 30 trusted samples after three warmups. The metric is click capture to MutationObserver delivery, excluding paint, in the Vite/React development fixture; it establishes no whole-App, native-history or universal-device result. Report SHA-256 is `1513dac24946b83307ab3c76bfe928a47f4652407052f4ed28373e0779415c6d`; all 11 recorded source digests and both raw-sample p95 values were checked. The pre-UI 7.1/1,016.2 ms report remains historical.

The complete shared suites pass after the final CSS correction through their explicit Chromium adapters. `c2-ui-shell-overlays-02` passes 15 cases and `c2-ui-shell-controls-02` passes 18, both with zero skipped, unexpected or flaky cases. Their bounded-log SHA-256 values are `ea9adee044433f357bd1176967bf7d0bc98a4b9a1fb9ed6ec665947157b9841d` and `688007bf6fc72ceb5b00b2ddddf1d5d97dd0b6de9b521e6ba03577e2aa40068b`.

The earlier complete controls attempt remains FAIL, 17 passed and one timed out. Its final modal-predicate error occurred during context closure after the preceding click exceeded the whole-test deadline; no false native-modal predicate was observed. The unchanged filtered case passed before the sizing correction, and the final full controls suite subsequently passed. `m15-artifacts/c2-ui-timeout-attribution-01.md` and its JSON retain exact controls/App trace timelines and source/evidence hashes. The scheduling-gap cause is unproven, and no failure is assigned to an accepted baseline without running it.

The complete saved-draft configuration also passes after the shared modal sizing correction. `c2-saved-drafts-03` records all 27 cases passing, exit 0, with zero skipped, unexpected or flaky cases. Its bounded-log SHA-256 is `3a64dc194fa102634af3d13c2bdfc7eba79259ac503d102862a44383280c6b6d`; its result JSON SHA-256 is `43e9abd478a195fb2e312740b8b0b8f3f3be284aff7f9a421cabc96fb747e03c`. Earlier `c2-saved-drafts-02` remains the distinct pre-UI pass, and `-01` remains the recorded four-failure attempt.

The final combined ChatView run, `c2-browser-chat-view-green-02`, exits 1 with five passed, one failed, zero skipped and zero flaky cases. The failing case is “the conversation lives in the split plane with its messages, composer and attachments.” Its unchanged `open()` helper waits five seconds for the canonical pane's Message input to become enabled and reports the element absent. This precedes the case's conversation/attachment assertions. The three direct Escape/IME regressions and the other two canonical App cases pass. The attempt name does not imply success. Its bounded-log SHA-256 is `d429d7ba9bee9447c973de06a0b54b1fd30c9e0b9fb10d1a85d2d384bb1c5132`; result JSON SHA-256 is `a6418e02b56449154d00379d56bce69e3c1e60e4273730c9a1e818b1f4df0e86`.

No deadline or canonical assertion was changed, and no repeated run replaces that failure. Source/platform attribution and an exact-head Windows/current-root comparison remain open. The pre-UI `c2-browser-chat-view-green-01` six-case pass retains only its earlier-cut scope. This active Linux gate is separate from the interrupted App-02 reload and the measured-and-corrected native-modal zoom defect.

`m15-artifacts/c2-ui-primitives-independent-review-02.md` records the separate static sizing review and confirms identical test bytes across the measured red/green. It does not substitute for a complete runtime suite or native platform evidence.

Final `c2-final-typecheck-03`, `c2-final-build-03` and `c2-final-ui-policy-03` pass. Policy scans 542 sources with zero violations and unchanged inventory. The preceding combined focused attempt, `c2-final-focused-03`, remains FAIL: 333 passed, one failed and three genuine Windows-only skips across 22 passing files, one failing file and one skipped file. Its sole failure was the existing “rejects a redirected replacement before the initial trusted bootstrap can connect” case in `plugin-frame-custody.test.ts`, at the original 60-second deadline. Its log SHA-256 is `1779171ed01d46a6dc768244e4ef83efdfba9133830858bbb1e52bb757ba76ab`; result SHA-256 is `272c6972aeb8b8734b5930b5e12e0e72ab72ed570c1dbe98c4721a0dd238810d`.

Independent `m15-artifacts/c2-plugin-frame-concurrency-audit.md` confirms that focused03 overlapped build03, whose `emptyOutDir` cleanup can delete the test's parent HTML from their shared `dist/web`. This is a concrete execution conflict; the failing navigation's exact response was not captured, so no unique response-body cause or accepted-baseline classification is claimed. Root then ran the identical complete 24-file command serially as `c2-final-focused-04`, with no source, test or deadline change. It passes 334 cases with three genuine Windows-only skips, across 23 passing files and one skipped file. All four plugin-frame cases pass, with the final redirected-replacement case taking 294.501 ms. The final focused log SHA-256 is `ab6cadd309609de0e82a2a1974a4fe4c85da8a7c87d2012267031d4c1a64381f`; result SHA-256 is `eef264f1e4e7e91510483509e828b9be60e314d9dd2997a6b1cbc21d04e785eb`. Focused03 stays failed, and focused02 stays evidence for its earlier CSS cut. The current ChatView failure, packaging/controller and native/current-root gates remain separate.
