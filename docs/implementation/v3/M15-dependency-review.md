# M15 dependency review, publication cut 4

C4 accepts main `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`, tree `cdc9e7ad31a45e9c8ec69fbf1592f0605b033c6f`. Its M05 implementation ancestor is `34d8dd1e0e68af44265cea69b082ce4088366017`. The intended publication parent is `98db97d1d0a1910f47879f0e3d54477bcc59feed`; its only incoming changes are the two archived generated evidence files. The tested final-03 context remains eeda with local changes. Current main and review-branch identities were rechecked before this preparation. Later remote changes require their own review; this document does not silently advance the accepted base.

The exact earlier C3 source, tree, raw Windows results and source binding remain historical in [the C3 cohort](m15-artifacts/c3-windows-run-43797606300-attempt-1/cohort-file-map.json). The earlier public reviews remain byte-for-byte in their publication archives. A passing historical test is not assigned to a C4 required case merely because a path is unchanged.

## M05 integration decisions

The immutable accepted 49-to-b4aa review identified two concrete mismatches: M15 reported M04 availability from the independent compiler flag even when the Service enabled request custody for M05, and its M05 module stayed hardcoded unsupported despite a new owning review contract. The earlier [upstream review](m15-artifacts/c4-dependency-review-01/upstream-m05-review.md) remains a static, unexecuted review at its original cuts. C4 implements and separately tests the two adaptations.

`SourceWorkbench` receives optional host-owned module readers. Service supplies its existing effective request-context predicate and the same `ProjectMemory` instance it already owns. The memory reader first resolves project/thread access, reads the existing review projection, and returns only module state, reason, link and an owning access fence. It does not copy memory text into a new workbench model or create another memory store. A final synchronous `assertAccess` and the existing source owner stamp fence the awaited read. Unexpected access/storage errors propagate; they are not converted to EMPTY.

M05 states are explicit. Missing owning reader is UNSUPPORTED. A project-less task is EMPTY with no scoped link and no memory-store initialization. An unavailable owning capability projection is DISABLED with the owning reason. Authorized items or tombstones make the module AVAILABLE; a genuinely empty authorized view is EMPTY. All states remain read-only. A disabled capability may still expose authorized retained review data through the owning review, without granting capture or mutation authority.

The workbench launches the existing ProjectMemoryReview only after an explicit action and a lazy import. The owner must match the current eligible main-kind thread, project, working-copy workspace and account; canonical main placement is not an eligibility condition. Request/import lifetime fences prevent a late owner or module import from reopening a prior scope. The workbench entry sets readOnly; configure, accept, edit, reject, expire, forget and conflict-resolution actions are disabled and guarded. Pinned-source reads, conflict history, refresh and the existing explicit export remain available. The ordinary M05 project-overview entry keeps its existing mutation authority and defaults.

Prepared M05 memory and retained M15 source references remain separate owning inputs to one ordinary message.send. C4 does not change the composed M05 prepare/finalize/released hooks, source authorization, accepted-input transaction, request ID, command replay or source outbox transport. A real Service/Store regression already verifies the authored prompt, exact retained source envelope, MEMORY and REFERENCE segments, and post-admission usage on the same dispatch. Shared-composer coverage retains the original prepared request ID and source generation through uncertain queued delivery and reload. These tests do not erase the separate native, first-account, checkpoint or platform boundaries.

A new Windows-only combined regression observes the actual Hermes runtime start/follow-up, native guarded file capture, Python/ACP broker and persisted history across two turns; only model text is scripted. It explicitly seeds a null-account recipient, prepares M05 memory, retains an old file capture on the second turn and checks exact request frames, replay and reopened SQLite records. Static review and Linux collection do not establish that body. It does not exercise first unbound/non-null account admission, queued expiry, forced checkpoint/compaction, automatic extraction, a live provider or installed desktop behavior. Their existing owning tests and current target outcomes remain separately identified in the phase plan.

## Preserved ownership and platform boundaries

The accepted workspace presentation still separates focused split views from canonical main placement. The shared live-Usage summary now selects only an eligible visible local conversation and forwards that explicit owner to Usage. The renderer reports its existing active-view calculation through an optional layout-effect notification. Hidden, collapsed, folded-away, removed, archived, project-mismatched, detached or pending-native owners cannot supply a stale summary. Canonical placement writes, main-thread resolution, provider keys and ordinary/pinned footer ownership remain unchanged.

Source capture still checks complete logical ownership, account, epoch, source revision/digest and resource grants. The first-input account witness remains in the ordinary synchronous transaction. M04 rollback cannot reopen a durable accepted input or replace newer custody. No await is added to a synchronous Store callback. Retired Research and Code Review workspace presets and UI creation remain unavailable; surviving presentation records are not source authority. The accepted b4aa Service still owns its existing Research repository and research commands. Backend Research retirement belongs to the unaccepted later main review.

M05 adds checkpoint negotiation and protected deletion-ledger roots upstream. C4 retains those runtime/file protections. It adds no Linux file-leaf fallback and does not weaken a guard deadline. A fresh request-context preparation or an explicit retained-input recovery remains necessary when the owning request lifetime or consent has expired. Source references are not silently recaptured to bypass an invalidated memory or account scope.

The native-close correction is tracked in the C4 regression ledger with its failing fixtures and boundary tests. Its exception is confined to untouched failed initial storage recovery, while local work, pending imports/CAS, source ownership and ordinary journal flush remain obligations. A later asynchronous empty-read reproduction found that concurrent same-thread guards could prevent each other from completing. The correction serializes independent validations by thread, whose logical owners share composer/pending keys, while keeping each complete source owner separate. Each queued call rechecks the original obligations and retains its own failure. The 31-case red/green result and complete browser outcomes have separate source-bound records; earlier cached-source concurrency passes did not prove this case.

## Exact accepted contract blobs

The controller derives the following versions from the actual accepted Git objects. Test paths identify owning coverage, not a claim that every body has run on this platform. The audit ancestor and all accepted dependency commits are checked for ancestry against b4aa.

| Owning contract | Accepted b4aa Git blob |
| --- | --- |
| `packages/contracts/implementation-evidence.ts` | `559b720ccead1d29c9a1bd4db528af52534105c3` |
| `packages/contracts/tool-effects.ts` | `41b6fff1364825122c33761c0bfaac66da03bca0` |
| `packages/core/tool-effects.ts` | `aa65f1d9b52d6a117b716a38feb8dd6c6d46b13a` |
| `packages/core/effect-recovery.ts` | `e2addef2f65df69a504495e0b3c9954d0006ac5c` |
| `packages/core/tool-authority.ts` | `1d654522d9842838276d162a33dac6141f731c26` |
| `packages/core/capability-flags.ts` | `02783eb029b618f9bf1abe0b9f51ff8f5c27076a` |
| `packages/storage/store.ts` | `bff67fade13b7813ba89aff98cbf853acb7e3723` |
| `packages/contracts/index.ts` | `a35b1b14c4143a6a5d56c7777339e5aa73734d9d` |
| `packages/contracts/request-context.ts` | `30185cc5e66a74ef438af8ec8e9ec1d91989c614` |
| `packages/core/request-custody.ts` | `b7f0946c0ae48acc8d0673739c6960a5601b8841` |
| `packages/contracts/project-memory.ts` | `760aaecd420b260b7d8c948f89ef0d32718b17e7` |
| `packages/core/project-memory.ts` | `08f522d2ebd1e82851f26c2a16575c1d469ab66b` |
| `packages/core/project-memory-host.ts` | `a197333efb3bd12cd0c1c3512eb335cd7a421c1c` |
| `apps/server/project-memory-routes.ts` | `831de697aa0961028c5d91874a45a1d2dee51b3c` |
| `packages/runtime/memory-checkpoint.ts` | `f7f90985d8b2d62dc389337bf0bb1f802a94f472` |
| `packages/core/file-access.ts` | `818fcb763fb73df85d4249ef5fc6b0cfc3805c9c` |
| `packages/core/security.ts` | `b676d8f33fe10e52c3395116f0fa1cb4be52c6e2` |

The inspected source set includes authenticated server routes, request and source custody, Store, the M05 owner/read/checkpoint contracts, file/security guards, canonical placement, source/draft handoff and shared UI primitives. The generated source lock records every exact inspected blob and approved drift from the original audit ancestor.

## Workflow, packaging and evidence

The C4 push workflow pins the pushed head/tree, accepted b4aa baseline, run ID and attempt. It retains seven jobs: 37 focused native files, 18 browser commands, a paired complete root browser comparison, and four unfiltered full-repository shards. Browser commands retain each suite's declared target; explicitly enabled split bodies record msedge and both activation environment flags. Installed Edge detection alone is not a passing test. Browser desktop bridges remain distinct from installed-desktop execution.

The reviewed v4 ingestion helper requires the exact native argv and complete 37-file result membership, all expected browser receipts, original source records, bounded-log digests and archive identity. Its successful ingestion records byte custody; original test failures remain failures. Ordinary `.github/workflows/ci.yml`, the pinned lockfile, all job deadlines and the existing public admission contract remain unchanged. The explicit public source list admits reviewed files only. Its existing source/runtime membership and admission contract are preserved rather than regenerated from the M15 execution base.

Current execution claims and outstanding gates are in [M15-c4-regression-review.md](M15-c4-regression-review.md), the evidence plan and immutable command receipts. Actual Windows C3 evidence now exists, including native source/history bodies and full shards, but it stays bound to C3 head 3f68 and accepted 49. The external Windows and Linux reconciliation failures also retain their nonzero exits; a narrative parity label does not turn them green.

## Remaining owning capabilities

No owning atomic complete-comparison witness has been supplied for DIFF_HUNK capture. Authenticated historical log/screenshot navigation and trusted formatted-Markdown source offsets also remain absent. Exact canonical message selection and retained source bytes remain available. M05 now has the read-only owning integration described above; M10 background work and M14 conversation branches still have no tested workbench adapter. The M05 source reader is not a generic verification-artifact reader.

Feature-off rollback uses the current binary and retains source drafts, captures, ambiguous receipts and accepted-input custody. A binary downgrade to the first publication does not understand the later account-admission witness and can fail closed; legacy references are not promoted into authority to hide that incompatibility. `ui.sourceWorkbenchV1` and `reviewerApproval` remain false. This review grants no merge, release or activation approval.
