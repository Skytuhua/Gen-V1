# M12 JavaScript, replay and Linux file-read handoff

All changes are uncommitted in /workspace/scratch/dbebe44a9817/m12-v3. No dependency declarations, lockfile updates, feature-flag enabling, credential policy changes, push or publication were performed by this subagent.

## JavaScript executor

The checked quickjs-wasi 3.6.2 Worker implementation and 14 native backend fixtures are in packages/runtime/tool-program-worker.ts, packages/runtime/tool-program-worker-child.mjs and tests/tool-program-backend-v3.test.ts. Exact installed content pins, upstream commit/blob references, API probes, WASM memory maximum transformation, actual memory/deadline outcomes and limitations are in <tmp>/m12-js-feasibility.md. The guest QuickJS/WASM linear-memory ceiling is 128 MiB; Node/V8 wrapper overhead is separate. Runtime self-test evidence is not release approval.

The original 14-failure absent-executor red log, first 13/14 implementation attempt, and subsequent 14/14 pass remain unchanged under <tmp>/m12-js-probes. <tmp>/m12-js-probes/historical-command-evidence.json records SHA-256 values and the original retained metadata. The red log lacks separately retained absolute timestamp/executable metadata and is explicitly labeled partial historical evidence. The earlier ambient pnpm 11 non-TTY auto-install check failure is retained as an observation, without inventing a missing log or timestamps.

## Real replay and crash recovery

New files are tests/tool-program-replay-v3.test.ts, tests/fixtures/tool-program-crash-v3.mts and tests/fixtures/tool-program-replay-harness-v3.ts. They use the actual checked JavaScript executor, a real SQLite Store, the reviewed repository_read registry entry, and exact explicit owner reopening. They do not instantiate Service to resurrect a lost epoch.

The fixtures verify retained private receipts without extra reads, four-call out-of-order completion and journal-order delivery, repeated random/time values, changed source/runtime/registry/owner/arguments/call sequence/count, early completion, extra calls after a completed original, original absolute deadlines, and caught plus uncaught failed source preservation. Eight child-process hooks execute real SIGKILL: program.prepared, journal.start_committed, call.identity_committed, call.before_dispatch, call.dispatched, call.result_committed, journal.delivery_committed, and program.result_committed. A committed result is reused; DISPATCHED with no result becomes UNKNOWN/UNKNOWN_EXTERNAL_OUTCOME and is never redispatched. PREPARED without a start journal rejects explicit replay; a separate fixture proves an explicit first execution is safe.

Manager fixes in packages/core/tool-programs.ts validate persisted journal schema, identity, original deadline, monotonic counts/clocks, nested identities and receipt consistency before replay admission. Terminal originals cannot extend their call sequence. Host authority/protocol failures abort with their original error instead of becoming a generic backend transport failure. Committed failed source messages remain private, and known backend codes use fixed public text. The replay pump offers a retained receipt in order without waiting for an expected count: the worker's beforeDelivery handshake checks its actual count before VM delivery. An expected out-of-order key that a divergent VM never issues remains bounded by the original absolute deadline; immediate idle-state diagnosis would require an explicit quiescence callback not in this protocol.

Recorded evidence:

| Record | Outcome |
|---|---|
| replay-01-red | 7 failed, 21 passed; lost divergence codes, invalid issued-count stall, and completed replay extension reproduced |
| replay-02-error-red | 3 selected failures; source/backend classification and invalid issued count reproduced |
| replay-03-green-attempt | 56 passed across replay, host protocol and actual JS backend |
| replay-04-count-red | Real early-await/count divergence reproduced as an incorrect deadline result |
| replay-05-green | 62 passed across replay, host protocol, actual JS backend and then-current Service integration |
| replay-06-typecheck | Typecheck exit 0 |

Root subsequently resumed ownership of the manager and changed nested M02 linkage to parent attempt identities. Final verification must use that integrated cut.

## Linux granted-byte read prerequisite

The original failure was a contract-routing defect. packages/core/linux-path-guard.ts and .py implement privileged private-profile directory and credential custody, requiring inherited broker fd3, backing directory fd4, native mount setup and supported directory-only shapes. They deliberately reject file-leaf/readOnly requests. Those files and their credential/mutation semantics remain untouched.

New packages/core/linux-file-read.ts provides a separate ordinary-file descriptor scope. It opens every pathname component with O_NOFOLLOW relative to the preceding retained directory descriptor, opens the leaf read-only and nonblocking, rejects non-regular files and multiple hardlinks, binds captured identities, bounds allocation, and checks file size/mtime/ctime plus every ancestry/storage witness before returning bytes. Cancellation and scope completion close the actual held descriptors. This is a trusted host byte-read capability, not an arbitrary-code sandbox or a replacement for kernel namespace mutation guards. It detects source changes; it does not claim to prevent other processes from modifying the source.

packages/core/file-access.ts adds explicit withBoundFileRead and readResourceGrant APIs. The final readResourceGrant signature is:

    readResourceGrant(grant, dataDir, relativePath, maxBytes, signal)
      -> Promise<{ path: string; bytes: Buffer }>

The returned path is the original canonical logical source path. The proc descriptor alias is confined to the internal read implementation. The existing withResourceGrant and withPathGuard callback contracts remain unchanged. An earlier intermediate implementation passed descriptor aliases to legacy callbacks; the all-call-site review rejected that approach and it was removed before the final native pass.

packages/capabilities/index.ts adds optional DomainContext.readResource and invokes it only for byte-reading helpers. Root wired Service.context.readResource with owner/run checks and an exact grant digest comparison before returning bytes. Source metadata, provenance, basename/dirname/extension and preparation arguments continue using logical source identities.

Call-site audit covered both production direct withResourceGrant users, Service.context and research/capture, plus the DomainContext adapter in planning and all access/readResource uses in capabilities/index.ts. Directory enumeration, Git cwd/metadata, SQLite journal paths, write operations, and research's deny-write namespace lease retain their prior guard APIs. The byte hook covers repository_read, text_import, knowledge source reads, PDF/signature input reads and source reads used in operation preparation. It does not authorize mutation or make a subprocess path portable. Planning's manual restricted DomainContext needs optional hook forwarding with its existing child/run checks; root owns that edit. Existing embedders without the hook keep their prior behavior.

New tests/linux-bound-read-v3.test.ts contains 18 actual filesystem tests, including held descriptor closure, native grant reads, logical metadata preservation, no source mutation, leaf/ancestor/magic-link rejection, identity substitution, hardlinks, in-place edits with restored mtime, unrelated path denial, protected storage aliases, storage ancestry replacement, project-root identity, limits/cancellation, FIFO nonblocking refusal, and continued denial by the original namespace guard. The ordinary-read M03 fixture now uses the explicit byte-read scope while preserving its actual content success assertion.

Recorded evidence:

| Record | Outcome |
|---|---|
| linux-read-01-red | Three real failures: M03 ordinary file read and two Python nested granted reads |
| linux-read-02-boundary-red | 14 failed, 3 passed before the descriptor read API existed |
| linux-read-03-green-attempt | 63 passed, one stale Python parentInvocationId expectation; actual formerly failing reads succeeded |
| linux-read-04-identity-red | Two selected failures before the explicit bytes-plus-logical-path API existed |
| linux-read-05-native-green | 50 passed: 18 descriptor/read tests, 9 project-trust tests, 23 unchanged directory/credential guard tests |
| linux-read-06-typecheck | Failed only because the new fixture used nonexistent grant kind directory; corrected to the actual project kind, with final typecheck delegated to root |
| linux-read-07-integration-green | Transitional FAIL: 64 passed, 7 Python supervisor failures, one unhandled Python rejection while its independent owner was repairing completion/quiescence. All file-read, project-trust, existing guard and JS integration cases passed. The failed record is retained and is not a passing gate |

The Python owner requested no concurrent rerun during that repair. Root owns final stable-cut verification. Every recorded attempt has its retained bounded log under docs/implementation/v3/m12-logs and command metadata under <tmp>/m12-command-records.

## Exact external-source report

<tmp>/m12-source-reference-audit.md contains the four requested Pi/Hermes commit and verified blob cuts, their observed replay/kernel/disclosure/spill behavior, and specific unsafe reuse boundaries. Source verification is distinct from native runtime proof and from release approval.

## Final integrated validation addendum

The preceding text is the retained stage handoff. Its eight-boundary crash matrix and pending planning forwarding describe that earlier source snapshot. The final frozen source now contains ten actual SIGKILL boundaries: `program.prepared`, `journal.start_committed`, `call.identity_committed`, `call.before_dispatch`, `call.effect_committed`, `call.dispatched`, `call.read_returned`, `call.result_committed`, `journal.delivery_committed`, and `program.result_committed`. The two added cases close the effect-admission and source-return gaps found during independent review.

The exact required replay command passed all 33 cases in `m12-logs/final-02-replay.log`. The final core-contract command passed 187 cases across 14 files, including the granted-byte reader, project trust and unchanged directory/credential guard contracts. The runtime command passed 172 cases across 11 files, including all 14 actual JavaScript backend cases, real Python Service reads, and planning's before/after ownership checks for the forwarded read API. Those results are in `m12-logs/final-04-core-contracts.log` and `m12-logs/final-05-runtime-integration.log`. The corrected final typecheck passed in `m12-logs/final-10-typecheck.log`; earlier type and transitional failures remain unchanged.

The durable copies of the stage reports are `m12-artifacts/javascript-backend-review.md` and `m12-artifacts/upstream-source-review.md`. Historical JavaScript probe logs and metadata are retained beside them. The exact final source cut and independent disposition are in `M12-candidate-source-cut.json` and `m12-artifacts/independent-review-final.json`. Final repository-wide command outcomes belong to `M12-verification.json`, not to the historical pass counts above. No production flag is enabled.
