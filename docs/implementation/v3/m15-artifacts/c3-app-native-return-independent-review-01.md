# C3 App and native-return independent review

## Disposition and source identity

No material App reconciliation, source-owner, journal, or fixture defect was found within this bounded read-only review. The integrated App exactly matches the frozen proposal. This is a review of measured working files after accepted-main reconciliation, not a claim about a published C3 commit or completed target-platform evidence. The observed repository HEAD remains `a1349b0a7ffa1420566da9c7770faf80d6be5bf3`; the integrated accepted base is `49cd633273a3f61c14a4191a9877e99ab23ec88f`.

The reviewer read the relevant App, source provider/selection/journal, desktop ownership, split placement, SurfaceBoundary, fixture, specification, and retained execution records. This review changed no product or test source, staged nothing, and ran no test, browser, typecheck, or build job. The companion JSON retains full source and evidence identities. The earlier independent compatibility and workflow reviews remain separate.

## App reconciliation

The actual App is byte-identical to `app-reconcile/App.proposed.tsx`, SHA-256 `9eb5a0241349cdf64c6860b63080fea3ca29c155dd1c6ffed7ccf6a6cf7e3ee4`. Direct immutable-ref comparisons also confirm that Composer send, source journal plus editor handoff, select/selectNow, canonical placement, and both SourceWorkbenchProvider openings equal published C2. The native-return effect equals accepted49. These are static source comparisons, not runtime passes.

The summary SurfaceBoundary and following source provider both survive the JSX conflict resolution. Boundary instances use the imported class and stable surface identity; the new wrappers do not replace the source provider with an inline component definition. The provider retains thread/project/working-copy identity and epoch/account/active/held fences. A selected canvas ID is not substituted for source workspace ownership.

Source navigation still reads the exact current owner, composes its authored draft, checks uncertain pending admission, requires a READY source handoff, flushes the journal, and then performs editor handoff. Canonical split placement captures the current layout revision, waits for that handoff, uses the existing placement command helper, and publishes selection after the command succeeds. The split API retains its generation/workspace/revision checks rather than silently retargeting an older command.

The native return effect waits for a canonical conversation split layout before consuming the focus intent. It uses ordinary thread selection, preserving the C2 source handoff path. SurfaceBoundary's Retry rendering only resets that boundary. This review does not interpret it as a guarantee to recover a cached rejected dynamic import or to preserve arbitrary descendant React state after a thrown render. Source lazy-load recovery wording remains a window reload instruction.

## Explicit queue mode

The working composer hint now excludes an enabled workbench draft whose mode is AFTER_CURRENT, matching the availability condition for Queue after current. Composer send itself remains unchanged from C2 and retains the source-aware shared-composer path. The alternative composer path still rejects unsupported source-aware submission while retaining the draft.

The updated queue case first checks the NOW hint and absence of a queue action. It switches the explicit mode, checks that the authored text remains and no send occurred, clicks Queue once, and requires exactly one `message.send` with the original thread, exact authored content, exact captured reference, and AFTER_CURRENT. It also checks zero `run.stop` and `thread.create`, then checks the draft and chip are cleared after acknowledgment. This case does not delay that acknowledgment, so it does not independently establish clearing timing under a held queue response. No complete current App22 result is claimed here.

## Native-return fixture and observed evidence

The new case exercises the real App and source draft journal with a scripted DesktopBridge and source HTTP authority. The existing task fixture and canonical split helper remain unchanged. A and B have different threads, working-copy owners, text, and source references. The test creates both drafts and captures through the UI, reads rather than injects composed journal contexts, holds A description work across detach and selection of B, and later reloads while the durable B split layout read is held. A native return intent arrives before that read is released. The case requires no early split command, then a canonical `split-workspace.view.open` for A and exact A/B draft restoration without an implicit send, create, stop, or resume.

The retained `c3-native-return-01` receipt is PASS with exit 0, one expected case, zero skipped, unexpected, flaky, or runner errors. It ran from 2026-11-16T02:08:36.291Z to 02:08:54.799Z. Its log SHA-256 is `af50001f2310ce02d022ec8c5fdc7383c6913d8ab43677dfa471567ec3623473`. The execution source record identifies fixture `f787e1b71dfeecf34f495995032b554f26a8e31b8746fb91a654c9ab26f54e00`, with current App and spec hashes. It does not identify the later corrected fixture as executed.

The retained attachment is SHA-256 `60acad4096a592270fc57b5b82374099dca008e3960dbcc5819e9c9298c11a27`. It records two captures, exact separate journal contexts before and after return, no ordinary commands, and canonical split command base revisions 1, 2, and 3. Its delayed description bookkeeping says fulfilled because `route.fulfill` resolved, but the same event reports `requestFailure.errorText = net::ERR_ABORTED`. The supported observation is that canceled A work did not create another capture or contaminate B. This record does not prove that a stale response reached application code and was ignored.

The case does not launch an installed desktop, execute a native file guard, authenticate a real source service, or use Python/ACP/Hermes transport. It also does not cover competing native focus intents or persistence/handoff failure retry. The current native-return code does not promise automatic retry of the same consumed intent if ordinary select handoff fails.

## Fixture corrections and retained failure

The original executed fixture was followed by a narrow GET `/threads/:id/context` route correction, producing `e33142f1fd7073d07f1508d78a1ac805f0b7b226864561fc1d51a4c361485ce5`. Its exact bytes remain at `docs/implementation/v3/m15-artifacts/c3-typecheck-01-native-fixture-source.txt`. Typecheck01 remains FAIL with exit 2 and four TS2352 errors: the custom Window interface incorrectly required a field before fixture initialization. Its log SHA-256 is `6661a43f7b02ab48fd80369c166ff1a6fd793ac018719ca35e7a5c7ad1ba8ae0`.

The current fixture `73b87d3a1f3a46978052777c2cac2335928f447f2ba93ff6a718e7e6267e7ffb` makes that field optional before initialization, assigns a typed local call array to Window, uses the local array in bridge callbacks, and explicitly rejects a missing fixture when reading calls. The reviewed diff changes no product, source-route ownership check, spec assertion, or timeout. Typecheck02 is observed PASS, exit 0, from 02:14:26.942Z to 02:15:33.882Z, log SHA-256 `e9a201c2479a7028e4074b54c117b9e7909d92bcf7db8fba5d879c57845b4c04`. This establishes type viability of the corrected fixture; it does not replace a current complete browser run.

## Separate host regression

The retained-layout source test provides complementary real Service/Store/M04 and WorkspaceRepository coverage. It captures a structured artifact before first admission, preserves exact account/owner/working-copy/capture/outbox state through retained profile apply/select both before and after admission, rejects each new retired preset without side effects, and verifies the same accepted send remains idempotent. Its runtime records starts only. Measured directory identities do not establish native Git or native file access.

`c3-layout-source-01` remains FAIL: its initial assertion searched raw text inside the correctly quoted evidence envelope. `c3-layout-source-02` is PASS after parsing the single envelope and comparing exact capture ID, source, version label, and text. Each run selected one case and filtered 47 others; those exclusions are not native skips. The final host test SHA-256 is `ebe41700ec8794fdee48791a37a50ebf7b5c809b8db00fabd5be98ea50e95281`. The companion JSON binds both receipts and results. This review does not claim a completed current 24-file focused aggregate.

## Measured current source files

| Path | Bytes | SHA-256 |
|---|---:|---|
| `apps/web/src/App.tsx` | 157534 | `9eb5a0241349cdf64c6860b63080fea3ca29c155dd1c6ffed7ccf6a6cf7e3ee4` |
| `apps/web/src/SourceWorkbench.tsx` | 20550 | `309199491dcede75bffbb08bc73bf7fd5d2493601191fd11fc5392c77820e419` |
| `apps/web/src/SourceSelectionActions.tsx` | 9495 | `89306758de311d070aa8f90b1a39c1be5a58a2dc01aa2ff1e26ace65fc292d2d` |
| `apps/web/src/SurfaceBoundary.tsx` | 1078 | `877ff198f52dda58e9e639ffa54d9b7ceedc080ef60c67ddddbade92db92b22d` |
| `apps/web/src/desktop-context.tsx` | 7359 | `5e12e3db398a998b1e492d0e8124c330b0f8d66aa0561f73ea25511f29ba4893` |
| `apps/web/src/split-workspace-api.ts` | 5085 | `acdb5f53ea301e733ab333268c4359c308b035eaba522c0aaba01b5729370805` |
| `apps/web/src/split-thread-placement.ts` | 2357 | `dbd4b17d01edf6fed9cabc5f5b0582a12e44736cddaedd7ce4330bb64a1eab7e` |
| `apps/web/src/workbench-recovery.ts` | 10722 | `63204f9de4b62e52e275ad5c30f0cbf41a8082efe090430df1a1fa357b123ab8` |
| `apps/web/src/workbench-api.ts` | 4860 | `8f99344e9451e931e9aa77684df14a67ad2497bf28ebbb0921d3314c604ea088` |
| `tests/e2e/workbench-app.spec.ts` | 37558 | `ef9c4c806be3f007830e08fd85f2c6d64c86fe4e6bda4fcf911ef4d153ac4feb` |
| `tests/e2e/workbench-native-return-fixture.ts` | 10123 | `73b87d3a1f3a46978052777c2cac2335928f447f2ba93ff6a718e7e6267e7ffb` |
| `tests/e2e/task-interface-fixture.ts` | 10212 | `d06775ef1f79e435e602e547130530d8c9d9759e2c285168e90ec3c45b25c05d` |
| `tests/e2e/workbench-app.playwright.config.ts` | 476 | `2ab30cea0296d11dd68e850160d9f41754588abdf2709a264941376ff51e80c6` |
| `tests/source-workbench-host-v3.test.ts` | 64040 | `ebe41700ec8794fdee48791a37a50ebf7b5c809b8db00fabd5be98ea50e95281` |

The input hashes above were rechecked while sealing. Future aggregate and target-platform receipts must identify their own current source cut. Existing C2 failures, the initial C3 fixture failures, and genuine native/Edge/installed-desktop limits remain preserved.
