# M12 exact upstream source audit and reuse boundaries

This is a source inspection of four requested immutable cuts. It is not a runtime certification of the upstream projects or their imported dependencies. The first inspection fetched each file and its independent Git blob, compared the full UTF-8 contents, and recomputed the Git blob SHA-1. All four matched. A final file fetch returned the same blob identities. Public web opens returned DisabledError; GitHub connector file/blob reads succeeded. No unpinned substitute API was used.

| Reference | Repository and commit | Path | Verified blob | UTF-8 bytes |
|---|---|---|---|---:|
| B13 | earendil-works/pi, 827383a15262905f82e418483825a49dbb1adbf5 | packages/durable/src/codemode/codemode.ts | a20c7842406715ef9111cfbc4a74f42b68ca73aa | 45251 |
| B19 | NousResearch/hermes-agent, c9c87fc12b0dd03254dac0e64afc7ca5eea0dd79 | tools/code_kernel.py | 47460c3f4d686d9b42565a56d04fb9e1e6232693 | 44245 |
| B14 | earendil-works/pi, 827383a15262905f82e418483825a49dbb1adbf5 | packages/coding-agent/src/core/mcp-servers.ts | 002cf56f519490522d81ab1f1f09fc8cc3d304f9 | 11904 |
| E20 | NousResearch/hermes-agent, 1831ce1cfeb517a0b6008f006d09e2d0558439ac | tools/hook_output_spill.py | 8ec23fc44598246a52111f8912a3d56fcd578349 | 4894 |

## B13: deterministic JavaScript replay

Primary source: https://github.com/earendil-works/pi/blob/827383a15262905f82e418483825a49dbb1adbf5/packages/durable/src/codemode/codemode.ts

The module declares version 2. It stores initial tool descriptions, namespaces, globals, conversation store data, start time, seed, optional deadline, and a sandbox fingerprint. A task-scoped run document stores the decided result; a rerun after that decision returns the result without starting a VM. Task-scoped run and delivery journal documents retire with their task. Conversation store state has separate rewind/fork semantics. These are concrete storage semantics, not a claim that every upstream log is retained indefinitely. See lines 85-172 and 401-455.

Nested calls use stable keys derived from VM call IDs. Results are delivered in the persisted journal order and virtual clock. The runtime reports idle/drain acknowledgements and call counts; the host commits those counts before launching calls covered by them. Replay checks module/fingerprint compatibility, original deadline, call target/name/arguments, initial and post-delivery counts, missing expected calls while idle, and early completion. After the recorded prefix, an interrupted original may continue live. The nested task's own replay policy still controls whether it executes again. This is not a blanket exactly-once guarantee for external effects. See lines 462-508, 612-785 and 819-841.

The directly reusable design ideas are deterministic start state, a durable delivery-before-resume protocol, stable nested identities, independent effect receipts, and count/order comparison. Its exported codemode tool is not an M12 execution boundary. It is supplied the agent's callable tools and invokes the upstream task harness. This cut does not impose M12's owner tuple, reviewed read-only allowlist, 64 calls, four admitted reads, private result grant custody, or 128 MiB hard WASM maximum. Those properties cannot be inferred from the imported sandbox interface.

A materially incompatible result rule appears at lines 276-294: a structured tool result with isError and a structured value resolves successfully into the VM. The detail row can still show an error. M12 must retain a failed source as FAILED even if the script catches or summarizes it. Copying that result conversion would weaken the requested contract. The source also exposes argument/error previews in tool details, which are not M12's metadata-only privacy boundary. No upstream source was copied into the M12 adapter.

## B19: persistent Python kernel lifetime and authority

Primary source: https://github.com/NousResearch/hermes-agent/blob/c9c87fc12b0dd03254dac0e64afc7ca5eea0dd79/tools/code_kernel.py

Cells compile and execute in a persistent GLOBALS namespace; imports and interpreter state survive. One live child is keyed by resolved owner, mode, Python executable path, cwd and sorted tool names. Owner resolution prefers a stable approval session key, qualifies a hosted sandbox, and separates delegated children. The key is not a content digest of the interpreter, environment, execution profile, registry definitions or captured resource grants. See lines 92-115, 421-449 and 887-948.

Each cell gets newly captured context and approval callbacks. CellAuthority is installed for the active cell, rejects dispatch after retirement, and dispatches through the ordinary tool handler. The kernel lock serializes cells, per-cell RPC tool budgets reset, and authority retires on every settlement path. RPC serving threads deliberately do not freeze the spawning cell's authority for their entire lifetime. These are useful lifetime and stale-authority protections. They do not implement M12's exact account/workspace/project/run/epoch identity and durable M02 receipt protocol. See lines 239-294 and 912-948.

The child uses generated tool stubs, a random RPC token, framed stdout, a private staging directory and an owned-process launcher. The source explicitly treats its random stdout marker as framing, not a hostile-Python isolation boundary: the child can forge its own cell result. Timeout or interruption discards and kills the kernel, and reports state loss. Subsequent execution starts a fresh child instead of replaying cells. Lifecycle management includes an idle timeout, a live-kernel cap, delegated-child exceptions, and background reaping. See lines 1-15, 399-415, 633-711 and 777-884.

This file does not establish a hard 128 MiB address-space limit or operating-system filesystem/network/process isolation. Environment construction and the owned-process launcher are imported from other files; reading this cut does not verify their complete behavior. Ordinary Python exec, import, mutable globals, paths, stdout spill, and configurable tool dispatch cannot be reused as the M12 confinement proof. M12 needs an independently tested execution profile, exact executable/configuration fingerprints, an explicit generation, private host result custody, and teardown acknowledgement. No automatic cell replay can be inferred or added.

## B14: MCP exposure is metadata, not execution authority

Primary source: https://github.com/earendil-works/pi/blob/827383a15262905f82e418483825a49dbb1adbf5/packages/coding-agent/src/core/mcp-servers.ts

The file validates and stores MCP registrations; the connecting extension is elsewhere. Exposure distinguishes codemode discovery, deferred model loading, direct declaration and hidden registration. Exact per-tool overrides beat wildcard patterns; the first matching pattern wins; the default is codemode. It validates provider-auth transport constraints and delegates shared MCP configuration validation. The registry replaces registrations by name and uses the extension path when unregistering. Its register method explicitly leaves ownership checks to its caller.

This is a useful reference for progressive disclosure and stable matching rules. It does not authorize a tool call, confine a program, establish read-only risk, bind grants or prevent a callable tool from producing effects. Environment/header/secret expansion and provider credential routing are host integration capabilities described by this configuration, not credentials that an M12 guest should receive. M12 cannot treat exposure or registration alone as permission to execute a nested tool. The parent library's public exports do not provide a generic safe execution boundary merely because it exports a codemode extension factory.

## E20: output spill is a presentation optimization

Primary source: https://github.com/NousResearch/hermes-agent/blob/1831ce1cfeb517a0b6008f006d09e2d0558439ac/tools/hook_output_spill.py

Oversized hook context is measured in characters, with a default threshold of 10000 and default head/tail previews of 500 each. It writes under a configurable base directory and sanitized session segment using a random filename. The file invokes private-permission and exclusive, symlink-refusing write helpers; those helpers are imported and were not part of this four-file audit. I/O failure returns an excerpt without a saved path. Small or disabled payloads remain inline.

This reduces repeated prompt bulk but is not generic private result custody. The preview deliberately exposes selected raw content and a filesystem path. This cut supplies no immutable result hash, exact owner/program access token, grant revalidation, retention bound or bounded range-reading API. The helper name and comments alone do not prove those missing controls. M12's private result references cannot safely be implemented by copying this path-plus-preview pattern.

## Installed executor evidence and separate acceptance boundary

The runnable JavaScript implementation is based on the already-installed, separately pinned quickjs-wasi 3.6.2 API, not the public codemode factory. Its exact lock integrity, upstream tag/commit, executable SHA-256 values, WASM import whitelist, memory-section maximum transformation, live memory self-test, API probes and limitations are in <tmp>/m12-js-feasibility.md. The 128 MiB cap covers QuickJS/WASM linear memory. Trusted Node/V8 wrapper overhead is outside that guest cap and is separately bounded; no whole-process 128 MiB RSS claim is made.

The initial 14-test absent-backend red run, the first 13/14 implementation attempt, and the subsequent 14/14 worker pass remain in <tmp>/m12-js-probes. The historical evidence manifest distinguishes complete original command metadata from the red log's incomplete timestamp metadata. These are retained observations, not recreated passing records.

Current recorded replay verification is separate from the source audit: replay-01-red had seven failures; replay-02-error-red established source/backend error classification failures; replay-04-count-red established a real early-await issued-count mismatch. After the manager fixes, replay-05-green passed 62 tests across actual replay, host protocol, JavaScript backend and Service integration. replay-06-typecheck passed. Eight actual SIGKILL crash boundaries are included. The log/command records are retained under docs/implementation/v3/m12-logs and <tmp>/m12-command-records. These checks do not enable feature flags or grant release approval.
