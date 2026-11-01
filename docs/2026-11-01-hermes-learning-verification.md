# Procedural learning verification

Implementation baseline: `a9543794bffa5daacdf86a5e38b1f013acd99652`. The final implementation commit is recorded in the delivery message. See the [pinned architecture comparison](2026-11-01-harness-learning-comparison.md) for implemented behavior, intentional differences and source licenses.

## Completed checks

| Check | Result | Proof scope |
| --- | --- | --- |
| Full unit suite | 864/864 passed across 96 test files | `pnpm test --maxWorkers=2 --reporter=json --outputFile=.harness-learning-full-unit-final.json`; real app storage and deterministic runtimes, including all nine provider routes. |
| Distinct browser coverage | 548 passing cases; six explicit skips | Complete 554-case sweep plus all four affected files rerun on NTFS: 38 passes and two existing policy skips in the 40-case rerun. All seven broad-run failures were covered and passed. This is combined distinct coverage, not a second completely clean broad sweep. |
| TypeScript | Passed | `pnpm typecheck`. |
| Production web build | Passed | `pnpm build`; existing bundle-size/dependency annotation warnings remain. |
| Desktop shell build | Passed | `pnpm desktop:build`. |
| Packaged source custody | 16/16 selected files matched | Current learning/runtime/server files and Hermes MIT notice match the unpacked package byte for byte. |
| Packaged provider bootstrap | Passed | Actual bundled Node, Claude/Gemini published CLI version startup, Cursor empty-store SDK import/stock rg helper and five distribution custody inventories. No account connection or inference. |
| Native skill persistence | Seven checks passed | Actual packaged Electron, authenticated HTTP, UI editing/flags/archive/restore/rollback, direct read-only SQLite seven-version inspection after shutdown, and a full app restart. No page or cleanup errors. |
| Fresh Windows installer | Built successfully | Unsigned NSIS installer in the new dated D: output root, with a SHA-256 build manifest. The installer was not installed. |
| Independent review | No remaining findings | Code and security reviews; confirmed defects fixed with regressions before final verification. |

Focused tests first reproduced atomic/ownership/native-pipe defects. Final integration regressions also cover repeated command receipts counting once, metadata-only skill-read events, retained draft transfer, account intent across cleanup, and reviews beginning during deferred send/resume preparation. No production timeout was enlarged. The first unconstrained full test run exposed account timing and stale test assumptions as well as contention-sensitive timeouts; the corrected full run uses two workers.

The native probe preserved revisions 1 through 7, the restored body, protected/disabled flags and saved learning controls across restart. No task or learning review was submitted. The unpacked app was launched directly; the installer was not installed. Raw receipts are local verification artifacts and are not committed as application data.

Current artifact/evidence root: `D:/GenerativeHarnessVerification/hermes-learning-20261101-1793550016332/`. It contains the source manifest, selected packaged-source custody receipt, full unit result, packaged-provider receipt and `native-skills/verification.json` with two screenshots. `browser-combined-coverage.json` matches the complete sweep and affected-file retest by stable test ID, asserts 548 passes/six skips/zero remaining failures, and records both input hashes.

All nine new skill browser cases passed. The seven broad-run failures were a premature fixture readiness check, a premature detach-save assertion, and a real executor declining a D: filesystem resource guard. The helper now waits for a visible published artifact instead of the model picker's already-visible label; detach waits for the native acknowledgment before inspecting the saved command. All 40 cases in `desktop-surfaces`, `host-loop`, `latency` and `snapshot-performance` then ran on NTFS without production guard, threshold or timeout changes. The latency/geometry/work-count assertions passed. Fixed-path screenshot outputs were copied to fresh evidence paths and their four prior versions restored byte for byte.

The generated staging directory remains: automatic approval review rejected its removal with `blocked by policy`. Earlier releases, source and evidence were preserved.

The initial broad browser run was stopped after D: trace staging exhausted space (`ENOSPC`). D: uses 1 MiB allocation units; it was unsuitable for that many small temporary trace files. A complete restart on C: also exceeded the available trace-storage budget despite reversible NTFS compression. All 7,683 interrupted C: artifact files were preserved in `browser-interrupted-ntfs.zip`; every entry's SHA-256 matched its source. Automatic approval review also rejected removal of that archived C: copy, so it remains pending explicit user approval. The final complete sweep uses D: temporary/output paths with trace capture disabled; test selection, assertions, performance thresholds and timeouts remain unchanged. Interrupted sweeps are not counted as final browser acceptance.

Installer: `desktop-release-0.5.2/Generative-Harness-Setup-0.5.2-win-x64.exe`, 457,228,938 bytes, SHA-256 `2fffa68efda799c33a1ed7ef6ae5c1ab2e493c3c490b05f64988da17005f663c`.

## Remaining acceptance boundary

No account sign-in, live model request or paid learning trial is part of these checks. Routing fixtures and scripted skill writes do not establish autonomous skill quality, correct model selection of procedures, reduced future failures, universal open-source parity or production acceptance. The next quality gate is one real granted task, inspection of the learned procedure, a full restart, and reuse on a different task with actual usage and outcome recorded.

Completed helper results are retained. Recoverable thread archiving could not proceed: T3 `task_status` returned `task_not_found` for the native helper IDs, so no completed/result-available/child-free metadata or child thread ID was available. No unrelated thread was archived or deleted.
