# M12 independent final engineering review

**Engineering review complete for the recorded source cut. All fourteen reported implementation and evidence findings are addressed. Implementation/platform coverage remains PARTIAL; canonical bundle acceptance is FAIL because required full unit and browser commands fail. Production approval remains false.**

Reviewed repository: `/workspace/scratch/dbebe44a9817/m12-v3`. Accepted base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`. Audit ancestor: `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54`.

The candidate manifest contains 123 exact source entries and 69 changed product/test/configuration paths. The reviewer independently recomputed every worktree Git blob hash, SHA-256 and byte length, and verified all 82 retained accepted-base blobs. No mismatch was found. Candidate manifest SHA-256: `8327bd5b99f29a5153504f993cc201e577543dbf43009b41cab2cf2697110384`. Source-lock SHA-256: `943b2c4f69146c0f864760d8557b429721eca28f3019b28666be01f201dd97b7`.

This is an engineering review of an explicitly hashed working-tree cut, not a claim that the branch is merged, deployed or production-approved. The complete per-file cut, command metadata, finding dispositions and requirement rows are retained in `independent-review-final.json`. Final global validation and the schema-owned `ImplementationEvidenceV3` are separate coordinator gates. Any subsequent source correction requires a source refresh and a review addendum; this record is not silently extended to different bytes.

## Method and scope

The review read the actual host manager, full-owner authority registry, M02 effect ledger, local M04 disclosure and M10 private result subsets, host facade and Service integration, kernel lifecycle manager, QuickJS adapter/worker, Python provider/worker/seccomp/supervisor, descriptor-bound Linux reader, grant wrapper and planning call sites, runtime transport adapters, authenticated result routes and relevant fixtures. The UI specialist separately exercised the browser interaction; the seven new browser cases passed in the inspected log. Manifest hash verification establishes custody of the listed files, not an audit of every unrelated repository subsystem.

Independent probes used isolated temporary stores and synthetic tools or factories, with the actual QuickJS executor where the boundary required it. No live endpoint, user credential, external account, user file, installation, repository-wide test command or git ref mutation was used by this reviewer. The initial review changed only review artifacts. The later IR-12 correction also changed two benchmark metadata fields after the coordinator requested and independently accepted that narrow fix; no product/runtime implementation was edited by this reviewer.

## Resolved findings

All listed findings are closed for this source cut. The original moving-cut report, probe sources, observations, intended failures and failed implementation attempts remain intact. Passing logs below have actual exit code 0 and the isolated repository as their working directory.

### IR-01: Initial Python factory revived a stopped or reset kernel

**FIXED_AND_REVIEWED**. Source: `packages/core/python-kernels.ts`. A deferred initial factory previously overwrote STOPPED with generation-1 READY and retained its executor. Activation now compares the complete captured record inside a host transaction, checks the selected owner admission and stops a late executor.

Evidence: `docs/implementation/v3/m12-logs/python-kernel-19-admission-red.log` then `docs/implementation/v3/m12-logs/python-kernel-20-admission-green.log`.

### IR-02: Falsy rejected source values were recorded as success

**FIXED_AND_REVIEWED**. Source: `packages/core/tool-programs.ts`. The independent throw-undefined probe previously produced a successful null result. An explicit sourceFailed tag now records all rejected values as FAILED; a caught source error cannot make the program aggregate successful.

Evidence: `docs/implementation/v3/m12-logs/review-10-falsy-source-red.log` then `docs/implementation/v3/m12-logs/review-11-falsy-source-green.log`.

### IR-03: Planning omitted the new descriptor-bound read API

**FIXED_AND_REVIEWED**. Source: `packages/core/planning.ts`. Restricted planning DomainContext now forwards readResource with admission checks before and after the await, retaining the original grant and child-run boundaries.

Evidence: `docs/implementation/v3/m12-logs/review-08-planning-read-red.log` then `docs/implementation/v3/m12-logs/review-09-planning-read-green.log`.

### IR-04: Real crash matrix omitted two effect/result boundaries

**FIXED_AND_REVIEWED**. Source: `tests/tool-program-replay-v3.test.ts`. Real SIGKILL cases now cover M02 effect admission before nested DISPATCHED and source return before private-result commitment. The implementation exposes explicit call.effect_committed and call.read_returned boundaries.

Evidence: `docs/implementation/v3/m12-logs/review-12-crash-gaps-red.log` then `docs/implementation/v3/m12-logs/review-13-crash-gaps-green.log`.

### IR-05: Replay diagnostics combined distinct incompatibilities

**FIXED_AND_REVIEWED**. Source: `packages/core/tool-programs.ts`. Source, runtime, registry, journal identity/start/deadline, call arguments/order and issued-count failures now carry exact host-authored diagnoses while retaining the original result handle.

Evidence: `docs/implementation/v3/m12-logs/diagnostics-01-red.log` then `docs/implementation/v3/m12-logs/diagnostics-02-green.log`.

### IR-06: Python preflight traversal continued without structural or cancellation bounds

**FIXED_AND_REVIEWED**. Source: `packages/runtime/python-program-worker.ts`. Private-directory traversal now has 4096-entry/depth-32 limits; runtime-tree traversal has 10000-entry/depth-64 limits. Every asynchronous filesystem boundary checks active cell, cancellation and deadline; streaming hashes are bounded and abortable. Late completion of a pending syscall cannot start another traversal or dispatch.

Evidence: `docs/implementation/v3/m12-logs/python-backend-26-preflight-red.log` then `docs/implementation/v3/m12-logs/python-native-28-review-regression.log`.

### IR-07: M12 crash recovery depended on unrelated M02 exposure flags

**FIXED_AND_REVIEWED**. Source: `packages/core/tool-programs.ts`. Recovery now runs for M12-owned records even with all flags false, validates full parent/call/receipt linkage, settles verified receipts and marks uncertain dispatches UNKNOWN without redispatch. Historical metadata validation exposes no payload and renews no authority.

Evidence: `docs/implementation/v3/m12-logs/recovery-01-red.log` then `docs/implementation/v3/m12-logs/recovery-03-focused-regression.log`.

### IR-08: Concurrent key changes or reset of an old key retained two owner kernels

**FIXED_AND_REVIEWED**. Source: `packages/core/python-kernels.ts`. Independent probes previously retained two READY owned executors. Owner-scoped selection tokens, full-record activation CAS and retained teardown custody now fence create/reset/stop. Reset stops other selected keys before activation; new admission remains blocked while old teardown is pending or failed.

Evidence: `docs/implementation/v3/m12-logs/python-kernel-21-owner-races-red.log` then `docs/implementation/v3/m12-logs/python-kernel-25-custody-green.log`.

### IR-09: Stop or Reset during input preparation left the old cell PREPARED

**FIXED_AND_REVIEWED**. Source: `packages/core/python-kernels.ts`. The cell retains the prepared program ID across its catch path and cancels late preparation even after the kernel generation was superseded. The new generation is not overwritten. Controlled Stop and Reset races dispatch no old source.

Evidence: `docs/implementation/v3/m12-logs/python-kernel-22-prepare-red.log` then `docs/implementation/v3/m12-logs/python-kernel-25-custody-green.log`.

### IR-10: Input references amplified host memory before backend rejection

**FIXED_AND_REVIEWED**. Source: `packages/core/tool-programs.ts`. The independent actual-QuickJS probe materialized 64 distinct decoded copies of one 262158-byte result before rejection. Public and stored references are now unique; preparation authorizes bounded raw receipts without decoding; sequential execution admission limits the entire input array to 4 MiB JSON, 100000 nodes and depth 64. Only the admitted aggregate plus one separately M10-bounded candidate is retained before dispatch.

Evidence: `docs/implementation/v3/m12-logs/input-budget-01-red.log` then `docs/implementation/v3/m12-logs/input-budget-03-focused-regression.log`.

### IR-11: Rejected JavaScript run left a prepared card active

**FIXED_AND_REVIEWED**. Source: `packages/core/tool-program-host.ts`. The host facade retains the prepared program ID and cancels it if run rejects before owning an executor. An actual Service fixture holds the first read, rejects a second command as PROGRAM_BUSY and verifies the second card is CANCELLED.

Evidence: `docs/implementation/v3/m12-logs/review-14-javascript-busy-red.log` then `docs/implementation/v3/m12-logs/review-15-javascript-busy-green.log`.

## Original prompt requirement matrix

`PASS` entries below are scoped to the reviewed implementation and listed evidence. A local native result does not grant platform-wide or production acceptance. `FAIL`, `PARTIAL`, `PENDING` and `UNSUPPORTED` remain visible gates.

| Requirement | Disposition | Evidence and assessment |
| --- | --- | --- |
| EXEC-01 Isolated branch, accepted base and custody | PASS_RECORDED | Source audit records agent/m12-v3, the isolated worktree, original clean checkout, requested origin and canonical repository resolution. Every accepted-base blob in the 123-file cut was independently rechecked. The reviewer made no product/runtime, git-ref or external-account changes; the narrow IR-12 evidence-metadata edit is separately disclosed. Evidence: `docs/implementation/v3/M12-source-audit.json` |
| EXEC-02 M01/M02/M03/M04/M10 prerequisites on accepted base | PARTIAL | M01/M02/M03 definitions exist on accepted base; current touched contracts are pinned. Complete accepted-base M04/M10 milestones are not established. The reviewed local ToolDisclosure and private-result subsets solve the concrete M12 integration boundary but do not retroactively establish full upstream prerequisite acceptance. Evidence: `docs/implementation/v3/M12-source-lock.json` |
| EXEC-03 Read source, call sites, tests and detect API drift/collisions | PASS_SCOPED | The review read actual program/authority/ledger/disclosure/result/kernel/backend/service/transport/read-route code and direct tests. Required integration paths are present in the exact manifest; proposed M12 files were absent at base. Historical drift and original blocked attempts remain retained. Evidence: `docs/implementation/v3/M12-candidate-source-cut.json` |
| EXEC-04 Pinned package manager and dependency review | PASS_SCOPED | pnpm@10.30.3 is declared and the frozen-lockfile command exited 0. QuickJS-WASI is an existing pinned dependency. The new development-only js-tiktoken@1.0.21 is pinned and has retained package/file/lifecycle review; it is absent from the product execution lane. Evidence: `docs/implementation/v3/m12-artifacts/tokenizer-dependency-review.json` |
| EXEC-05 Host SQLite writer and synchronous Store callbacks | PASS_SCOPED | Workers receive JSON values and a checked bridge, never Store. New command/internal callbacks are synchronous; filesystem/process awaits happen outside the host transactions. M02 receipt transitions and private result commitments remain host-owned. Evidence: `packages/core/tool-programs.ts` |
| EXEC-06 Preserve native history, epochs, account pinning and cancellation | PASS_SCOPED | Existing native model-only paths receive no program tools. Full thread/run/epoch/project/workspace/account ownership is compared at admission, delivery, results and lifecycle commands. Run settlement cancels owned programs/kernels; retained UI reading does not renew execution authority. Evidence: `packages/core/service.ts` |
| EXEC-07 Failing fixtures before implementation and stages | PASS_RECORDED | Protocol-before-backend and stage-specific intended-negative logs exist, including all fourteen review fixes. Earlier failures and probes remain separate files and are not rewritten as successful attempts. Evidence: `docs/implementation/v3/m12-logs/protocol-01-red.log` |
| CONTRACT-01 ToolProgramV1 and host-classified read-only tools | PASS | Strict schema includes required identity, source/runtime/registry digests, full owner, tools, unique inputRefs, bounded limits/state/result. The finite host read allowlist requires READ, READ_RETRYABLE, approved executor binding and explicit disclosure; server annotations cannot grant admission. Evidence: `packages/contracts/tool-program.ts`, `packages/core/tool-disclosure.ts` |
| CONTRACT-02 NestedCallV1 and exact reattachment | PASS | Stable key, invocation, argument commitment, result, terminal state and effect class are persisted. Reattachment compares key, arguments, full owner and pinned definition digest, including the parent invocation linkage. Evidence: `packages/core/tool-programs.ts`, `packages/core/tool-effects.ts` |
| CONTRACT-03 ProgramJournalV1 deterministic start/delivery/issued counts | PASS | Start seed/clock/deadline, issued identities and actual VM issued count at every delivery are committed before crossing their boundaries. Changed fingerprint, source, registry, sequence or arguments prevents newly admitted effects. Evidence: `tests/tool-program-replay-v3.test.ts` |
| CONTRACT-04 PythonKernelV1 identity, generations and crash state | PASS_LINUX_SCOPE | Key covers complete owner plus interpreter/config/cwd identity/tool-set/profile. Owner selection and teardown custody prevent two live kernels. Reset increments before new source, clears globals and does not reconstruct variables after crash. Evidence: `packages/core/python-kernels.ts` |
| IMPL-01 Synthetic protocol before VM and dependency pinning | PASS_RECORDED | The missing-implementation protocol negative preceded host implementation and VM tests. Existing locked QuickJS is checked by exact module/WASM hashes; no unpinned runtime package was introduced. Evidence: `docs/implementation/v3/m12-logs/protocol-01-red.log` |
| IMPL-02 Dedicated JavaScript executor and no ambient capabilities | PASS_SCOPED | Actual QuickJS runs in a dedicated Worker/WASM VM with no guest filesystem, network, Node/process/module-loader, imports or credentials. Deeply immutable transferred values and a host bridge are the only inputs. Python/native access additionally uses actual M03 confinement. Evidence: `tests/tool-program-backend-v3.test.ts` |
| IMPL-03 Deadline, calls, concurrency, output and memory | PARTIAL_SUPPORTED_SCOPES | Guest execution/admission uses an original 30-second deadline, at most 64 calls, four admitted reads and a 256 KiB model-result envelope. QuickJS linear memory and Python interpreter address space are each capped at 128 MiB. Whole-executor memory and arbitrary host-I/O/RPC teardown are explicitly unsupported, not inferred from timers. Evidence: `packages/contracts/tool-program.ts`, `independent-review-deadline-observation.json` |
| IMPL-04 Every nested call through M02 and M04 before dispatch | PASS | Durable identities precede effect admission; host authority, exact owner, disclosed tool and definition pin are rechecked before dispatch. Hidden/write/alternate-account/workspace arguments are denied. No native transport bypass is admitted. Evidence: `tests/tool-program-authority-v3.test.ts`, `tests/tool-program-v3.test.ts` |
| IMPL-05 Private handles, explicit aggregates, grant-checked ranges and source errors | PASS | Bulk results and failures remain in private scoped immutable handles with quotas. Only an explicitly named aggregate plus bounded references reaches the model; range reads revalidate grants. All source failures, including falsy rejection values, remain failures even if guest code catches them. Evidence: `packages/core/tool-results.ts`, `tests/tool-program-input-budget-v3.test.ts` |
| IMPL-06 Replay after executor proof and receipt-only delivery | PASS_SCOPED | Non-replaying backend tests and replay tests are separate. Real completed source receipts are reused; uncertain dispatches never rerun. Journal identities and delivery order are committed before effect or VM admission. Replay is JavaScript-only and separately flagged. Evidence: `tests/tool-program-replay-v3.test.ts` |
| IMPL-07 Divergence/deadline failure, owned cancellation and process kills | PASS_SCOPED | Exact drift causes REPLAY_DIVERGED, expired original budget refuses restart, owned calls are cancelled conservatively, and UNKNOWN effects remain inspectable. The real SIGKILL matrix includes ten journal/call/result boundaries; default-off recovery verifies linkage without redispatch. Evidence: `tests/tool-program-recovery-v3.test.ts` |
| IMPL-08 Installed Python, owner process and actual OS confinement | PARTIAL_PLATFORM_APPROVAL | Actual installed Linux x64 interpreter/bwrap/runtime bytes are pinned; M03 profile, namespaces, readonly runtime mounts and default-deny seccomp confine code to its private directory with no host credentials/network/process creation. Native tests have explicit synthetic test approval only. Production operator approval and other target platforms remain unproved. Evidence: `docs/implementation/v3/m12-artifacts/python-runtime-configuration.json` |
| IMPL-09 Fresh cell budgets and wedged-state invalidation | PASS_LINUX_SCOPE | Each cell captures the current kernel generation with fresh source/input/call/output/time budget. Timeout/cancellation stops and waits for the owned process, invalidates variables and requires reset. Trusted supervisor quiescence, rather than guest completion text, controls return to READY. Prior cells are never rerun. Evidence: `tests/python-program-backend-v3.test.ts`, `tests/python-kernel-v3.test.ts` |
| IMPL-10 Exact-owner Stop/Reset and complete evidence ledger | PASS_SCOPED | Host commands require exact retained owner, captured generation and idempotent command identity. Stop and Reset remain distinct; reset warns that external effects persist. Program parent receipts contain usage and every nested read links to that parent receipt. Evidence: `packages/core/tool-program-host.ts`, `packages/core/tool-effects.ts` |
| IMPL-11 Independent flags and measured aggregation benchmark | PASS_FIXED_FIXTURE_ONLY | JavaScript, Python and durable replay have separate default-false host flags. The fixed cursor-dependent aggregation fixture measures actual request/response bytes and offline token encodings, equal exact arithmetic answers and failure inspection overhead. It is not live model evaluation or proof of general task-quality invariance. Evidence: `tests/fixtures/tool-program-benchmark-v3.ts`, `docs/implementation/v3/m12-artifacts/aggregation-benchmark.json`, `docs/implementation/v3/m12-artifacts/benchmark-execution-link.json`, `docs/implementation/v3/m12-logs/final-16-benchmark-after-browser-fixtures.log` |
| UI-01 Program card, call graph and retained handles | PASS_BROWSER_SCOPE | Card includes language, tools, elapsed time, nested count, cap and state. Expanded data exposes metadata/handles rather than private bulk. Range inspection is explicit, paged and escaped. Waiting elapsed time advances and freezes after settlement. Evidence: `apps/web/src/ToolProgramPanel.tsx`, `tests/e2e/tool-programs.spec.ts` |
| UI-02 Kernel generation, retained state, Stop and Reset warning | PASS_BROWSER_SCOPE | Kernel generation and retained-state status are visible. Separate Stop/Reset controls use captured owner/generation. Reset confirmation warns prior files/remote effects are not undone; owner change clears pending inspection and confirmation. Evidence: `tests/e2e/tool-programs.spec.ts` |
| UI-03 Exact replay incompatibility and original result; no blind Resume | PASS_SCOPED | Field-specific host messages and originalResultRef are retained and inspectable. No write replay or blind Resume control is offered. Private guest error messages are replaced with safe host text. Evidence: `tests/tool-program-diagnostics-v3.test.ts`, `apps/web/src/ToolProgramPanel.tsx` |
| NEG-01 Deny ambient access, hidden names and alternate accounts | PASS_LOCAL_BOUNDARIES | Actual QuickJS and native Linux Python tests exercise ambient denials. Contract and Service tests deny hidden/write tools and every owner-binding change before dispatch. Evidence: `tests/tool-program-backend-v3.test.ts`, `tests/python-program-backend-v3.test.ts` |
| NEG-02 Infinite loops, memory/output growth, fan-out and orphan prevention | PARTIAL_SUPPORTED_SCOPES | Real loops/memory/output/fan-out fixtures hit the stated guest/interpreter bounds; worker/process cleanup is verified. The independent noncooperative host-read probe deliberately fails a hard outer-RPC deadline claim. Whole executor memory is unsupported. Evidence: `independent-review-deadline-observation.json`, `tests/python-program-backend-v3.test.ts` |
| NEG-03 Crash boundaries and no duplicated non-replayable effects | PASS_READ_ONLY_SCOPE | Ten actual SIGKILL boundaries and explicit restart tests preserve committed results, reject divergence and never repeat uncertain dispatches. Mutation is denied at admission; no external mutation was executed for testing. Evidence: `tests/tool-program-replay-v3.test.ts`, `tests/tool-program-recovery-v3.test.ts` |
| NEG-04 Kernel key changes and owner isolation | PASS_SCOPED | Interpreter/config/workspace/account/tool-set/profile/cwd identity changes alter or invalidate the kernel key. Full owner checks and owner selection prevent variable reuse across owners and simultaneous key activation. Evidence: `tests/python-kernel-v3.test.ts`, `tests/python-program-integration-v3.test.ts` |
| NEG-05 Cancelled/wedged invalidation and no reset replay | PASS_LINUX_SCOPE | Actual process cancellation/deadlines invalidate globals and require a new generation. Core races cover delayed factory, Stop/Reset during preparation and failed cleanup custody. Reset preserves prior files and never replays cells. Evidence: `tests/python-program-integration-v3.test.ts`, `tests/python-kernel-v3.test.ts` |
| NEG-06 Benchmark counts, bytes, tokens, quality and failure overhead | PASS_FIXED_FIXTURE_ONLY | The retained benchmark includes cold discovery, source calls, requested aggregates, diagnostic range requests, failure state and exact oracle equality. Named cl100k_base/o200k_base counts are measured offline; provider framing/billing and live-model quality are explicitly excluded. Evidence: `docs/implementation/v3/m12-artifacts/aggregation-benchmark.json`, `docs/implementation/v3/m12-artifacts/benchmark-execution-link.json`, `docs/implementation/v3/m12-logs/final-16-benchmark-after-browser-fixtures.log` |
| VERIFY-01 Exact targeted commands and full required validation | FAIL_REQUIRED_FULL_UNIT_AND_BROWSER_GATES | The final 123-file cut passes typecheck, the standalone benchmark and its metadata probe. The latest full unit command, before the five IR-14 fixture edits, exits 1 with 3276 passed, 269 failed, 46 skipped and four unhandled errors. All 269 failed assertion identities also failed on accepted base, with zero candidate-only failures; 211 messages match after worktree-root normalization and 58 differ. This is observed overlap, not universal cause equivalence or a passing gate. The completed full browser command exits 1 with 80 reports, 814 expected, 1001 unexpected and five skipped cases; it spans source edits and is not an immutable-final-cut acceptance run. Current affected fixture reruns preserve three FAIL exits. The latest build and packaging checks pass on unchanged product/build inputs. Evidence: `docs/implementation/v3/m12-logs/final-01-protocol.log`, `docs/implementation/v3/m12-logs/final-06-typecheck.log`, `docs/implementation/v3/m12-logs/final-11-full-test-after-review.log`, `docs/implementation/v3/m12-logs/final-12-typecheck-after-review.log`, `docs/implementation/v3/m12-logs/final-08-build.log`, `docs/implementation/v3/m12-artifacts/unit-baseline-comparison.json`, `docs/implementation/v3/m12-logs/final-15-typecheck-after-browser-fixtures.log`, `docs/implementation/v3/m12-logs/validation-02-browser.log`, `docs/implementation/v3/m12-artifacts/browser-full-summary.json`, `docs/implementation/v3/m12-artifacts/browser-fixture-regression.json` |
| VERIFY-02 Baseline browser suite and actual-platform requirements | PARTIAL | Actual accepted-base and candidate root browser runs both failed, with 33 unexpected cases each and four differing cases per run. All four candidate-only cases passed focused reruns, but both original full failures remain failures. Linux tests do not stand in for Windows or installed desktop. Evidence: `docs/implementation/v3/m12-artifacts/browser-baseline-comparison.json` |
| VERIFY-03 No guessed live evaluation endpoints | PASS_REVIEW_SCOPE | Review probes are isolated local synthetic fixtures; no credential/account or live endpoint was used. Offline workflow/token measurements are explicitly labelled, and no MANIFEST_ONLY artifact is treated as executed integration. Evidence: `docs/implementation/v3/m12-artifacts/aggregation-benchmark.json` |
| ACTIVATE-01 Tested backend before execution; pinned source adapters | PASS_DEFAULT_OFF | Factories verify actual selected backend bytes and live execution probes. Python additionally requires approved installed interpreter and M03 proof. Stable Gen-V1 contracts wrap reimplemented/pinned behavior; upstream durable/kernel modules are not imported wholesale. Evidence: `packages/runtime/tool-program-worker.ts`, `packages/core/python-program-provider.ts` |
| ACTIVATE-02 Only three finite shared host flag keys, default false | PASS | The three exact requested keys are registered in the shared finite registry, absent from strict UI preferences and not agent/plugin writable. Separate language/replay checks prevent one successful proof from enabling all capabilities. Evidence: `packages/core/capability-flags.ts`, `tests/tool-program-v3.test.ts` |
| ROLLBACK-01 Disable admission, cancel ownership, retain receipts, invalidate generations | PASS_SCOPED | Rollback closes admission, cancels programs, waits for owned executors and advances/invalidates kernel generations. Recovery only reconciles records; no script or cell is rerun to rebuild a UI view. Private receipts and uncertain effects are retained. Noncooperative host I/O may delay cleanup, explicitly unsupported. Evidence: `packages/core/tool-programs.ts`, `packages/core/python-kernels.ts`, `packages/core/service.ts` |
| HANDOFF-01 ImplementationEvidenceV3, complete source/log artifacts and honest bundle result | PENDING_COORDINATOR_FINAL_GATE | The final schema-owned verification/handoff is a separate coordinator deliverable. It must retain failed attempts, migration/rollback status and exact contract versions, distinguish CORE/INTEGRATION/PLATFORM, report canonical bundle FAIL while required full unit/browser failures remain, and distinguish PARTIAL implementation/platform coverage from approval. The final commit SHA stays outside its own commit. This review artifact is not a replacement evidence manifest. Evidence: `packages/contracts/implementation-evidence.ts`, `docs/implementation/v3/M12-verification.json` |
| EXEC-08 Distributable public/runtime source closure including non-static assets | PASS_SCOPED | The exact reviewed manifest admits the complete M12 public/runtime source closure, explicit JS/Python worker assets and browser/test inputs. Unknown files remain denied. Only the reviewed tokenizer dependency metadata is added from the evidence tree, source-only. All 13 existing and added public-source checks pass. Evidence: `scripts/public-source-files.json`, `tests/public-source.test.ts`, `docs/implementation/v3/m12-logs/packaging-04-public-source-final-green.log`, `docs/implementation/v3/m12-artifacts/public-source-manifest-additions.json` |
| VERIFY-04 Browser fixture API compatibility and every changed browser path | PASS_CORRECTION_WITH_FAILING_AFFECTED_SUITES | IR-14 corrects five exact fixture files without weakening the production parser or existing unknown-API assertions. Terminal-excerpts passes 10/10, including the formerly conflicting alert and new owner/method/path negatives; conversation-find passes 10/10. Saved-drafts remains FAIL 0/26, WO5 remains FAIL 1/9 and redundant-ui remains FAIL 12/18. The shared capture helper was exercised through actual-App consumers; the capture screenshot workflow was inspected, not rerun. No invalid program-response alert remains in recorded post-fix failure messages. This closes the specific fixture defect, not the full browser gate. Evidence: `docs/implementation/v3/m12-artifacts/ir14-fixture-audit.md`, `docs/implementation/v3/m12-artifacts/browser-fixture-regression.json`, `docs/implementation/v3/m12-logs/fixture-02-terminal-program-response-green.log`, `docs/implementation/v3/m12-logs/fixture-04-conversation-find.log` |

## Boundaries that were verified

The host is the only SQLite writer. New transaction callbacks are synchronous. The worker bridge receives no Store, secret provider, account object or ambient host API. The finite host read classification and progressive disclosure are enforced in addition to exact owner/definition checks. Stable call identities are stored before M02 dispatch, and the VM does not receive a tool result until its journal delivery and issued-call count are committed. Completed receipt replay does not create a second source read; unknown dispatches never repeat.

Private result bytes are absent from public snapshots, event payloads and ledger summaries. Handles require exact owner, program audience and current captured grants. Retained UI inspection is a separate authenticated path and does not revive old run authority. Source failures remain failed even if caught by a script or rejected with an empty/falsy value. Input lists now reject duplicates before authorization, and unique combined input payloads are bounded before the backend receives them.

Python generation admission now includes owner-wide selection and teardown custody. A late factory cannot revive a stopped generation, two key changes cannot retain two owner executors, and a late PREPARED cell is cancelled after Stop or Reset. The trusted supervisor, whose control descriptor is not inherited by guest code, uses pidfd stop control and verifies stopped state, start identity, parent, a single thread and no descendants before a completed cell returns READY. A guest-written completion frame is not process-quiescence proof.

The exact installed Pi SDK was also inspected: `pi-agent-core` 1.4.0 explicitly copies `result.isError === true` from tool execution into its finalized error state. The M12 Pi wrapper therefore preserves failed program status. No defect was raised for that investigated path.

## Unsupported bounds and platform limits

**A hard outer RPC deadline is unsupported for arbitrary host I/O.** The independent actual-QuickJS probe requested 300 ms. At 671 ms, the program was FAILED with PROGRAM_DEADLINE, the nested read was UNKNOWN and its M02 effect was UNKNOWN_EXTERNAL_OUTCOME, but the source promise and RPC were still pending. Releasing the deliberately noncooperative read settled them at 672 ms. This is conservative custody of uncertain work, not proof of 30-second end-to-end completion. A pending OS filesystem call also cannot be made promptly interruptible merely by checking a signal around it.

**Whole-executor 128 MiB memory is unsupported.** The backend proof identifies the actual bounded memory object: QuickJS guest WASM linear memory or Python interpreter address space. Node/V8 wrapper, trusted supervisor, launcher, host result buffers and aggregate RSS are outside that ceiling. Both proofs expose `wholeExecutorMemoryLimitBytes: null`. Python private-file size is limited per file; no aggregate retained-disk quota is claimed.

**Native proof is Linux x64 only and production approval is absent.** The installed interpreter/runtime/bwrap bytes and real confinement are exercised under explicit synthetic test approval. The captured configuration records `operatorApproved: false`. Windows, other native targets and installed desktop requirements need actual target-platform proof. A mock, skip or local Linux success is not a substitute. All three feature flags remain default false.

**Complete accepted-base M04/M10 acceptance is not established.** Reviewed local subsets address the concrete M12 integration APIs but do not assert that full prerequisite milestones already existed on the accepted base. The source audit accurately labels that distinction.

## Benchmark and validation claim limits

The fixed benchmark uses six cursor-dependent source partitions, an authored JavaScript aggregate, actual host request/response envelopes and an exact arithmetic oracle. The retained historical run reduced successful model/host exchanges from six to two including cold discovery, and visible bytes from 140632 to 2108. Its cl100k_base count fell from 26995 to 675 and its o200k_base count from 27001 to 682. The failure fixture preserves FAILED, performs explicit original-source inspection and counts its additional diagnostic exchange. These are measured offline transcript encodings, not billed tokens, live-model latency or general task-quality guarantees. The benchmark carries its own source hashes and must be refreshed for final-cut evidence.

At this review snapshot, the new protocol suite and seven-case M12 browser suite passed. The first final typecheck exited 2 on a new test union-narrowing issue; the coordinator owns its correction and refreshed source cut. Earlier actual accepted-base and candidate root browser runs each had 33 unexpected cases. Four differing candidate-only cases passed focused reruns, but that does not turn either full browser command into a pass. The final typecheck, complete unit suite, build, browser and evidence-verifier outcomes must be reported from their actual final commands.

## Remaining gates

| Gate | Status | Required disposition |
| --- | --- | --- |
| G-PREREQUISITES Full accepted-base M04 and M10 milestones | NOT_ESTABLISHED | Local reviewed required subsets cannot be relabelled as complete prerequisite milestones already accepted on the base. |
| G-MEMORY Whole-executor 128 MiB | UNSUPPORTED | QuickJS WASM linear memory and Python interpreter address space are bounded; Node/V8, supervisor, launcher, host copies and aggregate process-tree RSS are not covered. Both proofs set wholeExecutorMemoryLimitBytes=null. |
| G-HOST-IO Hard 30-second outer RPC and arbitrary host-I/O teardown | UNSUPPORTED | A host read ignoring AbortSignal leaves the RPC waiting after the guest/admission deadline. The receipt becomes UNKNOWN and ownership is retained until cleanup settles. Pending OS filesystem calls are similarly not guaranteed promptly interruptible. |
| G-PLATFORM Windows/native installed desktop and other unmeasured platforms | BLOCKED_UNTESTED_TARGETS | Actual Linux x64 proof is not a Windows, macOS, arm64 or installed-desktop proof. Relevant features remain disabled where no approved tested backend exists. |
| G-OPERATOR Production interpreter/backend activation | NOT_APPROVED | Native test approval is synthetic and limited to fixtures. Captured runtime configuration has operatorApproved=false. All product flags default false. |
| G-REQUIRED-COMMANDS Final complete required validation | FAIL_REQUIRED_UNIT_AND_BROWSER_GATES | Latest full unit exits 1 (3276 pass, 269 fail, 46 skip, four unhandled errors); observed failed-identity overlap with base does not waive it. Full browser exits 1 (814 expected, 1001 unexpected, five skipped across 80 reports) and spans source changes. Final affected-suite reruns still include saved-drafts, WO5 and redundant-ui FAIL. Final-cut typecheck and standalone benchmark pass. Latest build/packaging pass on unchanged product inputs. Final schema-owned evidence remains coordinator-owned. |
| G-BROWSER-BASELINE M01 baseline browser acceptance | FAIL_RETAINED | Actual baseline and candidate root browser commands failed. Focused passing reruns do not replace those full-command results. |
| G-BENCHMARK-SCOPE General task quality, provider billing and live-model evaluation | LIMITED_TO_FIXED_OFFLINE_FIXTURES | The authored cursor-dependent aggregation program and fixed oracle show scoped request/byte/token savings. They do not establish general quality or production model latency/cost. |
| G-PRODUCTION-REVIEW Production activation and release | NOT_APPROVED | This independent engineering review closes the listed implementation findings only. It does not enable flags, approve deployment, waive source compatibility or authorize a production release. |

## Preserved review history

`independent-review-current.md` retains the first moving-cut review, including findings that were still open at that time. `independent-review-deadline-probe.mts` and its observation JSON retain the actual negative deadline boundary. `independent-review-input-amplification-probe.mts` and its observation JSON retain the pre-fix 64-copy host-memory amplification. Their successful probe exit codes mean that the observations were reproduced; they are not passing acceptance results for the defective or unsupported claim.

No final commit SHA is embedded in this report. Engineering review closure does not authorize production activation or deployment. PR publication authorization is separate and derives from the user request. The coordinator must return PARTIAL or the applicable failed gate wherever the evidence does not support full bundle acceptance.

## Final validation addendum

This addendum supersedes the validation-pending wording in the initial review snapshot above. It preserves the earlier observations, including the first typecheck failure, without treating them as the final result. The exact candidate cut is unchanged: source-lock SHA-256 `038834375e6472068e92125015338b1a481de69f8f074ba7a86d141ad654efe6`, candidate-manifest SHA-256 `37b215e6d4a69cf050a4ca3b96382649720ef10e71d6b9c4df1c0cbcd907398f`.

The narrow freeze exception was independently inspected: two benchmark type annotations, a successful-result discriminated-union guard in the input fixture, and documentation of the already implemented input limits. It introduces no product behavior change. All 116 manifest entries and recorded accepted-base blobs were reverified after the refresh.

| Final focused command | Observed result |
| --- | --- |
| `final-01-protocol` | Exit 0; 22 tests |
| `final-02-replay` | Exit 0; 33 tests |
| `final-03-python-kernel` | Exit 0; 21 tests |
| `final-04-core-contracts` | Exit 0; 187 tests across 14 files |
| `final-05-runtime-integration` | Exit 0; 172 tests across 11 files |
| `final-10-typecheck` | Exit 0; complete typecheck |
| `final-09-program-browser` | Exit 0; 7 actual Chromium cases |

The five focused unit/integration commands cover 435 tests in 28 distinct files, with no repeated test file across those commands. Final typecheck passes; the earlier exit-2 attempt remains retained. These scoped passes do not replace the required complete unit/browser commands or waive their failures.

The aggregation benchmark has now been regenerated with provenance matching the reviewed source. Every source SHA-256 recorded by that benchmark was independently compared to the current file. An exact copy is retained as `independent-review-benchmark-snapshot.json` so later runs cannot erase this review observation. Its run still shows six to two exchanges, six reads on both successful paths, exact equal aggregate answers, and 140632 to 2108 visible bytes. Failure remains FAILED on both paths; explicit original-source inspection and its extra exchange are counted. Token encodings and precise failure byte/token totals are preserved in the snapshot rather than substituted with the historical figures above.

Input admission is a retained-data bound, not an RSS claim. The host retains at most the accepted 4 MiB/100000-node/depth-64 array plus one separately bounded M10 candidate while inspecting it; JSON escaping of text can create a transient expansion. That does not establish a total process-memory ceiling.

The review also read the current `M12-build-evidence.py` and `M12-verify-evidence.mts`. The generator separates actual command statuses from blocked platform scopes and retained historical attempts. The verifier checks M01 schema, exact current source/contract blobs, command headers and exits, log/artifact integrity, disabled finite flags, changed-file inventory and original checkout custody. Its own successful validation means that the evidence is internally consistent; it does not turn a failing bundle into PASS.

No implementation finding remains open in this cut. Full accepted-base M04/M10 acceptance, unsupported aggregate memory/host-I/O deadlines, actual unmeasured platforms and production operator approval remain distinct gates. Canonical overall acceptance is FAIL when the required full unit or browser commands fail, even if those failures also reproduce on the accepted base. Production approval remains false.

## Preserved IR-12 and IR-13 source rebind snapshot

The following snapshot records the 11:54 UTC handoff before IR-14. Its prior source cut and validation-pending statements are historical; the final IR-14 addendum below supersedes them.

**All thirteen findings are closed for the final 118-file cut. Canonical bundle acceptance is FAIL because the required full unit command still fails. Platform coverage remains PARTIAL; production approval remains false.**

This section supersedes earlier source-cut and validation-pending snapshots. Their exact prior files remain preserved as `pre-ir12-source-cut.json` and `pre-ir12-independent-review-final.md` / `.json`; prior benchmark snapshots and failed attempts are unchanged. The final candidate manifest is `e6183f4ed56219611b7bd3352aa5d8412aced6d933380f7a85390fb2b9078ee1`; its source-lock digest is `ba19359635f62964e9b95fa1fa8c010b3e05bcfae6430ae8a2a7968dc772cb8d`. All 118 current worktree blob hashes, SHA-256 values and lengths, and every retained accepted-base blob, were independently reverified. The only delta from the preserved prior cut is the benchmark metadata correction plus the newly audited packaging manifest and its tests.

### IR-12: Observed-command attribution in benchmark provenance

The original `provenance.command` contained a hardcoded standalone recipe even when a combined suite or full test command wrote the measurement. Counts and source hashes were measured, but that field was misleading launch attribution. The coordinator identified the defect. After the read-only probe recorded its intended assertion failure, the reviewer renamed the field to `reproductionCommand` and added the explicit recipe-versus-recorder note. This is an evidence-only fixture correction.

The recorded standalone run `final-13-benchmark` passed 1/1 using the exact pinned command. Its enclosing command ran from 11:50:37.614665 to 11:50:45.759995 UTC; the measured benchmark interval from 11:50:39.471 to 11:50:45.709 UTC lies inside it. `benchmark-execution-link.json` binds the actual command record, log digest, working directory, exit, complete measurement bytes and final source cut. The final benchmark SHA-256 is `1402e7af70de4cc86f43b2715b4fe745a73a51e153851e35d6d96f842b363238`; an immutable review copy is retained as `independent-review-benchmark-final-snapshot.json`.

`review-16-benchmark-provenance-red.log` preserves exit 1 at the specific misleading-command assertion. `review-17-benchmark-provenance-green.log` records exit 0 after correction. The observed launch is never inferred from a Vitest worker argument list. The verifier now requires the final review's complete cut binding, all eighteen benchmark source-map keys, current source hashes, the explicit dependency-review artifact exception, and the matching actual execution link.

### IR-13: Finite public-source packaging omitted M12 inputs

The complete unit run exposed four real distribution/import-closure regressions. `scripts/public-source-files.json` now adds exactly 42 reviewed source paths and 17 runtime paths. Runtime entries include the new host/contracts/read/provider modules, JavaScript child worker, and Python worker/confinement/supervisor files. Explicit tests cover those non-static assets because import-closure checks alone cannot prove their admission.

The UI, CSS, browser/unit fixtures and safe tokenizer dependency-review metadata remain source-only. No source was removed; no wildcard, discovery grant or packaging-policy relaxation was introduced. Unknown native assets still fail admission. Existing staged host/browser/desktop build, local import closure, sorted uniqueness and runtime-subset checks remain intact. `packaging-01-public-source-red.log` and `packaging-03-token-review-red.log` retain the intended failures; `packaging-04-public-source-final-green.log` records all 13 checks passing. The final manifest blob is `5b9124fd049e065e54f2d246b7c1e14894330a37`; the test blob is `ee41c9109e677bc73fb6191413797826df5edfc0`.

### Validation observed at the IR-12/IR-13 snapshot

| Command | Actual outcome |
| --- | --- |
| `final-11-full-test-after-review` | Exit 1; 3276 passed, 269 failed, 46 skipped; four unhandled errors |
| `final-12-typecheck-after-review` | Exit 0 |
| `final-08-build` | Exit 0 |
| `final-13-benchmark` | Exit 0; 1/1 benchmark case |
| `review-17-benchmark-provenance-green` | Exit 0; metadata assertion passes |
| `packaging-04-public-source-final-green` | Exit 0; 13/13 packaging checks |

The exact full-unit comparison finds zero candidate-only failed assertion identities. All 269 failed identities also failed on the accepted base. Of their messages, 211 match after worktree-root-only normalization and 58 differ. This proves observed overlap, not a shared cause for every failure and not a passing full-suite gate. Four baseline failures now pass. The previously candidate-only dock case passed the later full run and an unchanged isolated rerun; its original timeout remains retained and resource contention is not asserted as its cause.

The complete outer browser run was still active when this review handed back; its eventual exit, any newly found defect, artifact summary and final schema-owned evidence remain coordinator responsibilities. The new M12 Chromium suite's 7/7 result remains a scoped UI proof. No remaining failed or unrun global/platform gate is converted into PASS by this engineering review.

## Final IR-14 source rebind and completed browser evidence

**All fourteen findings are closed for the final 123-file cut. Required full unit and browser gates remain FAIL. Implementation/platform coverage remains PARTIAL and production approval remains false.**

This addendum supersedes earlier source-cut and browser-pending statements without deleting their evidence. The exact prior cut and review are retained in `pre-ir14-source-cut.json`, `pre-ir14-independent-review-final.json` and `pre-ir14-independent-review-final.md`. The final candidate SHA-256 is `8327bd5b99f29a5153504f993cc201e577543dbf43009b41cab2cf2697110384` and source-lock digest is `943b2c4f69146c0f864760d8557b429721eca28f3019b28666be01f201dd97b7`. All 123 worktree hashes and lengths, plus all 82 retained base blobs, were independently reverified. The delta from the prior 118-file cut is exactly the five reviewed browser fixture files.

### IR-14: Browser fixture contract correction

**FIXED_AND_REVIEWED**. The shared capture helper and independent terminal, saved-drafts and conversation-find handlers previously returned generic HTTP 200 JSON for the new program-list request. The strict production parser rejected that shape and displayed an extra alert. WO5 separately rejected the exact new read path. The correction supplies the empty disabled contract only for exact encoded known-snapshot-thread GET list paths without queries. Unknown or malformed owners, trailing/nested paths and query variants return 404; writes to a known list return 405 with `Allow: GET`. WO5 admits only the exact known-thread GET before its unchanged finite allowlist and unexpected-path abort.

No production API, parser, runtime, feature flag, style, timeout, retry, browser channel or unrelated assertion changed. The existing synthetic 503 path retains precedence. `frontend.spec.ts` remains unchanged because its explicit 404 already follows the panel's unavailable branch. The terminal suite now includes actual browser checks for known and unknown owners, missing owners, nested/trailing paths, queries and write methods.

The intended red run retained the original two-alert rejection and new route-boundary failure, plus an animation-count assertion. The corrected terminal suite passes all ten cases, including both M12 regressions. The animation case also passes on rerun; no separate causal explanation is asserted.

| Affected suite | Observed result | Exit | Passing cases | Failing cases |
| --- | --- | ---: | ---: | ---: |
| terminal-excerpts | PASS | 0 | 10 | 0 |
| conversation-find | PASS | 0 | 10 | 0 |
| saved-drafts | FAIL | 1 | 0 | 26 |
| wo5-app-integration | FAIL | 1 | 1 | 8 |
| redundant-ui | FAIL | 1 | 12 | 6 |

The review checked actual command headers, log digests and raw report hashes for the red run and all five reruns. No recorded post-fix failed-case message contains the invalid program-response alert. WO5's three unknown-API assertions now contain only `/api/projects/capture-project/checkpoints/capability`; its terminal-to-composer case passes. The first saved-drafts failure has the verified pre-existing `Drafts` versus `Saved drafts` selector mismatch, and its production component is byte-identical to accepted base. Other failures retain their individual evidence; no universal cause or pass is inferred. Shared-helper consumers exercise the actual App; the capture screenshot workflow itself was inspected and not rerun.

The complete audit is `ir14-fixture-audit.md` (SHA-256 `fecf93fbd50b7a05a89f9bd90d82677e38ec81c288922f472e309a2cbe799587`), with all attempts, exact command/report identities and original-to-rerun transitions in `browser-fixture-regression.json` (SHA-256 `820868448ff36833661eafae2a7eb56b328b8cca9cf04bbf7ae792f298c46a47`). Closing this specific fixture defect does not pass the affected-suite or complete-browser gate.

### Final-cut typecheck and benchmark attribution

`final-15-typecheck-after-browser-fixtures` exits 0. The fresh standalone `final-16-benchmark-after-browser-fixtures` exits 0 with 1/1 test, and `final-17-benchmark-provenance-after-browser-fixtures` exits 0. The benchmark measured interval 12:06:00.206 through 12:06:06.549 UTC lies inside the actual recorded launch interval 12:05:58.661295 through 12:06:06.613724 UTC. All eighteen recorded source hashes match current bytes; the seventeen code/config inputs also match the final source cut, and the one permitted dependency-review artifact matches its independent digest.

The current benchmark SHA-256 is `f8737fbd2ea20b6c685b88458715cc86ca0d0d90f136bf4922bb0e613caa0be5`. `benchmark-execution-link.json` SHA-256 is `a574565ed7171f758f37ac3f37a33bacb08f8747398e451297ad1041b88cf117` and binds that measurement to the actual command, cwd, times, exit and final 123-file cut. Exact review copies are retained in `independent-review-benchmark-post-ir14-snapshot.json` and `independent-review-benchmark-post-ir14-link.json`; earlier snapshots remain unchanged. The static `reproductionCommand` is explicitly a recipe, not invented launch attribution.

The fixed success fixture retains six reads and the exact arithmetic answer while reducing six scripted exchanges to two, including discovery, and 140632 visible bytes to 2108. Actual offline cl100k counts are 26995 to 677 and o200k counts are 27001 to 684. The source-failure fixture stays FAILED with no partial answer, three reads and three exchanges on both paths; it records 47133 to 2503 visible bytes, cl100k 9072 to 754, and o200k 9075 to 767. Explicit retained-error inspection is included without rerunning the source. Opaque identities and elapsed fields make these exact counts run-specific. No provider billing, live model quality or production latency claim follows from them.

### Completed full browser command and acceptance

The full `validation-02-browser` command completed with exit 1. Its eighty reports contain sixteen passing and sixty-four failing suites, with 814 expected, 1001 unexpected and five skipped cases. Missing Chrome and Edge binaries account for 270 and 524 classified cases respectively; 174 other error cases and 33 timeouts are separately retained. The missing binaries are failures in the actual command, not substituted passing or skipped checks.

That long invocation began before later source freezes and spanned edits. It is retained FAIL evidence, not proof that every suite ran against one immutable final cut. The exact-source affected fixture reruns above and the existing separate M12 Chromium 7/7 provide scoped evidence only. The latest complete unit command remains exit 1 with 3276 passed, 269 failed, 46 skipped and four unhandled errors; its accepted-base overlap does not waive those failures. Neither full command is relabelled as PASS by successful evidence processing.

No listed implementation finding remains open for the recorded bytes. Full prerequisite acceptance, unsupported whole-executor memory and arbitrary host-I/O deadlines, unmeasured platforms, production operator approval and the required failing global gates remain explicit. The coordinator owns the final schema evidence and publication decisions. All three feature flags remain false.
