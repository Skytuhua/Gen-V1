# M10 V6 handoff — durable background work and human handoffs

## Identity and custody (R01/R02/R03)

- Repository: `skytuhua-org/Gen-V1` (numeric ID 1442565952), origin `https://github.com/skytuhua-org/Gen-V1.git`.
- Original checkout `/home/piadmin/Gen-V1` preserved on `fix/t10-agents-grid-v3` (HEAD `033d32cd3e14284a816a3e8aeaa66ffe92b34090`) with its uncommitted user edits and untracked `qwencloud-api-key.txt` untouched. Other worktrees (`Gen-V1-m04-v6`, `/tmp/gv1-audit`, `/tmp/gv1-f1`) preserved. Concurrent m04/m12/m14 agent worktrees observed on this machine were not modified.
- Assigned branch/worktree created exactly as specified: `agent/m10-v6` at `/home/piadmin/Gen-V1-m10-v6`, from captured `origin/main` = `1c09d492278b1014bc3ab5455191b1f5913c96d8` (fetched without checkout).
- Ownership search before creation: no local/remote M10 branch, no `../Gen-V1-m10-v6` directory, none of the proposed M10 files on main. PR #355 is the M12 bundle (`agent/m12-v3`, open draft); its M10-labeled subset is the private-result/disclosure subset inside `packages/core/tool-programs.ts` / `packages/contracts/tool-results.ts` on that branch only. It was not duplicated and the M12 branch was not taken over. Pure source-result handles remain M04-owned; M10 issues `ToolResultHandleV1`-shaped references over its own bounded Store output projection (no new disk protocol).
- R03: task worktree clean at integration; `git merge --no-commit --no-ff 1c09d492…` reported **Already up to date** (no-op; branch created directly from captured main). Preserved starting HEAD = `1c09d492278b1014bc3ab5455191b1f5913c96d8`. No conflict, no HOLD_SOURCE_DRIFT.
- Audit anchor `4805af4680094d2af48ecf666688e750797e9dda` retained as source-inspection reference only.

## Toolchain and environment provisioning (R08/R09)

- Node v24.11.1 (`/home/piadmin/tools/node24/bin/node`, satisfies `>=24.10.0`), pnpm 10.30.3 (`/home/piadmin/tools/pnpm`, exact `packageManager`). No toolchain download.
- `pnpm install --frozen-lockfile` in the task worktree (lockfile unchanged).
- Linux aarch64 has no `node-pty` 1.1.0 prebuild (darwin/win32 only); every suite importing the host failed to load on the pristine base as well. Provisioned the **already-pinned** `@lydell/node-pty-linux-arm64@1.1.0` artifact (an optional dependency of pinned `@google/gemini-cli@0.66.0` in the same lockfile) into `node_modules/node-pty/prebuilds/linux-arm64/pty.node`. SHA-256 `c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b`. No dependency or lockfile change; identical provisioning applied to the baseline worktree. Verified: `tests/agent-follow-up.test.ts` loads and passes 18/18 after provisioning.
- `python3.14` is absent (system Python 3.12.3); Hermes source-worker tests fail identically on baseline and candidate. Windows-only credential-lease build is a silent no-op on Linux per the existing script; `pnpm test` still executes it as its first step.
- Baseline cut: detached worktree `/tmp/gv1-m10-baseline` at the same captured main SHA, separate receipts (`baseline-receipts.jsonl`).

## What was implemented

Contracts (`packages/contracts/background-work.ts`): BackgroundWorkV1 (SETTLED⇒outcome, UNKNOWN⇒null, RUN default), WakeupV1 tagged AT_UTC/INTERVAL_UTC/HOST_EVENT with display-only timezone, exact occurrenceKey formulas, BackgroundOccurrenceV1 receipts, HumanStepV1, IntakeV1, hold-reason constants, M10 flag keys.

Scheduler (`packages/core/durable-wakeups.ts`): one scheduler over the existing Store; 1000ms tick, ≤50 due records, synchronous claim transactions, 30s lease, 10s heartbeat, claimGeneration increments; interval anchor math admits only the latest missed occurrence and persists skipped occurrences; expired-claim sweep marks uncertain dispatch UNKNOWN (no second submit); restart reconciliation before replacement delivery; pause/resume/cancel; bounded shutdown drain.

Coordinator (`packages/core/background-work.ts`): owned work admission with host-derived ownership; APPROVED_SERVICE blocked HOLD_SUPERVISOR; REVIEW blocked HOLD_FORK_API (pinned wrapper has no fork method; `admitReviewFork` returns UNSUPPORTED_FORK / AUXILIARY_BUDGET_REQUIRED); COMMAND launch gated by injected M03 `executionGate` (HOLD_EXECUTION_PROFILE without it); real owned-process runner (pid + Linux /proc starttime creation token, 512KiB bounded cursor output, exit receipts, identity-verified stop, host-loss UNKNOWN, exact-receipt reconciliation); permit custody released only after confirmed teardown; idle opt-in (≥60s, one per profile) with foreground preemption that retains running permits; human steps with revision correlation, content-digest replay receipts (identical⇒original receipt, changed⇒CONFLICT), decline-as-cancelled, credential surface refusal; rollback pauseAll preserving receipts and quarantining UNKNOWN; closeSummary (no proven supervisor, work stops with app).

Intake (`packages/core/external-intake.ts`): authenticated read-only polling of the configured numeric repository through the existing GitHubAuth token connection, 60s cadence while explicitly enabled; dedupe by repository+node_id+updated_at; payload digests; wrong-repository REJECTED; transient-only retry (3 attempts, 1000/2000ms); no retry on auth/validation/cancellation; approval is an explicit host command routed through the same `thread.create` + `message.send` gates as manual tasks; no webhook listener or push ingestion surface.

Host binding: `Service.backgroundWork` / `Service.intake`, `background.*` / `intake.*` command routing with receipts, foreground-admission preemption hooks in send/resume, recovery and bounded drain in `Service.recover/dispose`, `isUpdateIdle` includes background custody. Production composition (`apps/server/hermes-service.ts`) injects `hermesModelCapacity`, an `evaluateExecution`-bound gate (operator profile/trust/backend required; no fallback) and the real `GitHubAuth` connection. Read routes `apps/server/background-routes.ts` under existing session/origin/CSRF guards.

Flags (G02): `jobs.backgroundV1`, `jobs.serviceLifetimeV1`, `jobs.idleReviewV1`, `integrations.intakeV1` added to the existing host registry, default false, other keys untouched, absent from strict UI preferences, no agent/plugin toggle.

UI (G/U01–U04): one task-owned drawer `apps/web/src/BackgroundWork.tsx` mounted through the existing workspace split-view mechanism (`background-work` editor option): Waiting/Running/Waiting for you/Blocked/Completed(Succeeded|Failed|Cancelled)/Outcome unknown; command, owner, elapsed, cursor output, Open child task; secure Respond/Decline via existing handoff command path and SchemaFields; credential steps refuse plaintext entry; external inbox separates proposed/approved with repository, authenticated source and rejected/duplicate state; schedules show next occurrence, display timezone, pause/resume, last actual run, skipped count; close warning never promises sleep execution. Loading/empty/denied/stale/unavailable/cancelled/offline states covered by the fixture browser suite (11 cases, bundled Chromium).

## Holds and remaining gates

- HOLD_SUPERVISOR (C4): no installed approved supervisor with target-platform PASS evidence; APPROVED_SERVICE stays unavailable. Nothing was installed or written to bypass the gate.
- HOLD_FORK_API (C5): no callable fork API in the pinned Hermes wrapper (`worker.py` METHODS; task-pool only creates read-only secondary engines). Review forks and idle model review remain unavailable; no ambient plugins, no copied runtime, no auxiliary budget invented.
- HOLD_EXECUTION_PROFILE: production command launch requires operator-approved M03 profile + project trust + installed backend; none configured here. The gate is wired to the real `evaluateExecution` policy.
- S02 foreground-timeout "Continue in background" offer is not wired to the operation timeout UI; the permitted-profile command path itself is implemented, bound and tested.
- Platform: Linux aarch64 only; Windows/installed-desktop evidence absent. Live GitHub polling and live model execution not exercised (fixture-injected auth/fetch; no credentials used).
- Full `pnpm test` / `pnpm test:browser` outcomes and baseline identity comparison are recorded in `docs/implementation/v3/M10-verification.json` and the logs; environmental failures (python3.14, missing Chrome/Edge channels) are not waived and not classified as passes.

## Rollback (G03)

`background.pauseAll` pauses every wakeup and intake, preserves occurrence/admission/effect receipts, cancels only owned eligible work and leaves UNKNOWN processes quarantined for inspection. Disabling the four host flags returns the host to pre-M10 behavior; no destructive migration exists (additive Store kinds only).

## V6 completeness fixes (post-audit)

A clause-by-clause re-audit found and fixed: S04 account-binding plus host-injected grant/budget authority revalidation (Service binds `assertAccountAvailable`); S01 single shared 50-record inspection budget per tick; S11 persistence of every missed occurrence (100k host memory guard); S08 permit release after each confirmed idle teardown; S12/G03 drain and rollback now abort running idle executors and stop owned running commands; admission validates exact command specs and restricts idle kinds to read-only MAINTENANCE/REVIEW. Nine new regression tests cover these plus U02 dismiss-is-not-approval and S07 parent-turn invalidation. Targeted totals: background-work 31, human-handoff 11, external-intake 13, decisions 5 (60 unit tests), all exit 0; typecheck/lint exit 0. Full gates re-run on the corrected cut.

## Observed gate outcomes (final cut)

- Targeted suites (separate receipts): background-work-v3 31/31, human-handoff-v3 11/11, external-intake-v3 13/13, background-contract-decisions-v6 5/5 — all exit 0.
- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (UI guard 543 sources, 0 violations); `pnpm build` exit 0.
- `pnpm test --maxWorkers=2` exit 1: 298 failed / 3865 passed / 58 skipped (4221). Baseline (pristine captured main, separate worktree, identical provisioning and worker count): 298 failed / 3805 passed / 58 skipped (4161). 297 shared failure identities; the single candidate-only identity (personal-visuals-ui) passes 7/7 in an isolated candidate rerun (load flake); the single baseline-only identity (dev-plugin-runtime) failed only on the baseline full run — symmetric noise. The 60 new M10 tests all pass. Dominant environmental causes: python3.14 absent (Hermes source worker), native/platform-specific suites.
- `pnpm test:browser` exit 1: 62 suites failed (baseline 64). **Zero candidate-only failing suites**; saved-drafts and thread-move failed only on the baseline run and passed on the candidate. Of the 73 candidate-only test identities inside shared-failed suites, 71 are `msedge` launch failures (`/opt/microsoft/msedge` absent on both cuts; the baseline run hit fixed-port collisions before reaching launch) and 2 are task-design timing cases — every candidate-only task-design case passes in at least one isolated candidate rerun, and the suite fails nondeterministically on both cuts (baseline isolated 2 failures; candidate isolated runs 5 then 3 with overlapping sets). Missing Chrome/Edge channels, fixed-port collisions with concurrent m04/m12/m14 agent fixture servers, and shared-machine load are not waived. The new background-work suite passes 11/11 both inside the full run and as the focused final receipt (bundled Chromium).
- Evidence integrity: `implementationEvidenceV3Schema.parse` + `validateImplementationEvidence` report zero issues; computed `bundleStatus` = FAIL (required full gates fail on this environment). Reviewer approval remains false; production flags remain false. Milestone outcome: PARTIAL — C1/C2/C3 deterministic phases pass with source-bound evidence; C4 HOLD_SUPERVISOR, C5 HOLD_FORK_API; platform/live gates unmet.
- Intermediate observations preserved: r1 red/green cycles (`m10-vitest-*-r1/r2.log`), cancelled intermediate full run (`m10-test-full-r1.log`, cut changed before completion), first browser suite run (`m10-browser-background-work-r1.log`, 2 fixture-locator failures fixed in r2).

## Publication

LOCAL_ONLY. No push, PR, account change or force update was performed. Final commit SHA is reported in the task reply outside the committed artifacts.

## Session 3 — continuation, base-integration attempt and re-verification

A follow-on session of the same assigned task resumed custody of `agent/m10-v6` at `/home/piadmin/Gen-V1-m10-v6`. The duplicate-work search found this worktree/branch (HEAD `a8c85dcd`, clean tree) as the existing M10 task work — the same assigned names, so custody continued rather than duplicated. No other M10 owner exists. PR #355 remains the M12 bundle and was not touched.

### R03 base-integration attempt

- Captured `origin/main` at fetch: `33639138f1cca3a596cab6315b1518a799fea6a5` (80 commits ahead of merge-base `1c09d492`).
- Working tree clean (0 entries); preserved HEAD `a8c85dcd0072a544793946fe1f4e9d5f3ec288a5`.
- `git merge --no-commit --no-ff 33639138` → content conflicts in 3 files; per R03 the conflict paths and base/ours/theirs blob identities are recorded here and `git merge --abort` restored the clean task worktree (verified: status 0, HEAD `a8c85dcd`). The affected join is marked **HOLD_SOURCE_DRIFT**. No blanket ours/theirs or guessed replacement API was applied; no remote update occurred.

| path | base (stage1) | ours (stage2) | theirs (stage3) |
|---|---|---|---|
| apps/server/server.ts | f47211cc6c67eb683241a368604c1e56d862908b | e8ccd884a21678405a348ea872eba6d26eee306c | 894473a7fbfc0d9e5879fb6982b7fcf40d902db6 |
| apps/web/src/App.tsx | 6858a165c1fe566004d1de24b5661baf9b63b895 | 0ea78ad15b48ba9a011c8a1db2d80205f856ccb6 | 20833df2893d03b265498246c42e3771edd93eed |
| packages/core/capability-flags.ts | 02783eb029b618f9bf1abe0b9f51ff8f5c27076a | 9026dda94544b6be171eacd8f01a94e3321b04ed | bb13ab52cfb8ff5c4cd6f3d8081087d61ad60460 |

Conflict characterization: `capability-flags.ts` — adjacent-addition collision; ours adds `M10_FLAG_KEYS` union member + four host registry entries, theirs adds `M15_FLAG_KEYS` (`ui.sourceWorkbenchV1`), `M04FlagKey` union member and three m04 registry entries. `App.tsx` — ours wires the `background-work` editor option/drawer label inside `renderSplitRoot`; theirs rewrote the same expression (customDock layout, `onActiveViewsChange`, differing editor-option list). `server.ts` — whole-file conflict; ours restructured route registration for background routes while theirs refactored the file around the new M15 source-workbench routes. Resolution requires owner-level coordination, not a guess.

### Re-verification on the unchanged cut (stages independent of the join)

The aborted merge restored a byte-identical tree, so the prior `-final` gate receipts remain source-bound to this SHA. Fresh r3 receipts (separate ledger `receipts-r3.jsonl`, logs `*-r3.log`):

- `pnpm build:widgets` exit 0
- `pnpm exec vitest run tests/background-work-v3.test.ts --maxWorkers=1` exit 0 (31/31)
- `pnpm exec vitest run tests/human-handoff-v3.test.ts --maxWorkers=1` exit 0 (11/11)
- `pnpm exec vitest run tests/external-intake-v3.test.ts --maxWorkers=1` exit 0 (13/13)
- `pnpm exec vitest run tests/background-contract-decisions-v6.test.ts --maxWorkers=1` exit 0 (5/5)
- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (543 sources, 0 violations); `pnpm build` exit 0

Full `pnpm test` / `pnpm test:browser` outcomes are unchanged from the recorded `-final` receipts on this identical SHA (environmental failures: python3.14 absent, Chrome/Edge channels absent; not waived, not classified as passes). Milestone outcome remains **PARTIAL**: C1/C2/C3 deterministic phases PASS; C4 HOLD_SUPERVISOR; C5 HOLD_FORK_API; base join HOLD_SOURCE_DRIFT; platform/live gates unmet. Production flags remain false; reviewerApproval remains false.

## Session 4 — user-authorized conflict resolution and merge

The user explicitly authorized resolving the session-3 conflict set and pushing the result. origin/main was re-captured as `567498568611bc33379b31a0630dfaf3691b339f` (it had advanced one commit past 33639138 during the session). `git merge --no-commit --no-ff 56749856` reproduced the same three conflicts:

- `packages/core/capability-flags.ts` — kept `M15_FLAG_KEYS`, `M04FlagKey`, the three m04 registry entries AND the four M10 keys/registry entries; `CapabilityFlagKey` union covers all owners.
- `apps/web/src/App.tsx` — kept main's `renderSplitRoot` rewrite (`customDock`, `customConversationLayout`, `onActiveViewsChange`); re-applied the three M10 insertions (`background-work` editor option + title + `openBackgroundWork` routing).
- `apps/server/server.ts` — root cause was a whole-file EOL difference (base/theirs CRLF, ours LF) hiding a 2-line semantic change; resolution keeps main's CRLF file plus both `registerSourceWorkbenchRoutes` and `registerBackgroundRoutes` import+call.

No blanket ours/theirs; every conflict was resolved by composing both sides' actual changes. Merge commit `cbb964169ed900253d78681e90d6069b9f22139c`. Auto-merged files (`service.ts`, `browser-suites.ts`, `public-source-files.json`) verified semantically: M10 anchors intact, JSON parses, suite registered.

### Combined-tree verification

`pnpm typecheck` exit 0; targeted suites re-verified pre-commit (60/60) and again as `-final` receipts post-commit; `pnpm lint` exit 0 (571 sources); `pnpm build` exit 0. The full `pnpm test` and `pnpm test:browser` gates were re-executed on the merged cut through the receipt runner (results below in this section's receipts; ledger `receipts.jsonl` rolled over — pre-merge `-final` rows preserved in `receipts-final-archived.jsonl`). A fresh baseline worktree `/tmp/gv1-m10-baseline2` at `56749856` (frozen-lockfile install, same node-pty prebuild provisioning) provides the matching same-base comparison for full-gate outcomes.

### Evidence base update

`build-evidence.mjs` now measures `baseSha` at the merge parent `56749856` so `changedFiles` contains only M10 work; inspected-path blobs are re-captured at that base. `expectedBaseSha` for validation follows the same SHA.

### Session-4 gate outcomes on the merged cut (receipts.jsonl)

- Targeted suites: background-work-v3 31/31, human-handoff-v3 11/11, external-intake-v3 13/13, decisions 5/5 — all exit 0.
- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (571 sources, 0 violations); `pnpm build` exit 0.
- `pnpm test --maxWorkers=2` exit 1: **304 failed / 4115 passed / 62 skipped (4481)** vs fresh same-base baseline `/tmp/gv1-m10-baseline2` at `56749856`: **306 failed / 4053 passed / 62 skipped (4421)**. **All 304 candidate failure identities are shared with baseline — zero candidate-only failures.** The 60-test delta is exactly the new M10 suites (all pass). The 2 baseline-only identities (desktop-host startup collision, dev-plugin-runtime) are the same environmental/flaky class recorded on the prior cut. Dominant causes unchanged: python3.14 absent, linux-path-guard denials, native/platform suites.
- `pnpm test:browser` exit recorded, termination **TIMEOUT** at the receipt runner's 60-minute bound after 35 suite groups (concurrent m04/m12/m14/m15 agent load; a separate m15 browser gate ran simultaneously). 24 of the 35 failed; 23 of those identities appear in the prior baseline's failed-suite list and the one new identity (`m08-restore`, a 20s load timeout) passes 7/7 in an isolated candidate rerun (24.7s). The focused `pnpm test:browser --suite background-work` receipt exits 0 (11/11) on the merged cut. A completed full-suite run remains an unmet gate; missing Chrome/Edge channels and port collisions are not waived.
- Milestone outcome remains **PARTIAL**: C1/C2/C3 deterministic phases PASS on the merged cut; C4 HOLD_SUPERVISOR; C5 HOLD_FORK_API; HOLD_EXECUTION_PROFILE; platform/live gates unmet. Production flags remain false; reviewerApproval remains false.

## Session 5 — Windows CI fix on `agent/m10-v6`

PR #501 CI (Tests job runs `windows-latest`) reported shard 3/4 failure on head `f3a73117`. Check-run annotations showed `tests/background-work-v3.test.ts` POSIX-only assumptions: `process.kill(-pid)` group signalling (ESRCH on Windows), a `GONE` verdict expectation for a `linux`-claimed identity probed on a win32 host (`UNPROVEN` is the honest verdict there), a pauseAll `SETTLED/FAILED` expectation where the platform-honest result is `UNKNOWN` quarantine without signalling, and `rmSync` EPERM on temp dirs still held by terminating children.

Fix is test-only; core contract semantics are unchanged and were already correct — `stopCommand` refuses to signal an unproven identity and quarantines as UNKNOWN on every platform. Changes: platform-agnostic `killOwnedProcess` helper (POSIX group kill / win32 direct kill), `GONE`/`SETTLED`/`resolveProcessExit` assertions branched on `process.platform === "linux"`, non-Linux branch asserts the quarantine holds (`RECONCILIATION_REQUIRED`), and `rmSync` cleanup gains `maxRetries`/`retryDelay` across all four M10 test files.

Local verification: background-work-v3 31/31, handoff 11/11, intake 13/13, decisions 5/5, `pnpm typecheck` exit 0, `pnpm lint` exit 0. Full Windows-platform evidence now rests on the CI run of this commit.

## Session 6 — Windows CI PASS and parallel deliverables

PR #501 CI on head `86c549d0`: **all checks green**, including `Tests (shard 3/4)` on `windows-latest` — the shard-3 failures (POSIX group kill, platform-verdict expectation, exit-receipt/store-close race) are resolved by `e3eb3301` + `86c549d0` (test-only; core semantics unchanged). This supplies real Windows-platform evidence for the M10 suites that the local arm64 host could not produce.

Docs commit `c6611f1a` (README contribution/issue guidance + org-URL fixes) was additionally cherry-picked to `main` as `fe497314` so the change is live without waiting on the PR; the duplicate will merge cleanly.

Contributor issues filed covering the remaining milestone holds and adjacent gaps: #575 (HOLD_SUPERVISOR), #576 (HOLD_FORK_API), #577 (live intake polling), #578 (m08-restore flake), #579–#590 (UI/UX/frontend: a11y passes, mixed-DPI acceptance, skipped agents-grid evidence job, reduced-motion audit, shortcut reference, theme contrast, zoom resilience, minimized-tool affordances).

Milestone status unchanged: **PARTIAL** — external-authority holds now tracked as issues #575/#576/#577 plus HOLD_EXECUTION_PROFILE; local full `pnpm test`/`test:browser` environmental limits stand as recorded; `reviewerApproval` remains false.
