<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1032 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: M13 isolated plugin backend binding qualification for release — verification procedure (no code fix)
- Repo: `skytuhua-org/Gen-V1`, issue #1032 (M-series coordinator issue)
- Plan revision: 1, 2026-11-20. Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`
- Links: PR #838 merged `6185a1fa61b582d1e15831e9304ec0978a9ed394`; PR #900 merged `a2c278ced5d930d8bd31315c40b94dc20da23de7`; M03 gate #774 (OPEN, `outcome: PARTIAL`); coordinator checkpoints 012/052.
- Status: BLOCKED — M13-S03 holds `HOLD_BACKEND_SELECTION`/`HOLD_PLATFORM_PROOF`; DEP-M13-BACKEND-01 open; no installed approved backend with current PASS proof; migration path refused. `plugins.isolatedV1` flag default off (catalog contributes no rows while off).
- Provenance: M13 requirements.json + handoff.md + checkpoints; plan by `devin-a-cloud-4f7c1e` (review/planning, no code changes).

### OBJECTIVE

Qualify or keep-blocked the native backend binding: record the exact M03-approved installed backend/profile identity via gate #774 (T01), run authorized native acceptance on the production WorkerLauncher/backend binding with denied admission on ambiguous proof (T02), and preserve migration refusal + independent release review (T03). Success = `approvedBackendId` bound to exact source + platform-negative matrix PASS receipts, or every criterion stays BLOCKED naming its dependency.

### REQUIREMENTS

- In scope: citing the M03 `approvedBackendId` + profile + artifact digest once #774 lands; running the native acceptance matrix on the exact source; recording deny-on-ambiguity outcomes; the release-review record.
- Out of scope: code changes, enabling `plugins.isolatedV1`, any migration code, backend selection changes, running a worker outside owned tests.
- Hard constraints: activation fails closed — `UNSUPPORTED_BACKEND` and `PLATFORM_PROOF_REQUIRED` paths must remain; a working IPC channel is never confinement evidence; the approved backend must be exactly one immutable operator/source-lock-approved identity — inferred or ambiguous proof ⇒ admission denied; `MIGRATION_PLAN_REQUIRED` refusal preserved until a separately approved migration execution/validation path exists; no automatic fallback to unrestricted host on any failure.
- Environment: the native negative matrix requires the packaged Windows launcher — Linux/macOS cannot produce this evidence; owned synthetic tests run anywhere.

### REPO_MAP (verified on `main@7ef0710c`)

- `packages/plugins/isolated-host.ts` — leased lifecycle (STARTING/ACTIVE/DRAINING/STOPPED/FAILED/UNKNOWN), `terminateOnce` single-cleanup, activation gate `HOLD_BACKEND_SELECTION`/`HOLD_PLATFORM_PROOF`, registrations = manifest-declared ∩ READY-advertised ops, migration refusal `MIGRATION_PLAN_REQUIRED`.
- `packages/plugins/lifecycle.ts`, `packages/plugins/installation.ts` — `admitIsolatedPackage` (owner `verifyPluginPackage`, pinned installed dir + `isolated.json` bound to verified digest).
- `packages/plugins/host.ts`, `packages/plugins/worker-entry.ts` — trusted V1 host untouched; worker activation context frozen `{dataDir, genVersion}`.
- `packages/contracts/plugin-worker.ts` — `PluginManifestV2`, `PluginLeaseV1`, `WorkerFrameV1` (4-byte LE length prefix, ≤1 MiB, 32 in-flight, 10 s handshake, 5 s shutdown grace), `PluginMigrationPlanV1`.
- `packages/core/execution-policy.ts` — M03 backend/profile enforcement point (M13-S03 sourcePath).
- `apps/server/plugin-routes.ts`, `apps/web/src/PluginFrame.tsx`, `apps/server/host.ts` — catalog + frame surface.
- Flag: `plugins.isolatedV1` (owner `m13`, default off).
- Tests: `tests/plugin-worker-v3.test.ts` (18), `tests/plugin-lifecycle-v3.test.ts` (15), `tests/plugin-protocol-decisions-v6.test.ts` (5).
- Docs: `docs/implementation/v6/M13/{requirements.json,handoff.md,logs/}`; gate evidence `docs/implementation/v3/M03-verification.json` (records `outcome: PARTIAL`).

### DESIGN

Verification procedure; three gates in order — each fails closed.

1. **T01 backend-identity gate.** Depends entirely on #774 (OPEN). Required input from the M03 owner: exactly one `approvedBackendId` bound to (a) installed artifact digest, (b) execution profile identity, (c) operator/source-lock approval reference — plus the #774 negative-matrix PASS receipts (`WORKSPACE_EXECUTE_NO_NETWORK`: outside-root read/write denial, protected account/app-state denial, DNS/TCP denial, child/process-escape denial, registry mutation denial, junction/hardlink-swap resistance, second-user denial, process-tree cleanup after forced kill, in-root control allowed). Procedure: verify each cited artifact is source-bound and current; confirm exactly one backend identity (not inferred from model/project). Ambiguous or missing ⇒ T01 BLOCKED, admission denied, hold names the gap. If #774 closes unmerged without the record, T01 stays BLOCKED permanently until re-supplied.
2. **T02 binding review + native acceptance.** Depends: T01 VERIFIED. Steps: (a) static review of the production `WorkerLauncher`/backend-binding path in `isolated-host.ts` + `execution-policy.ts` — confirm the launch supplies only `{dataDir, declared capabilities, processEnvironment allowlist}` over authenticated private pipes and that ApprovedLaunch is the sole confinement claim; (b) run authorized native acceptance on the exact source: real packaged launcher under the approved backend/profile; verify activation gates still fail closed when backend absent (`HOLD_BACKEND_SELECTION`, `PLATFORM_PROOF_REQUIRED`), no fallback to unrestricted host on init/proof/policy/teardown failure; record run IDs, executable/package digests, per-case results bound to exact SHA. Any ambiguous proof ⇒ `DENIED_ADMISSION` recorded.
3. **T03 migration refusal + release review.** Depends: T02. Steps: re-run the migration-needing update case — must still return `MIGRATION_PLAN_REQUIRED` even with a complete `PluginMigrationPlanV1` contract (no approved execution path exists); then independent reviewer posts signed release disposition (flags state `plugins.isolatedV1=false`, evidence links, whether the isolated lane may be enabled via a separate reviewed PR).

### EXECUTION_DAG

- **T01 — Record M03-approved backend/profile identity.** Deps: #774 output. Steps: cite `approvedBackendId` + digests + approval ref from #774 evidence; verify uniqueness and currency; checkpoint. Done-when: exact identity + artifact link in issue, or BLOCKED naming missing proof. Owner: M03 backend approval owner.
- **T02 — Native acceptance on exact source.** Deps: T01. Steps: static binding review + packaged-launcher negative matrix + fail-closed gate checks; record receipts. Done-when: all cases PASS bound to SHA or `DENIED_ADMISSION`/BLOCKED with specifics. Owner: M13 owner + independent verifier.
- **T03 — Migration-refusal re-check + independent release review.** Deps: T02. Steps: confirm `MIGRATION_PLAN_REQUIRED` refusal intact; reviewer signs disposition; flags unchanged until then. Done-when: refusal verified + signed disposition comment.

### VALIDATION

- Baseline re-verification (repo root): `pnpm exec vitest run tests/plugin-worker-v3.test.ts tests/plugin-lifecycle-v3.test.ts tests/plugin-protocol-decisions-v6.test.ts --maxWorkers=1` — expected 38/38 on audited SHA.
- Gate checks (fail-closed, owned tests): activation without approved backend ⇒ `HOLD_BACKEND_SELECTION`; absent platform proof ⇒ `PLATFORM_PROOF_REQUIRED`; undeclared ops ⇒ `PROTOCOL_VIOLATION`; migration update ⇒ `MIGRATION_PLAN_REQUIRED`; unconfirmed termination ⇒ `UNKNOWN` retained, replacement fenced.
- Native matrix (Windows only, when T01 exists): the #774 case list run against the real packaged launcher; every receipt binds executable/profile/backend/platform/test-source/package digests.
- Acceptance matrix: T01 `approvedBackendId` + digests recorded | T02 matrix PASS + binding review sign-off | T03 refusal verified + signed disposition | `plugins.isolatedV1` still false unless separately approved.
- Negative control: `d249c566` and older tested cuts remain cited under their own SHAs — never extended to new cuts.

### STATE

- Verified: #838 + #900 merged as default-off work; merged-cut validation PASS (public-source 11/11, plugin-worker-v3 18/18, plugin-lifecycle-v3 15/15, protocol-decisions 5/5); post-merge guards resolved (lifecycle cleanup, advertised ops); `tsc --noEmit` clean on follow-up.
- Blocked: T01 (#774 open, `M03-verification.json` `outcome: PARTIAL`, no `approvedBackendId`), T02, T03; `DEP-M13-BACKEND-01` held; flags `plugins.isolatedV1=false`, `reviewerApproval=false`.
- Risks: none new — procedure is additive; the lane stays default-off regardless.
- Next step: T01 — wait for the named approved M03 backend/profile (coordinator's stated next action); nothing else can start.

### REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1032
- Merges: #838 `6185a1fa`, #900 `a2c278ce`
- Gate: https://github.com/skytuhua-org/Gen-V1/issues/774
- Docs: `docs/implementation/v6/M13/{requirements.json,handoff.md}` @`5cde22a7`; `docs/implementation/v3/M03-verification.json`
- Baseline `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3`

