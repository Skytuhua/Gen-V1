<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1055 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: Vitest unit coverage for the `apps/server` modules that currently have none.
- Repo: `skytuhua-org/Gen-V1` (local: `/home/ubuntu/repos/Gen-V1`).
- Plan revision: 1, dated 2026-11-20.
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified via `git rev-parse HEAD`).
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1055. No linked PRs.
- Current implementation status: 25 of 30 `apps/server` modules already have at least one matching `tests/*.test.ts`; six have no unit test.
- Source provenance: authored by `devin-a-cloud-3d96bc` (review/planning claim) from direct inspection; no code changed.

### OBJECTIVE

The issue asks for vitest unit tests over request validation, route handlers and helpers — edge cases, error paths, invalid input — using `tests/fixtures`. Six modules have zero unit coverage:

| Module | Lines | Shape | Testable without a live host? |
|---|---|---|---|
| `desktop-controls.ts` | 35 | pure async `handleDesktopControl(value, token, host, send)` | yes — inject host + send spy |
| `github-auth-routes.ts` | 17 | `registerGitHubAuthRoutes(app, auth)` | yes — Fastify `inject()` + fake `GitHubAuth` |
| `operation-execution-review-routes.ts` | 16 | `registerOperationExecutionReviewRoutes(app, service)` | yes — Fastify `inject()` + fake `executionAdvice` |
| `effect-service.ts` | 76 | `createProtectedHermesService(store, native, options, overrides)` | yes — `overrides` factories + temp-dir `Store` |
| `code-intelligence-routes.ts` | 309 | route registrations + `APPROVED_SERVERS` + `identifier` schema | partially — validation/error paths via `inject()`; LSP execution paths need justification or a fake `LanguageServerAdapter` (already an injected type) |
| `main.ts` | 56 | top-level process script | no — pure side effects; justify, do not unit test |

Success = each module either has a committed test file or a PR-body justification per the issue's "Done when".

### REQUIREMENTS

In scope: five new test files under `tests/` matching existing naming (`<module>.test.ts`), Fastify `app.inject()` for route modules, fake collaborators injected through existing seams (`overrides` param of `createProtectedHermesService`, fake `GitHubAuth`, fake `Service.executionAdvice`, fake `LanguageServerAdapter`/`DebugAdapter` where the code already accepts them), plus fixes for any clear bug the tests expose (documented in the PR body).

Out of scope: refactoring modules to make them testable beyond what seams already allow; `main.ts` unit tests (top-level script — its logic is `startupErrorDiagnostic`, `close()`, the IPC message handler; extracting it is a behavior-bearing refactor this issue does not authorize — justify instead); e2e/browser coverage; testing modules that already have tests (list in REPO_MAP).

Constraints: one concern per PR, each under 400 lines (split as T-PRs below); no file changed by an open PR (verify with `gh pr list` before each PR); `pnpm lint`, `pnpm typecheck`, `pnpm test` pass per PR.

### REPO_MAP (verified at baseline)

- `apps/server/desktop-controls.ts` — `handleDesktopControl(value, token, host, send): Promise<boolean>`. Verified behavior: rejects non-object/array values; token must match `/^[a-f0-9]{32,128}$/i` and `input.token` must equal it via `timingSafeEqual` with equal-length precondition; `requestId` must match `/^[a-zA-Z0-9:_-]{1,200}$/`; dispatch table for `harness.stopAll`, `harness.update.readiness`, `harness.update.prepare`, `harness.attention.read`, `harness.attention.open`/`dismiss` (extra `eventId` validated `/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,999}$/`), `harness.plugin.validate` (extra `surface` key), `harness.layout.save` (extra `layout` key); each sends `<type>.result`/named replies with the token echoed; every handler try/catches and replies with an error payload instead of throwing.
- `apps/server/github-auth-routes.ts` — `registerGitHubAuthRoutes(app, auth: GitHubAuth)`: `POST /api/github/auth/start` (empty strict object body, in-memory rate limit 5 starts/60 s → `429 {error:{code:'RATE_LIMITED'}}`, else `auth.start()`), `POST .../poll` and `POST .../cancel` (body `{flowId: uuid}` → `auth.poll/cancel(flowId)`); all set `Cache-Control: no-store`.
- `apps/server/operation-execution-review-routes.ts` — `GET /api/operation-execution-review`: query parsed by `operationExecutionTargetSchema.extend({operationRevision: z.string().max(16).regex(/^[1-9]\d*$/).transform(Number).pipe(...)})`, then `operationExecutionReviewSchema.parse(service.executionAdvice.read(...))`; `Cache-Control: no-store`.
- `apps/server/effect-service.ts` — `createProtectedHermesService(store, native, options = {}, overrides = {})`: early-returns `createService(store, native, {toolEffectFlags})` when neither `audit.effectsV1` nor `security.authorityV1` flag is enabled; otherwise reserves marker entity `kind='effectAuthorityProfile', id='global'` (`{version:1,keyId:uuid,state:'initializing'|'ready'}`) via `store.internal('effectAuthority.reserved',...)`, initializes or opens key custody via `initializeKey`/`openKey` factories (overridable), flips marker to `ready`, returns Hermes service with `authenticator`; any failure closes custody and continues without a provider.
- `apps/server/code-intelligence-routes.ts` — verified: `identifier = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/)`, `APPROVED_SERVERS` map (typescript/javascript→`typescript-language-server --stdio`, python→`pyright-langserver --stdio`), `installedExecutable()` via `execFileSync` probing, route registrations on a `FastifyInstance` using `requireCodeIntelligenceFlag`, `StdioLspAdapter`, `EditPreviewRegistry`, `DebugRegistry`, `renamePlanV1Schema`, `assertProvenBackend`. Discovery for the implementer: read the full file and the host fixture pattern in `tests/code-intelligence*.test.ts` siblings (none exist — use the Fastify `inject` pattern from `tests/integration-secret-reference-http-v3.test.ts`).
- `apps/server/main.ts` — top-level script: token validation, `launchHost(readHostOptions())`, IPC message handlers, `startupErrorDiagnostic()`; no exported symbols → justification, not a test file.
- Existing test conventions: `tests/*.test.ts` vitest; Fastify apps built in-test (`tests/integration-secret-reference-http-v3.test.ts`, `tests/conversation-read-http.test.ts`); temp `Store` via `mkdtempSync(join(tmpdir(),...))` (`tests/store.test.ts`); fixtures under `tests/fixtures` (only `tests/fixtures/project-memory-*` today — no new fixture needed).

### DESIGN

Five test files, no source changes expected (fixes only if a test exposes a clear bug, then documented):

1. `tests/desktop-controls.test.ts` — call `handleDesktopControl` directly.
   - Rejects: `null`, arrays, missing/short/bad-hex `token`, `input.token` wrong value or different length, `requestId` failing the regex → returns `false`, `send` never called.
   - `harness.stopAll` happy path → `send` called once with `{type:'harness.stoppedAll',token,requestId,stopped:3}`; host throwing → reply `{stopped:0,errors:[…]}` still sent.
   - `harness.update.readiness`/`prepare` → `{...}.result` with `idle` boolean; host method absent or throwing → `idle:false`.
   - `harness.attention.read/open/dismiss` — open/dismiss also validate `eventId` (bad `eventId` → `false`); host absent → error reply payload.
   - `harness.plugin.validate` → `harness.plugin.validated` with `allowed` from `validatePluginSurface`, exceptions → `allowed:false`.
   - `harness.layout.save` → `harness.layout.saved`; host throw → same type with `error` field.
   - Wrong `Object.keys` arity (extra key) → `false`.
2. `tests/github-auth-routes.test.ts` — `Fastify()` + `registerGitHubAuthRoutes`, `app.inject`.
   - `start` happy: 200, body exactly `auth.start()` result, `cache-control: no-store`.
   - Rate limit: 6 starts inside 60 s → 6th is 429 `RATE_LIMITED`; clock faked via `vi.useFakeTimers`/`vi.setSystemTime` advancing 61 s → next start succeeds.
   - `poll`/`cancel`: non-uuid `flowId`, extra body keys, missing `flowId` → 400/500 zod rejection (assert status and that `auth.poll` was not called); valid uuid → delegates and returns auth result.
3. `tests/operation-execution-review-routes.test.ts` — inject.
   - Valid query (`operationRevision` string digits) → transforms to number, calls `service.executionAdvice.read` with parsed target, returns schema-parsed observation, `no-store` header.
   - `operationRevision` = `"0"`, `"abc"`, missing, >16 chars → rejected; `read` not called.
   - `read` returning a value failing `operationExecutionReviewSchema` → 500 (documents the contract boundary).
4. `tests/effect-service.test.ts` — temp-dir `Store`, `overrides`.
   - Both flags off → `createService` called, no key factory called, no marker entity written.
   - Fresh profile: `initializeKey` called with `{keyId}` matching the persisted marker; marker transitions `initializing`→`ready`; returned service gets `custody.authenticator`.
   - Second open (marker ready, same keyId) → `openKey` called with `{expectedKeyId}`, `initializeKey` not called.
   - Custody keyId ≠ marker keyId → unavailable path: service still returned, no authenticator, `custody.close` invoked.
   - Corrupt marker (`put` a non-conforming body) → same unavailable path, does not overwrite the marker.
5. `tests/code-intelligence-routes.test.ts` — inject against a minimal Fastify app + fake `Service`.
   - Identifier validation: `id` failing `/^[a-zA-Z0-9:_.-]{1,200}$/` (spaces, >200 chars, `/`, `..`) rejected on every route that takes it.
   - `requireCodeIntelligenceFlag` off → routes respond with the flag-off error (exact status/code from `packages/core/code-intelligence.ts`).
   - `APPROVED_SERVERS` lookup: unknown language → `UNSUPPORTED` path, never spawns (`execFileSync` mocked with `vi.mock('node:child_process')` — no real process).
   - `renamePlanV1Schema` boundary: malformed rename plan body rejected before any adapter call.
   - Discovery task for the implementer: enumerate the file's route table and cover every route's validation-first path; where a route only delegates to an adapter, assert delegation with a fake adapter, not LSP output.

`apps/server/main.ts`: PR body justification — "top-level process script with no exports; covered by `tests/project-memory-maintenance-host.test.ts` host-level tests; extracting `startupErrorDiagnostic` for unit test is a refactor outside this issue's keep-behavior scope."

### EXECUTION_DAG

- **T01** `tests/desktop-controls.test.ts` (PR 1). Deps: none. Done-when: all cases above green; ~150 lines.
- **T02** `tests/github-auth-routes.test.ts` + `tests/operation-execution-review-routes.test.ts` (PR 2, both are thin route modules, one concern = "route validation coverage"). Deps: none. Done-when: green via `app.inject`; no network.
- **T03** `tests/effect-service.test.ts` (PR 3). Deps: none. Done-when: marker/custody lifecycle cases green using `overrides`; no real key custody.
- **T04** `tests/code-intelligence-routes.test.ts` (PR 4). Deps: implementer reads full module + `packages/core/code-intelligence.ts` first (discovery, noted). Done-when: validation + delegation paths green, `node:child_process` mocked.
- **T05** PR bodies + `main.ts` justification text (in PR 4 body or its own ≤50-line PR if the file count grows). Deps: T01–T04.
- Parallelism: T01–T04 touch disjoint files; may be owned by different workers. Each PR links this issue and claims its scope in a checkpoint first.

### VALIDATION

Planned (not executed in this session): `pnpm exec vitest run tests/desktop-controls.test.ts tests/github-auth-routes.test.ts tests/operation-execution-review-routes.test.ts tests/effect-service.test.ts tests/code-intelligence-routes.test.ts` — all green; `pnpm typecheck && pnpm lint`; full `pnpm test` once before the last PR merges. Acceptance matrix: "every module has tests or justification" → T01–T05 + `main.ts` justification; "edge cases, error paths, invalid input" → the case lists in DESIGN.

### STATE

Researched/decided: module inventory and per-module test design verified at baseline. Implemented: none (review-only). Verified: none executed. Pending: T01–T05 unowned. Risks: `code-intelligence-routes.ts` may hold hidden collaborators requiring small fakes (flagged as discovery, not assumed). Next step: claim T01 in a checkpoint.

### REFERENCES

- Verified sources at `7ef0710c`: `apps/server/desktop-controls.ts` (whole file), `github-auth-routes.ts`, `operation-execution-review-routes.ts`, `effect-service.ts` lines 1–60, `code-intelligence-routes.ts` lines 1–40, `main.ts` (whole file).
- Patterns: `tests/integration-secret-reference-http-v3.test.ts` (Fastify inject), `tests/store.test.ts` (temp-dir Store), `tests/desktop-host-controls.test.ts` (adjacent coverage to mirror).
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1055; AGENTS.md contract.

