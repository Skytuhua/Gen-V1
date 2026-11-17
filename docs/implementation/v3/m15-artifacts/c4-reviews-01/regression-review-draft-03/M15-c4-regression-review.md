# M15 C4 regression review

## Status and evidence boundary

The final03 local validation passed the complete declared Chromium suites: actual App 26/26, desktop-surfaces 31/31 and renderer 21/21, with no failures, skips, flaky cases or report-level errors. The 28-file host selection passed 410 cases with two genuine Windows-only skips. Typecheck, production build and UI policy also passed. This is bounded local validation; exact-head C4 Windows/Edge and the current full-repository aggregate remain separate gates.

This additive draft records completed evidence through the renderer post-run source verification at 2026-11-16T06:08:37.638655+00:00. The source is final03 manifest 0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260, with captured HEAD eeda4a89879aa1f3baaa04e60dd4a2d9c520761c plus local changes. Only workbench-recovery.ts and its source-handoff unit test differ from final02. Every browser spec, fixture and config is unchanged.

The normal asynchronous handoff regressions first failed, then passed after independent FIFO validation for calls sharing a thread. The complete App and desktop suites then passed their original navigation, close and detach assertions. Final02 remains a failed attempt at 22/4 App and 26/5 desktop. Its stale-source reload and rollback initial-readiness failures issued no snapshot requests at their failed stages. Their causes remain unclassified despite the later pass; this ledger does not label them repaired by the FIFO change or erase their receipts.

Draft01 and draft02 remain immutable. Earlier M05, Usage, workspace and layout passes retain their source cuts; C3 Windows remains terminal FAILURE. External publication archives retain their failed Windows and separate Linux commands. Local passing selections, archive admission and integrity checks do not replace those historical outcomes or establish release activation.

## Source identity

C4 reconciles M15 with accepted upstream `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`. C3 was published at `3f68a8f1bc1ca5a588862571d905163861e94492`, tree `be7e206431f13b654b6aecd7c12c23d0e4b2dfdb`, against the older accepted base `49cd633273a3f61c14a4191a9877e99ab23ec88f`. C3 is historical evidence for C4.

External changes were preserved through adoption of `0f487aa82fba616131d7f9e547076d3a14d67f48`, then evidence-only `364d3f552c23668c3894d04f4a6443808cc2b17a` and `082264877e3bb61e8c87f257ccd831b5c1438472`. The tested local source contains additional changes beyond those Git HEAD trees. A receipt's nearby HEAD is not a substitute for its whole-source manifest.

Each manifest below covers all tracked and nonignored untracked repository paths outside documentation. Dependencies and ignored generated assets retain separate setup provenance. The first five cuts have 2,390 source files; subsequent handoff, adoption and selection cuts have 2,391. The original source manifests and earlier receipts remain unchanged.

| Cut | Parent or HEAD at capture | Source files / bytes | Manifest SHA-256 |
| --- | --- | ---: | --- |
| [Initial merge prerequisites](m15-artifacts/c4-prerequisites-01/source-cut.json) | C3 `3f68a8f1`, incoming `b4aa2caa` | 2,390 / 55,374,761 | `bbe507cd947ac5c86cb31e81a08cc2f8c3b932b2f94cf401b27084866107adb5` |
| [Initial integration](m15-artifacts/c4-integration-initial-01/source-cut.json) | External `0f487aa8` plus local tests | 2,390 / 55,407,655 | `45c8c271338bfda89e8411636d0786430ae387a204cf1187d1f2eed5f7e38141` |
| [M05 integration correction](m15-artifacts/c4-integration-green-01/source-cut.json) | External `0f487aa8` plus local implementation | 2,390 / 55,412,423 | `692fe4b7bfd8bf7de881d11f2a0603e82e88ad9b7c3d55b289b506893010689a` |
| [First browser corrections](m15-artifacts/c4-browser-corrections-01/source-cut.json) | External `08226487` plus retained local implementation | 2,390 / 55,415,853 | `f542de949b162bf343058a77b2cbb6091d7f6ebb10ef1df1926776a3d3e5006a` |
| [Usage owner correction](m15-artifacts/c4-usage-owner-01/source-cut.json) | External `08226487` plus Usage owner correction | 2,390 / 55,418,271 | `a2a3c75f73e6646c5fc8fd5fb2ec59241d76bfc6844ebe48fda88f4dc18c01a6` |
| [Source handoff Phase A](m15-artifacts/c4-source-handoff-initial-01/source-cut.json) | External `08226487` plus observation and strict helper extraction | 2,391 / 55,461,300 | `fe8a782f2a48c0a359042c54bce38e1b2003fce00a0e639292a9e283aacad0ae` |
| [Source handoff Phase B](m15-artifacts/c4-source-handoff-policy-01/source-cut.json) | HEAD 08226487 plus local changes | 2,391 / 55,467,618 | 4ce32ce11edfac8cfaf89728f783266e67adc17f42a9338ab9d8e48842cc53ed |
| [Pre-adoption candidate, no final browser runs](m15-artifacts/c4-validation-final-01/source-cut.json) | HEAD 08226487 plus local changes | 2,391 / 55,474,254 | b9bd09a6e6c59378939d2b454511da489569bf50a939317dd4dc7399dbe47820 |
| [Incoming eeda UI union](m15-artifacts/c4-incoming-ux-01/source-cut.json) | HEAD eeda4a89 plus local changes | 2,391 / 55,474,841 | c8a95c7ff8ae1daf6f5ff9b5b9dd930ee570e50cb86e271410c98535657dab8d |
| [Selection diagnostic setup failure](m15-artifacts/c4-selection-completion-red-01/source-cut.json) | HEAD eeda4a89 plus local changes | 2,391 / 55,477,954 | 6aba19ffe3d09264b598c82bad4d89628a9ac9a2d0ef1c0bda0ee8ef3738db85 |
| [Foreign selection red](m15-artifacts/c4-selection-completion-red-02/source-cut.json) | HEAD eeda4a89 plus local changes | 2,391 / 55,477,914 | 26c677d8e2b4a8c77a06d09a8b8938fa9c21f685b5ebcdc6485d85620fd1776a |
| [Foreign and same-source selection red](m15-artifacts/c4-selection-completion-red-03/source-cut.json) | HEAD eeda4a89 plus local changes | 2,391 / 55,479,895 | dea6c23b758c9a04fe822b971fdb9529d29708a90f82c41ed2d1cc95bbb16be9 |
| [Final02 selection fix and completed browser attempt](m15-artifacts/c4-validation-final-02/source-cut.json) | HEAD eeda4a89 plus local changes | 2,391 / 55,481,040 | 5f0de8a3c62b27685ac6a929f0d4fb0ec7c7d94f88bd9cc1f70ceafe1808e24a |
| [Asynchronous empty-owner normal red, two new cases](m15-artifacts/c4-empty-owner-red-01/source-cut.json) | HEAD eeda4a89 plus local changes | 2,391 / 55,483,446 | 94371e7ea90e040ea79e8cb4493922a0959a9a3543837ff82385c41190ccbda9 |
| [Expanded scheduling and owner-isolation normal red](m15-artifacts/c4-empty-owner-red-02/source-cut.json) | HEAD eeda4a89 plus local changes | 2,391 / 55,490,335 | 5bf5568415c660566347abdfdd56fc33fc662d39e103a6a6adb238b849aad02e |
| [FIFO correction and completed current local validation](m15-artifacts/c4-validation-final-03/source-cut.json) | HEAD eeda4a89 plus local changes | 2,391 / 55,491,032 | 0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260 |

The integration, browser-correction, and Usage executions used before/after source verification against their named manifests. The initial prerequisite and typecheck results apply only to their earlier cut. The later final02 and final03 gates below supply their own terminal outcomes; earlier gates do not substitute for them.

## Final03 scheduling repair and current local validation

The final03 manifest covers 2,391 non-document source files and 55,491,032 bytes. The correction queues source-handoff validation by thread because logical owners on a thread share authored-text and pending-send journal keys. Every queued invocation independently validates its logical owner and current recovery, persistence and acknowledgment obligations. A preceding rejection still reaches its caller; the following invocation performs its own validation. No source authority, registry membership, browser assertion or deadline changes.

The normal test-only red01 added asynchronous IndexedDB-delivery schedules with the initial source read either settled or still pending. Red02 added four adversarial revalidation/owner cases. Its source-handoff test has exactly the same SHA-256 in green, 8378a53a26963b97fa27b64dc0aa094b97bef7f21e66766be02c6a74a50c89bf. The only source difference from normal red02 to green is workbench-recovery.ts, from 43466b7cb5c40326c704c56ae1024af07a3a88137ba09bf0c557aa89eaf947ed to 2c4c50c7300d3960a0be2d8a18f089150b9a5a8b3d3cc5f0776a77de36ecc5a3.

| Scheduling command | Actual outcome | Evidence |
| --- | --- | --- |
| c4-empty-owner-red-01 | FAIL: 25 passed, two failed, zero skips; two files | [Receipt](m15-logs/c4-empty-owner-red-01.json), [results](m15-artifacts/c4-empty-owner-red-01/results.json) |
| c4-empty-owner-red-02 | FAIL: 27 passed, four failed, zero skips; two files | [Receipt](m15-logs/c4-empty-owner-red-02.json), [results](m15-artifacts/c4-empty-owner-red-02/results.json) |
| c4-empty-owner-green-01 | PASS: 31 passed, zero skips; two files | [Receipt](m15-logs/c4-empty-owner-green-01.json), [results](m15-artifacts/c4-empty-owner-green-01/results.json) |

The 31-case green selection contains 28 source-handoff cases and three unchanged editor-registry cases. It checks both empty-owner schedules, later same-owner failed work after the first validation inspected its source, different logical owners sharing a thread, queued first hydration with retained sources and an uncertain send, and an earlier owner's rejection followed by an independently valid next owner. The cases retain exact source records, authored text, pending input and failure obligations. They use the real journal/recovery/registry modules with scripted storage; native/browser coverage is separately identified below.

| Final03 command | Actual outcome | Evidence |
| --- | --- | --- |
| c4-final-host-regression-02 | PASS: 410 passed, two Windows-only skips, 28 files | [Receipt](m15-logs/c4-final-host-regression-02.json), [results](m15-artifacts/c4-final-host-regression-02/results.json) |
| c4-typecheck-final-03 | PASS, exit 0 | [Receipt](m15-logs/c4-typecheck-final-03.json) |
| c4-build-final-03 | PASS, exit 0 | [Receipt](m15-logs/c4-build-final-03.json) |
| c4-ui-policy-final-02 | PASS: 545 sources, zero violations; inventory unchanged | [Receipt](m15-logs/c4-ui-policy-final-02.json) |
| c4-workbench-app-final-02 | PASS: 26/26 | [Receipt](m15-logs/c4-workbench-app-final-02.json), [results](m15-artifacts/c4-workbench-app-final-02/results.json), [before](m15-artifacts/c4-workbench-app-final-02/source-before.json), [after](m15-artifacts/c4-workbench-app-final-02/source-after.json) |
| c4-desktop-final-02 | PASS: 31/31 | [Receipt](m15-logs/c4-desktop-final-02.json), [results](m15-artifacts/c4-desktop-final-02/results.json), [before](m15-artifacts/c4-desktop-final-02/source-before.json), [after](m15-artifacts/c4-desktop-final-02/source-after.json) |
| c4-workbench-final-02 | PASS: 21/21 | [Receipt](m15-logs/c4-workbench-final-02.json), [results](m15-artifacts/c4-workbench-final-02/results.json), [before](m15-artifacts/c4-workbench-final-02/source-before.json), [after](m15-artifacts/c4-workbench-final-02/source-after.json) |

The browser commands ran once each, sequentially after the host/type/build/policy gates were terminal, with the unchanged declared Chromium configs and absolute JSON destinations. Every before/after source verification passed. The current host report contains 28 actual files and 44 aggregate suites including nested suites. Its two Windows-only skips are retained-file grant revocation and first-file account custody, not native passes. The normal 31-case result is included in this broader selection and must not be added as independent unique coverage.

All five prior desktop failures now reach and pass their original assertions, including refusal of pending signature preprocessing and acknowledged editor preservation. The original unrecovered-composer case and the source-backup parsing/failed-import case also pass. App navigation, retained source/draft recovery, native return, M05 queue/read-only review and the remaining cases pass. The two historical no-snapshot startup failures remain unexplained; the current success establishes the current functional observation, not their cause or a cold-start performance guarantee. Desktop uses a scripted native bridge, so these passes do not establish installed-desktop execution.

The complete renderer passes all three selection-completion cases plus the 18 existing cases. Its latest [controlled performance report](m15-artifacts/c4-workbench-final-02/artifacts/workbench-M15-controlled-r-a899a-with-100-000-retained-lines/m15-renderer-performance.json), SHA-256 48989b4d853933b8b97287db25f7036cb77dff86535c7f3ae31c9beee2b336b2, measures windowed p95 5.6 ms with 34 mounted rows and unwindowed p95 2,038.1 ms with 100,000 rows. All 60 measured samples are trusted, after three warmups per condition; all source digests match final03. The metric excludes paint/presentation and remains a controlled Vite/React fixture observation. The prior final02 benchmark remains retained; their timing difference is not attributed to the FIFO repair.

## Historical final02 gates and full browser attempt

The three complete declared Chromium suites ran sequentially without case filters, retries, source edits, deadline changes or channel overrides. Every command has a retained before/after whole-source verification, including the two failed commands. Each verified all 2,391 non-document source files and 55,481,040 bytes against the exact final02 manifest. The parent completed build and UI policy before browser release. The bounded host diagnostic ended before the renderer run, which had no competing heavy job.

| Final02 recorded command | Actual outcome | Evidence |
| --- | --- | --- |
| c4-final-host-regression-01 | PASS: 404 passed, two Windows-only skips, 28 files | [Receipt](m15-logs/c4-final-host-regression-01.json), [results](m15-artifacts/c4-final-host-regression-01/results.json) |
| c4-typecheck-final-02 | PASS, exit 0 | [Receipt](m15-logs/c4-typecheck-final-02.json) |
| c4-build-final-02 | PASS, exit 0 | [Receipt](m15-logs/c4-build-final-02.json) |
| c4-ui-policy-final-01 | PASS: 545 sources, zero violations; legacy inventory unchanged | [Receipt](m15-logs/c4-ui-policy-final-01.json), [log](m15-logs/c4-ui-policy-final-01.log) |
| c4-workbench-app-final-01 | FAIL: 22 passed, four failed | [Receipt](m15-logs/c4-workbench-app-final-01.json), [results](m15-artifacts/c4-workbench-app-final-01/results.json), [before](m15-artifacts/c4-workbench-app-final-01/source-before.json), [after](m15-artifacts/c4-workbench-app-final-01/source-after.json) |
| c4-desktop-final-01 | FAIL: 26 passed, five failed | [Receipt](m15-logs/c4-desktop-final-01.json), [results](m15-artifacts/c4-desktop-final-01/results.json), [before](m15-artifacts/c4-desktop-final-01/source-before.json), [after](m15-artifacts/c4-desktop-final-01/source-after.json) |
| c4-workbench-final-01 | PASS: 21 passed | [Receipt](m15-logs/c4-workbench-final-01.json), [results](m15-artifacts/c4-workbench-final-01/results.json), [before](m15-artifacts/c4-workbench-final-01/source-before.json), [after](m15-artifacts/c4-workbench-final-01/source-after.json) |

All three browser reports contain zero skipped cases, flaky cases and report-level errors. The final host report contains 28 actual files; its 44 aggregate suites include nested suites. Its two skips remain the Windows retained-file revocation and first-file account-custody cases. The earlier 22-case M05 selection and 25-case handoff selection overlap this host command and cannot be added as unique coverage.

### Retained App and desktop failures

| Complete suite | Failed case or group | Observed stopping point |
| --- | --- | --- |
| App | Stale capture after reload | Original five-second assertion cannot find “The source has changed.”; no snapshot or workbench request appears after the reload boundary in the retained trace. Cause remains unclassified. |
| App | Real activity integration | Original five-second selected-tab assertion cannot find Other task; no canonical split command follows that click. |
| App | Source-aware navigation | Returning from Other task never sends the canonical return placement; the current Other task composer remains empty where the original assertion expects the authored A draft. This does not establish lost retained data. |
| App | Rollback cancellation | Fixture's original 15-second initial Message-enabled assertion finds no composer; context is Opening workspace, with no snapshot request in the retained trace. Cause remains unclassified. |
| Desktop | Close acknowledgment/cancellation; latest edit and lease; workspace editor alias; pending signature upload | Each awaits the close callback until its original 30-second whole-test deadline. Later acknowledgment or refusal assertions receive no credit. |
| Desktop | Sidebar detach | Original five-second predicate observes no native detach call. |

The final App run passed its native-return case and all four M05 integration cases. The desktop run passed the original unrecovered-composer cold-close case and the new source-backup parsing/failed-import case. Those successes do not replace the failures elsewhere in either complete command.

A separate [bounded empty-owner diagnostic](m15-logs/c4-empty-owner-diagnostic-01.json) imports the actual journal, recovery and editor registry modules and delivers empty IndexedDB requests through setImmediate. Both registered guards start, neither reaches ready, and 66 source reads hit the deliberate 64-read sentinel. The command fails with exit 1; its before/after checks retain final02 source. This proves the tested asynchronous scheduling defect, distinct from the earlier passing microtask-based unit schedules. It is not browser, native or host execution. The App navigation traces stop at a matching pre-command stage. The two startup failures remain separate and unexplained, even if a later complete run passes.

### Final02 renderer and performance scope

The complete renderer run passed the three new selection-completion cases and all 18 existing cases, including the unchanged narrow-toolbar internal scrolling, ancestor-scroll dismissal, clipboard logical-line, recovery and 200% zoom checks. The incoming overflow styling therefore has a passing observation for that existing interaction; no assertion was weakened.

| Controlled renderer condition | p95 event-to-DOM observation | Mounted output rows |
| --- | ---: | ---: |
| Windowed | 9.9 ms | 34 |
| Unwindowed reference | 2,738.9 ms | 100,000 |

The [performance report](m15-artifacts/c4-workbench-final-01/artifacts/workbench-M15-controlled-r-a899a-with-100-000-retained-lines/m15-renderer-performance.json) has SHA-256 4db27f4aae4dd93bf49b765611cd2a18406bfd94d57323fcab6ad5d2c74be137. Both conditions use the same retained 100,000 lines, 30 trusted measured interactions after three warmups, and the same development fixture. The metric ends at MutationObserver delivery and excludes paint and presentation. All embedded source digests match final02. It is not whole-App, live-provider, installed-desktop or universal-device performance. The benchmark's existing 180-second case budget and the suites' other original deadlines are unchanged.

## Incoming eeda adoption and selection completion repair

The [adoption receipt](m15-logs/c4-incoming-ux-adoption-01.json) moves the parent from 082264877e3bb61e8c87f257ccd831b5c1438472 to eeda4a89879aa1f3baaa04e60dd4a2d9c520761c and preserves 6,484 other measured working paths plus 6,060 other index entries. It incorporates the incoming changes in SourceSelectionActions, SourceWorkbench, source-workbench.css and workbench-output.css. SourceWorkbench is the reviewed union with existing local M05/handoff changes, not a claim of equality with the incoming file. The other three adopted files matched their incoming bytes at adoption. Newer main commits are not accepted or tested by this ledger.

| Selection completion attempt | Actual outcome | Source and evidence |
| --- | --- | --- |
| c4-selection-completion-red-01 | Setup FAIL: zero cases executed, two runner errors | Cut 6aba19ff; [receipt](m15-logs/c4-selection-completion-red-01.json), [results](m15-artifacts/c4-selection-completion-red-01/results.json) |
| c4-selection-completion-red-02 | One passed, one failed; zero skips/flaky/report errors | Cut 26c677d8; [receipt](m15-logs/c4-selection-completion-red-02.json), [results](m15-artifacts/c4-selection-completion-red-02/results.json) |
| c4-selection-completion-red-03 | One passed, two failed; zero skips/flaky/report errors | Cut dea6c23b; [receipt](m15-logs/c4-selection-completion-red-03.json), [results](m15-artifacts/c4-selection-completion-red-03/results.json) |
| c4-selection-completion-green-01 | Three passed; zero failures/skips/flaky/report errors | Cut 5f0de8a3; [receipt](m15-logs/c4-selection-completion-green-01.json), [results](m15-artifacts/c4-selection-completion-green-01/results.json) |

The first attempt used a nested trace override that Playwright rejected because it would force a new worker. Removing only that override retained the file's existing top-level trace setting. The setup failure provides no product-failure evidence.

The incoming success cleanup cleared the document selection and candidate after an awaited action when only its text/enabled/unmount revision still matched. Red02 reproduces erasure of a newer foreign range at offsets 2..25 while the acknowledged action still refers to the original 8..21 source range. Its own-range cleanup control passes. Red03 also reproduces erasure of a newer 0..7 range and toolbar in the same source. These are measured selection-ownership defects, not assumptions based only on the diff.

The fix snapshots the original range's node identities and offsets before the await, clears the live single selection only when those original boundaries still match, and clears candidate state only when its range still matches. Newer ranges and toolbar intent remain available. Source authority, visibility/text revalidation, revision fencing, IME, focus and error behavior are unchanged. SourceSelectionActions changes from SHA-256 691c685e96dee5ff1d4f76f1a0d4ab498b9ef15c71cd2725685a242e34896f5f to 25ff6913518ae694ec629802d0ba4ca17cb5a4f56feed13e050d74d6764f02e5.

The fixture SHA-256 remains 64b33ce48704c5bfb9ad205c58209ea7808fc5d3d2d7a7c01fc5ab43cbc6e7b9 across all four attempts. Red03 spec e57edc4b1f2f58132f75aeb391adc0499a4b0fa86dfdefeee898da305997efa2 becomes green spec 568eb7e4f773fc40bd18d064a7a77d2fadd955908752b75783cbd29b3c46cb3f through seven downstream lines after the unchanged failing assertion. They explicitly activate the retained B toolbar, verify its exact 0..7/Visible payload, then acknowledge and verify its own-range cleanup. This is additional downstream coverage, not an identical-whole-spec claim. The final complete renderer run includes all three cases. The fixture uses the real React selection component and shared Popover with a held callback; it does not establish host capture or native execution.

## M05 integration: retained red and green results

All counts below are executed results. The two source-level commands ran the same two test files, without skip or deadline changes. The new shared-composer token/source/mode retry case already passed in the initial execution. The working-queue browser case also already passed. Those cases are regression coverage, not newly reproduced product failures.

| Recorded command | Cut | Actual result | Retained evidence |
| --- | --- | --- | --- |
| `c4-source-memory-initial-01` | `45c8c271` | **FAIL: 10 passed, 12 failed**, two files | [Receipt](m15-logs/c4-source-memory-initial-01.json), [results](m15-artifacts/c4-source-memory-initial-01/results.json) |
| `c4-source-memory-green-01` | `692fe4b7` | **PASS: 22 passed**, two files, no skips | [Receipt](m15-logs/c4-source-memory-green-01.json), [results](m15-artifacts/c4-source-memory-green-01/results.json) |
| `c4-workbench-memory-initial-01` | `45c8c271` | **FAIL: 1 passed, 3 failed** | [Receipt](m15-logs/c4-workbench-memory-initial-01.json), [results](m15-artifacts/c4-workbench-memory-initial-01/results.json) |
| `c4-workbench-memory-green-01` | `692fe4b7` | **PASS: 4 passed** | [Receipt](m15-logs/c4-workbench-memory-green-01.json), [results](m15-artifacts/c4-workbench-memory-green-01/results.json) |
| `c4-panel-opener-initial-01` | `45c8c271` | **FAIL: 1 passed, 1 failed** | [Receipt](m15-logs/c4-panel-opener-initial-01.json), [results](m15-artifacts/c4-panel-opener-initial-01/results.json) |
| `c4-panel-opener-green-01` | `692fe4b7` | **PASS: 2 passed** | [Receipt](m15-logs/c4-panel-opener-green-01.json), [results](m15-artifacts/c4-panel-opener-green-01/results.json) |

### Owning host behavior

The initial 12 source-level failures were three incorrect effective-M04 availability projections, five M05 module-state projections, the project-less module result, two owner-change reads that never entered the absent reader, and an unexpected reader error that was incorrectly converted into a successful result. The correction uses the actual owning Service decision for M04 and the existing M05 owner reader for M05. It does not rewrite the feature flags or create a parallel memory store.

The combined host case uses real Service, Store, source capture, request preparation, outbox handling and project-memory custody with a recording runtime. It prepares the authored prompt, retains an exact artifact source, dispatches one command carrying the same request token and source reference, and verifies distinct `REFERENCE` and `MEMORY` segments, their byte counts and digests, the full prompt budget, unchanged capture bytes, and idempotent command replay. Its M04 assertion follows the successful dispatch observations. Its account is deliberately null and its dispatch mode is `NOW`; this case does not claim native first-account or queued-settlement execution.

M05 module reads preserve the actual owner access and post-await validation. Disabled retained records remain reviewable; enabled empty storage reports `EMPTY`; retained records or tombstones report `AVAILABLE`; a project-less thread has no invented scoped URL. A bare SourceWorkbench without an owning reader remains `UNSUPPORTED`. Account or project changes during the awaited owner read reject, and unexpected reader failures propagate. Module metadata does not expose memory text or create source captures, preparations, or sends. Existing first-use memory storage initialization remains owned by M05; `readOnly` is not a claim that initialization performs no physical writes.

The shared-composer test uses the existing journal mock and parent-transport contract. After uncertain delivery and reconstruction of the composer, it retries the original command identity, authored text, `requestContextId`, source reference and `AFTER_CURRENT` mode, while preserving later edits and later source state. It does not stop the active run. This is source-level retry coverage, separate from real browser IndexedDB and host dispatch.

### Actual-App memory behavior

The three initial memory-review browser cases all stopped at the original five-second assertion for a missing `Open memory review` button. Their later source, mutation, focus, and owner assertions receive no credit in that red run. The new launcher reuses `ProjectMemoryReview` behind its existing lazy import and adds an explicit read-only mode. Accepted, Proposals and Conflicts remain inspectable, including exact older conflict source revisions; configuration and all edit/accept/reject/expire/forget/conflict actions are disabled and guarded.

The four-case green execution verifies a held memory preparation while the task becomes working, then an enabled explicit queue action. The exact `message.send` carries the original preparation token, selected source and `AFTER_CURRENT`; the authored text and source remain until the held acknowledgment settles. Exactly one ordinary command is accepted, and no stop or memory mutation is issued.

The review cases verify an exact item/revision/source-ref/digest read, inert source text, disabled mutations, and stacked shared-Modal focus: Escape returns first to the memory launcher, then to the Sources and evidence opener. Authored text and source draft remain identical. `DISABLED` retained records and an `EMPTY` current-owner module can both open for reading.

During an account change, the old in-flight source request is canceled. The retained attachment records `net::ERR_ABORTED`; fixture fulfillment is not proof that its old response reached application code. A separate reopen deliberately supplies an old-account envelope to the new owner, and the actual M05 client rejects it. These are distinct assertions.

The browser harness uses the real App and typed deterministic source/memory HTTP. It does not establish backend authorization or native/provider execution. The owning-host tests above provide separate source-level evidence.

### Workspace opener

The initial ordinary new-conversation case found two buttons with the exact accessible name `Open workspace panel`; the pinned native-thread case passed. Restricting the additional Chat header opener to `pinnedThreadId && !embeddedThreadId` removes the ordinary duplicate and retains the pinned control. Both cases then pass their original count, opening, closing, composer identity, draft and focus assertions. The native bridge in this test is scripted.

## Broader integration results and browser correction chain

| Recorded command | Cut | Actual result | Retained evidence |
| --- | --- | --- | --- |
| `c4-host-regression-01` | `692fe4b7` | **PASS: 291 passed, 2 Windows-only skips**, 20 files | [Receipt](m15-logs/c4-host-regression-01.json), [results](m15-artifacts/c4-host-regression-01/results.json) |
| `c4-workbench-app-regression-01` | `692fe4b7` | **PASS: 26/26** | [Receipt](m15-logs/c4-workbench-app-regression-01.json), [results](m15-artifacts/c4-workbench-app-regression-01/results.json) |
| `c4-project-memory-regression-01` | `692fe4b7` | **PASS: 15/15** | [Receipt](m15-logs/c4-project-memory-regression-01.json), [results](m15-artifacts/c4-project-memory-regression-01/results.json) |
| `c4-desktop-regression-01` | `692fe4b7` | **FAIL: 26 passed, 4 failed** | [Receipt](m15-logs/c4-desktop-regression-01.json), [results](m15-artifacts/c4-desktop-regression-01/results.json) |
| `c4-desktop-error-roles-01` | `f542de94` | **PASS: 3/3 selected cases** | [Receipt](m15-logs/c4-desktop-error-roles-01.json), [results](m15-artifacts/c4-desktop-error-roles-01/results.json) |
| `c4-usage-chromium-initial-01` | `692fe4b7` | **FAIL: configuration load, zero tests executed** | [Receipt](m15-logs/c4-usage-chromium-initial-01.json) |
| `c4-usage-chromium-initial-02` | `692fe4b7` | **FAIL: 9 passed, 6 failed** | [Receipt](m15-logs/c4-usage-chromium-initial-02.json), [results](m15-artifacts/c4-usage-chromium-initial-02/results.json) |
| `c4-usage-chromium-corrected-01` | `f542de94` | **FAIL: 13 passed, 3 failed**, including the new negative fixture | [Receipt](m15-logs/c4-usage-chromium-corrected-01.json), [results](m15-artifacts/c4-usage-chromium-corrected-01/results.json) |
| `c4-usage-owner-chromium-01` | `a2a3c75f` | **PASS: 16/16** | [Receipt](m15-logs/c4-usage-owner-chromium-01.json), [results](m15-artifacts/c4-usage-owner-chromium-01/results.json) |
| `c4-workspace-chromium-initial-01` | `692fe4b7` | **FAIL: 47 passed, 1 failed** | [Receipt](m15-logs/c4-workspace-chromium-initial-01.json), [results](m15-artifacts/c4-workspace-chromium-initial-01/results.json) |
| `c4-workspace-chromium-corrected-01` | `f542de94` | **PASS: 48/48** | [Receipt](m15-logs/c4-workspace-chromium-corrected-01.json), [results](m15-artifacts/c4-workspace-chromium-corrected-01/results.json) |
| `c4-layout-chromium-initial-01` | `692fe4b7` | **FAIL: 13 passed, 2 failed** | [Receipt](m15-logs/c4-layout-chromium-initial-01.json), [results](m15-artifacts/c4-layout-chromium-initial-01/results.json) |
| `c4-layout-chromium-corrected-01` | `f542de94` | **PASS: 15/15** | [Receipt](m15-logs/c4-layout-chromium-corrected-01.json), [results](m15-artifacts/c4-layout-chromium-corrected-01/results.json) |

All executed Playwright runs in this table report zero skipped cases, zero flaky cases and zero report-level errors. Each correction was executed once on its new recorded cut. The failed configuration attempt executed no tests. The host result's 32 aggregate suites include nested suites; the report contains 20 actual file results. Its two skips are retained-file grant revocation and first-file account custody on Windows. The Linux unsupported-leaf negative executed. These skips are not native success.

### Desktop errors and the initial cold-close failure

Three desktop failures stopped at `alert` selectors while their expected error text was rendered with `status`. The narrow product corrections changed the actual error presenters in App, DesktopEntry and DraftTransfer to `alert`. The selected rerun passes all three cases, including the guarded editor state and pending-signature export behavior. Success messages keep their existing status role. This selected result does not replace the failed complete desktop run.

The fourth failure is behavioral: an untouched, unrecovered composer with injected IndexedDB and staging failures returns `false` from the native close callback where the test expects `true`. The callback completed in about 71 ms after the disabled composer and recovery-failure alert were observed, so this is not an assertion timeout. Source review attributes the new refusal to unconditional source-draft reads in both the App and SourceWorkbench handoff guards, before an otherwise empty journal flush. Fixing only one guard would leave the other refusal.

That fixture performs no source selection, and its workbench endpoints return 404. It proves an unavailable/no-local-source path rather than an authenticated Service `enabled:false` response. The correction boundary must preserve refusal whenever retained source state, a local source operation or an uncertain input is owned. Neither a feature toggle nor a caught storage error proves absence. The original browser failure is retained. Phase A and Phase B observations follow. Final02 later passes this original cold-close case while its complete desktop command still fails five other cases, as reported above.

### Native handoff Phase A retained red

`c4-source-handoff-initial-01` ran `tests/source-handoff-v3.test.ts` and the unchanged `tests/editor-handoff.test.ts` with one Vitest worker. It failed: **11 passed, 12 failed, zero skipped**, across 23 cases in two files. The new source-handoff file has 20 cases; all three unchanged editor-handoff cases passed. The [receipt](m15-logs/c4-source-handoff-initial-01.json) and [results](m15-artifacts/c4-source-handoff-initial-01/results.json) bind it to `fe8a782f` after verified execution.

Phase A adds metadata observation and extracts the strict helper, with no cold-owner allowance. All 12 observed failures are behavioral assertions. They include refusal of an explicitly untouched failed-recovery owner, handoff completion before pending hydration or a first single/many CAS has settled, failure to retain failed operation/import obligations, a same-registry-handoff import commit failure being acknowledged, and an ordinary failed draft generation not persisting as expected. These Phase A results alone do not establish a repair. The later Phase B unit result and final02 browser failures remain separate observations.

### Phase B unit result and its measured limit

The [Phase B command](m15-logs/c4-source-handoff-policy-01.json) passed all 25 cases in two files at cut 4ce32ce1: 22 source-handoff cases and three unchanged editor-registry cases, with no skips. The [results](m15-artifacts/c4-source-handoff-policy-01/results.json) include two concurrent same-owner schedules. The concern did not reproduce under those schedules, so no coalescing change was made at that stage.

The policy tracks journal recovery and local-work obligations rather than inferring absence from a storage exception. A cold allowance requires all original source/text/pending reads to have failed, with no successful read, acquired record or locally attempted work. Pending hydration, first CAS, import and failed-operation obligations remain barriers; acknowledged persistence owns their release. Source and composer values remain in the existing journal. The final02 browser attempts and asynchronous empty-owner diagnostic later expose a missing scheduling case despite these passing unit assertions. The 25-case pass therefore does not establish complete handoff correctness or native-close acceptance.

### Workspace selection synchronization

The failing workspace test clicked B and immediately filled the first Message textarea. The trace shows that fill resolving against A while canonical B placement was completing; A subsequently became hidden and B remained empty. The test had not authored B or reached its original later draft assertion. The correction awaits B's selected tab and its scoped visible, enabled composer before filling. It retains the original draft, All Agents return, command and deadline assertions. The complete 48-case rerun passes.

### Popup geometry

The two saved-layout failures measured rows at approximately `31.99517059326172` and `31.999969482421875` pixels against the unchanged minimum of 32 pixels with the popup's 180 ms entrance animation still unsynchronized. Trace timing and the declared scale animation support the motion explanation; the exact computed transform was not captured. The correction awaits the actual finite popup entrance animations before measuring. It does not round, lower the threshold, replace the geometry assertion, add a sleep, or change the interaction deadline. The complete rerun passes both strict measurements and their subsequent keyboard, screenshot and focus assertions.

### Usage readiness, legacy restoration and focused ownership

The initial Usage run exposed six failures: two shell error-role assertions, an obsolete `dd` expectation in a conditional UsageFooter branch, two ordinary legacy-Usage restoration cases, and the mobile test's first input readiness assertion. The mobile trace stopped before its first API request while the dev module graph was loading. Its corrected setup registers and waits for the actual successful initial snapshot response, then keeps the original five-second enabled assertion and 15-second overall test budget. Passing this functional setup does not establish a five-second cold-start performance threshold.

The legacy restoration repair uses explicit ordinary-chat eligibility and waits for canonical conversation layout before capturing the owner. It still excludes custom dock/canvas and pinned, embedded, navigation or plugin-owned modes. The new negative fixture restores an open remembered Usage tab in an explicit split workspace: no Usage modal may open, the saved tab must normalize to notes, both isolated composers remain editable, and no ordinary send/create command may occur.

The first corrected full run remained failed at 13/3. One failure was a mutable iframe title: Tooltip had adopted `title="Studio"` into its tooltip attributes while the same frame and Studio region remained mounted. The stable region-scoped iframe locator preserves the actual frame-retention assertion. The new split-negative fixture had stopped inside shared setup because responsive folding hid A while the workspace panel was open. Its deliberate 1920px viewport establishes the two-visible-composer prerequisite; the intended no-modal, normalization, isolated-draft and zero-command assertions remain unchanged.

The remaining failure was a product owner mismatch. The exact B caption of 999 input tokens initially passed. Focusing B then published the canonical main placement of A while keeping B selected; the shared summary read A, and the Usage modal showed A's value of 7. The correction does not change canonical main placement, `thread`, provider ownership or native-return writes. WorkspaceSplitLayout reports its actual active view IDs through a stable layout effect. App validates those IDs against the current conversation plane, current threads and ownership, chooses eligible focused B, and uses only an eligible canonical owner as fallback. Removed, hidden, pending or detached owners cannot survive as stale shared-Usage ownership. Empty or replaced layouts reset that notification. The shared footer forwards the exact owner through `onOpenUsage={openUsage}`; ordinary and pinned/embedded footers retain their existing behavior.

The final 16-case run verifies B's exact 999 caption both before and after hide/show, then the unchanged B modal owner/value, reload-closed summary and both exact drafts. The Studio case reaches its original retention and no-create assertions. The split-negative case reaches all intended assertions. Hidden/detached/archived eligibility beyond those cases has static review evidence; this run does not claim separate native-transition execution for each predicate.

## Command, browser and deadline scope

Commands ran from `/workspace/scratch/1b47eb428672/m15-v3` with `/workspace/scratch/1b47eb428672/tool-bin` prepended to PATH, Node 24.22.1 and pnpm 10.30.3. Each command was wrapped by `node scripts/m15-record.mjs <unique-id> ...`; the linked receipt preserves its literal `argv`, cwd, executable identity, start/end times, exact exit and raw log digest. Playwright JSON reports and artifacts use the corresponding unique run directory. The first memory red JSON was moved to its intended artifact directory with its bytes retained; this was a report-destination correction, not an execution retry. Later JSON destinations are absolute.

| Selection | Exact command scope after the recorder |
| --- | --- |
| First source-handoff selection | `node node_modules/vitest/vitest.mjs run tests/source-handoff-v3.test.ts tests/editor-handoff.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/implementation/v3/m15-artifacts/c4-source-handoff-initial-01/results.json` |
| New host and shared composer | `node node_modules/vitest/vitest.mjs run tests/source-workbench-memory-v3.test.ts tests/source-composer-v3.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/implementation/v3/m15-artifacts/<id>/results.json` |
| Broader host regression | The [literal 20-file argv](m15-logs/c4-host-regression-01.json), covering source selection/host/composer/transfer/recovery, request preparation, compiler, accounts, M05 HTTP/service/lifecycle/deletion/storage/recall; `--maxWorkers=1`, default and JSON reporters |
| New memory App cases | `pnpm exec playwright test --config tests/e2e/workbench-app.playwright.config.ts --grep 'prepared memory and selected sources\|M15 memory review' --reporter=line,json --output docs/implementation/v3/m15-artifacts/<id>/artifacts` |
| Complete final02 and final03 App, desktop and renderer | Declared workbench-app.playwright.config.ts, desktop-surfaces.playwright.config.ts and workbench.playwright.config.ts, no case filters; line and JSON reporters; absolute JSON destinations and unique artifact directories |
| Complete App and existing memory | Their declared `workbench-app.playwright.config.ts` and `project-memory.playwright.config.ts`, without a case filter |
| Panel controls and desktop roles | Declared `desktop-surfaces.playwright.config.ts`; only the explicitly recorded two-case or three-case filter for the selected runs |
| Complete desktop | Declared `desktop-surfaces.playwright.config.ts`, no filter |
| Usage, workspace and layout diagnostics | Absolute private `.chromium.playwright.config.mts` wrapper, inherited declared selection, no case filter, `--reporter=line,json` and unique artifact output |

The declared Usage, workspace-host and saved-layout configs select `msedge`, which is unavailable locally. The private wrappers change only the channel to Chromium and resolve `testDir` to the original absolute directory; all deadlines, test membership, viewports, fixtures and server commands remain inherited. The first external `.ts` wrapper failed configuration loading before collecting tests. Its failed receipt remains. The `.mts` infrastructure correction uses a new run ID and is not a failed-test retry.

| Private diagnostic | Declared config SHA-256 | Wrapper SHA-256 | Original overall test budget |
| --- | --- | --- | ---: |
| Usage integration | `d9537fb08383c2d0bff2ce90db83d6a4e98a40a57d2e573595be67ed1a8a1673` | `e23788dc8b3e81937f80b67a6e67788bb564ec82a442d2740c121a82bb514f80` | 15 s |
| Workspace host | `00ed403cf5ff103af97519e45e910c0003db11e7062bf6f49bc2b948cb13c30e` | `031174af822fe8a5889c054dbb760b68d3677658fb9c95d28b21035f02766b96` | 20 s |
| Saved layout | `43898e25e3781aaeaa659a786281c384b3db7ef7bf2ee7ee34d4d0d6d888b037` | `35a38fe8afe5fd3d35fe887898986c638b901051c8bb29509b5451cfb6f79de2` | 15 s |

The local browser is Chromium; Playwright package 1.56.1 is distinct from browser version 141.0.7390.37. The private runs establish no Edge result. The desktop fixture uses a scripted bridge and establishes no installed-desktop result. The source-level recording runtime and synthetic renderer fixtures establish no external model/provider result.

## Historical terminal C3 Windows evidence

The admitted [terminal summary](m15-artifacts/c3-windows-run-43797606300-attempt-1/terminal-results-summary-01.md) and [structured record](m15-artifacts/c3-windows-run-43797606300-attempt-1/terminal-results-summary-01.json) bind run `43797606300`, attempt 1, to exact C3 commit `3f68a8f1bc1ca5a588862571d905163861e94492` and tree `be7e206431f13b654b6aecd7c12c23d0e4b2dfdb`. Its GitHub conclusion is **failure**. The accepted paired root base is `49cd633273a3f61c14a4191a9877e99ab23ec88f`, tree `2ecdb4c95fc6b604159257a125064ad585b966e5`.

| Actual C3 Windows group | Passed | Failed | Skipped | Outcome |
| --- | ---: | ---: | ---: | --- |
| Full repository, four shards | 3,604 | 0 | 46 | PASS |
| Focused native contracts | 326 | 0 | 1 | PASS |
| Fifteen named Playwright commands plus enabled split command | 302 | 29 | 0 | FAIL |
| Complete root, accepted base49 | 30 | 82 | 1 | FAIL |
| Complete root, C3 candidate | 31 | 81 | 1 | FAIL |

The full shards cover 345 distinct files with no cross-shard file overlap. Their 46 skips include 37 guarded split cases; those 37 separately passed with both activation flags and explicit installed Edge selection. The native group includes actual Windows leaf guard, Python/ACP and Hermes session execution with a scripted model transport. Its one skip is the Linux-only unsupported-leaf negative. The native selection overlaps the full suite and cannot be added as unique coverage.

| C3 named browser command | Passed | Failed |
| --- | ---: | ---: |
| Agents actual App | 20 | 0 |
| Artifact acknowledgment | 1 | 0 |
| Workbench renderer | 17 | 1 |
| Workbench actual App | 22 | 0 |
| Saved drafts | 27 | 0 |
| Chat view modes and direct Escape/IME | 6 | 0 |
| Scoped conversation | 15 | 0 |
| Shared overlays | 15 | 0 |
| Shared controls | 18 | 0 |
| Usage/context | 24 | 0 |
| Agents workspace | 22 | 0 |
| Workspace host | 47 | 1 |
| Saved-layout chooser | 13 | 2 |
| Usage/App/shell/mobile | 7 | 8 |
| Desktop surfaces | 11 | 17 |
| Enabled split command, separately executed | 37 | 0 |

The paired root commands collected the same 113 identities. All 81 candidate failures also failed on base49; one older-snapshot artifact-acknowledgment case failed on base49 and passed on C3. This is paired outcome overlap. It does not prove identical failure causes, make either root command pass, or eliminate the need to validate later C4 source.

All seven downloaded archives passed the unchanged sealed byte/metadata/source/receipt validator; all 23 required command receipts were present and 602 archive members were retained with hashes. That is custody validation, not a change to failed command or job status. Named suites retain their configured channels; desktop-surfaces is Chromium with a scripted native bridge, not installed desktop.

The separate C3 assertion audit attributes only the four reviewed alert/status first failures and the stale Usage `dd` assertion. Later assertions in failed cases remain unexecuted. The clipboard failure has no retained trace or actual clipboard bytes, so that archive cannot establish CRLF as its cause. The saved-layout subpixel measurements alone do not establish a persistently undersized control. Subsequent C4 observations and repairs have their own source cuts and do not retroactively alter these C3 failures.

## External publication history remains failed where recorded

[Preservation record 01](m15-artifacts/c4-external-preservation-01.json) retains 20 distinct historical receipt versions and the exact C3/0f publication metadata. [Preservation record 02](m15-artifacts/c4-external-preservation-02.json) adds exact 364 and 082 archives and a uniquely named copy of the earlier 0f full command. Receipt normalization changes only `boundedLogRef`; original argv, timestamps, exit, status and log bytes remain intact.

| Archive containing the external record | Recorded command | Actual recorded result | Raw receipt SHA-256 |
| --- | --- | --- | --- |
| `0f487aa8` | `pnpm test:no-lease` | **FAIL: 4,038 passed, 59 failed, 48 skipped**; 23 failed files | `c308ee76e3586cde4dfc76f2ca30e5dd832a58aa5258f12be4ffe12f4d564fc4` |
| `364d3f55` | `pnpm test:no-lease` | **FAIL: 4,030 passed, 68 failed, 48 skipped**; 25 failed files | `49df0d53de454a9a108a66770e8fcfac0cfedbbf6ffa6a31a2969ffdec8b6d27` |
| `08226487` | The same retained `pnpm test:no-lease` attempt | **The same FAIL**, not another execution | `49df0d53de454a9a108a66770e8fcfac0cfedbbf6ffa6a31a2969ffdec8b6d27` |

The 0f archive also includes a passing focused selection of 112 cases with one skip; it does not replace its failed full command. The 364 and 082 copies have identical start/end times, receipt and log digests. Their validation summaries report integrity PASS and bundle FAIL. Recorded failures include actual 60-second test deadlines and an EBUSY cleanup error; this draft does not assign a single unproven environmental cause to their complete failure sets. These archived records do not establish exact-current C4 validation.

External `082264877e3bb61e8c87f257ccd831b5c1438472` also retains a separate Linux `pnpm test:no-lease` execution, distinct from its retained Windows full-suite attempt. Its [raw receipt](m15-artifacts/external-publication-cut-0822648/m15-logs/reconcile-linux-vitest.json) records `/root/gen-v1-linux`, executable `/root/node24/bin/pnpm`, `2026-11-16T04:09:14.000Z` through `04:12:16.000Z`, **FAIL with exit 1**. The [raw log](m15-artifacts/external-publication-cut-0822648/m15-logs/reconcile-linux-vitest.log) reports **3,644 passed, 306 failed, 196 skipped and four unhandled errors**, across 373 files: 307 passed, 61 failed and five skipped. Receipt SHA-256 is `34ecebc2743f49c96a6e1c25579f07856b1552e98929bd6f3106c0bfca8a8c1a`; log SHA-256 is `4c65db170b3ad6e65d935a44ea1e13f412d2f37e39b4070c58ad77fdecede0fd`. The retained failures include Linux file-access refusals, other assertions and unhandled errors; this record does not establish one common cause for all 306 failures. Historical narrative claims of parity or PASS do not change the raw outcome, establish exact-current C4 validation, or supply a paired accepted-base comparison. This is an additional failed execution, not a duplicate of the Windows receipt or part of C3's exact-head Windows run.

## Remaining gates and retained boundaries

Final03 passed the three complete declared local browser suites and the final 28-file host, typecheck, build and UI policy selections. The earlier final02 App/desktop failures and both normal asynchronous unit-red attempts remain retained. The two historical startup causes remain unclassified despite the later pass. No result is inferred for a later source change or command.

Exact-head C4 Windows/Edge, a current complete repository aggregate, installed-desktop proof, packaging/controller, publication and activation are not established here. Later receipts must append their actual identities and outcomes. C3 and external Windows/Linux records remain historical, with their raw failures intact. Earlier private Chromium Usage/workspace/layout runs retain their earlier cuts and establish no current Edge result.

The feature defaults remain covered by the explicit default-off host test. Memory review does not authorize edits, source text does not grant execution authority, and the module adapter does not bypass owner/account/project/working-copy checks. Retained reads and rollback behavior remain subject to their existing source and admission fences. Unsupported native file custody on Linux, installed desktop and external provider behavior are not established by local browser passes. Rollback with current default-off code preserves retained references; binary downgrade to earlier code without the new sourceAccountAdmission witness can fail closed and does not silently migrate legacy authority.
