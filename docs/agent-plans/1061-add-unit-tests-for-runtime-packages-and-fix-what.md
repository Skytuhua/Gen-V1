<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1061 — mirrors the canonical plan in the issue body. -->

# Fix plan (rev 1) — Unit tests for runtime packages

## META
- Feature: vitest unit coverage for `packages/runtime`, `packages/runtime-login`, `packages/runtime-official`, `packages/runtime-pi`
- Repo: github.com/skytuhua-org/Gen-V1
- Plan revision: 1 — 2026-11-20
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified)
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1061
- Status: reviewed; export census + existing-test map below produced from the baseline
- Provenance: devin-a-cloud-b7d3e9 (review/planning)

## OBJECTIVE
Every exported symbol in the four runtime packages is either covered by a vitest unit test (edge cases, error paths, invalid input; process/network boundaries mocked) or explicitly justified as not unit-testable in the PR body. Success metric: each module's export list maps to a test file or a stated exemption.

## REQUIREMENTS
- In scope: new `tests/*.test.ts` files; source fixes only when a clear bug is found (separate concern, still <400 lines/PR).
- Out of scope: files changed by open PRs; integration/browser/e2e coverage (existing `tests/e2e/` and `test:browser` suites cover those); no mocking of filesystem paths the repo's path-guard rejects on Linux — tests must run cross-platform or be skipped with a stated reason.
- Existing overlapping PRs (do NOT duplicate; verify gaps after they merge): #962 `tests/runtime-request-helpers.test.ts` (request scheduler/metrics/capabilities helpers), #958 `tests/pure-helper-modules.test.ts`, #1064 `tests/official-manifest-save.test.ts`, plus workspace test PRs #1052/#1066/#1068/#1069/#1021.
- Conventions: tests live at repo root `tests/`; run via `pnpm exec vitest run tests/<file>.test.ts`; file-access/path-guard tests fail on Linux (CI is windows-latest) — plan any file-touching test for Windows or mock the boundary.

## REPO_MAP — module → exports → existing coverage (verified)
Naming `T/F/I` = test-file/function/indirect coverage exists; `GAP` = no test file references the module. Existing test file names are evidence only — the implementer must confirm each exported symbol is actually exercised.

### packages/runtime (9 modules)
- `memory-checkpoint.ts` — exports: `MEMORY_CHECKPOINT_TIMEOUT_MS`, `requiresMemoryCheckpoint`, `sameMemoryCheckpointRequirement`, `validateMemoryCheckpointRequest`, `validateMemoryCheckpointAck`, `routeMemoryCheckpoint`. Covered by tests/memory-native-checkpoint-v3.test.ts, memory-checkpoint-worker-ownership-v3.test.ts, hermes-runtime.test.ts.
- `request-metrics.ts` — `MODEL_REQUEST_STAGES`, `RequestMetrics`, `RequestMetricsLog`. Covered by model-transport-v3.test.ts (+ #962).
- `request-scheduler.ts` — `RequestClass`, `requestClassFor`, `ModelPermit`, `RequestAdmission`, `RequestScheduler`, `hermesRequestScheduler`, `RequestBudget`, `STATELESS_IDLE_EXPIRY_MS`, `StatelessTransport`, `StatelessTransportPool`, `resolveNewTaskProfile`. Covered by model-scheduling-v3.test.ts, model-transport-v3.test.ts (+ #962).
- `account-auth.ts` — `parseAccountAuthTarget`, `readAccountAuth`, `signOutAccount`. Covered by account-auth.test.ts, account-auth-http.test.ts.
- `account-profile.ts` — `providerAccountKey`, `accountProfileRoot`, `withAccountProfile`. Covered by account-parity.test.ts, account-storage-boundary.test.ts.
- `model-capacity.ts` — `ModelCapacity`, `ModelRequestGate`, `hermesModelCapacity`, `hermesReviewCapacity`. Covered by integration-host.test.ts, background-work-v3.test.ts.
- `model-only.ts` — byte/budget constants, `ModelPurpose`, `assertMemoryExtractionModel`, `modelOnlySystemPrompt`, `assertModelOnlyInput`. Covered by runtime-model-only.test.ts, memory-extraction-native-v3.test.ts, prediction-runtime.test.ts.
- `request-capabilities.ts` — `assertCapabilities`, `hermesModelTransportCapabilities`. Covered by model-transport-v3.test.ts (+ #962).
- `project-context.ts` — `projectContextSystemPrompt`. Covered by hermes-runtime.test.ts, project-instructions-custody.test.ts.

### packages/runtime-login (2 modules)
- `account-login.ts` — `withAccountLogin`. Covered by account-login.test.ts.
- `index.ts` — `parseConnectionLogin`, `connectionLoginMain`. Covered by connection-login.test.ts, desktop-packaging.test.ts.

### packages/runtime-official (18 modules)
- `internal.ts` — `WireInput`, `DriverContext`, `OfficialDriver`, `HistoryReceipt`, `textContent`, `finite`, `bounded`, `asyncQueue`. Partially covered (baseline-workloads-v3.test.ts); pure helpers `finite`/`bounded`/`asyncQueue` need direct edge-case tests (overflow, timeout, ordering) → include in new test file. Note #958 "pure helper modules" may already cover — verify first.
- `manifest.ts` — `InputReceipt`, `Manifest`, `ManifestState`, `threadDirectory`, `within`, `secureDirectory`, `readManifest`, `openManifest`, `saveManifest`. Covered by official-runtime-storage.test.ts, checkpoint-restore-v3.test.ts + #1064.
- `receipts.ts` — `leadingReceipts`. Covered by baseline-workloads-v3.test.ts.
- `environment.ts` — `OfficialProvider`, `officialRuntimeCommand`, `officialRuntimeHome`, `officialRuntimeEnvironment`. Covered by browser-verification-v3.test.ts, baseline-package-manager-v3.test.ts.
- `account-identity.ts` — `cursorIdentity`, `claudeIdentity`, `readOfficialIdentity`, `assertSameIdentity`, `bindOfficialIdentity`. Covered by official-runtime-claude.test.ts.
- `cursor-credentials.ts` — `CURSOR_LOGIN_BACKEND`, `CURSOR_LOGIN_WEBSITE`, `cursorAuthPath`, `cursorAuthRequired`, `cursorCredentialStore`, `assertCursorLoginUrl`. Covered by cursor-credentials.test.ts.
- `claude.ts`, `cursor.ts`, `gemini.ts`, `gemini-headless.ts`, `gemini-native-history.ts`, `history.ts`, `claude-account.ts`, `acp.ts`, `mcp.ts`, `cursor-mcp.ts`, `cursor-worker.ts` — covered by the official-runtime-* test family (official-runtime-claude/cursor/mcp/acp/headless/storage/service, cursor-worker.test.ts, cursor-mcp.test.ts, official-claude-history-encoding.test.ts, official-native-boundaries.test.ts).
- `index.ts` — `OfficialRuntimeDependencies`, `createOfficialRuntime`. Covered by official-runtime-service.test.ts.
- `history-command.ts` — no exported declarations (empty list) → exempt, state reason.

### packages/runtime-pi (17 modules)
- `plan-keys.ts` — `isPlanProvider`, `isPlanCredential`, `registerPlanKeyProvider`. **GAP** — only covered indirectly via plan-key-connections.test.ts (which targets connections); needs a dedicated test: pure predicates (true/false per provider string) + registerPlanKeyProvider happy path and already-registered/unknown-provider error paths.
- `presentation-policy.ts` — `PRESENTATION_POLICY` const → covered by proactive-presentation.test.ts.
- `input-envelope.ts` — `encodeInput`, `messageInputIds`, `extractInputIds` → covered by hermes-runtime.test.ts, memory-native-checkpoint-v3.test.ts.
- `events.ts` — `EventNormalizer` → covered by runtime-pi.test.ts.
- `ipc.ts` — `ToolRequest`, `ToolReply`, `sameContext`, `routeToolCall`, `ToolBridge`, `CheckpointRequest`, `CheckpointReply`, `CheckpointBridge` → covered by runtime-pi.test.ts, memory-native-checkpoint-v3.test.ts, desktop-native.test.ts.
- `tool-definitions.ts` — `ToolMetadata`, `UI_TOOLS`, `TASK_FINISH`, `VERIFICATION_DECLARE`, `OPERATION_EXECUTE`, `TASK_MEMORY`, `SKILL_TOOLS`, `loadDomainTools`, `createHostTools`, `hostSystemPrompt`, `createHostResourceLoader` → covered by memory-extraction/proactive-presentation tests; `loadDomainTools` error path (missing domain dir) needs a direct test → GAP (partial).
- `delivery.ts` — `dispatchInput` → covered by agent-input-v3.test.ts.
- `session.ts` — `taskPaths`, `validateSessionPath`, `openTaskSession` → covered by account-parity / background-contract tests.
- `memory-checkpoint.ts` — `PiCheckpointOptions`, `createPiCheckpointExtension` → covered by memory-native-checkpoint-v3.test.ts.
- `login.ts`, `credentials.ts`, `connections.ts`, `models.ts`, `process-tree.ts`, `sdk.ts`, `worker.ts`, `index.ts` — covered by account-parity/connection-login/cursor-credentials/model-discovery/process-tree-adjacent/runtime-pi tests as mapped above.

Files to skip (open PRs touching runtime sources): #1083 (`packages/runtime-pi` tool-reply error path), #1084 (worker exit), #1088 (gemini receipts), #1089 (credential-lease build artifacts), #1092 (hermes failed-request recording), #1093/#1094 (native start settlement, transport pool shutdown) — check `gh pr list` before choosing a file; skip any file an open PR modifies.

## DESIGN
New test files only (no source edits unless a bug is found; then a separate small PR). One test file per concern, mirroring existing naming `tests/<area>.test.ts`:
- `tests/pi-plan-keys.test.ts` — the one clear GAP. Cases: `isPlanProvider`/`isPlanCredential` truth table over `SUBSCRIPTION_PROVIDERS` members and non-members (empty string, `undefined`, wrong case); `registerPlanKeyProvider` registers once, rejects duplicate registration and unknown provider; mock its network/store boundary the way `tests/plan-key-connections.test.ts` does.
- `tests/runtime-official-internal.test.ts` — only if #958 does not already cover: `finite` on `NaN`/`Infinity`/negative/0, `bounded` resolves under limit and rejects at limit+1, `asyncQueue` preserves FIFO and propagates rejection to the queued consumer.
- For every other module: verification pass — for each exported symbol, grep the mapped test file(s) for the symbol name; symbols with zero references get one test each added to the closest existing test file (or a new file per concern). Any remaining untestable symbol (e.g. requiring real provider auth) is listed in the PR body with the reason.

## EXECUTION_DAG
- T01 — Audit pass: produce the symbol↔test mapping table for all 44 modules (procedure in DESIGN); output pasted into PR body. Deps: none. Done-when: every export has a mapped test or an exemption reason.
- T02 — Write `tests/pi-plan-keys.test.ts`. Deps: T01 confirms gap remains after #962/#958 merge state. Tests: `pnpm exec vitest run tests/pi-plan-keys.test.ts`. Done-when: predicates + register happy/error paths pass.
- T03 — Fill remaining per-symbol gaps found by T01 (one file per concern, each ≤400 lines/PR). Deps: T01. Done-when: mapping table has no uncovered symbol without exemption.
- T04 — Optional bug fixes found during testing, each its own PR. Deps: none structural.
- T05 — Gates: `pnpm lint`, `pnpm typecheck`, `pnpm test` per PR; merge through normal gate. Note: run vitest on Windows or accept the documented Linux path-guard limitation for fs-touching tests.

## VALIDATION
- Executed at planning: export census (rg `^export` per module — reproduced above); test-file ↔ module grep map (reproduced above); open-PR file lists for #962/#958/#1064 fetched (new test files only).
- Planned: `pnpm exec vitest run tests/pi-plan-keys.test.ts` (+ any T03 files) — PASS; `pnpm lint && pnpm typecheck` — PASS; `pnpm test` — PASS or documented flake list.
- Acceptance: every module's exports tested or exempted in writing; per-PR <400 lines.

## STATE
- Researched: full export census, coverage map, overlapping PRs.
- Implemented: none. Pending: T01–T05.
- Risks: (a) open test PRs may land first — recheck before writing; (b) Linux file-access test failures — plan fs-boundary tests for Windows or mock; (c) provider-auth functions may be untestable without live credentials — use the exemption route rather than brittle mocks.
- Next step: implementer claims issue, runs T01 audit.

## REFERENCES
- Issue #1061; module export lists and test map above; overlapping PRs #958, #962, #1064; `tests/` naming conventions; blueprint `test` command `pnpm exec vitest run tests/<file>.test.ts` (Windows CI for fs-boundary tests).

