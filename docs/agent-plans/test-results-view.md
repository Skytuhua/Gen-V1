# Plan: Test results view

## META

| Field | Value |
|---|---|
| Feature | Test results view: when the agent runs tests through the approved repository-test operation, show a pass/fail summary by suite, expandable failures, and a "Rerun this test" action, instead of raw stdout/stderr inside a JSON receipt |
| Size | medium (labels `feature`, `medium`); no sub-issues (one DAG, ownership boundaries below) |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue (the issue header links it) |
| Plan file | `docs/agent-plans/test-results-view.md` (identical to this issue body) |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git log -1` on a fresh clone, 2026-11-21) |
| Related work | No existing issue or PR for structured test results (searched issues/PRs for "test results", "test explorer", "junit", "reporter"). Related machinery reused: approved `repository.test` operation (`packages/capabilities/*`), operation receipts (`apps/web/src/App.tsx` `OperationDecision`), software catalog (`packages/ui-catalog/software-development.ts`, `apps/web/src/SoftwareDevelopment.tsx`). Sibling batch 4 features are planned in their own issues and do not overlap. |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 4, item 4: "Test results view (M): When the agent runs tests, show a pass/fail summary by suite, with expandable failures and 'rerun this test'. Agent UI kits now ship a dedicated test-results component (shadcn AI Elements, https://ui.shadcn.com/docs/ai-elements/base/test-results), following VS Code's Test Explorer (https://code.visualstudio.com/docs/debugtest/testing). Gen's catalog has no test-result type, so runs show as raw terminal output." Owner instructions for batch 4: there is no separate front end team designing these features, so this plan specifies the visual design and animation itself; when the work is finished the implementing agent sends it to the front end team for review (task T10). All repository facts were read by static inspection of the baseline SHA; line numbers refer to that SHA. Decisions marked **DECIDED** were made by the planner (the owner delegates non-approval decisions); options not taken are recorded. No code was built or tested while planning. |

**Design ownership.** This plan defines the visual design and motion (DESIGN §7). Implementers build exactly that, using existing tokens. When all tasks are verified, the implementing agent sends the finished work to Leonardo's front end team for review (T10) before the issue can close.

## OBJECTIVE

**User problem.** When the agent runs a project test file, the only verified agent test path is the approved `repository.test` operation (tool `repository_test_prepare`, `packages/capabilities/schemas.ts:16,34`). Its result is a `ProcessResult` `{status, exitCode, signal, cancelled, timedOut, stdout, stderr, truncated, pid}` (`packages/capabilities/process.ts:7`), and the thread shows it as pretty-printed JSON in a nested "Executor result" `<pre>` (`apps/web/src/App.tsx:233–238`, `display()` in `apps/web/src/registry.tsx:41`). stdout/stderr appear as escaped JSON strings. The user cannot see which tests failed, why, or where, without reading raw runner output; and there is no way to rerun just the failing test. The model-authored `Diagnostics` catalog component (`packages/ui-catalog/software-development.ts:18`) can display check items, but only what the model chooses to write, with no suite hierarchy, no stack, and no link to a real run.

**Intended behavior.** With the flag on, every `repository.test` run captures a machine-readable report from the test runner, normalizes it into a runner-neutral `TestRunV1` record stored with the operation result, and the thread shows a **Test results** card: a summary line ("Ran 12 tests, 2 failed, 1 skipped · 3.4 s"), one collapsible row per suite (test file, and nested `describe` groups), failing suites open by default, each failed test expandable to its message, expected/actual and a trimmed stack with `file:line`. Each failed (or any) test has **Rerun this test**, which prepares a new `repository.test` operation for the same file with an exact test-name filter; it goes through the normal approval card, and its result appears as a new Test results card linked from the original row. The agent receives the same structured summary in its operation result. The model can also embed a run in an artifact through a new `TestResults` catalog component bound to the run's published data record. Two runners are supported in v1: Node's built-in runner (existing `node-test` recipe) and Vitest (new `vitest` recipe).

**Measurable success.**
1. For a failing node-test or Vitest file, the card shows correct per-suite and per-test pass/fail/skip counts equal to the runner's own report (T03 unit tests on recorded fixtures; T09 browser test).
2. A failed test's expanded view shows its message and the first stack frame's `file:line` (T03, T09).
3. Rerun of one test produces an operation whose argv contains exactly one name filter derived from the test's full name, and whose report contains exactly that one test (T05 unit test with a real two-test file; T09).
4. With the flag off, `repository.test` argv, binding and receipts are byte-identical to baseline (T02/T05 unit tests).
5. A missing, malformed or oversized report never fails the operation: the card degrades to "Structured results unavailable" plus the existing raw receipt (T03, T09).
6. All acceptance rows R01–R18 in VALIDATION pass.

## REQUIREMENTS

### In scope

- R01 Flag `ui.testResultsV1` (host capability flag, default false) gates everything below; flag off = baseline behavior.
- R02 Recipes: `node-test` (existing) and new `vitest`. `repository_test_prepare` gains optional `recipe: "node-test" | "vitest"` (default `node-test`) and optional `testName` (exact full test name for a single-test run).
- R03 Report capture: each run writes a machine-readable report to a Gen-owned per-run directory outside the project (node-test: a Gen-shipped reporter module emitting JSON lines; Vitest: built-in `json` reporter). The human-readable runner output still goes to stdout as today.
- R04 Normalization to `TestRunV1` (DESIGN §1): run summary, suites (file then nested groups), tests with status `passed|failed|skipped|todo`, duration, failure message, expected/actual, stack, location. Bounded (DESIGN §1 limits) with explicit `truncated` flags.
- R05 The normalized run is stored at `ProcessResult.testRun` (new optional field) on the operation result for both succeeded and failed runs, and is therefore in the published data record and in the operation evidence the model reads.
- R06 Report problems (missing file, parse error, over limits, runner crashed before reporting, timeout, cancellation) set `testRun.reportState` to `missing|invalid|partial` and never change the operation outcome.
- R07 Thread UI: for `repository.test` operations in a terminal state with a `testRun`, `OperationDecision` shows the Test results card above the existing receipt disclosure; the receipt (raw JSON evidence) stays available, collapsed.
- R08 Summary line with counts and duration; overall status icon; "No tests ran" state when total = 0 (e.g. Vitest `include` excludes the file).
- R09 Suites are collapsible; suites with a failure open by default; passing suites collapsed; nested groups render as nested rows.
- R10 Failed tests expand to message, expected/actual (two labelled blocks), stack trimmed to frames inside the project (max 12) with `file:line:column`; Copy failure button copies message + stack as plain text.
- R11 Rerun this test: host command `test.rerun {operationId, revision, testId}` prepares a new `repository.test` operation with the same resource, file and recipe and `testName` = the test's full name; it appears as a normal prepared operation needing approval (no auto-run).
- R12 Rerun result linking: the new operation records `rerunOf {operationId, testId}`; the original test row shows the latest rerun outcome ("Rerun passed" / "Rerun failed" / "Rerun pending approval") as a button that scrolls to and focuses the new card.
- R13 A rerun whose report contains 0 or more than 1 test shows "Rerun matched N tests" on the new card (no silent mismatch).
- R14 Catalog: new `TestResults` component in the software pack bound by `dataBinding` to a data record holding a `TestRunV1` (the record `publish` already creates for the operation); same renderer as the thread card, rerun hidden inside artifacts.
- R15 Model-facing tool description updated to mention `recipe`, `testName`, and that structured results arrive in `testRun`.
- R16 Accessibility: tree semantics (`role="tree"`/`treeitem`, `aria-expanded`, `aria-level`), full keyboard support (DESIGN §7.6), status conveyed by icon + text, not color alone.
- R17 Visual design and motion exactly as DESIGN §7, reduced motion honored.
- R18 Performance: a 2,000-test run renders the collapsed card in < 50 ms of scripting on the browser test machine; suites render their rows only when expanded.

### Out of scope (v1)

- Jest, pytest, Go, cargo and other runners (follow-ups: Jest via `--json --outputFile`, pytest via `--junit-xml` need new executable bindings; pytest needs a Python interpreter binding, a new trust surface).
- Parsing test output typed in the interactive workspace terminal (`packages/workspace/terminal.ts`) or provider-native shell tools: no stable report exists there and the PTY records process exit, not test outcomes.
- Watch mode, live per-test streaming while running (the process helper reports start/exit only, `process.ts:54–56`), coverage, snapshots UI, "Rerun all failed", "Rerun file" (follow-up candidates).
- Opening a stack frame in the Files editor (follow-up; Files has no line-addressed open today).
- Running tests without approval.

### Decisions (DECIDED) and options not taken

| ID | Decision | Options not taken (why) |
|---|---|---|
| D1 | Structured results only for the approved `repository.test` operation | Parse arbitrary terminal output (fragile, unbounded runner formats, PTY has no per-command exit); new generic "run tests" shell tool (bypasses the exact-argv approval model) |
| D2 | Machine-readable reports, not stdout scraping: Gen-shipped node:test reporter module (the reporter event API: `test:pass`, `test:fail`, `test:diagnostic` with `name`, `nesting`, `file`, `line`, `column`, `details`) and Vitest `--reporter=json` | Node `--test-reporter=junit`/`tap` (Node docs: built-in reporter output "is subject to change between versions of Node.js, and should not be relied on programmatically"); parsing `spec` stdout |
| D3 | v1 runners: node-test + Vitest, both run by the host Node (`process.execPath`) as today | Jest now (straightforward follow-up, kept out for medium size); pytest (needs Python binding) |
| D4 | Vitest is launched as `process.execPath <projectRoot>/node_modules/vitest/vitest.mjs run …` with the entry file bound by identity and hash like the test file | `npx vitest` / `pnpm vitest` / package.json scripts (arbitrary command resolution, breaks exact-argv binding) |
| D5 | Report path is a placeholder token in the bound argv (`{GEN_REPORT_DIR}`), substituted at launch with a fresh Gen-owned directory | Concrete path at prepare time (binding comparison is JSON-equal; operation id/dir lifecycle couples prepare and launch); report inside the project (pollutes the repo, writable by project code) |
| D6 | Normalized run stored inside `ProcessResult.testRun` | Separate entity/table (new storage reader/writer; results already persist with the operation) |
| D7 | Rerun prepares a new operation that needs normal approval | One-click auto-approve (approval binds exact argv and project trust; a changed argv must be re-approved, `repository-test-binding.ts:96–99`) |
| D8 | Exact-name filter: node `--test-name-pattern=^<escaped full name>$`, Vitest `--testNamePattern=^<escaped full name>$`; host escapes; the model/user never supplies a regex | Accept raw regex (injection of broad patterns; ambiguous) |
| D9 | Flag `ui.testResultsV1` default false, beside `ui.sourceWorkbenchV1` | Always on (unverified execution change) |
| D10 | Native card in `OperationDecision` plus a catalog component reusing the same renderer | Catalog only (requires the model to author an artifact for every run) |

### UX flows

1. **Agent runs tests.** Agent calls `repository_test_prepare {resourceId, testFile:"src/payment.test.ts", recipe:"vitest"}` → approval card → user approves → card shows "Running tests…" spinner → completes: "Ran 5 tests, 1 failed · 1.2 s"; `payment.test.ts` suite open, `retries a declined card` marked failed; user expands it → "Expected 2 charge attempts, received 1", expected/actual blocks, `src/payment.test.ts:58:22`.
2. **Rerun one test.** User clicks **Rerun this test** on the failed row → button shows spinner then the row shows "Rerun pending approval" → a new approval card "Run exactly … --testNamePattern=^payment retries a declined card$ …" appears → Approve → new Test results card "Ran 1 test, 1 passed"; original row now shows "Rerun passed" which scrolls to it.
3. **No structured report.** Runner crashes on a syntax error before reporting → card: "Structured results unavailable: the runner did not write a report" with the exit code; raw receipt disclosure open.
4. **All pass.** "Ran 40 tests, all passed · 2.1 s" with suites collapsed.
5. **Artifact embed.** Model authors an artifact with `TestResults {dataBinding:"<record id>"}` → same tree, without rerun buttons.

### Compatibility, security, privacy, accessibility

- Windows x64 (supported beta platform per `CONTRIBUTING.md`) and Linux dev; host Node ≥ 24.10.0 (`package.json:7–8`), packaged 24.22.2 (`scripts/desktop-assets.ts:29–30`): `--test-reporter`, `--test-reporter-destination` and `--test-name-pattern` are available in Node 24.
- Security: no change to who may run what. Every run is still an exact, guarded, approved argv; new bound inputs (reporter module, Vitest entry) are captured with the existing identity/hash guards; reports are read from a Gen-owned 0700 directory under the host data dir, size-capped before parse, parsed as data only (JSON), never evaluated; the directory is deleted after normalization. Test names and messages are rendered as text (no Markdown/HTML), so project-controlled strings cannot inject markup.
- Privacy: nothing leaves the machine; no telemetry.
- Accessibility per R16 and DESIGN §7.6; contrast via DESIGN.md semantic tokens; reduced motion per DESIGN §7.5.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | Location | Fact |
|---|---|---|
| Tool schema | `packages/capabilities/schemas.ts:2–3,16,34` | Strict `{resourceId: string(1..200), testFile: relativePath + /(?:^|[\\/])[^\\/]+\.test\.(?:[cm]?[jt]s)$/ and not starting with "-", recipe?: "node-test"}`; description: "Prepare exactly node --test -- <named testFile> in a granted project. Approval authorizes running that file's code with local user privileges; no arbitrary shell recipe." |
| Prepare | `packages/capabilities/index.ts:122–129` | `handleDomainTool` → resolves test inside resource → `withRepositoryTestBinding` → `ctx.prepareOperation('repository.test', {...a, recipe:'node-test', executionBinding}, [resourceId], {testSha256}, description)`; description "Run exactly <exe> --test -- <file> in <cwd>; this executes granted project code with local user privileges". |
| Execute | `packages/capabilities/index.ts:184–194`, `63–65` | Re-resolve, rebuild binding, compare, `ctx.assertRepositoryTestTrust`, `runProcess(binding.executable.path, binding.argv, binding.cwd.path, …)`, `publish` result (JSON-normalized) as a data record, return result. |
| Binding | `packages/capabilities/repository-test-binding.ts:10–25,35–60,66–73,74–93,96–99` | Version 1: `executable{path,dev,ino,bytes,sha256}` (= `process.execPath`), `cwd{path,dev,ino}`, `test{…sha256}`, argv `['--test','--',testFile]`, definition `{id, version, schemaDigest, executorBinding}`; guards held across child lifetime; `requireRepositoryTestBinding` requires exact JSON equality + `preconditions.testSha256`. Caps: executable 512 MiB, test 8 MiB. |
| Process | `packages/capabilities/process.ts:7,19–37,39–56` | `ProcessResult`; `shell:false`; first 256 KiB per stream; default timeout 120 000 ms; tree kill on cancel/timeout; start/exit progress only. |
| Outcome storage | `packages/core/service.ts:2222–2237`, `921–925`, `2294–2297` | Success → `Operation.result = ProcessResult`; nonzero exit → `HarnessError('OPERATION_FAILED', …, result)` and catch stores error details as result (status failed/unknown); `operationData` copies result to operation evidence; `enqueueOperationResult` informs the model. DISCOVERY X1: confirm the exact field holding the ProcessResult for failed runs. |
| Operation prepare authority | `packages/core/service.ts:1016–1023`, `2021–2024`, `1391–1398`, `1235–1238`, `1430–1465` | Operations are prepared only via `Service.context().prepareOperation` under tool authority; `operation.approve` validates revision/trust and backgrounds execution; `action.submit` of operation kind returns approvalRequired. No UI-initiated prepare exists. |
| Command dispatcher | `packages/core/service.ts:1064–1408`; `packages/contracts/index.ts:29`; `apps/server/server.ts:55,222` | `HostCommand.type` is an open string; unknown names → `UNKNOWN_COMMAND` (:1408). `operation.approve|reject|reconcile` handled there. |
| Trust | `packages/core/operation-project-trust.ts:190–205`; `service.ts:995,2183–2189` | Approval/launch trust checks for `repository.test`. |
| Contracts | `packages/contracts/index.ts:4,10,14,17,31,32` | `Message`, `DataRecord`, `ArtifactRecord`, `Operation{kind:string, result?:unknown}`, `ToolCall`, `RuntimeEvent`. |
| Existing check contract | `packages/contracts/verification.ts:85–109` | `CheckObservationV1` (outcome PASS/FAIL/…); no per-test hierarchy. Not reused (different purpose). |
| Existing Vitest JSON reader | `scripts/run-dependency-contracts.ts:84–113`; `scripts/validate-m01-m03-integration.mjs:169–174` | `inspectTestReport` validates Vitest JSON `testResults[]` / `assertionResults[]`; reference for field names. |
| Receipt UI | `apps/web/src/App.tsx:218–241,1162,1180`; `apps/web/src/shell.css:238–252` | `OperationDecision({operation, refresh, owner})`; terminal statuses → `operation-receipt` `<details>`; "Executor result" `<pre>{display(result)}</pre>`; prepared → approval UI with `OperationProjectTrust`; styles in `shell.css`. |
| Software catalog | `packages/ui-catalog/software-development.ts:7–37`; `packages/ui-catalog/index.ts:26–108`; `packages/contracts/index.ts:6–7` | `SOFTWARE_SCHEMAS` (Diagnostics, ChangeSet, ApiExplorer, Pipeline), `SOFTWARE_DATA_SCHEMAS`, examples, descriptions, discovery; merged into catalog `schemas`/`examples`/descriptions; `validateSurface` limits 128 KiB/200 nodes/depth 12. |
| Software renderer | `apps/web/src/SoftwareDevelopment.tsx:10–39,48–79,185–187,194`; `apps/web/src/registry.tsx:19,205`; `apps/web/src/software-development.css:34–35` | Status→icon/label maps; motion cancellation on interaction/theme/media; `Diagnostics` renderer; `SOFTWARE_REGISTRY` lazily loaded; semantic `--success`/`--danger`. |
| Status icons | `apps/web/src/task-status.tsx:2–7` | `StatusKind`, `StatusIcon` (check, alert, warning, spinner). |
| Feedback | `packages/ui-shell/Feedback.tsx:9–22` | `Spinner`, `ErrorState`, `BusyButton`. |
| Flags | `packages/core/capability-flags.ts:14–34,44,93`; `packages/core/host-flags.ts:11–59` | Finite registry, all false by default, `HARNESS_FLAG_*` env override (`1`/`true`); M15 `ui.sourceWorkbenchV1` at :93. DISCOVERY X2: how web code reads a capability flag (grep `sourceWorkbenchV1` in `apps/web`). |
| Motion | `packages/ui-shell/tokens.css:23–40,52–71`; `apps/web/src/motion-policy.ts:2–22`; `DESIGN.md:64–81` | Tokens (hover 120, press 80, status 160, success 240, insert 180, remove 140 ms; `--ui-ease-enter`, `--ui-ease-move`); `readMotionPolicy`/`observeMotionPolicy`; reduced motion: opacity only ≤ 80 ms. |
| Visual rules | `DESIGN.md:7–23,44–58,97–99` | Neutral surfaces, labelled status marks (icon + text), no decorative fills, badge inset 2px/6px, shared overlays only, refresh keeps content/selection. |
| Guards/tests | `scripts/ui-guard.ts`, `scripts/lint-ui.ts`, `scripts/ui-overlay-legacy.json`; `tests/repository-test-binding-v3.test.ts:100–195`, `tests/repository-test-binding-check.test.ts`, `tests/capabilities.test.ts:101–163`, `tests/operation-project-trust-v3.test.ts:72`, `tests/software-development.test.ts`, `tests/host-capability-flags.test.ts`, `tests/reduced-motion-coverage.test.ts`, `tests/public-source.test.ts`; browser `tests/e2e/project-trust-review.spec.ts`, `tests/e2e/operation-execution-advice.spec.ts` (root `playwright.config.ts` via `scripts/browser-suites.ts:3–10`, port 5499), `tests/e2e/clarity-software.playwright.config.ts` (port 5469) | Existing regression boundaries and fixture patterns. No Vitest/Jest/pytest sample project under `tests/fixtures`. |
| Manifest | `scripts/public-source-files.json`; `scripts/public-source.ts`; `CONTRIBUTING.md:44–49` | Every new source file listed in `source` (and `runtime` if packaged). |
| Progress matrix | `docs/progress.md:13–37` | No test-results milestone; M06 verification workflow and M15 workbench related, off by default. |

**DISCOVERY items** (resolve in the named task; record findings in the issue checkpoint):
- X1 (T03): exact location of the ProcessResult on failed operations (`Operation.result` vs `error.details`); `operationTestRun(operation)` must read whichever holds it.
- X2 (T07): how web code reads host capability flags (find the `ui.sourceWorkbenchV1` reader in `apps/web`).
- X3 (T02): how the reporter module ships in the packaged desktop runtime (`scripts/package-desktop.ts`, `runtime` list in the manifest) and the path the host resolves for it in dev vs packaged builds.
- X4 (T02): Node 24 name matching for nested tests with `--test-name-pattern` (full name with ancestors joined by a space, or leaf name). Write a two-level fixture and record actual behavior; build the filter accordingly (D8). Same for Vitest `--testNamePattern` (expected: ancestors and title joined by a space).
- X5 (T05): whether `enqueueOperationResult` starts a model turn for an operation the user (not the model) caused; if it does, the rerun result must be phrased as user-initiated in the queued message.
- X6 (T02): where the host data directory is resolved (for `<dataDir>/test-reports/<runId>/`).

## DESIGN

### 1. Contract (`packages/contracts/test-results.ts`, new)

```ts
import { z } from "zod";
export const TEST_RUN_LIMITS = { reportBytes: 8 * 1024 * 1024, tests: 2000, suites: 500, nameChars: 1000, messageChars: 8000, expectedChars: 20000, stackFrames: 12, stackChars: 16000 } as const;
export const testStatusSchema = z.enum(["passed", "failed", "skipped", "todo"]);
export const testLocationSchema = z.object({ file: z.string().max(1024), line: z.number().int().positive(), column: z.number().int().positive().optional() }).strict();
export const testCaseSchema = z.object({
  id: z.string().regex(/^t[0-9a-f]{16}$/),          // sha256(file + NUL byte + fullName) first 16 hex, prefixed "t"
  name: z.string().max(TEST_RUN_LIMITS.nameChars),
  fullName: z.string().max(TEST_RUN_LIMITS.nameChars * 4),
  status: testStatusSchema,
  durationMs: z.number().nonnegative().optional(),
  location: testLocationSchema.optional(),
  failure: z.object({
    message: z.string().max(TEST_RUN_LIMITS.messageChars),
    expected: z.string().max(TEST_RUN_LIMITS.expectedChars).optional(),
    actual: z.string().max(TEST_RUN_LIMITS.expectedChars).optional(),
    stack: z.array(testLocationSchema.extend({ text: z.string().max(500) })).max(TEST_RUN_LIMITS.stackFrames),
    truncated: z.boolean(),
  }).strict().optional(),
}).strict();
export type TestSuite = { id: string; name: string; file: string; status: "passed" | "failed" | "skipped"; suites: TestSuite[]; tests: z.infer<typeof testCaseSchema>[] };
export const testSuiteSchema: z.ZodType<TestSuite> = z.lazy(() => z.object({
  id: z.string().regex(/^s[0-9a-f]{16}$/), name: z.string().max(TEST_RUN_LIMITS.nameChars), file: z.string().max(1024),
  status: z.enum(["passed", "failed", "skipped"]), suites: z.array(testSuiteSchema), tests: z.array(testCaseSchema),
}).strict());
export const testRunV1Schema = z.object({
  version: z.literal(1),
  runner: z.enum(["node-test", "vitest"]),
  reportState: z.enum(["complete", "partial", "missing", "invalid"]),
  reportProblem: z.string().max(500).optional(),     // plain-language reason when not complete
  totals: z.object({ tests: z.number().int(), passed: z.number().int(), failed: z.number().int(), skipped: z.number().int(), todo: z.number().int() }).strict(),
  durationMs: z.number().nonnegative().optional(),
  suites: z.array(testSuiteSchema),                  // top level = one suite per test file
  truncated: z.boolean(),                            // limits hit; totals still count everything seen
  filter: z.object({ testName: z.string() }).strict().optional(),
  rerunOf: z.object({ operationId: z.string(), testId: z.string() }).strict().optional(),
}).strict();
export type TestRunV1 = z.infer<typeof testRunV1Schema>;
```

Rules: totals count every test the report contains, even past `tests` limit (`truncated: true`, extra tests dropped from `suites`, failed tests kept before passed ones). Suite status = failed if any descendant failed, skipped if all descendants skipped/todo, else passed. Paths are made project-relative (strip the cwd prefix; on Windows normalize `\` to `/`); paths outside the project are kept as given but stack frames outside the project are dropped. Export from the contracts index; add `testRun?: TestRunV1` to the `ProcessResult` type (`packages/capabilities/process.ts:7`) as optional.

### 2. Recipes, argv and binding v2 (`packages/capabilities/repository-test-binding.ts`, `schemas.ts`)

Public schema (flag on): `{resourceId, testFile, recipe?: "node-test" | "vitest", testName?: string(1..4000, no NUL, no newline)}`. With the flag off, the schema stays exactly as today (`vitest` and `testName` rejected), so baseline prepared operations are unchanged.

Binding version 2 (only when the flag is on; version 1 continues to read and execute old operations unchanged):

```ts
type RepositoryTestBindingV2 = {
  version: 2;
  recipe: "node-test" | "vitest";
  executable: Identity & { bytes: number; sha256: string };      // process.execPath, as v1
  cwd: DirIdentity;
  test: Identity & { bytes: number; sha256: string };
  aux: (Identity & { role: "node-test-reporter" | "vitest-entry"; bytes: number; sha256: string })[];
  argv: string[];                                                  // contains "{GEN_REPORT_DIR}" tokens
  filter?: { testName: string; pattern: string };
  definition: { id: "repository_test_prepare"; version: number; schemaDigest: string; executorBinding: "domain-prepare" };
};
```

argv templates (`<rep>` = absolute path of the Gen reporter module, `<entry>` = canonical path of `<cwd>/node_modules/vitest/vitest.mjs`, `<pat>` = `^` + regex-escaped full name + `$`):

| Recipe | argv |
|---|---|
| node-test | `--test`, `--test-reporter=spec`, `--test-reporter-destination=stdout`, `--test-reporter=<rep>`, `--test-reporter-destination={GEN_REPORT_DIR}/node-test.jsonl`, [`--test-name-pattern=<pat>`], `--`, `<testFile>` |
| vitest | `<entry>`, `run`, `<testFile>`, `--reporter=default`, `--reporter=json`, `--outputFile.json={GEN_REPORT_DIR}/vitest.json`, [`--testNamePattern=<pat>`] |

- Vitest entry resolution: `realpath(<cwd>/node_modules/vitest/vitest.mjs)`; must exist, be a regular file, and resolve inside the granted resource root (pnpm's `node_modules/.pnpm/...` is inside the root); else prepare fails with `INVALID_INPUT` "Vitest is not installed in this project (node_modules/vitest)". Do not read `package.json` scripts.
- Reporter module: new `packages/capabilities/node-test-reporter.mjs` (DESIGN §3), resolved from the host install (X3), bound in `aux` with identity + hash and held under a read-only guard like the executable.
- `<pat>` construction: escape `\ ^ $ . | ? * + ( ) [ ] { } /` with a backslash; the exact join of ancestors depends on X4.
- Prepare description extends today's text: "Run exactly <exe> <argv joined> in <cwd>; this executes granted project code with local user privileges", with `{GEN_REPORT_DIR}` shown literally as `<Gen report folder>`.
- `requireRepositoryTestBinding` compares the full v2 object (template argv) exactly; at launch the executor substitutes `{GEN_REPORT_DIR}` with a fresh directory.

### 3. Node reporter module (`packages/capabilities/node-test-reporter.mjs`, new)

An async generator reporter (`export default async function* (source)`) that, for each `test:pass` / `test:fail` event, yields one JSON line: `{type: "pass"|"fail", name, nesting, file, line, column, kind: details.type ("suite"|"test"), skip: boolean|string, todo: boolean|string, durationMs: details.duration_ms, error?: {message, expected, actual, stack}}`, and for `test:diagnostic` nothing. `error` = `details.error.cause ?? details.error`; `expected`/`actual` stringified with `util.inspect(value, {depth: 4, breakLength: 100})` capped at 20 000 chars; `message` capped at 8 000. No other side effects, no imports outside `node:util`. Ancestry is reconstructed by the normalizer from `nesting` and event order (DISCOVERY X4 confirms the order in Node 24: children report before their parent suite).

### 4. Launch, capture and normalization (`packages/capabilities/index.ts`, new `packages/capabilities/test-report.ts`)

Executor (flag on, binding v2):
1. Create `<dataDir>/test-reports/<random 16 hex>/` with mode 0700 (X6).
2. Substitute `{GEN_REPORT_DIR}` in argv; call `runProcess` exactly as today.
3. After exit (any status, including timeout/cancel): read the report file if it exists with a size cap `TEST_RUN_LIMITS.reportBytes` (lstat regular file, single link, inside the dir).
4. `normalizeNodeTest(lines, cwd)` or `normalizeVitest(json, cwd)` → `TestRunV1`; validate with `testRunV1Schema` before attaching; set `filter`/`rerunOf` from operation args.
5. Report states: no file → `missing` ("the runner did not write a report"); parse/validation failure → `invalid`; process timed out/cancelled or last JSON line incomplete → `partial` with whatever parsed; else `complete`.
6. Attach as `result.testRun`; delete the directory (best effort, `rm -r` with `force`), log nothing from its content.
7. The process outcome (succeeded/failed) is unchanged by the report.

Vitest mapping (fields per `scripts/run-dependency-contracts.ts:84–113`): `testResults[].name` = file; each `assertionResults[]` → `ancestorTitles` builds nested suites, `title` = name, `fullName`, `status` (`passed|failed|skipped|pending→skipped|todo`), `duration`, `location {line, column}`, `failureMessages[0]` → first line = `message`, remaining lines parsed into stack frames by regex `/\(?((?:[A-Za-z]:)?[^():]+):(\d+):(\d+)\)?$/`. A file-level failure with `assertionResults` empty and `message` set (e.g. import error) → one synthetic failed test named "File failed to load" with that message.

Node mapping: lines with `kind:"suite"` become suites at their `nesting`; `kind:"test"` become tests under the nearest open suite of lower nesting; top level grouped by `file`. `skip` → skipped, `todo` → todo, `type:"fail"` → failed.

Bound checks live in `test-report.ts`, pure functions, unit-tested on recorded fixtures (T03).

### 5. Rerun command (`packages/core/service.ts`, new `test.rerun` case)

`{type:"test.rerun", threadId, payload:{operationId, revision, testId}}`:
1. Flag on, else `CAPABILITY_DENIED`.
2. Load the operation; require kind `repository.test`, thread ownership as for `operation.approve` (:1391–1398), revision match, terminal status, a `testRun` with that `testId`.
3. Build args `{resourceId, testFile, recipe, testName: test.fullName, rerunOf:{operationId, testId}}` (`rerunOf` is internal: allowed only through this command, rejected in the model-facing schema).
4. Call the same domain prepare path as the tool (`handleDomainTool` for `repository_test_prepare`, with the service context as authority; the resource grant must still be valid) → a new prepared operation; return its id. Duplicate clicks while a prepared/running rerun for the same `{operationId, testId}` exists return that existing operation id (no second operation).
5. Register `test.rerun` in the server command schema path (no enum change needed, `server.ts:55`).

### 6. Client components (`apps/web/src/test-results/`, new folder)

- `TestResults.tsx`: `TestResults({run, rerun?, reruns?})` renders summary + tree; pure presentational; virtual rows not needed (R18 satisfied by rendering a suite's children only when open).
- `test-results-model.ts`: `operationTestRun(op)` (X1), `latestRerunByTest(operations, sourceId)`, summary string builder ("Ran 5 tests, 1 failed, 1 skipped" / "Ran 40 tests, all passed" / "No tests ran"), duration formatting (`< 1 s` → `"0.4 s"`, else one decimal, `≥ 60 s` → `"1 min 12 s"`).
- `useTestTree.ts`: open-state per suite/test keyed by id, defaulting failed suites open; keyboard handling (DESIGN §7.6).
- `test-results.css`: styles per DESIGN §7.
- `App.tsx` `OperationDecision`: if `operation.kind === "repository.test"` and the flag is on and `operationTestRun(operation)` exists → render `<TestResults run=… rerun=… reruns=…>` above the receipt; while `running` show the running row (DESIGN §7.2). `rerun(testId)` sends `test.rerun` via the existing command API and refreshes.
- `SoftwareDevelopment.tsx`: `TestResults` registry entry reading the bound data record's `testRun` (or a record whose value is a `TestRunV1`) and rendering without `rerun`.

### 7. Visual design and motion (normative; no separate design team)

7.1 **Card.** Same container as the operation receipt (`shell.css:238–252` neutral summary layout), full thread column width, radius and border from existing decision styles, background the task surface `#0F0F0F` (dark) / the light-mode equivalent token used by `.decision`. Padding 12px 14px. No colored card background or border; status shows only in icons and text.

7.2 **Summary row** (one line, 32px min height): flask icon (16px, `lucide` `FlaskConical` if the repo's icon set includes it, else the existing generic check icon set; neutral `--text-muted`) · title text 13px/500 "Ran 12 tests, 2 failed, 1 skipped" · right-aligned duration "3.4 s" 12px muted, tabular numerals · overall status mark via `StatusIcon` (failed → danger alert, passed → success check, partial/missing → pending warning). Failed count text in `--danger`, other counts neutral. Running: spinner (`Spinner`) + "Running tests…"; no fake progress bar. Below the title when `reportState !== "complete"`: 12px muted line with the reportProblem and "Showing what the runner reported."

7.3 **Tree.** Rows 28px min height, 12px text, indent 16px per level, 6px gap icon→text. Suite row: chevron (12px, rotates 0→90°), file icon for files / folder-less dot for groups, name (file path in monospace `var(--code-font)` 12px; group names in UI font), then muted "· 3 tests, 1 failed". Test row: status icon (passed check `--success`, failed x `--danger`, skipped/todo dashed circle `--text-muted` with text "Skipped"/"To do" after the name), name, right-aligned muted duration if ≥ 1 ms. Hover background `#1F1F1F` (selected surface token) at 50% opacity; focused row: neutral focus ring per DESIGN.md (no accent colors).

7.4 **Failure detail** (expanded failed test, indented to the name column): message in monospace 12px, `white-space: pre-wrap`, max 8 lines then "Show more"; Expected / Actual as two stacked blocks, each with a 11px uppercase muted label and monospace body on the inset surface (`--surface-inset` or the code block background used by `Diagnostics` expected/actual, `SoftwareDevelopment.tsx:53–79`), max height 240px with scroll; Stack: list of `path:line:col` (monospace, muted, first frame in normal text color); actions row: **Copy failure** (ghost button) and **Rerun this test** (ghost button with rotate-ccw icon). Rerun also appears on every test row on hover/focus-within (always visible when the container is < 480px wide or on coarse pointers). Rerun state chip after the name: "Rerun pending approval" (warning icon), "Rerunning…" (spinner), "Rerun passed" (success), "Rerun failed" (danger); the chip is a button that scrolls to the new card (`scrollIntoView({block:"nearest"})`) and focuses its summary.

7.5 **Motion.** Use tokens only:
- Chevron rotation: `transform` over `--ui-motion-hover` (120ms) `--ui-ease-move`.
- Expand: content wrapper `display:grid; grid-template-rows: 0fr → 1fr` plus opacity 0→1 over `--ui-motion-insert` (180ms) `--ui-ease-enter`; collapse over `--ui-motion-remove` (140ms) `--ui-ease-move`. Interruptible (CSS transitions, no JS timers).
- New result card: opacity 0→1 and `translateY(4px)→0` over `--ui-motion-panel-enter` (220ms) `--ui-ease-enter`, once on mount.
- Status change (running → result; rerun chip state): icon crossfade over `--ui-motion-status` (160ms); "Rerun passed" success check scales 0.9→1 once over `--ui-motion-success` (240ms).
- Rerun scroll target: summary row background flashes the hover surface for 600ms then fades over `--ui-motion-status`.
- Reduced motion (`:root[data-motion="reduced"|"off"]`, `.app-shell[data-panel-animations="false"]`, `prefers-reduced-motion`, read through `readMotionPolicy`): no transforms or height animation; opacity only ≤ 80ms (`data-motion="off"`: none); smooth scroll replaced by instant.
- No looping animation except the existing `Spinner`.

7.6 **Keyboard and semantics.** Tree container `role="tree"` with `aria-label="Test results"`; rows `role="treeitem"`, `aria-level`, `aria-expanded` for suites/failed tests, roving `tabindex`. Keys: Up/Down move, Right opens/moves to first child, Left closes/moves to parent, Home/End, Enter/Space toggle, `R` on a test row = Rerun this test, `C` on a failed test = Copy failure. Summary row is a button toggling the whole tree (collapsed shows only the summary). Live region (`role="status"`, polite) announces "Tests finished: 2 failed" and rerun state changes. Status words are always present as text or `aria-label` (not color only).

7.7 **Narrow/zoom.** At container width < 480px: duration column hidden, rerun buttons icon-only with `aria-label`, file paths middle-ellipsized (CSS `text-overflow` on the directory part, filename kept). Works at 200% zoom with no horizontal scroll except inside code blocks.

7.8 **Light mode.** Same structure; tokens resolve via the existing light theme variables; verify contrast ≥ 4.5:1 for text, ≥ 3:1 for icons.

### 8. Error/cancel/retry

Report failures follow DESIGN §4 step 5; the card never hides the raw receipt. `test.rerun` errors (`CAPABILITY_DENIED`, stale revision, resource grant revoked, Vitest missing) show inline under the test row with `ErrorState` and a Retry that resends the command. Cancelled runs show "Run cancelled" with whatever was reported (`partial`). Timeout shows "Timed out after 120 s" (from `timedOut`).

### 9. Migration/rollback

Additive: binding v2 and `testRun` only exist with the flag on; v1 operations execute and render as today. Rollback = flag off (v2 operations already prepared but not approved then fail requirement checks with a clear "Test results are turned off; ask the agent to prepare the run again" error; DISCOVERY within T02 to confirm that message path).

## EXECUTION_DAG

| ID | Goal | Depends on | Owner boundary |
|---|---|---|---|
| T01 | Flag + contract | — | `packages/core/capability-flags.ts`, `packages/contracts/test-results.ts`, contracts index, manifest |
| T02 | Recipes, binding v2, reporter module, prepare | T01 | `packages/capabilities/schemas.ts`, `repository-test-binding.ts`, `node-test-reporter.mjs`, prepare branch in `index.ts` |
| T03 | Report capture + normalizers | T01, T02 | `packages/capabilities/test-report.ts`, execute branch in `index.ts`, `process.ts` type, fixtures |
| T04 | Unit tests for T02/T03 | T03 | `tests/repository-test-results.test.ts`, `tests/fixtures/test-reports/*` |
| T05 | `test.rerun` command | T02 | `packages/core/service.ts` (new case only) + its unit test |
| T06 | Catalog component | T01 | `packages/ui-catalog/software-development.ts`, `apps/web/src/SoftwareDevelopment.tsx` (entry only) |
| T07 | Thread card client | T01, T05 (command name) | `apps/web/src/test-results/*`, `OperationDecision` in `App.tsx` |
| T08 | Visual design and motion | T07 | `apps/web/src/test-results/test-results.css`, reduced-motion coverage |
| T09 | Browser tests + evidence | T06, T07, T08 | `tests/e2e/test-results.spec.ts` (+ fixture) |
| T10 | Front end team review handoff | T04, T05, T09 | issue comment + PR |

### T01 Flag and contract
- Add `"ui.testResultsV1"` next to `ui.sourceWorkbenchV1` (`capability-flags.ts:93`) with a host definition `{ key: "ui.testResultsV1", owner: <same group as sourceWorkbenchV1>, description: "Structured test results and single-test rerun for approved repository test runs." }`.
- Create `packages/contracts/test-results.ts` exactly as DESIGN §1; export; add to `scripts/public-source-files.json` (`source`, and `runtime` mirroring other contracts files).
- Tests: flag registry test (`tests/host-capability-flags.test.ts`) asserts default false; schema positive/negative (bad id, extra key, over-limit message, version 2 rejected).
- Done when: `pnpm typecheck` passes; flag default false.

### T02 Recipes, binding v2, reporter, prepare
- Implement DESIGN §2–3; resolve X3, X4, X6; keep v1 code paths untouched when the flag is off.
- Tests (in T04 file): flag off → schema rejects `vitest`/`testName`, binding v1 argv unchanged (deep-equal baseline); flag on node-test → argv template exact; vitest → entry resolved/bound, missing `node_modules/vitest` → `INVALID_INPUT`, entry symlinked outside root → denied; `testName` with regex metacharacters → escaped pattern; NUL/newline in `testName` → rejected; binding drift of reporter or vitest entry (bytes/identity) → execution refused (extend the drift table pattern of `tests/repository-test-binding-v3.test.ts:133–172`).
- Done when: those pass and existing binding suites stay green.

### T03 Capture and normalizers
- Implement DESIGN §4 in `test-report.ts` and the execute branch; resolve X1.
- Record fixtures by running real runners once and committing the reports: `tests/fixtures/test-reports/node-pass.jsonl`, `node-fail-nested.jsonl`, `node-skip-todo.jsonl`, `vitest-fail.json`, `vitest-import-error.json`, `vitest-empty.json` (record Node and Vitest versions in a `README` line in the fixture folder and in the checkpoint).
- Done when: normalizer unit tests (T04) pass, including limits (2,001 tests → `truncated`, totals exact; 9 MiB report → `invalid`), Windows path normalization, project-external stack frames dropped.

### T04 Unit test file
- `tests/repository-test-results.test.ts`: T02 + T03 cases plus two end-to-end executor cases through the real host Node: a temp project with a `.test.mjs` file containing one passing and one failing nested test → `testRun` totals {2,1,1}, failure message and location; the same with `testName` of the failing test → exactly one test in the report. Vitest end-to-end case only if `vitest` from the repo's own `node_modules` can be bound for a temp project (symlink is outside the temp root, so copy or mark NOT_RUN with reason; prefer a temp project inside the repo's ignored test output folder).
- Done when: `pnpm exec vitest run tests/repository-test-results.test.ts --maxWorkers=1` passes.

### T05 Rerun command
- Implement DESIGN §5; resolve X5.
- Tests: wrong kind/revision/thread → denied; unknown testId → `INVALID_INPUT`; flag off → `CAPABILITY_DENIED`; success → new prepared operation with `testName` and `rerunOf`, status prepared (not executed); duplicate command returns the same operation id; model-facing schema rejects `rerunOf`.
- Done when: tests pass and `tests/operation-project-trust-v3.test.ts` stays green.

### T06 Catalog component
- Add `TestResults` to `SOFTWARE_SCHEMAS` (props `{dataBinding, stateKey?}`), `SOFTWARE_DATA_SCHEMAS.TestResults = testRunV1Schema`, an example, a description ("Displays a test run recorded by the host from an approved repository test; bind to the run's data record; never invent results"), and a discovery line in the debugging workflow (`software-development.ts:34`). Register the renderer in `SoftwareDevelopment.tsx` reusing `TestResults.tsx` without rerun.
- Tests: `tests/software-development.test.ts` gains schema/validateSurface cases for TestResults (valid; extra prop rejected).
- Done when: tests pass.

### T07 Thread card client
- Implement DESIGN §6 (resolve X2); `OperationDecision` integration; `test.rerun` client call; rerun state from `latestRerunByTest`.
- Unit tests: summary strings, duration formatting, `latestRerunByTest`, default-open logic, keyboard reducer (pure functions in `test-results-model.ts`/`useTestTree.ts`).
- Done when: unit tests, `pnpm typecheck`, `pnpm lint` pass.

### T08 Visual design and motion
- Implement DESIGN §7 in `test-results.css`; motion via tokens and `readMotionPolicy`; add the new CSS to `tests/reduced-motion-coverage.test.ts` expectations; `pnpm lint:ui` and `pnpm test:ui-guard` pass with no additions to `scripts/ui-overlay-legacy.json`.
- Screenshots: dark + light × {all passed collapsed, failure expanded, rerun pending, partial report, narrow 400px}.
- Done when: screenshots attached to the issue checkpoint.

### T09 Browser tests
- `tests/e2e/test-results.spec.ts` added to `rootBrowserSpecs` (`scripts/browser-suites.ts:3–10`), seeding `repository.test` operations through `serveTaskFixture` as `tests/e2e/project-trust-review.spec.ts:8–20` does, with `testRun` payloads from the T03 fixtures.
- Cases: flow 1 summary/counts and failed suite open; expand failure shows message/expected/actual/stack; keyboard-only navigation incl. `R` and `C`; rerun click sends `test.rerun` and the row shows "Rerun pending approval", then (seeded follow-up operation) "Rerun passed" chip scrolls/focuses the new card; "Rerun matched 2 tests" warning; missing/invalid report fallback with raw receipt; flag off → no card (baseline receipt only); reduced motion (`page.emulateMedia({reducedMotion:"reduce"})`) → no transform transitions (computed style check); 2,000-test fixture collapsed render timing (R18); narrow viewport layout.
- Real-user check (pending, not CI): Windows desktop build with `HARNESS_FLAG_*` for `ui.testResultsV1` on, a real project with Vitest: ask the agent to run a failing test file, approve, rerun one test, approve; record.
- Done when: spec passes under `playwright.config.ts` and a recording of flows 1–2 is attached.

### T10 Front end team review (owner requirement)
- After T01–T09 are VERIFIED and the PR is ready for review, post a HANDOFF checkpoint on this issue addressed to Leonardo's front end team: PR link, commit SHA, T08 screenshots, T09 recording, and DESIGN §7; request their review of the visual design and motion. Apply their requested changes (update this plan's revision if decisions change). The issue is not complete until their review is recorded.
- Done when: the front end team review is recorded on the PR/issue and requested changes are resolved.

## VALIDATION

**Setup.** Node ≥ 24.10.0, pnpm per `package.json`, `pnpm install`; browsers per `CONTRIBUTING.md:78–87`.

**Commands (planned; none executed while planning).**

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm build:widgets
pnpm exec vitest run tests/repository-test-results.test.ts tests/repository-test-binding-v3.test.ts tests/repository-test-binding-check.test.ts tests/capabilities.test.ts tests/operation-project-trust-v3.test.ts tests/software-development.test.ts tests/host-capability-flags.test.ts tests/reduced-motion-coverage.test.ts tests/public-source.test.ts --maxWorkers=1
pnpm test:ui-guard
pnpm exec playwright test --config playwright.config.ts tests/e2e/test-results.spec.ts tests/e2e/project-trust-review.spec.ts tests/e2e/operation-execution-advice.spec.ts
pnpm exec playwright test --config tests/e2e/clarity-software.playwright.config.ts
pnpm test --maxWorkers=1
```

**Acceptance matrix.**

| Req | Task(s) | Check |
|---|---|---|
| R01 | T01, T02, T07, T09 | flag-off baseline argv/binding unit; no card browser |
| R02 | T02 | schema + argv template unit |
| R03 | T02, T03, T04 | real node:test run writes report; stdout still human |
| R04 | T03, T04 | normalizer fixtures incl. limits |
| R05 | T03, T04 | `testRun` on succeeded and failed operations (X1) |
| R06 | T03, T04, T09 | missing/invalid/partial unit; fallback browser |
| R07 | T07, T09 | card above receipt; receipt collapsed |
| R08 | T07, T09 | summary strings unit; "No tests ran" browser |
| R09 | T07, T09 | default open state |
| R10 | T07, T09 | failure detail + Copy failure |
| R11 | T05, T09 | command unit; click → prepared operation |
| R12 | T05, T07, T09 | `rerunOf` + chip scroll/focus |
| R13 | T07, T09 | "Rerun matched N tests" |
| R14 | T06 | catalog schema/validateSurface |
| R15 | T02 | description string unit snapshot |
| R16 | T07, T09 | tree roles, keyboard, live region |
| R17 | T08, T09, T10 | screenshots, reduced-motion checks, front end review |
| R18 | T09 | 2,000-test timing |

**Regressions.** Existing repository-test binding/capabilities/trust suites; project-trust-review and operation-execution-advice browser specs; software-development catalog tests; UI guard; public-source manifest.

**Evidence.** Unit/browser output pasted into issue checkpoints; screenshots and one recording attached; Windows real-user check recorded separately as PASS/NOT_RUN.

**Release gate.** All rows pass in CI, Windows real-user check done, front end team review (T10) resolved; flag stays default false until the owner enables it.

## STATE

| Item | State |
|---|---|
| Research and design | DONE (this plan r1) |
| Implementation T01–T10 | NOT_STARTED; no owner, no branch |
| Verification | NOT_RUN |
| Risks | Node nested-name matching for `--test-name-pattern` (X4); Vitest config `include`/`root` can exclude the named file or change cwd semantics (shown as "No tests ran"); project code can write a fake report only if it guesses the random Gen report dir (dir is outside the project, 0700, but the process runs as the same user: results are evidence from the runner, not tamper-proof attestation; say so in the tool description); failure-message regexes vary by assertion library (unparsed lines stay in `message`) |
| Next step | An implementing agent claims the issue per AGENTS.md and starts T01, then T02/T06 in parallel |

## REFERENCES

- Owner-approved proposal: Gen-V1 feature proposals batch 4, item 4 (text quoted in META Provenance).
- shadcn AI Elements Test Results (pattern: summary line "Ran 5 tests, 1 failed", collapsible suite per file opened when it has failures, error block per failed test): https://ui.shadcn.com/docs/ai-elements/base/test-results
- VS Code Test Explorer (tree of tests, run/rerun a single test, failure peek): https://code.visualstudio.com/docs/debugtest/testing
- Node.js test runner: reporters, `--test-reporter`, `--test-reporter-destination`, `--test-name-pattern`, reporter event stream (`test:pass`, `test:fail`), and the note that built-in reporter output "is subject to change between versions of Node.js, and should not be relied on programmatically": https://nodejs.org/api/test.html
- Vitest reporters (`json` reporter, `outputFile`, multiple reporters): https://vitest.dev/guide/reporters
- Follow-up runners: Jest CLI `--json`/`--outputFile`/`--reporters` https://jestjs.io/docs/cli ; pytest `--junit-xml` https://docs.pytest.org/en/stable/how-to/output.html
- Repository files cited in REPO_MAP at `e883ac0327c834120d89c3697dec7380a342ba4d`; contract `AGENTS.md` "Complete Markdown plan publication".
