<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1054 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: Vitest unit coverage for `packages/ui-shell` components and `evals` modules that currently have none.
- Repo: `skytuhua-org/Gen-V1` (local: `/home/ubuntu/repos/Gen-V1`).
- Plan revision: 1, dated 2026-11-20.
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified via `git rev-parse HEAD`).
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1054. No linked PRs.
- Current implementation status: all `.ts` helpers (`chat-layout`, `focus-retention`, `list-navigation`, `overlay-position`) and all five `evals` modules already have tests; six `.tsx` components have zero unit tests (overlay behavior is covered only by Playwright specs, which this issue does not count).
- Source provenance: authored by `devin-a-cloud-3d96bc` (review/planning claim) from direct inspection; no code changed.

### OBJECTIVE

Inventory result at baseline:

- Covered already (no work): `chat-layout.ts` → `tests/chat-layout.test.ts`; `focus-retention.ts` → `tests/ui-focus-retention.test.ts`; `list-navigation.ts` → `tests/list-navigation.test.ts`; `overlay-position.ts` → `tests/ui-shell-overlay.test.ts`; `ChatView.tsx` (covered via `chat-gesture-audit`/`workbench-continuation` tests), `Modal.tsx`, `Popover.tsx`, `Select.tsx` (all three via `tests/ui-guard.test.ts` static checks + `tests/e2e/ui-shell-overlays.spec.ts`). `evals/cases.ts` → `tests/eval-gates.test.ts`; `evals/copy-clarity.ts` → `tests/copy-clarity.test.ts`; `evals/project-memory-study.ts` → `tests/memory-study-v3.test.ts`; `evals/review.ts` → covered indirectly by `tests/m05-evidence-inventory.test.ts`/`tests/public-source.test.ts`; `evals/runner.ts` → `tests/research-baseline.test.ts`; `evals/fixtures/project-memory-v3.json` is data (justify, no test needed).
- Not covered: `ActionMenu.tsx` (85 ln), `Feedback.tsx` (31 ln), `SummaryDock.tsx` (87 ln), `Toast.tsx` (67 ln), `ToolDock.tsx` (17 ln), `Tooltip.tsx` (135 ln).

Success = one committed unit test file per uncovered component, using the repo's existing no-DOM pattern (`renderToStaticMarkup` for markup/ARIA + pure exported helpers), or a documented justification where a component needs a real DOM.

### REQUIREMENTS

In scope: new `tests/ui-shell-*.test.tsx` files covering exported functions/components — edge cases, error paths, invalid input — plus fixes for clear bugs found (documented in PR body).

Out of scope: adding a DOM environment (no `jsdom`/`happy-dom` is installed today; adding one is a dependency decision this plan does not make — see DESIGN for how DOM-dependent behavior is handled), Playwright changes, testing already-covered files, any `evals` source edits.

Constraints: one concern per PR, each < 400 lines; skip files touched by open PRs; `pnpm lint`, `pnpm typecheck`, `pnpm test` pass per PR.

### REPO_MAP (verified at baseline)

- `packages/ui-shell/Feedback.tsx` — pure renderers: `withoutRetryHint(message)` (exported, pure — strips trailing "Retry/Try again/Please try again" sentence), `Spinner({size=14})`, `EmptyState`, `ErrorState` (`role` prop `'alert'|'status'`, `retryLabel` default `'Retry'`, strips hint only when `onRetry` present), `BusyButton` (`aria-busy`, `data-busy`, disables while busy). Fully testable via `renderToStaticMarkup` + direct calls — no DOM needed. Highest-value file.
- `packages/ui-shell/Toast.tsx` — exports `toast(message, options)`, `dismissToast(id)`, `Toaster`, type `ToastTone`. The toast store (`entries`, `nextId`, `publish`, `subscribe`) is module-level plain state — `toast()`/`dismissToast()` are directly callable; dedupe (same message restarts), `MAX_VISIBLE = 3` cap, `durationMs`, trim-empty → returns `0`. `Toaster`/`ToastItem` markup renderable via `renderToStaticMarkup` (`role='region' aria-label='Notifications'`, per-toast `role` = `alert` for error else `status`, `data-tone`, `data-state`, action button, close button `aria-label='Dismiss notification'`). Timers/animations are DOM-only — covered by markup assertions on `data-state`, not by waiting.
- `packages/ui-shell/SummaryDock.tsx` — exports `readSummaryCollapsed(id, fallback, storage?)`, `writeSummaryCollapsed(id, collapsed, storage?)`, `DockedSummary`. The storage helpers take an injectable `SummaryStorage` — fully unit testable with a fake `{getItem,setItem}`: legacy `harness:floating:` key fallback, >1024-char values ignored, non-JSON ignored, `collapsed` non-boolean ignored, exceptions → fallback/in-memory. `DockedSummary` markup via `renderToStaticMarkup` (title, `ariaLabel`, collapsed vs expanded body render).
- `packages/ui-shell/ToolDock.tsx` — `ToolDock({width, children})` creates a singleton `aside.ui-tool-dock` per `document` via a `WeakMap`, portals children, sets width = max across mounted docks. DOM-dependent (creates elements on `document.body`) — markup test only asserts `createPortal` null-render case; justify DOM behavior via existing `tests/e2e/ui-shell-overlays.spec.ts` or assert via `renderToStaticMarkup` that initial render returns null (element created in `useLayoutEffect`, which SSR markup does not run — that IS the testable edge).
- `packages/ui-shell/ActionMenu.tsx` — `ActionMenu` props verified (`label`, `icon`, `iconOnly`, `open`, `onOpenChange`, `disabled`, `items: ActionMenuItem[]`); `ActionMenuItem` = `{id,label,accessibleLabel?,title?,shortcut?,icon?,disabled?,checked?,onSelect}`. Trigger markup renderable statically (aria-haspopup/expanded/`aria-label`/`iconOnly` hides label text). Open-list rendering goes through `Popover` (portal) — justify limiting static test to trigger + item contract via a stubbed `Popover` only if it renders inline; else cover `ActionMenuItem` validation behavior in the keyboard/selection tests that DO need DOM → those stay in `tests/e2e/ui-shell-overlays.spec.ts`; unit file covers the pure item-shape rendering and `useListNavigation` re-use is already tested.
- `packages/ui-shell/Tooltip.tsx` — exports `TooltipLayer`; internal `adopt(target)` (not exported). DOM-heavy (MutationObserver, pointer/focus/keyboard listeners, portal bubble). Unit-testable surface without DOM: `TooltipLayer` static render returns portal target markup only when `shown` — so static test asserts empty/null render at rest. Real behavior justification → `tests/e2e/ui-shell-overlays.spec.ts` already exercises tooltips; PR body documents this rather than adding a DOM environment.
- `evals/*` — all modules covered per OBJECTIVE; `evals/fixtures/project-memory-v3.json` is fixture data consumed by `tests/memory-study-v3.test.ts`.

### DESIGN

Three PRs, each one concern:

- **PR A — `tests/ui-shell-feedback.test.tsx`** (~120 lines). `renderToStaticMarkup` + direct calls:
  - `withoutRetryHint`: `"X failed. Retry"` → `"X failed"`; `"X failed. Try again."` → `"X failed"`; `"Oops"` unchanged; `"Retry"` alone → `"Retry"` (falls back to original when the strip empties the string — verified behavior of the `|| message` clause); case-insensitive.
  - `ErrorState` with `onRetry` renders `role="alert"`, the hint-stripped message, a `ui-error-retry` button with default label `Retry`; without `onRetry` renders the raw message, no button; `live='status'` → `role="status"`; `busy` → `aria-busy="true"` and `disabled`.
  - `EmptyState`: `children===false`/`null` → no `<p>`; `compact` → `data-compact`; `title` absent → no `<strong>`.
  - `BusyButton`: `busy` → `aria-busy`, `data-busy`, disabled, spinner present; `type` defaults to `button`.
- **PR B — `tests/ui-shell-toast.test.tsx` + `tests/ui-shell-summary-dock.test.tsx`** (one concern = "stateful store helpers", ~200 lines combined).
  - Toast: `toast('  ')` → `0`; `toast('a')` then `toast('a')` → one entry (dedupe by message); 4 toasts → `MAX_VISIBLE` keeps newest 3; `dismissToast(id)` marks `leaving` (assert via a `useSyncExternalStore`-subscribed render or by reading through `Toaster` markup: `data-state="closed"`); `Toaster` markup asserts `role="region"`, per-tone `role` (`error`→`alert`, `info`/`success`→`status`), action + close buttons. Between tests, drain entries by dismissing all (module state is shared — tests must reset via `dismissToast` on each id; document this in the file header).
  - SummaryDock helpers: fake storage table of cases (valid new key, legacy `harness:floating:` key, oversized raw >1024, `JSON.parse` throw, `collapsed: "yes"` non-boolean, `getItem` throwing) → `readSummaryCollapsed` returns expected fallback; `writeSummaryCollapsed` writes `{collapsed}` under `harness:summary:<id>:v1`; throwing `setItem` swallowed. `DockedSummary` static markup: title + `aria-label`/`ariaLabel`, collapsed body hidden vs shown via `defaultCollapsed`+storage stub.
- **PR C — `tests/ui-shell-action-menu.test.tsx` + justifications for `ToolDock`/`Tooltip`** (~120 lines).
  - ActionMenu static: trigger `<button>` with `aria-haspopup="menu"`, `aria-expanded` follows `open`, `disabled`, `iconOnly` suppresses label text while keeping `aria-label`; items render `role="menuitem"`-equivalent markup where `Popover` inlines children (discovery: confirm `Popover` renders children in-tree under `open`; if portal-only, assert trigger contract only and note it).
  - `ToolDock` + `TooltipLayer`: static render asserts rest-state output; PR body carries the justification — "DOM-only singleton layer and MutationObserver-driven behavior covered by `tests/e2e/ui-shell-overlays.spec.ts`; no DOM environment in unit tests" — satisfying the issue's "or say why it can't be unit tested" clause.

### EXECUTION_DAG

- **T01** PR A file (`tests/ui-shell-feedback.test.tsx`). Deps: none. Done-when: green.
- **T02** PR B files (toast + summary-dock). Deps: none. Done-when: green; toast module state reset between tests.
- **T03** PR C file + justification text. Deps: confirm `Popover` inlining (discovery inside `packages/ui-shell/Popover.tsx`). Done-when: green; PR body contains both justifications.
- **T04** Close-out comment listing final coverage matrix. Deps: T01–T03.

### VALIDATION

Planned: `pnpm exec vitest run tests/ui-shell-feedback.test.tsx tests/ui-shell-toast.test.tsx tests/ui-shell-summary-dock.test.tsx tests/ui-shell-action-menu.test.tsx`; `pnpm typecheck && pnpm lint`; `pnpm test` before final merge. Acceptance: every `packages/ui-shell` module has a test file or justification; `evals` inventory statement above verified in PR A body.

### STATE

Researched/decided: coverage inventory + test design verified at baseline. Implemented: none. Verified: none executed. Pending: T01–T04 unowned. Risk: shared module-level toast store can leak between tests — mitigated by explicit reset noted in T02. Next step: claim T01.

### REFERENCES

- Verified sources at `7ef0710c`: `packages/ui-shell/Feedback.tsx` (whole), `Toast.tsx` (whole), `ToolDock.tsx` (whole), `SummaryDock.tsx` lines 1–50, `ActionMenu.tsx` lines 1–60, `Tooltip.tsx` lines 1–80.
- Test conventions: `tests/copy-clarity.test.ts`, `tests/compact-settings.test.ts` (`renderToStaticMarkup`); `vitest.config.ts` (node env, `tests/**` include).
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1054; AGENTS.md contract.

