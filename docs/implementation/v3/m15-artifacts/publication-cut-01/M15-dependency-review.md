# M15 current-base dependency review

Reviewed on 2026-11-15 against execution base `399cde39ff4ee82272c7a7700944325c44b36070` in `/workspace/scratch/1b47eb428672/m15-v3`, branch `agent/m15-v3`. This review inspected the accepted source, its relevant callers, and current prerequisite tests. It changes no product code and grants no production activation permission.

## Decision

**CORE dependency compatibility: PASS.** M01 and M02 are present in the execution base. The current evidence schema, effect contracts, effect ledger, and recovery implementation match the accepted M01/M02 reconciliation sources. The intervening registry and snapshot changes preserve the interfaces used by these prerequisites. Six prerequisite test files passed, 71 tests total, with exit code 0.

M15 core and read-only workbench implementation may proceed with `ui.sourceWorkbenchV1` defaulting to false. Optional module mutation controls require their owning module's tested capability. Full M15 integration, browser performance, native platform acceptance, and independent production activation are not established by this review.

`ImplementationEvidenceV3.reviewerApproval` is deliberately `z.literal(false)`. A false value is the only valid implementation receipt value. It prevents a bundle from granting itself release permission. It is not evidence that the source contracts are missing, nor a requirement to change the field to true before development. Actual reviewed source, accepted ancestry, current contract tests, and separate release permission must be assessed independently.

## Repository and accepted ancestry

The repository's canonical origin is `https://github.com/skytuhua-org/Gen-V1.git`, repository ID `1442565952`. `Skytuhua/Gen-V1` redirects to this transferred repository.

Each following commit was checked with `git merge-base --is-ancestor <commit> HEAD` from the isolated root. Every check exited 0.

| Role | Accepted commit | Remote evidence |
| --- | --- | --- |
| Audit ancestor | `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54` | Original M15 source pin |
| M01 merge | `5f0958f4cb5b40bc10c1eea0e1cd517b57aaa1b9` | [Merged PR #299](https://github.com/skytuhua-org/Gen-V1/pull/299) |
| M02 merge | `f331cf16b268282da888a41da42fc776ea7befd5` | [Merged PR #293](https://github.com/skytuhua-org/Gen-V1/pull/293) |
| M01/M02 reconciliation | `e871257aa82beb06ab4b8f3989cbe436cb9a6a8c` | [Merged PR #303](https://github.com/skytuhua-org/Gen-V1/pull/303) |
| Prior M15 accepted base | `fcaa52f7fcdc9f39420118a79f9a8250ba83c563` | Ancestor of the current execution base |

The current base is 32 commits ahead of the prior M15 base, with 86 changed files and no divergence. M04 core request custody, M09 agent work, and M11 request observations landed in that interval. A missing previous working tree cannot be treated as an already-reviewed patch against this newer base.

The remote M01 and M02 evidence receipts retain their historical platform and full-regression gates. M02's text saying its reviewed PR inputs are not in `main` is stale relative to the merged ancestry above. This review does not rewrite those historical receipts or convert their unobserved platform cases to passing cases.

## Exact contract source cut

The values below are Git blob SHA-1 identifiers from the immutable execution base, not hashes of a concurrently edited working tree.

| Source | Current blob | Compatibility finding |
| --- | --- | --- |
| `packages/contracts/implementation-evidence.ts` | `559b720ccead1d29c9a1bd4db528af52534105c3` | Identical to accepted reconciliation and prior M15 base. Strict schema and validation semantics preserved. |
| `packages/contracts/tool-effects.ts` | `41b6fff1364825122c33761c0bfaac66da03bca0` | Identical to accepted reconciliation and prior M15 base. |
| `packages/core/tool-effects.ts` | `aa65f1d9b52d6a117b716a38feb8dd6c6d46b13a` | Identical to accepted reconciliation and prior M15 base. |
| `packages/core/effect-recovery.ts` | `e2addef2f65df69a504495e0b3c9954d0006ac5c` | Identical to accepted reconciliation and prior M15 base. |
| `packages/core/tool-authority.ts` | `1d654522d9842838276d162a33dac6141f731c26` | Identical to prior M15 base. Since reconciliation, the M06 `verification_declare` classification and schema reference were added. Authorization algorithm unchanged. |
| `packages/core/capability-flags.ts` | `829f51f534524beaafe81010ba4fc9aa25498537` | Registry extended for M04/M09/M11. `CapabilityFlags`, unknown-key rejection, independent values, and false defaults unchanged. |
| `packages/storage/store.ts` | `bff67fade13b7813ba89aff98cbf853acb7e3723` | Only change since prior M15 base is the `snapshot().modelRequests` projection. Transaction implementation unchanged. |
| `packages/contracts/index.ts` | `14c59034b8bb2c37137a266320fbeca90af95a52` | Optional request-context and request-observation fields plus usage activity/cache fields added. Existing command, receipt, owner, and runtime entry contracts retained. |

For explicit drift records, the capability-registry blob was `812a5094356145651b4f5f3c187d2b3cd05e0394` at reconciliation and `39e18abb43f7fa63cb2534ea3356ebb1be121161` at the prior M15 base. The Store blob was `ebab3cba8d56e074d0377623bffd2054790f622b` at both cuts. The core contracts index blob was `09517becaf0c35f5f63bd758878659ea0de5f57b` at both cuts. These changes were inspected, rather than substituting a guessed API for an old source lock.

### Transaction and effect boundaries

`Store.command` checks an existing command receipt before applying new work. A reused command ID with different content raises `DUPLICATE_COMMAND`. Its synchronous `BEGIN IMMEDIATE` transaction records projection changes, event sequence, and command receipt before `COMMIT`. `Store.internal` uses the same transaction implementation. Nested transactions and returned thenables are rejected. Listeners run after commit and cannot roll it back. Projection writes outside a transaction reject.

Therefore, source resolution that performs filesystem or other asynchronous work must finish outside a Store callback. The final owner, revision, digest, and grant checks must be synchronous at the write boundary. M15 must not await inside `Store.command` or `Store.internal`, create a second SQLite writer, or confuse a read-model projection with canonical native history.

The M02 ledger admits and persists `DISPATCHED` before the executor call. Approval consumption occurs in the admission transaction. Settlement occurs in a later transaction. Matching invocation IDs coalesce only with matching argument commitment and owner; changed inputs conflict. Owner/run epoch, account, project, and workspace checks remain active. Crash recovery retains uncertain effects as `UNKNOWN_EXTERNAL_OUTCOME`, and a forged operation-looking invocation cannot inherit an unrelated operation result. Read-only source context does not create a tool grant or an approval.

The M02 flag instances supplied to `Service` are host-constructor owned and independent between Service instances. The shared finite registry also retains its existing module flags. Adding the M15 key must preserve both arrangements and cannot activate M02 or optional module mutation capabilities as a side effect.

### New-base send boundary

`Service.sendMessage` still creates a canonical user message and durable outbox input under the original command ID. On the current base it also supports M04 request custody:

- A supplied `requestContextId` is rejected if the host has not enabled `context.compilerV1`.
- With custody enabled, an absent preparation is created through `prepareRequestContext`.
- The exact prompt and owner basis are claimed inside the send transaction, then revalidated/finalized adjacent to runtime dispatch.
- Model/account binding and current ownership are rechecked after asynchronous work.

M15 source-aware sending must use this existing input path and preserve these checks. It cannot append source bytes after an M04 preparation has committed to a different prompt, silently drop source identity, or introduce a parallel durable send queue. `NOW` and `AFTER_CURRENT` require their own demonstrated admission behavior.

## Current test evidence

Command, run from the isolated root:

```text
PATH=/workspace/scratch/1b47eb428672/tool-bin:$PATH node scripts/m15-record.mjs core-prerequisites pnpm exec vitest run tests/research-baseline.test.ts tests/regression-selection.test.ts tests/m01-m02-compatibility.test.ts tests/tool-authority-v3.test.ts tests/tool-effects-v3.test.ts tests/effect-recovery-v3.test.ts --maxWorkers=1
```

| Observation | Value |
| --- | --- |
| Start | `2026-11-15T21:32:14.806Z` |
| End | `2026-11-15T21:32:45.955Z` |
| Exit / termination | `0` / `NONE` |
| Result | 6 files passed, 71 tests passed |
| Runner | Node `v24.22.1`, declared pnpm `10.30.3`, Vitest `4.1.12` |
| Receipt | `docs/implementation/v3/m15-logs/core-prerequisites.json` |
| Log | `docs/implementation/v3/m15-logs/core-prerequisites.log` |
| Log SHA-256 | `6632f9300be5523924f942d0569c62cc96daeebcdb7236c0957de96a049ae5f4` |

The `bbbb...` Git lookup errors in that passing run come from the existing fake-base negative fixture in `research-baseline.test.ts`. They are retained in the log. No nonzero command has been relabeled as an expected-negative success.

The source of all six suites was reviewed. Coverage includes command observation and process cleanup, negative source locks, manifest status validation, finite flags, rename-aware regression selection, historical M02 evidence compatibility, role/owner/account/scope denial, approval commitments, deduplication, crash recovery, pagination, and retained uncertain outcomes.

`m01-m02-compatibility.test.ts` validates the historical M02 receipt against its historical source lock. It does not by itself establish compatibility with today's source blobs. The separate source and ancestry review above closes that distinction for the current core prerequisite boundary.

## Existing target inventory

| Target | Execution-base blob | Owner/callers and constraint |
| --- | --- | --- |
| `apps/web/src/App.tsx` | `20342a3f9697d82c4d1e64b5e583ba19b186406e` | Ordinary and canvas conversation owners. Existing shared composer, draft generations, model/account binding, context inspector, usage dialog, Find, and Inbox integration. M11 added new-task model handling and request observations. |
| `apps/web/src/ContextInspector.tsx` | `0fa748ae093ea5541d2a194aa408471c8fd02aea` | Existing shared Popover. Compaction receipts are bound to exact thread/session/run/epoch; unavailable measurements stay unknown. Unchanged since prior base. |
| `apps/web/src/UsageDialog.tsx` | `77dc9051c29ef23ecfcb7e5614cff5f1b36a93f8` | Existing Modal, provider/scope filtering, refresh generation fence. Current M11 Requests tab receives `Snapshot.modelRequests`; retain this owning surface. |
| `apps/web/src/CodeReviewHost.tsx` | `2a3b8e34ccc6faf5a59a7b9fd7160f6f1cea8d6b` | Mounted by WorkspaceHost. Navigation admission, scope and native-window ownership fences govern review tools. Owner switches await journal flush and editor handoff. Unchanged since prior base. |
| `apps/web/src/FileCheckpoints.tsx` | `3c0c56f8c6ebe358985f3c03f5383ef354fb922c` | Mounted by WorkspaceSurfaceBody with its existing adapter. Restore requires adapter-owned enabled plan/apply capabilities. Code restore must remain separate from conversation navigation. Unchanged since prior base. |
| `apps/web/src/conversation-workspace/reader.ts` | `fcf2d5c3f0a13801e99e1786a69de54ac40fc8c6` | Read-only, navigation-admitted reader. Generation/abort/transcript fences invalidate stale reads. Its code-point content cursor is not a UTF-16 selection offset. Unchanged since prior base. |
| `packages/ui-shell/ChatView.tsx` | `12812060fba6247e96992ddca1c46a215e868e76` | One mounted subtree moves through layout geometry. Preserves shared menus, focus, IME checks, reduced motion, and requestAnimationFrame drag/resize. Unchanged since prior base. |
| `packages/core/ui-admission.ts` | `50a4006f6bd3056ebe7af75b7f40ea595a1f7920` | `threadData(store, threadId, id, revision?)` resolves current/retained data with exact thread ownership. Artifact bindings and resource/action references are host-validated. Unchanged since prior base. |

Additional reusable boundaries inspected:

- `ConversationFind` is explicitly a loaded-message DOM search with no command/draft authority. It must remain truthful about that scope. New full-result log search/copy must resolve authorized full data and cannot infer completeness from mounted rows.
- `AgentInbox` adapts the existing attention owner and `InboxView`; it is not a replacement task store.
- `journal.ts` retains IndexedDB state, synchronous pending records, generations, failed-write retry, and single/multi-key compare-and-swap. `journalCompareAndSwapMany` can atomically retain a recovery copy and replace active text. An old acknowledgment must not clear a newer generation.
- `editor-handoff.ts` owns registered asynchronous editor guards. Navigation and native-window handoff must keep using this boundary and propagate flush failures.
- The scoped conversation reader caps loaded messages at 180, with 30-message pages and 65,536 code points of expanded content. These are presentation bounds. Store canonical messages remain retained; M15 cannot delete them to satisfy its mount budget.

Relevant existing regression inventory includes `tests/usage-context.test.ts`, `tests/file-checkpoints.test.ts`, `tests/scoped-conversation-reader.test.ts`, `tests/chat-layout.test.ts`, `tests/conversation-find.test.ts`, `tests/saved-drafts.test.ts`, `tests/journal.test.ts`, `tests/editor-handoff.test.ts`, and `tests/agents-workspace-composer.test.ts`. Browser owners include `usage-context`, `file-checkpoints`, `scoped-conversation`, `saved-drafts`, `code-review-workspace`, and the existing root/frontend suites. This inventory is not a claim those additional suites passed in the prerequisite command.

## Remaining gates

This prerequisite review establishes only the current M01/M02 core dependency boundary. Its initial integration and platform gates are resolved or retained by the later `M15-handoff.md` and final verification manifest. The completed clean-base root browser attempt is recorded in `M15-browser-baseline.md`: 79 passed, 33 failed and one skipped. Earlier setup-only failures remain preserved. Optional module unavailability and native platform gaps remain visible. Production activation stays disabled until separate release review and the owning feature's evidence support it.
