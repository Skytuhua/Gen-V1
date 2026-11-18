# M15 C4 regression review

## Status and evidence boundary

C4 has passing integration and browser results on the explicit source cuts below. It does not yet have a completed final-cut validation result. This draft records observations through `c4-source-handoff-initial-01`, which ended at `2026-11-16T04:51:29.757Z`: its first Phase A source-handoff selection failed with 11 passes and 12 behavioral failures. Phase B was not applied at that observation. The expanded combined native fixture and final commands require their own receipts before this review can assign them an outcome.

The M05 host/composer selection passed 22 cases after 12 initial failures. The broader host selection passed 291 cases with two genuine Windows-only skips; the real-App workbench suite passed 26 and the existing project-memory renderer suite passed 15. Later corrections passed all 48 workspace-host cases, all 15 saved-layout cases, three selected desktop error-role cases, and all 16 Usage integration cases. These results belong to different measured cuts and overlapping selections. They are not a combined final suite total.

The original cold-close failure remains unresolved by the executions enumerated here. C3's actual Windows run is terminal **FAILURE**, with passing full-repository shards but failed browser and root commands. External publication archives also retain failed commands. None of those outcomes is replaced by a later local pass, archive admission, or successful integrity check.

## Source identity

C4 reconciles M15 with accepted upstream `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`. C3 was published at `3f68a8f1bc1ca5a588862571d905163861e94492`, tree `be7e206431f13b654b6aecd7c12c23d0e4b2dfdb`, against the older accepted base `49cd633273a3f61c14a4191a9877e99ab23ec88f`. C3 is historical evidence for C4.

External changes were preserved through adoption of `0f487aa82fba616131d7f9e547076d3a14d67f48`, then evidence-only `364d3f552c23668c3894d04f4a6443808cc2b17a` and `082264877e3bb61e8c87f257ccd831b5c1438472`. The tested local source contains additional changes beyond those Git HEAD trees. A receipt's nearby HEAD is not a substitute for its whole-source manifest.

Each manifest below covers all tracked and nonignored untracked repository paths outside documentation. Dependencies and ignored generated assets retain separate setup provenance. The first five cuts have 2,390 source files; the later handoff cut has 2,391. The original source manifests and earlier receipts remain unchanged.

| Cut | Parent or HEAD at capture | Source files / bytes | Manifest SHA-256 |
| --- | --- | ---: | --- |
| [Initial merge prerequisites](m15-artifacts/c4-prerequisites-01/source-cut.json) | C3 `3f68a8f1`, incoming `b4aa2caa` | 2,390 / 55,374,761 | `bbe507cd947ac5c86cb31e81a08cc2f8c3b932b2f94cf401b27084866107adb5` |
| [Initial integration](m15-artifacts/c4-integration-initial-01/source-cut.json) | External `0f487aa8` plus local tests | 2,390 / 55,407,655 | `45c8c271338bfda89e8411636d0786430ae387a204cf1187d1f2eed5f7e38141` |
| [M05 integration correction](m15-artifacts/c4-integration-green-01/source-cut.json) | External `0f487aa8` plus local implementation | 2,390 / 55,412,423 | `692fe4b7bfd8bf7de881d11f2a0603e82e88ad9b7c3d55b289b506893010689a` |
| [First browser corrections](m15-artifacts/c4-browser-corrections-01/source-cut.json) | External `08226487` plus retained local implementation | 2,390 / 55,415,853 | `f542de949b162bf343058a77b2cbb6091d7f6ebb10ef1df1926776a3d3e5006a` |
| [Usage owner correction](m15-artifacts/c4-usage-owner-01/source-cut.json) | External `08226487` plus Usage owner correction | 2,390 / 55,418,271 | `a2a3c75f73e6646c5fc8fd5fb2ec59241d76bfc6844ebe48fda88f4dc18c01a6` |
| [Source handoff Phase A](m15-artifacts/c4-source-handoff-initial-01/source-cut.json) | External `08226487` plus observation and strict helper extraction | 2,391 / 55,461,300 | `fe8a782f2a48c0a359042c54bce38e1b2003fce00a0e639292a9e283aacad0ae` |

The integration, browser-correction, and Usage executions used before/after source verification against their named manifests. The initial prerequisite and typecheck results apply only to their earlier cut. They do not establish final typecheck or production-build success after subsequent changes.

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

### Desktop errors and the still-open cold-close failure

Three desktop failures stopped at `alert` selectors while their expected error text was rendered with `status`. The narrow product corrections changed the actual error presenters in App, DesktopEntry and DraftTransfer to `alert`. The selected rerun passes all three cases, including the guarded editor state and pending-signature export behavior. Success messages keep their existing status role. This selected result does not replace the failed complete desktop run.

The fourth failure is behavioral: an untouched, unrecovered composer with injected IndexedDB and staging failures returns `false` from the native close callback where the test expects `true`. The callback completed in about 71 ms after the disabled composer and recovery-failure alert were observed, so this is not an assertion timeout. Source review attributes the new refusal to unconditional source-draft reads in both the App and SourceWorkbench handoff guards, before an otherwise empty journal flush. Fixing only one guard would leave the other refusal.

That fixture performs no source selection, and its workbench endpoints return 404. It proves an unavailable/no-local-source path rather than an authenticated Service `enabled:false` response. The correction boundary must preserve refusal whenever retained source state, a local source operation or an uncertain input is owned. Neither a feature toggle nor a caught storage error proves absence. The original browser failure is retained. The first later source-level handoff run is described below; no repaired browser or Phase B result is claimed.

### Native handoff Phase A remains red

`c4-source-handoff-initial-01` ran `tests/source-handoff-v3.test.ts` and the unchanged `tests/editor-handoff.test.ts` with one Vitest worker. It failed: **11 passed, 12 failed, zero skipped**, across 23 cases in two files. The new source-handoff file has 20 cases; all three unchanged editor-handoff cases passed. The [receipt](m15-logs/c4-source-handoff-initial-01.json) and [results](m15-artifacts/c4-source-handoff-initial-01/results.json) bind it to `fe8a782f` after verified execution.

Phase A adds metadata observation and extracts the strict helper, with no cold-owner allowance. All 12 observed failures are behavioral assertions. They include refusal of an explicitly untouched failed-recovery owner, handoff completion before pending hydration or a first single/many CAS has settled, failure to retain failed operation/import obligations, a same-registry-handoff import commit failure being acknowledged, and an ordinary failed draft generation not persisting as expected. The results do not establish a completed repair. Phase B and its concurrency-risk review remain separate; no green or native/browser success follows from this red run.

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

## Remaining gates and retained boundaries

The next source cut must independently validate the native close/handoff correction, the combined native source/memory fixture, affected App and split-layout callers, and final source-level/production gates. The cold-close result, complete current desktop result, exact-head C4 Windows/Edge result, current full aggregate, packaging/controller and publication states remain pending here. Later commands must append their actual identities and outcomes rather than replace the earlier failed rows.

The feature defaults remain covered by the explicit default-off host test. Memory review does not authorize edits, source text does not grant execution authority, and the module adapter does not bypass owner/account/project/working-copy checks. Retained reads and rollback behavior remain subject to their existing source and admission fences. Unsupported native file custody on Linux, installed desktop, external provider behavior and final release activation are not established by the local browser passes.
