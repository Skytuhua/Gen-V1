# M15 source-aware workbench handoff

## Disposition

**C2 reconciliation candidate for the existing draft PR. Current ChatView gate remains FAIL. Production activation: disabled.** Accepted upstream `138b1356495bb3a2c9b35020240513f8faa84964` has been reconciled with published M15 `fd17d9f1b3931eb2b974b86ccc5a3892da47ba33` in the working tree. Final ChatView records five passed and one failed at canonical input readiness. The final serial focused aggregate passes 334 cases with three genuine Windows-only skips; its earlier build-overlapping attempt remains failed. Final typecheck, build and UI policy pass, with zero policy violations. Corrected complete App/workbench/shared-overlay/shared-control/saved-draft configurations pass 21/18/15/18/27 cases. The earlier complete repository attempt remains failed at its preserved pre-UI cut: 3,344 passed, 271 failed, 56 skipped and four unhandled errors. ChatView attribution, complete current root-browser parity and exact-head Windows/Edge remain open. Public-source packaging passes 11 checks; C2 evidence integrity passes while the acceptance bundle remains FAIL. M15 is not declared complete. Neither implementation evidence nor code review grants merge, release, or activation approval. `ui.sourceWorkbenchV1` defaults to `false`; `reviewerApproval` remains the schema-required literal `false`.

The original publication continuation rebuilt the work because an earlier session's final working tree, commit and evidence bytes were unavailable. That earlier transcript's 161-test, 2,916/244/45 full-run, 127-command and renderer numbers were never reused as evidence. The subsequently published cut has its own immutable archive at `m15-artifacts/publication-cut-01/`, including its integrity PASS / bundle FAIL result and its failed full-suite counts. C2 results below describe the later uncommitted reconciliation execution cut, not a rerun of `fd17d9f1` and not a replacement for any historical receipt.

## Repository and exact source basis

| Item | Recorded value |
| --- | --- |
| Canonical repository | `skytuhua-org/Gen-V1`, repository ID `1442565952`; the original `Skytuhua/Gen-V1` address redirects here |
| Original checkout | `/workspace/scratch/1b47eb428672/gen-v1` |
| Isolated worktree | `/workspace/scratch/1b47eb428672/m15-v3` |
| Candidate branch | `agent/m15-v3` |
| Published M15 commit | `fd17d9f1b3931eb2b974b86ccc5a3892da47ba33`, draft PR #390 |
| Historical publication execution base | `399cde39ff4ee82272c7a7700944325c44b36070` |
| Accepted C2 reconciliation base | `138b1356495bb3a2c9b35020240513f8faa84964` |
| C2 execution source | Uncommitted reconciliation working tree; per-attempt file hashes identify tested bytes; published history is retained |
| Audit ancestor | `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54` |
| Accepted M01 merge | `5f0958f4cb5b40bc10c1eea0e1cd517b57aaa1b9` |
| Accepted M02 merge | `f331cf16b268282da888a41da42fc776ea7befd5` |
| Accepted prerequisite reconciliation ancestor | `e871257aa82beb06ab4b8f3989cbe436cb9a6a8c` |
| Runtime | Linux x64, Node `v24.22.1`, declared pnpm `10.30.3`, Playwright package `1.56.1`, Chromium browser `141.0.7390.37` |

The current C2 assembly must bind `M15-source-lock.json` to the accepted reconciliation-base blobs and identify the exact changed implementation bytes in `M15-source-cut.json` and `M15-verification.json`. The publication-cut versions are retained in the archive and must not be read as C2 source identities. Browser and M04 review artifacts already record their tested working-tree file hashes. The final assembled commit identifier is reported outside files in that commit; no new committed source identity is claimed by these precommit executions.

`M15-dependency-review.md` records source compatibility. `c2-core-prerequisites` passed 72 tests across six files against the merged dependency boundary; the earlier 71-case result belongs to the publication cut. The installed dependencies came from the frozen lockfile. No dependencies or lockfile versions were added. The exact locked `node-pty` package was rebuilt for this Linux Node runtime. The credential-build launcher now uses `node --import tsx` to avoid the observed tsx CLI IPC denial. Its Linux success does not establish compilation or native credential coverage on Windows.

Historical publication preflight observed `main` at `673ca733d306ade463635def2d09299bc37043ec`, 62 commits beyond the old execution base, after an earlier 57-commit observation at `f5e0af4e1e81c0e9fdd71e2fc56575b33bca9fca`. Those observations and their six overlapping paths remain in `m15-artifacts/publication-main-drift.json`. C2 instead reconciles the accepted `138b135` source. The recorded App review confirms canonical split-pane selection, active Artifact ownership, conditional SummaryLayout, and source-aware handoff were retained. A resolved merge and focused passes do not by themselves satisfy the current aggregate or platform gates.

During C2 verification, main advanced to `49cd633273a3f61c14a4191a9877e99ab23ec88f`, including retirement of Code Review, Research, Custom and Visuals, error boundaries and native-thread split selection. A private source-only probe found conflicts in App integration and the public-source manifest. This C2 cut retains accepted base `138b135`; a separate reconciliation is required before claiming compatibility with the later main.

The original checkout was verified clean again by `c2-final-custody-01`, preserving the earlier `final-checkout-custody-01` result at the old execution base; the C2 archive manifest also records that original-checkout custody. Only this task's duplicate receipt copies and its temporary dependency symlink were removed after byte and target checks. No user work was reset, cleaned, stashed or overwritten. The subsequent direct request to review, fix and open a PR authorized draft publication despite the original implementation prompt's no-push clause. This handoff supplies no merge, deployment, or activation approval.

## Implemented behavior and authority

### Exact sources and selection

`SelectedSourceV1` is a strict MESSAGE, FILE_RANGE, DIFF_HUNK or ARTIFACT_REGION union. The host validates complete logical ownership, account binding, revision, digest, grants and exact content before capture and again at read/send/recovery boundaries. Message ranges use half-open UTF-16 offsets plus selected-text digests; split surrogate pairs reject. File lines are one-based and inclusive. Artifact pointers address declared data bindings; arrays accept only canonical, safe, in-bounds integer indices.

The selection toolbar accepts registered React roots with exact canonical text. It rejects forged attributes, hidden or clipped text, clipped interior descendants, input/link content, foreign panes and arbitrary iframe content. Escape, keyboard activation and IME behavior retain their existing owners. Formatted Markdown cannot safely infer canonical offsets from a unique substring. Those messages expose an explicit **Select canonical source** action by exact message ID, including messages outside the bounded catalogue. Trusted formatted inline source maps remain unavailable.

Source chips show a bounded preview, name, revision, range and capture time, with explicit removal, refresh and retained-version choices. Open source returns the exact retained bytes. The current task destination stays visible. Source context never grants tool or file access. Limits include eight draft source references, 64 persisted presentation entries, a 1 MiB source, a 64 KiB selected capture and a 1,024-byte preview.

FILE_RANGE uses the existing guarded native reader and remains unsupported on this Linux target. DIFF_HUNK capture remains disabled until its owning service supplies an atomic complete-comparison witness. Declaring the union does not enable these capabilities.

### Durable sends, accepted inputs and drafts

Source-aware NOW and AFTER_CURRENT sends use the existing `message.send` outbox and M04 request custody. Command ID, prompt, owner, model, source identities, delivery mode and draft generation are frozen for an attempt. The host coalesces matching in-flight admission and checks durable receipts before current eligibility. An old acknowledgment cannot clear newer edits. A proven precommit denial unlocks the draft; an uncertain outcome retains the exact retry.

C2 repairs first-send account custody with a host-owned admission witness. A genuinely empty account-unbound task can retain its original captured reference, selected bytes, digests and grants when ordinary first-send admission binds its account. Platform-neutral ARTIFACT_REGION cases exercise M04 enabled and disabled, discovery races, rollback and retry, changed-account rejection, legacy captures, and unchanged retained bytes. The separate first-file native guard and original-Hermes cases still require Windows execution.

C2 also repairs M04 in-memory custody after a proven transaction rollback. `sendMessage` first proves the absence of the matching receipt and outbox row, then undoes only the exact admission advances and newly acquired claim from that failed transaction. Original owner/account/epoch/grant basis is preserved; an accepted, replaced, finalized, or newer claim cannot be reopened. The final focused aggregate includes these regressions. `m15-artifacts/c2-m04-admission-review-01.json` retains the narrower red/green attempts and independent review.

Accepted queued inputs can be inspected, kept with their exact retained captures, or cancelled only when the host proves they are persisted and undispatched. Keeping requires an explicit ordinary Resume. Processing or runtime ambiguity blocks cancellation. Recovery rechecks ownership and the saved outbox snapshot around asynchronous preparation. Cancellation remains available after the workbench flag is disabled and preserves the canonical user message.

The browser journals a recovery command's exact ID and action before transport. It clears only a matching receipt or a definitive rejection. A lost cancellation acknowledgment remains retryable even after its input disappears from the queue. Local retry custody is not task authority. Full owner/account/epoch generation fences reject delayed A-to-B-to-A responses.

Saved drafts and transfer retain bounded source metadata. Source-bearing exports use version 2; ordinary text exports remain compatible with version 1. Restore is explicitly text-only and preserves the active source context. Multi-key journal compare-and-swap preserves conflict copies instead of partially importing or overwriting newer source generations. Existing handoff guards await journal and presentation writes. An uncertain flush preserves recovery data and reports the limit. Agent and scoped composers that have not integrated sources reject hidden source companions rather than silently losing them.

### Workbench panels and output

Existing ContextInspector, UsageDialog, CodeReviewHost, Find, Inbox, checkpoints and chat movement remain owned by their existing components. The workbench presents authorized M04 context/tools, M06 evidence and current run/queue/request observations. Missing M05, M10 and M14 integrations are explicitly unsupported. Unknown cost, progress, outcomes and freshness remain unknown.

Evidence separates Reported, Observed and Verified. Only authorized current linked checks can verify a claim. The reader fetches one extra observation to detect incomplete bounded history; when older outcomes may be absent, requirements become `UNVERIFIED_PARTIAL` and checks cannot receive a verified grade. Historical log and screenshot references are metadata. Opening them remains unsupported until the owning authenticated retained-artifact reader exists. Captured-source links do open exact retained bytes.

Long output uses stable zero-based row IDs and a logical scroll anchor. The complete host reader verifies a framed digest of message identities and content, preserving trailing newlines and empty rows. Search and Copy full result use the authorized complete read, never the mounted DOM. Stale, denied, foreign or partial reads reject. Canonical messages are retained. The host limit is 4 MiB, 100,000 rows and 500 messages; the renderer mounts at most 300 output rows. Presentation writes serialize per device and do not become synchronized task facts.

## Current post-correction results

| Receipt | Observed result | Scope |
| --- | --- | --- |
| `c2-workbench-app-03` | 21 passed, exit 0 | Complete actual-App integration, including unchanged reload retention and strict post-Evidence zoom checks |
| `c2-workbench-browser-02` | 18 passed, exit 0 | Complete workbench selection, renderer, recovery, layout and scoped benchmark suite |
| `c2-ui-shell-overlays-02` | 15 passed, exit 0 | Complete shared-overlay configuration through the explicit Chromium adapter |
| `c2-ui-shell-controls-02` | 18 passed, exit 0 | Complete shared-control configuration through the explicit Chromium adapter |
| `c2-saved-drafts-03` | 27 passed, exit 0 | Complete saved-draft configuration after the shared modal sizing correction |
| `c2-browser-chat-view-green-02` | 5 passed, 1 failed, exit 1 | Canonical first App case misses unchanged five-second input readiness; all three direct Escape/IME cases pass |
| `c2-final-focused-04` | 334 passed, 3 genuine Windows-only skips, exit 0 | Identical complete 24-file command run serially after build; 23 passing files and one skipped file; all four plugin-frame cases pass |
| `c2-final-typecheck-03` | PASS, exit 0 | Final product/test source |
| `c2-final-build-03` | PASS, exit 0 | Final production build |
| `c2-final-ui-policy-03` | PASS, exit 0 | 542 sources, zero violations, unchanged 39 legacy entries and zero retired entries |

The five passing configurations contain zero skipped, unexpected or flaky cases. Final ChatView has one unexpected failure, zero skips and zero flaky cases. Its log SHA-256 is `d429d7ba9bee9447c973de06a0b54b1fd30c9e0b9fb10d1a85d2d384bb1c5132`. Its original deadline and canonical assertions remain unchanged; source/platform attribution and exact-head Windows/current-root comparison remain open. The pre-UI six-case pass does not supersede this current failure. App/workbench log digests are `4165b025c4f23e6ef3b31d37ce55bf53ca7cf282dba9231fcccde739fbff4a32` and `52af05cd9d72cd2a36a8bc28d513efe61309678f220c97396fe16bac006ce989`; other digests and full attribution are recorded in `M15-c2-browser-regression-review.md`.

The final serial focused log SHA-256 is `ab6cadd309609de0e82a2a1974a4fe4c85da8a7c87d2012267031d4c1a64381f`; its result JSON SHA-256 is `eef264f1e4e7e91510483509e828b9be60e314d9dd2997a6b1cbc21d04e785eb`. The three Windows bodies remain skips. Final typecheck/build/policy log digests are `e9a201c2479a7028e4074b54c117b9e7909d92bcf7db8fba5d879c57845b4c04`, `bae98e59e8046253bd2e975676581aea12359e208cc6a2af875c1f84b8b6c9c6` and `c31f38fa4a30c65c4d8426599cd53cbb8b7c63e497f9a3136d7ce19491e0f266`.

Earlier `c2-final-focused-03` remains FAIL, 333 passed/one redirected-replacement timeout/three Windows skips. It overlapped build03, which clears the same `dist/web` directory holding that test's parent HTML. The shared-output conflict is confirmed; the failed navigation's exact response was not captured. `m15-artifacts/c2-plugin-frame-concurrency-audit.md` and its JSON record the source/timing evidence and the identical complete serial focused04 pass without source, test or deadline changes. This operational correction is separate from baseline classification. Earlier focused02's 334-pass result also retains its pre-final-CSS scope.

## UI-policy migration gates before the modal sizing correction

| Receipt | Observed result | Scope |
| --- | --- | --- |
| `c2-final-focused-02` | 334 passed, 3 genuine Windows-only skips, exit 0 | 23 passing files and one skipped file; the skipped bodies are not native proof |
| `c2-final-typecheck-02` | PASS, exit 0 | Product/test source before the subsequent modal sizing correction |
| `c2-final-build-02` | PASS, exit 0 | Production build at the same cut |
| `c2-final-ui-policy-02` | PASS, exit 0 | 542 sources, zero violations, unchanged 39 legacy inventory entries and zero retired entries |
| `c2-ui-toolbar-scroll-green-01` | One passed, exit 0 | Exact internal-scroll action preservation and source/ancestor dismissal after its recorded behavioral red |

The focused log digest at that earlier migration cut is `d0b9132ef9d66da5ec99db899c90bcc976a13ec4fd6eb284b397d3efc00b8498`; its policy log digest is `c31f38fa4a30c65c4d8426599cd53cbb8b7c63e497f9a3136d7ce19491e0f266`. Final corrected-source results are recorded separately above, including the complete serial focused04 pass and preserved conflicting focused03 failure. No later complete repository pass is claimed.

## Recorded C2 results before the UI-policy correction

Each result below names an actual immutable command receipt under `m15-logs`. Production/test source was frozen for these C2 executions; evidence assembly and documentation were still uncommitted. The later UI-policy gate required another source cut, so these passes are not relabeled as post-migration executions. Passing focused reruns do not replace earlier failed attempts. Suites overlap and must not be summed into a unique test count.

| Recorded execution | Actual result | Scope |
| --- | --- | --- |
| `c2-final-focused-01` | 334 passed, 3 Windows skips; 23 files passed, 1 file skipped; exit 0 | Final source, host, M04 custody, composer, drafts, recovery, runtime and renderer contracts; zero reported errors |
| `c2-workbench-app-01` | 20 passed, exit 0 | Actual App integration, source recovery, canonical placement and deferred-panel failure retention |
| `c2-workbench-browser-01` | 16 passed, exit 0 | Renderer, selection, journal recovery, layouts and controlled benchmark |
| `c2-browser-agents-full-green-02` | 22 passed, exit 0 | Full merged agents configuration, including upstream evidence cases; explicit Chromium adapter |
| `c2-browser-chat-view-green-01` | 6 passed, exit 0 | Upstream canonical split-plane cases plus real ChatView/Tooltip Escape and IME cases |
| `c2-browser-artifact-green-03` | 1 passed, exit 0 | Original acknowledgment and revision-order assertions after explicit initial table readiness |
| `c2-saved-drafts-02` | 27 passed, exit 0 | Complete saved-drafts configuration with the portable server command |
| `c2-final-typecheck-01` | PASS, exit 0 | Final product/test source typecheck |
| `c2-final-build-01` | PASS, exit 0 | Final production build |
| `c2-browser-app-merge-review-01` | 10 comparisons passed, exit 0 | Read-only routing, provider, handoff and composer-boundary review |

The six final browser results have no skipped, unexpected, or flaky cases. The three focused aggregate skips are two Windows native source-file cases and one original-Hermes/native-file case. They are not passes. The aggregate log digest is `3fdcbef8c4859817b6b90c8ba9a71a3b5f29e88ca5391ad257183df3f749fb74`; the saved-drafts log digest is `86dcb9d9a68d3507fb64df634e7a5032051eeadf6e7ad76b372309be396485eb`.

The complete declared `pnpm test` attempt `c2-full-repository-test-01` exited 1 with 3,344 passed, 271 failed, 56 skipped and four unhandled errors across 347 files: 299 passed, 44 failed and four skipped. Its bounded-log SHA-256 is `be94231d1943b5932552c90c7a13f0c6b0e936ff394fa0782229f7c86abc36ae`. `m15-artifacts/c2-pre-ui-policy-source-cut.json` binds the frozen source for that run and the final focused/typecheck/build/UI-policy commands. These are observed failures, not an all-baseline classification.

`m15-artifacts/c2-full-repository-audit.md` and its JSON group the 271 failures as 188 file-access denials, 10 explicit dependency/executable failures, and 73 assertions with unclassified underlying causes. Four unhandled rejections are additional errors. The 24 focused files appear with identical ordered assertion names/statuses, 334 passed and three skipped; none of the 271 failures is in that focused selection. This is an outcome comparison, not proof that changes cannot affect other tests. No accepted-base execution establishes a baseline classification for these failures.

`c2-final-ui-policy-01` separately failed eight M15 overlay/select violations. The subsequent correction adopts shared Modal, Select and Popover without changing the guard or legacy inventory. Popover gains an optional validated-range geometry callback while retaining a real element for modal ownership and focus; provider children, exact source revalidation and guarded lazy content remain. The toolbar's internal-scroll dismissal regression was reproduced in `c2-ui-toolbar-scroll-red-02` and corrected in `c2-ui-toolbar-scroll-green-01`, which passes one identical case. A prior setup-only trace configuration failure remains separate. `M15-c2-browser-regression-review.md` records the migration and new actual-App/tall-source/zoom coverage.

The first complete post-migration App run, `c2-workbench-app-02`, remains failed with 19 passes and two failures. Its zoom case exposed a measured native-modal sizing defect: the taller Evidence view became 1,568 physical pixels high at CSS zoom 200%, moving Close and navigation above the 800-pixel viewport. The shared modal and workbench limits now use fixed containing-block percentages, including native-titlebar and mobile constraints. `c2-ui-modal-zoom-red-01` preserves the measured red; the identical case passes in `c2-ui-modal-zoom-green-01`, with Evidence bounded from y=16 to y=784. Their `source-and-geometry.json` artifacts retain exact source/test hashes and measurements. Modal ownership and JavaScript focus behavior did not change in this sizing repair.

App-02's other failure was interrupted by the overall test deadline. The trace shows successful failure-alert, focus, connected-composer, retained-draft and no-send checks, followed by a reload value assertion that received only about 902 ms before closure. Its terminal “Opening workspace” snapshot cannot establish lost draft data or a completed five-second readiness failure. `c2-ui-app-reload-recheck-01` passed that unchanged case in isolation before the CSS correction. No timeout or retention assertion changed. The original complete failure remains preserved.

The complete post-correction `c2-workbench-app-03` passes all 21 cases, exit 0, with no skipped, unexpected or flaky cases. It includes the unchanged deferred-load/reload case and strict zoom navigation, focus, source attachment and draft retention. Its bounded-log SHA-256 is `4165b025c4f23e6ef3b31d37ce55bf53ca7cf282dba9231fcccde739fbff4a32`. The separate narrow static review is preserved in `m15-artifacts/c2-ui-primitives-independent-review-02.md`.

**Remaining gates:** current ChatView readiness remains an active failure pending source/platform attribution. Public-source packaging passes 11 checks in `c2-final-package-01`; `c2-final-custody-01` verifies the clean original checkout, unchanged lockfile, 16 archived documents and authored whitespace. `c2-final-integrity-01` passes controller validation with bundle FAIL, and the final assembly incorporates its own receipt. Exact-head Windows/Edge and complete current root-browser parity remain open. Final passing serial focused/typecheck/build/policy and complete App/workbench/shared/saved-draft results retain their individual scope. Earlier C2 prerequisite, launcher, Hermes, and narrow host/M04 passes do not replace broader gates.

### Archived full regression failures and current separation

At the published cut, the declared `pnpm test` attempt failed before discovery because the `tsx` executable's IPC socket was denied. The supported `node --import tsx` path allowed setup and direct full Vitest execution. Historical `full-vitest-01` recorded **3,202 passed, 289 failed, 51 skipped and four unhandled errors** across 338 files: 51 failed, 284 passed, three skipped. Its JSON suite counters include nested describe containers and are not file counts. That run overlapped source edits and does not validate either the published final source cut or the current C2 cut. C2 repairs the launcher and its fresh declared run reaches discovery and completes with the distinct failed result above; no current count is inferred from this historical attempt.

The audit groups failures by observed signatures, including native file-read denials, missing skill inventory, native Cursor/runtime dependencies, Hermes cleanup and other assertions. It does not classify them all as baseline. Two introduced failures were found and corrected: partial host route composition and missing entries in the public-source import closure. Their targeted passing corrections are recorded without changing the original full-run result. See `M15-browser-regression-review.md` and `m15-artifacts/full-vitest-01-audit-summary.json`.

The historical clean `399cde39` root-browser run recorded **79 passed, 33 failed, one skipped**. The publication candidate root run recorded **74 passed, 38 failed, one skipped**, over the same 113 case identities. Thirty-two failures were common, six were candidate-only and one baseline failure passed. A focused rerun passed five of the six candidate-only cases. The remaining quiet artifact-acknowledgment failure occurred at its initial checkbox assertion before acknowledgment behavior. C2 now passes that behavior after canonical fixture repair and an explicit readiness boundary, without increasing assertion deadlines. Cold whole-App startup below five seconds remains unproven. Neither that repair nor the six focused C2 configurations converts either historical full root run to PASS or establishes complete parity against `138b135`.

Historical declared Edge attempts failed at launch because `/opt/microsoft/msedge/msedge` is absent locally. The explicit Chromium adapters change channel and test-directory resolution. The old agents 13-pass/two-failure attempt remains failed; byte-identical parser/fixture findings never constituted a baseline execution. Accepted upstream corrected the child receipt, and unchanged merged selected cases passed. C2 separately corrected the generic parent receipt and fixture import/readiness causes; the full 22-case configuration now passes. The original behavioral assertions and deadlines remain. Chromium coverage does not certify Edge or Windows.

### Review-driven corrections and failed-attempt custody

The publication review found and verified corrections for five source/evidence defects: incomplete history falsely grading evidence Verified, clipped interior selections, transformed Markdown mapping to the wrong canonical occurrence, command recording before output-pipe closure, and artifact array `/length` access. Its finding of no additional unresolved P1 or P2 defect applies to its inspected source and scope. C2 adds account-custody, exact M04 rollback, Hermes startup-guard cleanup, canonical fixture, receipt, and lazy-loading repairs with their own retained regressions and focused results. Read-only C2 App and M04 reviews found no remaining actionable defect in those narrow changes. Neither review is release approval.

The publication saved-drafts sequence exposed four missing alert roles and focus restoration before modal closure. C2 retains the repairs and its separate final 27-case suite passes; `c2-saved-drafts-01` still records 23 passes and four failures. Chat drag cancellation was reproduced on the old accepted base: an open tooltip consumed Escape first. Its capture-phase correction remains, with the three Escape/IME cases moved to a direct real-component fixture while preserving upstream's canonical App cases.

Earlier setup mistakes, incomplete fixtures, HMR-affected runs, narrow test locator errors, the first final typecheck failure and publication credential failure remain immutable records. A nonzero process exit is recorded as FAIL or BLOCKED, never relabeled as expected-negative success. Browser JSON, selected traces, failure contexts and final screenshots are retained where available. Bounded logs may omit early output; their digests identify the exact retained bytes.

## Current renderer and layout evidence

The final C2 renderer record from `c2-workbench-browser-02` uses 10,000 message metadata entries, 500 task records and 100,000 output lines. It compares the windowed component with a controlled unwindowed fixture in the same Vite development React browser harness. Timing measures trusted click to MutationObserver observation, after warmup. It does not measure paint, whole-App latency, production task-tree scaling, native history performance or universal-device performance.

| Final measurement | Controlled unwindowed reference | Windowed component |
| --- | ---: | ---: |
| Mounted output rows | 100,000 | 29 |
| Trusted measured samples | 30 | 30 |
| p95 interaction | 901.6 ms | 9.9 ms |

The reference machine exposed an Intel Xeon Platinum 8573C, nine logical CPUs and 10,451,423,232 bytes of memory, with Linux 6.18.57, Node 24.22.1 and headless Chromium 141.0.7390.37. Both conditions ran sequentially at 1280x800 without CPU/network throttling or trace capture. Each used three warmups. The candidate met the declared under-100-ms and at-most-300-row fixture thresholds.

The final report, raw samples and screenshots are retained under `m15-artifacts/c2-workbench-browser-02/artifacts/`; the benchmark report is `workbench-M15-controlled-r-a899a-with-100-000-retained-lines/m15-renderer-performance.json`, SHA-256 `1513dac24946b83307ab3c76bfe928a47f4652407052f4ed28373e0779415c6d`. All 11 recorded source digests match the corrected source. Both p95 values were independently recomputed from the 30 trusted samples per condition. Both required viewports, CSS zoom 200%, keyboard reachability, reduced motion, streaming, owner changes, reload and offline behavior are browser scenarios. The complete workbench suite passes 18 cases and actual-App integration has its separate 21-case receipt. CSS zoom is not a substitute for native desktop DPI testing.

The earlier pre-UI `c2-workbench-browser-01` report remains unchanged at SHA-256 `61bd3ec20b4fe313070909d93963f3f814a85a29c51c2ac2fdc82a1c80f3da20`, with 1,016.2 ms versus 7.1 ms. The older publication `browser-final-03` measurements, 2,230.1 ms versus 11.7 ms, also remain historical. Neither earlier timing is promoted to the final source cut.

## Data migration and rollback

No database schema migration, dependency change or destructive history conversion is introduced. The host remains the sole SQLite writer; Store callbacks stay synchronous. Captures and view records use existing persisted host projections. Local drafts gain bounded source companions; source-bearing transfer uses an explicit new version. Existing plain text drafts remain readable.

Disable `ui.sourceWorkbenchV1` to remove new capture and send contribution points. Existing dialogs/layout, canonical messages, queued-input custody, saved drafts and evidence remain. Retained source inspection and removal, mode reset to NOW and cancellation of proven undispatched inputs stay available. Rollback must not erase retained captures or pending ambiguous recovery receipts. It must not turn local view state into canonical task state. The host and App rollback tests cover these paths.

That rollback coverage means disabling the feature while retaining the current code. A binary downgrade to published `fd17d9f1` cannot interpret the new `sourceAccountAdmission` proof and can fail closed when reading or using affected retained references. The current code does not silently migrate legacy captures into new authority, and downgrade compatibility is not inferred from default-off rollback tests.

## Remaining gates

The complete C2 repository attempt remains failed at its recorded pre-UI-migration source cut, and final affected browser validation retains the current ChatView readiness failure. The serial focused aggregate passes after removing the confirmed shared-output build conflict; its earlier failing attempt remains preserved. Complete root-browser parity at the accepted reconciliation base remains open. Final public packaging and evidence-controller checks pass in their recorded scopes; the overall acceptance bundle remains FAIL. Source reconciliation with `138b135` is complete in the working tree; it is not a full acceptance result. Exact-head Windows file capture, original Hermes/native history continuity, installed-desktop handoff, platform path/grant cases and declared Edge suites require their actual targets. The three genuine Windows skips remain unexecuted native bodies in the latest focused aggregate.

The account-unbound first-source defect is repaired in source and covered by real host artifact fixtures. Its first-file Windows guard/runtime-fixture path and the added original-Hermes/native-file integration body remain unexecuted locally. The latter uses the real Service, M04, Python engine, ACP and native file guard with only a scripted model transport; Linux collection is an explicit skip, not native proof. `m15-artifacts/c2-host-hermes-integration-coverage.md` states its exact coverage and exclusions. Linux file leaf reads remain unsupported.

DIFF_HUNK capture requires the complete atomic comparison contract. Historical evidence navigation requires the authenticated retained-artifact reader. Trusted transformed-text offsets and M05/M10/M14 owning integrations remain absent. The renderer benchmark does not close whole-App/task-timeline performance gates. Independent release approval, merge and activation are not granted.

## Evidence reproduction and integrity

`scripts/m15-record.mjs` captures actual argv, executable and working-directory identities, timestamps, termination, exit code, status and bounded-log digest. New records finalize on child `close` so pipes have drained. The controller preserves older receipts as written.

The publication evidence review found two controller coverage gaps: omitted failed/blocked phases could escape plan reconciliation, and malformed receipt JSON could disappear from command coverage. Historical `evidence-controller-red-02` reproduced six altered bundles being incorrectly accepted. After correction, historical `evidence-controller-green-01` accepted the unchanged publication bundle and rejected all six mutations: omitted phases/gates, an altered command index, a malformed receipt, a changed legacy renderer exception, altered source-cut metadata and substituted dependency contracts. Tests use disposable copies and restore original evidence bytes. The initial cross-filesystem setup failure is retained separately. Those results are preserved with the archived bundle; they are not a completed validation of the current C2 assembly.

`scripts/m15-evidence.mts --assemble` constructs the source lock, source cut, complete artifact hash manifest, command index and strict `ImplementationEvidenceV3` document from actual receipts and the reviewed phase plan. Running it without `--assemble` checks the existing bundle. It validates schema and semantics, accepted ancestry, base blobs, source-lock digest, embedded receipts and log headers/digests, artifact existence and bytes, exact source and changed-file sets, package-manager declaration and the actual default-off host flag. The final C2 controller run and its receipt are incorporated in the reviewed plan, manifests and allowlist. `M15-validation-summary.json` records integrity PASS, bundle FAIL, the complete current counts and no integrity issues. The archived integrity PASS / bundle FAIL result remains tied to its publication source cut.

From the isolated repository root, with the declared pnpm on PATH:

```sh
node --import tsx scripts/m15-evidence.mts
git -c core.whitespace=cr-at-eol diff --check 138b1356495bb3a2c9b35020240513f8faa84964 -- . \
  ':(exclude)docs/implementation/v3/m15-logs/**' \
  ':(exclude)docs/implementation/v3/m15-artifacts/**'
```

The repository preserves existing CRLF bytes through `* -text`; the whitespace command respects that policy and checks authored files. Historical unrestricted whitespace checks found runner-emitted trailing spaces and blank lines in raw command logs. Those exact evidence bytes are intentionally preserved. `c2-final-custody-01` records the passing final scoped C2 authored-file check. Generated manifests avoid a self-hash cycle. The final commit SHA belongs in the external PR/handoff response, not a file inside the same commit.
