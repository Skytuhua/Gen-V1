# Immutable M05 host drift review

Review date: 2026-11-16. This is a read-only integration review for a later source cut. It does not amend the C3 acceptance base, evidence, source, index, or publication tree. No tests, browsers, builds, merge, or product edits were run for this review.

## Source identity and disposition

Accepted C3 base: `49cd633273a3f61c14a4191a9877e99ab23ec88f`.

Frozen C3 publication tree: `be7e206431f13b654b6aecd7c12c23d0e4b2dfdb`. References below marked C3 are to this immutable Git tree, not a subsequently merged worktree.

New upstream reviewed: `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`. The M05 implementation squash is `34d8dd1e0e68af44265cea69b082ce4088366017`, directly above accepted49; b4aa has parents 34d8 and evidence commit `1a1d72948869dbdaeccf34e6f5d713899c9b4a62`. The review compares exactly accepted49 to b4aa.

Two concrete projection/integration gaps require work on that later base. The reviewed send path does not demonstrate a prompt-hash mismatch merely because M05 preparation omits M15 source references. Combined execution remains untested. C3 results cannot establish the behavior of a later merged source tree.

## Concrete projection gaps

**Effective M04 availability diverges.** C3 `packages/core/source-workbench.ts`, `SourceWorkbench.evidence()` line 478, reports M04 available only when `context.compilerV1` is enabled. Upstream `packages/core/service.ts`, `requestContextEnabled()` line 352, also enables request custody whenever `memory.projectV1` is enabled. With M05 enabled and the independent M04 flag false, leaving the M15 projection unchanged would report that custody is disabled while Service prepares and retains context receipts. Reconcile the projection with the owning Service's effective capability; do not turn on either flag to hide the mismatch. The existing retained `context()` reader remains account/workspace fenced.

**M05 now has an owning contract, but the M15 module row has no integration.** C3 `SourceWorkbench.evidence()` line 479 is hardcoded `UNSUPPORTED` with no href. Upstream adds `packages/contracts/project-memory.ts`, `packages/core/project-memory-host.ts`, and `apps/server/project-memory-routes.ts`. The routes expose an authenticated project/thread view, prepared/latest request views, exact source-revision reads, and separate reviewed mutation commands. A later M15 adapter can now use those typed owning reads and explicit disabled/empty/available states. It must not reinterpret M05 records as generic M15 captures or grant memory mutation authority to the workbench.

The M05 source schema is distinct: `MemorySourceRefV1` identifies `MESSAGE`, `FILE`, or `TASK_NOTE` with an owning thread, revision, captured sequence, and digest. Its source endpoint also requires the project/thread scope, item revision, and source digest, and `ProjectMemory.source()` checks exact ownership and current source authorization. It is not a general retained verification log/screenshot reader. It does not supply the missing atomic complete-comparison witness for M15 diff capture.

## Prepared memory plus selected sources

Upstream `/api/projects/:projectId/memory/requests/prepare` accepts authored prompt, thread, model, and thinking level. It calls `Service.prepareProjectMemory()` and the existing M04 `prepareRequestContext()`; it does not accept `sourceRefs` or `sendMode`.

That omission alone does not cause a hash mismatch. C3 `Service.sendMessage()` lines 911-937 obtains or validates an M04 preparation, claims it against the authored `content`, independently authorizes M15 sources before the synchronous accepted-input transaction, and persists the same request ID and source references in its outbox. During `deliverInputs()`, the selected retained text is appended to the runtime prompt and entered into the context compiler as the `selected-sources:<inputId>` REFERENCE segment. `RequestContextCustody.finalize()` combines those source segments with supplemental sources and preserves the other `StartRun` fields when constructing the final request. Upstream M05 supplies a MEMORY supplemental segment through the new Service finalize hook. These paths are structurally composable.

The merge must preserve both implementations: M05's composed prepare/finalize/released hooks, checkpoint callback and requirement; C3's source authorization, exact `sourceRefs`, `sendMode`, accepted-input receipt/idempotency, initial-account witness, single-input source delivery, and ownership-bound one-shot claim/admission rollback. Copying upstream Service wholesale would lose the C3 work. No await may enter a synchronous Store callback.

### First account binding

C3 `SourceWorkbench.prepareInitialAccountBinding()` lines 119-138 accepts only a truly empty unbound main task and records its witness inside the first accepted input's transaction. It leaves the captured reference, bytes, revision, digest, and grants intact.

Upstream `ProjectMemoryHost.prepare()` lines 72-84 deliberately uses `DEFERRED` when the current thread model/account differs from the prepared request binding. `finalize()` lines 114-139 validates the admitted model/account, resolves current memory access, and captures a deferred selection only if the newly admitted account's scope is enabled. It never converts a preview into account authority. `prepareProjectMemory()` releases a preparation whose preview cannot be returned. These checks do not demonstrate a static contradiction with the C3 witness, but actual first-file admission with a non-null selected account and M05 enabled has not been exercised here.

### Queued turns

C3 `Service.commitRuntimeProjection()` advances already claimed preparations through accepted session and non-aborted settled transitions. Unclaimed previews intentionally remain stale. M05 retains its prepared memory snapshot and rechecks current owner scope, consent, accepted revisions, and source availability during finalization. Preserve the C3 lifecycle advance and its failure fences when integrating M05 settlement/extraction scheduling.

There is an explicit lifetime boundary: C3 `REQUEST_PREPARATION_LIMITS.lifetimeMs` is five minutes; `RequestContextCustody.sweep()` removes expired ready and claimed preparations, and access also checks expiry. M05 forces this custody path even when `context.compilerV1` is false. An `AFTER_CURRENT` input waiting past that lifetime cannot silently reuse an expired request. Verify retained input/source recovery and the intended explicit re-preparation behavior. Do not weaken expiry or silently recapture memory to produce a passing queue test.

## Native and file-guard drift

Upstream extends `RuntimeCallbacks` with `onMemoryCheckpoint`, `StartRun` with a checkpoint requirement, and `RuntimeAdapter.compact()` with an optional fifth argument. The merged contracts must retain C3's source-reference fields as well. `packages/runtime-hermes/index.ts` negotiates the native checkpoint capability, checks it before a required start, rejects a changed requirement on follow-up, and binds checkpoint calls to the retained native owner/session/model/account. The task pool forwards the new compact argument. A source-plus-memory integration test must exercise this actual runtime path; scripted source mocks cannot establish the native contract.

The upstream `file-access.ts` change adds the protected deletion-ledger parent to guarded roots. `security.ts` reserves the external per-profile ledger and rejects protected-path or hardlink aliases. Preserve these protections while revalidating M15 resource grants. The separate timeout change extends only the initial app-owned Hermes guard acquire to 45 seconds; ordinary operations remain 15 seconds and metadata imports retain their 120-second bound. It does not implement Linux file-leaf capture. C3 `captureKind()` still explicitly rejects `FILE_RANGE` on non-Windows and rejects `DIFF_HUNK` without its owning atomic witness.

## Required later-cut compatibility gates

| Gate | Necessary observation |
| --- | --- |
| Real Service/Store, M05 and M15 enabled | Explicit prepared request ID plus captured M15 source reaches one accepted outbox input and one runtime request; exact source reference/content remain intact and both REFERENCE and MEMORY receipt segments are present. |
| First account admission | A pre-send capture on an empty task binds only through ordinary account admission; original capture bytes/digest/grants remain exact. Cover an artifact locally and a real granted file on Windows. Force a transaction failure and retry the same command without losing custody or duplicating the send. |
| Working queue and invalidation | `AFTER_CURRENT` does not steer the current turn; the next epoch retains the request/source identities. Exercise session/settled transition, memory exclusion/forget or consent revocation, account/grant changes, and expiry with explicit retained-input recovery. |
| Effective module capabilities | M05 on plus M04 flag off reports the actual effective custody capability. Disabled/default flags stay disabled; M05 reads use their owner routes and do not gain capture or mutation authority. |
| Native source plus memory | Actual Windows file guard and real Hermes Python/ACP/source worker, with deterministic model transport only: exact source content, native checkpoint negotiation/ownership, durable outbox identity, same-thread session/history continuity, and protected-ledger rejection. Missing target execution remains NOT_RUN. |
| Regression/source identity | Re-run the final M15 focused tests together with relevant M05 request/service/lifecycle, HTTP, memory checkpoint, source-reuse/storage-boundary, and startup-guard tests on the merged tree. App/shared-composer tests must preserve both prepared request IDs and M15 source/queue state. Use new receipts and source locks; keep every C2/C3 failure and target gap separate. |

Relevant upstream test entry points include `tests/project-memory-service-v3.test.ts`, `tests/project-memory-request-http-v3.test.ts`, `tests/memory-host-lifecycle-v3.test.ts`, `tests/memory-native-checkpoint-v3.test.ts`, `tests/memory-native-file-capture-v3.test.ts`, `tests/memory-source-reuse-v3.test.ts`, `tests/memory-storage-boundary-v3.test.ts`, and `tests/file-access-startup.test.ts`. This review identified these paths; it did not run them or promote their previous results to the combined cut.

## Reproducible source references

Use `git show <cut>:<path>` with the immutable cuts above. Selected reviewed Git blobs are listed below to disambiguate the C3 and upstream Service implementations.

| Cut | Path | Git blob |
| --- | --- | --- |
| C3 tree | `packages/core/service.ts` | `d54fbaa02fbfab35700499dbcadd7f594e635153` |
| C3 tree | `packages/core/request-custody.ts` | `25c3775dd9263080ba9da27991d1d2aebca1ba96` |
| C3 tree | `packages/core/source-workbench.ts` | `4dd8e4520b0faa29a1502966f80b2823c2260443` |
| C3 tree | `packages/contracts/source-selection.ts` | `344e7d62b61b4a7cdbfacd46232983cd6b66c76c` |
| b4aa | `packages/core/service.ts` | `d15a6bfb9bbdf81018cf7756851cd3c233525cae` |
| b4aa | `packages/core/project-memory-host.ts` | `a197333efb3bd12cd0c1c3512eb335cd7a421c1c` |
| b4aa | `packages/core/project-memory.ts` | `08f522d2ebd1e82851f26c2a16575c1d469ab66b` |
| b4aa | `packages/core/memory-retrieval.ts` | `85b8ca85a57b5033cf5178ebb112d9ac809c4c79` |
| b4aa | `packages/contracts/project-memory.ts` | `760aaecd420b260b7d8c948f89ef0d32718b17e7` |
| b4aa | `apps/server/project-memory-routes.ts` | `831de697aa0961028c5d91874a45a1d2dee51b3c` |
| b4aa | `packages/runtime-hermes/index.ts` | `83d5d7856551b3d4a52d9a6a2cd8c1363c09abe1` |
| b4aa | `packages/runtime/memory-checkpoint.ts` | `f7f90985d8b2d62dc389337bf0bb1f802a94f472` |
| b4aa | `packages/core/file-access.ts` | `818fcb763fb73df85d4249ef5fc6b0cfc3805c9c` |
| b4aa | `packages/core/security.ts` | `b676d8f33fe10e52c3395116f0fa1cb4be52c6e2` |

Scope is the host/service/server/contracts/runtime/file-guard diff and the relevant request, source, and memory custody methods. This is not a complete M05 implementation or security audit, an executed merged-tree validation, or approval to activate any capability. No active repository file was created or changed by this review.
