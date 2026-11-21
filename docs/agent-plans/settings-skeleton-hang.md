# Plan: Settings dialog must never hang on its skeleton

## META
- Feature: Bounded wait + error/retry path for the Settings dialog
- Repo: skytuhua-org/Gen-V1
- Plan revision: r1, 2026-11-21
- Baseline: `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`
- Issue: (this issue)
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
- `apps/web/src/App.tsx:141` — Modal Settings branch; already has `error` + `ErrorState message={error} retryLabel="Reload to retry" busy={reloading} onRetry={() => void reload()}` — the missing piece is that the load never rejects and there is no timeout, so `error` never becomes truthy.
- `apps/web/src/WorkspaceHost.tsx:71` — identical branch for the embedded settings surface.
- `apps/web/src/CompactSettings.tsx:53` — `LoadingState` wrapping the settings data fetch.
- `apps/web/src/LoadingState.tsx` — loading primitive (label + skeleton slot).
- `ErrorState` component — existing styled error with `message`, `retryLabel`, `busy`, `onRetry` props (same file usage above).
- Tokens: `apps/web/src/styles.css:3,4,6` — `--danger`, `--danger-soft`, `--text`, `--muted`, `--border`, `--surface`, `--accent`, motion tokens `--ui-motion-*`, `--ui-ease-*`.

## DESIGN
1. **Timeout wrapper.** Add `withTimeout(promise, ms)` helper (in `apps/web/src/` next to existing async helpers — discovery: reuse an existing timeout util if one exists; do not add a dependency). Wrap the lazy `import()`/data fetch at all three call sites with 8 000 ms. Rejection sets `error` exactly like a network failure — one code path.
2. **Error state (all three sites).** Reuse `ErrorState` with copy: message "Settings didn't load. Check your connection and try again."; `retryLabel="Reload settings"`; `busy={reloading}`; `onRetry` clears `error`, restarts timer + load. Below the message, a secondary line (`font-size:12px`, `color:var(--muted)`): "If this keeps happening, reload the app." No icon changes; inherits existing ErrorState styling.
3. **Cancel always available.** The modal's existing close (X / Esc / scrim) remains active during load and error — verify; do not gate `onClose` on load state.
4. **Retry feedback.** While a retry is in flight the button shows its `busy` state (existing prop) and is disabled; on repeated failure the same error state returns.
5. **Skeleton duration cap.** While under 8 s the skeleton stays exactly as today — no visual change on the happy path.
6. **LoadingState label** keeps "Opening settings…" (`font-size:12px`, `color:var(--muted)`, existing style). No new copy inside skeleton.

## EXECUTION_DAG
- T01 Discovery: find the lazy import for `Settings` and the data loader behind `CompactSettings`; find any existing timeout helper (`grep -rn 'setTimeout\|AbortSignal.timeout' apps/web/src`). Done: call sites + util choice recorded.
- T02 Timeout helper (T01): implement/reuse `withTimeout` with rejection `Error('settings-load-timeout')`; apply to the import in `App.tsx` and `WorkspaceHost.tsx`, and to the data load in `CompactSettings.tsx`. Done: forcing a never-resolving promise yields error state at ~8 s.
- T03 Error copy (T02): update `ErrorState` props at all three sites per DESIGN 2. Done: exact copy rendered, `role="alert"`.
- T04 Retry loop (T02): ensure `onRetry` resets error + restarts load and timer; button busy/disabled in flight. Done: second failure returns identical state.
- T05 Modal close (T02): verify X/Esc/scrim work during load and error; fix if gated. Done: always closes, no dangling timer (clear on unmount).
- T06 Tests: unit for `withTimeout` (resolve, reject, timeout, cleanup) and for the dialog state machine (load→error→retry→success, load→error→retry→error); fixture e2e: stub settings import to hang, assert skeleton→error at 8 s. Done: suite passes.

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
