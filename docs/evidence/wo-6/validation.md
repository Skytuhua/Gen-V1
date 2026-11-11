# WO-6 validation

Environment: Linux, Chromium 141 via Playwright 1.56.1, Node 24.22.1, pnpm 10.30.3. Frontend fixtures intercept APIs and use synthetic conversation/attachment data.

| Check | Actual final result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm lint:ui` | Passed; 447 sources, zero violations, 35 existing legacy/geometry entries |
| `pnpm exec vitest run tests/chat-layout.test.ts tests/side-chat.test.ts tests/conversation-scroll.test.ts tests/ui-guard.test.ts tests/public-source.test.ts tests/browser-runner.test.ts --maxWorkers=2` | 6 files, 103 tests passed |
| `pnpm exec tsx scripts/test-browser.ts --suite chat-view-modes` | 19 passed; registry discovery and execution verified |
| `GEN_E2E=1 pnpm exec playwright test --config tests/e2e/side-chat.playwright.config.ts --output test-results-side-chat --trace off` | 18 passed |
| `pnpm exec playwright test --config tests/e2e/conversation-scroll.playwright.config.ts` | 6 passed |
| `pnpm exec vite build` | Passed; existing Rollup annotation and chunk-size warnings |
| `git diff --check` | Passed |

Earlier exploratory runs caught a composer-focus bug, which was fixed. Concurrent regression runs initially used a shared Playwright output directory and collided; later runs used isolated paths. Continuous trace recording also produced intermittent startup/timeline stalls on this runner. The new suite uses on-first-retry tracing; its final default run through the registered runner passes all 19 tests without retries. The existing side-chat regression passes with continuous tracing disabled. No failed run is being counted as a pass.

Native Windows/Electron and physical touch-device checks were not run. All requested desktop widths (1440/1024, plus 768 smoke) were exercised in Linux Chromium. The resized surface uses a transform preview and commits one reflow when released; it does not continuously relayout text while the pointer is held.
