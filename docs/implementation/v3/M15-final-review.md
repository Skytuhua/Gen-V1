# M15 C4 review record

## Disposition

C4 is reviewed against accepted main `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`, including M05. Incoming published branch changes and all older evidence remain preserved. Review and execution are bounded to their exact source cuts; a static review does not certify an unexecuted browser, native platform or whole product.

The final local source cut is [final-03](m15-artifacts/c4-validation-final-03/source-cut.json), SHA-256 `0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260`, containing 2,391 non-document paths. On that cut, the host selection passed **410 cases with two Windows-only skips**; the complete App, desktop and renderer suites passed **26, 31 and 21 cases**, respectively, with no failures, skips, flaky outcomes or report errors. Typecheck, production build and UI policy passed. The 31-case handoff result is included in the host selection and is not added to a unique total.

The earlier complete App attempt remains **22 passed/four failed**, and desktop remains **26 passed/five failed**, on their earlier source cut. The asynchronous empty-owner handoff defect was reproduced and corrected; the two earlier App startup/reload failures retain unknown causes despite the later pass. Current C4 Windows/native/Edge, paired root browser and full-repository execution are **NOT_RUN** at this publication checkpoint. Historical failed target runs and unavailable capability requirements keep overall acceptance incomplete.

Current detailed evidence is in [M15-c4-regression-review.md](M15-c4-regression-review.md), [M15-dependency-review.md](M15-dependency-review.md) and the evidence plan. The draft PR remains unmerged. ui.sourceWorkbenchV1 and reviewerApproval remain false. Publication authorization does not grant merge, release, deployment or activation.

Later main was observed at `199a2e240aac0374228e82599fe7aeba4afafaf2` and is not the accepted execution base. The earlier bounded reviews retain backend Research retirement at main109, desktop alert-to-status assertion changes at main5fa, and pointer/layout/browser fixture changes at main5f. The subsequent 44-path delta through main199, including M07 and additional ownership/UI changes, was inventoried without adoption or a compatibility claim. C4 retains alerts for actual recovery failures. Accepted b4aa still constructs its Research repository and dispatches its Research commands; its retired workspace presets and UI creation remain absent. Ordinary PR merge-tree CI stays separate.

The intended publication parent advanced from eeda to `98db97d1d0a1910f47879f0e3d54477bcc59feed`, tree `19d92af279985a059bbda7a9be4f5bb95b70f842`. That single incoming commit changed only the generated M15 source cut and validation timestamp. Their exact Git bytes are preserved in [the incoming metadata archive](m15-artifacts/external-publication-cut-98db97d/archive-manifest.json). It changed no product source, test, published log or artifact and created no new test execution. The final-03 test context remains eeda with local changes.

## Reviewed implementation decisions

| Area | Finding and resulting behavior | Validation boundary |
| --- | --- | --- |
| Effective M04/M05 availability | Service supplies its effective request-context predicate; M05 metadata uses the existing project-memory owner, read and final access fence | Real Service/Store/host regressions and exact selected-source/prepared-memory payload checks; target runtime remains separately recorded |
| Read-only memory view | Workbench explicitly and lazily opens the existing review, fenced by current thread/project/workspace/account and async lifetime | Configure/accept/edit/reject/expire/forget/conflict actions are disabled and guarded; ordinary M05 entry remains unchanged |
| App contribution ownership | The main WorkspaceControls retains its workspace-panel opener, pinned native threads retain one header opener, and embedded views suppress the duplicate. M05 eligibility separately requires the exact eligible main-kind thread/project/workspace/account owner | Initial failing opener case, corrected selected cases and complete desktop suite remain distinct; M05 eligibility does not require canonical main placement |
| Visible Usage | Active local view selection is separate from canonical main placement; explicit eligible owner feeds shared summary and Usage | Complete 16-case local Usage/shell/mobile run on its named cut, including hidden/stale owner and two-visible-pane negatives; Edge execution remains a separate target |
| Error semantics | Actual recovery failures use alerts; loading/success remain status | Accepted-base desktop regressions and complete current result; later unaccepted main test-role drift is documented separately |
| Initial recovery and close | Only three failed untouched recovery keys can receive the cold allowance; reads/CAS/work/history eliminate it | Phase A 11/12 failure and Phase B 25/0 success retained; mounted App path has separate browser evidence |
| Import preprocessing | Barrier registers before File.text so concurrent source guards recheck the same import transaction | Actual journal/import/registry schedules and real mounted DraftTransfer fixture; storage/native/HTTP boundaries remain scripted |
| Sticky failed work | False CAS, automatic accepted cleanup and old successes cannot acknowledge newer failed source work | Explicit retry, failed write persistence, first CAS, staged/broadcast/enumerated recovery and owner transition cases |
| Same-thread guards | Retained-source schedules initially passed, but asynchronous empty reads reproduced a progress defect; each call now validates independently in a per-thread FIFO | Normal 27/4 red becomes 31/0 green; later failures, hydration, uncertain retained input and owner-specific rejection remain guarded. Complete browser results are separate |
| Native combined memory and sources | New two-turn fixture uses real native file guard, Hermes/Python/ACP/history and reopened SQLite | Model text is scripted; recipient is seeded null-account; first non-null admission, queued expiry and forced checkpoint/extraction are separate |
| Incoming UI changes | Preserved shorter source metadata, pressed-tab styling, scrollbar treatment and output spacing | Exact incoming union plus final browser result; selection cleanup has a separately recorded asynchronous ownership investigation |

### Incoming source presentation and asynchronous selection cleanup

The incoming eeda revision's shorter revision display, local capture time with full title, pressed-tab styling, scrollbar treatment and output spacing are preserved. Its successful-action cleanup could erase a selection made while capture was awaiting the host. A normal browser red run demonstrated both a newer foreign selection and a newer same-source range being erased. The correction snapshots the original range's nodes and offsets, then clears only that exact still-current range and its matching candidate. A newer range stays available. The three regression cases pass within the complete 21-case renderer suite; no send or permission behavior is added.

The changes retain the host as sole SQLite writer, synchronous Store callbacks, original message.send/outbox identity, first-account witness and M04 rollback fences. No replacement task history, memory database, send queue, authority migration, native guard bypass or release permission is introduced.

## Independent review scope

The retained C4 reviews cover M05 host contracts, read-only UI and owner transitions, browser fixture corrections, native source/memory fixture, handoff policy, workflow/ingester declarations, publication transport and final custody checks. Each report names inspected bytes and whether it executed code. A no-finding static report is not a full independent approval of the merged product.

The native-close reviewer found the preprocessing ordering gap in an earlier design; the final source drains that barrier and rechecks the source obligation. Its initial same-owner concern did not reproduce with retained cached records. Later complete App/desktop failures and an asynchronous empty-read diagnostic established the missing case. The resulting FIFO wrapper preserves separate validation per invocation; independent review found no new lost-obligation gap. The two initial App startup failures remain unclassified. The final custody checker review found incomplete exact archive-membership/destination checks and a possible same-count runtime allowlist swap. Those were checker validation gaps, with no observed evidence loss. Before execution, the checker was strengthened to pin exact canonical archive membership and the exact runtime array from the hash-bound tested manifest. Numeric schema parity was also corrected. All earlier review records remain preserved.

The publication helper retains copied-index/external-object isolation, full evidence/receipt validation, exact retained published mode/blob identity, byte-preserving transport and independent incremental/final Git tree reconstruction. It requires accepted b4aa to be an ancestor of the supplied published parent, then creates one new child. Fresh remote lease, actual API success and final source/custody execution remain separate observations.

## Historical target evidence

C3 run 43797606300/attempt1 is complete and remains FAIL at head 3f68 and accepted 49. Native 326 passed with one Linux-only skip. Four full shards passed 3,604 with 46 skips; guarded split bodies were separately enabled. Browser commands recorded 302 passed/29 failed. Root comparison recorded 30/82/1 at accepted 49 and 31/81/1 at C3. All 81 candidate failing identities also failed the base, without blanket causal attribution. Seven original ZIPs were independently retained and checked; bounded raw receipts/logs/results/source records are admitted with all602 member hashes.

External reconciliation Windows and Linux failures remain historical FAIL, even where an external narrative labeled parity successful. Re-publishing one raw Windows attempt at two commits does not create a second execution. Earlier C1/C2/C3 setup-only, behavioral and interrupted attempts retain their source and actual status.

## Current acceptance and remaining limits

| Gate | Current observation | Scope |
| --- | --- | --- |
| Host, source, M05 and journal selection | PASS: 410 passed, two Windows-only skipped | 28 physical files on final-03; handoff 31 is a subset |
| Complete App integration | PASS: 26/26 | One final-02 execution; scripted HTTP/native boundaries |
| Complete desktop browser | PASS: 31/31 | Includes original cold-close and held-file failed-import/retry; installed desktop remains unproved |
| Complete renderer/browser | PASS: 21/21 | Includes three selection-cleanup cases and the declared renderer measurement |
| Typecheck, production build, UI policy | PASS | UI policy: 545 sources, zero violations, 39 unchanged legacy entries |
| Publication packaging, final custody and controller | PASS: 11 package checks; custody and recorded integrity validation | All 2,390 tested nonmanifest files and 898 published evidence files preserved; exact runtime array, six full archives and incoming two-file metadata delta verified. Final receipt refresh is separate from PARTIAL product acceptance |
| Current C4 Windows native, 18 browser commands, paired root browser and four full shards | NOT_RUN | Requires the exact pushed C4 head/tree and accepted b4aa; seven jobs and 25 command receipts |
| Historical C3 and external target failures | FAIL retained | Exact original heads and attempts; no blanket baseline classification |
| Missing owning contracts and installed/device coverage | BLOCKED or NOT_RUN as recorded | Atomic diff witness, retained artifact reader, trusted formatted offsets, M10/M14, installed desktop/Pi/live provider/DPI |
| Activation and release | Disabled; reviewerApproval false | Draft publication does not grant merge, release, deployment or activation |

Current required Windows checks use the exact pushed head/tree and accepted b4aa baseline, seven jobs and 25 required command receipts. Missing bodies, incomplete artifacts, preflight output, Linux platform skips and successful byte ingestion cannot award test acceptance. Ordinary PR CI remains a separately identified merge tree.

Atomic complete-diff capture, authenticated retained log/screenshot navigation, trusted formatted-Markdown offsets and M10/M14 adapters remain unavailable. M05 now has its read-only owning integration. Installed-desktop/Pi/live-provider behavior and device/DPI performance remain separate requirements. The controlled renderer measures only its declared fixture and excludes paint and whole-application claims.

## Rollback and custody

Disabling the flag while retaining current code preserves messages, captures, drafts, evidence, ambiguous retries and accepted-input custody. Retained inspection/removal, NOW reset and proven-undispatched cancellation remain. A binary downgrade to the first publication can fail closed because it lacks the later account witness. No legacy data is promoted into authority to disguise that limitation.

Final custody checks the original clean checkout, fixed lockfile and ordinary CI, exact six full publication archives plus the two-file incoming metadata delta, every parent-published log/artifact, nonmanifest source continuity with the tested cut, unchanged runtime admission and explicit current-file admission. The evidence controller hashes every source/artifact/log and retains every command. Its integrity status describes record consistency, separately from product acceptance and false reviewerApproval.
