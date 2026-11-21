# Plan: Turn duration in the thread ("Worked for 1m 12s")

> **Design ownership (batch 7).** No separate front end team designs this feature. This plan specifies the visual design and the animation itself (section VISUAL_DESIGN_AND_MOTION), and implementers build exactly that. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T07). This issue stays open until that review is recorded on it.

## META

| Field | Value |
|---|---|
| Feature | Turn duration in the thread: a finished turn shows a quiet line such as "Worked for 1m 12s" under its last row, and an active turn shows a live elapsed count next to the existing working status |
| Size | small (labels `feature`, `small`); one issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue |
| Plan file | `docs/agent-plans/turn-duration.md` (identical to this body below the file link; SHA-pinned link at the top of the issue) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `4ca1134ae1e4f354064457cb5664b545712da4a9` (verified by clone on 2026-11-21) |
| Existing work | None for this feature. Searched issues and PRs for "turn duration", "worked for" and "elapsed": no match. Related open plans: [#1467](https://github.com/skytuhua-org/Gen-V1/issues/1467) (run progress card and strip with an elapsed time, see D7) and [#1282](https://github.com/skytuhua-org/Gen-V1/issues/1282) (message send times, see D8). |
| Implementation status | NOT_STARTED. Planning only; no code written |
| Source provenance | Feature proposal batch 7, item 6 ("Turn duration in the thread", small), filed directly under the maintainer's standing instruction (no approval step); static repository research at the baseline SHA (line numbers below refer to it); public prior art: [openai/codex#51062](https://github.com/openai/codex/issues/51062), [openai/codex#13720](https://github.com/openai/codex/issues/13720). Decisions marked **DECIDED** were made by the planner; the owner delegated every non-approval decision. |

## OBJECTIVE

**User problem.** A Gen thread never says how long the agent worked. While a run is active, the only signal is the `.working-status` row ("Generating…", "Running tool…", a Stop button) with no clock, so a user cannot tell a 20-second run from a 20-minute one without watching. After the run, nothing remains: the user cannot see or note how long a task took. In Codex, users rely on this ("Worked for 1h 11m 49s"); when it disappeared they filed [openai/codex#51062](https://github.com/openai/codex/issues/51062) because "the elapsed working time was useful information for understanding and documenting long-running Codex tasks". [openai/codex#13720](https://github.com/openai/codex/issues/13720) adds that the value must be cumulative for the whole turn and must not reset on status changes, or users stop trusting it.

**Correction to the proposal note.** The batch 7 note said "run records carry `startedAt` and optional `finishedAt`". At the baseline that is only true for `LearningReviewSummary` (`packages/contracts/index.ts:20`), the background learning review. Ordinary conversation runs have **no stored start or end time**: `Thread` has `runId`, `status` and `updatedAt` (`packages/contracts/index.ts:3`), `Message` has `createdAt` and `runId` (`:4`), and the run's end overwrites `thread.updatedAt`. This plan therefore adds a small host-side record (R01).

**Intended behavior.**
1. While a main-thread run is active, the working status row shows a live elapsed count after its activity label, for example `Generating…  1m 05s`, updated once per second.
2. When the run finishes, a line appears under the last transcript row of that run: `Worked for 1m 12s` (completed), `Stopped after 1m 12s` (stopped by the user) or `Interrupted after 1m 12s` (failed or interrupted).
3. Hovering or focusing the line shows the start and end clock times in the user's **Time format** setting (Settings → General, `system` / `12h` / `24h`), e.g. `Started 3:42 PM · ended 3:43 PM`.
4. The time is cumulative for the whole run: it starts when the run admits its first input and does not reset when the user sends a follow-up into the same run, when the status changes (generating, tool, compacting) or when the window loses focus.
5. Times survive reload and app restart because they are read from stored values, not from a browser timer.

**Measurable success.**
1. Unit: `formatTurnDuration` returns the exact strings in the R04 table for every listed input.
2. Service: a run that is started and then settles stores one `turnTiming` record with `startedAt` ≤ `endedAt` and the right `outcome` for each of completed, stopped, failed and interrupted (tests T02).
3. Browser: with a fixture snapshot holding two finished runs and one active run, the transcript shows exactly two duration lines with the expected text, and the working status shows a count that increases by 1 s when the page clock advances by 1 s (Playwright `page.clock`), and stays visible across a status change from `generating` to `tool` without resetting (T06).
4. No regression in the existing suites listed in VALIDATION, including the UI guard, conversation find, conversation scroll and frontend work-activity specs.

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows)

- **R01 Stored turn timing (host).** The host stores one record per conversation run, kind `turnTiming`, id = `runId`, thread = the run's thread: `{ runId, threadId, startedAt, endedAt?, outcome? }`. `startedAt` is set once, when a run with a new `runId` admits its first input (the `input.processing` transaction at `packages/core/service.ts:1645`). `endedAt` and `outcome` are set once, at the first end the run reaches (R02). Compaction runs (`runtimeIntent.kind === 'compaction'`) get no record. Times are ISO 8601 strings from the existing `now()` helper (`packages/core/service.ts:93`).
- **R02 End points and outcomes.** **DECIDED** mapping (D3):
  - `settled` event, not aborted, no unresolved input → `outcome: 'completed'` (this includes runs that end waiting for user input: the run itself is over).
  - `settled` event with `aborted` → `'stopped'`.
  - `settled` event with unresolved input → `'interrupted'`.
  - `run.stop` command (`service.ts:1174–1177`) → `'stopped'`. This path bumps `epoch` and clears `runId`, so the later `settled` event is ignored by the epoch check in `onRuntimeEvent` (`service.ts:1782`); the stop transaction must therefore stamp the record itself.
  - `runtimeFailure` (`service.ts:1729`, private method) → `'failed'`.
  - A record already holding `endedAt` is never changed (first end wins), which makes every path idempotent.
- **R03 Snapshot and thread read.** `Snapshot` gains optional `turnTimings?: TurnTimingV1[]` (contracts), filled in `packages/storage/store.ts` `snapshot()` (around `:242`) with `visible("turnTiming")` so archived threads are excluded like every other thread-scoped kind, and in the single-thread read in `apps/server/server.ts:143–163` (`GET /api/threads/:id/snapshot`) with `service.store.all('turnTiming', id)`. Old clients ignore the field; old snapshots without it render no durations.
- **R04 Duration format.** New pure helper `formatTurnDuration(ms: number): string` in `apps/web/src/time-format.ts`. Negative or non-finite input is treated as 0. Rules (**DECIDED**, D4), whole seconds, rounded down:

  | Input | Output |
  |---|---|
  | 0 ms, 999 ms | `<1s` |
  | 1,000 ms | `1s` |
  | 59,999 ms | `59s` |
  | 60,000 ms | `1m 0s` |
  | 72,000 ms | `1m 12s` |
  | 3,599,000 ms | `59m 59s` |
  | 3,600,000 ms | `1h 0m 0s` |
  | 4,309,000 ms | `1h 11m 49s` |
  | 93,784,000 ms | `26h 3m 4s` (hours are not rolled into days) |

  A second helper `isoDuration(ms)` returns the ISO 8601 duration for `<time dateTime>` (`PT1M12S`, `PT0S`, `PT1H11M49S`). Units are fixed English abbreviations (`h`, `m`, `s`), the same in every locale, like the Codex label; localisation is out of scope (D4).
- **R05 Finished-turn line.** In the main conversation transcript (`apps/web/src/App.tsx:1178`), for each `turnTiming` with `endedAt` whose thread is the rendered thread, render one duration line directly **after** the last rendered row (assistant, activity group or artifact host row) whose `message.runId === runId`. Labels: `Worked for {d}`, `Stopped after {d}`, `Interrupted after {d}` (for both `failed` and `interrupted`). If no rendered row carries that `runId` (the run wrote nothing, or its rows are outside the loaded history window), render nothing for it.
- **R06 Live count.** While `thread.runId` is set and a `turnTiming` for that `runId` has no `endedAt`, the existing `.working-status` row (`App.tsx:1182`) shows `formatTurnDuration(Date.now() - startedAt)` after its activity label. It updates once per second from one `setInterval` per mounted transcript, cleared on unmount and when the run ends, and paused while `document.visibilityState === 'hidden'` (recomputed on return, so it never drifts). If no record exists yet (the snapshot has not caught up), the count is not shown; nothing else in the row changes.
- **R07 Time format on hover.** The finished line's `title` and accessible description read `Started {clock} · ended {clock}` with `formatLocalClock(value, timeFormat)` from `time-format.ts`, honouring `UiPreferences.timeFormat` (`packages/contracts/preferences.ts:47`); when start and end fall on different local days, use `formatLocalDateTime(value, timeFormat, undefined, { dateStyle: 'medium', timeStyle: 'short' })` for both.
- **R08 Presentation only.** The line is outside `.message-content`, so Copy message, Conversation Find (`apps/web/src/conversation-find.ts:16` searches `[data-conversation-text], .message-content, .scoped-conversation-text`) and Markdown export do not include it. It is not sent to any model and does not change any message.
- **R09 Accessibility.** The finished line is a plain `<p>` containing a `<time dateTime={isoDuration}>`; it is readable in order, takes no focus of its own and adds nothing to the tab order. The live count is wrapped in `aria-hidden="true"`, because `.working-status` has `role="status"` and a per-second change would be announced every second; screen reader users get the final line instead. Colour is never the only carrier: the outcome is in the words.
- **R10 Retention.** Keep at most the latest 200 `turnTiming` records per thread (drop the oldest when inserting past the limit, in the same transaction), mirroring `MODEL_REQUEST_OBSERVATION_LIMIT` handling at `service.ts:1900–1902`. Records are thread-scoped store entities, so they must disappear with the thread on Forget / physical purge (verify in T02, R11).
- **R11 Privacy and purge.** The record contains only ids and two timestamps. T02 verifies with a test that forgetting a thread removes its `turnTiming` rows through the existing thread purge path; if that path enumerates kinds explicitly, add `turnTiming` to it.

### Out of scope (v1)

- Per-tool or per-step timing (proposal scope note: "No per-tool timing").
- Durations in the scoped conversation pane (`apps/web/src/conversation-workspace/ConversationPane.tsx`), side chat (`apps/web/src/SideChat.tsx`), thread list rows, notifications or exports.
- Time spent queued before a run starts (an `AFTER_CURRENT` message waiting for the previous run) is not counted (D2).
- A setting to hide durations (D6). Localised unit words (D4).
- Backfilling durations for runs that finished before this ships (no stored end time exists, D5).
- Changing #1467's progress card or strip; see D7 for how the two plans share code.

### Decisions

- **D1 (DECIDED) Store host timestamps; do not derive from messages.** Options: (a) derive from the first and last message `createdAt` of a run; (b) store start/end on the host. (a) is wrong for the end: the final assistant message's `createdAt` is set when the message is created, before streaming ends, and a run that ends in a tool call or stop has no closing message. (b) taken.
- **D2 (DECIDED) Start = run admission, cumulative over the run.** `startedAt` is the moment the run admits its first input, not the message send time, so a queued follow-up does not count its waiting time. Follow-ups that join the running run (`ctx.runId = thread.runId ?? randomUUID()`, `service.ts:1642`) keep the same record, so the count never resets mid-turn, as [codex#13720](https://github.com/openai/codex/issues/13720) asks.
- **D3 (DECIDED) Outcome words.** Three labels only (Worked for / Stopped after / Interrupted after); `failed` and `interrupted` share one label because the thread's own error notice (`App.tsx:1181`) and resume strip (`App.tsx:420`) already explain the cause.
- **D4 (DECIDED) Format.** `1h 11m 49s` style with every lower unit shown once a higher unit appears (matches the Codex example and stays stable width-wise with tabular numbers). English unit letters in v1.
- **D5 (DECIDED) No backfill.** Runs without a record show nothing; no migration.
- **D6 (DECIDED) No toggle in v1.** The line is one 12 px muted row; a toggle can be a later revision.
- **D7 (DECIDED) Coordination with #1467.** #1467 plans an elapsed time in its run progress card and busy-thread strip. Both plans must use the same `formatTurnDuration` helper and the same `turnTiming.startedAt` source, so the numbers match everywhere. Whichever lands second reuses the other's helper and hook instead of adding a second timer. If #1467's strip lands first and already shows elapsed time above the composer, this plan's live count (R06) still goes in `.working-status`; if #1467 replaces `.working-status`, R06 moves into #1467's status element unchanged (record the move in a checkpoint).
- **D8 (DECIDED) Coordination with #1282.** #1282 adds a send time to each message. The duration line is a separate row after the run's last row, not inside the message, so the two never overlap.

## REPO_MAP (verified at baseline unless marked)

| Path | What is there | Change |
|---|---|---|
| `packages/contracts/index.ts:3–4` | `Thread` (`runId`, `status`, `updatedAt`), `Message` (`createdAt`, `runId`) | none |
| `packages/contracts/index.ts:20` | `LearningReviewSummary` with `startedAt`/`finishedAt` (learning review only) | none |
| `packages/contracts/index.ts:23` | `Snapshot` | add `turnTimings?: TurnTimingV1[]` and export `TurnTimingV1` |
| `packages/core/service.ts:84` | `FinishRecord` (input ids only, no times) | none |
| `packages/core/service.ts:1642–1667` | run admission: `ctx` created, thread set `working`, outbox inputs set `processing` | put `turnTiming` when `!thread.runId` and the run is not a compaction |
| `packages/core/service.ts:1906–1923` | `settled` event handling, thread status chosen | stamp `endedAt`/`outcome` |
| `packages/core/service.ts:1174–1177` | `run.stop` command transaction | stamp `stopped` |
| `packages/core/service.ts:1729–1745` | `runtimeFailure` (`run.failed` internal transaction) | stamp `failed` |
| `packages/core/service.ts:1898–1902` | `modelRequest` bounded retention pattern | copy pattern for R10 |
| `packages/storage/store.ts:207–245` | `visibleEntities()` and `snapshot()` | add `turnTimings: visible("turnTiming")` |
| `apps/server/server.ts:143–163` (`GET /api/threads/:id/snapshot`) | single-thread snapshot read | add `turnTimings` |
| `apps/web/src/time-format.ts` | `localTimeOptions`, `formatLocalClock`, `formatLocalDateTime` | add `formatTurnDuration`, `isoDuration` |
| `apps/web/src/App.tsx:1173` | `messageRows = groupWorkActivity(...)` | compute last row index per `runId` |
| `apps/web/src/App.tsx:1178` | transcript row render | render `<TurnDuration>` after the run's last row |
| `apps/web/src/App.tsx:1182` | `.working-status` row with activity label and Stop | add live count |
| `apps/web/src/WorkActivity.tsx` | `groupWorkActivity` (rows keep `message.runId`) | none |
| `apps/web/src/styles.css:326–328, 382` | `.working-status` styles | add `.turn-elapsed` |
| `apps/web/src/styles.css:354–369` | `ui-item-in` keyframes, `data-arrival` insertion animation, reduced-motion overrides | add `.turn-duration[data-arrival]` to both lists |
| `apps/web/src/conversation-find.ts:16` | Find block selector | none (line stays outside the selector) |
| `tests/time-format.test.ts` | format helper tests | extend |
| `tests/service.test.ts` | core service tests | add turn timing cases (or new `tests/turn-timing-service.test.ts` if setup is clearer) |
| `tests/e2e/frontend.spec.ts:~520` | work activity spec asserting `.working-status` | must still pass |
| `tests/e2e/task-interface-fixture.ts` | `taskFixture` snapshot builder | reuse for T06 |
| **Discovery** | the thread Forget / physical purge path (M05) | T02 finds it and confirms `turnTiming` rows are removed |
| **Discovery** | new `TurnDuration.tsx` component file | new file in `apps/web/src/` |

## DESIGN

### Contract

```ts
// packages/contracts/index.ts
export type TurnOutcome = 'completed' | 'stopped' | 'interrupted' | 'failed';
export interface TurnTimingV1 { runId: string; threadId: string; startedAt: string; endedAt?: string; outcome?: TurnOutcome }
// Snapshot gains:  turnTimings?: TurnTimingV1[]
```

### Host flow

```
input.processing (new runId, not compaction) ── put turnTiming {startedAt: now()}
                                                  │
     ┌──────────────────────┬─────────────────────┼─────────────────────────┐
 settled(!aborted,resolved) settled(aborted)  settled(unresolved)   run.stop / runtimeFailure
     │ completed            │ stopped          │ interrupted          │ stopped / failed
     └────────── endTurn(runId, outcome): if record && !record.endedAt → put {...record, endedAt: now(), outcome}
```

One private helper in `service.ts`:

```ts
private endTurn(runId: string, threadId: string, outcome: TurnOutcome) {
  const timing = this.store.get<TurnTimingV1>('turnTiming', runId);
  if (!timing || timing.endedAt) return;
  this.store.put('turnTiming', runId, threadId, { ...timing, endedAt: now(), outcome });
}
```

It is called inside the existing transactions (no new transaction), so the record and the thread status change commit together. `startTurn` runs inside the `input.processing` transaction only when `!thread.runId` (a new run) and `this.store.get('runtimeIntent', ctx.runId)?.kind !== 'compaction'`, then applies R10 retention.

### Web flow

- `turnTimings` for the rendered thread are indexed by `runId` once per render (`useMemo` on `snapshot.turnTimings`).
- For finished lines: walk `messageRows` once, remember the last index per `message.runId` (rows from `groupWorkActivity` keep their head message; also check every `updates[i].runId` of an activity group). After rendering row *i*, render `<TurnDuration timing={...} timeFormat={preferences.timeFormat} arrival={...}/>` for each finished timing whose last index is *i*.
- `arrival` is true only when the timing ended while this window watched it (it was seen without `endedAt` earlier in this mount); a reloaded thread shows lines without animation, matching how `liveMessages` gates `data-arrival` for messages (`liveMessages`, `App.tsx:509`; used at `:1178`).
- Live count: a small hook `useTurnElapsed(startedAt?: string): number | null` in `TurnDuration.tsx` returns elapsed ms, ticking every 1,000 ms with `setInterval`, paused on `visibilitychange` hidden, clamped at ≥ 0 (host and browser clocks are the same machine for the local host; a paired remote host with clock skew can only show a short or zero count, never a negative one).

### Error handling and security

- No new command, route or authority. Records are written only by host transactions that already own the run.
- A missing, malformed or reversed record (`endedAt` < `startedAt`) renders `<1s`, never a negative or `NaN` string; a record without `endedAt` for a thread that is no longer running (host crashed mid-run) renders nothing.
- Archived threads' records are excluded by `visible()`; forgotten threads' records are purged (R11).

## VISUAL_DESIGN_AND_MOTION

All values use existing tokens from `apps/web/src/styles.css`; no new colours.

1. **Finished line (`.turn-duration`).** A `<p>` directly under the run's last row, aligned with the message column's left edge. `display:flex; align-items:center; gap:6px; margin:6px 0 0; font-size:12px; line-height:1.6; color:var(--muted); font-variant-numeric:tabular-nums;`. Leading lucide `Timer` icon (`lucide-react` 0.468.0 ships it), `size={12}`, `strokeWidth={1.75}`, `aria-hidden="true"`, inheriting `currentColor`. Text: `Worked for ` + `<time>1m 12s</time>`. No background, border or pill. For `Stopped after` and `Interrupted after` the text stays `var(--muted)` (no danger colour; the outcome is in the words). `cursor:default`; the `title` tooltip carries R07's start/end times.
2. **Spacing in the transcript.** The line belongs to the run above it: keep the transcript's existing gap below the line (no extra margin-bottom), so the next user message keeps its normal distance.
3. **Live count (`.turn-elapsed`).** A `<span aria-hidden="true" className="turn-elapsed">` placed between the activity pill (`.working-status>span`) and the Stop button: `color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; min-width:5ch;` so `9s` → `10s` → `1m 0s` changes shift the Stop button as little as possible. It must not get the accent pill style: update the `.working-status>span` selector (`styles.css:382`) to `.working-status>span:not(.turn-elapsed)` or give the pill its own class.
4. **Motion.** The live count changes text in place each second with **no** animation (no fade, no slide, no number roll). A finished line that appears while the user watches enters with the shared insertion animation: `animation: ui-item-in var(--ui-motion-insert) var(--ui-ease-enter)` via `.turn-duration[data-arrival="true"]`, added to the `:where(...)` list at `styles.css:358`. The same selector is added to the reduced-motion override at `styles.css:369` (which swaps to `ui-popover-fade` at `var(--ui-motion-press)`). Lines restored from storage render with no animation.
5. **Light and dark.** Only `--muted` and `currentColor` are used, so both themes work; verify contrast of `--muted` at 12 px matches the existing `.working-status` text (same token, same size).
6. **Narrow widths (390 px).** The line never wraps the label from the duration: `white-space:nowrap` on the `<time>`; the whole line may wrap after the icon only if the column is narrower than the text.

## EXECUTION_DAG

Owner of every task is the single implementing worker (role=impl), unless the coordinator splits T02 (host) and T03–T05 (web) between two workers; the ownership boundaries below do not overlap. Each task's handoff recipient is the next task's owner; T07 hands to the front end team.

- **T01 Contract and format helpers.** Depends: none. Edits: `packages/contracts/index.ts` (add `TurnOutcome`, `TurnTimingV1`, `Snapshot.turnTimings?`); `apps/web/src/time-format.ts` (add `formatTurnDuration`, `isoDuration`); `tests/time-format.test.ts` (every R04 row plus `isoDuration` cases `0 → PT0S`, `72000 → PT1M12S`, `4309000 → PT1H11M49S`, negative → `PT0S`, `NaN` → `<1s`/`PT0S`). Output: types and helpers others import. Done when `pnpm typecheck` and `pnpm vitest run tests/time-format.test.ts` pass. Ownership: these three files only.
- **T02 Host recording.** Depends: T01. Edits: `packages/core/service.ts` (`startTurn` in `input.processing` for a new non-compaction run; `endTurn` in `settled`, `run.stop`, `runtimeFailure`; R10 retention), `packages/storage/store.ts` (`turnTimings` in `snapshot()`), `apps/server/server.ts` (single-thread read). Discovery: find the thread Forget / physical purge code (search `packages/storage/store.ts` and `packages/core` for the M05 purge) and confirm thread-scoped entities are removed by `thread_id`; add `turnTiming` explicitly only if that path lists kinds. Tests (in `tests/service.test.ts` or a new `tests/turn-timing-service.test.ts`, using the service test harness already in `tests/service.test.ts`): positive — completed, stopped via `run.stop`, aborted settle, unresolved settle, `runtimeFailure` each give one record with the right outcome and `startedAt ≤ endedAt`; a follow-up sent into a running run does not create a second record or move `startedAt`; negative — a compaction run creates no record; a second end call does not change `endedAt`; a late `settled` after `run.stop` (epoch bumped) leaves `stopped`; 201 runs keep 200 records; an archived thread's records are absent from `snapshot()`; a forgotten thread's records are gone. Done when those tests pass and existing `tests/service.test.ts` passes. Ownership: host files above.
- **T03 TurnDuration component and hook.** Depends: T01. New `apps/web/src/TurnDuration.tsx` exporting `TurnDuration({timing, timeFormat, arrival})` (VISUAL 1, R05 labels, R07 title, R09 markup) and `useTurnElapsed(startedAt)` (R06 ticking rules). Unit test with `renderToStaticMarkup` (pattern of `tests/ui-numeric-children.test.ts`): each outcome's text; `dateTime` value; title in `12h` and `24h`; cross-day title uses date+time; malformed record renders `<1s`; no raw `0` or `NaN` in markup. Hook test with Vitest fake timers: ticks each second, pauses when hidden, clears on unmount. Done when tests pass. Ownership: the new file and its tests.
- **T04 Transcript wiring.** Depends: T02 (snapshot field), T03. Edits: `apps/web/src/App.tsx` around `:1173–1182`: index timings by `runId`, compute last row per `runId`, render `TurnDuration` after that row, `arrival` per DESIGN; add the live count to `.working-status`. Keep the existing `.working-status` text and Stop button unchanged so `tests/e2e/frontend.spec.ts:520` and `tests/split-app-browser.test.ts:455–547` still pass. Done when the fixture from T06 renders as specified. Ownership: `App.tsx` transcript block only.
- **T05 Styles.** Depends: T03. Edits: `apps/web/src/styles.css` (`.turn-duration`, `.turn-elapsed`, `.working-status>span` selector fix, `data-arrival` and reduced-motion lists) exactly per VISUAL_DESIGN_AND_MOTION. Run `pnpm lint` (UI lint) and `pnpm test:ui-guard`. Done when both pass and the T06 screenshots match the spec. Ownership: `styles.css` lines named above.
- **T06 Browser test.** Depends: T04, T05. New Playwright spec `tests/e2e/turn-duration.spec.ts` (with a config following `tests/e2e/runtime-presentation.playwright.config.ts`, using `serveTaskFixture`/`taskFixture`). Fixture: thread with run A (user, assistant `runId:'a'`, timing 72 s completed), run B (activity + assistant `runId:'b'`, timing 4,309 s stopped), active run C (`thread.runId:'c'`, timing started 65 s before the frozen clock, no end). Assertions: exactly two `.turn-duration` lines with texts `Worked for 1m 12s` and `Stopped after 1h 11m 49s`, each after its run's last row; `<time dateTime>` values; title in `12h` and, after switching the preference fixture, `24h`; `.working-status` shows `1m 5s`, then `1m 6s` after `page.clock.runFor(1000)`; changing `usage.activity` from `generating` to `tool` keeps counting without reset; Conversation Find for `Worked` finds no match; Copy message on run A's reply copies only its text; reduced motion (`page.emulateMedia({reducedMotion:'reduce'})`) shows the line with no `ui-item-in` animation. Capture light, dark and 390 px screenshots when `HARNESS_CAPTURE_UI=1`. Done when the spec passes in `pnpm test:browser` and the existing `conversation-find`, `conversation-scroll` and `frontend` specs pass.
- **T07 Front end team review handoff.** Depends: T01–T06. Open the implementation PR linked to this issue with the screenshots, post a REVIEW checkpoint on this issue, and **send the finished work to the front end team for review** (mention them on the PR and the issue, with the screenshots and the VISUAL_DESIGN_AND_MOTION section). Address their feedback; any visual change they ask for is a plan revision recorded on this issue. Done when the front end review result is recorded on this issue.

## VALIDATION

**Setup.** `pnpm install` at the repo root (Node from `.nvmrc`).

| Level | Command | Expected |
|---|---|---|
| Types | `pnpm typecheck` | 0 errors |
| Unit | `pnpm vitest run tests/time-format.test.ts` and the T03 test file | all pass |
| Service | `pnpm vitest run tests/service.test.ts` (and `tests/turn-timing-service.test.ts` if created) | all pass |
| UI guard | `pnpm test:ui-guard`; `pnpm lint` | pass |
| Browser | `pnpm test:e2e` (or `pnpm build` then `pnpm test:browser`) including `tests/e2e/turn-duration.spec.ts` | pass; existing `frontend`, `conversation-find`, `conversation-scroll` specs still pass |
| Real user | Desktop or `pnpm dev`: send a prompt that runs ~30 s, watch the count, let it finish, reload, stop a second run, restart the app | count rises each second without reset across tool calls; `Worked for …` after the reply; `Stopped after …` for the stopped run; both persist after restart; hover shows start/end in the chosen Time format |

**Acceptance matrix.**

| Req | Task | Check |
|---|---|---|
| R01 | T02 | record created once per new run, none for compaction |
| R02 | T02 | five end paths give the right outcome; first end wins |
| R03 | T02, T06 | `turnTimings` in full and single-thread snapshots; fixture renders |
| R04 | T01 | every table row |
| R05 | T04, T06 | two lines in the right places and texts |
| R06 | T03, T04, T06 | count ticks, no reset on status change, pauses hidden |
| R07 | T03, T06 | 12h/24h titles, cross-day title |
| R08 | T06 | Find and Copy exclude the line |
| R09 | T03, T06 | `<time dateTime>`, live count `aria-hidden`, no new tab stop |
| R10 | T02 | 200-record cap |
| R11 | T02 | forgotten thread leaves no `turnTiming` rows |
| Visual | T05, T06, T07 | screenshots match VISUAL_DESIGN_AND_MOTION; front end review recorded |

**Release gate.** All rows above checked with evidence on this issue, CI green on the implementation PR, and the front end team review recorded. Planned tests only; none has been executed (planning only).

## STATE

- Researched and decided: everything above, at baseline `4ca1134`.
- Implemented: nothing. Verified: nothing.
- Owners: none yet. Branches: none for implementation.
- Risks: (1) another end path not found in research (for example a host restart that marks running threads interrupted on startup) would leave a record without `endedAt`; T02 must search for every place that clears `thread.runId` (`grep -n "runId: null\|runId:null" packages/core/service.ts`) and call `endTurn` there with `'interrupted'`. (2) Overlap with #1467 if both land at once (D7).
- Next step: T01.

## REFERENCES

- Issue for the overlapping run progress plan: https://github.com/skytuhua-org/Gen-V1/issues/1467
- Message timestamps plan: https://github.com/skytuhua-org/Gen-V1/issues/1282
- Codex users on the removed "Worked for" display: https://github.com/openai/codex/issues/51062 — "completed Codex runs showed the total elapsed working time, for example: 'Worked for 1h 11m 49s'".
- Codex cumulative timer request: https://github.com/openai/codex/issues/13720 — "show cumulative elapsed since the most recent user message … should not reset on agent switch, status hide/show, background/foreground transitions".
- Baseline commit: https://github.com/skytuhua-org/Gen-V1/commit/4ca1134ae1e4f354064457cb5664b545712da4a9
