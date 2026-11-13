# WO-5.D / PR #130 / QA r3 capture creation fix

Scope: the single r3 major. Main was fetched explicitly and a normal merge attempted; origin/main 8db06df was already included. No backend, contract, application styling or server route changes.

The startup recursive mkdir and the unsafe non-Linux creation fallback are removed. Capture root setup and descendant creation share verified Linux directory descriptors. Each mkdir creates one component through the open parent descriptor; the parent is checked before creation. Each file is opened relative to that verified parent with O_CREAT | O_EXCL | O_NOFOLLOW, checked against the opened descriptor, and written through that descriptor. Playwright returns bytes. Other platforms fail closed before creating any output; capture requires Linux with the directory/no-follow flags and /proc/self/fd.

## Repro first

Extracted the unchanged startup setup into prepareCaptureOutput, wired the actual entry point to it, then added deterministic hooks immediately before real mkdir and create-open. Before the fix: **2 failed / 40 passed**. The root-creation race created an outside nested directory; the simulated Windows fallback parent race created an outside proof.png. Both outside targets were temporary sibling fixtures, cleaned up in finally blocks.

After the fix: **45 capture-helper tests pass**. Both race regressions now assert empty outside targets. Additional checks cover nested mkdir swaps, normal missing-root setup, nonempty-root refusal, exclusive text/image writes and Windows/macOS fail-closed behavior before any create attempt. Linux-specific success tests skip on unsupported platforms.

## Checks

Every command was bounded with timeout 300. Shared pnpm store only; no QA lock, dependency install or dev server.
pnpm 10 rejects --store-dir with exec/run, so its supported --config.store-dir=/home/box/.local/share/pnpm/store spelling was used.

- PASS typecheck: pnpm --config.store-dir=/home/box/.local/share/pnpm/store run typecheck.
- PASS UI lint: 465 sources, zero violations.
- PASS relevant Vitest: 10 files / 241 tests, including 45 capture helpers.
  pnpm --config.store-dir=/home/box/.local/share/pnpm/store exec vitest run --configLoader runner tests/capture-ui tests/browser-runner.test.ts tests/public-source.test.ts --maxWorkers=1
- PASS git diff --check for this delta.
- Independent read-only review: no remaining blocker/major in the reported ancestor-symlink race cases.

Tests wrote only to temporary/output directories. Completed logs were copied in a separate explicit evidence step to:
/home/box/gen-company/ledger/WO-5/fe/validation-D/qa-r3-130-zowmd8h0

No browser/e2e or native Windows/macOS runs were needed for this tooling-only delta. Platform rejection was simulated on Linux; no portable unsafe fallback remains. These checks cover the reported symlink substitutions, not arbitrary relocation of an already-open directory object. QA minors (ordinary excerpt size, CR-heavy preview DOM) remain follow-ups. QA r1 major #2 stays owned by Backend #129.

skills: engineering-team-process, ponytail, ponytail-review.
