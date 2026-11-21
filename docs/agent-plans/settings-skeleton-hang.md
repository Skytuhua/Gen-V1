# Plan: Settings dialog must never hang on its skeleton

## META
- Feature: Bounded wait + error/retry path for the Settings dialog
- Repo: skytuhua-org/Gen-V1
- Plan revision: r1, 2026-11-21
- Baseline: `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1468
- Status: planned, not implemented
- Provenance: real-user QA pass in the built fixture app (http://127.0.0.1:4317). Opening Settings showed the "Opening settings…" skeleton and never resolved (observed >90 s); no error, no retry, no cancel. The only escape is closing the modal.

## OBJECTIVE
The Settings dialog resolves, errors, or offers a manual escape within a bounded time. A skeleton may never be the terminal state. Success: after 8 s without data the dialog shows a styled error state with Retry and a detail line; after a failed retry the Retry button remains and reports failure inline.

## REQUIREMENTS
- In scope: the lazy-`Settings` load in `apps/web/src/App.tsx:141` (`Settings ? … : error ? <ErrorState/> : <LoadingState label="Opening settings…" skeleton={<SettingsSkeleton/>}/>`), the same branch in `apps/web/src/WorkspaceHost.tsx:71`, and the data-loading `LoadingState` in `apps/web/src/CompactSettings.tsx:53`.
- Out of scope: settings content itself, other dialogs.
- Timeout: 8 000 ms from mount with no resolved component/data -> error state. Retry restarts the timer; max 3 automatic retries is NOT wanted — retries are manual only (one click = one attempt).
- Network-level failures must reject the load promise and reach the same error state immediately, without waiting for the 8 s timer.
- Accessibility: error state `role="alert"`; Retry button focusable and labeled "Reload settings"; focus moves to the dialog heading on state change.
- Reduced motion: skeleton shimmer and spinner respect `prefers-reduced-motion` (existing app convention).

## REPO_MAP (verified)
- `apps/web/src/App.tsx:125-141` — the lazy `import('./Settings')` DOES have a `.catch` that sets `error` ('Settings could not load. Try again or close this window.') and the branch already renders `ErrorState message={error} retryLabel="Reload to retry" busy={reloading} onRetry={() => void reload()}`. So a rejected import reaches the error state today. The observed hang means the promise never settled — either the chunk import itself never resolves/rejects, or (more likely in the fixture) the data load inside `CompactSettings.tsx` never returns; that path has no catch and no timeout at all. The defect is an **unbounded wait**, not missing rejection handling.
- `apps/web/src/WorkspaceHost.tsx:71` — identical lazy-import branch for the embedded settings surface (same never-settling gap).
- `apps/web/src/CompactSettings.tsx:53` — `LoadingState` wrapping the settings data fetch; this inner load is the uncovered path.
- `apps/web/src/LoadingState.tsx` — loading primitive (label + skeleton slot).
- `ErrorState` component — existing styled error with `message`, `retryLabel`, `busy`, `onRetry` props (same file usage above).
- Tokens: `apps/web/src/styles.css:3,4,6` — `--danger`, `--danger-soft`, `--text`, `--muted`, `--border`, `--surface`, `--accent`, motion tokens `--ui-motion-*`, `--ui-ease-*`.

## DESIGN
1. **Timeout wrapper.** Add `withTimeout(promise, ms)` helper (in `apps/web/src/` next to existing async helpers — discovery: reuse an existing timeout util if one exists; do not add a dependency). Wrap the lazy `import('./Settings')` in `App.tsx` and `WorkspaceHost.tsx` AND the settings data load inside `CompactSettings.tsx` with 8 000 ms each — both waits are unbounded today. Rejection flows into the existing `error` state — one code path.
2. **Error state (all three sites).** Reuse `ErrorState` with copy: message "Settings didn't load. Check your connection and try again."; `retryLabel="Reload settings"`; `busy={reloading}`; `onRetry` clears `error`, restarts timer + load. Below the message, a secondary line (`font-size:12px`, `color:var(--muted)`): "If this keeps happening, reload the app." No icon changes; inherits existing ErrorState styling.
3. **Cancel always available.** The modal's existing close (X / Esc / scrim) remains active during load and error — verify; do not gate `onClose` on load state.
4. **Retry feedback.** While a retry is in flight the button shows its `busy` state (existing prop) and is disabled; on repeated failure the same error state returns.
5. **Skeleton duration cap.** While under 8 s the skeleton stays exactly as today — no visual change on the happy path.
6. **LoadingState label** keeps "Opening settings…" (`font-size:12px`, `color:var(--muted)`, existing style). No new copy inside skeleton.

## EXECUTION_DAG
Owner of every task is the single implementing worker (role=impl); each hands off to the same worker's next task, and T06 hands the verified branch to the front-end reviewer. No overlap: T02 touches the two lazy-import call sites and `CompactSettings`'s loader only, T03 error props only, T05 the modal only.

- T01 Discovery (owner impl): identify the data loader behind `CompactSettings` and which promise actually never settles (chunk import vs data load); find any existing timeout helper (`grep -rn 'setTimeout\|AbortSignal.timeout' apps/web/src`). Done when the settling-failure site is named in a checkpoint. Handoff: T02.
- T02 Timeout helper (owner impl; depends T01): implement/reuse `withTimeout` rejecting `Error('settings-load-timeout')` at 8 s; apply to the `import('./Settings')` in `App.tsx` and `WorkspaceHost.tsx` and to the data load in `CompactSettings.tsx`. Done when a never-resolving promise at each site yields the error state at ~8 s. Handoff: T03/T04/T05.
- T03 Error copy (owner impl; depends T02): set `ErrorState` props per DESIGN 2 at all three sites. Done when the exact copy renders with `role="alert"` and focus moves to the dialog heading on the state change. Handoff: T06.
- T04 Retry loop (owner impl; depends T02): `onRetry` clears `error`, restarts load + timer; button busy/disabled in flight. Done when a second failure returns the identical state. Handoff: T06.
- T05 Modal close (owner impl; depends T02): verify X/Esc/scrim work during load and error; fix if gated; clear timers on unmount. Done when close works at every stage with no dangling timer. Handoff: T06.
- T06 Tests + handoff to front-end review (owner impl): unit — `withTimeout` (resolve, reject, timeout, cleanup) and the state machine (load→error→retry→success, load→error→retry→error); fixture e2e: stub the settings chunk to hang, assert skeleton→error at 8 s on all three paths. Done when suite passes and a REVIEW checkpoint hands the PR to the reviewer.

## VALIDATION
- Repro: `pnpm build:widgets && vite build`, serve on `http://127.0.0.1:4317`; temporarily stub the settings chunk to hang -> dialog shows skeleton 8 s then error state with "Reload settings"; clicking retry repeats cycle; Esc closes at every stage.
- Accept when: skeleton never persists past 8 s without data on any of the three paths; exact copy above; light + dark themes; no timer leak (component unmount clears).
- Evidence: screenshot of error state (light + dark), e2e log.

## STATE
- Researched: all three call sites, existing `ErrorState`/`LoadingState` props, tokens.
- Not verified: whether the underlying load can reject today (it did not in the fixture); whether a timeout util already exists (T01).
- Next step: T01.

## REFERENCES
- Fixture: `scripts/review-host.ts`.
- `apps/web/src/App.tsx:141`, `WorkspaceHost.tsx:71`, `CompactSettings.tsx:53`, `LoadingState.tsx`, `styles.css` tokens.
