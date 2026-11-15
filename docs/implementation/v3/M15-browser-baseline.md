# M15 clean current-base browser baseline

## Result

**The clean current-base root suite completed: 79 passed, 33 failed, 1 skipped, 0 flaky; exit 1.** The final attempt used Node's supported tsx import loader after rebuilding the exact locked `node-pty` 1.1.0 binary against Node 24.22.1. It ran all 113 discovered cases in 528,994 ms and provides actual assertion outcomes for candidate comparison.

Two earlier setup failures remain preserved: the required pnpm wrapper could not open the tsx CLI IPC socket, and the first direct-loader attempt could not load the then-missing native binary. Their zero result counters mean zero observed test outcomes. The completed baseline supersedes those setup blockers, without converting either failed command into a pass.

## Source isolation

The baseline ran in `/workspace/scratch/1b47eb428672/gen-v1`, at `399cde39ff4ee82272c7a7700944325c44b36070`, using the canonical origin `https://github.com/skytuhua-org/Gen-V1.git`. The tracked tree was clean before execution and `git diff --exit-code` still returned 0 afterward. No M15 product changes were present in that checkout.

The checkout used a newly created `node_modules` symlink to `../m15-v3/node_modules`, sharing the completed frozen pnpm 10.30.3 installation. Node was v24.22.1. The dependency build allowlist was not changed and no dependency was added. After the initial native-load failure, the parent rebuilt the exact locked `node-pty` 1.1.0 package with node-gyp; the shared binary was available to this final attempt. Generated widget runtime assets were built before the browser run.

The root configuration owns `http://127.0.0.1:5499`, a 1440 by 1000 viewport, one Playwright worker, and the 16 files in `scripts/browser-suites.ts`'s `rootBrowserSpecs`. This baseline did not reuse the M15 workbench server.

## Recorded commands

Each command was wrapped by `/workspace/scratch/1b47eb428672/m15-v3/scripts/m15-record.mjs`, with `/workspace/scratch/1b47eb428672/tool-bin` prepended to PATH. The recorder preserved the baseline working directory in every receipt.

| Evidence ID | Actual command | Exit | Observation |
| --- | --- | --- | --- |
| `baseline-build-widgets` | `pnpm build:widgets` | 0 | Generated widget runtime build completed. |
| `baseline-browser-root` | `pnpm test:browser --suite root` | 1 | tsx CLI setup failed at `listen /tmp/tsx-1000/25.pipe`, `EPERM`, before browser test discovery. |
| `baseline-browser-root-node-loader` | `node --import tsx scripts/test-browser.ts --suite root` | 1 | The same registered root suite reached Playwright setup, then failed to load `node-pty`'s native `pty.node`; no suites or assertions executed. |
| `baseline-browser-root-native-ready` | `node --import tsx scripts/test-browser.ts --suite root` | 1 | Completed with 79 passed, 33 failed, 1 skipped, 0 flaky. |

| Evidence ID | Start UTC | End UTC | Bounded log SHA-256 |
| --- | --- | --- | --- |
| `baseline-build-widgets` | `2026-11-15T21:35:29.780Z` | `2026-11-15T21:35:30.445Z` | `d7c21a8a722ab0b0bd2e98f84a46f894b832feb7850851c3671f349b10d39e17` |
| `baseline-browser-root` | `2026-11-15T21:35:33.469Z` | `2026-11-15T21:35:34.213Z` | `ab833b11454332d6099e6aefc9794c9a06bee20456c0915f2f8403447aee13dd` |
| `baseline-browser-root-node-loader` | `2026-11-15T21:35:48.520Z` | `2026-11-15T21:35:57.552Z` | `861fde837d74cbcb13f4f3b030fc9ca054e46f7492a3bddcffdf3a7ab104144c` |
| `baseline-browser-root-native-ready` | `2026-11-15T21:40:29.677Z` | `2026-11-15T21:49:20.716Z` | `c0c0c1d55695a1410087b8ffc378be396a5daa5c2e25c79f67b456f6668ba3c1` |

Exact receipts and logs are retained under `docs/implementation/v3/m15-logs/` with the listed IDs and `.json` / `.log` extensions. They were copied byte-for-byte from the baseline checkout; no recorded command, working directory, result, or digest was changed.

## Completed baseline artifact

Original result: `/workspace/scratch/1b47eb428672/gen-v1/test-results/browser/run-1794778830057-1c83ab01-4eb3-47fb-baa6-f023721cee40/root/results.json`.

Retained exact artifact: `docs/implementation/v3/m15-artifacts/baseline-root-native-ready-results.json`.

Size: 269,635 bytes. SHA-256: `ef4f637c38b1e2271235945fecc1d82dc6f755517349baac187461193017c3a0`.

`baseline-root-native-ready-summary.json` in the same artifact directory preserves all 33 failing case names, their exact files and lines, and the reported errors. It is derived from the exact Playwright result and includes that result's digest and original path.

| Spec | Failing cases | First observed failure |
| --- | ---: | --- |
| `host-loop.spec.ts` | 7 | Host fixture could not find the Message textbox. |
| `latency.spec.ts` | 1 | Host fixture could not find the Message textbox. |
| `plan-timeline.spec.ts` | 17 | Fixture passed a missing element to `getComputedStyle`. |
| `signing-motion.spec.ts` | 1 | Original-hash handoff case did not reach a ready document preview. |
| `skills.spec.ts` | 7 | Retirement/history case could not find its expected alert. |

These are observations on unchanged main. The first error in a spec does not establish one common cause for every failure in that spec. Candidate parity must compare exact case outcomes, including the 79 baseline passes. No candidate result is implied here.

## Earlier setup-only Playwright artifact

Original result:

```text
/workspace/scratch/1b47eb428672/gen-v1/test-results/browser/run-1794778548890-4c2ec330-9390-406f-b701-0b6d98815dc6/root/results.json
```

Retained artifact: `docs/implementation/v3/m15-artifacts/baseline-root-results.json`.

Size: 5,783 bytes. SHA-256: `61a9f1865c9c9d7b26d2541bff96373be842afb966bb431d7f7b4ec22ed84963`.

Playwright reported `expected: 0`, `unexpected: 0`, `skipped: 0`, `flaky: 0`, an empty suite list, and two setup errors for the missing native module. The errors identify the unchanged dependency installation shared by the clean baseline and candidate checkout.

For the M15 verification manifest, retain all three nonzero browser command records as `FAIL`. The first two attempts were blocked before any assertions; the final attempt has actual failing cases. Do not label any attempt as an expected-negative success or claim candidate parity before the same candidate outcomes are compared. Required native/platform evidence and production activation remain open.
