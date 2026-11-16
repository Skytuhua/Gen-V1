# M15 review record: C3 scope and disposition

## Current decision

**C3's local evidence has integrity PASS and bundle status PARTIAL against accepted main `49cd633273a3f61c14a4191a9877e99ab23ec88f`, with incoming published C2 `a1349b0a7ffa1420566da9c7770faf80d6be5bf3`.** The App/public-source manifest conflicts are resolved. The current complete App result is PASS, 22/22, after one activity test gained the required canonical-placement wait. Product App, handoff and native fixture are unchanged. Original App 21/1 and diagnostic 20/2 failures remain retained; the original native-return failure is unexplained. Build, typecheck03, prerequisites, UI policy, workspace, focused source, public packaging and custody checks pass at their stated cuts. Remaining browser, full-repository, root-comparison and actual-target acceptance is incomplete. The definitive current execution ledger is [M15-c3-regression-review.md](M15-c3-regression-review.md).

This document reconciles review scope and outstanding gates. It is not a new full independent approval of the entire merged C3 patch. Earlier independent reviews apply only to their inspected bytes and questions. Source inspection, focused passes, evidence integrity and publication authorization do not authorize merge, deployment or activation. `ui.sourceWorkbenchV1` and `reviewerApproval` remain false.

Publication preflight observed later main `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`. This review retains accepted base `49cd633` and makes no compatibility or execution claim for that later main.

## Source and review boundaries

| Record | Exact scope |
| --- | --- |
| C3 accepted base | Commit `49cd633273a3f61c14a4191a9877e99ab23ec88f`, tree `2ecdb4c95fc6b604159257a125064ad585b966e5` |
| Incoming C2 | Commit `a1349b0a7ffa1420566da9c7770faf80d6be5bf3`, tree `3c33aa40a916205f7bf3ac390b5881d1ab5030de`; parents are published cut 1 then accepted base `138b135` |
| C3 implementation | Working source after reconciliation, with local integrity PASS / bundle PARTIAL. A final staged tree, complete acceptance verdict and new publication SHA are not yet claimed here. |
| C2 historical review | The exact original report is archived at [publication-cut-02/M15-final-review.md](m15-artifacts/publication-cut-02/M15-final-review.md), with its source/evidence manifests. |
| Cut 1 historical review | Archived under `publication-cut-01/`; performed against execution base `399cde39ff4ee82272c7a7700944325c44b36070`, not accepted base `49cd633`. |
| Private C3 workflow/helper review | Narrow static review of publication transport, push-source identity, Windows launcher design and artifact ingestion. It ran no real Windows/Edge/PowerShell CI or connector transfer and supplies no product-wide approval. |
| Bounded C3 App/native review | `c3-app-native-return-independent-review-01` inspected the integrated App, owner/journal/split/SurfaceBoundary paths and corrected fixture. It found no material defect in that scope, ran no jobs and did not claim full App, focused aggregate or installed-desktop execution. Those test outcomes require their own receipts. |

The 17-file C2 archive manifest was verified before the current review document was revised. C2's final integrity PASS / bundle FAIL and all failed or superseded attempts remain unchanged. A completed archive proves custody of those bytes, not success of C3 execution.

## C3 review focus

The upstream changes retain the direct host custody/send/read contracts while changing App composition and workspace routing. Preserve retirement of new Code Review, Research, Custom and Visuals surfaces; retain historical preset parsing without restoring removed hosts. Layout selection is presentation and cannot substitute for a source's thread/project/working-copy/account owner. Generic Diff UI is not the missing atomic comparison witness.

Returning native threads must wait for canonical split-layout readiness and use the existing selection/handoff path. M15 source providers, active/held fences, exact draft generation and delayed-read rejection must survive that transition. SurfaceBoundary integration must not reconstruct another composer or claim that a rendering retry reloads a failed dynamic import or acknowledges a durable write.

The working-composer guidance must agree with explicit AFTER_CURRENT mode. A queued ordinary message retains its text, captured refs, send mode and existing `message.send` transport. No hint repair may convert it to a side question, stop the current run or create another task. Current regression results for these combined boundaries belong in the C3 ledger.

The App and public-source allowlist conflict resolution must preserve current main's deletions and SurfaceBoundary additions while admitting the M15 local import closure. The public-export manifest's own baseline has a separate contract and must not be replaced mechanically by the M15 evidence base.

## Inherited fixes and their evidence

The following corrections are retained as reviewed history. Their original red/green receipts are not relabeled as C3 tests.

| Finding or correction | Retained behavior and historical evidence |
| --- | --- |
| R1: incomplete evidence history could become Verified | One-extra-observation completeness detection; partial history cannot yield verified requirements/checks. Original `evidence-window-red-01` and `evidence-window-green-01`. |
| R2: clipped interior selection | Visibility checks cover intersected descendants, not only endpoints. Original selection-review red/green cases. |
| R3: transformed Markdown occurrence ambiguity | Inline mapping requires canonical identity; explicit per-message canonical selection remains the supported fallback. Trusted formatted offsets remain gated. |
| R4: recorder finalized before pipes drained | New receipts finalize on child `close`; no older log is retroactively declared complete. |
| R5: array `/length` was accepted as source data | Only canonical safe in-bounds array indices are admitted; ordinary object keys remain valid. Original array red and focused green. |
| R6/R7: evidence-controller omissions | Complete phase/command/source-lock/index reconciliation and strict receipt parsing, with one hash-pinned legacy exception. Recorded corruption probes preserve their original source and outcome. |
| C2 first-account source custody | One transaction-owned admission witness for provably unbound captures; original refs/bytes/digests/grants remain immutable. Legacy and changed-owner cases fail closed. |
| C2 M04 rollback | Prove no receipt/outbox commit, undo exact admission advances, then only the newly acquired claim. Accepted/newer/replaced/finalized entries stay fenced. |
| C2 Hermes startup and launcher | Distinguish a guard never acquired from acquired-guard or teardown uncertainty; use `node --import tsx` for credential setup. Linux success is not Windows proof. |
| C2 shared controls and modal sizing | Shared Modal/Select/Popover, constrained internal scrolling, real-element ownership, exact selection and fixed containing-block size limits. Recorded behavioral failures remain retained. |
| C2 fixture and sequencing repairs | Canonical receipt envelopes, explicit fixture readiness, isolated App imports and serial build/test execution. Readiness failures and original full runs keep their actual status. |

The full historical findings, reproductions, immutable source hashes, controller mutation probes and narrow independent reviews remain in the archived reports and `m15-artifacts/`. They do not establish that all later merged behavior was independently reviewed.

## Current acceptance boundaries

| Gate | C3 disposition |
| --- | --- |
| Initial build and prerequisites | `c3-final-build-01`: PASS, 15.132 s. `c3-core-prerequisites-01`: 72 passed in six files, no failed/skipped cases. Both identify their initial C3 execution cut. |
| UI policy and workspace contracts | `c3-final-ui-policy-01`: 527 sources, zero violations, unchanged 39-entry legacy/geometry inventory. `c3-workspace-contracts-01`: 17 passed in four files. |
| Typecheck | `c3-final-typecheck-03`: PASS on the final activity-test source. `02` also passed after the fixture initialization correction. Original `01` remains FAIL with four TS2352 diagnostics; failed bytes are retained. |
| Focused source and host coverage | `c3-final-focused-01`: 335 passed, 0 failed, 3 Windows-only skips across 24 selected files. Includes the corrected legacy-layout custody case. This is complete coverage of that selected file set, not the full repository. |
| Combined App regression | `c3-activity-sync-full-01`: PASS, 22/22, no skips/flaky/runner errors. Activity test now observes the actual canonical A-placement receipt before reload, preserving original assertions/deadlines. Product/native fixture unchanged. Original `c3-workbench-app-01` FAIL 21/1 remains unexplained; diagnostic FAIL 20/2 remains separate instrumented evidence. |
| Current browser and shared-control behavior | Standalone `c3-workbench-browser-01` passes 18/18. Current App passes 22/22 with prior failures retained. Other affected configurations require their own receipts; archived C2 passes are not reused. |
| Full repository | No C3 full result is claimed. The prior C2 full attempt remains FAIL, 3,344 passed/271 failed/56 skipped plus four unhandled errors. No blanket baseline attribution is made. |
| Canonical readiness and root parity | C2's 5/1 ChatView failure remains historical. Current canonical startup and complete candidate/base `49cd633` root comparison need current results. |
| Actual platform | Windows native source/file/Hermes and declared Edge require actual execution. Skipped native bodies and a scripted model transport cannot substitute for those results. Installed-desktop handoff/history/DPI retain their separate limits. |
| Packaging, custody and integrity | Package02 passes 11/11. Custody02 passes, including clean original checkout, exact archives and 709 published evidence paths unchanged. Post-receipt assembly: integrity PASS / bundle PARTIAL, 216 command records, 892 artifact hashes, 72 implementation files, 970 changed paths, no issues. C2 remains a separate historical verdict. |
| Capability gates | Atomic complete diff witness, authenticated retained log/screenshot reader, trusted transformed-text offsets, and M05/M10/M14 owner contracts remain unavailable. |
| Performance | C3's controlled renderer measures windowed 29 rows / p95 4.3 ms and unwindowed 100,000 rows / p95 2,711.5 ms, 30 trusted samples each. Sequential React/Vite fixture click-to-MutationObserver timing only; no whole-App/task-tree/timeline, native history, paint, general-device or DPI guarantee. C2 measurements stay historical. |
| Approval and activation | No full independent C3 approval, merge/release approval or activation is granted. Both flags remain false. |

The exact-head push workflow can execute even when later main drift prevents a PR merge tree. The bounded v2 design adds complete workspace-host, saved-layout, usage/shell-error/mobile, desktop-surface and both enabled split suites while preserving existing jobs and deadlines. Its 16 browser receipts include one command enabling both split guards with an explicit supported Edge override; desktop-surfaces retains bundled Chromium. The 45-minute job limit is an incomplete-evidence cutoff, not a proven runtime budget. Ordinary PR CI remains unchanged and valuable for its separate merge tree. Static review or synthetic ingestion tests are not target execution. Four full-shard results must agree on head/tree/run/attempt; missing source, results, receipts or hard-interrupted artifacts remain incomplete evidence.

The diagnostic record distinguishes the proven activity-test sequencing defect from the stale-recovery action that began after teardown and the original unclassified native-return failure. Exact restoration removed temporary instrumentation before the activity-only correction and full 22-case validation. No product/native repair or common IndexedDB explanation is claimed. The current pass is scoped to its executed bytes and scripted transports.

## Rollback and evidence custody

Feature-off rollback retains current code, messages, captures, drafts, evidence, queued-input custody and ambiguous retries. Retained inspection/removal, NOW reset and proven-undispatched cancellation remain available. It does not guarantee binary downgrade compatibility; cut 1 `fd17d9f1` cannot interpret the later account-admission witness and may fail closed. No compatibility shortcut may turn legacy material into new authority.

Every failed or superseded command remains immutable. C3 assembly binds accepted base `49cd633` and source-lock digest `f4bb271eda17b4d47e005d44944f75f02c906cc5947bb4acac48bff8b524fa4a`, exact implementation bytes, artifacts, receipts and required cases. Its observed integrity PASS means those records are internally consistent; bundle remains PARTIAL. It cannot close unexecuted platform gates or grant review permission.

Export reconciliation relocated 120 ignored Vite cache files totaling 45,563,811 bytes to exact retained external copies, recorded in [c3-artifact-intermediates-01.json](m15-artifacts/c3-artifact-intermediates-01.json). All 870 prior noncache artifact/log entries and 709 published evidence paths are unchanged. No source/results/logs/traces were moved; the public manifest gained eight metadata paths while runtime admission stayed at 216. Package01/custody01 PASS and initial integrity01 PASS/PARTIAL remain preserved. Initial assembly 212 records/1,002 artifacts/72 implementation/960 changed, integrity02 215/890/72/968, and post-receipt assembly 216/892/72/970 describe different measured cuts. This packaging-intermediate relocation corrects export membership and does not relabel any test outcome.
