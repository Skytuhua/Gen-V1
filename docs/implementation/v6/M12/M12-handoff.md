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
| Isolated worktree | `/home/piadmin/Gen-V1-m12-v6` — original checkout and other worktrees untouched |
| Preserved task head | `f04cb74eff8d36a7ebcbfb51ca43c6e30ff23ffc` |
| Merge base / merged main | `1c09d492278b1014bc3ab5455191b1f5913c96d8` / `4aef753ec272d6ab9f9f9eec1df0ca232386975b` |
| Round-2 merge commit | `0548ebc51ea9f8b55a6bd2b68b7d711cc8d32a19` (`git merge --no-commit --no-ff`, 14 conflict paths composed semantically) |
| Round-1 merge (preserved) | `44c19075a3341f85a0f6c2c8e8455f2f70a970df` against main `1c09d49` |
| Platform | linux-arm64, Node `v24.11.1`, pnpm `10.30.3` (`/home/piadmin/tools/node24/bin`) |

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

Scoped smoke on the merged tree `2e949a66` (separate worktree `/home/piadmin/Gen-V1-m12-r03`, receipts committed at `fd871d72` under `logs/r03/`): typecheck PASS (retry; first attempt V8-heap OOM under load) + 7 focused M12 vitest suites PASS, including the default 64/65 boundary. First-attempt failures are preserved and classified (heap OOM, fresh-worktree prerequisites — `build:widgets`, node-pty linux-arm64 — and two 15s-bound cases that passed on calmer rerun). This is scoped smoke only, not a full gate; the full/browser gates remain bound to `e816a081`.

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
- No aggregate retained-directory disk quota; no hard noncooperative host-I/O teardown deadline (D05 proves only that such operations stay owned/uncertain).
- No Windows or installed-desktop proof on this target.
- `pnpm test:browser` chrome-channel suites need `/opt/google/chrome`/`msedge`, absent here; the channel is not changed to obtain passes.

## Flags and approval

`tools.jsReadProgramV1`, `tools.durableReplayExperimentV1`, `tools.pythonKernelV1` are registered and default-off (asserted via `toMatchObject` so main's newer `tools.deferredV1` flag does not break the contract). `reviewerApproval: false`. Production admission requires independent review and an operator-configured confinement backend.

## What this does not claim

- No production readiness, no platform support beyond linux-arm64 bounded receipts.
- No claim that the full `pnpm test` or `pnpm test:browser` failure sets are resolved — the inherited environmental cluster requires privileged host infrastructure this box lacks.
- No live model/evaluation endpoint was invoked; offline fixed fixtures only.
