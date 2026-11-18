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
  command; still in-flight at handoff writing
  `logs-pm/test-browser-full.log` (early non-M10 specs fail in the same
  environmental classes; the scoped M10 suite already passed 11/11). Its
  `logs-pm/tbf.exit` marker and final log land autonomously; the prior
  characterization (60-minute runner TIMEOUT on this environment) is
  unchanged. To append its receipt and refresh the verification phase:
  `python3 docs/implementation/v6/M10/build-postmerge-receipts.py` then
  `python3 docs/implementation/v6/M10/update-postmerge-verification.py`.

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
- No Windows/installed-desktop evidence; no live GitHub polling or live
  model execution (fixture-injected auth/fetch only).

## Publication

LOCAL_ONLY. No push, no remote merge, no force update. Production flags
`jobs.backgroundV1`, `jobs.serviceLifetimeV1`, `jobs.idleReviewV1`,
`integrations.intakeV1` remain default-off; `reviewerApproval` remains
false.
