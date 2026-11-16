# M15 browser regression review

The latest corrected-source ChatView gate remains FAIL, five passed and one failed at the original canonical App input-readiness deadline. Complete corrected App, workbench, shared-overlay/control and saved-draft configurations pass within their recorded scopes. Earlier six-case ChatView and full-root results below retain their historical source attribution. No current complete root parity or native/Edge acceptance is claimed.

## Recorded C2 browser reconciliation before UI-policy migration

The initial C2 browser evidence was collected on the uncommitted working tree combining published M15 `fd17d9f1b3931eb2b974b86ccc5a3892da47ba33` with accepted upstream `138b1356495bb3a2c9b35020240513f8faa84964` and the documented fixture/loading repairs. It precedes the later UI-policy primitive migration and is not a rerun of the published commit. The original review and aggregate evidence remain unchanged under `m15-artifacts/publication-cut-01/`.

| Initial C2 execution | Actual result | Receipt ID |
| --- | --- | --- |
| Actual App workbench integration | 20 passed, exit 0 | `c2-workbench-app-01` |
| Workbench renderer, selection, recovery and layouts | 16 passed, exit 0 | `c2-workbench-browser-01` |
| Complete agents configuration | 22 passed, exit 0 | `c2-browser-agents-full-green-02` |
| Canonical ChatView and direct Escape/IME cases | 6 passed, exit 0 | `c2-browser-chat-view-green-01` |
| Artifact acknowledgment | 1 passed, exit 0 | `c2-browser-artifact-green-03` |
| Complete saved-drafts configuration | 27 passed, exit 0 | `c2-saved-drafts-02` |

All six final browser results contain zero skipped, unexpected, or flaky cases. Each has an actual command receipt and log under `m15-logs/`, plus its Playwright JSON under `m15-artifacts/<receipt-id>/results.json`. These configurations cover different scopes and do not establish complete current root-suite or repository parity. The agents configuration used the explicit Chromium adapter; Edge and Windows remain unobserved here. Historical usage/context and scoped-conversation passes below have not been promoted to current C2 executions.

### Repaired causes and preserved assertions

The original quiet artifact failure occurred before acknowledgment assertions during cold App startup. The first unchanged merged attempt additionally exposed absent canonical split-workspace fixture routes and stayed at New conversation. The existing opt-in layout helper now seeds the task thread; the test waits for the actual Review records table before its original checked-state and save-order assertions. No assertion deadline or test timeout increased, and no user action or host mutation precedes the initial check. A stable intermediate failure with correct layout is retained. The final pass establishes acknowledgment behavior after readiness, not a five-second whole-App startup guarantee.

Upstream already corrected the agents child receipt contract. Both originally failing selected cases passed on unchanged merged sources, and no baseline execution for those old cases is retroactively claimed. C2 defers the full App import until the fixture's actual-App branch, corrects the still-invalid generic parent receipt to `CommandReceipt`, and requires an accepted retry to clear its retry UI. The actual-App integration setup waits for its existing fixture mount marker while retaining all startup API history and the original API assertions. The recorded parent-receipt red, first complete agents failure, and final 22-case pass remain distinct attempts.

The canonical three-case ChatView spec is unchanged from upstream. Three direct tests preserve the published M15 Escape/IME semantics using the real ChatView and TooltipLayer. Optional source-panel and activity modules no longer appear in the artifact startup trace. The actual-App suite includes the lazy-content failure case that retains the composer and restores focus. Source-aware handoff and the stable conversation/provider boundaries also received the recorded read-only App merge review.

Saved drafts now uses a portable direct Vite server command. `c2-saved-drafts-01` retains 23 passes and four failures; the later `c2-saved-drafts-02` records all 27 passing cases. Its bounded-log SHA-256 is `86dcb9d9a68d3507fb64df634e7a5032051eeadf6e7ad76b372309be396485eb`. A Linux pass of this command does not establish the Windows run.

Detailed timing, source hashes, retained red/green results, and causal limits are in `M15-c2-browser-regression-review.md` and `m15-artifacts/c2-browser-trace-provenance.json`.

## Subsequent shared-primitive migration

The failed policy gate required shared Modal/Select/Popover instead of eight custom overlay/select occurrences. Source/range revalidation, real-element ownership, keyboard/IME behavior, provider lifetime and lazy-content retention remain. A candidate-bound range getter affects Popover placement only; no policy guard or legacy inventory was changed. The newly bounded toolbar's internal-scroll dismissal was reproduced in `c2-ui-toolbar-scroll-red-02` and corrected by `c2-ui-toolbar-scroll-green-01`, one passing case. `red-01` was a separate setup-only failure, not a reproduction.

Before the later modal sizing correction, `c2-final-focused-02` passed 334 cases with three genuine Windows skips, `c2-final-typecheck-02` and `c2-final-build-02` passed, and `c2-final-ui-policy-02` reported 542 sources and zero violations with unchanged inventory. The first complete 21-case App run at that cut, `c2-workbench-app-02`, failed with 19 passed and two failed. Both original failures remain retained.

The zoom failure is attributable to measured native-modal geometry: taller Evidence content expanded to 1,568 physical pixels high in an 800-pixel viewport, putting Close and navigation above the visible area. Shared and workbench limits now use fixed containing-block percentages, including native-titlebar/mobile constraints. The same strict filtered test is red in `c2-ui-modal-zoom-red-01` and green in `c2-ui-modal-zoom-green-01`; corrected Evidence bounds are y=16 through y=784. The existing native-modal ownership and focus code remain unchanged by sizing. Each attempt retains `source-and-geometry.json` with exact source/test hashes.

The reload failure reached its final value check after the overall deadline had already started teardown. It received only about 902 ms, not the configured five-second assertion interval. Earlier failure-alert, connected-composer, focus, retained-draft and no-send checks passed; the terminal snapshot was “Opening workspace.” The unchanged isolated `c2-ui-app-reload-recheck-01` passed before the sizing edit. No deadline changed, and no draft-loss or cold-load root cause is inferred from the interrupted trace.

The complete corrected `c2-workbench-app-03` passes all 21 cases, with zero skipped, unexpected or flaky cases. It covers the unchanged deferred-load/reload case and strict post-Evidence bounds/clicks, source range, focus and retained draft. Its log SHA-256 is `4165b025c4f23e6ef3b31d37ce55bf53ca7cf282dba9231fcccde739fbff4a32`. The complete corrected `c2-workbench-browser-02` passes all 18 cases with the same zero skip/unexpected/flaky counts, including tall-range/native-modal keyboard/IME ownership and the existing renderer/recovery scenarios. Its log SHA-256 is `52af05cd9d72cd2a36a8bc28d513efe61309678f220c97396fe16bac006ce989`.

The final controlled renderer comparison records 29 mounted rows and p95 9.9 ms versus 100,000 mounted rows and 901.6 ms for the unwindowed reference, with 30 trusted samples per condition after three warmups. Report SHA-256 `1513dac24946b83307ab3c76bfe928a47f4652407052f4ed28373e0779415c6d` binds the raw samples and 11 matching source hashes. This Vite/React fixture excludes paint and does not establish whole-App or native performance; the pre-UI 7.1/1,016.2 ms measurement remains historical.

Final shared-overlay and shared-control configurations pass 15 and 18 cases respectively in `c2-ui-shell-overlays-02` and `c2-ui-shell-controls-02`, through their explicit Chromium adapters, with no skipped, unexpected or flaky cases. The earlier controls 17-pass/one-timeout attempt remains failed; its interrupted predicate and unchanged filtered pass are analyzed in `m15-artifacts/c2-ui-timeout-attribution-01.md`. Final saved-draft receipt `c2-saved-drafts-03` passes all 27 cases on the corrected source. Final ChatView `c2-browser-chat-view-green-02` remains FAIL, five passed and one failed at the first canonical App case's unchanged five-second input-readiness assertion. All three direct Escape/IME cases pass. No deadline or canonical assertion was relaxed, no repeated run replaces the failure, and the pre-UI six-case pass is not borrowed. Source/platform attribution and exact-head Windows/current-root comparison remain open. Final typecheck/build/policy `-03` gates pass with zero policy violations. Focused03 remains FAIL, 333 passed/one redirected-replacement timeout/three genuine Windows skips. Independent `m15-artifacts/c2-plugin-frame-concurrency-audit.md` confirms it overlapped an incompatible build clearing the test's shared `dist/web` output; the exact failed response was not captured. The identical complete 24-file command then passed serially as `c2-final-focused-04`, 334 passed/three Windows skips, with no source/test/deadline change. This current pass does not relabel focused03 or establish an accepted-base/native execution. The narrow independent sizing review is retained in `m15-artifacts/c2-ui-primitives-independent-review-02.md`.

The complete repository attempt before this migration remains failed: 3,344 passed, 271 failed, 56 skipped and four unhandled errors. Its audit groups 188 file-access denials, 10 explicit dependency/executable failures and 73 cause-unclassified assertions, without baseline attribution. `m15-artifacts/c2-pre-ui-policy-source-cut.json` and `c2-full-repository-audit.json` preserve its source and observed outcomes.

## Historical publication-cut scope and execution

The runs in the remaining sections cover usage/context, the agents workspace, and scoped conversation from the published cut because M15 changed App, ContextInspector, and the shared composer. Their source base was `399cde39ff4ee82272c7a7700944325c44b36070`. They remain historical results with their original outcomes.

Each registered suite was first run through `node --import tsx scripts/test-browser.ts --suite NAME`, preserving the suite's declared configuration and environment. All three configurations declare `channel: 'msedge'`. Every declared case failed during browser launch because `/opt/microsoft/msedge/msedge` is unavailable. Those are actual exit-1 attempts; no behavioral assertion pass is claimed for them.

The explicit equivalent configurations are retained under `m15-artifacts/browser-adapters/`. Each imports its original configuration and changes only the channel to the installed default Chromium and the relative `testDir` to the original `tests/e2e` directory. Distinct output and JSON-result paths are supplied by the recorded commands. Original worker counts, assertions, timeouts, viewports, web servers, and suite environments remain intact. The agents workspace run retains the registered `AGENTSUI_APP_CANDIDATE=1` value.

At that publication-cut execution, no product code, original test configuration, or test assertion was edited for these three suites. The historical machine-readable summary verifies all six original configuration/spec digests at that cut. Those digests do not describe the later C2 fixture repairs.

## Historical observed results

| Suite | Declared Edge attempt | Explicit Chromium equivalent | Remaining result |
| --- | --- | --- | --- |
| Usage/context | 21 launch failures, exit 1 | 21 passed, exit 0 | Chromium coverage passed; Edge unavailable. |
| Agents workspace | 15 launch failures, exit 1 | 13 passed, 2 failed, exit 1 | Loading deadline and command-receipt fixture mismatch described below. |
| Scoped conversation | 15 launch failures, exit 1 | 15 passed, exit 0 | Chromium coverage passed; Edge unavailable. |

The usage/context run covers ownership across compaction requests, keyboard and IME focus, honest unknown metrics, nested dialogs, narrow layouts, and reduced motion. The scoped-conversation run covers preserved message/scroll anchors, supplied-composer focus, hidden panes, invalidation, exact epochs, bounded Unicode continuation, 200% zoom, and real API error states.

Chromium results do not establish Edge, Windows, or installed-desktop coverage.

## Historical agents workspace failures

The first 1440-pixel loading case did not observe the `Loading agents` status within its unchanged five-second assertion deadline. Its failure trace and snapshot are retained. This is an observed readiness failure; no baseline attribution is made from that single run.

The child follow-up case sent the expected `agent.followUp` command with the parent thread, job, parent run, child run, and content. The intercepted response was `{id, status, result}`, but the existing command client requires `{commandId, result, eventSeq}` or its supported `seq` alias. It therefore rejected the response before reading the current ticket. The UI retained the input and exposed a retry/error state.

The command parser, child-input API, follow-up controller, and test fixture are all byte-identical to their accepted-base blobs. The summary records those four exact blob pairs. This establishes a fixture/schema mismatch in unchanged files; it does not substitute for executing the baseline suite. The two failures remain in the recorded result.

## Historical evidence

`m15-artifacts/changed-path-browser-regressions-summary.json` contains original configuration/spec digests, adapter digests, environment values, exact result statistics, receipt/log references, retained screenshots, both agents failure traces, and the failure diagnosis. Each original Playwright JSON result is preserved unchanged.

| Receipt ID | Exit | Bounded log SHA-256 |
| --- | --- | --- |
| `usage-context-declared-01` | 1 | `9b61742966201144aeba91663992e6175352975378202dda3c87d8335cf6e87e` |
| `agents-workspace-declared-01` | 1 | `e8bf32b8e92150e354bac40a4d1e39908d4c80e5438ba339e2f734f0edc81a27` |
| `scoped-conversation-declared-01` | 1 | `d07722aa24d21fb21e4511597f2b603d8cc0376309a36857d5478500d7c36701` |
| `usage-context-chromium-01` | 0 | `8170c21c8ca1419e9920eb3ec6ae6f0938d053f2d151d7036d5a9ac42162b330` |
| `agents-workspace-chromium-01` | 1 | `26c197a5458ca52c8cc00b4685c560a680d1c6b93eeb9ebb25d41cf9563304d5` |
| `scoped-conversation-chromium-01` | 0 | `020ee22a2d89b0803f7d765f9ac3577b4abcca6984d63b65fb29d1e617898695` |
