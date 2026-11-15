# M14: prerequisite audit and implementation handoff

**Product implementation: BLOCKED. Product acceptance: NOT_RUN.** This delivery contains a source audit, independent tests of the existing evidence gates, and the information needed to resume. It does not implement conversation branching, historical snapshots or archive import. No production module, public session schema, frontend path, database migration or capability flag is changed.

**Verification bundle: FAIL.** The full direct Vitest run completed with 244 failed tests and four unhandled errors. Those failures remain failures; the successful focused checks do not override them.

| Current validation | Observed result |
| --- | --- |
| Frozen installation, Node v24.22.1, pnpm 10.30.3 | PASS; dependency and lockfile declarations unchanged |
| Existing M01 compatibility and independent M14 evidence checks | 34 tests passed, including six new synthetic evidence-gate tests |
| Existing M02, Store, account and history/reader contracts | 191 tests passed across 11 files |
| Typecheck and production build | PASS; the build was repeated successfully with nested pnpm also pinned to 10.30.3 |
| Required M14 branch/import commands | Both exit 1 because the deferred product test files do not exist; no intended-red product assertion ran |
| `pnpm test` | Exit 1 before tests: the tsx CLI cannot open its Unix IPC socket in this environment |
| Direct full Vitest attempt | Exit 1: 2,860 passed, 244 failed, 45 skipped; 62 failed files, 259 passed files, three skipped files; four unhandled errors |
| `pnpm test:browser` | Exit 1 before tests at the same tsx IPC boundary |
| M01 root browser suite through `node --import tsx` | Exit 1 on missing native `node-pty` module during setup; zero test outcomes, two setup errors |
| Native Windows and installed-desktop requirements | NOT_RUN on this Linux host |

The full-suite output includes Linux path-guard denials, skill-catalog fixture failures and timeouts. This audit does not claim that every failure has one cause or that they have all been reproduced on another environment. Production sources are unchanged, and the failures remain release gates. The default test/browser entrypoints and the direct-loader attempts are retained separately. No build allowlist or sandbox restriction was relaxed.

The M14 execution contract requires M01, M02, M04 and M05 on the accepted base, with reviewed evidence and current contract tests. M04 and M05 are unverified on this base. Dependent implementation stops at that boundary. The prompt permits independent pure tests to continue; [the M14 evidence tests](../../../tests/m14-evidence-gates.test.ts) exercise existing evidence validation using explicitly synthetic records. They do not substitute for any M14 acceptance test.

## Source custody

| Item | Recorded value |
| --- | --- |
| Repository | `Skytuhua/Gen-V1`, origin `https://github.com/Skytuhua/Gen-V1.git` |
| Canonical remote identity | `skytuhua-org/Gen-V1`, repository ID `1442565952`, verified through the existing GitHub connection |
| Original checkout | `/workspace/scratch/dbebe44a9817/Gen-V1` |
| Isolated worktree | `/workspace/scratch/c4abb425a583/m14-v3` |
| Branch | `agent/m14-v3` |
| Accepted base | `fcaa52f7fcdc9f39420118a79f9a8250ba83c563` |
| Audit ancestor | `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54` |
| Declared package manager | `pnpm@10.30.3`, resolved through `corepack pnpm` |

The original checkout and the separate M12 worktree are outside this bundle's edit scope. [The M14 verification record](M14-verification.json) is authoritative for observed commands, exit codes, bounded logs, source locks, changed files and remaining gates. Historical evidence in other bundles is retained without relabeling it as this run's result. The final commit SHA belongs in the external handoff, not in a file contained by that commit.

All six named integration targets exist. Comparing them to the audit ancestor found a Claude history UTF-8 decoding fix and Hermes native-tool coverage comments, with no changed target API. Missing M14 capabilities are baseline gaps, not evidence of `BLOCKED_SOURCE_DRIFT`. A later change to an accepted integration contract must still stop its affected phase under that code.

| Inspected target | Blob at accepted base |
| --- | --- |
| [Official history helper](../../../packages/runtime-official/history.ts) | `fc36a267358ebdd4bffa378b9755b8684b73a4b6` |
| [Pi task sessions](../../../packages/runtime-pi/session.ts) | `1446dd0312e021a4010f2454ba248441b8b2c579` |
| [Hermes worker](../../../packages/runtime-hermes/worker.py) | `e28c6272f9aab28f76b9462a87768fe4226361c1` |
| [Personal conversation read models](../../../packages/core/conversation-read-models.ts) | `93d6f9a26685c936444e272fc6dd26f25211ea75` |
| [SQLite Store](../../../packages/storage/store.ts) | `ebab3cba8d56e074d0377623bffd2054790f622b` |
| [Conversation reader](../../../apps/web/src/conversation-workspace/reader.ts) | `fcf2d5c3f0a13801e99e1786a69de54ac40fc8c6` |

## Dependency boundary

| Dependency | Source and retained evidence | Limitation for M14 |
| --- | --- | --- |
| M01 | [Shared ImplementationEvidenceV3](../../../packages/contracts/implementation-evidence.ts), [M01 verification](M01-verification.json), [research baseline tests](../../../tests/research-baseline.test.ts) | Existing source and evidence are present. The retained evidence describes an older Windows base, failed unit/browser baseline cases, missing native build prerequisites and manifest-only evaluations. Its recorded phase successes must be read with the actual failing commands. It is not fresh M14 baseline or platform proof. |
| M02 | [Tool authority](../../../packages/core/tool-authority.ts), [tool effects](../../../packages/core/tool-effects.ts), [host flags](../../../packages/core/capability-flags.ts), [M02 verification](M02-verification.json), [compatibility test](../../../tests/m01-m02-compatibility.test.ts) | Source and core evidence exist. Full runtime and Windows phases remain blocked in the retained record. Hermes native hooks are a declared coverage gap; plugin/integration sub-effects have partial coverage. Some remaining-gate wording predates the accepted base, so its claim about inputs not being in main must not replace current Git/source verification. |
| M04 | [Draft PR #326](https://github.com/skytuhua-org/Gen-V1/pull/326), observed head `9851e2b40b555401a000b0a135048eb684f8b964` | The remote prerequisite check found a draft, unmerged change. That PR head is not an accepted dependency on this run's base. A draft branch or source proposal cannot establish the required reviewed contract. |
| M05 | No verified accepted contract/evidence pairing was established | BLOCKED. Do not invent its contract names, APIs or source version. Locate the reviewed implementation and its tests before proceeding. |

`reviewerApproval: false` in retained evidence keeps release permission separate; this field cannot self-certify independent review. M14 needs exact dependency source blobs, applicable external review evidence and passing current contract tests. Finding older evidence files alone does not satisfy that requirement.

The host remains the sole SQLite writer. [Store.command and Store.internal](../../../packages/storage/store.ts) execute synchronous callbacks and reject thenables. No asynchronous native/file operation belongs inside either callback. Existing run epochs, account custody, grants, input outbox semantics and cancellation remain required boundaries when implementation resumes.

## Adapter capability matrix

This is source inspection of the current implementation. No native-fork runtime proof was performed. “Receipt history” means durable input-delivery reconciliation, not a complete conversation transcript.

| Implementation | Receipt history | Native transcript access in inspected code | Fixed-cut inspect | Native fork capability |
| --- | --- | --- | --- | --- |
| Hermes | Validates the owned session and its `.inputs.jsonl` receipts | Private worker `agent.history` copies the current in-memory messages; the owned saved source file contains current messages | No host checkpoint/cut API. Compaction replaces current messages and saves them | `UNPROVEN`; current adapter and worker expose no fork API |
| Pi | Extracts input IDs from validated task-owned native JSONL | Native SessionManager creates/reopens exact task sessions; no public transcript operation is exposed through RuntimeAdapter | No host checkpoint/cut API | `UNPROVEN`; no host/worker fork command or native-fork fixture |
| Claude official | SDK history helper returns matching harness input receipts | Helper calls `getSessionMessages`, then deliberately filters the result to receipts | No cut/checkpoint argument in the adapter | `UNPROVEN`; no exposed or tested native-fork path |
| Gemini official | Reads native session receipts or uses the guarded `session/load` fallback | The fallback observes received envelopes; its source explicitly states that upstream unawaited `streamHistory` does not establish complete replay | No host fixed-cut API; complete fallback coverage is unproven | `UNPROVEN`; no exposed or tested native-fork path |
| Cursor official | Owned SDK helper returns history text used to derive receipts | Helper text is reduced to verified input receipts | No host cut/checkpoint API | `UNPROVEN`; no exposed or tested native-fork path |
| Host Personal reader | Not a native receipt reader | Bounded projected UI messages, not native engine history | Existing reads are live and revocable, not an immutable historical capture | Not native evidence; cannot support a fork claim |

The current application has no supported native-fork API. `UNPROVEN` avoids asserting that an upstream engine can never fork; it means no runtime proof in this bundle supports enabling that capability. Inspect archive and an explicitly labeled new task with quoted context remain future implementation work, not shipped fallback actions.

### Exact current APIs

[RuntimeAdapter](../../../packages/contracts/index.ts) declares:

```ts
history(sessionPath: string, accountId?: string | null): Promise<string[]>;
```

[Service.resume](../../../packages/core/service.ts) calls this operation and uses `history.includes(input.id)` to reconcile outbox delivery. Changing its result to transcript messages would break that contract. The [runtime router](../../../packages/runtime/index.ts) resolves the account, checks session/provider compatibility and enters account-profile ownership before calling an adapter. None of these interfaces accepts a branch request or immutable source checkpoint.

The [Pi session module](../../../packages/runtime-pi/session.ts) exports `taskPaths`, `validateSessionPath` and `openTaskSession`. It hashes thread identity into the task directory, requires an owned `.jsonl` file with a native session header, and uses the pinned SDK's `SessionManager.create` or `SessionManager.open`. Cross-task reopening is refused. The [Pi worker](../../../packages/runtime-pi/worker.ts) command set is `models`, `start`, `followUp`, `compact`, `abort`.

The [official manifest module](../../../packages/runtime-official/manifest.ts) exports `readManifest`, `openManifest` and `saveManifest`. The manifest belongs to an exact provider/task directory. An existing native session identity cannot be silently changed. [claudeHistory](../../../packages/runtime-official/history.ts) returns `HistoryReceipt[]`; its [helper](../../../packages/runtime-official/history-command.ts) selects matching harness envelopes from SDK messages. [The official adapter](../../../packages/runtime-official/index.ts) then updates observed-delivery receipts, so reusing `RuntimeAdapter.history` is not a strictly inert transcript read. [Gemini history](../../../packages/runtime-official/gemini.ts) and [Cursor history](../../../packages/runtime-official/cursor.ts) have the same receipt purpose.

The [Hermes adapter](../../../packages/runtime-hermes/index.ts) validates the pinned engine commit, thread, account and exact source path. Its worker's `start`, `save_session`, `history_ownership` and `bind_maintenance` preserve that custody. `agent.history` reads current messages; `agent.compact` replaces and persists them. The existing `initialHistory` migration path is specifically for legacy canonical transcript migration. It is not evidence of a native fork and must not be repurposed to claim exact continuation from UI messages.

### Historical reader hazards

[ConversationReadModels](../../../packages/core/conversation-read-models.ts) offers `context`, `history`, `content` and `updates`. HMAC cursors bind scope and message positions; content cursors also bind the full message revision. Scope admission binds owner lineage, epoch, project, model, account and archive state. These are useful current safeguards, but the history query begins at the latest row and has no captured upper sequence. The [frontend reader](../../../apps/web/src/conversation-workspace/reader.ts) polls updates and reloads the latest history window when the transcript changes.

Two details constrain future implementation:

1. `Store.put` updates message bodies in place. Event payloads do not preserve every prior complete body. Adding an upper row ID or sequence cannot recover older streamed text or a removed/compacted native state. A fixed view needs a real pinned source/content capture, and unresolved old pointers must remain unavailable.
2. Current Personal admission rejects a root thread with `parentThreadId`; only a correctly linked side conversation can carry that field. Simply attaching M14 parent lineage to a normal new thread would make the existing reader reject it. The lineage design must be reconciled with verified dependency contracts before changing this admission.

Existing [reader tests](../../../tests/conversation-read-models.test.ts) cover owner fences, concurrent older paging, archive admission, revision mismatch, account/model/epoch changes and revocation. [Frontend reader tests](../../../tests/scoped-conversation-reader.test.ts) cover live refresh and response fencing. [Pi tests](../../../tests/runtime-pi.test.ts) use the real pinned SDK for create/reopen persistence, but do not test native forks. [Official history ownership tests](../../../tests/official-history-ownership.test.ts), [Hermes adapter tests](../../../tests/hermes-runtime.test.ts) and [synthetic-provider Hermes worker tests](../../../tests/hermes_source_worker.py) do not establish authenticated native-fork or installed-desktop proof.

## M08 remains a separate file operation

The accepted base contains [CheckpointService](../../../packages/workspace/checkpoints.ts), [checkpoint contracts](../../../packages/contracts/workspace-checkpoints.ts) and [restore routes](../../../apps/server/workspace-routes.ts). `planRestore` binds owner, checkpoint, selected paths, preimages and approval ID. `applyRestore` requires the matching plan/approval and records a pre-restore checkpoint. Owner scope is recomputed from project, thread and managed working-copy binding.

Presence of M08 code does not activate it. [Its retained verification](M08-verification.json) keeps checkpoint/restore flags false and records outstanding regression/platform/review gates. A future M14 interface may expose a distinct **Restore files** action only when M08's actual capability is available and separately approved. Branching must leave current files unchanged; neither operation reverses external effects.

## Original prompt coverage and status

Every product requirement below is **BLOCKED** at the prerequisite boundary and its acceptance case is **NOT_RUN**. Source findings and evidence tests do not change those product statuses.

| Prompt requirement | Current disposition and required resume work |
| --- | --- |
| Execution isolation, source/base custody | Separate branch/worktree and exact base recorded; preserve original work and retain source evidence. No account changes, destructive cleanup, merging or deployment. |
| M01/M02/M04/M05 prerequisite contracts | M04/M05 remain unverified. Require reviewed exact-source contracts on the accepted base and current tests before dependent work. |
| Read targets, call sites, tests; use existing dependencies | Named targets and relevant call sites/tests inspected. Resolve declared pnpm, keep frozen lockfile, record actual setup results. No dependency additions. |
| Host SQLite ownership; synchronous transactions; native/run/account/grant/cancel preservation | No production mutation introduced. Preserve these boundaries in future implementation and regression tests. |
| Failing fixture before implementation; one internal stage at a time | No product implementation stage started. Independent evidence-gate fixtures cannot count as the requested product red/green cases. |
| Contract 1: BranchRequestV1 | Deferred public schema and behavior. Must bind sourceThreadId, sourceCut, nativeCheckpointRef, requestedModelBinding and explicit `INSPECT` or `FORK_CONVERSATION`; forks need new identity and fresh grants. |
| Contract 2: ArchiveV1 | Deferred public schema/importer. Preserve version 1, sourceProduct, exportedAt, conversations, message graph, provenance and importWarnings; exclude executable authority. |
| Contract 3: HistoricalCursorV1 | Deferred public schema. Bind owner, source session, snapshot upper sequence, filters and schema version; explicit capability status is mandatory. |
| Sequence 1: adapter matrix and actual tests | Source matrix above is available. Runtime proof is NOT_RUN; receipt exports and current UI history are insufficient. |
| Sequence 2: fixed-cut historical view | Not implemented. Needs immutable capture/pagination, archived/missing attachment labels and explicit incomplete-source coverage. |
| Sequence 3: actual native fork | Not implemented. Requires tested engine API, new thread/run/epoch, account custody and compatibility revalidation. |
| Sequence 4: unsupported-fork alternatives | Not implemented. Inspect archive and Start new task with selected quoted context must be separate, accurately labeled actions without native-history reconstruction. |
| Sequence 5: inert tool history | Not implemented. Historical observations must never replay commands, reinstate approvals, restore files or reverse remote effects. |
| Sequence 6: M08 connection | Not implemented. Keep Restore files separate, capability gated and separately approved. |
| Sequence 7: explicit JSON ArchiveV1 importer | Not implemented. Enforce 20 MiB, 100 conversations and 10,000 messages total; reject duplicate IDs, cycles, invalid roles and malformed parents atomically. |
| Sequence 8: external formats and extraction | No external format support advertised. Require version-pinned parser fixtures; reject traversal, symlinks and decompression bombs before any attachment write. Do not guess Codex or DeepSeek formats. |
| Sequence 9: scrub and preview | Not implemented. Scrub known secret fields/access URLs; preview source, counts, warnings, omissions and destination. Imported assistant text is not a user instruction or project memory. |
| Sequence 10: deterministic import transaction | Not implemented. Source digest/deduplication and provenance must be immutable; cancellation must finalize or clean only the exact staging identity without half-active conversations. |
| Sequence 11: source lifetime tests | NOT_RUN for compaction, archive, account revocation and source removal. Missing source evidence must not be replaced with inferred evidence. |
| UI 1: distinct Inspect/Fork/New task actions | Not implemented. Each action must state its file effects, and fork appears only with verified support. |
| UI 2: parent/cut header and inert tool effects | Not implemented. Show exact source lineage without replay controls. |
| UI 3: import preview and persistent archive badge | Not implemented. Badge persists until explicit new live-task creation. |
| Acceptance 1: fixed pagination and owner isolation | NOT_RUN. Existing live-reader tests are insufficient. |
| Acceptance 2: unsupported fork, account mismatch, revoked source | NOT_RUN. Must assert no apparent exact continuation or live fork. |
| Acceptance 3: no tools, old approvals or file changes | NOT_RUN against a branch/import implementation. |
| Acceptance 4: duplicate/cyclic IDs, unsafe paths, symlinks, oversized/malformed input | NOT_RUN. All must fail before publication. |
| Acceptance 5: cancellation, repeated digest, no memory promotion | NOT_RUN. Requires real host persistence and staging tests after prerequisites. |
| Acceptance 6: M08 file state unchanged | NOT_RUN. Requires separate restore approval and cross-feature tests. |
| Targeted commands | `tests/session-branch-v3.test.ts` and `tests/history-import-v3.test.ts` are deferred product fixtures; evidence-gate tests use a different filename and claim no equivalent coverage. |
| Typecheck, full tests, build and M01 baseline browser suite | Record actual current commands and failures in M14-verification.json. No frontend change exists here. Any later frontend path requires its browser suite in addition to the baseline. |
| Evaluations, Windows/native and installed desktop | No guessed live endpoint. Without authorized host/model, evaluation is only MANIFEST_ONLY. Actual target-platform/native proof remains NOT_RUN; mocks and skips do not count. |
| Host-owned M14 flags | `sessions.branchV1` and `sessions.inertImportV1` are unregistered and unavailable. Do not modify the finite registry or preferences before dependency resolution. Future keys must default false and have independent activation proof. |
| Rollback | No product migration or runtime activation occurs in this delivery. Future rollback disables creation/import while retaining immutable lineage and archive provenance, without deleting native sources or reversing effects. |
| Final evidence and independent review | M14-verification.json records CORE evidence work separately from blocked INTEGRATION and PLATFORM requirements. The current aggregate status is FAIL because the full baseline suite failed; product functionality remains BLOCKED with acceptance NOT_RUN. Independent activation review remains required. |

## Exact resume gates

1. Refresh the approved base without overwriting user work. Establish M04 and M05 as reviewed, accepted dependencies; draft PR #326 alone is insufficient. Locate each actual contract definition and record its source blob and test IDs. Do not copy an unmerged proposal into M14 to manufacture prerequisite compliance.
2. Reconcile M01/M02 evidence with the new exact base, preserving earlier failures. Run their current relevant contract tests and the M01 baseline browser suite. External review and platform evidence must match the source cut they approve.
3. Re-read every M14 integration target, its call sites/tests and the finite host flag registry at that base. Resolve proposed-file collisions explicitly. If a previously accepted API changed, stop the affected phase as `BLOCKED_SOURCE_DRIFT` instead of guessing a replacement.
4. Write and observe intentional failing product fixtures for each bounded stage before implementing it. Preserve failed commands with their actual exit codes. Keep source audit and evidence-validator tests distinct from product acceptance.
5. Implement read-only historical capture and ArchiveV1 ingestion only against the verified contracts. Prove snapshot stability, owner filtering, inert content, all resource limits, secret scrubbing, graph validation, transactional deduplication and cancellation/staging cleanup before publication. No external product parser is supported without its own version pin and fixture.
6. Keep native fork unavailable for every adapter lacking runtime proof. For an adapter that gains a tested native API, prove fresh identity/custody/grants, model compatibility and source resolution across compaction, archive, revocation and deletion. Never reconstruct a native session from UI messages.
7. Add the distinct user-facing actions, source-cut header, historical tool labels, import preview and archive badge. Wire M08 restoration only through its independent available capability and approval flow. Test changed frontend paths in the browser.
8. Run the two required product suites, `pnpm typecheck`, `pnpm test`, `pnpm build`, the baseline browser suite and all changed-frontend suites with declared pnpm 10.30.3. Retain unsuccessful attempts. Execute Windows/native/installed-desktop requirements on their actual target environment and record each unproved sub-capability as disabled.
9. Register only the two specified M14 keys in the shared host-owned finite registry, default false, when the corresponding implementation exists. Do not expose agent/plugin activation or UI-preference bypasses. Populate ImplementationEvidenceV3 with real artifacts and commands; request independent production-activation review only after relevant gates are proved.

Command outcomes are intentionally centralized in [M14-verification.json](M14-verification.json) so setup progress or later reruns cannot silently turn this source audit into a product completion claim.
