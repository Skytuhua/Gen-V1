# M14 Windows-agent continuation handoff

Audience: the next agent running on a **Windows x64** host. Goal: clear the
remaining environmental blockers recorded on Linux/aarch64, rerun the gates,
and update the evidence + PR #343 truthfully.

## Status update (2026-11-18, head `50da8ae6` LOCAL)

- Branch resumed at `3c40a31e`, merged `origin/main` `89142de9`, then
  upstream `14c0b70b` recorded `nativeFork: UNSUPPORTED` (tested absence
  of a callable fork API — fail-closed) across all adapters.
- **Post-M17 forward merge prepared locally**: main `16fa007e` merged as
  `50da8ae6` (parents `04b4ae0e` + `16fa007e`). Two conflicts, both in
  M14 custody: `capability-flags.ts` (kept M17 keys block; union now
  includes `M14FlagKey` AND `M17FlagKey`, all defaults false) and
  `scripts/public-source-files.json` (sorted union — **both** `source`
  4418 and `runtime` 289 arrays; missing the `runtime` union broke the
  staged-build test once). `server.ts` auto-merged retaining BOTH
  `registerSessionBranchReadRoutes` and `registerDevicePairingRoutes`.
- Source lock + evidence rebound to `50da8ae6`; `verify-evidence.mjs`
  passes; focused M14 + evidence-gates + public-source = 51/51 PASS;
  `host-capability-flags` 6/6; typecheck, lint PASS.
- **Windows W1–W4 was run on a real Windows Server 2025 x64 host** (see
  `handoff.md` "Windows x64 continuation"): typecheck/lint/build PASS,
  contract suites 147/147, packaged natives 27/27, full suite 4086/67,
  browser 41/76 suites, desktop package produced — receipts in
  `docs/implementation/v3/m14/logs/win-*.log`.
- PR-body "63/63 custody manifest on WSL2" claim: **UNVERIFIED** —
  in-tree WSL2 receipts are 27/42 at a pre-broker-extension cut; needs
  exact command + SHA + dedicated-broker receipt before PASS.
- **LOCAL, not pushed** — PR-triggered run `44412564541` on `14c0b70b`
  still active; pushing would cancel it (pull_request cancel-in-progress).
  Next step: push `50da8ae6` + rebind commit once that run concludes or
  the manager clears it. Main has since moved to `c74add6b` (+1 audit PR,
  no new M14 conflicts expected but re-check at push time).

## Pointers

- Repo: `https://github.com/skytuhua-org/Gen-V1.git`
- Branch: `agent/m14-v3` — PR https://github.com/skytuhua-org/Gen-V1/pull/343 (draft, open)
- Handoff head when written: `24304a573eaa2bb5743a7bc211f0d270fed7a408`
- Blocker inventory on the PR: `pull/343#issuecomment-6936435636`
- Toolchain: Node v24.x, pnpm 10.30.3 (`pnpm-workspace.yaml` pins it)
- Authoritative evidence bundle: `docs/implementation/v6/M14/` — run
  `pnpm exec node --import tsx docs/implementation/v6/M14/verify-evidence.mjs`
  after any change to audited sources or evidence files.

## What is already done — do not redo

- Full M14 product implementation: ArchiveV1 validator/importer, owner-bound
  immutable session captures, HMAC cursors, quoted-context new tasks,
  `FORK_CONVERSATION` → `FORK_UNSUPPORTED` gating, host-owned flags
  `sessions.branchV1` / `sessions.inertImportV1` (both default-off), server
  routes, `SessionBranchMenu` UI.
- Tests: `tests/session-branch-v3.test.ts` (11), `tests/history-import-v3.test.ts`
  (12), `tests/history-import-decisions-v6.test.ts` (11) — 34/34 pass.
- typecheck / lint / build: clean.
- `553aa988` — `pnpm-workspace.yaml`: `node-pty` in `onlyBuiltDependencies`,
  `supportedArchitectures` admits win32/x64 optional packages. On Windows
  `pnpm install` should now resolve `@cursor/sdk-win32-x64` natively.
- `aca5f061` — S11 archive-coverage test.
- `40626175` — evidence rebound; verifier passes.

## Baseline state on aarch64 Linux (for comparison)

- Full `pnpm test`: 3845 pass / 298 fail / 58 skip — every failure classified
  environmental, zero M14-caused.
- `pnpm test:browser`: executes real specs (28 pass); failures need
  `<chrome-dir>` and `<msedge-dir>` — neither ships aarch64.

## Your blockers — what Windows CAN fix

### W1. Windows-native packaged tests (~3 files)

- `tests/packaged-providers.test.ts`, `tests/desktop-packaging.test.ts`:
  execute vendored win32 `rg.exe` — PE binary, Linux cannot exec it. On
  Windows these should run natively. Run and record the receipt.
- `tests/cursor-offline-executor.test.ts`,
  `tests/cursor-sdk-mcp-metadata.test.ts`: load win32 `binding.node` from
  `@cursor/sdk-win32-x64`. The package is now installable (see `553aa988`);
  on win32-x64 Node the `dlopen` should succeed. If it still fails, capture
  the loader error verbatim — do not shim the binary.

### W2. Browser suite — Edge is native on Windows

- `pnpm test:browser` — Playwright configs use `channel:'msedge'`
  (e.g. `tests/e2e/agents-workspace.playwright.config.ts`,
  `compact-model-picker`, `native-browser-bounds`, `project-app-integration`)
  or chromium fallback. With Microsoft Edge installed these should execute.
  Use the system's real Edge; do not stub.
- Note port conflicts: e2e configs pin fixed ports (5377/5397/5440/5636/5788…).
  Check for stale `vite`/node processes before rerunning; kill only your own
  worktree's orphans.
- Record per-project results in `M14-verification.json` — browser evidence was
  previously NOT_RUN / env-blocked.

### W3. Windows/installed-desktop matrix

- Entirely absent so far (no Windows host existed). Run whatever packaging /
  installed-desktop checks the repo defines (`tests/desktop-packaging.test.ts`
  and related scripts) and record outcomes honestly.

### W4. Bundled Hermes Python

- Path-guard fixtures expect `hermes-python/bin/python3.14`, produced by CI
  packaging jobs. Check `scripts/` for the packaging/bundle producer; if the
  bundle can be materialized on Windows for win32 tests, do so via that path —
  do not substitute system python.

## What Windows CANNOT fix — flag for the orchestrator

### X1. linux-path-guard custody broker (~40 files, ~119 assertions)

`packages/core/linux-path-guard.py:104` requires `os.geteuid()==0 AND
os.uname().machine=="x86_64"` + ext4 backing. This is Linux-x86_64-only by
design — **do not relax or mock it**. Options, in order:

1. A real x86_64 Linux host/VM with root and ext4.
2. WSL2 on your Windows box: real x86_64 kernel + ext4 VHD; run the suite
   inside the WSL distro filesystem (not `/mnt/c` — that is drvfs). Verify
   `uname -m` reports x86_64 and userns works (`unshare -U true`). If the
   broker launches under WSL2, the whole custody class may clear; record
   exactly which assertions still fail.

### X2. Product holds — need authorization, not just a platform

- `HOLD_NATIVE_FORK`: `FORK_CONVERSATION` intentionally returns
  `FORK_UNSUPPORTED`; no `RuntimeAdapter` exposes a tested native fork API.
  Closing this requires implementing/proving one against a real engine —
  get explicit approval before starting; it is new product surface.
- `HOLD_EXTERNAL_FORMAT`: only strict ArchiveV1 JSON is admitted by spec.
  Supporting other formats requires an approved parser/license/dependency
  manifest — user decision.
- `HOLD_IMMUTABLE_SOURCE`: current inspection is a host-Store-copied fixed
  cut; native transcript/checkpoint proof needs a platform source that does
  not exist yet.

## Procedure

1. `git clone` / `git worktree add` the repo on your Windows host; checkout
   `agent/m14-v3`. Do not touch other agents' worktrees.
2. Install toolchain: Node v24.x, `corepack enable` or pnpm 10.30.3.
3. `pnpm install` — `node-pty` will build via node-gyp; ensure MSVC build
   tools are present on Windows.
4. Run targeted M14 tests first (sanity):
   `pnpm exec vitest run tests/session-branch-v3.test.ts tests/history-import-v3.test.ts tests/history-import-decisions-v6.test.ts`
5. Then the gates: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`,
   `pnpm test:browser`. Save bounded logs under
   `docs/implementation/v3/m14/logs/` (keep them small — tails, not full dumps).
6. Update `docs/implementation/v3/M14-verification.json` with real receipts —
   keep historical entries, append yours.
7. If you modified any audited source file, rebind the source lock:
   update `inspectedPaths` blob SHAs and `executionBaseSha` in
   `docs/implementation/v6/M14/source-lock.json`, update dispositions in
   `requirements.json`, then rerun `verify-evidence.mjs` until it passes.
8. Update `docs/implementation/v6/M14/handoff.md` (and this file's status) with
   what actually changed.
9. Commit with the repo's message style, push to `agent/m14-v3`, and post a
   status comment on PR #343.
10. New docs/source files must be enrolled in
    `scripts/public-source-files.json` (alphabetical) — the public-source test
    enforces it.

## Hard rules

- Keep `sessions.branchV1` / `sessions.inertImportV1` default-off and
  `reviewerApproval:false` unless separately authorized.
- Never claim PASS where a gate did not run — state `NOT_RUN`/`BLOCKED`/`FAIL`
  with the reason.
- Do not relax security checks (path guard, custody, fencing) to make tests
  pass.
- Do not commit secrets, tokens, or real credentials. The GitHub credential
  used on the previous host is stored in that host's `~/.git-credentials`
  only — you need your own auth.
- If a failure looks M14-caused (anything in `packages/core/session-branches.ts`,
  `history-import.ts`, `contracts/session-branch.ts`, `session-branches`
  routes, `SessionBranchMenu`), STOP and report — the expectation is zero
  M14-caused failures; a real regression changes the story.
