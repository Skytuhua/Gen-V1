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
