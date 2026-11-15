# M12: blocked prerequisite handoff

## Result

**Source gate: BLOCKED_SOURCE_DRIFT. Verification outcome: FAIL. M12 is not implemented or ready for activation.** This change contains source-audit evidence and a continuation checklist. No executor, Python kernel, replay engine, tool bridge, UI, flag registration, or database migration is introduced. The verification outcome is FAIL because one current prerequisite test failed; this is not relabeled as an expected negative or a passing platform check.

The requested execution contract requires M01, M02, M03, M04, and M10 on the accepted base with reviewed source and current contract tests. M04 and M10 are not integrated on the accepted base. M03 provides an execution-policy decision API, but no concrete approved confinement backend or platform proof. Dependent implementation stops at that boundary. Existing application APIs are not silently substituted for those prerequisites.

The required machine-readable record is [M12-verification.json](M12-verification.json), using the M01 `ImplementationEvidenceV3` contract in `packages/contracts/implementation-evidence.ts`. CORE prerequisite validation failed; the dependent protocol, INTEGRATION, and PLATFORM phases remain blocked. Source inspection, evidence validation, and existing prerequisite test results do not establish an implemented M12 phase.

## Source custody and authorization

| Item | Recorded value |
| --- | --- |
| Requested repository / origin | `https://github.com/Skytuhua/Gen-V1.git` |
| Resolved GitHub repository | `skytuhua-org/Gen-V1`, stable repository ID `1442565952` |
| Accepted base | `origin/main`, `fcaa52f7fcdc9f39420118a79f9a8250ba83c563` |
| Audit ancestor | `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54`, verified ancestor of the accepted base |
| Original checkout | `/workspace/scratch/dbebe44a9817/Gen-V1`, clean `main` at the accepted SHA |
| Isolated worktree | `/workspace/scratch/dbebe44a9817/m12-v3` |
| Branch | `agent/m12-v3` |
| Runtime / package manager | Node `v24.22.1`; declared pnpm `10.30.3`, resolved through `corepack pnpm@10.30.3` |

The working directory initially contained no Gen-V1 checkout. A fresh clone was created and left unchanged; all M12 artifacts are confined to the linked worktree. Other worktrees visible in the shared Git repository are preserved. No checked-in `AGENTS.md` exists at the accepted base; the user's supplied instructions still apply.

The user's surrounding instruction explicitly requests a PR, while the copied execution contract explicitly prohibits pushes. Publication was attempted under the surrounding PR request, but **automatic approval review rejected `git push --set-upstream origin agent/m12-v3` because of the explicit no-push constraint**. The remote branch was not created and no PR was opened. No alternative publication route was attempted.

The reviewed change remains committed locally. Publishing it requires explicit user authorization to override the copied no-push constraint for `agent/m12-v3` and to open a draft PR. The prepared PR title is **M12: record blocked prerequisites and verification failure**, targeting `main`. Merge, deployment, forced ref updates, account changes, and changes to another checkout remain outside authorization.

The [source lock](M12-source-lock.json) records exact defining/test/integration blobs. Historical evidence is retained unchanged. Old records referring to an earlier base are not represented as current verification or independent approval.

## Prerequisite audit

### M01: evidence and baseline machinery exists

`packages/contracts/implementation-evidence.ts` defines strict command, phase, source-lock, dependency, and flag records. `scripts/research-baseline.ts` resolves the declared package manager and records bounded command output and real exit codes. `tests/research-baseline.test.ts` and `tests/m01-m02-compatibility.test.ts` are the relevant evidence/compatibility tests.

The accepted base also retains an older, differently shaped `ImplementationEvidenceV3` in `packages/contracts/execution-profile.ts`. This handoff uses the shared M01 schema; it does not change either schema to make evidence pass. A historical PASS from another SHA or platform is not a current M12 test result.

### M02: ordinary tool authority exists; nested receipt integration remains unproved

`Service.tool(call, ctx)` in `packages/core/service.ts` checks the active run and calls `ToolEffectLedger.invoke` when its constructor-injected M02 flags are enabled. The ledger resolves host-classified definitions, authorizes, admits synchronously, awaits execution outside the transaction, and settles. The host remains the only SQLite writer. `Store.commit` explicitly rejects promise-returning transaction callbacks.

The available `invoke` input is `{ call, ctx, thread, role }`. It does not accept parent invocation identity, receipt metadata, or a per-call abort signal. `admit` accepts `parentInvocationId`, but does not perform the authority check itself. Its current normal caller supplies only `{ call, owner, definition }`. A new program bridge cannot replace the authority path with that lower-level primitive without a reviewed integration contract.

The existing dedupe branch compares thread/run/epoch and arguments, then returns a successful prior outcome before applying the current decision. It does not establish M12's complete owner and definition-digest reattachment rule. This is a source-level compatibility finding, not a newly executed exploit test.

The retained M02 source lock targets `055007ff9ab43fc24cfbc0af76b0b4cea3db473d`. `service.ts`, `tool-authority.ts`, and `capability-flags.ts` differ at the accepted base; the ledger and effect-schema blobs still match. The authority diff adds `verification_declare`, rather than removing the existing API. Fresh nested-call tests and reviewed source compatibility remain necessary. Native Hermes skill calls and internal plugin sub-effects retain their documented coverage gaps.

### M03: policy decisions are not a tested confinement backend

`packages/core/execution-policy.ts` explicitly states that it decides and never launches. It exports `ExecutionBackend`, `selectBackend`, and `evaluateExecution`. There is no production backend implementation or composed consumer in `packages`. Its test backend has a synthetic proof and a mocked `launch`; the successful decision test asserts that launch was not called.

Neither `ExecutionProfileV1` nor `ApprovedLaunch` defines an enforceable executor memory ceiling. The existing process-tree utility kills owned processes, but does not impose filesystem, network, credential, process-escape, or memory confinement. The trusted Hermes worker launch is not an approved interpreter launch for untrusted Python cells.

The retained M03 evidence marks the untrusted-code consumer PARTIAL and native/non-Windows proofs BLOCKED. A transitive VM dependency in the lockfile is not a selected backend, reviewed dependency, or bound-enforcement result. JavaScript and Python execution therefore remain unavailable.

### M04: UI metadata pagination is not progressive tool authority

`discoverCapabilities(args)` in `packages/core/discovery.ts` paginates UI and domain metadata without owner, run, grant, or visibility context. `Service.tool` calls it with arguments alone. `createHostTools` eagerly exposes all supplied full schemas; the Pi worker activates that list at session creation, and the official MCP bridge returns the full list. The current registration boundary explicitly rejects `tool_search`, but the missing prerequisite is the visibility behavior, not that particular tool name.

`tests/context-efficiency.test.ts` tests catalog pagination. `tests/runtime-pi.test.ts` tests eager activation and host dispatch. They do not establish M04 visibility checks for nested programs.

[M04 PR #326](https://github.com/skytuhua-org/Gen-V1/pull/326) was observed as open, draft, and unmerged, with head `9851e2b40b555401a000b0a135048eb684f8b964`. Its handoff states that composer and adapter/history integration remain unfinished. This branch was not fetched, merged, or used as a dependency.

### M10: ordinary data pages are not scoped private result handles

`Service.publishData` stores and returns a full `DataRecord.value`. Domain tools return those records, and the Pi/MCP bridges serialize complete returned values. `Store.snapshot()` includes visible data records. Existing `ui_inspect` pages are thread-scoped public data views; they are not program-private result capabilities with account/workspace/grant-bound retrieval.

The research subsystem does have private captured-source bytes and hash/revision-bound passage reads. Its API serves research sources and UI citations, not generic tool results, program inputs, or nested call receipts. M02 outcome storage and workspace action summaries also lack the required generic private-handle issuance/retrieval contract. None is substituted for M10.

No M10 verification/source-lock artifact or integrated contract was found on this base. Current source and tests were traced to distinguish this from a filename-only search.

## Pinned upstream references

The exact external cuts were inspected through GitHub file and blob reads. The Git blob SHA-1 was independently recomputed from each complete returned UTF-8 source and matched the API blob. These are reference-source observations, not executed confinement or replay tests.

| Label | Pinned source | Verified blob |
| --- | --- | --- |
| B13 | [Pi codemode](https://github.com/earendil-works/pi/blob/827383a15262905f82e418483825a49dbb1adbf5/packages/durable/src/codemode/codemode.ts) | `a20c7842406715ef9111cfbc4a74f42b68ca73aa` |
| B19 | [Hermes persistent kernel](https://github.com/NousResearch/hermes-agent/blob/c9c87fc12b0dd03254dac0e64afc7ca5eea0dd79/tools/code_kernel.py) | `47460c3f4d686d9b42565a56d04fb9e1e6232693` |
| B14 | [Pi MCP servers](https://github.com/earendil-works/pi/blob/827383a15262905f82e418483825a49dbb1adbf5/packages/coding-agent/src/core/mcp-servers.ts) | `002cf56f519490522d81ab1f1f09fc8cc3d304f9` |
| E20 | [Hermes output spill](https://github.com/NousResearch/hermes-agent/blob/1831ce1cfeb517a0b6008f006d09e2d0558439ac/tools/hook_output_spill.py) | `8ec23fc44598246a52111f8912a3d56fcd578349` |
| E03 | [Gen-V1 retained worker baseline](https://github.com/Skytuhua/Gen-V1/blob/a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54/packages/runtime-hermes/worker.py) | Resolved from the audit ancestor in the source-audit record |

Pi's nested-call design is useful reference material, but it does not prove that an unclassified effect cannot repeat if execution precedes its durable result record. Hermes retains Python globals in a process and uses powerful Python facilities. Its RPC allowlist and token are not OS isolation. The inspected spill helper uses private, exclusive, symlink-refusing file creation; those safeguards still do not establish Gen-V1's missing owner-scoped result-handle contract. No upstream implementation was imported or activated.

## Requirement-by-requirement review and continuation order

Every row below is a gate for the requested implementation. **BLOCKED** means no product implementation or passing acceptance result is claimed.

| Prompt requirement | Current disposition and required evidence |
| --- | --- |
| Isolated worktree, exact origin/base/ancestor, preserved checkout | Recorded in the custody log and source lock. No reset, clean, stash, merge, or account change. |
| Reviewed M01/M02/M03/M04/M10 on accepted base | BLOCKED_SOURCE_DRIFT. M04/M10 absent; current M02 nested integration and M03 backend proof unavailable. |
| Read package/lock/architecture/targets/call sites/tests; protect proposed paths | Relevant sources and test behavior inspected and blob-pinned. All six proposed M12 files are absent and were left uncreated. |
| `ToolProgramV1` | BLOCKED. Must retain program ID, full owner, language, source/runtime/registry digests, allowed tools, input references, limits, state and result reference. Only host-classified reads may enter V1 batching. |
| `NestedCallV1` | BLOCKED. Must persist parent, stable call key, invocation, argument commitment, result reference, effect class and terminal state. Reattachment requires key, arguments, full owner and definition digest equality. |
| `ProgramJournalV1` | BLOCKED. Must commit deterministic seed/clock, issued-call identities/counts and result delivery order. Fingerprint, order or argument divergence must reject further admissions with `REPLAY_DIVERGED`. |
| `PythonKernelV1` | BLOCKED. Key must cover project, owner/account, interpreter/config, cwd identity, tool set and execution profile; persist generation and READY/RUNNING/RESET_REQUIRED/STOPPED/UNKNOWN. Reset increments generation before a new cell; crash never implies retained variables. |
| Sequence 1: failing synthetic read-only protocol fixtures before VM | NOT_RUN after prerequisite stop. No intentional failing M12 fixture was implemented, and missing dependencies/tests are not relabeled as expected-negative successes. |
| Sequence 2: dedicated JavaScript executor | BLOCKED. Require immutable input values, host-only bridge, no ambient Node/files/network/process/imports/credentials and the M03 execution boundary wherever native access exists. |
| Sequence 3: actual enforced limits | BLOCKED. Verify 30 seconds, 64 calls, four admitted concurrent reads, 256 KiB visible output and 128 MiB executor target. Unsupported hard bounds must remain labeled unsupported; a timer is insufficient. |
| Sequence 4: M02 + M04 nested admission | BLOCKED. Persist stable identities before dispatch, preserve run epoch/account/workspace/grants/cancellation, and reject hidden/write/alternate-account calls before effects. |
| Sequence 5: private intermediate results | BLOCKED on M10. Expose only a user-requested aggregate plus references; range retrieval uses the same grants and preserves source errors/failure state. |
| Sequence 6: replay after working non-replaying executor | BLOCKED. Deliver only after journal commitment; replay completed read receipts, never unclassified mutations. |
| Sequence 7: mismatch/deadline/divergence and crash matrix | BLOCKED. Stop replay, cancel pending owned calls, preserve dispatched-effect uncertainty, and kill processes before/after every journal/call boundary. |
| Sequence 8: Python approved interpreter and confinement | BLOCKED. Installed approved interpreter and actual OS profile must be proven; no credentials or host filesystem beyond the profile. |
| Sequence 9: fresh Python cell budgets and invalidation | BLOCKED. Each cell needs fresh call/output/time budgets and generation binding. Wedges/cancellation kill the owned tree, invalidate variables, and require reset; no previous-cell replay. |
| Sequence 10: exact-owner Stop/Reset and evidence | BLOCKED. Distinct host commands, retained usage/effects, and explicit warning that reset does not undo files or remote effects. |
| Sequence 11: independent experiments and benchmark | BLOCKED. Separate JavaScript/Python flags and an additional replay flag. Fixed aggregation fixtures must measure requests/tools, visible bytes, token/round-trip reduction, quality and failure overhead before exposure. |
| Program card | BLOCKED. Language, allowed tools, elapsed time, call count, cap and state; expanded call graph and retained authorized source handles without secrets. |
| Persistent Python view | BLOCKED. Generation, retained-state status, separate Stop/Reset, and external-effects warning. |
| Replay failure view | BLOCKED. Exact incompatibility and inspectable original result; no blind resume of writes. |
| Negative tests 1-3 | NOT_RUN. Ambient access/hidden tools/account switches; loops/memory/output/fan-out/no orphan; crashes/receipt replay/divergence/nonreplayable effects. |
| Negative tests 4-5 | NOT_RUN. Key changes, owner separation, cancellation/wedge invalidation and reset without replay. |
| Acceptance test 6 | NOT_RUN. No measured aggregation or quality claim exists. No live evaluation endpoint was guessed. |
| Shared finite host registry | BLOCKED. Required keys are `tools.jsReadProgramV1`, `tools.durableReplayExperimentV1`, `tools.pythonKernelV1`, default false. They remain unregistered and unavailable here. No UI preference or agent/plugin enable path was added. |
| Full validation commands and native requirements | See the verification record for actual executed commands versus NOT_RUN gates. Native Windows/installed-desktop proof must run on that target, not Linux mocks. M01 browser baseline remains required. |
| Independent activation review | OPEN. `reviewerApproval` remains false. A draft audit PR does not authorize production activation. |

Once all prerequisite gates are independently satisfied on a newly accepted base, pin that source cut and write the failing protocol fixtures first. Implement and validate the non-replaying JavaScript lane before replay. Python has its own interpreter, confinement, generation and kill-cleanup gate. Do not create placeholder success paths or bypass missing source contracts to advance the checklist.

## Validation interpretation

| Executed command | Exit | Observed result |
| --- | --- | --- |
| `corepack pnpm@10.30.3 --version` | 0 | Exact declared pnpm `10.30.3`. |
| `corepack pnpm@10.30.3 install --frozen-lockfile` | 0 | Existing locked dependencies installed. Repository build-script allowlist preserved. |
| `corepack pnpm@10.30.3 build` | 0 | Production build completed; existing chunk-size warning retained. |
| `corepack pnpm@10.30.3 typecheck` | 0 | TypeScript check passed. |
| Ten prerequisite test files via `vitest run --maxWorkers=2` | 1 | 116 passed, 1 failed, 117 total. Exact argv is in the verification record. |
| Isolated repeat of the failing granted-read test | 1 | Same failure; eight other tests deselected by the name filter, not claimed as tested. |
| `node docs/implementation/v3/M12-verify-evidence.mts` | 0 | M01 schema and source/artifact consistency validated; computed bundle status remains FAIL. |

The failed test is `tests/project-trust-v3.test.ts`, **reading an ordinary granted text file still works while execution approval stays distinct**. It enters `withPathGuard`, which selects the Linux guardian. That guardian requires an inherited broker socket on descriptor 3 and a protected directory descriptor on 4. A separate read-only host diagnostic observed neither required descriptor type. The requested `leaf:true, readOnly:true` form is also outside the current Linux directory-guard validator's supported request shape. The failure is reproducible against unchanged accepted-base source; no guard was bypassed or weakened.

Following the prompt's failure-propagation rule, the dependent `pnpm test`, baseline `pnpm test:browser`, and three M12 target suites were not run after this prerequisite failure. No frontend/browser source was changed. Those commands remain explicit gates, and no skipped or missing suite is treated as a substitute. The earlier build and typecheck passes do not cure that failure.

The authoritative command records distinguish a command that executed from a required suite that passed. Failed attempts are retained with their actual exit codes and bounded logs. A successful source audit or JSON parse is not a runtime acceptance result. The three requested M12 test files do not exist because their dependent implementation phase was stopped.

The first metadata-verifier attempt used the `tsx` CLI and exited 1 because its local IPC socket was denied before the verifier ran. That attempt is retained in `m12-logs/evidence-01-validation.log`. Running the retained verifier with Node's native TypeScript support succeeded without changing permissions or security policy. The verifier is intended to run from this isolated worktree and verifies the original checkout as well as the artifacts; its success is a metadata result only.

The default `pnpm` on PATH resolved to `11.25.0`, which differs from the repository declaration. It was not used for setup or testing. All declared-package-manager attempts use `corepack pnpm@10.30.3`; package and lockfile contents remain unchanged. No runtime dependency was added. The fixed aggregation benchmark, token measurement, quality evaluation, native Windows checks and installed-desktop checks remain unperformed.

## Migration and rollback

Migration status: **NONE**. No production Store rows, schema, preferences, runtime state, or credentials were modified. This branch can be removed or reverted without changing application behavior; keep the audit and failed-attempt receipts available to the next implementation review.

The eventual implemented rollback must first stop admission, cancel owned workers, retain invocation receipts, and invalidate kernel generations. It must never reconstruct a UI by replaying scripts or previous cells, and must never claim that reset or cancellation undoes already dispatched external effects.

The final commit SHA is reported outside files committed in that same commit.
