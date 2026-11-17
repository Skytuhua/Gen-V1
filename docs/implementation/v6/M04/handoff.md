# M04 v6 execution handoff (LOCAL_ONLY)

## Identity and source cut (R01/R02)

- Repository: skytuhua-org/Gen-V1, numeric ID 1442565952 (verified via GitHub API).
- Original checkout `/home/piadmin/Gen-V1` preserved on `fix/t10-agents-grid-v3` (033d32cd3e14284a816a3e8aeaa66ffe92b34090) with its two uncommitted user edits untouched; worktrees `/tmp/gv1-audit` and `/tmp/gv1-f1` untouched.
- Assigned branch `handoff/m04-context-v3` was not checked out in any worktree; recovered per procedure A into `/home/piadmin/Gen-V1-m04-v6` at the exact published head.
- Preserved task head: `ee2c7ad1d8137a355ae907ef0a340b04c8cb7c38` (local == origin == observed published head; no unpublished divergence).
- Captured `origin/main`: `1c09d492278b1014bc3ab5455191b1f5913c96d8` (fetched, never checked out).
- Merge base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`.
- Audit anchor 4805af4680094d2af48ecf666688e750797e9dda is a source-inspection reference only.
- Toolchain: provisioned Node v24.11.1 (~/tools/node24) and pnpm 10.30.3 (~/tools/pnpm), matching package.json (`pnpm@10.30.3`, node >=24.10.0). `pnpm install --frozen-lockfile` succeeded; lockfile unchanged.

## R03 base integration: HOLD_SOURCE_DRIFT

Pre-merge status was empty. `git merge --no-commit --no-ff 1c09d492` conflicted; per R03 the merge was aborted (`git merge --abort`) and the worktree restored clean at ee2c7ad1. No blanket ours/theirs resolution was attempted. Affected joins are HOLD_SOURCE_DRIFT; only join-independent stages continue.

Conflict paths with stage blobs (1=base, 2=ours/task, 3=theirs/main):

```
100644 0fa748ae093ea5541d2a194aa408471c8fd02aea 1	apps/web/src/ContextInspector.tsx
100644 a06b00e052f2fc428f70417e606197dd0ef49850 2	apps/web/src/ContextInspector.tsx
100644 a18578b87d24bf0aa6f9d1028790ef991c3c3665 3	apps/web/src/ContextInspector.tsx
100644 09517becaf0c35f5f63bd758878659ea0de5f57b 1	packages/contracts/index.ts
100644 0efff5c4cf2c2a7ec337f86460ec3ac79e5c2330 2	packages/contracts/index.ts
100644 4543457cd2b748280b7264868f5c3151c5444d8e 3	packages/contracts/index.ts
100644 863632ff8a7c878f4d2a3df6688f52c662c423e7 2	packages/contracts/request-context.ts (add/add; absent at merge base)
100644 30185cc5e66a74ef438af8ec8e9ec1d91989c614 3	packages/contracts/request-context.ts (add/add; absent at merge base)
100644 39e18abb43f7fa63cb2534ea3356ebb1be121161 1	packages/core/capability-flags.ts
100644 984030800cd371d70fc20f9c0c7ad076a85a2afa 2	packages/core/capability-flags.ts
100644 02783eb029b618f9bf1abe0b9f51ff8f5c27076a 3	packages/core/capability-flags.ts
100644 2b3fb63acef915b052a468e104c6e4f00a4b82e4 1	packages/core/service.ts
100644 39b01ba266719fd6400ed0120d7c6513f5da7518 2	packages/core/service.ts
100644 58ac6b1607c0881cdfb3493cd60293b47b23a13f 3	packages/core/service.ts
100644 ce5ae96ebcaf24d7a4d400aba2088471ddbd037e 1	packages/runtime-hermes/broker.ts
100644 ccad6e975b0a1e1ccf09f6e8c3bd3d5c9b637327 2	packages/runtime-hermes/broker.ts
100644 0256ce338f2e584166a61083c377e0e70dce30c1 3	packages/runtime-hermes/broker.ts
100644 ca15682cd2ad86f296247e71a7b18a190c0968f4 1	packages/runtime-hermes/index.ts
100644 a9cfca0adce66ed61120827dbfeab693e333a9a3 2	packages/runtime-hermes/index.ts
100644 83d5d7856551b3d4a52d9a6a2cd8c1363c09abe1 3	packages/runtime-hermes/index.ts
100644 8cb3efe75c120185f957ab3df73255756adcf7b8 1	scripts/public-source-files.json
100644 48d074fd711b28d12e8477009ab106eda353458d 2	scripts/public-source-files.json
100644 6557a3a2fbb27632b63b4f87ced782739d911db8 3	scripts/public-source-files.json
100644 c6c3752560c0cda8ff5a3524715406952aa165be 1	tests/e2e/usage-context.spec.ts
100644 b48cd29be974940ddfe18a54d34bf2bc127e5094 2	tests/e2e/usage-context.spec.ts
100644 812c0f50697ec7cde3d085ff1012a88957592a4d 3	tests/e2e/usage-context.spec.ts
```

Consequences:

- C3 composer/host integration on the merged RequestPreparationV1 custody path: HOLD_SOURCE_DRIFT (request-custody.ts and RequestPreparationV1 exist only on main).
- M04-D01 replay: BLOCKED, NOT_RUN at this cut; no competing contract invented.
- M04-U02 composer chip wiring and U03 native compaction data path: HOLD_SOURCE_DRIFT / HOLD_NATIVE_COMPACTION.
- Packaging inventory join (scripts/public-source-files.json): HOLD_SOURCE_DRIFT; new first-party files are registered in the task-cut inventory only.
- Independent stages continued: C1/C2 deterministic extensions, C03 sidecar, S05 ranking, S09 shadow guard, S11 host apply gate, S12 precompute coordinator, D02–D05 decision tests.

## Other named holds

- HOLD_NATIVE_COMPACTION: no adapter with an observed native loss-aware apply API and runtime proof; `run.compact` under `context.lossAwareCompactionV1` reports UNSUPPORTED_COMPACTION and never calls legacy compaction.
- HOLD_AUXILIARY_MODEL: no approved auxiliary model/account budget; shadow phase returns OBSERVER_UNAVAILABLE and makes no model call; precompute summarization is test-injected only.
- HOLD_CONTRACT_SHAPE: M04-U01 per-row inclusionReason/tokens/measurement/exclusionReason have no representation in HostRequestProjectionV1 and no supplemental shape is specified.

## Baseline receipts at preserved head ee2c7ad1 (before any v6 edit)

Asset builds: `pnpm build:credential-lease` exit 0; `pnpm build:widgets` exit 0.

- `pnpm exec vitest run tests/context-compiler-v3.test.ts` exit 0 — 11 passed.
- `pnpm exec vitest run tests/context-results-v3.test.ts` exit 0 — 3 passed.
- `pnpm exec vitest run tests/compaction-v3.test.ts` exit 0 — 4 passed.
- Supporting: context-discovery-v3, context-request-observation, context-result-custody, context-draft-sources, context-measurement — exit 0, 14 passed.

Logs: /home/piadmin/m04-v6-notes/baseline-*.log (bounded copies under docs/implementation/v6/M04/logs/).

## Publication

LOCAL_ONLY. No push, no remote merge, no force update, no flag activation, reviewerApproval false.

## Environment provisioning and platform limits (R08/R09)

- Machine: linux-arm64 (Pi 5), Node v24.11.1, pnpm 10.30.3 (provisioned under ~/tools). The historical M04 receipt was produced on linux-x64; results are not comparable across platforms.
- `pnpm install --frozen-lockfile` does not build node-pty (onlyBuiltDependencies: electron, esbuild). The original checkout carries a locally built `build/Release/pty.node` for the identical pinned+patched node-pty 1.1.0 package. That artifact was copied (read-only from the original checkout) into the task and baseline worktrees' node_modules to equalize prerequisites. SHA-256: 2e3ad304a9d65608e07fb9159738b8b955daaec1c5a17c7c42c0d16ad9dea521. No repository source, dependency or lockfile change.
- Missing platform tools on this machine: pinned Python 3.14 for the original Hermes worker (only python3.12 present; HARNESS_HERMES_PYTHON unset), and the reviewed linux-path-guard sandbox launcher (fd3 socket / fd4 directory / NoNewPrivs boundary). Dependent native/sandboxed tests cannot pass here; they block only their dependent phases.
- Concurrent task agents were observed running full vitest suites in /home/piadmin/Gen-V1-m12-v6 and /home/piadmin/Gen-V1-m14-v6 during the broad runs (CPU contention; timing-sensitive tests may be affected). Those worktrees were not touched.
- Baseline comparison cut: /home/piadmin/Gen-V1-m04-baseline, detached at ee2c7ad1 (unchanged task head), same provisioning. Candidate and baseline broad outcomes are kept in separate logs.

## Broad gate comparison (R09)

- Candidate run 1 (before pty provisioning, under contention): 246 failed / 2893 passed / 45 skipped; 63 failed files including native-module collection errors. Superseded by run 2.
- Candidate run 2 (provisioned, under contention): 288 failed / 3058 passed / 50 skipped (3396 tests, 49 failed files). Log: logs/candidate2-full-test.log.
- Baseline run 2 (unchanged ee2c7ad1, provisioned, under contention): 277 failed / 3063 passed / 46 skipped (3386 tests, 48 failed files). Log: logs/baseline2-full-test.log.
- The 10-test count delta is exactly the new v6 tests (4 compaction + 1 discovery + 5 preservation), all passing.
- Failure-set delta was confined to tests/plugin-tools-dock.test.ts, tests/integration-mcp.test.ts and tests/project-search-host.test.ts. Quiet sequential reruns of exactly those suites: candidate 7 failed / 66 passed (logs/candidate-delta-rerun.log), baseline 10 failed / 63 passed (logs/baseline-delta-rerun.log). The dock/split subset is nondeterministic in both directions on this machine; the Promptfoo MCP case passes on both quiet reruns; Graphify/Biome/Impeccable/Spec Kit/project-search-limit failures reproduce on the unchanged baseline. No delta failure touches an M04 module.
- Stable environment gaps on this machine: reviewed linux-path-guard sandbox launcher (fd3/fd4 boundary), pinned Python 3.14, native Graphify/Biome/Impeccable engines. The broad gate therefore remains red on both cuts; it is reported as an observed FAIL, not reclassified as a pass.

## Intermediate targeted receipts (pre-hardening cut; superseded by the final batch below)

- tests/context-compiler-v3.test.ts: 11 passed (13:30:25Z–13:30:30Z).
- tests/context-results-v3.test.ts: 3 passed (13:30:30Z–13:30:34Z).
- tests/compaction-v3.test.ts: 8 passed (13:30:34Z–13:30:37Z).
- tests/context-contract-preservation-v6.test.ts: 5 passed (13:30:37Z–13:30:45Z).
- Supporting (discovery, observation, custody, draft-sources, hermes-runtime, hermes-broker, usage-context): 73 passed (13:30:56Z–13:31:13Z).
- tests/public-source.test.ts: 11 passed (13:31:25Z–13:31:39Z).
- pnpm typecheck exit 0 (13:31:39Z–13:34:06Z); pnpm lint exit 0 (13:34:06Z–13:36:14Z).
- pnpm build exit 0 (13:10:25Z–13:11:30Z); build:credential-lease exit 0 (13:36:29Z–13:36:35Z); build:widgets exit 0 (13:36:35Z–13:36:38Z).
- Red-phase failures preserved before implementation: logs/red-compaction.log (4 failed), logs/red-discovery.log (1 failed), logs/red-preservation.log (1 failed); existing tests stayed green in each red run.

## Browser gate (R09)

- `pnpm test:browser` on the candidate: exit 1, 463 passed / 1239 failed across 78 suites (13:36:38Z–17:40:43Z). Log: logs/browser.log.
- 18 failed suites configure `channel: 'msedge'` and 12 configure `channel: 'chrome'`; neither distribution exists on this linux-arm64 host (Edge/Chrome do not ship arm64 Linux builds). Launch fails before any assertion. Channels were not changed. This includes the M04 `usage-context` suite (msedge): its 21 tests are platform-blocked, not assertion failures.
- 42 plain-chromium suites failed with fixture/rendering errors; the identical suites are run on the unchanged baseline cut (logs/baseline-browser.log) for attribution.
- Suites that passed on the candidate include wo8 (24), chart-coordinates, smooth-pdf and others using the cached Chromium headless shell.
- Baseline attribution: all 42 plain-chromium failed suites were rerun on the unchanged baseline cut (17:57:59Z–20:22:54Z, logs/baseline-browser.log; bounded receipt logs/baseline-browser-bounded.log) and all 42 fail there too. `dist/web` is byte-identical between candidate and baseline (53 files, equal SHA-256), so no browser outcome difference can be source-caused by this diff. Discordant suites: terminal-excerpts passed on the candidate rerun (exit 0, logs/candidate-rerun-terminal.log); composer-commands is flaky in both directions (candidate rerun 11 passed/1 failed vs baseline 10/2; logs/candidate-rerun-composer.log).

## Final receipts at the final cut (one-cut shadow guard included; all M04-scoped commands exit 0)

- tests/context-compiler-v3.test.ts: 11 passed (2026-11-17T02:03:42Z–02:03:44Z).
- tests/context-results-v3.test.ts: 3 passed (02:03:44Z–02:03:46Z).
- tests/compaction-v3.test.ts: 8 passed (02:03:46Z–02:03:48Z).
- tests/context-contract-preservation-v6.test.ts: 5 passed (02:03:48Z–02:03:52Z).
- pnpm typecheck exit 0 (02:03:52Z–02:05:39Z); pnpm lint exit 0 (02:05:39Z–02:07:06Z).
- pnpm test (includes credential-lease + widget builds): exit 1 — 277 failed / 3073 passed / 46 skipped (02:07:21Z–02:22:11Z). Failure count is identical to the unchanged baseline cut (277); the +10 passed are exactly the new v6 tests. Failure-set differences are six known timing-flaky non-M04 tests; quiet reruns on both cuts (logs/final3-delta-rerun.log: 4 failed/75 passed; logs/baseline3-delta-rerun.log: 2 failed/77 passed) confirm bidirectional flakiness plus the same stable environment failures. No M04-scoped suite fails.
- pnpm build exit 0 (02:28:46Z–02:29:38Z); rebuilt dist/web is byte-identical (53 files, equal SHA-256) to the baseline bundle and to the bundle the browser gate tested, binding that receipt to this cut by identity (tests/e2e and configs are unchanged by the v6 diff).
- tests/context-discovery-v3.test.ts: 6 passed (02:31:03Z–02:31:12Z); supporting + public-source: 78 passed (02:31:12Z–02:31:44Z).
- Logs: logs/final3-*.log. Post-handoff fix: the shadow phase now enforces one report per eligible immutable cut (duplicate/invalid cutId refused without a model call); red receipt logs/red2-compaction.log, green logs/green2-shadow.log.
- S13 clarification: the fixed paired deterministic fixtures are tests/fixtures/m04-context-v3.json consumed by the three v3 suites (schema-byte baseline/candidate pairs at 100/500 tools; append-read pairs at 1000/1001 sources); no separate paired runner script exists in the repository. Live quality/cost stays NOT_RUN.

## Evidence outcome (R11)

- docs/implementation/v3/M04-verification.json rewritten under ImplementationEvidenceV3; the historical handoff receipt is preserved at docs/implementation/v6/M04/M04-verification-handoff.json.
- docs/implementation/v6/M04/source-lock.json pins the execution cut ee2c7ad1 and inspected blobs; sourceLockDigest verified equal to the lock file's SHA-256.
- validateImplementationEvidence returns zero issues against the lock (expectedBaseSha + requiredContracts). bundleStatus(phases) computes FAIL: the required platform gates (pnpm test, pnpm test:browser) were observed failing on this linux-arm64 host and reproduce on the unchanged baseline cut. M04-scoped deterministic, compaction-gate and contract-preservation phases are PASS; custody, native-compaction, auxiliary-model and UI phases are BLOCKED with the named HOLD_* reasons. The computed FAIL is reported here, outside the strict persisted object.
- All four production flags remain false; reviewerApproval false; publication LOCAL_ONLY.

## Completed vs blocked phases

- Completed (source-bound passing evidence): C1 deterministic compiler/instructions/repo-map incl. new ranking; C2 progressive disclosure and private result handles incl. new decision tests; C03 metadata sidecar + candidate registry; S09/S11/S12 deterministic guards; D02–D05; T01–T07 deterministic coverage; G02/G03 preservation.
- Blocked: C3 composer/host custody join (HOLD_SOURCE_DRIFT), D01 (HOLD_SOURCE_DRIFT), C4 native apply (HOLD_NATIVE_COMPACTION), C5 live auxiliary measurement (HOLD_AUXILIARY_MODEL), U01 row fields (HOLD_CONTRACT_SHAPE), U02/U03 wiring (HOLD_SOURCE_DRIFT / HOLD_NATIVE_COMPACTION), usage-context browser evidence (msedge channel unavailable on linux-arm64), full-suite and browser gates (environment failures reproduced on baseline).
