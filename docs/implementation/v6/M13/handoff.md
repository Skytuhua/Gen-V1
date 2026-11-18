# M13 Isolated and reversible extension lifecycle — handoff

## Custody

- Worktree: `/home/piadmin/Gen-V1-m13-v6` (git worktree of `/home/piadmin/Gen-V1`).
- Remote: `https://github.com/skytuhua-org/Gen-V1.git` (resolves to skytuhua-org/Gen-V1, repository id 1442565952).
- Branch: `agent/m13-v6`, created from captured `origin/main` `c77d4716d94f72008be04562cbb596f1bb445512`.
- Audit anchor: `4805af4680094d2af48ecf666688e750797e9dda` (source-inspection anchor only; not a claim of test success).
- Original checkout `/home/piadmin/Gen-V1` on `fix/t10-agents-grid-v3` preserved untouched (its `apps/web/src/App.tsx`, `tests/e2e/model-picker.spec.ts` modifications and untracked `qwencloud-api-key.txt` were never read into the task branch, reset, cleaned or stashed).
- Preflight duplicate-work search (local worktrees/branches, remote branches, named implementation paths) found no M13 owner; the exact assigned branch/worktree was created. No reset, clean, stash or ref updates performed; no account changes.

## Scope completed

- C1 protocol and compatibility: `packages/contracts/plugin-worker.ts` (PluginManifestV2, PluginLeaseV1, WorkerFrameV1, IsolatedDeclaration, PluginMigrationPlanV1, ExtensionViewV1) plus the WorkerFrameV1 codec in `packages/plugins/isolated-host.ts` — 4-byte unsigned LE length prefix + UTF-8 JSON, 1 MiB bound enforced before payload allocation, strict schema on decode.
- C2 host registration leases and disabled presentation: `IsolatedExtensionHost` with per-generation leases (STARTING→ACTIVE→DRAINING→STOPPED, FAILED/UNKNOWN), registrations revoked before call settlement, host-mediated dispatch that admits only manifest-declared tool operations; the existing extension surface (`/api/plugins`, `WorkspaceControls` Extensions menu) shows Trusted host extension vs Isolated extension with version, digest, declared capabilities, data scope, runtime state (Draining), retained-data status and update-block reasons — read-only, no activation control while the lane is gated.
- Worker boundary (S01): `packages/plugins/worker-entry.ts` runs the package's declared `hostEntry` in a separate owned process; activation context is frozen `{dataDir, genVersion}` — no Store, credential manager, runtime object or command client crosses. HELLO/READY binds protocol version, generation, plugin id, package digest and a per-launch random nonce; the worker independently recomputes the package digest from `plugin-files.json` before answering.
- Admission (S02): `packages/plugins/lifecycle.ts#admitIsolatedPackage` admits only an installed pinned package directory verified by the existing installer owner (`verifyPluginPackage`); `isolated.json` identity must equal the verified manifest. No archive upload, install script, download or dependency resolution added.
- Lifecycle (S05/S06/T03-T05): update = prepare→validate→drain→swap→revoke; the new generation publishes only after confirmed old-generation termination; unconfirmed teardown yields UNKNOWN and blocks any overlapping writable namespace; disable preserves package and private data; a FAILED/UNKNOWN lease admits no new generation.
- Migration gate (S07): `PluginMigrationPlanV1` contract + `evaluateMigrationPlan`; a migration-needing update without the complete pre-existing approved plan returns MIGRATION_PLAN_REQUIRED and leaves old package/data untouched. `updatePreview` reports capability expansion and migration need.
- G02 flag: `plugins.isolatedV1` added to the existing host-owned registry (`M13_FLAG_KEYS`, `CapabilityFlagKey` union, `hostDefinitions` owner `m13`) without replacing any key; defaults false; host-configured only; not present in strict UI preferences and not writable by agents or plug-ins.
- Hermes preserved (S09): `packages/runtime-hermes/worker.py` line 222 `config["plugins"] = {"enabled": False}` unchanged; no Hermes adapter admitted.
- UI (D06/U01-U03): extension rows flow through the existing `/api/plugins` catalog contract; no competitor frontend, no injected host-document scripts. Rows are display-only while the lane is off.
- Bound call path (R10): `POST /api/plugins/:id/isolated/{enable,disable}` is registered beside the trusted routes. It is gated by the host `admit()` window and the isolated host's own admission (flag + unique approved backend + current-platform PASS proof); every hold/error surfaces as a sanitized code, never host paths or secrets. The web client exposes no control for it while the lane is gated.

## Holds (recorded reasons, not status)

- HOLD_BACKEND_SELECTION: this host supplies zero installed approved `ExecutionBackend` identities, so `selectBackend` cannot select; activation/update paths fail closed with the recorded hold. No ambiguity was resolved by this code.
- HOLD_PLATFORM_PROOF: no backend carries a current-platform PASS `PlatformProof` for linux-aarch64 (consistent with M03's recorded BLOCKED native-execution evidence). C3/C4 real confined launch and the M13-T01/M13-D05 confinement matrix (protected DB/credential reads, out-of-root writes, network access) remain NOT_RUN — mocks were not substituted.
- HOLD_MIGRATION_PLAN: no pre-existing approved `PluginMigrationPlanV1` exists, so any migration-needing update returns MIGRATION_PLAN_REQUIRED rather than inventing or running migration code with host privileges.
- `createSpawnWorkerLauncher` resolves the TypeScript entry via `import.meta.url` for dev/test; a production confined launch must bind the proven backend's `ApprovedLaunch` to `WorkerTransport` — that binding is intentionally absent until a backend is approved.

## Tested

- `pnpm exec vitest run tests/plugin-worker-v3.test.ts` — 18/18 PASS (includes a real spawned worker process: HELLO/READY, bounded request, frozen context, SHUTDOWN).
- `pnpm exec vitest run tests/plugin-lifecycle-v3.test.ts` — 15/15 PASS.
- `pnpm exec vitest run tests/plugin-protocol-decisions-v6.test.ts` — 5/5 PASS (M13-D01..D05).
- `pnpm typecheck` — PASS (exit 0, required NODE_OPTIONS=--max-old-space-size=8192 on this host; the default 2 GB heap is insufficient for the full project graph).
- `pnpm lint` — PASS (0 violations across 606 sources).
- `pnpm test` — exit 1 on this cut (~352 report entries, bounded log): every failure is outside M13 scope — the dominant family is `linux-path-guard` CAPABILITY_DENIED denying sandboxed test directories on this host, plus a Playwright fixture timeout and a pre-existing staged-build manifest gap (`packages/core/verification-artifacts.ts` is source-only on base). All M13 suites pass; no M13 file appears in the failure census.
- `pnpm build` — PASS (exit 0; widgets, plugin-runtime and vite build completed).
- `pnpm test:browser` — see bounded log.

## Changed files

`packages/contracts/plugin-worker.ts`, `packages/plugins/isolated-host.ts`, `packages/plugins/lifecycle.ts`, `packages/plugins/worker-entry.ts` (new); `packages/core/capability-flags.ts`, `apps/server/host.ts`, `apps/server/server.ts`, `apps/server/plugin-routes.ts`, `apps/web/src/PluginFrame.tsx`, `apps/web/src/WorkspaceControls.tsx`, `apps/web/src/App.tsx` (extended); `tests/plugin-worker-v3.test.ts`, `tests/plugin-lifecycle-v3.test.ts`, `tests/plugin-protocol-decisions-v6.test.ts` (new); `docs/implementation/v6/M13/requirements.json`, `docs/implementation/v6/M13/logs/*`, `docs/implementation/v3/M13-source-lock.json`, `docs/implementation/v3/M13-verification.json`.

## Outcome

PARTIAL: protocol, lease/lifecycle, admission, migration gate, flag and catalog/UI lanes are implemented with passing source-bound tests on this cut. Real confined execution under an approved M03 backend is BLOCKED (HOLD_BACKEND_SELECTION + HOLD_PLATFORM_PROOF); the trusted V1 lane is untouched and operational; `plugins.isolatedV1` remains false; publication stays LOCAL_ONLY; reviewerApproval remains false.

## Continuation — second session (2026-11-18, continuation owner)

The assigned agent for the continuation reviewed the state above, preserved the
task-owned edits verbatim and ran R01/R02/R03 against the current cut.

- Duplicate-work check: this worktree/branch was already the exact assigned
  `agent/m13-v6` at `/home/piadmin/Gen-V1-m13-v6`; the prior session's task work
  was uncommitted. No alternate branch/worktree was created. The original
  checkout `/home/piadmin/Gen-V1` (`fix/t10-agents-grid-v3`, its modified
  `App.tsx`/`model-picker.spec.ts` and untracked `qwencloud-api-key.txt`) and
  every other worktree were preserved untouched; a concurrent live session in
  `Gen-V1-m17-v6` was observed and not modified. No reset, clean, stash or ref
  update occurred.
- Checkpoint (R03 preservation): the complete task-owned diff was committed as
  `d249c566f8c4e6bca6eb04939afce8439957e5dc` on `agent/m13-v6`; `git status
  --porcelain` was empty before integration. Preserved starting HEAD for R03 =
  `d249c566`.
- R02/R03 base integration: `git fetch origin main` resolved captured main to
  `4aef753ec272d6ab9f9f9eec1df0ca232386975b` (94 commits ahead of branch point
  `c77d4716`). `git merge --no-commit --no-ff 4aef753e` auto-merged
  `apps/server/server.ts` and `apps/web/src/App.tsx` and produced one content
  conflict:
  - path: `scripts/public-source-files.json`
  - base blob (stage 1): `8622a908c357f47b81bd2a998da1735be5c83c10`
  - ours blob  (stage 2): `b1becd7eda31139a4b69ad44a1110b848521aa08`
  - theirs blob (stage 3): `6c0964767f162de858e4425354d8064c74353703`
  - character: M13 appends its evidence/source entries to the manifest; main
    regenerated ~9,200 manifest lines on this cut. One conflict hunk.
  Per R03, `git merge --abort` restored the initially clean task worktree
  (verified: `git status --porcelain` empty, HEAD `d249c566`). The affected
  join is marked **HOLD_SOURCE_DRIFT**: no blanket ours/theirs or guessed
  replacement was applied and no remote update occurred. A later authorized
  resolution can compose both sides: the file is a generated manifest whose
  correct result is the main-side regeneration plus the M13 entry list.
- Re-verification on the checkpoint cut: `pnpm exec vitest run
  tests/plugin-worker-v3.test.ts` 18/18 PASS, `tests/plugin-lifecycle-v3.test.ts`
  15/15 PASS, `tests/plugin-protocol-decisions-v6.test.ts` 5/5 PASS (direct
  runs). Two receipted re-runs of the worker suite then failed the spawned
  worker's 15 s handshake deadline (HANDSHAKE_FAILED at ~22 s) under load
  average ~17 while this worktree's `pnpm test:browser` and the m17-v6
  session's browser run were executing concurrently; the earlier recorded
  receipts show the identical cold-transform failure signature followed by a
  pass. The deadline constants were not changed; the failures are recorded as
  contention, not a protocol regression.
- `pnpm test:browser`: the prior session's receipted run (wrapper
  `/tmp/m13-receipt.mjs` → `logs/pnpm-test-browser-bounded.log`) was still
  executing when this session began and was allowed to complete rather than
  duplicating the gate; its receipt lands in `logs/receipts.jsonl`. During the
  ~40 s merge-attempt window above, staged main-side content for
  `server.ts`/`App.tsx` was present in the worktree before `--abort` restored
  the checkpoint; no M13 surface is exercised by the browser suites, but the
  overlap is recorded for custody completeness.
- Remaining named holds unchanged: HOLD_BACKEND_SELECTION,
  HOLD_PLATFORM_PROOF, HOLD_MIGRATION_PLAN, plus the new HOLD_SOURCE_DRIFT on
  the origin/main join. Outcome stays PARTIAL/BLOCKED, LOCAL_ONLY,
  reviewerApproval false.

## Consolidation — sole owner (2026-11-18)

The user consolidated M13 into the original session; the continuation session
stopped and `d249c566` is preserved as the checkpoint HEAD. Verified
independently: HEAD `d249c566`, index empty, no MERGE_HEAD/rebase/cherry-pick
state (the recorded merge abort was clean). The earlier `pnpm test:browser`
receipted run was terminated before completion — its result would have been
stale (started pre-checkpoint) and concurrent with the merge attempt window,
so it cannot satisfy acceptance; the gate was re-run on `d249c566` instead.

Receipt → source-cut verdicts after consolidation:

- STALE: 08:04–08:15 receipts (targeted suites, lint, typecheck) ran against
  the uncommitted pre-race-fix tree; superseded.
- VALID for `d249c566`: 10:14–10:15 receipts re-ran all three targeted suites
  on the committed cut (worker 18/18, lifecycle 15/15, decisions 5/5 — the
  `*-d249c566` receipt names bind the cut); 08:5x lint/typecheck/build receipts
  ran against working sources byte-identical to the committed blobs.
- CONCURRENT (cannot satisfy acceptance): the 08:22→09:23 `pnpm test` spanned
  the 08:4x race-fix edit; retained as executed-gate evidence only — its
  ~352 report entries were all environment-bound and outside M13. A fresh
  run on `d249c566` supersedes it.
- Executed-on-HEAD FAIL (contention, not regression): the continuation
  session's two `post-checkpoint` worker receipts failed the fixed 10 s
  handshake deadline while three heavy suites saturated the box; the same
  suite passes on a quiet cut.
- Host reboot at ~10:2x interrupted the in-flight receipted `pnpm test`; the
  wrapper writes receipts atomically at completion, so nothing partial was
  recorded; the run was relaunched on the same cut.

## Publish — draft PR under explicit holds (2026-11-18)

Manager decision: publish a single scoped M13 draft from the owned
implementation and verifiable evidence without waiting for the browser gate.
What was verified on the exact published cut (`d249c566`, plus the doc-only
custody commit on top):

- `pnpm exec vitest run tests/plugin-worker-v3.test.ts` — 18/18 PASS (10:14).
- `pnpm exec vitest run tests/plugin-lifecycle-v3.test.ts` — 15/15 PASS (10:15).
- `pnpm exec vitest run tests/plugin-protocol-decisions-v6.test.ts` — 5/5 PASS (10:15).
- `pnpm typecheck`/`lint`/`build` — PASS receipts on byte-identical sources.
- `pnpm test` — executed on `d249c566`, exit 1; every retained failure is
  environment-bound (linux-path-guard CAPABILITY_DENIED family, Playwright
  fixture timeouts, pre-existing staged-build manifest gap) — zero failures
  in any M13 file.
- `pnpm test:browser` — launched on `d249c566` (receipt name
  `pnpm-test-browser-d249c566`); still executing at publish time — cited as
  partial evidence, never marked run or passed.

Holds at publish: HOLD_BACKEND_SELECTION, HOLD_PLATFORM_PROOF,
HOLD_MIGRATION_PLAN, HOLD_SOURCE_DRIFT (origin/main join, manifest conflict —
authorized resolution = main-side manifest regeneration plus the M13 entry
list). `plugins.isolatedV1` remains default-off; no merge and no activation
are granted by this publication.
