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

## Close-out pass — backend inventory, migration fixture, browser receipt

### M03 backend inventory on this cut

Audited every `ExecutionBackend` construction site repo-wide:

- M03 shipped the **policy contract only** — `ExecutionBackend` interface,
  `PlatformProof` type, `selectBackend` / `hasCurrentPlatformProof` /
  `assertProvenBackend` in `packages/core/execution-policy.ts`. M03's own
  verification records "No such backend exists on this host" and leaves the
  backend-installation gate OPEN.
- Host supply: `HostOptions.isolationBackends` → `backends: () =>
  options.isolationBackends ?? []` (default empty); `approvedBackendId` →
  `options.approvedBackendId` (unset). `hermes-service.ts` passes
  `backends: []` explicitly.
- Every `ExecutionBackend` object literal in the repo is a **synthetic test
  double** inside `tests/**` (`unit-test-backend`, `test-backend`,
  `fixture-backend`, `backend-a/b`) whose `proof` fields are fabricated
  fixtures — none is a registered, installed backend and none carries a real
  target-platform proof receipt.

**Registered backends: 0. Proof receipts to match to immutable identities:
0. Eligible candidate: none.**

Exact missing evidence for an eligible candidate (all four required):
1. An installed backend implementation constructing `ExecutionBackend` with
   a real `launch()` enforcing declared file/process/network policy.
2. `installed: true` + `approved: true` granted by the operator/source lock —
   the contract forbids this code from self-approving.
3. An `approvedBackendId` supplied by the operator/source lock resolving to
   exactly one installed approved backend (zero → UNSUPPORTED, ambiguous →
   BLOCKED, per `selectBackend`).
4. A `PlatformProof` bound to that backend: `platform === process.platform`
   on the host (`linux`), `proof.platform === backend.platform`,
   `status: 'PASS'`, a `platformProofRef` a launch profile can pin — produced
   by a real proof run on linux-arm64 hardware, not a test literal.

No backend was selected and no flag was enabled; HOLD_BACKEND_SELECTION and
HOLD_PLATFORM_PROOF stand, now with the exact evidence gap enumerated.

### Migration/update validation + rollback — repository-owned fixture

Exercised the checked-in fixture `tests/plugin-lifecycle-v3.test.ts`
(synthetic state only — `fixturePackage` tmpdir packages, `plan()` synthetic
contract, `FakeTransport`; no real customer data) on published head
`c7ddac31`: receipt `vitest-plugin-lifecycle-c7ddac31`, exit 0, 15/15, log
digest `7388f007951b4d0240a69948d414845dde68e29f6407976793b2f1b2b237bc9e`.
Observed: update drains generation 1 before publishing generation 2;
`requiresMigration` without a complete approved plan → `MIGRATION_PLAN_REQUIRED`
with the old lease still ACTIVE (nothing drained); a failed new-generation
launch → `UNKNOWN` with the previous manifest retained; generation-1 replies
cannot publish into generation 2.

**Smallest proposed migration plan identity** (`pluginMigrationPlanV1Schema`,
strict, seven required fields): `planId` (≤100 chars) + the version pair
`inputVersion`/`outputVersion` — the gate matches those exactly against the
installed and next manifests, e.g.
`{planId: '<assigned-id>', inputVersion: '1.0.0', outputVersion: '2.0.0'}`.

**Review inputs approval must bind** (the remaining four fields):
- `backupDigest` — sha256 of a real pre-migration backup snapshot of the
  private data namespace.
- `executableSha256` — sha256 of the exact migration executable, which may
  only ever launch through the proven backend (still held).
- `approvedAt` — operator approval timestamp.
- `validationReceipt` — reference to a real post-validation receipt required
  before migrated data is re-admitted into the namespace.

A schema-valid plan only flips `evaluateMigrationPlan` to READY; approval is
an operator act this code cannot perform, and even a READY plan's executable
stays gated by HOLD_PLATFORM_PROOF. HOLD_MIGRATION_PLAN stands until an
approved plan exists.

### Browser receipt landed

`pnpm test:browser` on `d249c566` finished (receipt
`pnpm-test-browser-d249c566`, 2026-11-18T11:53:29Z→18:18:32Z, exit 1,
log digest `2baaaeb43c0f03b3156c94ab1e79a9839a929fdd08eed793784eb06cb661fd0a`):
14 failed / 10 passed — all 14 failures in sibling-milestone spec
`tests/e2e/wo8.spec.ts` (`.surface-metric` rendering), zero M13 files.
Recorded as a FAIL command with the gate executed; previously cited as
in-flight partial evidence.

## HOLD_SOURCE_DRIFT resolved — merge 481fc646 (2026-11-18)

Manager-authorized reconciliation of the sole remaining actionable gate.
Fetched fresh `origin/main` = `7ac80d87` (119 commits past branch point
`c77d4716`; the earlier attempt had merged `4aef753e`, now superseded).

- `git merge --no-ff --no-commit origin/main` produced **exactly one
  conflict**: `scripts/public-source-files.json` — the reviewed
  public-source allowlist both sides extended. No other file conflicted;
  `apps/server/server.ts` and `apps/web/src/App.tsx` auto-merged cleanly
  (verified: M13 plugin wiring `extensions={pluginCatalog.extensions}` and
  plugin-selection setters intact; main-side compaction route and
  ContextInspector refactor preserved).
- Resolution per authorization: **main's regenerated manifest + exact
  M13-owned admissions**. Stage review — base `c77d4716`
  (4303 source / 264 runtime), ours `0745cc36` (4323/268 = base + 20 source
  + 4 runtime M13 entries), theirs `7ac80d87` (4341/282, baseline
  `6d32290f`). Resolved = theirs ∪ the 24 M13 entries = **4361 source /
  286 runtime**, sorted (required by `tests/public-source.test.ts`), zero
  removals, every main-side entry preserved, main's `baseline` retained.
- M13 entries admitted: 4 package sources (`contracts/plugin-worker.ts`,
  `plugins/isolated-host.ts`, `plugins/lifecycle.ts`,
  `plugins/worker-entry.ts`, in both source and runtime), 3 test files,
  13 evidence artifacts (`docs/implementation/v3/M13-*`,
  `docs/implementation/v6/M13/**`).
- Merge committed `481fc646`. `d249c566` receipts remain the historical
  record for that cut; the validation below re-binds the focused gates to
  the integrated SHA.

### Integrated-SHA validation (on 481fc646)

| Gate | Receipt | Result |
|---|---|---|
| `vitest tests/public-source.test.ts` | `vitest-public-source-481fc646` | **PASS (exit 0)** — resolved manifest validates: sorted-unique, runtime ⊆ source, all referenced files exist |
| `vitest tests/plugin-worker-v3.test.ts` | `vitest-plugin-worker-481fc646` | **PASS (exit 0, 18/18)** — incl. real spawned-worker handshake on merged sources |
| `vitest tests/plugin-lifecycle-v3.test.ts` | `vitest-plugin-lifecycle-481fc646` | **PASS (exit 0, 15/15)** — update/migration/rollback on merged sources |
| `vitest tests/plugin-protocol-decisions-v6.test.ts` | `vitest-plugin-decisions-481fc646` | **PASS (exit 0, 5/5)** — M13-D01..D05 on merged sources |
| `pnpm typecheck` | `pnpm-typecheck-481fc646` → `pnpm-typecheck-481fc646-8g` | **PASS (exit 0)** on the 8 GB-heap rerun; the first attempt recorded exit 134 — V8 heap OOM at the default ~2 GB limit (resource-bound on this host, not a type error), retained as an honest receipt |

Receipts land in `logs/receipts.jsonl` with bounded logs under
`logs/*-merged.log`. All five integrated-SHA gates observed: public-source
manifest + three M13 suites + typecheck — PASS on `481fc646`.

## Narrow backend unblocker — manager decision input (2026-11-18)

Question traced: can the existing M03 Linux guard supervise the entire
extension worker process for file/process/network policy through
`ExecutionBackend.launch`? **No — it is a directory-custody broker, not a
process supervisor.** Exact findings and what is missing:

### What exists today (cited APIs)

- `packages/core/linux-path-guard.ts` + `linux-path-guard.py` — trusted OS
  setup (root/CAP_SYS_ADMIN at install) that runs **Gen itself** in a
  private mount namespace: `NoNewPrivs:1`, `CapEff/Prm/Bnd/Amb` all zero,
  full-range `uid_map`, ext4 root, then serves an `acquire`/`release`
  protocol over inherited fd 3 that pins directories with **kernel bind
  mounts** (`withLinuxDirectoryGuard`), plus `credential-*` read-only
  bind-mount barriers (`acquireLinuxCredentialReadBarrier`). Its custody
  object is **paths**: it runs the *host's own* callback while mounts are
  held. It never spawns, confines, or watches a child process — no
  process-tree ownership, no seccomp/cgroup on a worker, **no network
  verbs at all**. Coverage vs the worker requirement: file roots —
  partially (mount pinning machinery is real and reusable); process — none;
  network — none.
- `packages/core/execution-policy.ts` — the `ExecutionBackend` contract the
  isolated lane selects: `backendId/platform/installed/approved/proof +
  launch(ApprovedLaunch) → ExecutionHandle{id, terminate()}`. Admission =
  `selectBackend` (exactly one installed+approved match) +
  `hasCurrentPlatformProof` (`platform===process.platform`,
  `proof.platform===backend.platform`, `status==='PASS'`).
  **Note the handle carries no stdio** — a WorkerFrameV1 channel cannot be
  built from `ExecutionHandle` alone.
- `packages/core/verification-executor-binding.ts` —
  `ObservedVerificationBackend extends ExecutionBackend` with
  `launchObserved(...) → LaunchedProcess{pid, tree(), wait(), terminate(),
  log()}`: "the approved backend owns atomic confinement, the observed
  handle and tree cleanup," re-checking `assertCurrent` immediately before
  native spawn. Its admission additionally demands `proof.evidenceRef` and
  `proof.platformProofRef === profile.platformProofRef`. This is the exact
  existing API shape a production worker backend must grow toward — but
  `LaunchedProcess.log()` is captured output, not an interactive frame
  channel either.
- `packages/plugins/isolated-host.ts` — the launch seam is
  `WorkerLauncher.launch(spec) → WorkerTransport`;
  `createSpawnWorkerLauncher` is explicitly dev/test (plain `spawn`, no
  confinement) and the code comment states: *"Production confined launch
  binds the M03 backend's launch to the same WorkerTransport shape."*
- Host registration exists as options only: `HostOptions.isolationBackends`
  (default `[]`) + `approvedBackendId` (unset); `hermes-service.ts` passes
  `backends: []`. Nothing constructs a production backend.
- **Overlapping M03 PRs**: open #832 (browser DOM observation redaction)
  and #817 (unauthenticated advisory exception fail-closed); the closed
  repair family (#802/#781/#773/#770/#762/#759/#749/#747/#744/#742) covers
  exports/manifests/guards. **No PR registers or installs a backend.**

### Exact missing production pieces (smallest unblocker set)

1. **A `launch` supervisor.** A real `ExecutionBackend` implementation that
   spawns the worker child with: mount namespace + bind-mounted
   readRoots/writeRoots (guard machinery directly reusable for this leg),
   process-tree ownership + bounded confirmed terminate (the
   `LaunchedProcess{pid,tree(),wait(),terminate()}` shape), and network
   enforcement for `networkPolicy` (`none`/`allowlist`) — **nothing in the
   repo enforces network policy today**. The guard alone cannot be it.
2. **A frame channel into the confined child.** `ExecutionHandle`/
   `LaunchedProcess` carry no stdio; `WorkerTransport` needs bidirectional
   frames over host-created private pipes. Options: fd-passing through the
   launch (broker precedent — fd 3 socket + fd 4 root dir) or a declared
   unix-socket rendezvous. Either needs a contract extension beyond the
   current `ApprovedLaunch`/`ExecutionHandle` shapes.
3. **A production `WorkerLauncher`** binding the backend's launch to
   `WorkerTransport` (the documented seam), replacing the dev/test spawner
   only under proven admission.
4. **Registration wiring**: production construction of the backend plus
   `isolationBackends` + `approvedBackendId` populated in host config —
   the options exist; nothing sets them.
5. **Operator approval + source-lock entry**: `installed:true`,
   `approved:true`, `approvedBackendId` must come from the operator/source
   lock — the contract forbids code-side self-approval.
6. **An `ExecutionProfileV1` for the worker launch**: `backendId`,
   `platformProofRef`, `executableSha256` (exact worker loader bytes),
   readRoots/writeRoots = package+data dirs, `networkPolicy`.
7. **A Linux-arm64 `PlatformProof`**: `{platformProofRef, platform:'linux',
   status:'PASS', recordedAt, evidenceRef}` produced by running the M03
   native negative matrix (protected DB, credential access,
   out-of-root write, network, child escape, kill cleanup) on this
   platform. M03's own verification records the Windows matrix BLOCKED and
   "No non-Windows proof was attempted" — **no Linux proof exists
   anywhere**, and no guard-only or synthetic run qualifies.

Status unchanged: `plugins.isolatedV1` off, HOLD_BACKEND_SELECTION +
HOLD_PLATFORM_PROOF + HOLD_MIGRATION_PLAN stand. This is a decision input,
not an implementation — no backend was built, selected, or substituted.
