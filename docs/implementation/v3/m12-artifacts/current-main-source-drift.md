# M12 current-main source drift

**Disposition: BLOCKED_SOURCE_DRIFT.** The reviewed M12 implementation remains tied to its accepted source base. Newly advanced main changes the shared Service admission and runtime-dispatch contracts. Existing M12 evidence does not establish compatibility with that new target.

## Immutable comparison

| Role | Commit |
|---|---|
| Accepted execution/comparison base | `fcaa52f7fcdc9f39420118a79f9a8250ba83c563` |
| Reviewed M12 implementation | `d55433f2231597d0efe7515b187e237e11b7ac95` |
| Current PR 355 target, main | `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42` |
| Retained audit ancestor | `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54` |

The worktree is `/workspace/scratch/dbebe44a9817/m12-v3`, branch `agent/m12-v3`. No merge or rebase was applied, and this audit made no reference mutation, product change or combined test execution. This document records the reviewed implementation commit; it does not assert a later documentation commit SHA.

The post-publication check discovered that main had advanced beyond the accepted base. The main commit author and committer timestamps are `2026-11-15T04:02:38-08:00`, equivalent to `2026-11-15T12:02:38Z`. They precede the retained source-cut observation `2026-11-15T12:05:53.795209+00:00`. This audit does not claim that the upstream advance occurred after the source freeze or publication.

The recorded diagnostic `git merge-tree --write-tree --name-only --messages d55433f2231597d0efe7515b187e237e11b7ac95 5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42` exited 1 and reported conflicts in `packages/contracts/index.ts`, `packages/core/capability-flags.ts`, `packages/core/service.ts` and `scripts/public-source-files.json`. Its diagnostic tree is `7fbcf03cd6c43fbd1d9f9c9a41e09610ac8d3557`. The exact command header and output are retained in `docs/implementation/v3/m12-logs/source-02-current-main-merge-preview.log`, SHA-256 `689570899c3ad51934aa1ff9203c8b003790a4e2c978d52592a66879a06309b1`.

The diagnostic may write unreferenced Git objects. It does not apply a merge or update branch references, the index, or checked-out source. This is not a claim of zero filesystem writes. This artifact writer read that recorded log and did not rerun the operation. The JSON companion copies its exact recorded command header; no command timestamps, command exits or test results are inferred.

## Behavioral and API drift

### Shared runtime input and actual tool consumers

At `packages/contracts/index.ts:34`, new main adds `requestContext?: RequestContextV1` where reviewed M12 adds `programTools`. Both extensions must survive integration. Choosing either conflicting declaration wholesale discards the other extension. New main Service constructs its input without `programTools` at line 985. Reviewed M12 Service selects and inserts that metadata at lines 878-879.

The metadata is consumed by actual M12 adapters: `packages/runtime-pi/worker.ts:51` passes `input.programTools` to `createHostTools`, and `packages/runtime-official/index.ts:188` forwards `snapshot.programTools` through its context builder. Taking main Service input construction unchanged with those adapters omits the M12 metadata they consume.

### Prepared request admission changes the input cadence

Main adds Service methods `prepareRequestContext` and `getRequestPreparation`, an `Outbox.requestContextId`, and prepare/claim checks at both message admission and `input.processing`. With the M04 host capability enabled, `deliverInputs` admits `eligible.slice(0,1)` instead of batching eligible inputs. The custody finalizer requires `input.inputIds?.length === 1` and rejects a different shape. See main `packages/core/service.ts:877-889,937-975` and `packages/core/request-custody.ts:162-164`.

The reviewed M12 Service batches inputs and has no request-custody prepare/claim lifecycle. Its accepted admission evidence does not cover the new single-input state machine. Passing its batching unchanged through the enabled finalizer would violate that explicit contract.

### New asynchronous custody boundary before dispatch

Main Service awaits `requestCustody.finalize`, calls `assertFinalized`, rechecks run and account binding, then invokes runtime `start` or `followUp`. It releases custody after dispatch or failure. The finalizer freezes a cloned input, awaits a trusted host hook, checks current ownership and sources, records `HOST_PREPARED` metadata, and checks again after synchronous Store observers. See main `packages/core/service.ts:989-1001` and `packages/core/request-custody.ts:162-193`.

Reviewed M12 directly dispatches after its existing run/account checks. Preservation of program-tool selection, grants, cancellation and exact ownership across the additional asynchronous boundary has not been validated by the accepted M12 source cut.

The finalizer constructs its return value as:

```ts
freezeRequestValue({ ...input, prompt, requestContext: receipt })
```

It spreads the original input. This audit does **not** claim that finalization inherently drops supplied `programTools`. The blocker is changed API and behavior with unverified composition.

### M04 metadata does not replace M12 authority and disclosure

Main `packages/contracts/request-context.ts:1-24` labels its data as observed metadata, not a grant or native transcript. Its public owner contains thread and workspace identity, with a separate model/account binding and context generation. Main Service request custody additionally checks physical profile/project/workspace identity, current grants, source content and private run/epoch/session admission state at `packages/core/service.ts:323-348`.

M12 retains its separate six-field run owner and selected-definition disclosure contracts. Main sets the request registry digest from `digest(buildToolRegistry())` at Service line 115; reviewed M12 `ToolDisclosure.snapshot` commits `digest(definitions)` for its selected complete registry entries at `packages/core/tool-disclosure.ts:89-92`. Those commitments and lifecycle generations are not interchangeable. The new request metadata does not itself prove the M12 selected tool set or replace the locally reviewed prerequisite subset.

### Lifecycle, flag and packaging composition

Main clears/releases request claims during resume and recovery, disposes request custody, revokes M09 child work after parent stop, and recovers/disposes `agentWork`. Reviewed M12 cancels `programHost` on run cancellation and settlement, recovers program records independently of flag rollback, and closes the program host at disposal. See main Service lines 633-641, 915 and 1433-1445; reviewed M12 Service lines 145, 950, 1298 and 1320. Selecting either complete Service implementation loses the other side's obligations. Their combined cleanup ordering has not been tested here.

Main adds `context.compilerV1` and `agents.workV1` to the finite host registry. M12 adds `tools.jsReadProgramV1`, `tools.durableReplayExperimentV1` and `tools.pythonKernelV1`. Neither conflicting union or registry is the complete combined definition. This audit does not authorize activation.

Main also adds explicit request-context/compiler/custody and agent-work entries to the finite public-source/runtime manifest. M12 adds explicit program/Python workers, contracts, host/provider sources, tests and benchmark fixtures. Selecting one entire manifest would discard the other feature's required entries. Combined package closure remains untested.

## Exact conflicting blobs

These are Git SHA-1 blob identities, not command-log or artifact SHA-256 digests. Column revisions are the immutable commits listed above.

| Path | Accepted base | Reviewed M12 | Current main |
|---|---|---|---|
| `packages/contracts/index.ts` | `09517becaf0c35f5f63bd758878659ea0de5f57b` | `baeae3c0a453f7e9cd5a39ed2abc4d0680cb7b2b` | `faa57ba3f2180fe5360f4a50b0c142e57871c91f` |
| `packages/core/capability-flags.ts` | `39e18abb43f7fa63cb2534ea3356ebb1be121161` | `1edfc1de2b68012da568dda8f2c40818641d81eb` | `823b9aa9a02499039c69756795144d035c4ce2a6` |
| `packages/core/service.ts` | `2b3fb63acef915b052a468e104c6e4f00a4b82e4` | `d77d4d699515465f0b094403de4f3a8447169c59` | `00351f5a3a69c3313fd58f75cc38d90938c63cee` |
| `scripts/public-source-files.json` | `8cb3efe75c120185f957ab3df73255756adcf7b8` | `5b9124fd049e065e54f2d246b7c1e14894330a37` | `7738bed5d6fa1903ce76a86e06f5778af91caeae` |

## Original named integration targets

These are the six original integration targets preserved in the accepted M12 audit. Five remain unchanged upstream from the accepted base. Service is the changed original target. Some reviewed M12 blobs differ because M12 intentionally modified those files.

| Path | Accepted base | Reviewed M12 | Current main |
|---|---|---|---|
| `packages/core/service.ts` | `2b3fb63acef915b052a468e104c6e4f00a4b82e4` | `d77d4d699515465f0b094403de4f3a8447169c59` | `00351f5a3a69c3313fd58f75cc38d90938c63cee` |
| `packages/runtime-hermes/worker.py` | `e28c6272f9aab28f76b9462a87768fe4226361c1` | `e28c6272f9aab28f76b9462a87768fe4226361c1` | `e28c6272f9aab28f76b9462a87768fe4226361c1` |
| `packages/runtime-pi/tool-definitions.ts` | `2731bc9797fd40dd010a04099171452c0f993ebc` | `cc5209c1a44c45dfa4e9395a2cbb31ef06ce6731` | `2731bc9797fd40dd010a04099171452c0f993ebc` |
| `packages/runtime-official/mcp.ts` | `791ebf88c58765f9e4625bde6b727019c1b33337` | `485c68d93385f85e92a94733e5235c8c9b0bdd09` | `791ebf88c58765f9e4625bde6b727019c1b33337` |
| `packages/core/security.ts` | `693f251361bc464caee26df795c57002d120c9a7` | `693f251361bc464caee26df795c57002d120c9a7` | `693f251361bc464caee26df795c57002d120c9a7` |
| `packages/runtime-pi/process-tree.ts` | `fb903470a172be1e1995557caa888b4f065e7270` | `fb903470a172be1e1995557caa888b4f065e7270` | `fb903470a172be1e1995557caa888b4f065e7270` |

## New main contracts and custody dependencies

Each path in this table is absent from both the accepted base and the reviewed M12 commit. Presence here describes the upstream source addition; it does not promote a milestone or establish combined acceptance.

| Path | Current main blob |
|---|---|
| `packages/contracts/request-context.ts` | `30185cc5e66a74ef438af8ec8e9ec1d91989c614` |
| `packages/core/request-custody.ts` | `b7f0946c0ae48acc8d0673739c6960a5601b8841` |
| `packages/core/context-compiler.ts` | `7b6f9040160b8440845c256c57bd5aba52f1ca4b` |
| `packages/contracts/agent-work.ts` | `f7969fc248647c5e0859c2c0811dc8fdd255951b` |
| `packages/core/agent-work.ts` | `2aeaee56468670f39c5fa1a81e6b9e544c60141d` |

The JSON companion retains the additional immutable blob identities for M12 tool-program/disclosure contracts and the Pi/Official consumers cited above.

## Evidence boundary and publication gate

Main contains request-preparation tests for immutable identity, changed grants/account/source, failed finalization hooks, separate queued token-bound dispatch, and durable preparation generation in `tests/request-preparation-service-v3.test.ts`. This audit inspected those test definitions. It did not execute them or a combined implementation; source presence is not passing evidence.

The existing source proof remains bound to accepted `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`:

| Retained artifact | SHA-256 |
|---|---|
| `docs/implementation/v3/M12-source-lock.json` | `943b2c4f69146c0f864760d8557b429721eca28f3019b28666be01f201dd97b7` |
| `docs/implementation/v3/M12-candidate-source-cut.json` | `8327bd5b99f29a5153504f993cc201e577543dbf43009b41cab2cf2697110384` |

The original M12 instruction requires `BLOCKED_SOURCE_DRIFT` when integration APIs change. That condition is met by the inspected Service/StartRun/custody changes. Accepted-base evidence is preserved and must not be silently represented as validation of main `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42`. This source comparison is not a merged-tree test result, an inherent metadata-drop claim, or a claim of a runtime exploit.

Only `current-main-source-drift.json` and this Markdown companion were created for this documentation task. Existing artifacts, controllers, logs, product source and Git references were left unchanged.
