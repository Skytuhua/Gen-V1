# M15 C3 regression and evidence review

## Current cut and disposition

C3 reconciles incoming published C2 `a1349b0a7ffa1420566da9c7770faf80d6be5bf3` (tree `3c33aa40a916205f7bf3ac390b5881d1ab5030de`) with accepted main `49cd633273a3f61c14a4191a9877e99ab23ec88f` (tree `2ecdb4c95fc6b604159257a125064ad585b966e5`). The App/public-source manifest conflicts are resolved in the working tree. No final C3 commit/tree or complete acceptance result is asserted by these local executions.

Later main `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73` was observed during publication preflight. C3 keeps accepted base `49cd633`; this ledger does not claim reconciliation or runtime compatibility with that later cut.

**C3's current local assembly has integrity PASS and bundle status PARTIAL; the complete App run passes 22/22 after one activity-test canonical-placement wait was corrected.** Product App, editor handoff and native fixture are unchanged. Original App FAIL21/1 and instrumented diagnostic FAIL20/2 remain retained; the original native-return failure remains unexplained. Build, typecheck03, prerequisites, UI policy, workspace, focused source, public packaging and custody checks pass at their stated cuts. The post-receipt assembly measures 216 command records, 892 artifact hashes, 72 implementation files and 970 changed paths, with no reported issues. Remaining affected-browser, full-repository, root-comparison and actual-target acceptance is incomplete. `ui.sourceWorkbenchV1` and `reviewerApproval` remain false. Static review is limited to the inspected source/questions; it is not full independent approval of the merged patch.

## Observed C3 commands

Every row below was checked against its actual receipt and bounded-log digest. A receipt's PASS means its command exited 0 normally; it is not a substitute for unexecuted gates. Failed attempts remain failed after later remediation. This table records executions only, not proposed commands.

| Receipt | Observed result | Execution scope |
| --- | --- | --- |
| `c3-main-merge-01` | FAIL, exit 1 | `git merge --no-commit --no-ff 49cd633...` encountered conflicts in App.tsx and public-source-files.json. Root subsequently resolved them. The original nonzero receipt is retained. |
| `c3-final-build-01` | PASS, exit 0; 15.132 seconds | Initial conflict-resolved C3 `pnpm build`, including web/widgets/plugin runtime. It precedes later C3 test corrections and is not promoted to those later bytes. |
| `c3-core-prerequisites-01` | PASS, 72 passed, 0 failed, 0 skipped; 6 files | Research baseline, regression selection, M01/M02 compatibility, tool authority/effects and effect recovery at the initial C3 cut. JSON success is true. |
| `c3-final-ui-policy-01` | PASS, 527 sources, 0 violations | Unchanged 39-entry legacy/geometry inventory, with zero retired entries. Inventory entries are not primitive approvals. |
| `c3-workspace-contracts-01` | PASS, 17 passed, 0 failed, 0 skipped; 4 files | Workspace layout 10, project-context owner 2, research service integration 4, plugin-visuals retirement 1. |
| `c3-native-return-01` | PASS, 1 selected case; 11.069 seconds in the case | Real App with scripted browser desktop bridge and HTTP. Two owner-bound captures, cancellation, canonical return after layout readiness, unchanged A/B drafts and zero ordinary `/api/commands` calls. Canonical split commands still perform placement. Initial fixture source only. |
| `c3-layout-source-01` | FAIL, 1 failed, 47 filtered exclusions | Test expected a raw JSON substring inside a correctly escaped source envelope. Owner/capture/M04 checks before that assertion passed. Original source and failure remain retained. |
| `c3-layout-source-02` | PASS, 1 passed, 47 filtered exclusions | Corrected exact envelope parse. Actual Store/Service/M04 preserve artifact custody across legacy profile apply/select before and after first admission; new retired presets reject. Recording runtime only. |
| `c3-final-typecheck-01` | FAIL, exit 2; 4 TS2352 diagnostics | All four diagnostics concern casts to the new fixture's Window extension requiring `__m15NativeCalls` before initialization. The failed fixture source is retained; a corrected run remains separate. |
| `c3-final-typecheck-02` | PASS, exit 0 | `pnpm typecheck` after the fixture initialization contract correction. No product App change. |
| `c3-final-focused-01` | PASS, 335 passed, 0 failed, 3 Windows-only skips; 24 selected files | Complete selected source/composer/draft/recovery/output/ownership/request/Hermes/plugin-frame file set. 23 files passed; the Windows-only Hermes source file was skipped. No unhandled error was reported. |
| `c3-workbench-app-01` | FAIL, 21 passed, 1 failed, 0 skipped/flaky; no runner error | Complete 22-case App run on the corrected fixture. New native-return case receives `aria-selected=false` for A at its original 5,000 ms post-layout assertion. Queued-delivery guidance/exact refs and all other cases pass. Attribution remains unresolved. |
| `c3-workbench-browser-01` | PASS, 18 passed, 0 skipped/unexpected/flaky; no runner error | Complete standalone workbench configuration, including selection, scrolling/zoom, full-read fixture, delayed-owner/query rejection, journal/recovery and controlled renderer cases. |
| `c3-native-return-diagnostic-01` | FAIL, 20 passed, 2 timed out, 0 skipped/flaky; no runner error | One complete instrumented App run. Native return passed. Activity reloaded before A placement; stale-recovery final action began after whole-test teardown. All four instrumented files were restored exactly. No native repair or common product cause established. |
| `c3-activity-sync-full-01` | PASS, 22 passed, 0 skipped/unexpected/flaky; no runner error | Complete App run after only the activity test observes canonical Other selection and A-placement response/selection before reload. Original assertions and deadlines retained. Product App, handoff and native fixture unchanged. |
| `c3-final-typecheck-03` | PASS, exit 0 | `pnpm typecheck` after the final activity-test correction, ending `2026-11-16T02:52:29.483Z`. Same output bytes as typecheck02, separate execution receipt. |
| `c3-final-package-01` | PASS, 11 passed, 0 failed/skipped | Complete `tests/public-source.test.ts` before packaging-intermediate relocation. Initial PASS remains retained. |
| `c3-final-custody-01` | PASS, exit 0 | Clean original checkout, fixed lock/ordinary CI, exact 16/17-file archives, 709 published evidence paths unchanged and explicit source admission at the initial cut. |
| `c3-final-integrity-01` | PASS, integrity PASS / bundle PARTIAL | Initial assembly measured 212 command records, 1,002 artifact hashes, 72 implementation files and 960 changed paths. It included 120 ignored generated Vite cache files later retained outside the repository. |
| `c3-final-package-02` | PASS, 11 passed, 0 failed/skipped | Complete public-source suite after explicit metadata-only export reconciliation and intermediate relocation. Runtime admission remains 216 entries. |
| `c3-final-custody-02` | PASS, exit 0 | Same custody command after reconciliation: original checkout clean, fixed lock/ordinary CI, exact 33 archived files and all 709 published evidence paths unchanged; 3,214 source/216 runtime entries. |
| `c3-final-integrity-02` | PASS, integrity PASS / bundle PARTIAL | Recorded assembly measured 215 command records, 890 artifact hashes, 72 implementation files and 968 changed paths. Its own receipt/log were finalized afterward; the subsequent assembly includes them and measures 216/892/72/970. |

| Receipt | Retained log SHA-256 |
| --- | --- |
| `c3-main-merge-01` | `17164221e1881521d802f41018f11e7491e0e0ee44fa47af878190fc19ab434b` |
| `c3-final-build-01` | `08aece2ef5416332d4e84c80e76b3df88fdec86e23e4670b6192d08649e7ee58` |
| `c3-core-prerequisites-01` | `22908c252a89c61d34b9faf5388ad3b6c964fcfda9453417fbca147f0371eb9c` |
| `c3-final-ui-policy-01` | `0231d5e399f59f53accaf2c7ead21da7c44e5bf6e9857282f6702cf809fb2297` |
| `c3-workspace-contracts-01` | `6d04a1c4220d04ecf4c26e3031536b3d008ab866d49352f1429504ff00a35ac2` |
| `c3-native-return-01` | `af50001f2310ce02d022ec8c5fdc7383c6913d8ab43677dfa471567ec3623473` |
| `c3-layout-source-01` | `b9a1edf3693a3a062fd8eaeda10d221bf4c40387e89369478454f389ce4b1442` |
| `c3-layout-source-02` | `4df7fb4e68dc52de32ae591fb96b5ad08e83748c6edf9e8ac0ea559144d27736` |
| `c3-final-typecheck-01` | `6661a43f7b02ab48fd80369c166ff1a6fd793ac018719ca35e7a5c7ad1ba8ae0` |
| `c3-final-typecheck-02` | `e9a201c2479a7028e4074b54c117b9e7909d92bcf7db8fba5d879c57845b4c04` |
| `c3-final-focused-01` | `57bc5e7a3481a001e1039af873f3374a410529eb9d069ecc92de08676537ee71` |
| `c3-workbench-app-01` | `e999847ef342e312f1d302884204140bfab84d6beba28e970cf9abab9d19dae2` |
| `c3-workbench-browser-01` | `aa04eb875b89ddb4aa74a61fb312ba474a6f2d8a7fdad60ab48ca9c6315e35b9` |
| `c3-native-return-diagnostic-01` | `52033ae9a880a57360a1fd9790e9c81ebfed5e4ea0fa70ee7dfc900cd49e6548` |
| `c3-activity-sync-full-01` | `150f5838ba3334eaabbdaf164102cd8e069a278da36057c195e46f8e867b5f0c` |
| `c3-final-typecheck-03` | `e9a201c2479a7028e4074b54c117b9e7909d92bcf7db8fba5d879c57845b4c04` |
| `c3-final-package-01` | `ba755d429c17801d6141b9f3e8e5f30fe32bd69435350321cc60e53d4cb4a4ae` |
| `c3-final-custody-01` | `1860d2c7d9e239c4833a117a8f8a2f3596894043b8f4f0b346ae48624cf2d109` |
| `c3-final-integrity-01` | `355988a24802067349d6815722c4c223baed3dfcac000e7d2d68945ba4161521` |
| `c3-final-package-02` | `7621899cfe6c64a2e240cecf9086777060dd6e17e8df440071c628ee14376b79` |
| `c3-final-custody-02` | `75746fac447e5e62e3b8eb58fbd4d1bda8586ba5307847ead89338d6e49fc5fb` |
| `c3-final-integrity-02` | `9a82347a6e70acbd23d1606ca4a7c67669aea653f44dd5f19610659b218f2dbc` |

Receipts/logs are under `m15-logs/`; Vitest JSON uses `m15-artifacts/<receipt>-results.json`. Native-return JSON, source digests, decoded attachment and trace are under `m15-artifacts/c3-native-return-01/`. Suite counts in Vitest JSON include nested describe blocks and must not be called test-file counts. Suites can overlap and must not be summed into a unique total across commands. The 47 name-filter exclusions in each selected host run are not executed passes or evidence that platform-gated bodies ran.

## Scope of the new regression evidence

The selected native-return attachment records the held A description as fulfilled by the fixture while also recording the client's `net::ERR_ABORTED` failure after switching to B. It proves cancellation and owner isolation, not delivery of an uncancellable stale response. Its three A/B journal reads are identical, both UI-created captures retain their distinct thread/working-copy owners, return intent waits for the held canonical layout read, and A's `split-workspace.view.open` follows release. The ordinary `/api/commands` list is empty, including `message.send`, `thread.create`, `run.stop` and `run.resume`; canonical split commands are recorded separately. The incoming C2 HEAD in `source-cut.json` is accompanied by actual C3 per-file digests; that HEAD alone is not the tested working-tree identity. No installed desktop ran.

The first complete App run uses corrected fixture `73b87d3a1f3a46978052777c2cac2335928f447f2ba93ff6a718e7e6267e7ffb` and retains its own source cut, JSON and failed trace under `m15-artifacts/c3-workbench-app-01/`. Its new case fails before final A restoration: A's tab remains `aria-selected=false` through the original five-second expectation after layout release. The case lasts 12.807 seconds within its 30-second deadline, so this is not teardown-interrupted evidence. All other 21 cases pass. No cause, native repair or baseline attribution is established, and later passes do not rewrite this failure.

The [diagnostic analysis](m15-artifacts/c3-native-return-diagnostic-01/analysis.md) records FAIL20/2 on a temporary instrumented source cut. Native return passed in 9.501 seconds; all 65 observed post-reload IndexedDB transactions and 79 requests completed. That successful trace does not identify the unfinished stage in the original failed run. The activity case reloaded 16.736 ms after the back-to-A click ended, before any A placement POST; the reloaded canonical layout correctly retained Other. Its hidden A activity click then timed out. The stale-recovery final action began 1,316.430 ms after whole-test teardown, so it does not prove lost data or a failed recovery response. No common product or IndexedDB cause was established. The exact restoration record and both versions of all four instrumented files remain retained.

The resulting correction changes only the activity case in `tests/e2e/workbench-app.spec.ts`: require Other selected, await the actual A `split-workspace.view.open` HTTP 200 response with focused active A, then require A selected and visible before reload. Existing mounted-row, full-read search, retained-row and reload assertions stay unchanged, as do the 30-second test and five-second expectation deadlines. The new response wait is also five seconds. Spec SHA-256 changes from `ef9c4c806be3f007830e08fd85f2c6d64c86fe4e6bda4fcf911ef4d153ac4feb` to `8d04a76f53259f4b6778b01d0d59509a1c6f7cd509bb5fdfecb903e3963e4449`; App remains `9eb5a0241349cdf64c6860b63080fea3ca29c155dd1c6ffed7ccf6a6cf7e3ee4` and the native fixture remains `73b87d3a1f3a46978052777c2cac2335928f447f2ba93ff6a718e7e6267e7ffb`.

The [current complete validation](m15-artifacts/c3-activity-sync-full-01/validation.md) passes all 22 cases with no skips, flaky cases or runner errors. The corrected activity case passes in 7.290 seconds, unchanged stale recovery in 6.809 seconds and unchanged native return in 8.193 seconds. Results SHA-256 is `9304ea4cdb6c7f270fb61a7c1ad13194695c8c5b99502b3dfa1c7fcfa8da2444`; source-cut SHA-256 is `8860104046438ce94f9543f5d454b64873803cff1424212cf35d815c93594226`. All six recorded source files still matched at review. The native attachment preserves exact A/B drafts and two captures, cancelled old-owner work and A placement after layout release, with zero ordinary `/api/commands` requests and separate expected canonical split commands. Passing cases have no retained traces under the unchanged retain-on-failure configuration; the JSON and decoded native/zoom attachments remain. This validates the current Linux browser cut, not a native-return product repair or actual Windows/installed-desktop execution.

The layout regression shares one actual Store between Service/M04 and WorkspaceRepository. It measures directory identities but performs no native Git or file-guard execution. It captures a declared artifact before the first account-bound send, checks exact source bytes and immutable capture identity, applies/selects a retained Research profile before and after admission, and rejects new Research/Code Review/Custom presets without changing custody or creating input. `m15-artifacts/c3-layout-source-01-test-source.txt` preserves the failed assertion source at SHA-256 `c0a061494ba6a7c3c84fce0b75ae55e22d1627ff347bf79b96694c54ab01dbed`; the passing test file is `ebe41700ec8794fdee48791a37a50ebf7b5c809b8db00fabd5be98ea50e95281`. The correction requires one parsed source envelope with exact capture ID, source, version and text. It changes no product code.

The first typecheck's fixture bytes are retained at `m15-artifacts/c3-typecheck-01-native-fixture-source.txt`, SHA-256 `e33142f1fd7073d07f1508d78a1ac805f0b7b226864561fc1d51a4c361485ce5`. The correction models the calls property as optional until initialization, retains a typed local calls array and rejects uninitialized access explicitly. It does not weaken assertions or change product App code. The corrected fixture SHA-256 is `73b87d3a1f3a46978052777c2cac2335928f447f2ba93ff6a718e7e6267e7ffb`. Typecheck02 passes after that correction; typecheck03 passes after the final activity-test change. Neither result replaces runtime evidence.

The focused aggregate's three skipped bodies are retained-file grant reauthorization, first-file account admission through the native guard, and first-file source evidence through real Hermes/Python/ACP with scripted model transport. Their Windows-only guards prevented execution on Linux. The 335 passes include the corrected layout custody test and do not substitute for those skipped bodies or an unfiltered repository run.

The bounded read-only `c3-app-native-return-independent-review-01` found no material defect in its inspected App, source-owner, journal, split-placement, SurfaceBoundary and fixture paths. Its Markdown SHA-256 is `cf3b688349a9258148767b0718e4453b44e334d98f6d5a9c4200b300f4614e9a`; companion JSON is `8ddc6493526dd512db0a589b1c7ff73cc699163251029f13cb55c4e827b7655d`. It ran no jobs and makes no full aggregate or target-platform claim. Competing native focus intents and persistence/handoff failure retry are outside the new browser case; the reviewed native-return effect does not promise automatic retry of a consumed intent. A SurfaceBoundary retry also does not establish recovery of a cached rejected import or preservation of arbitrary descendant React state after a thrown render.

## Current gate status

| Gate | Required current evidence and limits |
| --- | --- |
| Host/source custody after workspace changes | The complete 24-file selected set passes in `c3-final-focused-01`, including layout custody and request preparation. Three Windows bodies remain unexecuted locally. |
| App reconciliation | Current `c3-activity-sync-full-01` passes 22/22 after activity-test synchronization. Product/native fixture unchanged; original App01 FAIL21/1 remains unexplained and diagnostic FAIL20/2 retains its instrumented source/attribution. |
| Affected browser configurations | Standalone workbench passes 18/18 and current App passes 22/22. Canonical ChatView and affected workspace/desktop/shared-control/recovery configurations still need current receipts with preserved assertions/deadlines. C2 counts are not reused. |
| Typecheck, build, UI policy and public packaging | Typecheck03 passes after the final test change. Build01 and UI policy01 retain their recorded cuts. Package02 passes all 11 public-source tests after metadata-only export reconciliation. |
| Full repository | Four actual complete Windows shards on one exact C3 head, with no file/name filters, retained command/source/JSON artifacts and explicit failures/skips/unhandled errors. Focused native tests do not replace this gate. |
| Complete root parity | Candidate and accepted base `49cd633` root runs, each on its own measured tree and locked setup, retaining both failures and case identities. Historical base `399cde3`/`138b135` evidence is not current-base parity. |
| Actual target | Windows native file/guard/Hermes and each declared Edge suite must run on the target. Mocked desktop bridges, scripted model transport and Linux skips remain limited. Installed-desktop handoff/history/DPI are separate. |
| Custody and evidence assembly | Custody02 passes. Post-receipt controller assembly has integrity PASS / bundle PARTIAL, 216 records/892 artifact hashes/72 implementation files/970 changed paths, no issues and reviewer approval false. Actual-target/full/root gaps stay open. |

## Local packaging, custody and controller results

Package01 and package02 each pass all 11 public-source tests, including exported entry resolution and admitted local import closure. Custody01 and custody02 both pass. The latter verifies clean original checkout `399cde39ff4ee82272c7a7700944325c44b36070`, unchanged lockfile and ordinary CI, zero unmerged paths, exact canonical archive membership and bytes for publication cuts 01/02, and mode/blob/current-byte identity for all 709 published artifact/log paths. The public manifest now has 3,214 source entries and 216 runtime entries; its eight added paths are relocation metadata and final02 evidence, not additional runtime dependencies.

Initial export reconciliation found 120 ignored Vite dependency-cache files in the new native-return, diagnostic and activity-validation output directories. The [relocation manifest](m15-artifacts/c3-artifact-intermediates-01.json), SHA-256 `eb8aa58f6318882ba4c7f606b812b3cf7e7414df45ab5185a9eb72c7bc0d6d1f`, records all 45,563,811 bytes and exact retained destinations outside the repository, plus six initial controller snapshots. All 120 retained lengths/hashes were verified. All 870 prior noncache artifact/log entries and 709 published paths remain unchanged. No authored source, result, receipt, log, trace, screenshot or source snapshot was moved. The ignored prebundles are reproducible packaging intermediates; their relocation changes no test outcome and does not narrow controller validation.

| Measured controller cut | Integrity / bundle | Command records | Artifact hashes | Implementation files | Changed paths |
| --- | --- | ---: | ---: | ---: | ---: |
| Recorded integrity01, before relocation | PASS / PARTIAL | 212 | 1,002 | 72 | 960 |
| Recorded integrity02, after relocation | PASS / PARTIAL | 215 | 890 | 72 | 968 |
| Post-receipt local assembly, including integrity02 receipt/log | PASS / PARTIAL | 216 | 892 | 72 | 970 |

Each cut uses source-lock digest `f4bb271eda17b4d47e005d44944f75f02c906cc5947bb4acac48bff8b524fa4a`, reports no integrity issues and retains reviewer approval false. The recorded commands cannot include their own receipt until child output closes; the subsequent assembly adds that actual receipt/log without changing the earlier measured records. Current [M15-validation-summary.json](M15-validation-summary.json) and the generated manifests hold the final local assembly. These counts establish internal evidence custody and membership, not actual Windows/full/root execution or a complete acceptance verdict.

## Current controlled renderer result

The `m15-renderer-performance` attachment in `m15-artifacts/c3-workbench-browser-01/results.json` is byte-identical to the [standalone renderer report](m15-artifacts/c3-workbench-browser-01/artifacts/workbench-M15-controlled-r-a899a-with-100-000-retained-lines/m15-renderer-performance.json): 9,436 bytes, SHA-256 `8b6d0fe0493bec2c3fc2212edbcb108a0442008c88f47510bd5fbd15e99dbc6f`. It measures a local selected-message control from trusted click-event capture to MutationObserver delivery. It excludes paint/presentation and uses an explicit fixture read-model stub; host authorization belongs to separate host integration tests. Both p95 values recompute from sample index `ceil(30 * 0.95) - 1 = 28`, the 29th sorted observation. No outlier is removed.

| Condition | Mounted rows | Measured samples | p95 |
| --- | ---: | ---: | ---: |
| Unwindowed reference | 100,000 | 30 trusted | 2,711.5 ms |
| Windowed candidate | 29 | 30 trusted | 4.3 ms |

Both use the same immutable 10,000-message-metadata / 500-task / 100,000-line fixture, three warmups before each measured condition, sequential unwindowed then windowed execution, no CPU/network throttling and no trace capture during measurement. The recorded environment is Linux, Node 24.22.1, Chromium 141.0.7390.37, headless 1280x800, with Vite and React development runtimes. This establishes the measured fixture's bounds and event-to-DOM timing only. It supplies no whole-App, live-provider, task-tree/timeline, native-history, paint, DPI or general-device result, and no cross-run speedup claim is made from the archived C2 numbers.

## C2 history retained without reclassification

The immutable [publication-cut-02 archive manifest](m15-artifacts/publication-cut-02/archive-manifest.json) identifies 17 original top-level documents and generated records. Their byte lengths and SHA-256 values were verified before current documentation changed. The archived summary records integrity PASS, bundle FAIL, 194 command records, 720 artifact hashes, 71 implementation files and 797 changed paths against accepted base `138b135`. These are C2 counts only.

| Historical C2 observation | Preserved interpretation |
| --- | --- |
| Final focused04: 334 passed, 3 Windows-only skips | Passing focused source at its recorded cut. The native bodies were not executed on Linux. |
| Final App/workbench/overlay/control/saved-draft suites: 21/18/15/18/27 passed | Separate corrected-source configurations with their own receipts. They do not validate C3's later App and workspace transitions. |
| Final ChatView green02: 5 passed, 1 failed | A completed original 5,000 ms input-readiness miss, not teardown interruption. Bootstrap started 3,915.830 ms into the runner expectation, and the correct composer is present in a snapshot 108.531 ms after the library expectation ended. Mount time and accepted-base runtime delta are not established. |
| Full repository test01: 3,344 passed, 271 failed, 56 skipped, 4 unhandled errors | Preserved pre-UI source cut. Observed categories include 188 file-access denials, 10 explicit dependency/executable failures and 73 assertions with unclassified cause. No blanket baseline label is supported. |
| Focused03 failed during concurrent build | Shared dist/web cleanup conflict is established; exact failed navigation response was not captured. Identical complete serial focused04 passed without source/test/deadline changes. |
| Controlled renderer | Windowed 29 rows, p95 9.9 ms versus unwindowed 100,000 rows, p95 901.6 ms with 30 trusted samples per condition. This is historical Vite/React fixture timing, not current C3 or whole-App/native performance. |

Full historical details are archived in `publication-cut-02/M15-c2-browser-regression-review.md`, `publication-cut-02/M15-final-review.md` and their original artifact/receipt paths. C2 trace attributions distinguish the genuine readiness miss from earlier assertions interrupted by overall-timeout teardown. Neither a later focused pass nor static byte equality rewrites an earlier broader failure.

## Exact-head CI design and ingestion boundary

The C3 v2 push-only workflow is applied byte-for-byte from the sealed proposal. The current `.github/workflows/m15-evidence.yml` SHA-256 is `b44f440617d959f913c8238bf88cd5c7bcc7fd93e2ee845a387f03d02560cd58`. It uses `agent/m15-v3`, exact `github.sha` checkout/source records, separate native/browser/root jobs and an independent four-shard full-repository matrix. V1 source/review bytes remain sealed separately. Ordinary `ci.yml` remains unchanged at SHA-256 `4ac906f2a1b060b47971267bab60f0b2b66fed846f3b71f9eabafc7cdc66dca2` and may test a different PR merge tree. A push run can provide exact branch evidence when later main drift prevents a merge tree; this does not excuse unresolved integration with a newly accepted base. Local application does not establish remote execution.

The [independent v2 workflow/ingestion review](m15-artifacts/c3-windows-workflow-ingestion-review-02.md) and [independent receipt/output-path review](m15-artifacts/c3-ci-v2-browser-path-review-01.md) found no material defect in their bounded static scopes. Their Markdown SHA-256 values are `5abd633bc335cce913034b87376ca37ddffaf27f5c01155eceded50639885050` and `eb60286ea96863ba7c5378b67d17cadbc5af01296aa623cc11157790d8e29bb4`. Neither ran Windows, PowerShell, Edge, a real connector transfer or a browser job. The split tests do not configure traces/screenshots; their planned retained evidence is the source record, Vitest JSON and recorder log.

The full matrix preserves existing pinned Python/Playwright setup, `pnpm build` and literal `pnpm test --maxWorkers=2 --shard=N/4` with JSON reporters. Each recorder launches absolute PowerShell for that fixed command and propagates `$LASTEXITCODE`. The package command still builds credential/widget assets before unfiltered Vitest. Native/browser recorder children use absolute Node paths. No assertion deadline, test-file filter or continue-on-error is introduced.

V2 adds five commands to the existing browser job, requiring 16 receipts total. Workspace-host and saved-layout-chooser use their declared Edge channel. The complete usage-app-integration configuration includes usage, shell-error ownership and mobile navigation, also on Edge. Desktop-surfaces retains its bundled Chromium configuration and scripted native bridge. One recorded PowerShell command runs both `tests/split-workspace-renderer.test.ts` and `tests/split-app-browser.test.ts` with `GEN_SPLIT_RENDERER_BROWSER=1`, `GEN_SPLIT_APP_BROWSER=1` and the supported explicit `GEN_TEST_BROWSER_CHANNEL=msedge`. This override is not the ordinary CI default. Actual argv and dedicated source metadata record the flags, channel, exact files, head/tree/run/attempt and runtime. No case filtering or assertion-deadline increase is added. The existing 45-minute job limit is an explicit cutoff that can leave evidence incomplete; static source inspection does not establish sufficient Windows runtime margin.

Artifact names bind head, run and attempt; full names also bind shards 1 through 4. Source identity is retained before setup. Root comparison measures accepted base `49cd633` separately. The design has explicit limits: candidate-build failure can prevent baseline checkout/build; hard interruption can omit a receipt; installed Edge preflight is not browser-launch evidence. Static/synthetic checks establish no actual Windows, installed-desktop or connector-transfer result.

The sealed v2 ingester SHA-256 is `1d2616a45c097afe53a46c78536972917683df23e20b9b30a1042afcd45c2ca8`. Ingestion preserves raw ZIP/metadata bytes and verifies size/digest, safe paths, member hashes, source/head/tree/run/attempt, exact job/artifact names, receipt/log identity and the full-shard command contract. V2 additionally requires all 16 browser receipts, exact added suite commands and the enabled split flags/channel/files in both argv and source metadata. Missing source/results/receipts, a missing split file or skipped guarded bodies remain INCOMPLETE. Offline synthetic checks pass, including wrong/disabled flags, channel/filter changes, missing cases and CRLF command text; they establish no real CI result. `BYTES_VERIFIED` means byte custody only. All four full artifacts must share the exact run/attempt/source before counts can be considered together; failures and skipped bodies stay explicit.

## Capability and approval gates that remain independent

M15 still lacks trusted transformed-text offsets, an atomic complete DIFF_HUNK witness, an authenticated retained log/screenshot reader and tested M05/M10/M14 owner contracts. Current mounted-row bounds do not establish task-tree/timeline, whole-App, native history, paint, DPI or all-device performance. Default-off rollback retains current code and data; it is not a binary-downgrade promise. Local integrity PASS remains separate from complete execution, independent approval and release decisions.
