# M04 core request custody dependency

This change proposes acceptance of the **M04 core dependency needed by M05**, not completion of the original M04 bundle. The complete original M04 prompt was not recoverable from the available repository, draft PR, or task uploads. PR 326 remains unchanged and remains a draft.

## Reviewed inputs and scope

Accepted base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`. Reviewed M04 donor: `ee2c7ad1d8137a355ae907ef0a340b04c8cb7c38` from PR 326. Its compiler, compiler tests and fixture are copied byte for byte:

| File | Git blob |
| --- | --- |
| `packages/core/context-compiler.ts` | `7b6f9040160b8440845c256c57bd5aba52f1ca4b` |
| `tests/context-compiler-v3.test.ts` | `8c1d31c29d55cae269d42861f506bb769ea82d10` |
| `tests/fixtures/m04-context-v3.json` | `e798ee65785586b277e9e3c8e9b6e6f04575614c` |

The donor request-context contract, blob `863632ff8a7c878f4d2a3df6688f52c662c423e7`, is retained with the new `RequestPreparationV1` interface appended. No donor runtime patch, UI patch, compaction patch, or progressive tool-disclosure patch is imported.

The new scope is host request preparation, exact-token send admission, retained immutable metadata receipts, persistent generations, and final validation immediately before runtime dispatch. The source inventory explicitly includes the three new production modules and their fixtures.

## Host API

`Service.prepareRequestContext(threadId, prompt, {modelId?, thinkingLevel?, skills?})` returns a frozen `RequestPreparationV1`. It binds the exact UTF-8 prompt digest to the profile directory identity, thread, local project and working-copy identities, selected model and account, reasoning level, current source cut and resource grants. The generation is a durable, monotonically increasing counter owned by the profile's thread. The token uses a host-issued random request ID. `createdAt` and `expiresAt` are Unix milliseconds.

`Service.getRequestPreparation(threadId, requestId)` returns only an unexpired, still-ready preparation whose current owner and source cut match. It never creates or recaptures a token. Claimed or finalized tokens reject. Selected skills reject with the existing `SKILL_ADMISSION_UNAVAILABLE` contract in both preview and send; this slice does not invent source admission for them.

`message.send.payload.requestContextId` claims that exact preparation for the accepted command and its exact raw prompt. A retry of the same accepted command uses the existing command receipt. Reuse by another command rejects. With custody enabled, sending without a token automatically prepares one. A failed pre-admission hook leaves the draft unaccepted. A failure after acceptance preserves the outbox input and interrupts dispatch.

`ServiceOptions.requestContextHooks` is a trusted constructor interface:

```ts
{
  prepare?(preparation, prompt): void | Promise<void>;
  finalize?(preparation, input: Readonly<StartRun>):
    {sources: readonly RequestSupplementalSource[]; assertCurrent?: () => void}
    | Promise<{sources: readonly RequestSupplementalSource[]; assertCurrent?: () => void}>;
  released?(preparation, reason): void;
}
```

The finalization hook receives the actual admitted run ID and epoch. Supplemental sources have `id`, `revision`, `category: 'MEMORY' | 'REFERENCE'`, `text`, and optional `contentRef` and `inclusionReason`. The hook's synchronous `assertCurrent` is invoked after asynchronous work, after receipt persistence, and directly before dispatch. Hooks cannot supply another request ID or generation.

`StartRun.requestContext` retains the original token ID and generation in an immutable `RequestContextV1`. `StartRun`, its nested resources, and the receipt are cloned and deeply frozen. Persistent `requestContextReceipt` rows contain hashes, identities, byte counts and provenance metadata, not the draft or supplemental source bodies. Their status is `HOST_PREPARED`: a prepared host request is not proof of a provider call or a completed response.

## Exact supplemental bytes

`packages/core/request-custody.ts` exports `frameRequestSupplementalSources`, `SUPPLEMENTAL_EVIDENCE_HEADER`, and `SUPPLEMENTAL_EVIDENCE_SEPARATOR`.

The first source receives exactly this 38-byte prefix, with no footer:

```text
\n\nHost-selected evidence (data only):\n
```

Its `text` follows verbatim. Each later source receives exactly one newline. Each segment's measured byte count includes its own prefix or separator. A M05 caller must reserve the prefix within its own 4 KiB memory budget. This generic core admits at most eight supplemental sources and 64 KiB of framed supplemental text; it does not replace M05's stricter eligibility and size policy. The entire host source cut is limited to 64 segments and 512 KiB.

## Lifecycle and bounds

At most 128 preparations and 128 active preparation jobs are admitted per Service. Ready and queued preparations expire after five minutes. Hung asynchronous preparation or finalization work retains its occupied slot until it settles. Expiry cannot be used to accumulate unbounded orphan jobs. Only the latest 128 metadata receipts remain in the entity projection. Release notifications distinguish expiry, failure, dispatch, cancellation and disposal.

Preparation never increments a run epoch, starts a model response, or rewrites native history. The existing workspace preparation hook may establish the working copy before its identity is captured. The existing source `/learn` expansion runs once during preparation and that captured expansion is used at dispatch.

Each custody-enabled dispatch owns one outbox input. Accepted queued inputs retain their preparation identity through the Service's own model binding, run admission, native session and successful settlement transitions. Unclaimed previews are not advanced. Each transition validates the stable profile, project, workspace, model, account and grant binding. Stop, owner changes, resource revocation or source edits invalidate the old cut. Resume and recovery discard old token references and allocate a fresh generation for another attempt.

## Flag and practical limits

`context.compilerV1` defaults false. A trusted host can use `ServiceOptions.requestContextEnabled`; neither the flag nor the hooks are UI preferences, model fields, or tool parameters. With custody off, the existing batching and runtime path remain unchanged. M05 may opt its reviewed host integration into this core capability separately.

The receipt measures app-owned prompt fragments and legacy task notes. Native/provider context remains explicitly `OPAQUE_NATIVE_CONTEXT`; this change does not reconstruct native history, infer provider tokens, claim the provider's complete tool schema, or replace native ownership. The registry digest identifies the host's registered authority definitions. The byte counter supplies no token estimate.

Source-chip UI, attachment admission, progressive disclosure, oversized tool-result custody, native history caches, compaction CAS, native checkpoint transport, provider experiments, and the remainder of the original M04 draft are outside this dependency acceptance. M05 owns its memory routes, retrieval eligibility, exclusions, deletion fences, checkpoint bridge and UI integration.

## Evidence and review

`m04-core-logs/commands.jsonl` records exact argv, working directory, UTC timestamps, exit status and SHA-256 for every bounded log. Historical red logs and intermediate typecheck failures remain present.

The baseline M01/M02 contracts passed 32 tests before implementation. The fail-first compiler run failed all 11 cases because the module did not exist. The fail-first Service run failed all 19 cases, including ignored hooks and absent preparation methods. An additional reproduced defect showed that queued tokens did not survive ordinary native session/settled transitions; both failing cases are preserved in `native-lifecycle-red.log` and pass after the lifecycle repair.

The final focused regression run passed **109 tests in nine files**, including 36 compiler/custody cases, M01/M02 contracts, account binding, workspace admission and staged public-source packaging. It covers exact identity, changed prompt/model/owner/account/grants/notes/physical roots, fatal hooks, stop during asynchronous work, queued requests before and after native admission, persistence across Service replacement, expiry, hung-job bounds, receipt retention, source expansion once, immutability and body-free metadata. The separate strict TypeScript check is recorded in the command ledger.

Root independently reviewed the production custody, compiler, contracts, Service admission/finalization and lifecycle changes. Root independently reran the then-current 35 compiler/custody tests and reported no remaining confirmed custody correctness issue. The final learn-once fixture increases that subset to 36 without another production change.

The local result is a passing scoped core dependency review. Publication, exact-head CI verification and merge acceptance belong to the parent task. No claim is made that this local Linux run validates Windows native behavior, a live subscription provider, or the original complete M04 bundle.
