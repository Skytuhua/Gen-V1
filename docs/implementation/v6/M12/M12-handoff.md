# M12 v6 terminal handoff: bounded program lane, R02-tested cut + R03 integration

## Result

**Tested cut `e816a081` (round-2 merge `0548ebc5` + verification fixes `9cfbfd3f`, `e816a081`): verification outcome PARTIAL — focused M12 suites and three of five full gates pass; the full suite remains FAIL on this host, dominated by failures that reproduce identically on unmodified main `4aef753e`; `pnpm test:browser` terminated FAIL at the evidence-runner 4h bound; plus platform holds that no Linux host can certify. Round-3 integration `2e949a66` (e816a081 + main `ff38c62c`) is separately verified by scoped smoke bound to `fd871d72` under `logs/r03/`. All M12 flags remain default-off; `reviewerApproval` is false; this is not a production-readiness claim.**

The M12 bounded execution/program lane (QuickJS-WASM JavaScript programs, Python kernel surface, nested-call receipts, deterministic journal/replay, durable effects, private result handles, continuation lifecycle) is present on the branch and covered by the M12 suites listed below. The branch additionally carries every `main` feature through `4aef753e`, including request custody, project memory/context, progressive context tooling, M15/M16 flags, native compaction protections and lifecycle controls — composed semantically, never by blanket ours/theirs resolution.

The machine-readable record is [M12-verification.json](M12-verification.json) (`ImplementationEvidenceV3`), built only from bounded receipts under [logs/](logs/). [M12-source-lock.json](M12-source-lock.json) pins the inspected surface. [merge-resolution.json](merge-resolution.json) records every conflict path with base/ours/theirs/result blob identities and the post-merge join adaptations. Historical evidence under `docs/implementation/v3/` is preserved untouched and is not relabeled as proof for this tree.

## Source custody

| Item | Recorded value |
| --- | --- |
| Repository | `https://github.com/skytuhua-org/Gen-V1.git` (`skytuhua-org/Gen-V1`) |
| Branch | `agent/m12-v3` (PR [#355](https://github.com/skytuhua-org/Gen-V1/pull/355)) |
| Isolated worktree | `<worktree:m12-v6>` — original checkout and other worktrees untouched |
| Preserved task head | `f04cb74eff8d36a7ebcbfb51ca43c6e30ff23ffc` |
| Merge base / merged main | `1c09d492278b1014bc3ab5455191b1f5913c96d8` / `4aef753ec272d6ab9f9f9eec1df0ca232386975b` |
| Round-2 merge commit | `0548ebc51ea9f8b55a6bd2b68b7d711cc8d32a19` (`git merge --no-commit --no-ff`, 14 conflict paths composed semantically) |
| Round-1 merge (preserved) | `44c19075a3341f85a0f6c2c8e8455f2f70a970df` against main `1c09d49` |
| Platform | linux-arm64, Node `v24.11.1`, pnpm `10.30.3` (`<toolchain>`) |

## Gate results on the merged tree

Receipts are in `logs/`; each `*.receipt.json` binds argv, cwd, exit code, termination and the sha256 of its bounded log.

| Gate | Receipt | Outcome |
| --- | --- | --- |
| `pnpm exec vitest run tests/tool-program-v3.test.ts` | `vitest-tool-program-v3` | **PASS 22/22** — includes the required M12-S03 default-limit boundary (64 admitted / 65th denied, `maxCalls` 64, `maxConcurrentCalls` 4, 30s deadline). An earlier run under load-average >20 recorded `PROGRAM_DEADLINE` on the two 64-call cases; preserved as `vitest-tool-program-v3-run1-loaded.*`. Coverage was not reduced and production limits were not changed. |
| `pnpm exec vitest run tests/tool-program-replay-v3.test.ts` | `vitest-replay-v3` | **PASS 33/33** |
| `pnpm exec vitest run tests/python-kernel-v3.test.ts` | `vitest-python-kernel-v3` | **PASS 21/21** |
| `pnpm exec vitest run tests/tool-program-continuation-v6.test.ts` | `vitest-continuation-v6` | **PASS 7/7** (D01–D05) |
| `pnpm typecheck` | `typecheck` | **PASS** (retried at 6 GiB heap after the default 2 GiB OOM'd on the merged tree) |
| `pnpm lint` | `lint` | **PASS** — 631 sources, 0 violations |
| `pnpm build` | `build` | **PASS** |
| `pnpm test` | `test` | **FAIL** — see failure classification below |
| `pnpm test:browser` | `test-browser` | **FAIL (TIMEOUT)** — killed at the evidence-runner 4h bound after ~30/~68 suite configs on this shared box; executed suites recorded real contention failures (e.g. `clarity-software` 33 failed / 1 passed, `toBeVisible` timeouts); chrome-channel suites cannot pass here (`/opt/google/chrome/chrome` absent). Browser coverage not established. |

## `pnpm test` failure classification

A same-base control run of the full suite on unmodified main `4aef753e` (the `gv1-m10-v6-pmcheck` clean worktree on this same host) failed 59 test files — confined-directory-guard paths requiring the privileged CAP_SYS_ADMIN broker absent on this host, plus desktop/server/service timing suites under the same load. Non-M12 failures on the merged tree match that control set: inherited/environmental, not a merge regression.

Merge-attributable failures found and fixed (verified standalone after fix):

- `tool-program-integration-v3` (5 tests) — the fixture enabled `audit.effectsV1`/`security.authorityV1` without injecting `toolEffectAuthenticator`; the flagged ledger rejects admission with `EFFECT_KEY_UNAVAILABLE` by design (production injects OS-key custody). Now wired to `testEffectAuthenticator()`: 6/6 PASS.
- `tool-program-recovery-v3` (7 tests) — the reopening Service lacked the producing deployment's effect custody, so `programs.recover()` commitment-matching never bound parent effects and generic recovery rolled them back. Service now keeps `audit.effectsV1` + the deterministic fixture key; the "default-off" under test remains the M12 program lane. Unlinked M02 receipts now assert the merged generic recovery semantic (reconciled to `UNKNOWN_EXTERNAL_OUTCOME`, retained, never executed): 15/15 PASS.
- `python-program-integration-v3` — same custody gap, latent because the file is x64-gated and skips on this arm64 host; fixed for its real target.

Load-only failures observed under the shared box (each passes standalone): `tool-program-backend-v3` delivery-concurrency peak (47/47 with replay-v3 on rerun), `tool-program-replay-v3` single deadline case, `tool-program-v3` 64-call boundary (22/22 on the receipted retry). The pre-fix full-run receipt is preserved as `test-run1-prefix-fixes.receipt.json`.

## R03 integration (separately bound — not evidence for `e816a081`)

Main moved to `ff38c62c` while the frozen cut was under test. The R03 merge was composed in-memory (`git merge-tree` + plumbing; zero writes to the frozen worktree) and pushed as `2e949a66`, resolving the PR's only conflict (`scripts/public-source-files.json`: sorted union of ours' 43 M12 entries + theirs' 5 new entries; base `6c09647` / ours `db479e1` / theirs `19c6aab` / result `8b990c8` — recorded under `r03` in `merge-resolution.json`).

Scoped smoke on the merged tree `2e949a66` (separate worktree `<worktree:m12-r03>`, receipts committed at `fd871d72` under `logs/r03/`): typecheck PASS (retry; first attempt V8-heap OOM under load) + 7 focused M12 vitest suites PASS, including the default 64/65 boundary. First-attempt failures are preserved and classified (heap OOM, fresh-worktree prerequisites — `build:widgets`, node-pty linux-arm64 — and two 15s-bound cases that passed on calmer rerun). This is scoped smoke only, not a full gate; the full/browser gates remain bound to `e816a081`.

Current `origin/main` is now `153cb47a` (post-R03 drift); in-memory `merge-tree` of `fd871d72` × `153cb47a` produces zero conflicts — recorded, not integrated (no merge or flags in this handoff).

## R04 integration and qualification avenues (cut `4df19a1c` + records `d9bc6df0`)

Main moved to `89142de9`; `merge-tree` confirmed the sole conflict was again `scripts/public-source-files.json`. Resolved in `4df19a1c` as the same semantic union — current main's manifest preserved plus only the 43 M12-owned entries (theirs added `tests/integration-error-stack-redaction-v3.test.ts`; runtime keeps ours' 17 M12 modules). Blobs base `19c6aab` / ours `8b990c8` / theirs `331f455` / result `bfe438c5` — recorded under `r04` in `merge-resolution.json`.

Gates run on the integrated cut `d9bc6df0` (receipts under `logs/r04/`, bounded: single worker + capped heap; earlier-cut receipts stay bound to their cuts):

- `tests/public-source.test.ts`: **PASS 13/13** — manifest closure valid at the integrated cut.
- `tests/tool-program-v3.test.ts` (earliest missing scoped product gate): **PASS 22/22** on bounded retry (64.9s at load ~9) including the default `maxCalls` 64/65 boundary; the run1 receipt (77.3s vs 30s deadline at load ~17 → `PROGRAM_DEADLINE`) is preserved as `vitest-tool-program-v3-run1.*` — same wall-clock class as the `e816a081` loaded receipt, coverage not reduced.
- Remaining focused M12 suites at this cut: **all PASS** — backend-v3 14/14, integration-v3 6/6, recovery-v3 15/15, replay-v3 33/33, python-kernel-v3 21/21, continuation-v6 7/7 (D01–D05).
- `pnpm typecheck` at this cut: **PASS** (0 errors, 3 GiB heap cap — receipt `logs/r04/typecheck.receipt.json`).

Not run at this cut: `pnpm lint`, `pnpm test` (full), `pnpm build`, `pnpm test:browser` — full-gate evidence remains bound to `e816a081` and is not re-claimed here.

**Hard platform bounds — checked avenues and exact prerequisites (none waived):**

- **Linux x64 Python confinement** (`python-program-backend-v3`, `python-program-integration-v3`, `python-confinement.py`): requires Linux x86_64 + the pinned **bubblewrap** mount-namespace launcher + seccomp filter install. Tests hard-gate on `process.platform==='linux' && process.arch==='x64'`. No Linux lane exists in CI (all matrix jobs are `windows-latest`); avenues are an external linux-x64 host or a new `ubuntu-latest` workflow — outside this scoped PR. Emulated x64 (qemu-user) would not be honest proof and was not attempted.
- **Confined-directory guard / CAP_SYS_ADMIN cluster** (drives most non-M12 full-suite failures, also on clean main): `linux-path-guard.py` requires root/CAP_SYS_ADMIN or a trusted-parent `CLONE_NEWUSER` broker for private-mount bind pinning. This arm64 box lacks that broker.
- **Windows installed-desktop proof**: supported avenue exists — repo CI matrix lanes are `windows-latest` but gated `if: pull_request.draft == false` (they run at ready-for-review by design; draft pushes intentionally run no matrix). Converting the draft is a reviewer/manager decision, not taken here. A linked Windows environment (`WIN-M0N0V07LGM1`, reachable, full-access) is an additional avenue for qualification runs; prerequisites there: repo checkout + Node/pnpm toolchain + the Windows-gated suites and installed-desktop proof flow.
- **Browser gate**: needs `/opt/google/chrome` (channel) or substantially more wall-clock; this host lacks the channel and the 4h bound expired mid-run.

## Platform holds (unprovable here — NOT_RUN, not waived)

- Linux-x64-only Python confinement suites (`python-program-backend-v3`, `python-program-integration-v3`) gate on `process.arch` x64 and skip on aarch64; linux-x64 evidence remains historical only.
- No whole-process-tree memory bound: only the 128 MiB guest WASM linear-memory bound is proved (`memoryScope: GUEST_WASM_LINEAR`, `wholeExecutorMemoryLimitBytes: null`).
- Retained-data accounting (M12-D06) for the private Python directory: separate inclusive 64 MiB ceilings for logical length and allocated bytes, checked before launch and after the stopped-state proof before a result is accepted (overage fails the cell, RESET_REQUIRED, files kept); unavailable accounting fails closed. Fixture-tested via `tests/python-retained-data-v6.test.ts`; worker wiring through the native interpreter is not exercised while the native suites are held. **This is accepted retained-state accounting, not a hard filesystem quota**: transient disk use during a cell stays unbounded (HOLD_PLATFORM_BOUND).
- Native qualification (test-only, opt-in): `tests/fixtures/python-qualification-profile.ts` selects the historical host paths by default. When `M12_PYTHON_QUALIFICATION_MANIFEST`, `_MANIFEST_SHA256` and `_PROFILE` are all set, it accepts only `debian13-security-current` at `/var/tmp/m12-qual-debian13-20261107T144357Z/root` from a hash-verified staging manifest and requires the inspected runtime and fingerprint to equal it. The zlib +b1 reproduction profile is provenance-only and refused. `tests/python-retained-data-native-v6.test.ts` covers D06 through the real worker and Service. Because D06 also walks after the stopped proof, the native entry-count/depth case in `python-program-backend-v3` now expects the over-bound cell itself to fail (stricter), with its files retained and the next cell refused. No production pin, runtime approval or flag change.
- No hard noncooperative host-I/O teardown deadline (D05 proves only that such operations stay owned/uncertain).
- No Windows or installed-desktop proof on this target.
- `pnpm test:browser` chrome-channel suites need `/opt/google/chrome`/`msedge`, absent here; the channel is not changed to obtain passes.

## Flags and approval

`tools.jsReadProgramV1`, `tools.durableReplayExperimentV1`, `tools.pythonKernelV1` are registered and default-off (asserted via `toMatchObject` so main's newer `tools.deferredV1` flag does not break the contract). `reviewerApproval: false`. Production admission requires independent review and an operator-configured confinement backend.

## What this does not claim

- No production readiness, no platform support beyond linux-arm64 bounded receipts.
- No claim that the full `pnpm test` or `pnpm test:browser` failure sets are resolved — the inherited environmental cluster requires privileged host infrastructure this box lacks.
- No live model/evaluation endpoint was invoked; offline fixed fixtures only.

## Raw-artifact policy remediation (CONTRIBUTING L112/L120)

CONTRIBUTING.md prohibits raw tool/test output and private workstation paths in source commits. The branch previously carried 234 raw `.log` files across `docs/implementation/v3/m12-logs/` and `docs/implementation/v6/M12/logs/` plus private paths in receipts/artifacts. Remediation at this commit:

- **Preserved, not deleted**: all raw artifacts were first copied to owned storage outside the repo (`<host>/m12-evidence-raw/`, 289 files). This is local custody only — **nothing was uploaded** and no artifact is claimed beyond this host.
- **Removed from source**: all raw `.log`/`.err` files added by the PR delta are removed. Pre-existing `docs/implementation/v3/logs/*.log` files from `main` are untouched (not this PR's delta).
- **Curated excerpts**: `logs/**/*.bounded.log` files hold head/tail-bounded, redacted excerpts (`<worktree:m12-*>`, `<toolchain>`) sufficient to verify outcomes.
- **Custody manifests**: `docs/implementation/v3/m12-logs/CUSTODY.json` and `docs/implementation/v6/M12/logs/CUSTODY.json` map each removed raw artifact to its SHA-256 digest and owned-storage location.
- **Digest separation**: receipts carry `logDigest`/`boundedLogDigest` = SHA-256 of the **committed excerpt**, and `rawLogDigest` = SHA-256 of the **raw artifact in custody** — independently verifiable.
- Receipt `cwdIdentity`/`executableIdentity` are redacted (`<worktree:m12-v6>`, `<toolchain>/pnpm`); `M12-verification.json` re-validates schema-clean, `bundleStatus` remains **FAIL** (honest — full-gates fail, platform bounds blocked).

## Windows CI shard diagnosis (dispatch run 44411197628 on `c413a178`)

Manager-dispatched `workflow_dispatch` CI on the PR head (draft lanes otherwise gated). Results:

- **Shard 2 job 135179485851: FAIL** — 35 tests in two files.
  - `tests/tool-program-replay-v3.test.ts` (M12-owned): 11 death/restart cases. Observed `code:1, signal:null, output:''` vs asserted POSIX `code:null, signal:'SIGKILL'`. Root cause: `process.kill(pid,'SIGKILL')` maps to `TerminateProcess` on Windows — the child really dies at the boundary, but Windows reports a plain exit code, no signal. Not a bootstrap failure: the fixture is silent on success (`output:''` consistent) and the persisted `killedAt` checkpoint — the actual death proof — is asserted immediately after but was unreachable behind the POSIX-shaped exit assertion.
  - `tests/context-result-host.test.ts` (main-owned, not in PR delta): AVAILABLE vs FULL_RESULT_UNAVAILABLE/range failures. Initially classified inherited/main-side; clean-main Windows `44416861265` (`4bcdc82a`) passing 32/32 + custody 4/4 reclassified it M12-attributable. **Root cause found (platform-independent; reproduced 24/32 on linux-arm64):** M12's `readResource` callback in the shared domain `context()` made domain `readResource()` take the direct bound-read path; `context-result-lineage.wrap` only wraps `withResource`, so `observed` stayed false and `deliverContextResult` returned `FULL_RESULT_UNAVAILABLE` for every retained result. **Fixed at `5559b05f`**: `readResource` scoped to `executeProgramRead`'s program context only — ordinary reads return to `withResource` + lineage (main's exact route); program reads keep the direct bound read under `assertOwner`. Guard/custody/lineage/tests unchanged. Verified linux-arm64: context-result-host 32/32, custody 4/4 (1 platform skip), context-results-v3 7/7, tool-program suites 77/77, public-source 13, project-trust ~10, typecheck 0 errors (receipt `logs/r05/context-result-regression.receipt.json`). **Windows re-run evidence**: run `44438814557` on `eeeb723c` attempt-1 shard2 `135274289401` PASS → host family Windows-verified; custody family pending attempt-2 shard4 (see run record below).
- **Shard 4 job 135179485799: FAIL** — 7 M12 real-owned-process cases in `tests/tool-program-recovery-v3.test.ts` (same death-report root cause; single assertion site in `crashed()`) + 1 separate M04 context-result-custody case (same main-owned cluster).
- Shards 1, 3 and "Windows checks", "Hermes contracts", "Browser tests", "Desktop build" jobs: PASS.

**Fix committed at `3ea402be`**: shared discriminator `assertCrashDeath` (`tests/fixtures/tool-program-crash-death-v3.ts`) used by both M12 suites — POSIX keeps `{code:null, signal:'SIGKILL'}`; win32 accepts `{code:1, signal:null}` + silent output; persisted `killedAt` checkpoint and all recovery/no-duplicate assertions unchanged. 48/48 PASS on linux-arm64 (receipt `logs/r05/`). Windows execution later verified by run `44438814557` on `eeeb723c` (see below); no Windows pass claimed from Linux.

**Windows run `44438814557` on `eeeb723c`** (receipt `logs/r05/windows-run-44438814557.receipt.json`, attempts distinguished):

- **Attempt 1 (terminal)**: `135274289050` Hermes PASS; `135274289362` shard3 PASS; `135274289401` shard2 PASS (carries replay-v3 + context-result-host — **Windows-verifies the `5559b05f` readResource fix for the host family**); `135274289411` shard1 PASS; `135274289432` Windows checks PASS; `135274289554` Desktop build PASS; `135274289697` installed-desktop memory-retention/custody installer PASS; **`135274289305` shard4 FAIL + `135274289528` Browser tests FAIL — both manager-classified pre-assertion startup failures** (comparator `44437308915` @ `8dd79d00` on `agent/m13-v6`, success — different SHA/branch, comparison only).
- **Attempt 2 (terminal, SUCCESS 9/9)**: manager-initiated same-run retry of the two failed jobs — `135305997978` Browser PASS (including the former artifact-width case), `135305998186` shard4 PASS (recovery-v3 15/15, context-result-custody 4/4; **Windows-verifies the `5559b05f` fix for the custody family**). All other jobs re-verified success (`135306044198`, `135306050309`, `135306038061`, `135306056913`, `135306000820`, `135306066350`, `135306000019`).
- **Attempt-1 shard4 observation**: job verdict FAIL retained (unrelated startup failure); its log independently shows recovery-v3 15/15 and custody 4/4, recorded separately from the job verdict. Shard2 replay-v3 33/33, context-result-host 32/32.
- **Artifact `14493505916`** belongs to attempt 1 and verifies generic owned installation/custody/launch only (setup digest `f1ea5169996706ecda77576ccdc344c1cf0bde385bf8d71dc14944366b09b8b4`, ZIP digest `3d2addc2c76cac0dca84a0ec5c65c30a0cde6326c4509de63d5e6d5fdbda6db0`).
- **Still held**: platform/resource holds (Linux-x64 confinement, CAP_SYS_ADMIN/broker guards, browser channel prerequisites, installed-desktop acceptance, whole-process memory, retained-directory quota, full gate); reviewerApproval false. No production claim.
