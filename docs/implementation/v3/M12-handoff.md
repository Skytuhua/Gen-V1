# M12 implementation handoff

## Result and current evidence boundary

**Canonical bundle result: FAIL. Implementation and platform coverage: PARTIAL. Production approval: false.** M12 now implements the bounded host program lane, checked QuickJS execution, owner-scoped confined Python kernels, the separate durable JavaScript replay experiment, private result handling, transport integration and inspection UI. The required full unit and full browser commands both failed. Passing focused suites and overlapping baseline failures do not waive those gates.

CORE has passing focused contract, authority, recovery and lifecycle checks, with the required full unit gate still FAIL. INTEGRATION has scoped Service, transport, native-read and M12 Chromium proof, while complete browser validation and three affected legacy suites remain FAIL. PLATFORM evidence covers the measured Linux x64 boundaries only; other target platforms, aggregate executor memory and hard host-I/O completion remain unproved or unsupported.

All three M12 capability defaults remain false: `tools.jsReadProgramV1`, `tools.durableReplayExperimentV1` and `tools.pythonKernelV1`. No model, UI preference or plugin command can enable them. The host must supply an explicitly selected backend in addition to its capability flag. Python additionally requires the existing M03 policy, approved runtime configuration and actual platform proof. Test approval fixtures do not constitute production approval.

After publication, a fresh target-branch check found that `main` had advanced beyond the accepted base to `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42`. The changed Service and StartRun APIs introduce a separate **BLOCKED_SOURCE_DRIFT** gate. The reviewed implementation and its test results remain bound to accepted base `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`; they are not proof of compatibility with the newer target. [Draft PR #355](https://github.com/skytuhua-org/Gen-V1/pull/355) is open with conflicts and is not merge-ready. This documentation follow-up preserves the existing product/source cut.

This handoff supersedes the original audit-only handoff. Its exact historical copy, earlier blocked prerequisite findings and failed attempts remain under `docs/implementation/v3/m12-artifacts/prior-audit/`. The final source cut contains 123 entries and 69 changed product/test/configuration paths, including the browser fixture corrections. Independent review closes sixteen findings: fourteen previously reviewed findings plus two final evidence-integrity findings. The product source cut remains unchanged by those evidence-only corrections. Source-cut refresh, final typecheck, benchmark rerun and recorded controller validation are complete. The full browser result remains a failure; it began before later source freezes and is a mixed-cut observation, not final-cut acceptance.

Evidence: `docs/implementation/v3/m12-artifacts/independent-review-final.json`, `docs/implementation/v3/m12-artifacts/independent-review-final.md`, `docs/implementation/v3/m12-artifacts/unit-regression-assessment.md`, `docs/implementation/v3/m12-artifacts/browser-full-summary.json`. The canonical `docs/implementation/v3/M12-verification.json` uses ImplementationEvidenceV3 and preserves current passes, required-command failures, unsupported platforms and every historical attempt separately. Controller exit 0 establishes evidence consistency, not bundle acceptance or permission to activate execution.

## Source lineage and prerequisite scope

The isolated worktree is `/workspace/scratch/dbebe44a9817/m12-v3`, branch `agent/m12-v3`. The accepted comparison base is `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`; the audit ancestor is `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54`. The requested origin is `https://github.com/Skytuhua/Gen-V1.git`, resolved to `skytuhua-org/Gen-V1`, repository ID `1442565952`. The original checkout and other worktrees were preserved. Renewed user authorization covered the necessary local prerequisite repairs and continued M12 implementation. This does not establish merge, deployment or production activation.

`docs/implementation/v3/M12-source-lock.json` records accepted dependency commits, retained base blobs, defining contracts, tests and approved local drift. `docs/implementation/v3/M12-source-audit.json` records the dependency distinction below. `docs/implementation/v3/M12-candidate-source-cut.json` identifies exact working-tree bytes through Git blob SHA-1, SHA-256 and byte length, without using a future commit identifier.

| Dependency | Accepted-base status | Local M12 work and limit of the claim |
| --- | --- | --- |
| M01 | Existing evidence and Store contracts | Strict M12 protocol and finite capability registrations use the existing evidence machinery. Store remains the only SQLite writer. |
| M02 | Existing authority and effect ledger | Complete owner/definition matching, parent-attempt linkage, cancellation and private argument/error handling were extended and tested locally. Every nested call uses this authority path. |
| M03 | Existing execution policy and profile contracts | A concrete Python backend is composed through `evaluateExecution`; descriptor-bound Linux granted byte reads were added for the actual read integration. Policy decisions alone are not treated as native confinement proof. |
| M04 | Complete milestone acceptance not established | The local `ToolDisclosure` subset supplies current-owner metadata, explicit schema disclosure, a finite reviewed read set and complete definition digests. It does not accept the whole M04 draft or establish a general upstream discovery milestone. |
| M10 | Complete milestone acceptance not established | The local private-result subset supplies immutable owner/program/grant-bound handles, quotas, atomic receipts and bounded inspection. It does not establish acceptance of the complete M10 milestone. |

The final source-lock digest is `943b2c4f69146c0f864760d8557b429721eca28f3019b28666be01f201dd97b7`; the candidate-manifest SHA-256 is `8327bd5b99f29a5153504f993cc201e577543dbf43009b41cab2cf2697110384`. The cut has 123 entries, comprising 82 retained base-file inspections and 41 new files, with 29 approved drift records and 14 public contract records. It was captured at 12:05:53.795 UTC on 2026-11-15. The prior 118-file cut is preserved in `docs/implementation/v3/m12-artifacts/pre-ir14-source-cut.json`. `docs/implementation/v3/m12-artifacts/ir14-fixture-audit.md` binds the five additional existing browser fixture/test paths to the current cut; the old review is not silently extended to different bytes.

Pinned external Pi and Hermes reference cuts, verified source blobs and their reuse limitations are preserved in `docs/implementation/v3/m12-artifacts/upstream-source-review.md`. Those source observations informed the design; they are separate from native execution evidence. Hermes RPC controls were not substituted for OS confinement, and an upstream replay pattern was not treated as proof that uncertain external effects may be repeated.

## Newly advanced target and source compatibility

A post-publication check found that the target branch had advanced beyond the accepted base. The subsequent source audit compares accepted base `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`, reviewed implementation `d55433f2231597d0efe7515b187e237e11b7ac95` and newly observed main `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42`. The upstream commit timestamp is 12:02:38 UTC on 2026-11-15, before the final source-cut capture at 12:05:53.795 and the initial publication at 12:42:21. Discovery time is not the time the upstream change occurred. The original checkout remains at the accepted base. No merge, rebase, source replacement or force update was performed.

This drift changes behavior. New main adds `StartRun.requestContext`, prepares and claims a request context on the Outbox, and admits exactly one input when the new M04 path is enabled. Immediately before native runtime dispatch it awaits `RequestContextCustody.finalize`, asserts final custody and rechecks current run/account binding. The reviewed M12 Service attaches `programTools` and uses the earlier dispatch path. The new finalizer spreads the original input, so it does not inherently discard M12 metadata. The missing proof is deliberate composition of both APIs, including cancellation and ownership changes across the new await, exact disclosed-tool commitments and both sets of lifecycle cleanup.

New main also adds M09 agent-work recovery and parent-stop obligations. Its request receipt uses a whole-registry commitment; M12 disclosure commits to the selected complete authority definitions. One record cannot substitute for the other simply because both contain an owner and a digest.

| Conflicting integration | Required preservation |
| --- | --- |
| `packages/contracts/index.ts` | Both `requestContext` and `programTools` contracts, with their distinct authority roles. |
| `packages/core/service.ts` | New request-custody admission/finalization and M09 lifecycle, together with M12 tool selection, recovery, cancellation and disposal. |
| `packages/core/capability-flags.ts` | The finite M04/M09 registrations and the three separate default-false M12 registrations. |
| `scripts/public-source-files.json` | Both sets of exact source/runtime entries without weakening finite packaging rules. |

`source-02-current-main-merge-preview` executes Git's worktree/ref-preserving merge preview and records actual exit 1 with these four conflicts. `merge-tree --write-tree` writes unreferenced diagnostic Git objects; it does not change checked-out files or branch references. The resulting conflict tree is diagnostic output, not an accepted implementation tree. `source-03-current-main-audit` checks the exact immutable source blobs and retained conflict evidence. Audit success establishes custody of the mismatch only. No combined M12/new-main runtime or browser tests were run, and the prior accepted-base passes are not transferred to this target.

The canonical phase `INTEGRATION.current-main-source-compatibility` is **BLOCKED**, with the reason **BLOCKED_SOURCE_DRIFT** required by the original execution contract. The exact source map and behavior comparison are retained in `m12-artifacts/current-main-source-drift.json` and `m12-artifacts/current-main-source-drift.md`. The current draft remains unmerged and all execution flags remain disabled. This gate is additional to the already recorded full-suite failures and platform limits.

## Host program lane, authority and private data

`packages/contracts/tool-program.ts` defines strict versioned `ToolProgramV1`, `NestedCallV1`, `ProgramJournalV1` and `PythonKernelV1` records. `packages/core/tool-programs.ts` owns admission, limits, effect receipts, deterministic delivery and recovery. `packages/core/tool-program-host.ts` composes it with disclosure, private results and kernel lifecycle. The executors receive bounded values and callbacks, never Store, database access or host credentials.

The host exposes four canonical metadata entries when the corresponding capability and backend are present: `tool_program_discover`, `tool_program`, `python_cell` and `tool_program_result`. Discovery first returns a small index; requesting up to eight exact names discloses their full schemas. Program admission requires the selected definitions to have been disclosed to the exact current owner. Disclosure grants no resource or account access.

The finite nested-read set is `repository_files`, `repository_read`, `repository_status`, `repository_diff`, `repository_log`, `text_import`, `database_inspect` and `pdf_inspect`. Eligibility additionally requires host classification `READ`, replay class `READ_RETRYABLE`, no approval requirement, the read executor binding, the run role and the current schema digest. A remote server's read-only annotation does not establish eligibility. Configuration can narrow this set. Write tools, hidden names and nested ownership or invocation overrides reject before dispatch.

All six owner fields participate: thread, run, epoch, project, workspace and account binding. Definition commitments include the complete authority definition, not just its parameter schema. Before every nested dispatch, the host checks current owner, disclosure, definition, cancellation, deadline, call budget and resource grants. It registers stable `call:N` identities before dispatch and uses M02 `ToolEffectLedger.invoke`. A nested receipt points to the real parent effect `${programId}:attempt:N`; its call projection separately retains `parentProgramId`. The host semaphore admits at most four actual reads. Source failures, including promises rejected with falsy values, remain failures even if guest code catches them and returns an aggregate.

Program source, requested aggregate instructions, private arguments and intermediate values remain in private host records. Nested effect outcomes and events contain metadata and references. Service's program read context returns private data objects without publishing their values into the ordinary Snapshot data collection. Host transaction callbacks remain synchronous, and asynchronous reads occur outside the transaction.

`packages/core/tool-results.ts` stores immutable revision-1 results with content hashes, byte sizes, source status, full owner, program identity and captured grant commitments. A worker must possess explicit program-scoped input authorization and a current exact owner; a handle by itself does not grant authority. Every result access rechecks the relevant grants. A changed or revoked grant cannot be replaced with newly captured permission to justify an old receipt.

Up to 64 input references must be unique before authorization. Preparation checks bounded raw receipts without materializing their values. Execution decodes sequentially and admits at most 4 MiB of serialized JSON across the entire input array, 100000 JSON nodes and depth 64. This bounds retained input data, not total host RSS: one separately M10-bounded candidate may be inspected alongside the admitted aggregate, and escaping can create transient allocations. Raw retained results have separate limits of 8 MiB each, 64 MiB per program and 128 MiB per thread. These logical payload limits do not bound SQLite, event-log or filesystem overhead.

Authenticated historical UI inspection is deliberately separate from execution authorization. It validates current access to the captured thread/account/project/workspace and the captured grants while retaining the historical run and epoch. It cannot renew a worker's execution authority. Ranges are explicit UTF-8 byte ranges, at most 64 KiB; the UI requests 16 KiB pages. Public model output contains only the explicit aggregate, bounded usage/error metadata and authorized opaque references. Private source errors remain inspectable with their FAILED status.

Evidence: `packages/core/tool-disclosure.ts`, `packages/core/tool-program-tools.ts`, `packages/contracts/tool-results.ts`, `packages/core/service.ts`, `tests/tool-program-authority-v3.test.ts`, `tests/tool-program-prerequisites-v3.test.ts`, `tests/tool-program-input-budget-v3.test.ts`, `tests/tool-program-integration-v3.test.ts`.

## JavaScript executor and replay

The JavaScript implementation uses a dedicated Node Worker containing the exact installed `quickjs-wasi` 3.6.2 engine. It resolves the existing declared dependency of `@earendil-works/pi-coding-agent` 1.4.0 through that package's public entry and then verifies version and executable content pins. It does not select the separate installed 2.2.0 cut, hardcode a pnpm store path or add a new dependency declaration. A future dependency change fails the checked pins.

The installed WASM memory declaration originally had no maximum. A narrow transformation, guarded by the exact original SHA-256, changes only the memory maximum to 2048 pages, or 134217728 bytes. The factory performs an actual worker self-test before issuing a tested proof. Its measured scope is `GUEST_WASM_LINEAR`. The trusted Node/V8 wrapper is outside that scope and is not an OS sandbox; `wholeExecutorMemoryLimitBytes` is null.

The guest has no Node, filesystem, network, process, credential or module-loading API. All WASI functions are overridden; file descriptor operations are denied. The permitted internal bridge imports do not grant ambient host capabilities. Inputs and delivered JSON values are snapshotted and deeply frozen, and captured intrinsics protect parsing, freezing, promise subscription and serialization. Seeded randomness, UTC and a virtual clock driven by committed deliveries support reproducible execution. Native extensions, bytecode import and snapshot restore are unused.

A parent-owned watchdog and AbortSignal interrupt and terminate the actual Worker, including synchronous and endlessly replenished microtask loops. Completion waits for worker termination. The measured memory and loop probes, exact upstream and installed hashes, initial failed attempts and subsequent passing cases are in `docs/implementation/v3/m12-artifacts/javascript-backend-review.md` and adjacent JavaScript artifacts. The later final runtime command includes all 14 backend cases.

Durable replay is an additional JavaScript-only experiment. Ordinary execution and duplicate request handling do not automatically rerun scripts. `commandId` binds one exact request; an uncertain prior request remains uncertain. Python cells never replay.

Replay persists the source/runtime/registry fingerprints, random seed, start clock, original absolute deadline, issued identities and delivery order. The adapter reports its issued count, and the host commits `beforeDelivery` before the guest receives either a value or an error. Completed read receipts are reused only under matching key, arguments, owner and definition. The replay must reproduce the recorded delivery order and counts before continuing beyond that prefix. A dispatched call without a committed result is not retried. A terminal original execution cannot acquire an additional call. Source, runtime, registry, journal, argument/order/count or deadline mismatch stops admission with a field-specific host-authored diagnosis and preserves the original result reference.

Actual SIGKILL fixtures cover ten boundaries: `program.prepared`, `journal.start_committed`, `call.identity_committed`, `call.before_dispatch`, `call.effect_committed`, `call.dispatched`, `call.read_returned`, `call.result_committed`, `journal.delivery_committed` and `program.result_committed`. Recovery validates M12-owned effect/receipt linkage even when M02 and M12 flags are false. It settles verified receipts and marks unresolved dispatches UNKNOWN without executing source again.

Evidence: `packages/runtime/tool-program-worker.ts`, `packages/runtime/tool-program-worker-child.mjs`, `tests/tool-program-replay-v3.test.ts`, `tests/tool-program-recovery-v3.test.ts`, `tests/tool-program-diagnostics-v3.test.ts`, `docs/implementation/v3/m12-artifacts/replay-and-file-read-review.md`, `docs/implementation/v3/m12-logs/final-02-replay.log`.

## Python process, lifecycle and native proof

`packages/core/python-program-provider.ts` composes the real M03 `evaluateExecution` decision with the backend launch handle and persistent executor. The selection must be confined ALLOW for the exact approved backend; TRUSTED_HOST and unrestricted profiles reject. Interpreter, libraries, standard library, bootstrap, supervisor, configuration and profile originate in trusted host composition. Model arguments cannot choose an interpreter, environment, approval or profile.

The measured implementation uses Linux x64, `/usr/bin/python3.13` version 3.13.5 and bubblewrap 0.12 with exact installed content pins. `docs/implementation/v3/m12-artifacts/python-runtime-configuration.json` records the pins and `operatorApproved: false`. Its runtime fingerprint is `651716e63d7ded411b8069d1ef4135d60b1b5d97f8723eb77691ad7f4655ff4e`. Linux namespace, syscall, resource and owned-process probes are retained in `docs/implementation/v3/m12-artifacts/python-backend-review.md`.

The actual boundary combines user, mount, PID, IPC and UTS namespaces with a default-deny seccomp filter. Landlock returned ENOSYS on this host; the network namespace probe failed. Neither is claimed as an active control. Network access is denied through syscall policy. The mounted runtime is pinned and read-only, with exact required dependencies rather than a blanket `/usr` bind. The guest receives an explicitly approved private working directory and a bounded private temporary area, without host `/home`, `/proc`, credentials or general host files. Process creation, exec, sockets, namespace changes, resource-limit changes and guest signal delivery are denied.

The interpreter has a hard RLIMIT_AS ceiling of 128 MiB, including native allocations. The proof scope is `INTERPRETER_ADDRESS_SPACE`, not RSS or the sum of all processes. The trusted supervisor has its own 64 MiB limit after launch; the launcher inherits 128 MiB. No aggregate executor/cgroup memory proof exists. Per-file output and temporary-area controls do not establish an aggregate private-directory disk quota.

The provider key covers the full owner, interpreter/configuration digests, canonical cwd identity, tool registry and execution profile. The protected Store directory participates in configuration identity. A cwd equal to, inside, containing or aliasing protected host storage rejects before launch and on cell revalidation. Fresh cell policy and source admission run under an absolute deadline. Runtime/preflight checks are cancellable and structurally bounded: private cwd at most 4096 nodes/depth 32, runtime tree at most 10000 entries/depth 64. A pending OS filesystem operation may settle after cancellation but cannot start another traversal or later source dispatch.

Each successful cell retains its global variables. `inputs` is immutable, `tools.call(name,args)` synchronously obtains private host results, and the explicit `result` variable is cleared before each cell. Raw stdout is bounded and is not automatically sent to the model. Every cell receives fresh time, call and output quotas and fresh `call:N` identities. Private protocol frames are independently limited to 8 MiB and validated for request identity, generation, shape and active-cell ownership.

Guest-written completion frames are untrusted. A separate trusted supervisor owns a control descriptor that the guest does not inherit. It uses pidfd SIGSTOP and verifies process identity, parent, stopped state, one thread and no descendants before acknowledging quiescence. The old watchdog remains active until that acknowledgement or process exit. Only an explicit next admitted cell can resume the retained process under new policy and budgets. Timeout, cancellation, memory exhaustion, protocol failure or process loss kills the owned tree, waits for exit, invalidates variables and requires Reset.

Kernel lifecycle uses full-record post-factory admission comparisons and an owner selection token across create/reset/stop. Late factories are disposed; competing key changes cannot own two live kernels. Reset of an old selected key first stops the current different key. Teardown custody remains held until cleanup is confirmed. Stop or Reset during asynchronous input preparation cancels the late PREPARED record without dispatching its source. Reset increments generation and never replays prior cells; private files and earlier remote effects are not undone.

The combined native/lifecycle review run passed 60/60 cases: 23 backend, 16 M03/Service provider and 21 kernel cases. Core lifecycle executors are synthetic; backend/provider cases use synthetic operator approval with the real installed confinement boundary and granted file reads. This distinction is recorded in `docs/implementation/v3/m12-logs/python-native-28-review-regression.log` and the Python review. It proves neither another operating system nor production approval.

## Transport and user interface

Service supplies the finite canonical program tool metadata to the supported Pi, official MCP and Hermes paths. The bridge preserves tool failure status and native session/history ownership. Model-only transports and side conversations receive no program tools. The local M04 work does not replace the repository's entire tool-discovery or history architecture.

`apps/web/src/ToolProgramPanel.tsx` shows language, state, elapsed time, selected tools, call count/output cap, nested call details and retained source handles. Polling retrieves metadata, not source bytes. Explicit inspection mounts the paged result reader. Thread or same-thread owner changes clear pending inspection, errors and reset confirmation and reject late responses. Exact replay diagnostics and the original retained result remain visible without exposing source text in metadata.

Stop program, Stop kernel and confirmed Reset are distinct host commands. Kernel commands contain the captured owner and generation; stale generations reject. The reset notice states that variables are cleared, files and prior remote effects remain, and old cells are never replayed. There is no UI flag toggle or execution approval shortcut.

`apps/server/tool-program-routes.ts` registers the list and result-range endpoints behind authenticated same-origin access with `Cache-Control: no-store`. The seven focused Chromium cases passed, including bounded inspection, exact-owner commands, late response rejection, owner switching and overflow/layout checks. That focused fixture did not cover the subsequently observed legacy mock incompatibility. IR-14 corrected those fixture responses without relaxing the production response parser; the complete affected-suite evidence below preserves three failing suites.

Evidence: `tests/tool-program-transport-v3.test.ts`, `tests/e2e/tool-programs.spec.ts`, `docs/implementation/v3/m12-artifacts/browser-tool-programs-final.json`, `docs/implementation/v3/m12-logs/final-09-program-browser.log`.

## Enforced limits and unsupported claims

| Area | Established scope | Remaining limit |
| --- | --- | --- |
| Time | At most 30 seconds per program/cell; independent guest termination and admission watchdogs | No hard end-to-end RPC completion bound for arbitrary noncooperative host reads or wedged filesystem calls |
| Nested reads | At most 64 identities and four admitted concurrent reads; host checks before dispatch | Classification and each handler's resource controls remain necessary |
| Visible output | At most 256 KiB for the complete visible result; bounded frames and stdout handling | Explicit source inspection is separately paged and authorized |
| Input references | Unique, at most 64; combined 4 MiB JSON, 100000 nodes, depth 64 | Logical retained-data bound, not whole-host memory |
| JavaScript memory | Actual 128 MiB WASM linear-memory maximum | Trusted Node/V8 overhead, code metadata and host buffers are outside it |
| Python memory | Actual 128 MiB interpreter address-space ceiling | Supervisor, launcher and host buffers are separate; no aggregate/RSS ceiling |
| Files and storage | Confined Python profile, bounded traversal, per-file/temporary controls and private-result payload quotas | No aggregate Python cwd or total SQLite/event-log disk quota |
| Process cleanup | Actual owned worker/process termination and supervisor quiescence checks on the measured host | Does not prove bounded teardown of an unrelated host I/O callback |
| Platform | Actual Linux x64 Node 24.22.1 and pinned Python boundary; actual available Chromium | Windows, macOS, installed desktop and unavailable Chrome/Edge channels remain unproved |
| Evaluation | Fixed scripted workflow and offline tokenization | No live model accuracy, inference latency, provider billing or production reliability measurement |

The independent noncooperative-read probe requested a 300 ms deadline. At about 671 ms the program was FAILED/PROGRAM_DEADLINE, the call UNKNOWN and the effect UNKNOWN_EXTERNAL_OUTCOME, while both the RPC and ignored-abort host read remained pending. They settled only after the probe released that read at about 672 ms. This supports conservative failure accounting, not a hard host-I/O completion guarantee. Evidence: `docs/implementation/v3/m12-artifacts/independent-review-deadline-observation.json`. Both backend proofs explicitly set `wholeExecutorMemoryLimitBytes: null`.

## Staged implementation and reviewed corrections

The work followed the staged protocol, prerequisites, non-replaying executor, replay, Python, integration/UI and measurement sequence in `docs/implementation/v3/M12-plan.md`. Original failed imports, intended failing assertions, transitional implementation failures and timed-out commands remain retained. A red command is evidence that the missing behavior or defect was reproduced, not a passing negative acceptance gate.

| Stage | Retained red evidence | Subsequent passing evidence |
| --- | --- | --- |
| Protocol | `m12-logs/protocol-01-red.log` | `m12-logs/protocol-02-green.log`; final protocol 22/22 |
| Local prerequisites | `m12-logs/prereq-01-red.log`, `m12-logs/linux-read-02-boundary-red.log` | `m12-logs/prereq-05-edge-green.log`, `m12-logs/linux-read-05-native-green.log` |
| Host and actual JS backend | `m12-logs/program-host-01-red.log`, `m12-artifacts/javascript-backend-red.txt` | `m12-logs/program-host-03-tests.log`, `m12-artifacts/javascript-backend-attempt-2.txt` |
| Replay | `m12-logs/replay-01-red.log`, `m12-logs/replay-04-count-red.log` | `m12-logs/replay-05-green.log`; final replay 33/33 |
| Python | `m12-logs/python-backend-01-red.log`, `m12-logs/python-provider-01-red.log`, `m12-logs/python-backend-11-completion-red.log` | `m12-logs/python-native-28-review-regression.log`, 60/60 |
| Host transport and UI | `m12-logs/integration-01-red.log`, `m12-logs/transport-01-red.log`, `m12-logs/ui-01-red.log` | `m12-logs/transport-04-green.log`, `m12-logs/final-09-program-browser.log` |
| Measurement and packaging | `m12-logs/benchmark-03-red.log`, `m12-logs/packaging-01-public-source-red.log` | `m12-logs/final-16-benchmark-after-browser-fixtures.log`, `m12-logs/packaging-04-public-source-final-green.log` |
| Legacy browser fixture integration | `m12-logs/fixture-01-terminal-program-response-red.log` | `m12-logs/fixture-02-terminal-program-response-green.log`, 10/10 terminal cases; other affected-suite failures remain recorded |

Paths in the stage table are relative to `docs/implementation/v3/`. Historical stage counts are not added to final counts because their tests overlap.

The final independent review closes IR-01 through IR-16. It binds the 123-file product source cut and separately reviews the final evidence-controller bytes. Prior 118-file and fourteen-finding observations remain preserved as historical snapshots. Complete original observations, scope limits and red/green log paths are retained in `docs/implementation/v3/m12-artifacts/independent-review-final.json` and its Markdown companion.

| Finding | Correction and current disposition |
| --- | --- |
| IR-01: late initial Python factory resurrected a stopped kernel | Full admission comparison and late-executor disposal; FIXED_AND_REVIEWED |
| IR-02: falsy source rejection became success | Explicit failure tag preserves every rejected value; FIXED_AND_REVIEWED |
| IR-03: planning omitted descriptor-bound reads | Guarded `readResource` forwarding before/after await; FIXED_AND_REVIEWED |
| IR-04: crash matrix missed two result/effect gaps | Actual effect-admitted and read-returned SIGKILL cases; FIXED_AND_REVIEWED |
| IR-05: replay diagnosis combined incompatible fields | Distinct source/runtime/registry/journal/order/count messages; FIXED_AND_REVIEWED |
| IR-06: Python preflight traversal outlived cancellation without bounds | Entry/depth budgets and per-await cancellation/deadline checks; FIXED_AND_REVIEWED |
| IR-07: M12 recovery depended on unrelated M02 exposure flags | M12 receipt recovery runs with flags false; FIXED_AND_REVIEWED |
| IR-08: concurrent key changes or old-key Reset retained two kernels | Owner selection fence and retained teardown custody; FIXED_AND_REVIEWED |
| IR-09: Stop/Reset during preparation left PREPARED history | Cancel late prepared IDs without dispatch; FIXED_AND_REVIEWED |
| IR-10: repeated input refs amplified host memory | Unique references and sequential combined input budget; FIXED_AND_REVIEWED |
| IR-11: rejected busy JavaScript run left an active card | Host cancels its prepared record when run admission rejects; FIXED_AND_REVIEWED |
| IR-12: benchmark recipe was mislabeled as observed command | Separate `reproductionCommand` from actual recorder/execution-link provenance; FIXED_AND_REVIEWED |
| IR-13: public-source manifest omitted M12 distribution inputs | Exact 42 source/17 runtime additions with native-asset and unknown-source tests; FIXED_AND_REVIEWED |
| IR-14: legacy browser fixture response violated the new panel contract | Exact disabled host fixture contract; terminal and endpoint boundary regressions pass; FIXED_AND_REVIEWED, with three affected suites still FAIL |
| IR-15: regenerated evidence could accept a newly added unreviewed source | Current NUL-delimited source inventory must equal the independent cut and every changed source must have a reviewed entry; actual mutation red/green; FIXED_AND_REVIEWED |
| IR-16: stale temporary command digests overwrote committed audit records | Exact three-record reconciliation against immutable committed bytes; both metadata versions retained and unexplained collisions rejected; FIXED_AND_REVIEWED |

IR-13 retains finite packaging rules, sorted uniqueness, runtime subset and closure checks. It includes the JS child worker, Python worker/confinement/supervisor, host/provider/contracts/read modules, UI/browser fixtures and the exact safe tokenizer dependency-review JSON required by exported tests. No wildcard or unknown-source admission was added. The focused packaging command passed all 13 tests.

IR-14 concerned four legacy `shellRoute` definitions and the wo5 GET allowlist. Generic HTTP 200 fixture data had the wrong list shape, producing an additional invalid-response alert. The corrected shared helper in `scripts/capture-ui/shell-api.ts` and independent helpers in `tests/e2e/terminal-excerpts.spec.ts`, `tests/e2e/saved-drafts.spec.ts` and `tests/e2e/conversation-find.spec.ts` return empty programs/kernels, all capabilities false and the reset notice only for exact encoded known-thread GET list paths without a query. Unknown owners, malformed/nested/trailing paths and query variants return 404; writes to a known list return 405 with `Allow: GET`. The existing synthetic 503 branch remains first. `tests/e2e/wo5-app-integration.spec.ts` admits only those exact GET paths before its unchanged unknown-API recording and abort branch.

The selected terminal red command recorded seven expected and three unexpected cases, including the original duplicate-alert rejection and the new endpoint boundary case. The corrected suite passes all ten. Its additional animation assertion also passed on rerun, without a separate causal claim. The shared helper is exercised through actual-App consumers in wo5 and redundant-ui; the capture screenshot workflow was inspected, not rerun. `frontend.spec.ts` stays unchanged because its existing 404 response already follows the panel's unavailable branch. No production API/parser/style/runtime/flag, existing assertion, timeout, retry or browser channel was weakened. Evidence: `docs/implementation/v3/m12-artifacts/ir14-fixture-audit.md`, `docs/implementation/v3/m12-artifacts/browser-fixture-regression.json` and the retained terminal red/green reports.

## Required commands and observed validation

Recorded commands ran from the isolated worktree with Node 24.22.1 and pnpm 10.30.3. The full test script built its declared credential-lease and widget prerequisites. Windows-only native build prerequisites do not become Linux proof by exiting successfully. Exact argv, working directory, timestamps, exits, truncation and termination are in each log's JSON header. Earlier failed typechecks, original full runs and failed setup attempts remain preserved.

| Required or focused command | Observed result | Evidence under `docs/implementation/v3/` |
| --- | --- | --- |
| `pnpm exec vitest run tests/tool-program-v3.test.ts` | Exit 0; 22 tests | `m12-logs/final-01-protocol.log` |
| `pnpm exec vitest run tests/tool-program-replay-v3.test.ts` | Exit 0; 33 tests | `m12-logs/final-02-replay.log` |
| `pnpm exec vitest run tests/python-kernel-v3.test.ts` | Exit 0; 21 tests | `m12-logs/final-03-python-kernel.log` |
| Core/prerequisite command listed below | Exit 0; 187 tests in 14 files | `m12-logs/final-04-core-contracts.log` |
| Runtime/integration command listed below | Exit 0; 172 tests in 11 files | `m12-logs/final-05-runtime-integration.log` |
| Full unit command listed below | Exit 1; 3276 passed, 269 failed, 46 skipped; four unhandled errors | `m12-logs/final-11-full-test-after-review.log` |
| `corepack pnpm@10.30.3 typecheck` | Exit 0 on the final 123-file cut | `m12-logs/final-15-typecheck-after-browser-fixtures.log` |
| `pnpm build` | Exit 0 | `m12-logs/final-08-build.log` |
| `pnpm test:browser -- --suite tool-programs` | Exit 0; 7 actual Chromium cases | `m12-logs/final-09-program-browser.log` |
| `corepack pnpm@10.30.3 test:browser` | Mixed-cut exit 1; 80 suite reports; counts below | `m12-logs/validation-02-browser.log` |
| `pnpm test:browser -- --suite terminal-excerpts` | Exit 0; 10 cases after the fixture repair | `m12-logs/fixture-02-terminal-program-response-green.log` |
| `pnpm test:browser -- --suite saved-drafts` | Exit 1; 26 failed, zero passed | `m12-logs/fixture-03-saved-drafts.log` |
| `pnpm test:browser -- --suite conversation-find` | Exit 0; 10 cases after the fixture repair | `m12-logs/fixture-04-conversation-find.log` |
| `pnpm test:browser -- --suite wo5-app-integration` | Exit 1; eight failed, one passed | `m12-logs/fixture-05-wo5-app-integration.log` |
| `pnpm test:browser -- --suite redundant-ui` | Exit 1; six failed, 12 passed | `m12-logs/fixture-06-redundant-ui.log` |
| `corepack pnpm@10.30.3 exec vitest run tests/tool-program-benchmark-v3.test.ts` | Exit 0; one measurement test on the final cut | `m12-logs/final-16-benchmark-after-browser-fixtures.log` |
| `python3 docs/implementation/v3/m12-artifacts/benchmark-command-provenance-probe.py` | Exit 0; observed-command provenance check | `m12-logs/final-17-benchmark-provenance-after-browser-fixtures.log` |
| `node --import tsx docs/implementation/v3/M12-verify-evidence.mts` | Exit 0; evidence consistency passes while bundle status remains FAIL | `m12-logs/final-14-evidence-validation.log` |

The five focused unit/integration commands above cover 435 tests across 28 distinct files without repeated test files between those commands. They are scoped passes, not substitutes for the full unit command. The final typecheck completed at 12:06:28.349 UTC; its log SHA-256 is `6ef3bbac640980a333043420b79302f09d62aadedc16ebbbd8ac25ceadfe9982`. Earlier successful and failed typecheck observations remain preserved.

Exact core/prerequisite argv:

```sh
pnpm exec vitest run tests/research-baseline.test.ts tests/m01-m02-compatibility.test.ts tests/tool-authority-v3.test.ts tests/tool-effects-v3.test.ts tests/effect-recovery-v3.test.ts tests/execution-boundary-v3.test.ts tests/project-trust-v3.test.ts tests/secret-custody-v3.test.ts tests/store.test.ts tests/context-efficiency.test.ts tests/tool-program-authority-v3.test.ts tests/tool-program-prerequisites-v3.test.ts tests/linux-bound-read-v3.test.ts tests/linux-path-guard.test.ts --maxWorkers=2
```

Exact runtime/integration argv:

```sh
pnpm exec vitest run tests/tool-program-backend-v3.test.ts tests/python-program-backend-v3.test.ts tests/python-program-integration-v3.test.ts tests/tool-program-integration-v3.test.ts tests/tool-program-transport-v3.test.ts tests/tool-program-diagnostics-v3.test.ts tests/tool-program-recovery-v3.test.ts tests/tool-program-input-budget-v3.test.ts tests/tool-program-benchmark-v3.test.ts tests/hermes-runtime.test.ts tests/planning.test.ts --maxWorkers=2
```

Exact latest full unit argv:

```sh
pnpm test --maxWorkers=2 --reporter=default --reporter=json --reporter=./docs/implementation/v3/m12-artifacts/unit-unhandled-reporter.mjs --outputFile.json=docs/implementation/v3/m12-artifacts/candidate-vitest-after-review.json
```

### Full unit comparison and its limits

| Observation | Total | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Accepted base | 3355 | 3036 | 273 | 46 |
| First candidate, before packaging corrections | 3589 | 3269 | 274 | 46 |
| Candidate after review | 3591 | 3276 | 269 | 46 |

The comparison keys exact relative file path and full test name, retaining duplicate ordinals. All 269 final failed identities also failed on the base; there are zero final candidate-only failed identities. Four baseline failures now pass. All 46 skips remain skips, with no failure converted into a skip. There are 237 added passing names and one removed passing name; one unchanged parameterized test includes a current timestamp in its title and passed both times. Net additional assertions are 236.

Of the 269 matching failures, 211 messages match after normalizing only the worktree roots and 58 differ further. Matching assertion identity does not prove identical underlying cause. The base and candidate used the same installed common dependencies rather than independently reinstalling the base lock. Source was preserved in the base worktree. Its tsx CLI IPC restriction was handled with a source-preserving loader invocation, and generated widget assets were built before the comparison.

Four first-candidate packaging failures were real M12 regressions and were corrected under IR-13. The fifth candidate-only observation was a 60-second plugin dock timeout. It passed the unchanged isolated rerun and later full run; no dock source was changed, and resource contention is not asserted as the cause. Its original failure remains recorded.

The final sidecar records four unhandled rejections from account-login/GitHub private-write tests. Those same tests timed out on the base, and unchanged source shows an existing Linux directory guard rejection before their awaited gates. Baseline JSON omitted unhandled events and its retained log does not establish their count, so baseline unhandled count is unknown, not zero.

Evidence: `docs/implementation/v3/m12-logs/baseline-fcaa52-vitest.json`, `docs/implementation/v3/m12-artifacts/candidate-vitest-after-review.json`, `docs/implementation/v3/m12-artifacts/unit-baseline-comparison.json`, `docs/implementation/v3/m12-artifacts/unit-regression-assessment.json`, `docs/implementation/v3/m12-artifacts/candidate-vitest-unhandled-after-review.json`, `docs/implementation/v3/m12-artifacts/plugin-tools-dock-diagnosis.json`. Before-packaging reports are separately preserved.

### Complete browser result and limited baseline comparison

The complete outer browser command ran from 10:41:51 to 11:57:16 UTC on 2026-11-15 and ended with exit 1 before IR-14 fixture edits. It began before subsequent implementation freezes, so its 80 sequential suite reports describe a mixed working-tree observation. They do not certify the final immutable source cut. All 80 expected suite reports are present: 16 suites passed and 64 failed. Across 1820 cases, Playwright recorded 814 expected, 1001 unexpected and five skipped. Classifications identify 270 missing Chrome binaries, 524 missing Edge binaries, 174 other test/report errors and 33 timeouts. The 207 non-channel failures are not all classified as inherited or environmental.

Only the root browser suite has an accepted-base comparison. Both root observations recorded 79 expected, 33 unexpected and one skipped, but their failure sets differ by four cases each. The four candidate-only root cases passed a focused unchanged rerun. That does not turn either original root command into a pass or establish inheritance for the other 79 suites. IR-14 was a separate confirmed fixture integration defect found in the broader run. After its correction, the five affected suites were rerun with their existing configurations: terminal 10/10 and conversation-find 10/10 passed; saved-drafts 0/26, wo5 1/9 and redundant-ui 12/18 retained FAIL exits, with no skips. The complete 80-suite command was not repeated after this test-only correction.

The IR-14 audit confirms the original authenticated rejection and the new owner/method/path boundary assertions pass; no post-fix failed-case message contains the invalid program-response alert. The first saved-drafts failure uses exact accessible name `Drafts` while the unchanged component renders `Saved drafts`. The selector mismatch exists on the accepted base and the component is byte-identical to that base. Only this observed first failure is attributed to that mismatch; later failures retain their separate evidence, including the fixture server's bounded lifetime. Wo5's three unknown-API assertions now retain only `/api/projects/capture-project/checkpoints/capability`, with the rejected tool-programs entry removed and its terminal-to-composer case passing. Remaining checkpoint, saved-draft, usage and other assertions remain failures. Neither the corrected fixture contract nor these narrow diagnoses convert any nonzero suite exit into PASS.

Evidence: `docs/implementation/v3/m12-artifacts/browser-full-summary.json`, `docs/implementation/v3/m12-artifacts/browser-baseline-comparison.json`, `docs/implementation/v3/m12-artifacts/browser-focused-regression.json`, `docs/implementation/v3/m12-artifacts/browser-fixture-regression.json`, `docs/implementation/v3/m12-artifacts/ir14-fixture-audit.md`. The fixture record preserves every affected case/attempt, original-to-rerun transition, command/log/report hash and bounded failure message. The full summary SHA-256 is `1f194a6520ee2886d50c35baf118982cd35db5a4ccc7581492548fd21505fb87`; its command log SHA-256 is `996c03b14edb929bba7433027b8ec045c2464d68433cd364b8e497887d7aea48`.

## Fixed aggregation measurement

The current measurement in `docs/implementation/v3/m12-artifacts/aggregation-benchmark.json` is `FIXED_SYNTHETIC_WORKFLOW_MEASUREMENT`, with `liveModelEvaluation: false`. It compares a scripted direct-tool controller with one authored JavaScript program through the real checked QuickJS executor and ToolPrograms manager. The dataset has six partitions of 64 orders. Each successful read reveals the next opaque path, creating five information dependencies; the host rejects undisclosed next paths. Independent reads whose paths are already known could be natively batched and are outside this comparison.

| Case and path | Scripted request/response exchanges | Host reads | Visible request + response bytes | Local elapsed ms | State |
| --- | ---: | ---: | ---: | ---: | --- |
| Success, direct | 6 | 6 | 140632 | 41.942 | SUCCEEDED |
| Success, program | 2 | 6 | 2108 | 214.369 | SUCCEEDED |
| Third-source failure, direct | 3 | 3 | 47133 | 5.653 | FAILED |
| Third-source failure, program | 3 | 3 | 2503 | 97.809 | FAILED |

The program's successful two exchanges include cold schema disclosure plus execution. The failure path adds explicit inspection of the retained original failed source, including its 584 visible bytes and extra exchange. It makes no retry and returns no success answer. Both successful paths exactly match the independent arithmetic oracle: 307 paid orders, 77 refunded orders, 1225 sold units and 274750 sales cents, with matching regional totals. Raw rows stay out of the program's model-visible response and public data storage.

| Offline encoding | Success direct / program | Failure direct / program | Program failure diagnostic tokens, already included |
| --- | ---: | ---: | ---: |
| `cl100k_base` | 26995 / 677 | 9072 / 754 | 198 |
| `o200k_base` | 27001 / 684 | 9075 / 767 | 202 |

These are exact offline encodings of the recorded JSON request and response strings using pinned `js-tiktoken` 1.0.21. The transcript includes source, discovery schemas, opaque handles and result envelopes. It excludes common system prompts, preadvertised schemas, final user-facing answers and provider framing. It sends no live LLM request and measures neither billed tokens nor total context, inference latency, model answer quality across tasks or a production success rate. The local program took longer than the direct controller; exchange and visible-byte reductions are the demonstrated benefit in this fixture. Opaque handles and elapsed fields can change exact token counts between runs.

The final standalone command is `final-16-benchmark-after-browser-fixtures`, with the measurement interval 12:06:00.206 to 12:06:06.549 UTC on 2026-11-15. `docs/implementation/v3/m12-artifacts/benchmark-execution-link.json` binds its actual outer command, working directory, timestamp interval, exit 0, log and measured artifact to the final 123-file source cut. The measurement SHA-256 is `f8737fbd2ea20b6c685b88458715cc86ca0d0d90f136bf4922bb0e613caa0be5`; the command log SHA-256 is `897e96dc2302aea78ca04bbb0656522b8ac4957324143eefd25bfb5d0c90fb53`. The subsequent `final-17-benchmark-provenance-after-browser-fixtures` check exited 0. The benchmark's `reproductionCommand` remains a recipe, distinct from observed launch attribution. Pins and safe dependency metadata are in `docs/implementation/v3/m12-artifacts/tokenizer-dependency-review.json`. The previous measurement and execution link remain preserved as `benchmark-before-browser-fixtures.json` and `benchmark-execution-link-before-browser-fixtures.json` in the same artifact directory; their earlier token counts are not the headline figures here.

## Migration, restart and rollback

M12 uses additive versioned entity kinds in the existing Store schema, including program metadata/private source, nested calls, journals, disclosure records, private results/access records, command claims and kernel records. It introduces no destructive SQLite migration or automatic conversion of historical transcripts into program executions. `packages/storage/store.ts` keeps the existing generic entity/event/receipt tables and explicit Snapshot projection; private M12 bodies are not added to that projection.

There is a shared M02 receipt compatibility change: `toolDefinitionCommitment` in `packages/core/tool-effects.ts` now digests the complete `RegistryEntry`. Historical receipts whose `definitionDigest` contains only the older schema digest remain retained, but cannot reattach or be reused under the stronger commitment. Reusing that stale invocation identity rejects with `INVOCATION_CONFLICT`. There is no digest backfill, silent widening of authority, automatic redispatch or destructive SQL migration. Retention of the old receipt is evidence of its historical outcome, not proof of compatibility with the new definition contract.

Activation, if later approved, requires trusted host composition to inject a checked JavaScript executor and/or an explicitly configured Python provider. The three M12 flags remain separate from M03 project-trust and execution-profile policy flags in `packages/core/host-flags.ts`. Runtime pins, allowed profile roots, current platform proof and source compatibility must agree. A boolean in a test or an offline source manifest cannot supply a missing native proof. This handoff does not authorize activation.

Restart recovery does not reconstruct Python variables or replay old cells. It marks lost live kernel state as requiring reset and conservatively settles or marks interrupted program/effect records. Retained result inspection continues only under current authenticated scope and grants. A duplicate request with no confirmed result reports uncertainty and does not repeat it automatically.

The host rollback entry is `Service.disableToolPrograms()`. It stops new admission, closes program and kernel ownership, invalidates retained generations and awaits owned executor cleanup. Cleanup failures are reported rather than treated as confirmed teardown. Reconstructing the host with all M12 flags false keeps tools unavailable. M12 recovery remains active for existing records despite rollback flags, and retained private results/effect receipts are not deleted. Stop and Reset do not undo prior files or remote effects. No model-exposed rollback or flag-write API was added.

Evidence: `packages/core/tool-program-host.ts`, `packages/core/python-kernels.ts`, `packages/core/tool-programs.ts`, `packages/core/service.ts`, `docs/implementation/v3/m12-logs/review-05-rollback-green.log`, `docs/implementation/v3/m12-logs/recovery-03-focused-regression.log`.

## Evidence integrity and final gate

`final-14-evidence-validation` executed the actual controller from the isolated root and exited 0 at 12:20:40.057 UTC on 2026-11-15. Its log digest is `a9d7373e380dbc0faa162b55cb961127705ed03f5b668369afe13b5cf318806f`. The controller validates the strict schemas, original-checkout custody, accepted-base blobs, exact current source bytes, independent review binding, command headers and log digests, artifact hashes, backend source pins, benchmark execution interval and actual launch, finite default-off flags and the complete changed-file inventory. Its output retains `bundleStatus: FAIL` and `activationAuthorized: false`.

Final review found two evidence defects and required actual red/green checks before acceptance. IR-15's reversible probe first observed the old controller accepting an added source file even after the canonical inventory was regenerated. The corrected controller compares the current non-documentation paths to the reviewed cut using the same NUL-delimited, no-renames Git inventory and requires each path in the reviewed file entries. The same probe now sees the exact inventory assertion; it restores canonical bytes and removes only its own captured probe inode. `evidence-03-source-inventory-red` retains exit 1, and `evidence-04-source-inventory-green` records exit 0 with the intentional inner-controller rejection.

IR-16 affected only three older temporary metadata records: `core-01-prerequisite-tests`, `core-02-reproduce-granted-read` and `baseline-02-typecheck`. Their retained logs match both original audit commits byte for byte. Every execution field matches the archived record; only the temporary log digest differs, and appending one LF byte to the retained log reproduces that digest. The operation that produced this byte difference is not established. `command-record-reconciliation.json` preserves both complete records and the precise committed provenance. The builder pins that artifact and accepts only these exact proven collisions, selecting the unchanged archived records. It does not rewrite logs or calculate replacement execution evidence. The original exits remain 1, 1 and 0. `evidence-01-build-record-integrity-red` and `evidence-02-build-record-integrity-green` retain the failed and corrected builder executions.

Canonical evidence is rebuilt after recording the controller's own log and final review artifacts, followed by a fresh read-only controller check of the complete retained bytes. This avoids a self-referential log digest. A successful controller does not replace the failing full unit, full browser or affected-suite outcomes.

The staged source check and the source/documentation whitespace check pass. The all-file check `hygiene-04-retained-log-whitespace` exits 2 because captured test output contains trailing spaces and extra final blank lines. Those exact evidence bytes are preserved. `hygiene-05-source-and-doc-whitespace` excludes only the retained command-log directory and three original JavaScript output transcripts and exits 0; its scope and the failed all-file attempt remain explicit in command history.

Final acceptance remains FAIL, implementation/platform coverage remains PARTIAL, and production/capability approval remains false while the recorded command failures and unsupported or unmeasured scopes remain. No final commit SHA is embedded in this handoff.
