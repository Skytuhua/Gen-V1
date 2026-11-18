# M10 V6 post-merge continuation handoff (linux-arm64, session 5)

## Custody

- Worktree for this verification: `/home/piadmin/gv1-m10-v6-pmcheck` — detached
  worktree of `https://github.com/skytuhua-org/Gen-V1.git` (numeric repository
  ID 1442565952) at captured `origin/main` `4aef753ec272d6ab9f9f9eec1df0ca232386975b`.
- Assigned task branch/worktree: `agent/m10-v6` at `/home/piadmin/Gen-V1-m10-v6`,
  preserved. The remote ref `agent/m10-v6` was deleted when PR #501
  (`016738f7b57117ffe9dbbd756cb3cd173c01e202`, squash merge) landed; the
  recorded stale remote-tracking tip `a5aa3798f25163e117d0709503343cc890f29ac8`
  is the recovered published head. Local branch was fast-forwarded
  `23a311b7..a5aa3798` to that recovered head (pure fast-forward, no force
  update, no rewritten history).
- A scratch verification worktree at `/tmp/gv1-m10-v6-pmcheck` plus all other
  `/tmp/gv1-*` worktrees were destroyed by a /tmp wipe mid-session (observed
  `git worktree list` marking them prunable); the first targeted-suite pass
  observed there (43/43, 11/11, 24/24, 5/5 all exit 0) was re-verified from
  this stable worktree so every cited receipt is backed by a live log file.
- The original checkout `/home/piadmin/Gen-V1` (on `fix/t10-agents-grid-v3`
  with uncommitted user edits and untracked `qwencloud-api-key.txt`), all
  sibling task worktrees and the `review-m10-v6` .t3 worktree were not
  touched. No reset/clean/stash/account change. `git worktree prune` removed
  only bookkeeping for directories that no longer existed after the /tmp
  wipe.
- Toolchain: `/home/piadmin/tools/node24` Node `v24.11.1` (>=24.10.0),
  `/home/piadmin/tools/pnpm` `10.30.3` (exact `packageManager` pin). No
  toolchain download. `pnpm install --frozen-lockfile`; lockfile unchanged.
  `@lydell/node-pty-linux-arm64` prebuild re-provisioned into
  `node_modules/node-pty/prebuilds/linux-arm64/pty.node`
  (sha256 `c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b`,
  byte-identical to the artifact recorded in the prior handoff; already-pinned
  package payload, no dependency change).

## R03 base integration — recorded merge attempt

`git status --porcelain` was empty on the task worktree at preserved HEAD
`23a311b7` (later `a5aa3798` after the custody fast-forward). The prescribed
`git merge --no-commit --no-ff 4aef753ec272d6ab9f9f9eec1df0ca232386975b` was
executed on `agent/m10-v6` and produced conflicts on four paths. Per R03 the
merge was aborted (`git merge --abort`), the worktree restored clean, and the
join is marked **HOLD_SOURCE_DRIFT**. No blanket ours/theirs resolution was
applied. Conflict blob identities (stage1 base / stage2 ours / stage3
theirs, merge-base `3f7f9684`):

- `packages/core/external-intake.ts` — add/add: ours `6988becfe7dd8a9c7a6af57e60de2bfcbea09acc`, theirs `59d104f037ae99992c70a3c4ee5a88c1021a7cd6` (theirs carries post-merge fix `1d65ae1e` #786 paging fix)
- `packages/core/service.ts` — base `03b6ee8bac50547083848a1fab3a98438058a15b`, ours `986b00f61dd152bf1e36ea336f6fdf2ff633f153`, theirs `83415577c6186558a1100daf933de4e9e5be0602`
- `scripts/public-source-files.json` — base `2e5d94227e916525e7d23a40a34b4fe0c5805d8b`, ours `9d3d2c5756fb5df5327f876602af28ada81f544e`, theirs `6c0964767f162de858e4425354d8064c74353703`
- `tests/external-intake-v3.test.ts` — add/add: ours `16bc877c8e2fd927da265a6c9f6ebb7e624b0f17`, theirs `8f9892af7208a57dfd89cd8aa80d4c09464804d6`

This HOLD_SOURCE_DRIFT affects only the stale pre-squash branch line: every
M10 deliverable, test and evidence file is already present on `origin/main`
via squash merge `016738f7` plus follow-up `1d65ae1e` (#786). The unique-
work join is moot; verification therefore continued on a detached checkout
of captured main — the same practice the task's baseline worktrees used —
and the drift record stands for the branch line itself.

## Verified on cut 4aef753e (separate observed receipts)

- `pnpm build:widgets` — exit 0 (required asset build before targeted tests).
- `pnpm exec vitest run tests/background-work-v3.test.ts --maxWorkers=1` —
  three observed runs: run-1 exit 1 (S01 60s test timeout at load avg ~21
  while two foreign `vitest run` processes saturated the box), run-2 exit 1
  (a different test — the parked human-step case — hit the same 60s cap),
  run-3 exit 0 **43/43 PASS**. Non-adjacent tests failing on different runs
  under ~21 load average is a load-sensitive flake signature, not a
  deterministic defect; no timeout was raised and no assertion skipped.
- `pnpm exec vitest run tests/human-handoff-v3.test.ts --maxWorkers=1` —
  exit 0, 11/11.
- `pnpm exec vitest run tests/external-intake-v3.test.ts --maxWorkers=1` —
  exit 0, 24/24 (includes the #786 paging regression cases).
- `pnpm exec vitest run tests/background-contract-decisions-v6.test.ts
  --maxWorkers=1` — exit 0, 5/5.
- `pnpm typecheck` — runs 1–3 exit 134: V8 heap OOM ("Ineffective
  mark-compacts near heap limit") at ~2.05GB under load-avg ~20 while foreign
  suites saturated the box; run-4 `NODE_OPTIONS=--max-old-space-size=3584`
  exit 0 PASS (same tsc invocation, larger heap budget only — no repo, flag
  or assertion change). Resource ceiling, not a type error.
- `pnpm lint` — exit 0 (lint-ui guard, 0 violations).
- `pnpm build` — exit 0.
- `pnpm test --maxWorkers=2` — exit 1: 330 failed / 5446 passed / 115
  skipped across 500 files (59 failed files: python3.14-absent Hermes
  workers, desktop/native/platform drivers, pty/provider fixtures — the
  same environmental classes recorded in the merged evidence, no
  M10-scoped file among the failures). ~99min under shared-box load.
- `pnpm test:browser --suite background-work` — exit 0, 11/11 on bundled
  Chromium (drawer states, Respond/Decline, schedules, inbox, close
  warning, cancel custody).
- `pnpm test:browser` (full, 78 suites) — launched as a separate observed
  command; **still in-flight at handoff with no terminal receipt** (early
  non-M10 specs fail in the same environmental classes; the scoped M10
  suite already passed 11/11). Its mutable log lives only in the local
  worktree `logs-pm/test-browser-full.log` (uncommitted — excluded from
  published evidence per the evidence-only-draft rule); the `tbf.exit`
  marker lands autonomously when the runner finishes. The prior
  characterization (60-minute runner TIMEOUT on this environment) is
  unchanged. To append its receipt and refresh the verification phase:
  `python3 docs/implementation/v6/M10/build-postmerge-receipts.py` then
  `python3 docs/implementation/v6/M10/update-postmerge-verification.py`.

## Windows lane — session 6 (WIN-M0N0V07LGM1)

Distinct installed/native lane run on the linked Windows box by one isolated
verifier thread (worktree `t3-bda7e1cb`, model gpt-6.1-sol, verification-only —
no commits/pushes/docs edits; final `git status` clean). Source pinned to
current accepted main `ff38c62c3b0f8856e08f528f3c2ea8b1c1fea199`; `merge-base
--is-ancestor` confirmed both `016738f7` (#501) and `1d65ae1e` (#786).
Environment: Windows 11 Home/Core 25H2 build 10.0.26200.9974 x64, Node
v24.14.0, pnpm 10.30.3, Playwright 1.56.1 bundled Chromium 141.0.7390.37.
Verbatim report + per-command receipts: `logs-pm/win-verifier-report.md`,
`receipts-windows.jsonl`.

- `pnpm install` PASS, `pnpm build:widgets` PASS.
- M10 vitest suites on win32: **83/83 PASS** (background-work 43,
  human-handoff 11, external-intake 24, decisions 5) — real Windows-native
  corroboration of the same suite set, matching the #501 windows-latest CI
  lane (the suites' platform-honest verdicts encode the win32 expectations).
- `pnpm test:browser --suite background-work`: **12/12 PASS** in bundled
  Chromium — drawer lifecycle + Respond/Decline on Windows (win32 suite
  carries 12 specs vs 11 on linux-aarch64).
- `pnpm desktop:package` (run 1): exit 1, **ENV_MISSING** — `.harness-hermes-python-deps`
  absent from a fresh checkout; no artifacts.
- Follow-up (runs 2–3, manager-directed prerequisite recovery using only the
  repo's pinned, hash-verified inputs — `setup/action.yml` python:true plus
  the installed-memory job's staging steps at this cut): CPython 3.14.3 x64
  found; Hermes staging **PASS 33/33 dists** (5,342 files); integration
  wheels **PASS 91/91 sha256 checks** + `--require-hashes` install 91 dists
  (7,619 files); git/gh tool bundles **PASS** both archive hashes + 386
  per-file checks (147.9MB). Wheel staging via `pwsh` stalled pre-entry and
  was redone with identical checks via cmd+Python (shell substitution
  recorded; box's powershell startup stalls).
- `pnpm desktop:package --output-root .harness-installed-package` (rerun):
  **KILLED at 530.81s — UNSUPPORTED_ENV_STALL** — the exact failing declared
  step is packaging's internal `powershell.exe` `Expand-Archive` spawn for
  the Node zip: child stalled 161.45s with empty extraction dir, wrapper
  forced exit 1, powershell process termination-pending (same box-wide
  powershell-startup defect). 92,871 partial staging files; release dir
  empty — **no Setup.exe, no win-unpacked, no artifact SHA to record**.
- `verify-installed-desktop.ts`: **NOT RUN** — all phases (install / owned
  launch / CDP identity revalidation / UI acceptance / uninstall)
  unexercised. No workaround attempted.
- Unsupported vs defect distinction: zero REAL_DEFECT failures; both
  installed-lane blockers are environmental (missing prerequisite →
  box-broken powershell.exe startup), recorded rather than worked around.
- Run-2/3 verbatim report: `logs-pm/win-verifier-report-r2r3.md`.

## Holds carried forward (unchanged)

- HOLD_SUPERVISOR (C4): no installed approved supervisor with target-platform
  PASS evidence; APPROVED_SERVICE remains unavailable.
- HOLD_FORK_API (C5): no callable fork API in the pinned Hermes wrapper;
  review forks / idle model review remain UNSUPPORTED_FORK.
- HOLD_EXECUTION_PROFILE: no operator-approved M03 profile, trust and
  installed backend configured on this host.
- HOLD_SOURCE_DRIFT (this continuation): the stale pre-squash task line
  cannot be merged with current main without a prohibited blanket
  resolution; moot because the task content is already on main.
- Windows: native vitest + scoped-browser evidence now exists (session 6,
  above). Local installed-desktop proof on WIN-M0N0V07LGM1 stays
  UNSUPPORTED_ENV_STALL (box-broken powershell.exe spawn inside packaging).
  Session-7 CI-artifact follow-up below shows the declared installed
  verifier DID run and PASS at the same cut on windows-latest (provenance
  receipts committed) — and that no downloadable exact-cut binary pair
  exists for a box-local rerun.
  No live GitHub polling or live model execution (fixture-injected
  auth/fetch only).

## Session 7 — CI installed-lane artifact follow-up (ff38c62c)

Manager decision: do not repeat the failing local PowerShell packaging
step; check authenticated GitHub workflow artifacts for a
provenance-verifiable Setup.exe + win-unpacked pair from the standard
installed-memory lane at the cut; if absent, name the exact artifact gap.

**Inventory (authenticated API, 2026-11-18):**

- `runs?head_sha=ff38c62c…` → 48 runs, all `CI queue guard`
  (workflow_run) — no artifacts.
- `workflows/ci.yml/runs?head_sha=ff38c62c…` → run **44356008329** `CI`
  push, completed success (2026-11-18T17:12Z). Job **134984166865**
  `Installed desktop memory retention and opt-in` — success
  (17:12:21→17:41:12Z) on `windows-latest`.
- Run artifacts: `installed-memory-44356008329-1` (id 14455070587,
  1,797,843 B — receipts + screenshots only) and `browser-44356008329-1`.

**Exact artifact gap:** the lane does not upload binaries —
`Gen-V1-Setup-0.6.5-win-x64.exe` (477,528,078 B) and `win-unpacked/` are
NOT retained. No downloadable exact-cut pair exists → box-local
`verify-installed-desktop.ts` cannot be fed → local packaging was not
rerun; the prior UNSUPPORTED_ENV_STALL record stands.

**Compatible installed lane that ran at the cut (not inferred from
packaging):** job 134984166865 executed the declared verifier itself —
`tsx scripts/verify-installed-desktop.ts --project-memory-retention
--project-memory-enabled <Setup.exe> <win-unpacked>` → `passed: true`:

- install exit 0 (512,884 ms), owned per-user dir + HKCU NSIS keys.
- 4 owned personal launches: all `passed`, `verifiedOwner`, exit 0
  (pids 2500/6428 memoryMode `default-off`; 8956/8772 `enabled`).
- `payloadCustody` matches — 92,944 files / 2,577,916,985 B, sha256
  `a8ff5f5f0ef9c8116ff2d551bece0b2671c2920678bc17f6c5bf8fc24ddbcea5`.
- Setup.exe sha256 `afa42167eac4af0dad6651043237da3cc2b6b68bc29c0d810056f9da35d87753`
  (build-manifest + owner.json agree).
- `providerVerification` passed; packaged-providers receipt `passed: true`.
- `cleanup`: owned uninstall exit 0; cached Setup removed (sha match);
  shortcuts / installationKeys / nativeProcesses `absent`.
- `inference: false`, `auth: false`.

Receipts committed: `logs-pm/ci-installed-lane/` (raw artifact zip +
extracted JSONs + `artifact-inventory.md` with the full query chain and
file digests).

**Scope honesty:** this is the installed-memory job's own lane
configuration (its declared flags include the enabled-memory phase) — the
default-off launch pair covers the M10 lane's lifecycle phases, but this
is not a no-flag M10 invocation on the target box, and it does not remove
the WIN-M0N0V07LGM1 stall record.

## Publication

Evidence-only draft published per manager instruction as PR
https://github.com/skytuhua-org/Gen-V1/pull/837 (branch
`handoff/m10-postmerge-evidence`). No merge, no force update. Production
flags
`jobs.backgroundV1`, `jobs.serviceLifetimeV1`, `jobs.idleReviewV1`,
`integrations.intakeV1` remain default-off; `reviewerApproval` remains
false.
