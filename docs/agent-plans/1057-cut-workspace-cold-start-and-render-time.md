<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1057 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: Cold-start and render performance budget + baseline for the workspace (desktop + web + host), then fix the top costs.
- Repo: `skytuhua-org/Gen-V1` (local: `/home/ubuntu/repos/Gen-V1`).
- Plan revision: 1, dated 2026-11-20.
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified via `git rev-parse HEAD`).
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1057. No linked PRs.
- Current implementation status: no benchmark or performance budget exists anywhere in the repo (verified: `grep -rln "benchmark|perf" scripts tests` returns only unrelated research/measure scripts).
- Source provenance: authored by `devin-a-cloud-3d96bc` (review/planning claim) from direct inspection; no code changed.

### OBJECTIVE

The workspace has three user-visible slow phases with no measurement: host cold start, web first render, and split-workspace interaction. Verified cost suspects at baseline:

1. **tsx-loader transpile on every cold start** — `apps/desktop/backend-policy.ts:86` `nodeSidecarArguments()` spawns the host as `node --import <tsx loader> apps/server/main.ts`; every cold start re-transpiles the whole `apps/server` + `packages` import graph in-process. Same for `scripts/dev.mjs` (spawn with `--import tsx`).
2. **`Store.snapshot()` rebuilds statements every call** — `store.ts` `visibleEntities()` (lines 207–214) runs `db.prepare(...)` fresh on every invocation, and `snapshot()` (lines 224–249) runs ~15 queries plus `JSON.parse` per entity; `apps/server/server.ts:124` serializes a full snapshot on the snapshot endpoint.
3. **Eager web bundle** — `apps/web/src/App.tsx` imports ~40 modules eagerly (verified import list lines 1–44); `vite.config.ts` `optimizeDeps.include` only pre-bundles `pdf-lib`/`pdfjs`; no route- or panel-level code splitting besides `ProjectContextSurface`'s `lazy(MemoryReview)`.
4. **Per-event full re-render risk** — client applies `applyRuntimeEvent` incrementally (api.ts), but `App.tsx` subscribes at the root; need the benchmark to prove/disprove re-render cost on split-workspace commands (`applySplitWorkspaceCommand` from `packages/core/split-workspace-layout.ts`).

Success = a committed benchmark script producing a baseline JSON (p50/p95 for each phase), the top three measured costs fixed or explained in PR bodies, budgets asserted in CI.

### REQUIREMENTS

In scope: a repeatable benchmark script; measurement instrumentation (no user-visible behavior change); fixes for the top three costs the baseline reveals — bounded to files/areas listed in EXECUTION_DAG, contingent on measurements (each fix task names its evidence gate).

Out of scope: changing UI/UX appearance; Electron packaging changes; database schema changes (covered by #1056 — do not touch `packages/storage` DDL); behavior covered by open M-series issues without linking; files changed by open PRs (verify `gh pr list` at each PR).

Constraints: one concern per PR, each < 400 lines; benchmark must run on this repo's CI OS matrix assumption (Windows is CI's test OS — script must be cross-platform: use `os.tmpdir()`, no POSIX-only calls); `pnpm lint`, `pnpm typecheck`, `pnpm test` per PR.

### REPO_MAP (verified at baseline)

- `scripts/review-host.ts` — exports `openReviewHost(dir, port)` (used by environment startup; verified via blueprint knowledge). Reuse for the host-side benchmark so the script does not reimplement launch.
- `apps/desktop/backend-policy.ts:86` — `nodeSidecarArguments(hostRoot)` = `['--import', <tsx loader URL>, <hostRoot>/apps/server/main.ts]`.
- `scripts/dev.mjs` — spawns `node --import tsx apps/server/main.ts` + vite.
- `scripts/build.mjs`, `scripts/build-desktop.ts` — esbuild already builds the desktop bundle; `pnpm build` produces `dist/web`.
- `apps/server/server.ts:113–124` — snapshot endpoint: `JSON.stringify(service.store.snapshot())` per request.
- `packages/storage/store.ts` — `visibleEntities()` lines 207–214 (`db.prepare` inside function), `snapshot()` lines 224–249, `statements` map lines 67–105 (the place cached prepares belong).
- `apps/web/src/api.ts` — `getSnapshot()` line 127 (`GET /api/snapshot`), `subscribe(after, accept, connectivity, reconnect)` line 178 (event stream; client registers before refreshing, line 191 comment).
- `apps/web/src/App.tsx` lines 1–44 — eager imports incl. `Artifact`, `Markdown`, `SourceWorkbench`, `VerificationPanel`, `ContextInspector`, `UsageDialog`.
- `packages/core/split-workspace-layout.ts` — `sameSplitWorkspaceView`, `createSplitWorkspaceLayout`, `applySplitWorkspaceCommand` (imported in `App.tsx` line 27).
- `tests/e2e/*.playwright.config.ts` + `tests/e2e/app-ready.ts` — existing Playwright harness and readiness helper to reuse for render/interaction timings.
- `vitest.config.ts` — benchmark is a script, not a test; keep it out of `tests/**`.

### DESIGN

**Benchmark script** `scripts/bench-startup.ts` (tsx, one file, ~200 lines), invoked as `pnpm bench:startup` (add script entry). Emits `bench-results/<git-sha>-<timestamp>.json` and a stdout table. Metrics:

- `host_boot_ms`: spawn `node --import tsx apps/server/main.ts` with `HARNESS_DATA_DIR=<mkdtemp>` and `HARNESS_PORT=<free>`; poll until `GET /api/snapshot` returns 200. N=5 runs, report p50/p95. (Mirrors the real desktop spawn exactly — same args as `nodeSidecarArguments`.)
- `snapshot_serialize_ms`: on a seeded store (seed via the same fixture path `scripts/create-fixtures.ts` uses — discovery: reuse its export or a minimal `Store`+`internal()` seed of 200 threads × 50 messages), time `GET /api/snapshot` N=20, p50/p95, plus response bytes.
- `first_render_ms`: Playwright Chromium against the fixture host + `vite preview` of `dist/web` (production build, cold cache): `domContentLoaded`, `firstContentfulPaint` via `performance.getEntriesByType('paint')`, and time to App's first rendered thread list (discovery marker: `[data-thread-id]` or `.shell-sidebar` selector — implementer verifies selector exists at runtime and records which).
- `split_interaction_ms`: Playwright — click the split control (selector discovery, same pattern as `tests/e2e/agents-workspace.spec.ts`), `performance.mark` around it, measure to next `requestAnimationFrame` + paint; N=10, p50/p95.
- Output schema: `{sha, node, platform, runs: [{name, samples_ms, p50, p95, mean}]}`. A `budgets` block asserts: `host_boot_ms p50 < TBD` — budgets are filled in by the baseline run in T02 and committed; until then the script reports but does not fail (flag `--check` turns assertions on, used in CI after T02).

**Fixes** (each gated on its baseline number; implement only what the top three are):

- **F1 (likely #1): precompiled host entry.** If `host_boot_ms` is dominated by tsx transpile: build `apps/server/main.ts` to `dist/host/main.mjs` with esbuild in `scripts/build.mjs` (esbuild is already the desktop bundler); change `nodeSidecarArguments` to use the bundle when `existsSync(dist/host/main.mjs)` and fall back to tsx in dev; keep `HARNESS_DEV=1` dev path on tsx. Exact change sites: `scripts/build.mjs` (add entry point `apps/server/main.ts`, `format:'esm'`, `bundle:true`, `platform:'node'`, `external` the same list `scripts/build-desktop.ts` uses — discovery: read that file's `external`/`packages` config), `apps/desktop/backend-policy.ts:86` (prefer bundle path), `scripts/dev.mjs` unchanged.
- **F2 (likely #2): cache prepared statements in `Store`.** If `snapshot_serialize_ms` is dominated by per-call prepares: move the two `db.prepare` calls in `visibleEntities()` (store.ts:208,211) into `this.statements` (lines 67–105) — add `archivedRows`, `visibleRows` prepared once in the constructor; no behavior change.
- **F3 (likely #3): lazy-load heavy panels.** If `first_render_ms` is dominated by bundle parse: wrap `VerificationPanel`, `ContextInspector`, `UsageDialog`, and `Artifact`'s heavy preview path in `lazy()`+`Suspense` following the exact existing pattern in `apps/web/src/ProjectContextSurface.tsx:9` (`lazy(()=>import('./X').then(m=>({default:m.X})))` with a `<p role="status">` fallback), and add `manualChunks` vendor split for `pdf-lib`/`pdfjs`/`lucide-react` in `vite.config.ts` `build.rollupOptions.output.manualChunks`.
- **F4 (contingent): split-workspace render.** If `split_interaction_ms` is the outlier: profile `applySplitWorkspaceCommand` call site in `App.tsx`; likely fix = `useMemo` on `sameSplitWorkspaceView` inputs or `memo()` around `WorkspacePanel` (component exists at `apps/web/src/WorkspacePanel.tsx`) — exact edit decided by a React Profiler/`why-did-you-render`-style trace committed as evidence in the PR body; the plan forbids shipping a speculative memo without the trace.

Each F-task is its own PR (<400 lines), links this issue, states its measured before/after numbers in the PR body. If a suspected cost does not appear in the top three, it is "explained" per Done-when by the baseline output in the PR body instead of fixed.

### EXECUTION_DAG

- **T01 — Benchmark script** (`scripts/bench-startup.ts`, `package.json` script, `bench-results/.gitignore`). Deps: none. Done-when: runs end-to-end on this machine, emits the JSON schema above, all four metrics sampled. ~200 lines.
- **T02 — Baseline commit** (`docs/perf-baseline.md` or `bench-results/baseline-<sha>.json` committed; fill budgets in script). Deps: T01. Done-when: baseline JSON + a table of the four p50/p95 values committed; budgets set at p95×0.9 of baseline.
- **T03 — F1 precompiled host entry** (conditional: only if tsx transpile is top-3). Deps: T02. Edits: `scripts/build.mjs`, `apps/desktop/backend-policy.ts`. Tests: existing `pnpm test` + a smoke: `node dist/host/main.mjs` boots and serves `/api/snapshot` (asserted by bench script run against the bundle path — add `--bundle` flag to bench script).
- **T04 — F2 statement caching** (conditional). Deps: T02. Edit: `packages/storage/store.ts` statements map only. Tests: `tests/store.test.ts` + `tests/checkpoint-restore-v3.test.ts` must stay green; snapshot parity asserted by existing snapshot tests.
- **T05 — F3 lazy panels + manualChunks** (conditional). Deps: T02. Edits: `apps/web/src/App.tsx`, `vite.config.ts`. Tests: `pnpm build` succeeds; `tests/e2e` smoke spec that loads the app still passes; ui-guard tests green.
- **T06 — F4 split interaction** (conditional). Deps: T02 + evidence trace. Edits: `App.tsx`/`WorkspacePanel.tsx` memoization only.
- **T07 — CI budget check** (`--check` flag wired into a CI step or documented manual gate). Deps: T02. Done-when: `pnpm bench:startup --check` fails the build when a regression exceeds budget.
- Ordering: T01→T02 strict; T03–T06 parallel, disjoint files; T07 last.

### VALIDATION

Planned: `pnpm bench:startup` (baseline + after each fix PR, numbers in PR bodies); `pnpm test`, `pnpm typecheck`, `pnpm lint` per PR; `pnpm test:browser --suite agents-workspace` after T05/T06. Regression matrix: store tests (T04), e2e workspace specs (T05/T06), desktop boot smoke via bench script `--bundle` (T03). Acceptance per issue: benchmark script committed with baseline + improved numbers (T01–T02 + fix PRs); top three costs fixed or explained (T03–T06 + PR-body notes); gates green.

### STATE

Researched/decided: benchmark design, suspected cost sites verified at baseline (file:line above). Implemented: none. Verified: no measurements taken — all suspected rankings are hypotheses gated on T02 evidence. Pending: T01–T07 unowned. Risks: Playwright timing noise on CI — mitigate with N runs + p50 reporting; seeded-store size must be documented in `bench-results` README. Next step: claim T01.

### REFERENCES

- Verified at `7ef0710c`: `apps/desktop/backend-policy.ts:86`; `scripts/dev.mjs`; `apps/server/server.ts:113–124`; `packages/storage/store.ts:54–66,207–249`; `apps/web/src/api.ts:127,178–206`; `apps/web/src/App.tsx:1–44`; `apps/web/src/ProjectContextSurface.tsx:9` (lazy pattern); `vite.config.ts` (whole); `scripts/review-host.ts` (`openReviewHost`).
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1057; AGENTS.md contract.

