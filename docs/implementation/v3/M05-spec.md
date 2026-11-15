**M05  Source-linked project memory and learning**

P1 high leverage | Replaces F54 | Core prerequisites: M01, M02, M04

**START OF COPY-PASTE PROMPT M05**

You are implementing M05 in Skytuhua/Gen-V1. Give Gen-V1 reliable project knowledge that survives sessions without turning stale model guesses into authority. Merge retrieval, extraction, consolidation, correction and forgetting into one opt-in workflow with a reviewable memory interface.

**Execution contract**

Use a separate worktree and branch agent/m05-v3. Preserve the original checkout and all existing user changes. Record git status and the repository root, verify origin is Skytuhua/Gen-V1, fetch the approved base (default origin/main), and record its SHA. Audit ancestor: a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54. Do not push, merge, deploy, force-update refs, reset/clean/stash user work or change accounts.

Required core contracts: M01, M02, M04. They must be present on the accepted base with reviewed evidence and current contract tests. A local branch name or chat claim is not a dependency. Check exact source blobs and behavior, not only filenames. If integration APIs changed, stop the affected phase as BLOCKED_SOURCE_DRIFT and report the mismatch. Do not guess a replacement API or overwrite a colliding proposed file.

Read package.json, the lockfile, docs/architecture.md and AGENTS.md only if present, plus all targets below and their call sites/tests. Existing paths include current-source and retained-baseline integration targets; verify each locally. New paths are proposed deliverables, not claims that files already exist. Use existing dependencies first; frozen-lockfile setup and any new dependency require the applicable operator authorization.

The host stays the sole SQLite writer. Never await inside Store.command/Store.internal callbacks. Preserve native Hermes/Pi history, run epochs, account pinning, grants and cancellation. Write failing fixtures first, then implement one internal stage at a time. Stop dependent stages on failure; independent pure tests may continue only when they do not rely on the failed boundary.

**Observed baseline and exact scope**

Gen-V1 already has small revisioned thread notes and source-owned Hermes skills; global Hermes memory is deliberately disabled. Codex demonstrates locked, incremental consolidation, Hermes exposes lifecycle and checkpoint boundaries, and OpenClaw records memory provenance under physical workspace identity. None proves the truth of a recalled statement. [[E06](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_E06) [E03](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_E03) [E14](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_E14) [E18](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_E18) [E19](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_E19) [E29](https://chatgpt.com/c/6af80cf2-3a04-83e8-a8e2-a092ef82b8c9#src_E29)]

Existing integration targets:

packages/core/task-memory.ts; packages/core/learning.ts; packages/core/skills.ts; packages/runtime-hermes/worker.py; packages/runtime-hermes/library.ts; packages/storage/store.ts; apps/web/src/ContextInspector.tsx

Proposed new files:

packages/contracts/project-memory.ts; packages/core/project-memory.ts; packages/core/memory-retrieval.ts; packages/core/memory-consolidation.ts; apps/web/src/ProjectMemoryReview\.tsx; tests/project-memory-v3.test.ts; tests/memory-forget-v3.test.ts

**Required contracts and fixed design decisions**

**1.&#x20;**&#x4D;emoryItemV1: id, projectIdentity, scope PROJECT|USER_APPROVED, kind DECISION|CONSTRAINT|PROCEDURE|FACT|PREFERENCE, text, revision, state PROPOSED|ACCEPTED|CONFLICT|EXPIRED|DELETED, sourceRefs[], assertedBy, observedAt, expiresAt|null, supersedes[], sensitivity and reviewDecision. Text is at most 2 KiB UTF-8; sourceRefs are immutable identifiers/digests, not invented URLs.

**2.&#x20;**&#x4D;emorySourceRefV1: ownerThreadId, sourceKind, sourceId, sourceRevision, capturedSeq, digest and observedStatus OBSERVED|PROPOSED|REPORTED|UNCERTAIN. An agent-created item is not independently verified merely because its origin is known.

**3.&#x20;**&#x4D;emoryRecallV1: requestId, projectIdentity, contextGeneration, queryDigest, candidateIds[], selectedRevisions[], scores, exclusions, budgetBytes, producedAt and status COMPLETE|PARTIAL|TIMEOUT|UNAVAILABLE. A recall result cannot broaden grants or change provider/account.

**4.&#x20;**&#x4D;emoryTombstoneV1: itemId, deletionRevision, projectIdentity, deletedAt, sourceExclusions[], affectedDerivedArtifacts[] and purgeStatus. Retrieval checks tombstones synchronously. Summary rebuilds, indexes and restored backups must not resurrect deleted content.

**5.&#x20;**&#x50;ilot defaults: opt-in per project; at most 8 recalled items and 4 KiB of injected memory; lexical retrieval first; vector retrieval is a separate disabled experiment requiring an approved embedding provider and explicit data egress consent. Extraction proposes rather than auto-accepts new facts.

**Implementation sequence**

**1.&#x20;**&#x4B;eep existing task notes and Hermes skill packages unchanged. Introduce project memory as a separate host-owned entity family. Do not simply flip memory_enabled=true in the vendored worker; that would create an unreviewed second authority and uncontrolled prompt injection path.

**2.&#x20;**&#x42;ind each memory to an attested project identity rather than a user-provided path label. Require an explicit opt-in action and source scope. Cross-project sharing is off; user-wide preferences require separate confirmation. A one-task instruction must not become a global preference.

**3.&#x20;**&#x49;mplement immutable revisions and optimistic compare-and-swap for edits. A user correction supersedes the specified revision; retain historical provenance without using it for active retrieval. Conflicting active claims remain CONFLICT until the operator resolves them.

**4.&#x20;**&#x49;mplement lexical search over accepted, nonexpired, authorized items. Rank exact project/symbol overlap before recency, then stable ID for ties. Return source references and exclusions. Do not infer semantic truth or certainty from similarity. Retrieval must fit the byte cap even without a tokenizer.

**5.&#x20;**&#x43;apture recall at request preparation and bind it to that context generation. Late results are candidates for a later request, not mutations of an in-flight prompt. Use a 750 ms foreground wait budget for local retrieval; timeout returns an empty or already-complete bounded result plus status, not stale data from a previous project.

**6.&#x20;**&#x41;dd a bounded provider adapter only after local recall works. Key state and circuit breakers by profile/project/provider. Limit one pending recall per request and refuse new work when the configured in-flight cap is reached. Cancellation cannot kill arbitrary Python threads, so account for orphaned calls and open the circuit instead of spawning indefinitely.

**7.&#x20;**&#x45;xtract proposals after a settled task from an authorized, bounded source cut. Distinguish decisions, facts, unresolved work and explicit reusable preferences. Require exact source references, reject unsupported references and secret-bearing payloads, and label model inference as proposed. No extraction tool can modify project files or invoke a privileged action.

**8.&#x20;**&#x43;onsolidate only accepted changed revisions under a per-project lease and source watermark. If the inputs and validated output digest are unchanged, skip the model call. Preserve recent corrections and distinct project scopes; never regenerate deleted claims from an older summary. Use a single derived index of references rather than concatenating every memory into every request.

**9.&#x20;**&#x42;efore native compaction, save a structured checkpoint of accepted task constraints and source pointers through the host boundary. A required checkpoint failure blocks that compaction operation without discarding history. Do not assume every Hermes provider implements the same checkpoint API version.

**10.&#x20;**&#x49;mplement Forget as an authenticated, revision-bound transaction that immediately excludes the item and invalidates derived summaries/index entries. Schedule physical purge of permitted local artifacts under a bounded retention policy and record completion. Do not promise deletion from an external provider without an actual documented deletion API.

**11.&#x20;**&#x41;dd an evaluation set containing contradicted decisions, changed APIs, renamed projects, stale code references, malicious memory instructions, deliberate secrets, user corrections and repeated tasks. Compare recall usefulness and task correctness against thread-note-only control. Track memory injection bytes, retrieval latency and all extraction/consolidation spend.

**12.&#x20;**&#x45;xpose accept/reject/edit/expire/forget operations only to authenticated user actions. Agents may propose. Accepted memory remains contextual evidence and never an approval or executable instruction source. Keep the feature default off until the scoped retrieval, correction and deletion tests pass.

**Concrete user-facing behavior**

**1.&#x20;**&#x50;roject Memory has tabs Accepted, Proposals, Conflicts and Deleted history. Each row shows type, project, source, age, expiry and last-used time. Detail opens the exact supporting message/file revision, not an unpinned search result.

**2.&#x20;**&#x50;roposal actions are Accept, Edit and accept, Reject. Conflict resolution explicitly chooses a surviving revision or preserves both with a note. No silent last-write-wins overwrite.

**3.&#x20;**&#x46;orget preview names derived summaries/indexes that will be invalidated and distinguishes immediate retrieval exclusion from pending physical purge. Export is explicit and redacted; no automatic cloud sync.

**4.&#x20;**&#x49;n ContextInspector show Why recalled with the matched scope and source. Allow Exclude from this request independently from permanently forgetting.

**Acceptance and negative tests**

**1.&#x20;**&#x57;rong project, wrong account, expired item and missing source do not enter recall. Relevance cannot grant access.

**2.&#x20;**&#x55;ser correction wins over older summaries. Two concurrent edits produce CONFLICT instead of losing either revision.

**3.&#x20;**&#x46;orget immediately removes recall, invalidates summaries, survives restart and does not resurrect through reindex or old backup replay.

**4.&#x20;**&#x50;rovider hang/cancellation does not leak another profile's result or grow unbounded threads. Late recall never alters an active request.

**5.&#x20;**&#x55;nchanged consolidation inputs perform zero additional model calls; changed inputs update only after the correct lease/watermark check.

**6.&#x20;**&#x50;rompt-injection text inside memory stays data. Seeded secrets and fabricated source IDs are rejected before publication.

**7.&#x20;**&#x4C;ive repeated-task study reports quality and total auxiliary cost, not only retrieval similarity.

**Commands and evidence**

Resolve the declared pnpm version and platform-capable launcher first. From the isolated repository root, run the targeted commands below after required generated assets/setup exist. Record the intentional failing fixture before implementation and the passing result after it. Then run pnpm typecheck, pnpm test and pnpm build; run pnpm test:browser for every changed frontend/browser path. M01 also requires the baseline browser suite. Use actual exit codes, bounded redacted logs and exact working directory.

pnpm exec vitest run tests/project-memory-v3.test.ts

pnpm exec vitest run tests/memory-forget-v3.test.ts

Do not execute guessed live evaluation endpoints. The existing eval runner needs --out \<new directory>; without authorized --host and --model its result is MANIFEST_ONLY. Native/Windows and installed-desktop requirements run on the actual target platform; mocks or skipped cases are not substitutes.

**Activation gate and rollback**

Local lexical memory can pass independently of an external vector service. External embeddings, auto-acceptance and user-wide sharing remain disabled unless separately approved and tested. Native pre-compaction checkpoints are adapter-gated.

Host-owned flags: memory.projectV1, memory.externalRecallExperimentV1. Register only these keys in the shared finite registry; default false. Do not add them to strict UI preferences or allow agents/plugins to enable them. Each risky sub-capability needs its own proof; do not use one successful core test to unlock all flags.

Rollback: Disable injection and extraction; retain user-editable accepted records and tombstones. Revert to existing task notes without overwriting Hermes skill files or reintroducing deleted material.

**Required final handoff**

Write docs/implementation/v3/M05-verification.json using ImplementationEvidenceV3. Separate CORE contract results, INTEGRATION runtime results and PLATFORM results required by this bundle. A blocked platform leaves the relevant feature disabled and the bundle PARTIAL, not fully implemented. List exact dependency contracts, source SHA/blob cut, changed files, commands/exit codes, intended-negative results, artifacts, data migration/rollback status and every remaining gate. Preserve failed attempts. Do not put the final commit SHA inside a file in that same commit; report it separately. Local commits may include only this bundle's reviewed changes; no push/merge/deployment is authorized.

Do not claim completion from a generated manifest alone. The controller verifies artifact existence, actual command execution and source compatibility; production activation needs independent review. Return BLOCKED or FAIL where evidence does not support success.

**Source references**

[E03 Gen-V1: worker.py](https://github.com/Skytuhua/Gen-V1/blob/a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54/packages/runtime-hermes/worker.py#L179-L308); [E06 Gen-V1: task-memory.ts](https://github.com/Skytuhua/Gen-V1/blob/a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54/packages/core/task-memory.ts); [E14 Codex: phase2.rs](https://github.com/openai/codex/blob/81b995a6c9a4c978f399775cfa5ce50702368749/codex-rs/memories/write/src/phase2.rs#L1-L235); [E15 Codex: consolidation_v2.md](https://github.com/openai/codex/blob/81b995a6c9a4c978f399775cfa5ce50702368749/codex-rs/memories/write/templates/memories/consolidation_v2.md); [E16 Codex: phase2_sandbox_tests.rs](https://github.com/openai/codex/blob/81b995a6c9a4c978f399775cfa5ce50702368749/codex-rs/memories/write/src/phase2_sandbox_tests.rs); [E18 Hermes: memory_manager.py](https://github.com/NousResearch/hermes-agent/blob/1831ce1cfeb517a0b6008f006d09e2d0558439ac/agent/memory_manager.py#L1-L250); [E19 Hermes: memory_provider.py](https://github.com/NousResearch/hermes-agent/blob/1831ce1cfeb517a0b6008f006d09e2d0558439ac/agent/memory_provider.py#L1-L270); [E29 OpenClaw: memory-artifact-provenance.ts](https://github.com/openclaw/openclaw/blob/088178a6559f4972c27da935caa4ea7dff8848a7/src/memory/memory-artifact-provenance.ts#L1-L235); [D01 Official documentation: Claude Code: project instructions and auto memory](https://code.claude.com/docs/en/memory). Full paths, source cuts and evidence labels appear in Appendix D.

**END OF COPY-PASTE PROMPT M05**