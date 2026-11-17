# M14 v6 handoff — Branchable sessions and inert history imports

Status: computed `bundleStatus` is **FAIL** — two phases carry FAIL
status (`CORE.existing-contract-tests`, `INTEGRATION.direct-unit-baseline`),
driven entirely by pre-existing environmental denials on this aarch64
Linux host. Root causes were diagnosed to source level:

- `linux-path-guard` tests (~40 files): `packages/core/linux-path-guard.py`
  `private_profile()` requires `os.uname().machine == "x86_64"` plus euid 0
  and ext4 backing — the custody broker cannot launch on aarch64 at all.
  Not an AppArmor issue (userns relaxation was tried and reverted as
  irrelevant).
- Windows-only packaged-native tests: `rg.exe` and vendored win32 `.node`
  bindings cannot execute on Linux.
- Missing `hermes-python/bin/python3.14` bundled toolchain (produced by
  CI packaging jobs, absent from this checkout).

Environment fixes applied and verified: `pnpm-workspace.yaml` now lists
`node-pty` in `onlyBuiltDependencies` (its native build never ran, which
cascaded into ~21 test files failing at module import) and
`supportedArchitectures: {os:[current,win32], cpu:[current,x64]}` so the
win32 optional SDK packages the custody probes inspect actually install.
No dependency or lockfile change; `pnpm install --frozen-lockfile` stays
green.

Every implementable M14 phase is complete and source-bound (PASS); the
remaining phases are named holds that require external proof (a tested
adapter fork API, an admitted parser manifest) or platforms this host
cannot provide (x86_64 custody broker, Windows, browser). No required
M14 product case failed. The final commit SHA is reported in the session
response, not inside this artifact.

## Custody

- Repository: `skytuhua-org/Gen-V1` (ID 1442565952), remote
  `https://github.com/skytuhua-org/Gen-V1.git`.
- Branch: `agent/m14-v3` (PR #343). Worktree:
  `/home/piadmin/Gen-V1-m14-v6` (clean).
- Recorded published head recovered at start:
  `b27c8360e1b0236a1df131cbc7893e9c492573df` (docs-only audit handoff —
  no product code existed).
- Base integration: merged `origin/main` `71b3b405` into the task branch
  as `ea48854b` (clean, no conflicts). That merge brings M04 request
  custody and M05 project memory onto the branch — the prior
  prerequisite gate is resolved.
- Original checkout `/home/piadmin/Gen-V1` left untouched, including its
  user edits and `qwencloud-api-key.txt`.

## Implementation (commit `5de9d4a6`)

- `packages/contracts/session-branch.ts` — `BranchRequestV1`,
  `SessionCaptureV1`, `ArchiveV1`, `HistoricalCursorV1`,
  `ARCHIVE_V1_LIMITS` (20 MiB, 100 conversations, 10,000 messages).
- `packages/core/history-import.ts` — strict ArchiveV1 validation
  (iterative cycle detection, graph integrity, typed `HarnessError`s),
  secret/access-link scan, deterministic digest dedup, atomic
  stage/commit/cancel inside `Store.command` (parse happens outside the
  transaction).
- `packages/core/session-branches.ts` — adapter capability matrix
  (hermes, pi, official-claude, official-gemini, official-cursor: receipt
  history yes, fixed-cut inspect `UNSUPPORTED`, native fork `UNPROVEN`),
  immutable owner-fenced captures with signed cursors and coverage-gap
  labels, `START_NEW_WITH_QUOTE` fresh-task creation with lineage,
  `FORK_CONVERSATION` refusing `FORK_UNSUPPORTED` with no partial state.
- `packages/core/service.ts` — `session.branch` and
  `historyImport.stage|commit|cancel` dispatch; side threads blocked;
  capability flags gate every mutation with `CAPABILITY_DENIED`.
- `packages/core/capability-flags.ts` — host-owned
  `sessions.branchV1`, `sessions.inertImportV1`, both default false.
- `apps/server/session-branch-routes.ts` + `server.ts` — owner-bound
  `Cache-Control: no-store` read routes and overview augmentation.
- `apps/web/src/` — `session-branch-api.ts`, `SessionBranchMenu.tsx`,
  `session-branch.css`, `App.tsx` wiring: Inspect point, quoted-context
  task, visibly-unavailable native fork, ArchiveV1 import with preview,
  lineage display. All labelled historical/inert; nothing is presented
  as continuation or native transcript.
- `scripts/public-source-files.json` — all new sources, tests and
  evidence enrolled.
- Tests: `tests/session-branch-v3.test.ts` (10),
  `tests/history-import-v3.test.ts` (12),
  `tests/history-import-decisions-v6.test.ts` (11) — 33/33 pass.

## Tested gates (receipts in `docs/implementation/v3/m14/logs/v6-*.log`)

- Targeted M14 suites: 33/33 PASS.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, prerequisite
  credential-lease/widget builds: PASS.
- `tests/public-source.test.ts`: 11/11 PASS after manifest enrollment.
- Consumed contracts on the merged tree: 8/9 files PASS;
  `tests/capabilities.test.ts` fails 13 on `linux-path-guard` — the
  custody broker is x86_64-pinned and cannot launch on this aarch64 host.
  Environmental, matches the audited baseline class.
- `pnpm test` (final receipt): 3845 passed / 298 failed / 58 skipped,
  45 of 382 files failing in 918s. The `pnpm-workspace.yaml` environment
  fix (node-pty build + win32 optional SDKs) cleared 21 previously-
  failing files vs the audited 66. Remaining failures are the
  x86_64-pinned custody broker (~40 files), win32-only packaged natives
  (rg.exe/.node), bundled-python absence and contention timeouts. No
  M14-caused failure.

## Untested / blocked gates

- `pnpm test:browser`: now executes real specs (28 passed across
  projects) after the pty fix. Remaining failures are environmental:
  `browser-action`/`ui-shell-overlays` need `/opt/google/chrome` and
  `/opt/microsoft/msedge` — neither exists for aarch64 Linux — plus
  foreign `/tmp` EACCES artifacts. Orphaned dev servers that caused the
  earlier port conflicts were cleaned up.
- Windows/installed desktop matrix: NOT_RUN — no Windows host exists
  here; the platform claim is explicitly not made.
- `linux-path-guard` custody class: NOT_RUN — the broker requires an
  x86_64 kernel, real-root euid and ext4 backing; aarch64 cannot launch
  it. `hermes-python/bin/python3.14` is also a CI-packaging artifact not
  present in this checkout.
- Live UI acceptance: source-bound only (typecheck/lint/build/unit
  dispatch); no live browser proof of `SessionBranchMenu`.

## Windows x64 continuation (receipts in `win-*.log`)

Executed on Windows Server 2025 x64 (node v24.22.2, pnpm 10.30.3,
CPython 3.14.9 at `C:\Python314`, Edge 157, WSL2 Ubuntu x86_64 for the
custody class) from worktree `C:\Users\Administrator\repos\gen-v1-m14`
on `agent/m14-v3` at `30b5d649`.

- Gates: `pnpm typecheck` / `lint` / `build` PASS; consumed contract
  suites 9/9 files 147 tests PASS (capabilities included — the Windows
  path guard satisfies the custody class).
- X1 custody: all 4 `linux-path-guard` fixture probes PASS under WSL2
  (x86_64 + euid 0 + ext4 state-root owned by a third uid) —
  idmapped custody, credential-alias qualification, negative control,
  nested account profile. The aarch64 arch pin does not apply.
- X1 custody, vitest level: first real broker-wrapped vitest run —
  the test process is itself spawned as a broker child (fd3 socket +
  fd4 root dir) inside `/custody2`, a repo copy owned by a third uid.
  `linux-path-guard.test.ts` 23/23 and `memory-storage-boundary-v3.test.ts`
  9/9 PASS under live custody. `capabilities.test.ts`: 11/24 pass; the
  13 failures all request `readOnly`/`tree`/`leaf`/`empty`/
  `gitMetadataImport` grants that `validateLinuxDirectoryPaths` denies
  by contract while the Windows path guard admits them — a guard-contract
  asymmetry surfaced for the orchestrator, not relaxed to pass
  (`win-x1-wsl-vitest-broker.log`).
- W1 packaged tests: 27/27 PASS (packaged-providers/rg.exe,
  desktop-packaging, cursor-offline-executor, cursor-sdk-mcp-metadata).
- W4 hermes bundle: CPython 3.14.9 provisioned via nuget; `py -3.14`
  fixed through the legacy-launcher `ExecutablePath` registry value;
  bundle materialized inside `desktop:package`.
- `pnpm test`: 4086 passed / 67 failed / 48 skipped (23 of 382 files,
  1162s) — vs 298 failed on aarch64. Python provisioning cleared all 24
  integration/hermes failures. Quiet rerun of the residual set: 29 fail
  / 127 pass, dominated by windows-path-guard acquire latency
  (powershell+Add-Type ~5–15s per acquire vs the 60s test timeout) and
  integration-mcp environment gaps. No M14-caused failure.
- W2 `pnpm test:browser` (real Edge): 35 of 76 suites failed in the
  loaded run and all 35 fail again in a quiet serial rerun — 417 test
  failures plus 6 suites whose `config.webServer` uses the Unix
  `exec timeout` convention. Those 6 were unblocked via the
  `GEN_WO5_SERVER_EXTERNAL=1` escape hatch plus a per-suite vite on
  its pinned port: file-checkpoints 21/21, terminal-excerpts 9/9 and
  project-search 38/38 PASS; conversation-find 1/11, redundant-ui 7/18
  and wo5-app-integration 0/9 FAIL
  (`win-test-browser-dead-suites.log`). Largest clusters: shell 63,
  files-reading 46, generated-selects 42. No M14 surface implicated.
- W3 desktop: `desktop:build` + `desktop:package` PASS —
  `Gen-V1-Setup-0.6.5-win-x64.exe` produced. `verify-installed-desktop`
  runs the whole owned matrix (NSIS install, payload custody, provider
  verification, installed launches, memory proposal review) and fails
  only at the project-memory native-save export: the UIA worker
  completes the real Save-As dialog (file-name-set, save-invoked,
  dialog-closed at 8.4s) but no file is written and Electron's
  DownloadItem `done` resolves interrupted, so the app's custody
  check rejects it ("the native save was interrupted or its byte
  count changed"). Root cause: the UIA-invoked IFileSaveDialog
  result never reaches the download item as a committed path —
  a harness/app save-handoff issue, not M14 code. Deterministic
  across two runs including a quiet-box retry.

## Holds

- `HOLD_NATIVE_FORK` — no `RuntimeAdapter` implementation exposes a
  tested fork API; `RuntimeAdapter.history` returns receipt IDs only.
  `FORK_CONVERSATION` stays `FORK_UNSUPPORTED`.
- `HOLD_EXTERNAL_FORMAT` — only strict ArchiveV1 JSON is admitted;
  ZIP/gzip/binary payloads reject `UNSUPPORTED_IMPORT_FORMAT` pending a
  pinned parser/license/dependency manifest.
- `HOLD_IMMUTABLE_SOURCE` — projected UI messages are not a native
  transcript; Inspect captures a host-copied fixed cut.

## Evidence

- `docs/implementation/v3/M14-verification.json` — V3 schema bundle;
  `reviewerApproval: false`, both flags reported disabled.
- `docs/implementation/v6/M14/source-lock.json` — inspected blobs at the
  implementation base.
- `docs/implementation/v6/M14/requirements.json` — C/S/U/T/G + D01–D05
  dispositions.
- `docs/implementation/v6/M14/verify-evidence.mjs` — passes: schema, lock
  digest, contract blobs, flags, holds and bounded log digests all
  verified.

## Activation and rollback

Both flags remain default-off; disabling creation/import preserves
already-committed captures, lineage and import receipts (read paths stay
available under owner fencing). LOCAL_ONLY — no push or remote merge was
performed or authorized.
