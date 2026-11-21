# M12 JavaScript backend feasibility and installed-cut evidence

Repository: /workspace/scratch/dbebe44a9817/m12-v3

## Decision

The already-installed quickjs-wasi 3.6.2 cut can run the M12 JavaScript backend in a dedicated Node Worker without adding dependencies. Its public API supports the host promise bridge, deterministic WASI overrides, and interrupt polling. Its ordinary memoryLimit option does not cap WebAssembly linear memory. The installed binary has one defined memory with minimum 18 pages and no maximum. A narrow, exact-SHA-256-guarded transformation of that memory declaration establishes a maximum of 2048 pages, or 134217728 bytes. No instructions, imports, exports, or other sections are changed.

The implemented factory performs a live worker self-test before returning tested=true. It does not enable feature flags, grant tool authority, change security policy, or approve production deployment. The host remains responsible for ownership, authorization, durable identities, replay, and the read semaphore.

## Installed and upstream pins

- Root dependency: @earendil-works/pi-coding-agent 1.4.0.
- That parent and its @earendil-works/pi-codemode 1.4.0 dependency both declare quickjs-wasi 3.6.2.
- pnpm-lock.yaml quickjs-wasi@3.6.2 integrity: sha512-FCqGtGOrMgzUiIrMNMA2YnsOxCNwo31dzqXvclXUC6xeT35NJLKXQJsvbeCTjvoFAwZgEAPg8U6+KAPDGXn8Mg==.
- A separate quickjs-wasi 2.2.0 cut exists under proxy dependencies and is not selected.
- Root bare quickjs-wasi resolution is absent under the existing pnpm layout.
- The parent public export offers createCodemodeExtension with mode/inlineBudget/models options, not QuickJS or a generic bounded executor. That factory is not borrowed.
- Production resolution uses import.meta.resolve('@earendil-works/pi-coding-agent'), then createRequire(parentEntry).resolve('quickjs-wasi') and the package's public quickjs.wasm and package.json subpaths. It never hardcodes .pnpm paths.
- This is an explicit reviewed use of an existing parent's declared dependency, not a public re-export guarantee from the parent. A future parent/dependency change fails closed against version and content pins. Promoting quickjs-wasi to a direct dependency would be a manifest/lock review; no such declaration was made.

The upstream quickjs-wasi@3.6.2 tag resolves to commit 5a7a0eeda87c99542f8cf3095b6d61ecfa755977. Exact source files fetched through GitHub:

- https://github.com/vercel-labs/quickjs-wasi/blob/5a7a0eeda87c99542f8cf3095b6d61ecfa755977/src/index.ts (blob 367b67bd8d561888be5a79dc734f555193f3f128)
- https://github.com/vercel-labs/quickjs-wasi/blob/5a7a0eeda87c99542f8cf3095b6d61ecfa755977/src/wasi-shim.ts (blob d5124089542990e6e6e2d5ad5b4d8047879dc1d5)
- https://github.com/vercel-labs/quickjs-wasi/blob/5a7a0eeda87c99542f8cf3095b6d61ecfa755977/Makefile (blob f09b77b8c41c61b879d2cf1dd614a353e16ec6ac)

The default v3.6.2 tag lookup returned 404; the repository uses quickjs-wasi@3.6.2. The tags collection URL was rejected by the GitHub connector; the supported git/matching-refs/tags endpoint successfully resolved the exact commit. No unpinned newer API was substituted. The npm archive itself was not re-downloaded: the lockfile integrity is recorded, while the executable installed files are separately content-pinned.

Executable installed SHA-256 values:

| File | SHA-256 |
|---|---|
| quickjs.wasm, 637405 bytes | d4c9375f2b1ca4dc95f72c8aa2982a7a9951ac8011490d79c6582df732b4bbd9 |
| dist/index.js | 91fcfc11e7f7372f3aee8d4373c0d4f969baac5cd12648663971550054217ae8 |
| dist/extensions.js | 9662299693f6ddd8d56d6e2f91b4bd2202e2cfebe06e834bf9a2b16fa15c4e08 |
| dist/version.js | 14dd0021bd1ba1f786a9833abd01b89c90a4175959d3b37b4d3bb62027a0b38d |
| dist/wasi-shim.js | 79af15cf5158d181d11021158abb22541fd6d35beca569652317859819960eac |

## Actual API used

- QuickJS.create({ wasm: WebAssembly.Module, wasi: (memory) => overrides, memoryLimit, maxStackSize, timezoneOffset, intrinsics, interruptHandler }): Promise<QuickJS>.
- vm.evalCode(source, filename?, flags?): JSValueHandle. Host source compilation requires Intrinsics.EVAL to be initialized. Omitting that intrinsic was tested and causes 'eval is not supported'. The implemented bootstrap removes guest eval/Function and constructor routes after initialization, while host evalCode continues working.
- vm.newFunction(name, callback): JSValueHandle. Callback arguments are borrowed guest handles, not host object references.
- vm.newPromise(): { handle, resolve(handle), reject(handle), settled }. A pending result is retained by the trusted worker, and only committed host delivery resolves/rejects it.
- vm.resolvePromise(handle): Promise<{value: JSValueHandle} | {error: JSValueHandle}>. The installed implementation subscribes using the engine-level promise primitive, without guest Promise.prototype.then lookup.
- vm.executePendingJobs(): number. This drains the entire queue and is not itself a bounded batch. The separate parent watchdog terminates an endlessly replenished queue.
- JSValueHandle.defineProp, isString, toString, getOwnPropertyDescriptor, dispose and vm.callFunction are used for bounded JSON transfer and captured guest intrinsics.
- vm._getMemory(): WebAssembly.Memory is declared as a public internal helper in this exact pinned cut. It is used only for the live hard-memory self-test.

All native extensions, snapshot restore, guest bytecode import, and module loaders remain unused.

## Ambient capability boundary

The verified WASM import whitelist has six internal bridge functions: host_call, host_interrupt, host_promise_rejection, host_module_normalize, host_module_load and host_get_timezone_offset. Its only WASI imports are clock_time_get, random_get, fd_close, fd_fdstat_get, fd_seek and fd_write. No filesystem-open, networking, environment, credentials, argument, or process import exists.

Every WASI import is overridden. fd operations return BADF, including writes; no stdout/stderr descriptors are granted. Clock and randomness read only immutable run start state and committed delivery clock. UTC is fixed. The module loader is absent. The worker has env={}, execArgv=[], argv=[], and captured stdout/stderr that cause a protocol failure if used. The QuickJS guest receives only frozen JSON inputs and the tools.call bridge.

The worker's own trusted Node wrapper is not an OS sandbox. The boundary is guest QuickJS inside the pinned WASM instance, with an explicit host-authorized JSON bridge. The proof enum WASM_NO_HOST_IMPORTS means no ambient host capability imports; it does not mean the binary literally has zero imports.

## Memory and deadline evidence

Probes ran under Node v24.22.1. Initial instantiated memory was 1376256 bytes (21 pages); the raw binary's minimum is 18 pages. The bounded module grew to exactly 134217728 bytes; the next one-page growth threw WebAssembly.Memory.grow(): Maximum memory size exceeded. The guest retained 125829120 bytes of ArrayBuffers and then received InternalError: out of memory; actual WASM linear memory remained 127205376 bytes.

This 128 MiB maximum includes QuickJS allocations and the WASM linear-memory stack, libc allocator, and other data. It excludes trusted Node/V8 wrapper overhead and native compiled-code metadata. The implementation separately configures V8 worker limits of 64 MiB old generation, 8 MiB young generation and 4 MiB native wrapper stack, with bounded source, JSON arguments, private values, and queued deliveries. It does not claim a 128 MiB whole-process RSS limit.

A parent-owned timer and AbortSignal trigger the shared interrupt flag and Worker.terminate(), and completion waits for actual termination. Probe deadlines of 200 ms ended a synchronous infinite loop in 202 ms and an infinite promise-microtask loop in 201 ms. The wrapper never relies on the guest event loop to run its deadline timer.

## Determinism and immutable transfer

Repeated executions with the same seed and virtual clock produced the same Math.random sequence, Date.now, UTC timezone and performance.now. The clock updates only from committed delivery clocks and never goes backwards. WeakRef and FinalizationRegistry are omitted. The implementation also omits Proxy and removes SharedArrayBuffer from the guest.

Inputs are snapshotted synchronously before asynchronous execution. Host values must be plain acyclic JSON without accessors, custom prototypes or hidden properties. Guest inputs and each parsed tool result are recursively frozen; primordials are frozen after bootstrap so guest changes cannot replace the captured parser, freezer, promise subscription or serializer. Guest values cross into the trusted host as bounded JSON strings, never arbitrary V8 object handles.

## Delivery protocol and responsibility split

Worker tools.call emits call:N identities immediately, with a trusted monotonically increasing issued count, up to the run's <=64 call budget. The parent invokes ProgramExecutionRequest.call for every emitted frame immediately. The manager synchronously registers each identity before its first await and owns the <=4 actual-read semaphore. Delaying call registration inside this adapter would invalidate journal issued counts.

Completed host responses queue in arrival order. The adapter offers exactly one key; the worker reports ready-to-deliver with its current issued count after its current drain. The parent awaits beforeDelivery(key,count). Only its successful durable commit permits the parent to send a commit message with value/error and clock. The worker then resolves or rejects the pending VM promise, drains VM jobs, emits newly issued call frames, and finally sends drained. The next offer is sent only after drained.

Failed host promises follow the same handshake. Their bounded original message and code are delivered as a guest Error only after beforeDelivery. Host stacks are never copied. A rejected delivery commit terminates execution without delivering the value/error to the guest. The manager retains private result references and determines the final program status.

## Implemented files and verification

- packages/runtime/tool-program-worker.ts: checked factory, installed content verification, restricted WASM memory transformation, live self-test, independent watchdog, host protocol and lifecycle.
- packages/runtime/tool-program-worker-child.mjs: fresh QuickJS VM, deterministic WASI, immutable bootstrap, JSON bridge and delivery handshake.
- tests/tool-program-backend-v3.test.ts: actual Worker fixtures.

Red phase: 14 fixtures failed because no checked executor was installed. First implementation run: 13 passed, one failed because the package's newError helper writes through the frozen Error.prototype and lost its message. The adapter now uses a captured guest Error constructor defining own fields. The same original-error fixture passed on the next run.

Fresh targeted verification: node node_modules/vitest/vitest.mjs run tests/tool-program-backend-v3.test.ts --maxWorkers=1; 14 tests passed, exit 0, duration 1.80 s. This covers real memory enforcement, absent ambient globals and constructed import denial, input snapshots, deeply frozen private values, deterministic RNG/time, four-call delivery counts, failed-commit exclusion, committed tool errors, prompt registration of twelve identities, call quota, sync and microtask termination, late delivery cancellation, and output-byte bounds.

Evidence files:

- <tmp>/m12-js-probes/inspect-result.json
- <tmp>/m12-js-probes/results.json
- <tmp>/m12-js-probes/backend-red.txt
- <tmp>/m12-js-probes/backend-attempt-1.txt
- <tmp>/m12-js-probes/backend-attempt-2.txt
- <tmp>/m12-js-probes/backend-attempt-2-command.json

An initial pnpm exec invocation used the ambient pnpm 11 wrapper, attempted its automatic install check and aborted on non-TTY before tests. No dependency installation completed. All reported backend test outcomes used the already-installed Vitest entry directly. Repository-wide verification remains the integrating root agent's responsibility; this report does not claim the whole repository suite passed.
