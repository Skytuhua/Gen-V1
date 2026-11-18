**M14  Branchable sessions and inert history imports**

P2 continuity | Replaces F57, F58 | Core prerequisites: M01, M02, M04, M05

**START OF COPY-PASTE PROMPT M14**

You are implementing M14 in Skytuhua/Gen-V1. Provide safe conversation branching, source-bound historical inspection and inert import. Keep conversation history, code checkpoints and irreversible external effects visibly separate.

**Execution contract**

Use a separate worktree and branch agent/m14-v3. Preserve the original checkout and all existing user changes. Record git status and the repository root, verify origin is Skytuhua/Gen-V1, fetch the approved base (default origin/main), and record its SHA. Audit ancestor: a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54. Do not push, merge, deploy, force-update refs, reset/clean/stash user work or change accounts.

Required core contracts: M01, M02, M04, M05. They must be present on the accepted base with reviewed evidence and current contract tests. A local branch name or chat claim is not a dependency. Check exact source blobs and behavior, not only filenames. If integration APIs changed, stop the affected phase as BLOCKED_SOURCE_DRIFT and report the mismatch. Do not guess a replacement API or overwrite a colliding proposed file.

Read package.json, the lockfile, docs/architecture.md and AGENTS.md only if present, plus all targets below and their call sites/tests. Existing paths include current-source and retained-baseline integration targets; verify each locally. New paths are proposed deliverables, not claims that files already exist. Use existing dependencies first; frozen-lockfile setup and any new dependency require the applicable operator authorization.

The host stays the sole SQLite writer. Never await inside Store.command/Store.internal callbacks. Preserve native Hermes/Pi history, run epochs, account pinning, grants and cancellation. Write failing fixtures first, then implement one internal stage at a time. Stop dependent stages on failure; independent pure tests may continue only when they do not rely on the failed boundary.

**Observed baseline and exact scope**

Pi and DeepSeek offer different native history models, while Gen-V1 preserves adapter-owned sessions and host application events. Claude documents distinct rewind/summarize/code operations, but its proprietary runtime is not source-audited here. [[B13](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_B13) [E24](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_E24) [D02](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_D02) [E03](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_E03)]

Existing integration targets:

packages/runtime-official/history.ts; packages/runtime-pi/session.ts; packages/runtime-hermes/worker.py; packages/core/conversation-read-models.ts; packages/storage/store.ts; apps/web/src/conversation-workspace/reader.ts

Proposed new files:

packages/contracts/session-branch.ts; packages/core/session-branches.ts; packages/core/history-import.ts; tests/session-branch-v3.test.ts; tests/history-import-v3.test.ts

**Required contracts and fixed design decisions**

**1.&#x20;**&#x42;ranchRequestV1: sourceThreadId, sourceCut, nativeCheckpointRef, requestedModelBinding and explicit intent INSPECT|FORK_CONVERSATION. New branch has a new thread/run identity and fresh grants; parent history is immutable.

**2.&#x20;**&#x41;rchiveV1: version=1, sourceProduct, exportedAt, conversations[] with externalId, messages[{id,parentId|null,role,text,sourceTimestamp,attachmentRefs[]}], provenance and importWarnings. Imported content is inert and cannot include executable grants, active tool calls or live account tokens.

**3.&#x20;**&#x48;istoricalCursorV1 binds owner, source session, snapshot upper sequence, filters and schema version. A fork's native ability is SUPPORTED|UNSUPPORTED|UNPROVEN, never inferred from the UI timeline.

**Implementation sequence**

**1.&#x20;**&#x43;reate an adapter capability matrix for read history, inspect a fixed cut and native fork. Test each actual implementation. A text-only transcript exporter does not prove a native continuation can be forked.

**2.&#x20;**&#x49;mplement a read-only historical view using snapshot-bound pagination. New incoming events do not move the upper cut. Show archived/missing attachments and incomplete source coverage explicitly.

**3.&#x20;**&#x46;or an actual fork, use the source engine's tested API and allocate new thread/run/epoch and account custody. Revalidate model/account compatibility; do not silently reuse a session file from another binding.

**4.&#x20;**&#x49;f native forking is unsupported, permit Inspect archive or Start new task with selected quoted context. Label the latter as a new task, not an exact replay. Never rewrite native history from projected UI messages.

**5.&#x20;**&#x4B;eep previous tool calls as inert historical observations. No branch operation replays shell commands, reinstates approvals or reverses remote effects. A branch does not automatically restore files.

**6.&#x20;**&#x43;onnect to M08 file checkpoint review only when that capability is available, using a separate Restore files action and approval. Do not combine conversation and file changes into one opaque undo transaction.

**7.&#x20;**&#x49;mplement the explicit ArchiveV1 JSON importer first, with a 20 MiB file limit, 100 conversations and 10,000 messages total; reject duplicate IDs, cycles, invalid roles and malformed parent references. Larger imports return a clear limit error, not partial silent acceptance.

**8.&#x20;**&#x45;xternal product formats need a separately version-pinned parser and fixture before support is advertised. Do not guess DeepSeek or native Codex session formats. Archive extraction rejects path traversal, symlinks and decompression bombs before writing attachments.

**9.&#x20;**&#x53;crub known secret-bearing fields and access-bearing URLs, and show an import preview with source, counts, warnings and destination project. Do not treat imported assistant text as a user instruction or automatically promote it into project memory.

**10.&#x20;**&#x49;mport transaction records deterministic source digest/deduplication and immutable provenance. Cancellation leaves no half-active conversation; staged artifacts are either finalized or cleaned under their exact staging identity.

**11.&#x20;**&#x54;est branch after compaction, archive, account revocation and source removal. Existing source pointers that no longer resolve remain unavailable; never invent replacement evidence.

**Concrete user-facing behavior**

**1.&#x20;**&#x48;istory view exposes Inspect point, Fork conversation where supported, and Start new task with quoted context as distinct actions. Every action explains whether current files change.

**2.&#x20;**&#x42;ranch header names parent and source cut. Tool effects are marked historical and cannot be replayed by clicking them.

**3.&#x20;**&#x49;mport preview lists exact format support, warnings, omitted attachments and destination. Imported archive badge persists until an explicit new live task is created.

**Acceptance and negative tests**

**1.&#x20;**&#x50;aging while new events arrive preserves the fixed cut with no cross-owner records.

**2.&#x20;**&#x55;nsupported native fork never produces an apparent exact continuation. Account mismatch and revoked source refuse live fork.

**3.&#x20;**&#x42;ranch/import cannot execute tools, restore old approvals or change files.

**4.&#x20;**&#x44;uplicate/cyclic IDs, traversal paths, symlinks, oversized archive and malformed attachments fail before publication.

**5.&#x20;**&#x49;mport cancellation and repeated import digest are deterministic; memory is not silently populated.

**6.&#x20;**&#x43;onversation fork leaves M08 file state unchanged until separately approved restore.

**Commands and evidence**

Resolve the declared pnpm version and platform-capable launcher first. From the isolated repository root, run the targeted commands below after required generated assets/setup exist. Record the intentional failing fixture before implementation and the passing result after it. Then run pnpm typecheck, pnpm test and pnpm build; run pnpm test:browser for every changed frontend/browser path. M01 also requires the baseline browser suite. Use actual exit codes, bounded redacted logs and exact working directory.

pnpm exec vitest run tests/session-branch-v3.test.ts

pnpm exec vitest run tests/history-import-v3.test.ts

Do not execute guessed live evaluation endpoints. The existing eval runner needs --out \<new directory>; without authorized --host and --model its result is MANIFEST_ONLY. Native/Windows and installed-desktop requirements run on the actual target platform; mocks or skipped cases are not substitutes.

**Activation gate and rollback**

Read-only inspection can pass independently of native fork. Each adapter's fork capability requires runtime proof. Imported archives never inherit executable authority.

Host-owned flags: sessions.branchV1, sessions.inertImportV1. Register only these keys in the shared finite registry; default false. Do not add them to strict UI preferences or allow agents/plugins to enable them. Each risky sub-capability needs its own proof; do not use one successful core test to unlock all flags.

Rollback: Disable creation/import while preserving immutable parent/child and archive provenance. Do not delete source sessions or attempt to reverse external actions.

**Required final handoff**

Write docs/implementation/v3/M14-verification.json using ImplementationEvidenceV3. Separate CORE contract results, INTEGRATION runtime results and PLATFORM results required by this bundle. A blocked platform leaves the relevant feature disabled and the bundle PARTIAL, not fully implemented. List exact dependency contracts, source SHA/blob cut, changed files, commands/exit codes, intended-negative results, artifacts, data migration/rollback status and every remaining gate. Preserve failed attempts. Do not put the final commit SHA inside a file in that same commit; report it separately. Local commits may include only this bundle's reviewed changes; no push/merge/deployment is authorized.

Do not claim completion from a generated manifest alone. The controller verifies artifact existence, actual command execution and source compatibility; production activation needs independent review. Return BLOCKED or FAIL where evidence does not support success.

**Source references**

[E03 Gen-V1: worker.py](https://github.com/Skytuhua/Gen-V1/blob/a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54/packages/runtime-hermes/worker.py#L179-L308); [E24 DeepSeek: index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/context/session-reference/src/index.ts#L230-L440); [D02 Official documentation: Claude Code: checkpoints, rewind and summarization](https://code.claude.com/docs/en/checkpointing); [B01 Skytuhua/Gen-V1: store.ts](https://github.com/Skytuhua/Gen-V1/blob/175e3fa03b453dde7d1c815d59df1f0554fbd626/packages/storage/store.ts); [B02 Skytuhua/Gen-V1: service.ts](https://github.com/Skytuhua/Gen-V1/blob/175e3fa03b453dde7d1c815d59df1f0554fbd626/packages/core/service.ts). Full paths, source cuts and evidence labels appear in Appendix D.

**END OF COPY-PASTE PROMPT M14**