# Plan: Thread navigation and run progress while a run is active

## META
- Feature: Unblock thread switching and surface run state during an active run
- Repo: skytuhua-org/Gen-V1
- Plan revision: r1, 2026-11-21
- Baseline: `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1467
- Status: planned, not implemented
- Provenance: real-user QA pass in the built fixture app (`vite build` + `scripts/review-host.ts`, http://127.0.0.1:4317). While the "Explore the component catalog" scenario run was active (>3 min), clicking any other sidebar thread did nothing, the Workspace and All Agents tab buttons were disabled, and the empty conversation showed the idle "What are we working on?" empty state with zero run indication. State survived reload.

## OBJECTIVE
A user whose agent is mid-run must be able to (a) switch to another thread and back without losing the run, and (b) see at a glance that the run is still alive on the originating thread and in the sidebar. Success: switching threads during a run always works; a thread with a live run never renders the idle empty state; the sidebar row shows persistent run activity until the run settles or aborts.

## REQUIREMENTS
- In scope: thread switching while a run is active; run progress indicator on the conversation canvas; per-thread run badge in the sidebar; composer draft preservation per thread; Stop affordance during a run.
- Out of scope: changing run orchestration, queuing semantics, or the send-button "Queue after current / Send side question / Stop agent" options (they already exist); mobile layout changes beyond inherited responsive rules.
- Behavior: opening another thread never cancels or detaches the run; returning to the busy thread shows live transcript plus progress header; if the run hangs >30 s without a transcript event the progress card must still render (no silent stall).
- Accessibility: run state announced via `role="status"`/`aria-live="polite"`; the Stop control is keyboard-focusable; progress is never conveyed by color alone.
- Motion: use only existing tokens `var(--ui-motion-*)` and `var(--ui-ease-*)`; spinner uses the existing `ui-item-in`/spin pattern, 1200 ms linear infinite.

## REPO_MAP (verified)
- `apps/web/src/App.tsx:449` — send-button `working` branch ("Queue after current"/"Send side question"/"Stop agent").
- `apps/web/src/ModelPicker.tsx:87` — `working` lock tooltip "Wait for the active run to finish to change models".
- `apps/web/src/ComposerToolbar.tsx:43` — Create PR disabled when `working`.
- `apps/web/src/App.tsx` (~`select` at the `selectNow`/`select` pair, ≈lines 761–764) — thread selection goes through `select`, which awaits `prepareSourceJournal()` **before** `selectNow(id)`; a journal flush that never resolves blocks every sidebar thread switch. This matches the observed freeze better than a `working` flag gate: the gate to fix is the unconditional pre-selection journal flush (make it non-blocking or raced with a timeout/fallback), not the selection itself.
- `apps/web/src/WorkspaceControls.tsx` — workspace preset and plugin-workspace buttons take `disabled={busy}` (and `disabled={busy||!envelope}`); `busy` is set while workspace operations run, which is the source of the disabled Workspace tab controls seen during the run.
- `apps/web/src/ThreadList.tsx` — discovery step T01 for the sidebar row markup the run badge is added to.
- `apps/web/src/styles.css:3,4,6` — tokens: `--canvas`, `--surface`, `--subtle`, `--hover`, `--border`, `--text`, `--muted`, `--accent`, `--accent-solid`, `--accent-fg`, `--accent-bg`, `--danger`, `--danger-soft`, `--pending`, `--success`, motion tokens `--ui-motion-hover/press/insert/tab/status/panel-enter`, `--ui-ease-move/enter`.
- `apps/web/src/styles.css:355` — `ui-item-in` insertion animation used by thread items/messages.
- `apps/web/src/LoadingState.tsx` — shared loading/skeleton+label primitive to reuse for the run progress card.

## DESIGN
1. **Thread switching always allowed.** `select` must not await `prepareSourceJournal()` before switching: flush the journal in the background (with error reported via the existing error toast), or race it against a 3 s timeout that falls back to `selectNow(id)`. A run stays bound to its thread, not to the selected view. No confirmation dialog; switching is instant. Workspace preset buttons keep `disabled={busy}` only while their own workspace operation runs — a thread run alone must not set `busy` (T01 verifies the `busy` source; if the run does set it, scope `busy` to workspace operations).
2. **Sidebar run badge.** On any thread row with a live run, right-align a 14 px circular spinner: `border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation: spin 1200ms linear infinite`. While hovered it is replaced by nothing (the row's existing controls still show on hover; spinner sits left of them with 4 px gap). When the run settles/aborts the spinner fades out over `var(--ui-motion-hover)`.
3. **Run progress card (empty conversation).** When a thread has a live run and no transcript messages yet, replace the "What are we working on?" empty state with a centered card: `max-width:340px`, `padding:24px 28px`, `background:var(--surface)`, `border:1px solid var(--border)`, `border-radius:16px`, `box-shadow:var(--elevation)`. Content top-to-bottom: 28 px spinner (same style, `--accent` top border); title "Working on it…" (`font-size:15px`, `font-weight:600`, `color:var(--text)`, `margin-top:12px`); live status line (`font-size:12.5px`, `color:var(--muted)`, `margin-top:4px`, `aria-live="polite"`) cycling the latest known step label or falling back to "Thinking"; elapsed time "0:47" (`font-variant-numeric:tabular-nums`, `font-size:12px`, `color:var(--muted)`); a secondary `.secondary` button "Stop agent" (12 px text, `padding:6px 14px`, `border-radius:20px`, `margin-top:16px`) wired to the same stop action as the send-button menu. Card enters with `ui-item-in` (`var(--ui-motion-insert) var(--ui-ease-enter)`).
4. **Busy-thread header strip.** On a busy thread with messages, render a slim strip above the composer: full-width, `height:28px`, `padding:0 16px`, `background:var(--accent-bg)`, `color:var(--accent-fg)`, `font-size:12px`, left: spinner 12 px + "Agent is working — {status}", right: elapsed time + text-button "Stop" (`color:var(--accent-fg)`, underline on hover). Strip slides in over `var(--ui-motion-panel-enter)` from the composer edge.
5. **Composer while locked.** Textarea stays editable (draft preserved); the locked state is already communicated by the send-button menu and ModelPicker tooltip — unchanged.
6. **30 s stall watchdog (display only).** If no run event arrives for 30 s, the status line swaps to "Still working — no update for 0:30" (same styling); purely informational, no error styling, resets on the next event.

## EXECUTION_DAG
Owner of every task is the single implementing worker (role=impl); handoff recipient for each is the same worker's next task, and T07 hands the verified branch to the front-end reviewer. Tasks do not overlap: T02 touches `App.tsx` selection/journal only, T03 the thread row component, T04 the empty-state/composer area, T05 the strip above the composer, T06 the status text only.

- T01 Discovery (owner impl): confirm `select` is the only thread-switch path, find the run-status source (run store / thread status field) and the `ThreadList` row markup. Done when exact lines are listed in a checkpoint. Handoff: T02.
- T02 Non-blocking selection (owner impl; depends T01): make `prepareSourceJournal()` non-blocking for view switches — e.g. fire-and-forget with error capture, or race against a 3 s timeout that falls back to `selectNow(id)`; keep the flush for paths that genuinely need it (persist-before-unload). Ensure view switch never touches run state. Done when switching threads mid-run is instant, the run continues, and returning shows the live transcript. Handoff: T03/T04/T05.
- T03 Sidebar run badge (owner impl; depends T01): add spinner element to the thread row per DESIGN 2. Done when badge appears only for threads with live runs in both themes. Handoff: T07.
- T04 Progress card (owner impl; depends T01): replace idle empty state when `working && messages.length===0` per DESIGN 3; elapsed timer (1 s interval, cleared on settle/unmount); Stop wired to the existing stop action; per-thread draft text typed before/during the run is preserved and restored on return (verify via draft store, fix if the lock path drops it). Done when every spec value matches and draft survives switching away and back. Handoff: T07.
- T05 Header strip (owner impl; depends T01): strip per DESIGN 4 above composer on busy threads with messages. Done when present in light+dark with `role="status"`. Handoff: T07.
- T06 Stall copy (owner impl; depends T04, T05): 30 s no-event watchdog swaps status text per DESIGN 6. Done when verified against a fixture scenario that emits one event then stalls. Handoff: T07.
- T07 Tests + handoff to front-end review (owner impl): unit — view-switch during mock run incl. journal-flush timeout fallback, badge visibility matrix, elapsed formatting, watchdog swap, draft preservation; browser e2e on `scripts/review-host.ts` catalog scenario asserting card + strip + navigation. Done when suite passes and a REVIEW checkpoint hands the PR to the reviewer.

## VALIDATION
- Repro: `pnpm build:widgets && vite build`, serve on `http://127.0.0.1:4317` via `scripts/review-host.ts`, open "Explore the component catalog".
- Accept when: (1) clicking another thread mid-run switches instantly and back; (2) empty busy thread shows the progress card, never the idle empty state; (3) sidebar spinner visible on busy thread until settle; (4) Stop works from card and strip; (5) all values match DESIGN in light and dark, desktop and 390 px wide.
- Evidence: screenshots of card, strip, badge; e2e run log.

## STATE
- Researched: tokens, existing lock affordances, LoadingState primitive.
- Not verified: exact `working` gate location for sidebar/tab clicks (T01).
- Next step: T01.

## REFERENCES
- Fixture: `scripts/review-host.ts` (catalog scenario).
- Tokens: `apps/web/src/styles.css` `:root` blocks.
