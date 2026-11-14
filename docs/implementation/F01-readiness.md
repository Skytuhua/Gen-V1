# F01 readiness baseline

Work order WO-F01, attempt 1. Reproducible readiness and evidence baseline for the
current Gen-V1 HEAD. Tooling only: no application behavior changes. The frozen
ticket is `ledger/WO-F01/spec-owner.md` (steps 1-6, acceptance 1-5).

## Environment capture

Recorded by the worker in the worktree on 2026-11-14 (UTC), not transcribed from
the brief.

| Fact | Value |
| --- | --- |
| Worktree | `/var/lib/openbot/OpenBot/Shared/Work/Gen-V1-F01` |
| Branch | `agent/f01-implementation` |
| Base HEAD SHA | `175e3fa03b453dde7d1c815d59df1f0554fbd626` |
| origin/main at fetch | `175e3fa03b453dde7d1c815d59df1f0554fbd626` (matches base) |
| Package version | `0.6.5` (`gen-v1`, private) |
| Node | `v26.13.1` (satisfies `engines.node >=24.10.0`) |
| pnpm | `10.30.3` (matches `packageManager pnpm@10.30.3`) |
| pnpm binary | standalone ELF at `Shared/Tools/npm/bin/pnpm`, symlinked from `~/.local/bin/pnpm` |
| corepack | NOT installed globally; `command -v corepack` finds nothing |
| corepack workaround | `npx --yes corepack@0.36.0 pnpm ...` (owner-approved, decisions.md 11:05 UTC); corepack 0.36.0 resolves pnpm 10.30.3 |
| OS | Ubuntu 24.04.5 LTS, Linux kernel `6.8.0-1068-raspi`, `aarch64` |
| Windows environment | none available on this host |
| AGENTS.md | absent at repo root on current main (checked 2026-11-14) |

Resolved runtime and tooling versions (from `pnpm install --frozen-lockfile` and
`pnpm list --depth 0`): typescript 5.9.3, vitest 4.1.12, tsx 4.20.6, esbuild
0.25.12, vite 7.3.7, electron 45.2.0, electron-builder 26.18.0,
@playwright/test 1.56.1 (chromium build 1194), node-pty 1.1.0 (patched via
`patches/node-pty-1.1.0.patch`).

Native build scripts: `pnpm-workspace.yaml` sets
`onlyBuiltDependencies: [electron, esbuild]`. pnpm 10.30.3 therefore ignores
build scripts for node-pty, keytar, protobufjs and others by repository design;
this is the frozen setup, not a worker substitution.

Base SHA note: the brief cited `2186cb63` (10:55 UTC snapshot). origin/main
advanced to `175e3fa0` before the worktree was created; the supervisor created
the branch from the fetched HEAD and the worker re-verified it. `175e3fa0` is
the actual base recorded here and in every manifest.

The stale main clone `Shared/Work/Gen-V1-pr-fix` (da1c3a6) was left untouched.

## Setup commands (actual)

| Started (UTC) | Ended (UTC) | Command | Exit |
| --- | --- | --- | --- |
| 2026-11-14 ~11:22 | 2026-11-14 ~11:22 | `pnpm install --frozen-lockfile` | 0 (22.8s, warm store) |
| 2026-11-14T11:30:44Z | 2026-11-14T11:30:50Z | `npx --yes corepack@0.36.0 pnpm --version` | 0 (prints 10.30.3) |

Playwright chromium setup (required by `docs/getting-started.md` for the
browser suites), honest sequence:

1. 11:26 UTC: `pnpm exec playwright install chromium` started in background.
   Downloaded 100% of the 175.9 MiB chromium-1194 arm64 archive. The worker
   killed the process during extraction while misdiagnosing a stall (operator
   error; the download was in a temp file, not the target directory). Exit 143.
2. 11:39:04 UTC: retry in foreground. Downloaded 100% again; the foreground
   command received an external SIGTERM at ~11:52 UTC before extraction
   (this harness caps long foreground commands). Exit 143.
3. ~11:53 UTC: both leftover archives in `/tmp/playwright-download-*` were
   complete and passed zip integrity checks (184,483,730 bytes, 474 entries
   each). The worker extracted the verified archive into
   `~/.cache/ms-playwright/chromium-1194/` preserving permissions and wrote the
   `INSTALLATION_COMPLETE` marker.
4. ~11:54 UTC: smoke test `chromium.launch({headless:true})` + page render
   printed `LAUNCH_OK f01`, exit 0. The browser prerequisite is genuinely met.

`pnpm exec playwright install chromium` itself never exited 0 on this host; the
browser was installed from its own verified downloaded archive. Recorded as a
limitation, not as a clean install PASS.

## Runner and manifest

`scripts/verify-readiness.ts` runs each check as a child process with
`shell:false`, explicit cwd (the worktree root), an allowlisted child
environment (no tokens or ambient secrets), and a bounded timeout per check.
Timeouts kill the whole process group and remain bounded even if the child
ignores the kill. Statuses: PASS, FAIL, SKIP, BLOCKED.

- exit 0 -> PASS; nonzero exit -> FAIL (`nonzero-exit`); signal death -> FAIL
  (`signal`).
- missing binary (spawn ENOENT with valid cwd) -> BLOCKED (`missing-binary`).
- invalid cwd -> FAIL (`bad-cwd`) without spawning.
- timeout -> FAIL (`timeout`), never hangs.
- missing Chromium executable -> `test:browser` BLOCKED
  (`missing-browser-prerequisite`) without running the suite.
- packaged Windows verification off Windows -> BLOCKED (`platform-unavailable`)
  with the exact Windows commands recorded.
- aggregate PASS only when every required check ran and passed; any required
  SKIP/BLOCKED/FAIL/unrun forces aggregate FAIL and a nonzero runner exit.

Each run writes `test-results/readiness/run-<epoch>-<uuid>/manifest.json` keyed
by repository SHA, platform, run id, and per check: command, args, cwd,
startedAt, endedAt, durationMs, exitCode, signal, status, errorKind, artifact
path. Logs are captured per check with line-buffered secret redaction (bearer
tokens, key/value secrets, URL passwords, private keys). No environment dump is
written anywhere. `test-results/` is gitignored; the baseline manifest is
copied to the work-order ledger for permanence.

## Execution evidence

All runs on Linux aarch64 (Ubuntu 24.04.5 LTS), worktree
`/var/lib/openbot/OpenBot/Shared/Work/Gen-V1-F01`, base SHA
`175e3fa03b453dde7d1c815d59df1f0554fbd626`. Timestamps UTC. Durations from the
manifest (millisecond precision) or wall-clock timestamps (second precision
where noted). Full logs are in the artifact paths listed below.

### Baseline runner (pinned pnpm forms as child processes)

Command: `pnpm exec tsx scripts/verify-readiness.ts`
Started 2026-11-14T11:54:36Z, ended 2026-11-14T12:02:14Z, runner exit 1,
aggregate FAIL. Run id `run-1794657277238-5bf218c5-2143-4355-be1b-470978a87274`.

| Check | Command | Status | Exit | startedAt | endedAt | Duration |
| --- | --- | --- | --- | --- | --- | --- |
| typecheck | `pnpm typecheck` | PASS | 0 | 11:54:37.242Z | 11:55:44.739Z | 67497ms |
| test | `pnpm test` | FAIL | 1 | 11:55:44.739Z | 12:01:34.757Z | 350018ms |
| build | `pnpm build` | PASS | 0 | 12:01:34.758Z | 12:01:59.188Z | 24430ms |
| test:browser | `pnpm test:browser` | FAIL | 1 | 12:01:59.979Z | 12:02:12.624Z | 12645ms |
| eval | `pnpm eval --out <run>/eval` | FAIL | 2 | 12:02:12.625Z | 12:02:13.910Z | 1285ms |
| windows-packaged-verification | `pnpm desktop:package` (not run) | BLOCKED | null | 12:02:13.912Z | 12:02:13.912Z | 0ms |

Artifacts (worktree, gitignored):
`test-results/readiness/run-1794657277238-5bf218c5-2143-4355-be1b-470978a87274/`
contains `manifest.json`, `typecheck.log`, `test.log`, `build.log`,
`test-browser.log`, `eval.log`, `eval/frozen-cases.json`, `eval/results.json`.
Permanent copies:
`/var/lib/openbot/OpenBot/Shared/Gen-V1/ledger/WO-F01/artifacts/baseline-run-1794657277238/`
(manifest consolidated with the corepack forms below, plus
`failed-test-files.txt`).

### Pinned pnpm direct forms

| Command | Exit | Started | Ended | Log |
| --- | --- | --- | --- | --- |
| `pnpm typecheck` | 0 | 2026-11-14T11:35:20Z | 2026-11-14T11:36:26Z | ledger `artifacts/corepack-forms/f01-pinned-typecheck.log` |
| `pnpm build` | 0 | 2026-11-14T11:36:43Z | 2026-11-14T11:37:07Z | ledger `artifacts/corepack-forms/f01-pinned-build.log` |

`pnpm test`, `pnpm test:browser` and `pnpm eval` pinned forms ran as the
runner's child processes (table above); the manifest records command `pnpm`
with the exact args, exits and timestamps.

### Corepack workaround forms (owner-approved, decisions.md 11:05 UTC)

corepack is not installed globally. Every corepack-form command ran as
`npx --yes corepack@0.36.0 pnpm <script>`; corepack 0.36.0 resolves pnpm
10.30.3 (verified: `npx --yes corepack@0.36.0 pnpm --version` printed 10.30.3,
exit 0, 11:30:44Z to 11:30:50Z). Logs:
`/var/lib/openbot/OpenBot/Shared/Gen-V1/ledger/WO-F01/artifacts/corepack-forms/`.

| Command | Exit | Started | Ended | Log |
| --- | --- | --- | --- | --- |
| `npx --yes corepack@0.36.0 pnpm typecheck` | 0 | 2026-11-14T11:34:02Z | 2026-11-14T11:35:10Z | `f01-corepack-typecheck.log` |
| `npx --yes corepack@0.36.0 pnpm test` | 1 | 2026-11-14T12:03:19Z | 2026-11-14T12:09:51Z | `f01-corepack-test.log` |
| `npx --yes corepack@0.36.0 pnpm build` | 0 | 2026-11-14T11:37:18Z | 2026-11-14T11:37:46Z | `f01-corepack-build.log` |
| `npx --yes corepack@0.36.0 pnpm test:browser` | 1 | 2026-11-14T12:09:59Z | 2026-11-14T12:10:12Z | `f01-corepack-test-browser.log` |

### Suite results and root causes (honest current-HEAD state)

`pnpm test` (vitest, 286 test files): FAIL on Linux aarch64 in both forms.

- Runner form: 58 files failed, 225 passed, 3 skipped; 216 tests failed,
  2574 passed, 44 skipped; 4 unhandled errors; 346.18s.
- Corepack form: 59 files failed, 224 passed, 3 skipped; 217 tests failed,
  2573 passed, 44 skipped; 4 unhandled errors; 382.63s.

These are pre-existing current-HEAD failures on this platform, not caused by
this tooling: the new `tests/readiness-manifest.test.ts` passed 15/15 inside
the runner's full suite (788ms) and in a fresh targeted re-run
(2026-11-14T12:11:18Z to 12:11:20Z, exit 0). The failed-file list (58 names) is
`failed-test-files.txt` in the ledger artifacts. Representative root causes
from `test.log`: `HarnessError CAPABILITY_DENIED: Cannot establish a stable
ordinary filesystem resource guard` (`packages/core/linux-path-guard.ts:11`,
hit by account-login and github-workspace tests), plus github-workspace,
account-parity, capabilities, hermes-client and cursor suites failing on this
platform. The one-file difference between the two runs is run-to-run variance
in the pre-existing failures; both runs are FAIL and neither is hidden. No
test was weakened, skipped or deleted.

`pnpm test:browser`: FAIL exit 1 in both forms (~12s). Root cause: the root
Playwright suite's fixture host imports node-pty, and the native module
`pty.node` is missing for linux-arm64 (`Failed to load native module: pty.node,
checked: build/Release, build/Debug, prebuilds/linux-arm64`). The repository's
frozen `pnpm-workspace.yaml` allows build scripts for electron and esbuild
only, so node-pty is not compiled on this platform. This is a failed native
prerequisite, recorded as FAIL, never PASS. Chromium itself is installed and
launches (headless smoke test `LAUNCH_OK f01`, exit 0); the blocker is
node-pty, not the browser. Fixing it would require changing the frozen build
allowlist, which is out of scope for this work order.

`pnpm eval --out <new-dir>`: FAIL exit 2, by design the honest pending mode.
Without `--host` and `--model` the runner writes `frozen-cases.json` and
`results.json` with `status: "pending"`, `aggregate: null`, all gates pending,
and exits 2. A live authenticated local host and model are a separate gate;
no eval PASS is claimed. Artifacts: `<run>/eval/` (copied to the ledger).

`windows-packaged-verification`: BLOCKED (`platform-unavailable`), see below.

Aggregate: FAIL. Runner exit 1. No required suite passed fully, so no
aggregate PASS is reported anywhere (acceptance 3).

### Negative-test results

15/15 passed (RED observed first on the missing module, then GREEN). Fresh
re-run 2026-11-14T12:11:18Z to 12:11:20Z: `Test Files 1 passed (1)`,
`Tests 15 passed (15)`, exit 0. Per-case expectations and reproduction
commands are in the Negative tests section above.

## Negative tests

`tests/readiness-manifest.test.ts`, 15 cases, all real child processes or real
gating functions (no mocks). TDD: the file was written first and observed
failing on the missing runner module (RED), then the runner was implemented and
the suite passed (GREEN).

| Case | Expected | Reproduce |
| --- | --- | --- |
| zero exit | PASS, exitCode 0, timestamps, log artifact | `pnpm exec vitest run tests/readiness-manifest.test.ts -t 'zero exit'` |
| deliberately failing command | FAIL, exitCode 3, `nonzero-exit` | `... -t 'deliberately failing'` |
| missing binary | BLOCKED, `missing-binary`, exitCode null | `... -t 'missing binary'` |
| timeout | FAIL, `timeout`, resolves <10s, child killed | `... -t 'timeout yields'` |
| bad cwd | FAIL, `bad-cwd`, no spawn, no artifact | `... -t 'bad cwd'` |
| log capture | child stdout present in log artifact | `... -t 'child output is captured'` |
| omitted browser prerequisites | BLOCKED, `missing-browser-prerequisite`, suite not run | `... -t 'omitted browser'` |
| present browser executable | gate ok | `... -t 'present browser'` |
| Windows verification off Windows | BLOCKED, `platform-unavailable`, exact commands recorded | `... -t 'packaged Windows verification is BLOCKED'` |
| Windows verification on win32 | runnable plan, 2 commands | `... -t 'runnable on Windows'` |
| aggregate contract | PASS only if all required ran and passed; SKIP/BLOCKED/FAIL/missing required -> FAIL | `... -t 'aggregate PASS requires'` |
| manifest keys | SHA, platform, command, timestamps, exitCode, errorKind, artifact | `... -t 'manifest is keyed'` |
| credential hygiene | canary secret absent from child env, log and manifest; no env dump | `... -t 'no credentials'` |
| redaction patterns | bearer/key-value/URL-password/private-key redacted; plain text unchanged | `... -t 'redactSecrets removes'` |
| split-chunk redaction | secret split across stream chunks still redacted | `... -t 'split across stream chunks'` |

Full suite: `pnpm exec vitest run tests/readiness-manifest.test.ts`.

## Windows packaged verification: BLOCKED

BLOCKED - needs a Windows machine to run it. This host is Linux aarch64; no
Windows environment exists here. Never PASS, never SKIP-as-PASS. Both scripts
refuse non-Windows platforms (`scripts/package-desktop.ts` line 12,
`scripts/verify-installed-desktop.ts` registry/NSIS logic).

Exact commands that would run on Windows x64 (version 0.6.5), after preparing
the documented runtime inputs (`.harness-hermes-python-deps/`,
`.harness-integrations-python-deps/`, `.harness-tool-bundles/{git,gh}/` per
`docs/getting-started.md`):

```powershell
pnpm desktop:package
pnpm exec tsx scripts/verify-installed-desktop.ts "<repo>\dist\desktop-release-0.6.5\Gen-V1-Setup-0.6.5-win-x64.exe" "<repo>\dist\desktop-release-0.6.5\win-unpacked"
```

No Windows release readiness is asserted (spec step 6).

## Limitations

- corepack is not installed globally. All corepack-form commands ran as
  `npx --yes corepack@0.36.0 pnpm <script>` (owner-approved workaround,
  decisions.md 11:05 UTC). Both the pinned `pnpm` form and the workaround form
  are recorded with exits; neither is a silent substitution.
- Windows packaged verification is BLOCKED (above).
- `pnpm eval` ran in its honest pending mode (`--out` only, no `--host` /
  `--model`): the runner writes a pending manifest and exits 2. A live
  authenticated host and model are a separate gate; no eval PASS is claimed.
- Playwright chromium was installed from the verified downloaded archive after
  two interrupted install attempts (above), not via a clean exit-0 install.
- `pnpm test` fails on current-HEAD Linux aarch64: 216-217 pre-existing test
  failures across 58-59 files (variance between runs), including
  linux-path-guard CAPABILITY_DENIED errors. Recorded as FAIL; no test was
  weakened, skipped or deleted. The new readiness tests pass 15/15.
- `pnpm test:browser` fails on the node-pty native prerequisite (`pty.node`
  missing for linux-arm64 under the frozen build allowlist). Recorded as FAIL.
- `pnpm eval` exits 2 in honest pending mode (no live host/model). No eval
  PASS is claimed.
- Approval discrepancy: decisions.md 11:08/11:31 UTC records owner approval for
  push + draft PR with Windows BLOCKED. The binding worker handoff for this
  attempt says LOCAL commits only, no push/PR (scope being re-confirmed with
  EM). The worker followed the binding handoff: nothing was pushed.

## Acceptance verification (spec Pass/fail 1-5)

1. Clean run writes a uniquely identified report for the current SHA with
   actual command exits: the runner wrote
   `test-results/readiness/run-1794657277238-5bf218c5-2143-4355-be1b-470978a87274/manifest.json`,
   keyed by SHA `175e3fa03b453dde7d1c815d59df1f0554fbd626`, platform
   `linux-arm64`, unique run id, per-check command/startedAt/endedAt/exitCode/
   errorKind/artifact. Exits are captured from the child processes, not
   transcribed.
2. Failing command -> FAIL, missing tool -> BLOCKED, timeout -> FAIL without
   hanging: proven by the negative tests (cases 2, 3, 4 in the table), all
   passing against real child processes.
3. No successful aggregate when a required suite failed/skipped/not run:
   aggregate is FAIL and the runner exited 1; `aggregateStatus` returns PASS
   only when every required check ran and passed (unit-tested both ways).
4. No credentials in any report: child environment is allowlisted (canary
   secret test proves absent from child env, log and manifest); logs are
   line-buffered redacted; the manifest contains no env dump. A scan of the
   consolidated manifest for ambient environment values found no matches.
5. Existing application code unchanged: `git status` shows only the three new
   files (`scripts/verify-readiness.ts`, `tests/readiness-manifest.test.ts`,
   `docs/implementation/F01-readiness.md`); `git diff --stat` against the base
   SHA is empty for tracked files. Runtime artifacts live under gitignored
   `test-results/`.

## Revert

All changes are additive files on `agent/f01-implementation`; no application
code, lockfile or configuration was modified. Nothing was pushed.

```bash
# from the main clone, after switching away from the branch:
git worktree remove /var/lib/openbot/OpenBot/Shared/Work/Gen-V1-F01
git branch -D agent/f01-implementation
# runtime artifacts (gitignored, optional):
rm -rf /var/lib/openbot/OpenBot/Shared/Work/Gen-V1-F01/test-results/readiness
```

If the branch is kept and only the commits should be undone:
`git revert <commit-sha>` on the branch, or `git reset --hard 175e3fa0` before
any further work (local only).
