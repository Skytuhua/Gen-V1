# M12 independent review, working cut

Accepted comparison base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`.

Repository reviewed: `/workspace/scratch/dbebe44a9817/m12-v3`.

This is a review of a changing working tree, not approval of an immutable release cut. Production activation remains unapproved. The reviewer made no implementation edits. The review artifacts and the isolated deadline probe were added at the coordinator's request.

## Scope and method

Read the actual host program manager, M02 invocation ledger and authority registry, M04 disclosure subset, M10 private result subset, host facade, Service integration, kernel manager, QuickJS adapter and worker, Python provider, worker, seccomp filter and supervisor, Linux descriptor reader, resource guard, planning adapter, runtime transport diffs, authenticated result routes, protocol tests and process-kill fixtures. The dedicated frontend reviewer owns the detailed browser review.

The review checked current owner/account/project/workspace/run/epoch fences, classification and disclosure before admission, identity persistence before host tool dispatch, result privacy and grant revalidation, delivery journal ordering, replay refusal, callback transaction discipline, process lifetime, kernel generation, memory scope, default flags and failure status propagation. No live evaluation endpoint, credential, external account or user file was used.

## Findings and dispositions

### IR-01: Initial Python factory can revive a stopped kernel

**Original defect:** `PythonKernels.create` awaited the initial factory and then wrote its captured generation as READY without comparing the current record. A Stop or Reset during the await could be overwritten.

**Independent reproduction:** A deferred initial factory was resolved after `stop()`. Observed `afterStop=STOPPED`, `lateCreateState=READY`, persisted state READY, and zero executor stops.

**Current disposition:** Fixed in the inspected source. `activate()` compares the complete captured admission record inside the host transaction, validates the current owner, and installs ownership before committed listeners run. Late or superseded executors are stopped. `python-kernel-20-admission-green.log` records exit 0 with 14 tests, including the added lifecycle cases. This fix does not by itself address IR-08.

### IR-02: Falsy thrown source failures became successful null results

**Original defect:** The nested-read implementation selected FAILED versus SUCCEEDED by the truthiness of a caught `failure`. A rejected promise with `undefined`, `null`, `false` or `0` was treated as success.

**Independent reproduction:** `executeRead: async () => { throw undefined; }` produced a SUCCEEDED program, SUCCEEDED nested call and aggregate `{sourceValue:null}`.

**Current disposition:** Fixed in the inspected source using the explicit `sourceFailed` boolean. `review-11-falsy-source-green.log` records exit 0 with 53 tests. Private error details remain in retained handles, and the public program failure is host-authored.

### IR-03: Planning readers omitted the new Linux byte-read API

**Original defect:** The restricted planning `DomainContext` forwarded `withResource` but not `readResource`. Delegated `repository_read` and `text_import` still reached the unavailable Linux directory guard while the corresponding direct Service reads could succeed.

**Current disposition:** Coordinator implemented guarded forwarding with checks before and after the await. `review-09-planning-read-green.log` records exit 0 with 42 tests. The new API keeps descriptor aliases inside its own read scope and returns the original logical source path.

### IR-04: Actual crash matrix omitted two dispatch/result gaps

**Original gap:** The original eight crash points did not exercise process death after M02 effect admission but before the nested DISPATCHED projection, or after a read returned but before its private result committed.

**Current disposition:** Fixed in the inspected source with `call.effect_committed` and `call.read_returned` boundaries and real SIGKILL cases. `review-13-crash-gaps-green.log` records exit 0 with 33 replay tests. Uncertain dispatched reads are not retried.

### IR-05: Replay diagnostics did not identify the changed field

**Finding:** A single combined error described source, runtime fingerprint or tool registry drift. This did not tell the user which incompatibility had actually occurred.

**Current disposition:** Assigned for field-specific diagnostics and regression assertions. Final immutable-cut review must inspect the resulting messages and test evidence. It must retain the original result reference without exposing source text or private result values.

### IR-06: Python writable-directory preflight was unbounded after cancellation

**Finding:** `PythonProgramWorker.verifyRuntime()` recursively scanned the guest-writable cwd without an entry/depth limit or abort checks. The host could reject the cell at its deadline while continuing to traverse files created by a prior cell.

**Current disposition:** Assigned for explicit structure bounds and per-entry cancellation checks. The final cut must demonstrate that a timed-out or stopped scan cannot continue dispatching work or start source later.

### IR-07: M12 crash recovery depended on unrelated M02 exposure flags

**Finding:** M12 always records M02 effects, but `Service.recover()` called `recoverEffects()` only when `audit.effectsV1` or `security.authorityV1` was enabled. `ToolPrograms.recover()` only updated the program projection. A crashed M12 nested call and parent effect could therefore remain DISPATCHED after restart or flag rollback.

**Current disposition:** Reported and pending coordinator repair at this report's cut. Recover M12-owned calls and effects even when all feature flags are off. Preserve confirmed result receipts, mark unresolved dispatches UNKNOWN, and never redispatch them. A recovery fixture must seed dispatched M12 records with M02 flags false.

### IR-08: Concurrent kernel key changes can retain two executors for one owner

**Finding in the post-IR-01 source:** Start with READY kernel A. Concurrent create(B) and create(C) use different tool-set keys. B awaits stopping A; C sees A already STOPPED and persists C; B resumes without reserving or rechecking the owner's selected kernel and persists B. Each per-record activation comparison succeeds.

**Independent reproduction:** The current-cut controlled-factory probe produced kernel A STOPPED, C READY, B READY, `liveOwnedExecutors=2`, and one stopped old executor.

A second, sequential reproduction needs no race: create A, create B with a changed tool set (which stops A), then reset A. Observed A READY at generation 2 and B READY at generation 1, with two owned executors. Reset of an old displayed kernel must therefore participate in the same owner-scoped selection rule.

**Current disposition:** Reported and pending coordinator repair at this report's cut. Selection and activation need an owner-scoped admission fence or serialized lifecycle, including create/reset interactions. Test two distinct key changes while stopping an existing kernel, and the corresponding Reset race.

### IR-09: Reset during input preparation leaves the old cell PREPARED

**Finding:** `PythonKernels.cell` initially records RUNNING with a null active program ID, then awaits `ToolPrograms.prepare`. If Stop or Reset occurs during an input-reference authorization await, it cannot cancel that not-yet-known program. Preparation subsequently persists the program, the kernel generation check correctly rejects dispatch, but the catch path never cancels the new PREPARED record.

**Independent reproduction:** With the actual ToolPrograms manager and controlled delayed input authorization, reset during preparation produced `cellError=KERNEL_RESET_REQUIRED`, the new kernel generation READY, and the previous cell's `programStates=[PREPARED]`. No guest source dispatched. This is a stale activity/state defect, not an authority bypass.

**Current disposition:** Reported for retaining the prepared ID across the failure path and explicitly cancelling it. Stop and Reset during preparation need regression fixtures.

## Deliberately unsupported hard bounds

### End-to-end RPC deadline with noncooperative host reads

The actual QuickJS backend was probed with a synthetic host read that intentionally ignored AbortSignal. Requested program deadline: 300 ms. At the recorded 671 ms checkpoint, the program was FAILED with PROGRAM_DEADLINE, the nested call was UNKNOWN, and its effect was UNKNOWN_EXTERNAL_OUTCOME. The RPC was still pending, as was the host read. After the probe explicitly released that read, both settled at 672 ms and the program remained FAILED.

The conservative receipt and ownership behavior is correct. It does not establish a hard end-to-end RPC deadline or bounded teardown for arbitrary host I/O. The activation evidence must distinguish guest execution/admission bounds from RPC completion and host-read cleanup. Awaited host filesystem calls also cannot promise prompt cancellation on a wedged filesystem.

Retained evidence:

- `independent-review-deadline-probe.mts`: complete isolated reproduction source.
- `independent-review-deadline-observation.json`: measured timings, source hashes, backend proof and command record.
- `../m12-logs/independent-review-01-deadline.log`: bounded real output, exact working directory and exit 0. The successful probe exit verifies the expected negative boundary; it is not a PASS for a hard RPC deadline.

### Aggregate executor memory

The inspected proof metadata now distinguishes QuickJS guest WASM linear memory and Python interpreter address space. Both declare `wholeExecutorMemoryLimitBytes: null`. The 128 MiB ceiling does not cover the entire Node/V8 wrapper, trusted Python supervisor, launcher and host result buffers. No whole-executor 128 MiB claim is supported. `review-07-memory-scope-green.log` records exit 0 with 31 scope/language checks.

## Boundaries that held in the inspected implementation

The host owns SQLite writes. New transaction callbacks are synchronous. Nested tool names come from the finite host-classified read set, require progressive schema disclosure, and are checked against the full owner and definition commitment before dispatch. A server read-only annotation is not sufficient. Executors receive values and callbacks, not Store or credentials.

Private result bytes are absent from snapshot projections, ledger outcomes and event payloads. Worker input authorization is exact-owner and program scoped. Retained UI inspection is a separate authenticated path and revalidates the captured resource grants. A result handle does not renew execution authority.

The QuickJS guest has no ambient Node, filesystem, network, process or module access. Issued call identities and delivered result order are committed before their respective effect/VM boundaries. Replay fails closed on mismatched calls, owners, definitions, deadlines or journal data, and does not repeat uncertain external effects.

The Python supervisor's control descriptor is excluded from guest inheritance. Its pidfd pause acknowledgement checks process start identity, parent, stopped state, a single thread and no descendants. SIGSTOP cannot be caught or blocked by guest code. The syscall filter denies process creation, network socket creation, namespace changes, resource-limit changes and guest signal delivery. The cell deadline stays active until the trusted supervisor confirms quiescence. A forged guest completion frame alone is not treated as process quiescence.

All three product capability flags default false. Native model-only transports continue to receive no program tools. The user-facing Stop and Reset commands remain separate and require the captured owner and kernel generation. Reset does not claim to reverse prior file or remote effects.

## Remaining completion and activation gates

IR-05 through IR-09 require final source inspection and relevant test evidence. A later immutable source cut and fresh required commands must replace the moving-cut status of this report. This review does not waive failed full-suite checks or turn an initial manifest into implementation proof.

The accepted-base M01/M02/M03/M04/M10 prerequisite evidence must be distinguished from local prerequisite subset repairs. In particular, local M04/M10 subset code is not proof that complete reviewed M04/M10 milestones existed on the accepted base.

Linux native Python tests do not prove Windows or installed-desktop execution. Missing actual target-platform checks remain blocked platform gates. Unsupported aggregate-memory and hard host-I/O teardown claims remain unsupported even when pure contract tests pass. Production activation requires independent review and must retain the flags as false while these relevant gates remain open.
