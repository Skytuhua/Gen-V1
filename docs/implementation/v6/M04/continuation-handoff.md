# M04 v6 continuation handoff — resolving the named holds

Audience: the next agent/session continuing M04. This document is self-contained: it records what is finished (do not rebuild it), what remains, exactly why each remainder is held, and what must be true before it can be fixed. It does **not** itself authorize any scope, contract, platform or publication change — where a new authorization is required, that is stated explicitly. The governing rules remain the M04 v6 executable prompt (R01–R12, sections A–I); re-read it before acting.

## 1. Source identity (verify first, R01/R02)

- Repository: skytuhua-org/Gen-V1, numeric ID 1442565952.
- Branch: `handoff/m04-context-v3`. Task worktree: `/home/piadmin/Gen-V1-m04-v6`.
- Final local commit of the v6 pass: `e00834cc2beac823b2892fa205aaa87c4c43ed36` (LOCAL_ONLY, never pushed).
- Preserved task head the v6 pass built on: `ee2c7ad1d8137a355ae907ef0a340b04c8cb7c38` (== published PR #326 head at that time).
- Captured `origin/main` during the v6 pass: `1c09d492278b1014bc3ab5455191b1f5913c96d8`. **Re-fetch main; it may have moved.** Re-run the R03 procedure against the new captured SHA; do not reuse the old conflict outcome blindly.
- Audit anchor (reference only): `4805af4680094d2af48ecf666688e750797e9dda`.
- Baseline comparison worktree retained at `/home/piadmin/Gen-V1-m04-baseline` (detached `ee2c7ad1`, same provisioning). Original checkout `/home/piadmin/Gen-V1` and all other worktrees belong to other tasks — do not touch.
- Toolchain on this host: Node v24.11.1 at `~/tools/node24/bin`, pnpm 10.30.3 at `~/tools/pnpm` (export PATH first). Host is **linux-arm64** (Pi 5); the historical M04 receipt was linux-x64. Other task agents (M10/M12/M14 worktrees) run concurrently — expect CPU contention; rerun timing-flaky suites quietly before attributing failures.

## 2. Finished — preserve, do not rebuild

All of the following has source-bound passing evidence at `e00834cc` (receipts in `docs/implementation/v3/M04-verification.json`, logs in `docs/implementation/v6/M04/logs/`):

- Deterministic compiler, append-only cache, budget arithmetic (`packages/core/context-compiler.ts`) — tests/context-compiler-v3.test.ts (11).
- Private result vault + durable custody + `context_result_read` host tool (`context-results.ts`, `context-result-custody.ts`, service wiring) — tests/context-results-v3.test.ts (3), custody/observation tests.
- Progressive disclosure, exposure classes, frozen per-request schema digest, Hermes engine dispatch gate, 4-concurrent-read limit — tests/context-discovery-v3.test.ts (6), tests/hermes-runtime.test.ts.
- Instruction manifest, repo map **including the new `rankRepoMap`** (requested-path → referenced-symbol count → path/symbol).
- `CompactionMetadataV1` strict sidecar + candidate registry (one UUID per exact binding, retained across retries, interval validation) in `packages/contracts/request-context.ts` / `context-compaction.ts`.
- Host apply gate `applyCompactionCandidate` (stale/cancelled/oversized binding never calls nativeApply; unsupported → UNSUPPORTED_COMPACTION; FAILED never applies).
- Precompute coordinator `createPrecomputeExperiment` (single in-flight, race discards, failed-call cost accounting, default-off via injected `enabled()`).
- Shadow relevance phase `createShadowRelevancePhase` (6 s timeout, OBSERVER_UNAVAILABLE without approved budget, **one report per cut**, cancellation, synchronous-throw safe).
- Decision tests D02–D05 in tests/context-contract-preservation-v6.test.ts (5); D01 deliberately absent (see §3.1).
- Source inventory registration (14 entries) — tests/public-source.test.ts passes.
- Gates at final cut: typecheck, lint, build, asset builds exit 0; named suites exit 0. `pnpm test`: 277 failed / 3073 passed — **failure count identical to unchanged baseline**; `pnpm test:browser`: 463 passed / 1239 failed with baseline attribution complete (§5).
- Requirement matrix: `docs/implementation/v6/M04/requirements.json` (36 rows). Execution handoff with R03 conflict blob table: `docs/implementation/v6/M04/handoff.md`. Source lock: `docs/implementation/v6/M04/source-lock.json`. Historical receipt archived: `M04-verification-handoff.json`.
- All four M04 flags registered, default false, host-owned; reviewerApproval false; publication LOCAL_ONLY.

## 3. The holds and how to resolve them

### 3.1 HOLD_SOURCE_DRIFT — C3 custody join, D01, U02, U03 data path, packaging join

State: the R03 merge of captured main conflicted in 9 paths and was aborted as the procedure mandates. `RequestPreparationV1` and `packages/core/request-custody.ts` exist **only on main**. Conflict paths and base/ours/theirs blob identities are recorded in `handoff.md` §R03 (ContextInspector.tsx, contracts/index.ts, request-context.ts [add/add], capability-flags.ts, service.ts, runtime-hermes/broker.ts, runtime-hermes/index.ts, public-source-files.json, tests/e2e/usage-context.spec.ts).

Why it cannot be fixed under the current authorization: R03 prescribes abort + hold on conflict and authorizes no blanket ours/theirs or guessed replacement API; section A forbids recreating request-context.ts / request-custody.ts; C01 forbids a second request-context authority.

Resolution path (requires a **new task revision explicitly authorizing conflict resolution**, or a main that has absorbed the branch):
1. Re-fetch main; record new SHA; re-attempt `git merge --no-commit --no-ff <sha>` in the owned clean worktree. If the new revision authorizes manual resolution, resolve each of the 9 paths preserving BOTH the branch M04 hooks and main's custody core; the add/add on request-context.ts resolves to main's file (it is a superset: it adds RequestPreparationV1) plus the branch's `CompactionMetadataV1` sidecar appended. Never drop main's issued-token admission fields.
2. After a clean merge, rerun consumed contract tests before coding (R03): m01-m02-compatibility, tool-authority-v3, tool-effects-v3, request-custody tests from main, plus all M04 suites.
3. C3: bind the composer/host send path to RequestPreparationV1 admission — preparation identity, promptDigest/bindingDigest/grantDigest/sourceCutDigest checks, issued-token single admission, expiry. No automatic rewrite of the host send path beyond the admitted hook.
4. D01 (write into tests/context-contract-preservation-v6.test.ts, replacing the documented NOT_RUN): retry the identical prepared send twice → one admitted input, unchanged preparation identity; alter prompt or owner → rejection **before** native dispatch (spy on runtime.start/followUp).
5. U02: wire `context-draft-sources.ts` into the composer attachment controls under current host admission/grants (not browser-provided paths). Chips show exact file/message/session revision + preview size; Remove affects only the next unsent draft; changed source forces Refresh/Keep with an available retained snapshot before Keep is offered. Cover cross-owner, revoked, changed/deleted revisions, reload, 8-ref/64 KiB bounds; add a scoped real-browser test on the configured channel.
6. U03: feed CompactionMetadataV1 candidates (retained constraints, omitted categories, estimate-labeled byte reduction, measured before/after when available, cost incl. failed attempts, stale/discarded candidates) through the host usage/projection path into the existing Compaction tab. Depends on §3.2 for measured results.
7. Packaging join: reconcile scripts/public-source-files.json with main's inventory (keep both sides' entries, sorted, unique, runtime ⊆ source); rerun tests/public-source.test.ts.

Evidence required: D01 passing at the merged cut; composer admission tests; scoped browser test; updated verification receipt with the new baseSha and source lock.

### 3.2 HOLD_NATIVE_COMPACTION — RESOLVED: real source-cut CAS implemented

The protocol was extended rather than faked: the worker verifies an exact history precondition inside the native process immediately before mutation.

- `worker.py`: `agent.history` returns a worker-computed `historySha256` (canonical `sha256(json.dumps(history, sort_keys=True))`). `agent.compact` accepts `expectedHistorySha256`; a mismatch returns `{compacted:false, mismatch:true, historySha256}` without touching history. `self.history` is only assigned after `_compress_context` returns inside `native_checkpoint` (owner binding rechecked: thread/run/epoch/session/model/account); the `before` deepcopy is the rollback witness and `save_session` persists only post-apply.
- `contracts`/`runtime-hermes`: `RuntimeAdapter.compact` gains an optional `expectedHistorySha256` param; `nativeHistoryDigest(ctx, sessionPath, accountId)` reads the live worker's digest via the `agent.history` maintenance channel. Adapter maps `mismatch` to `HERMES_COMPACTION_MISMATCH`; compact still requires the exact retained thread/model/account/session and `compacted===true`.
- `service`: `applyLossAwareCompaction` mints the binding-bound candidate, evaluates through `applyCompactionCandidate` (stale/cancelled/oversized never reaches `nativeApply`), snapshots the live digest, calls `compact` with the expected hash, persists a `compactionUsage` entity (measured before/after bytes) inside the command transaction, projects verdict + measured bytes into `usage.compaction` for the Compaction tab. APPLIED returns a command receipt; FAILED throws `COMPACTION_FAILED`; adapters without `nativeHistoryDigest` still throw `UNSUPPORTED_COMPACTION`.
- Tests: `tests/hermes_source_worker.py::test_source_cut_cas_rejects_stale_compact_and_applies_matching_digest` (runs on Windows CI with the pinned Python — deps are not provisioned on linux-arm64); `tests/context-request-observation.test.ts` CAS apply/mismatch/unsupported cases verify the digest is passed, measured bytes land in the projection, and mismatch never mutates.
- `context.lossAwareCompactionV1` stays default-off; activation remains a separate reviewer decision.

### 3.3 HOLD_AUXILIARY_MODEL — C5 live shadow scoring and precompute summarization

State: guards implemented and tested; with no approval the shadow phase returns OBSERVER_UNAVAILABLE and makes zero model calls; precompute summarizer is test-injected only; `context.precomputeExperimentV1` default off.

Why held: S09/C5 require an **explicitly approved model/account and auxiliary-call budget**; none is recorded in the task. Making a model call without it violates S09/R06.

Resolution path (requires a new authorization recording the approved auxiliary model, account and call budget):
1. Wire `createShadowRelevancePhase.observe` to the approved auxiliary call path (host-owned, budget-enforced, 6 s timeout already in place); keep foreground bytes byte-for-byte invariant (T07/D05 assertions must keep passing).
2. Wire `createPrecomputeExperiment.summarize` to the same approved budget; keep single-in-flight, race discards and failed-call cost accounting (T06).
3. S13 live: run the paired quality/cost fixtures with the authorized provider fixture; report every outcome; keep deterministic fixture results separate. Without authorization, leave live measurements NOT_RUN.
4. Record per-call cost including failed/discarded attempts; never race a second compaction; never mutate active context.

### 3.4 HOLD_CONTRACT_SHAPE — U01 inspector row fields

State: ContextInspector has the four required tabs; rows show category/revision/bytes; opaque-native portions explicit. Missing per-row: inclusionReason, tokens, measurement, exclusionReason.

Why held: C01 forbids inventing a competing interface; `HostRequestProjectionV1` (the inspector's data source) has no such fields and the v6 block specifies no supplemental shape. `RequestContextSegmentV1` already carries inclusionReason/tokens/measurement, but no transport to the inspector is specified.

Resolution path (requires a **task-specified supplemental shape**):
1. Obtain an approved shape — e.g. an explicitly specified extension of HostRequestProjectionV1 or a new specified projection carrying per-source inclusionReason/tokens/measurement/exclusionReason. Do not choose it yourself.
2. Extend `projectHostRequest`/service projection to emit the approved shape (metadata only; never prompt content), then extend the existing Sources tab rows — no second inspector.
3. Browser evidence on the configured channel (§5) for the new rows, including unknown/excluded states.

### 3.5 Platform holds — browser channels and broad-gate environment failures

State and attribution (already established — do not re-litigate without new evidence):
- `pnpm test` final cut: 277 failed / 3073 passed / 46 skipped; unchanged baseline `ee2c7ad1`: 277 / 3063 / 46. The +10 passed are exactly the v6 tests. Failure-set differences are six timing-flaky non-M04 tests (plugin-tools-dock, project-search-host, plugin-validation-policy, personal-visuals-ui, hermes-acp-server, dev-plugin-runtime, integration-mcp Promptfoo case); quiet reruns on both cuts confirm bidirectional flakiness. Logs: final3-full-test.log, baseline2-full-test.log, final3-delta-rerun.log, baseline3-delta-rerun.log, candidate/baseline-delta-rerun.log.
- `pnpm test:browser`: 18 suites pin `channel:'msedge'`, 12 pin `channel:'chrome'`; neither distribution exists on linux-arm64 (no arm64 Linux builds). This includes the M04 `usage-context` suite (21 launch failures, zero assertion failures). 42 plain-chromium suites fail on BOTH cuts; `dist/web` is byte-identical between cuts (53 files, equal SHA-256), so no browser delta is source-caused. Logs: browser.log (full: /home/piadmin/m04-v6-notes/browser.log), baseline-browser.log, bounded receipts in logs/.
- Stable unit-gate environment failures: linux-path-guard sandbox (requires fd3 socket / fd4 directory / NoNewPrivs=1 / zero caps / ext4 mount boundary — the reviewed launcher is absent), pinned Python 3.14 (only 3.12 present; HARNESS_HERMES_PYTHON unset), native Graphify/Biome/Impeccable engines, project-search 10k-file limit case.

Resolution path:
1. Preferred: run the gates on the reviewed linux-x64 workflow host with the reviewed sandbox launcher, pinned Python 3.14.10, native engines, and Edge/Chrome installed — the exact configured platforms (R09). Keep Windows/installed CI matrices separate.
2. On this arm64 host, only with explicit new authorization: provision missing runtimes (Python 3.14, sandbox launcher) — R08 as written authorizes no downloads. Browser channels must NOT be substituted; msedge/chrome suites remain platform-blocked on arm64 regardless.
3. node-pty: already provisioned by copying the original checkout's locally built `build/Release/pty.node` (pinned+patched 1.1.0, SHA-256 2e3ad304a9d65608e07fb9159738b8b955daaec1c5a17c7c42c0d16ad9dea521) into both worktrees' node_modules. Fresh installs need this again (onlyBuiltDependencies excludes node-pty).
4. Do not increase timeouts, skip assertions, or reclassify failures to obtain a pass (R09). Required failures prevent completion (R11); report PARTIAL/BLOCKED/FAIL with exact phases otherwise.

## 4. Re-verification sequence (run in this order, separate receipts)

```
export PATH=$HOME/tools/node24/bin:$PATH   # or the reviewed host toolchain
pnpm install --frozen-lockfile             # never edit the lockfile (R05)
pnpm build:credential-lease && pnpm build:widgets   # asset steps before targeted tests (R08)
pnpm exec vitest run tests/context-compiler-v3.test.ts
pnpm exec vitest run tests/context-results-v3.test.ts
pnpm exec vitest run tests/compaction-v3.test.ts
pnpm exec vitest run tests/context-contract-preservation-v6.test.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:browser
```

Supporting suites worth keeping green: context-discovery-v3, context-request-observation, context-result-custody, context-draft-sources, hermes-runtime, hermes-broker, usage-context, public-source, m01-m02-compatibility, tool-authority-v3, tool-effects-v3, effect-recovery-v3, research-baseline.

## 5. Recording requirements (R11/R12)

- Update `docs/implementation/v3/M04-verification.json` under ImplementationEvidenceV3 (strict schema; no computed bundleStatus inside the object). Preserve prior receipts separately under `docs/implementation/v6/M04/`.
- New source lock per cut: auditAncestorSha, executionBaseSha, inspected blobs, publicContracts with testIds; sourceLockDigest = SHA-256 of the lock bytes. Validate with `validateImplementationEvidence` + `bundleStatus` (validator script pattern: /home/piadmin/m04-v6-notes/validate-evidence.ts).
- Update requirements.json dispositions as holds resolve; keep HOLD_* strings as reasons, never inside strict status enums.
- Flags stay default false; each risky sub-capability needs its own proof; reviewerApproval false; publication LOCAL_ONLY unless a task-specific authorization says otherwise.
- Report the final commit SHA outside the commit, not inside a self-referential artifact. Commit identity used on this branch: per-invocation `-c user.name="Skytuhua" -c user.email="99881928+Skytuhua@users.noreply.github.com"` (no git config changes).

## 6. Artifact index

- Execution handoff + R03 conflict blob table: `docs/implementation/v6/M04/handoff.md`
- Requirement matrix (36 rows): `docs/implementation/v6/M04/requirements.json`
- Source lock: `docs/implementation/v6/M04/source-lock.json`
- Current evidence receipt: `docs/implementation/v3/M04-verification.json`
- Archived handoff-era receipt: `docs/implementation/v6/M04/M04-verification-handoff.json`
- Bounded logs: `docs/implementation/v6/M04/logs/` (full browser logs: `/home/piadmin/m04-v6-notes/browser.log`, `/home/piadmin/m04-v6-notes/baseline-browser.log`)
- Baseline cut: `/home/piadmin/Gen-V1-m04-baseline` @ ee2c7ad1
- PR: https://github.com/skytuhua-org/Gen-V1/pull/326 (head ee2c7ad1 at v6 pass; local commits e00834cc and predecessors are unpublished)
