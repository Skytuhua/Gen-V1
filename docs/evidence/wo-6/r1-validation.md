# WO-6 QA r1 validation

Reviewed head: `97cef47114d8eb2ef06a0e4a6eddf964b98286dc`. Product fix: derive a docked drawer's x coordinate from the current viewport right bound after clamping its saved size. Detached placement stays absolute. No storage format, backend contract, runtime dependency, or run-D-owned file changed.

## Failing tests first

Before changing production code, added two geometry regressions and two browser regressions for viewport growth and restoring a narrow-window preference at 1440px. Vitest failed both new regressions (25 other tests passed). Playwright failed both new regressions: the resized drawer remained at x=580 instead of 996; the restored drawer remained at x=644 instead of 1060. A third geometry test protects detached drawer/pop-up positions.

The matched growth capture uses a 424px user-selected drawer. Before: right margin grows from 20px to 436px as the viewport grows 1024→1440. After: every sample remains 20px, width remains 424px, and the final screenshot records a reload at 1440px. The original transition, resize, and detach/dock GIFs and strips were refreshed.

## Checks actually run

All heavy commands used `flock /tmp/qa-heavy.lock`; pnpm used `COREPACK_HOME=/tmp/wo6-corepack`. Dev servers ran as background processes, including the Playwright-managed child server.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed, exit 0 |
| `pnpm lint:ui` | Passed, exit 0; 447 sources, 0 violations, 35 existing legacy/geometry occurrences |
| Targeted Vitest: chat-layout, side-chat, conversation-scroll, ui-guard, public-source, browser-runner; `--configLoader runner --maxWorkers=1` | 6 files, **106 passed**, exit 0 |
| Item Playwright: `pnpm exec playwright test --config tests/e2e/chat-view-modes.playwright.config.ts --trace off --retries 1` | **21 passed**, exit 0, 56.2s; retries were permitted but none were used |
| Registered browser runner without retries | Earlier runs: 19 passed / 2 timeout failures, then 20 passed / 1 timeout failure; not counted as clean passes |
| Full project command: `pnpm test --maxWorkers=2` | Exit 1: **2198 passed, 217 failed, 35 skipped**, 4 unhandled errors; files: 198 passed, 59 failed, 2 skipped |
| Reviewed-head baseline subset: account-profile, server, packaged-providers | Exit 1: 3 files failed; 14 tests passed, 5 failed; missing native pty and filesystem resource-guard failures also reproduce on the reviewed head |
| Original capture script plus paired growth captures | Passed; before/after geometry samples included |
| Diff / ownership / evidence parity checks | Passed; only chat-layout and its two test files changed outside WO-6 evidence |

Full-suite failures include unavailable `pty.node`, `@cursor/sdk-win32-x64`, filesystem resource-guard failures, provider packaging/custody checks, and subprocess/lifecycle errors. They are not relabeled as passes or repaired by weakening backend guards. [Every reported failed suite/test name](r1-full-suite-failures.txt) is retained. The baseline subset confirms representative environment failures, not an exhaustive equivalence of every full-suite failure.

Browser runs showed intermittent initial-load, animation-timeline, and teardown stalls in different pre-existing cases. A run with longer startup waits still stalled, so those harness changes were reverted. The final item run passed all 21 cases on their first attempt with tracing off; the two new QA regression cases passed in every post-fix run. Raw command logs and the standalone growth-capture script remain under `/home/box/gen-company/ledger/WO-6/qa/r1-fix/`.

Native Windows/Electron and physical touch checks were unavailable. The full-suite release gate remains blocked by the results above. The frozen WO-5 wire contract and all run-D-owned files remain unchanged.

skills: ponytail, ponytail-review, gestures, review-animations, astryx, superpowers:using-superpowers, superpowers:receiving-code-review, superpowers:systematic-debugging, superpowers:test-driven-development, superpowers:verification-before-completion, cloud-environment:cloud-environment-runtime
