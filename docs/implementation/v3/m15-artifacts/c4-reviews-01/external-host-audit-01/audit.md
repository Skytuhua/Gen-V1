# External M15 host reconciliation audit

## Disposition and scope

No substantive runtime disagreement was found in the inspected host files. The external constructor order can be retained; the contract difference is field ordering only. The external first-file change is a bounded test synchronization allowance, with unchanged custody and grant assertions. Its supplied evidence does **not** establish the claimed cold-start duration, teardown cause, or executed earlier-baseline failure. The latest external evidence bundle also contains stale hashes and statuses after its focused receipt and log were replaced.

This read-only review compares local C4 host files with external commit `0f487aa82fba616131d7f9e547076d3a14d67f48`, tree `4eda96307edd16e63c4e32c3c3a9d718b117a703`, and reads the prior records at `3566795c057543a117f82fd1b34c7089fba13314`, tree `72537b18499a3b80b53763df9c1750b600fbd8f9`. External ancestry includes published C3 `3f68a8f1bc1ca5a588862571d905163861e94492` through merge `eb1f9d9ed98edff92a31454704c835372a586857`, followed by the merge of M05 main `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73` at `238edfcd09ecaa7d1626c0a1e6c0a4fbfbf318e3`.

No source, test, deadline, index, or repository evidence was modified by this review. No tests or native processes were run. `audit.json` records full file hashes and raw evidence identities. Exact old and new focused receipt/log bytes are copied into this outside-repository review directory.

## Host source differences

| File | Exact difference | Combined resolution |
| --- | --- | --- |
| `packages/contracts/index.ts`, `StartRun` | External places `memoryCheckpoint` before `sourceRefs`; local reverses them. Types and optionality match. | Retain the external ordering. Preserve both fields. |
| `packages/core/service.ts`, constructor | External constructs `requestCustody` before constructing `SourceWorkbench`; local constructs them in the opposite order. | Retain the external order. The retained callback then refers to an already initialized dependency. Neither constructor invokes that callback synchronously; `RequestContextCustody` starts an unreferenced sweep interval. All other Service bytes match. |
| `tests/source-workbench-host-v3.test.ts:196` | External adds `{timeout: 45_000}` to the wait for one runtime start after the first captured-file send. | Preserve this incoming edit as an explicitly bounded synchronization adjustment if adopted. Preserve the failed attempt and the limitations below. It supplies no runtime-product repair. |

Byte equality was independently checked for server registration, source routes, capability flags, SourceWorkbench, request custody, file access, the PowerShell guard script, the real Hermes integration test, and Vitest configuration. No divergent M05 hook, checkpoint, C3 admission witness, claim rollback, shared-basis rollback, or queued lifecycle implementation was found in this comparison.

The local fourteen-case `tests/source-workbench-memory-v3.test.ts` remains frozen at SHA-256 `fe2ff72296655c5e847b6a7c1a696711a511c6bd9245e661410d9a19b81e057d` (20,849 bytes), **NOT_RUN**. The external tree does not replace the pending effective-M04 projection or read-only M05 adapter work. This review does not approve that new fixture by execution.

## What the supplied focused records establish

Both records run the same eight named Vitest files in a recorded Windows working directory using a recorded Node 24.22.2 pnpm path. Their raw log digests match their respective receipts. Neither receipt binds its process to a measured Git HEAD/tree or includes separate runtime platform metadata.

| Record retained at | UTC interval on 2026-11-16 | Actual result |
| --- | --- | --- |
| `3566795c…` | 03:30:31.417 to 03:30:59.590 | Exit 1. Eight files: seven pass, one fail. 113 tests: **111 pass, one fail, one skip**. The first-file case fails because `starts` is still empty. Its reported whole-case duration is 12,228 ms. |
| `0f487aa8…` | 03:34:05.406 to 03:34:36.211 | Exit 0. Eight files pass. 113 tests: **112 pass, one skip**. No individual first-file duration is reported. |

The older plan's `110/112` count is inconsistent with its log. The newer `112/112` describes passing executed cases but omits the selected skipped case. The first-file test uses a real Service/Store and Windows file guard with a recording runtime fixture. The eight-file command does not contain the real Python/ACP/Hermes integration file.

Static source supports a reason to allow asynchronous native work: delivery repeats `SourceWorkbench.prepareSend` after durable admission; resolving a file takes the owning guarded read. `withPathGuard` starts a fresh fixed PowerShell helper for a top-level Windows guard, and that helper contains `Add-Type`. Ordinary RPC deadlines remain 15 seconds; the separate app-owned Hermes startup exception is 45 seconds. The external test edit changes neither deadline nor guard behavior, and the overall Vitest case deadline remains 60 seconds.

The records contain no phase timings, no late successful delivery observation after the failed assertion, no `request owner has closed` stack, and no recorded execution against `a1349b0a`. Whole-case duration includes capture/admission work and cannot measure the later wait or compilation. Inventorying all eight newly supplied `reconcile-*` receipt/log pairs found no separate baseline command or timing artifact. Therefore a longer bounded wait is defensible as synchronization, but the specific 45-second value and the detailed causal/baseline narrative are not established by the supplied evidence. The later pass must not be labeled proof of a pre-existing product defect or an exact final-head native result.

## Evidence consistency defect at the external head

Commit `0f487aa8…` changes only the timeout, `M15-evidence-plan.json`, and the same focused receipt/log paths. The following derived files remain byte-identical to `3566795c…`:

| Derived file | Stale content |
| --- | --- |
| `M15-artifacts.json` | Focused receipt hash `ad8ae63c…` and log hash `2be19701…`, with the old 1,326-byte log length. Actual new hashes are `b6e7ac26…` and `c2875f5a…`; the new log is 670 bytes. |
| `M15-command-index.json` | The focused command still has FAIL, exit 1, and the earlier timestamps. |
| `M15-verification.json` | The focused phase and command still contain the earlier FAIL, log digest, and unsupported baseline wording. |
| `M15-source-cut.json` | Host test remains locked to `ebe41700…`, 64,040 bytes. The external test is now `c28ed707…`, 64,059 bytes. |

`M15-validation-summary.json` also remains unchanged: its validation timestamp, 03:32:12.462 UTC, predates the replacement focused run and timeout commit. Its historical integrity PASS cannot attest the changed head. Preserve the old attempt under its own immutable identity, preserve the new attempt separately, and regenerate current derived metadata only after the combined source is settled. The two raw copies in this directory permit that recovery without reconstructing logs.

## Broader execution boundaries

The supplied full-suite receipt is `pnpm test:no-lease`, 03:09:56.642 to 03:26:34.318 UTC, exit 1. Its verified log reports **4038 pass, 59 fail, 48 skip** across 373 files: 348 pass, 23 fail, two skip. It includes first-file admission failure and a real Hermes integration failure stating that the source worker stopped before completing its request. Missing Windows credential native-module errors also appear, but this review does not attribute the separate Hermes failure to them. The full log reports 47 host cases while the later focused log reports 48, so it cannot silently become complete validation of the later test cut. The full-suite FAIL remains unchanged.

The parent separately reported that the native CI job completed successfully for unchanged published C3 `3f68a8f1…`; counts and raw artifacts were not yet independently available to this review. That source predates M05 reconciliation and the external timeout change. Neither its job status nor the external runtime-fixture pass proves the combined C4 source, the pending fourteen-case fixture, or the new M05 adapter.
