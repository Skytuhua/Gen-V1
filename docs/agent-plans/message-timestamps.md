# Plan: Message timestamps and date headers in threads

## META

| Field | Value |
|---|---|
| Feature | Show the send time on each message, plus a date header between days in long threads |
| Size | small (labels `feature`, `small`); no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | https://github.com/skytuhua-org/Gen-V1/issues/1282 |
| Plan file | `docs/agent-plans/message-timestamps.md` (identical to the issue body below the file link) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified by clone on 2026-11-21) |
| Related work | No existing issue or PR for message timestamps (searched issues for "timestamp" and "message timestamps"). Sibling approved features planned separately: Pick the terminal shell, "Open in Gen V1" in File Explorer, Comment on the diff (their own issues). #1236 (thread Markdown export) is separate; this plan does not change exports. |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 2, item 1: "Message timestamps (S): Show the send time on each message, with a sticky date header in long threads". Evidence cited by the proposal: the same feature is requested for the Claude Code desktop app ([anthropics/claude-code#111413](https://github.com/anthropics/claude-code/issues/111413)); Gen already has `apps/web/src/time-format.ts` but no conversation component uses it. Repository facts below were read from the baseline SHA; line numbers refer to that SHA. Decisions marked **DECIDED** were made by the planner (the owner delegated every non-approval decision); options not taken are recorded. |

**Design and animation ownership.** Leonardo's separate front-end team defines the animation and visual design for this feature: where the time sits on a message, its type size and colour, whether it is always visible or shown on hover, how the date header looks, whether and how it sticks to the top while scrolling, and any motion. This plan covers behavior, data, formatting rules, accessibility semantics and wiring only. Implementers render plain, unstyled semantic elements with the class names given in DESIGN §3 as neutral placeholders, add **no** new animation, transition, colour, spacing or `position: sticky` treatment, and hand the visual pass to that team (task T08).

## OBJECTIVE

**User problem.** Gen V1 threads show no times. A user returning to a long thread cannot tell when a message was sent, when the agent replied, or where yesterday's work ends and today's starts. Every message already carries a send time (`Message.createdAt`, ISO 8601, `packages/contracts/index.ts:4`, set by `now()` = `new Date().toISOString()` at `packages/core/service.ts:93`), but the renderer never shows it.

**Intended behavior.**
1. Each user and assistant message in a thread shows its send time as a local clock time (for example `3:42 PM` or `15:42`), following the existing Settings → General → **Time format** preference (`system` / `12h` / `24h`).
2. The full local date and time is available on hover/focus and to screen readers (for example `Friday, November 20, 2026 at 3:42 PM`).
3. When the visible messages of a thread span more than one local calendar day, a date header (`Today`, `Yesterday`, a weekday within the last 6 days, otherwise a date) appears before the first message of each day.
4. Labels follow the user's local time zone and locale and update when the day rolls over at local midnight.

**Measurable success.**
1. In the main transcript, scoped conversation pane and side chat, 100% of user/assistant messages with a valid `createdAt` render exactly one `<time>` element whose `dateTime` equals the stored ISO value (browser test T07).
2. A fixture thread with messages on 3 local days renders exactly 3 date headers in order, none for a single-day thread (unit T03 + browser T07).
3. Switching Time format between `12h` and `24h` changes every rendered message time without reload (browser T07).
4. No regression in existing suites listed in VALIDATION, including the UI guard and conversation find/scroll browser specs.

## REQUIREMENTS

### In scope

- R01 Send time on every `user` and `assistant` message in: the main conversation transcript (`apps/web/src/App.tsx:1178`), the scoped conversation pane (`apps/web/src/conversation-workspace/ConversationPane.tsx:82`), and side chat (`apps/web/src/SideChat.tsx:68`).
- R02 Time text is the local clock time at minute precision, formatted by the existing helper family in `apps/web/src/time-format.ts` (`formatLocalClock` / `localTimeOptions`), honouring `UiPreferences.timeFormat` (`packages/contracts/preferences.ts:47`, default `'system'` at `:64`).
- R03 Full date+time (weekday, month, day, year, time) is exposed via the `<time>` element's `title` (hover) and an accessible name; the machine value is `dateTime={createdAt}`.
- R04 Activity rows (`role: 'activity'`) and grouped work-activity rows get no time of their own; a grouped row produced by `groupWorkActivity` uses its head `message` (the row key) for date-header placement only. **DECIDED** (D3).
- R05 Date headers: inserted before the first visible row of each local calendar day **only when** the visible rows span ≥ 2 local days. Label rules (D4): same local day as now → `Today`; previous day → `Yesterday`; 2–6 days ago → weekday name (`Monday`); older, same year → `Month Day` (`November 3`); different year → `Month Day, Year`. Labels use `Intl.DateTimeFormat` with the browser locale (no hard-coded month names).
- R06 Day rollover: date labels recompute at the next local midnight while the thread is open, without reload (one timer per mounted transcript, cleared on unmount).
- R07 Invalid, empty or unparsable `createdAt` renders no time and does not create or split a date group (the row joins the previous row's day); never renders `Invalid Date`.
- R08 Timestamps and date headers are presentation only: they are excluded from message copy actions and conversation find matches, and they do not change message content, storage, contracts, exports (#1236) or runtime prompts.
- R09 Accessibility: date headers are `role="separator"` with `aria-label` set to the full date; the visible time has an accessible full date-time; nothing new receives focus or changes tab order; existing `sr-only` role labels ("You"/"Assistant") are kept.
- R10 History paging ("Load earlier", `historyStart` in `App.tsx:1167–1171`) keeps headers correct: headers are computed over the rows actually rendered, so loading older messages may add a header above the old first row and never duplicates one.
- R11 Visual design, placement, hover/always-visible choice, sticky behavior and motion are owned by the front-end team (T08). Implementation ships neutral, unstyled markup.

### Out of scope (v1)

- Relative times ("5 min ago") on messages; per-message edit times; read receipts.
- Showing timestamps in Markdown export (#1236), notifications, or thread list rows (thread list already has its own times).
- Server, contract, storage or migration changes (`createdAt` already exists on every message).
- A settings toggle to hide timestamps (option not taken, D6). The front-end team may propose one in T08; it would be a plan revision.
- Timestamps inside artifacts, input requests (`InputDecision`) or operation cards.

### Decisions (DECIDED) and options not taken

| ID | Decision | Options not taken and why |
|---|---|---|
| D1 | Use `Message.createdAt` (host send/accept time) as "send time" for both user and assistant messages. | Run start/end times: not on the message, and differ per row type. |
| D2 | Absolute local clock time at minute precision, via `time-format.ts` and the Time format preference. | Relative "ago" text: `time-format.ts:6–7` documents that relative values keep their own semantics; it also needs live ticking. |
| D3 | No time on `activity` rows; grouped work rows place by head message. | Time on every activity update: noisy; activity grouping already summarizes runs. |
| D4 | Date headers only when visible rows span ≥ 2 local days; Today/Yesterday/weekday/date labels. | Count-based "long thread" threshold (for example > 20 messages): a short thread spanning days still needs the break, and a long single-day thread does not. |
| D5 | Header is a structural element in the message list; stickiness is the front-end team's call (CSS on the placeholder class). | Implementing `position: sticky` in this plan: visual/layout is owned by the front-end team. |
| D6 | Always on; no capability flag and no new setting. Display-only change with no data or security impact. | Capability flag default off (as in #1242 R11): that feature changed contracts and prompts; this one does not. Setting toggle: deferred to T08 proposal. |
| D7 | One shared pure module + small components reused by all three surfaces. | Per-surface formatting: would drift between main, pane and side chat. |

### UX flows (behavior only)

1. User sends "fix the test" at 15:42; the message shows `3:42 PM` (Time format `system` in an en-US browser). Assistant reply at 15:44 shows `3:44 PM`.
2. User hovers or focuses the time: tooltip/accessible name reads the full local date and time.
3. User opens a thread started yesterday: a `Yesterday` header precedes yesterday's first message and a `Today` header precedes today's first message.
4. User changes Settings → Time format to `24h`: times change to `15:42` / `15:44` immediately.
5. The thread stays open past local midnight: `Today` becomes `Yesterday`, a new message gets a new `Today` header.
6. User clicks "Load earlier": older days' headers appear above; existing headers are not duplicated.

### Compatibility, performance, privacy

- No contract, schema, storage or API change; works with existing stored threads.
- Formatting cost: create `Intl.DateTimeFormat` instances once per (locale, timeFormat) and reuse (memoize in the helper module); grouping is O(n) over rendered rows. No measurable change to transcript render time is expected; T07 records render timing of a 100-message fixture before/after.
- Privacy: times are already stored locally; nothing new is sent or logged.
- Time zone: always the runtime's local zone (`Intl` default). Tests pin `TZ` and locale (VALIDATION).

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Path | Role | Fact |
|---|---|---|
| `packages/contracts/index.ts:4` | `Message` type | `createdAt: string` on every message; roles `user`/`assistant`/`activity`. |
| `packages/contracts/conversation-read-models.ts:24–27` | `conversationMessageSchema` | Scoped reader messages carry `createdAt: z.string().max(100)`. |
| `packages/core/service.ts:93` | host clock | `const now = () => new Date().toISOString();` used for message `createdAt`. |
| `packages/contracts/preferences.ts:47,64` | `UiPreferences.timeFormat` | `'system' \| '12h' \| '24h'`, default `'system'`. |
| `apps/web/src/time-format.ts` | formatting helpers | `localTimeOptions`, `formatLocalClock`, `formatLocalDateTime`; no conversation component imports them today. |
| `tests/time-format.test.ts` | unit tests | Existing tests for the helpers; extend in T02. |
| `apps/web/src/Settings.tsx:42` | Time format setting | Description already says "Clock format for thread and activity timestamps." |
| `apps/web/src/App.tsx:1160–1178` | main transcript | Builds `allMessages`, pages by `historyStart`, groups via `groupWorkActivity` into `messageRows`, renders `<div className={\`message message-${message.role}\`}>` per row. `getPreferences(snapshot.settings).timeFormat` is already used in this file (`:426`). |
| `apps/web/src/WorkActivity.tsx` | `groupWorkActivity` | Groups activity updates into rows `{message, updates}` (DISCOVERY in T01: exact row shape). |
| `apps/web/src/conversation-workspace/ConversationPane.tsx:82–83` | scoped pane | Renders `<article className="scoped-conversation-message">` per `message.head`. How it receives preferences: DISCOVERY. |
| `apps/web/src/SideChat.tsx:68` | side chat | Renders `<div className={'side-message side-message-'+message.role}>`. Preferences access: DISCOVERY. |
| `tests/side-chat.test.ts` | side chat tests | Existing suite; must stay green. |
| `tests/e2e/conversation-find.spec.ts`, `tests/e2e/conversation-scroll.spec.ts` (+ their fixtures/configs) | browser tests | Existing find and scroll specs; regression gate and pattern for the new spec. |
| `tests/ui-guard.test.ts`, `tests/ui-numeric-children.test.ts` (`pnpm test:ui-guard`) | UI guard | AST guard against numeric rendering leaks; whether formatted time strings need an allow-pattern: DISCOVERY in T01. |
| `scripts/lint-ui.ts` (`pnpm lint`) | UI lint | Must pass. |
| CSS for `.message`, `.scoped-conversation-message`, `.side-message` | styles | File locations: DISCOVERY (T01). Implementers add no rules except `.sr-only` reuse. |

## DESIGN

### 1. Pure helpers (`apps/web/src/time-format.ts`, extend)

```ts
/** Minute-precision local clock for a message send time; '' when invalid. */
export function formatMessageTime(createdAt: string, timeFormat: TimeFormat, locale?: string): string;
/** Full local date+time for title / accessible name; '' when invalid. */
export function formatMessageDateTime(createdAt: string, timeFormat: TimeFormat, locale?: string): string;
/** Local calendar day key 'YYYY-MM-DD' in the runtime zone; null when invalid. */
export function localDayKey(value: string | number | Date): string | null;
/** Date header label relative to `now`: 'Today' | 'Yesterday' | weekday | 'November 3' | 'November 3, 2025'. */
export function formatDayLabel(dayKey: string, now: Date, locale?: string): string;
/** Full date for the separator's aria-label, e.g. 'Friday, November 20, 2026'. */
export function formatDayFull(dayKey: string, locale?: string): string;
```

- Validity: `Number.isNaN(new Date(createdAt).getTime())` → invalid.
- `formatMessageTime` = `formatLocalClock(createdAt, timeFormat, locale)` (default options `{hour:'numeric', minute:'2-digit'}`).
- `formatMessageDateTime` = `formatLocalDateTime(createdAt, timeFormat, locale, {weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit'})`.
- Day difference uses local calendar dates (construct `new Date(y, m-1, d)` from keys), not `ms / 86400000`, so DST days are correct.
- `Today`/`Yesterday` are English literals like the rest of the UI (no i18n layer exists).

### 2. Day grouping (`apps/web/src/message-time.tsx`, new)

```ts
export type DayBreak = { dayKey: string; beforeIndex: number };
/** Indices where a header goes. Empty unless rows span >= 2 local days. Invalid times join the previous day. */
export function dayBreaks<T>(rows: readonly T[], createdAt: (row: T) => string | undefined): DayBreak[];
/** Re-renders at the next local midnight; returns the current Date. */
export function useLocalNow(): Date;
```

- `dayBreaks`: walk rows; first valid day starts group 0 (break at its index); new break when the valid day key differs from the current one; if total distinct days < 2 return `[]`. Rows before the first valid time belong to the first group.
- `useLocalNow`: `useState(new Date())` + `setTimeout` to the next local midnight (+1 s), re-armed after firing, cleared on unmount.

### 3. Components (same new file)

```tsx
export function MessageTime({createdAt, timeFormat}: {createdAt: string; timeFormat: TimeFormat}) {
  const short = formatMessageTime(createdAt, timeFormat);
  if (!short) return null;
  const full = formatMessageDateTime(createdAt, timeFormat);
  return <time className="message-time" dateTime={createdAt} title={full} aria-label={full} data-message-time="">{short}</time>;
}
export function ConversationDayDivider({dayKey, now}: {dayKey: string; now: Date}) {
  return <div className="conversation-day-divider" role="separator" aria-label={formatDayFull(dayKey)} data-day={dayKey}>{formatDayLabel(dayKey, now)}</div>;
}
```

- Class names `message-time` and `conversation-day-divider` are placeholders for the front-end team; no CSS is added by implementers.
- `data-message-time` / `data-day` attributes are stable test hooks and the exclusion markers for copy/find (R08).

### 4. Wiring

- **Main transcript (`App.tsx:1173–1178`)**: compute `const breaks = dayBreaks(messageRows, r => r.message.createdAt)` and `const now = useLocalNow()` (hook at the component level that owns the transcript; T01 identifies the exact component so hooks rules hold). Render `ConversationDayDivider` before row `i` when a break has `beforeIndex === i`. Inside each `user`/`assistant` row render `<MessageTime createdAt={message.createdAt} timeFormat={preferences.timeFormat}/>` as a sibling of the existing content, after the `sr-only` role label. Use the `timeFormat` source already used at `App.tsx:426` (`getPreferences(snapshot.settings).timeFormat`).
- **Scoped pane (`ConversationPane.tsx:82`)**: same pattern over `state.messages` with `m => m.head.createdAt`; time inside each `user`/`assistant` `<article>`. Pass `timeFormat` in as a prop from its caller (T01 finds the caller and the preferences source).
- **Side chat (`SideChat.tsx:68`)**: same over `messages` with `m => m.createdAt`; pass `timeFormat` as a prop.
- **Copy/find exclusion (R08)**: T01 locates the copy-message action and the conversation find implementation (`tests/e2e/conversation-find*` is the entry point). If they read `textContent` of the row, skip nodes with `[data-message-time]` / `[data-day]`; if they read `message.content`, no change.

### 5. Error handling

Invalid `createdAt` → `MessageTime` renders `null`; `dayBreaks` ignores the row for day changes. No throw paths; `Intl` with an unknown locale falls back to default by spec.

### 6. Security boundaries

Renderer-only; strings come from `Intl` over host-stored ISO values; React escapes text. No new IPC, routes or permissions.

### 7. Migration and rollback

No data migration. Rollback = revert the implementation PR(s); nothing persisted changes.

## EXECUTION_DAG

Order: T01 → T02 → T03 → (T04 ∥ T05) → T06 → T07; T08 (front-end team) can start after T03 lands markup and runs in parallel with T04–T07; T09 last.

### T01 Discovery checks (no product edits)
- Goal: resolve every DISCOVERY item in REPO_MAP and post findings as an issue comment.
- Deps: none. Owner: implementer.
- Steps: (a) read `WorkActivity.tsx` `groupWorkActivity` row shape; (b) find the React component that contains `App.tsx:1173–1178` and confirm a hook can be added there; (c) find callers of `ConversationPane` and `SideChat` and how they can receive `timeFormat`; (d) find copy-message and conversation-find implementations and whether they read DOM text; (e) run `pnpm test:ui-guard` on a scratch branch with a dummy `<time>{formatLocalClock(...)}</time>` to see whether the guard flags it, and record the allowed pattern; (f) locate the CSS files for the three message classes.
- Output: one comment with file:line answers for (a)–(f).
- Done when: every DISCOVERY row has a verified answer; if any contradicts DESIGN, BLOCK and request a plan revision.

### T02 Formatting helpers
- Goal: add the five helpers in DESIGN §1 to `apps/web/src/time-format.ts`.
- Deps: T01. Owner: implementer. Files: `apps/web/src/time-format.ts`, `tests/time-format.test.ts`.
- Tests (positive): `12h` → `3:42 PM`, `24h` → `15:42` for `2026-11-20T23:42:00Z` with `TZ=America/Los_Angeles`, locale `en-US`; Today/Yesterday/weekday/same-year/other-year labels; DST boundary (2026-03-08, 2026-11-01 in `America/Los_Angeles`) gives a 1-day difference. Negative: `''`, `'not-a-date'` → `''`/`null`.
- Done when: `vitest run tests/time-format.test.ts` passes.

### T03 Day grouping and components
- Goal: create `apps/web/src/message-time.tsx` with `dayBreaks`, `useLocalNow`, `MessageTime`, `ConversationDayDivider`.
- Deps: T02. Owner: implementer. Files: new `apps/web/src/message-time.tsx`, new `tests/message-time.test.ts` (or `.tsx`, matching T01 findings on how component tests run).
- Tests: single-day rows → `[]`; three days → three breaks at correct indices; invalid times join previous day; leading invalid rows; `MessageTime` with invalid value renders nothing; `useLocalNow` re-renders after fake-timer midnight and clears its timer on unmount.
- Done when: new tests pass; `pnpm typecheck` passes.

### T04 Main transcript wiring
- Goal: DESIGN §4 main transcript.
- Deps: T03. Owner: implementer. Files: `apps/web/src/App.tsx` (only the transcript block and imports).
- Tests: covered by T07; plus existing unit suites touching App render still pass.
- Done when: manual dev run shows times and headers in a multi-day thread; `pnpm typecheck`, `pnpm lint`, `pnpm test:ui-guard` pass.

### T05 Scoped pane and side chat wiring
- Goal: DESIGN §4 for `ConversationPane.tsx` and `SideChat.tsx`, including the `timeFormat` prop plumbing found in T01.
- Deps: T03. Owner: implementer (may be a different worker from T04; files do not overlap). Files: `ConversationPane.tsx`, `SideChat.tsx`, their callers (only the added prop).
- Tests: `tests/side-chat.test.ts` stays green; add an assertion that a side message renders `[data-message-time]` with the expected `dateTime`.
- Done when: tests pass; typecheck/lint/ui-guard pass.

### T06 Copy/find exclusion
- Goal: R08 per T01(d). If no change is needed, record that with evidence.
- Deps: T04, T05. Files: as found in T01.
- Tests: copying a message yields its content without the time text; searching for `PM` or `Today` in conversation find does not match timestamp/header nodes.
- Done when: tests pass or the "no change needed" evidence is posted.

### T07 Browser tests and regression
- Goal: end-to-end verification of R01–R10 and success metrics.
- Deps: T04, T05, T06. Files: new `tests/e2e/message-timestamps.spec.ts` with fixture/config following the `conversation-find` pattern (exact registration in `scripts/test-browser.ts`: DISCOVERY).
- Fixture: thread with messages at three local days (2 days ago, yesterday, today) incl. one activity row and one message with `createdAt: ''`; run with `TZ=America/Los_Angeles`, locale `en-US`, fixed clock.
- Assertions: one `<time>` per user/assistant message with matching `dateTime`; none on activity or invalid rows; 3 `[role=separator][data-day]` headers in order with labels weekday/`Yesterday`/`Today`; toggling Time format updates texts; "Load earlier" adds no duplicate header; advancing the clock past midnight relabels; 100-message render timing logged.
- Regression: `conversation-find.spec.ts`, `conversation-scroll.spec.ts`.
- Done when: all pass locally and in CI.

### T08 Front-end design pass (front-end team)
- Goal: define placement, visibility (always vs hover), typography, colour, date-header look, sticky behavior and any motion; style the placeholder classes `message-time` and `conversation-day-divider` in main transcript, scoped pane and side chat (light and dark themes, narrow widths).
- Deps: T03 merged (markup exists). Owner: Leonardo's front-end team. Recipient of the handoff in STATE.
- Constraints: keep the semantics in DESIGN §3 (element types, `role`, `aria-label`, `dateTime`, data attributes) and R08/R09; any behavior change (for example a hide-timestamps setting or relative times) is a plan revision on this issue.
- Done when: the team posts its spec/PR link on this issue and the styled UI passes T07 unchanged.

### T09 Docs and release gate
- Goal: CHANGELOG entry ("Messages now show their send time; long threads show date headers"); confirm Settings Time format description still accurate.
- Deps: T07, T08. Files: `CHANGELOG.md`.
- Done when: release gate in VALIDATION is met.

## VALIDATION

**Setup.** Node per `.nvmrc`; `pnpm install`. Pin `TZ=America/Los_Angeles` and locale `en-US` for unit and browser tests that assert text.

**Commands (planned; none executed by the planner).**

| Level | Command | Expected |
|---|---|---|
| Types | `pnpm typecheck` | pass |
| UI lint | `pnpm lint` | pass |
| UI guard | `pnpm test:ui-guard` | pass |
| Unit | `pnpm exec vitest run tests/time-format.test.ts tests/message-time.test.ts tests/side-chat.test.ts` | pass |
| Full unit | `pnpm test` | pass |
| Browser | `pnpm test:browser` (incl. new `message-timestamps.spec.ts`, existing `conversation-find`, `conversation-scroll`) | pass |
| Real user | Desktop build on Windows: open a thread spanning 2+ days, switch Time format, leave open past midnight (or change system clock) | behaves per UX flows 1–6 |

**Acceptance matrix.**

| Req | Task(s) | Check |
|---|---|---|
| R01 | T04, T05, T07 | `<time>` on every user/assistant message in all three surfaces |
| R02 | T02, T07 | 12h/24h/system text assertions |
| R03 | T02, T03, T07 | `title`, `aria-label`, `dateTime` assertions |
| R04 | T03, T04, T07 | no `<time>` on activity rows |
| R05 | T02, T03, T07 | header count/order/labels; none for single day |
| R06 | T03, T07 | fake-clock midnight relabel |
| R07 | T02, T03, T07 | invalid `createdAt` fixture renders no time, no split |
| R08 | T06 | copy and find exclusion tests |
| R09 | T03, T07 | separator role/label; tab order unchanged |
| R10 | T07 | Load earlier: no duplicate header |
| R11 | T08 | front-end team spec/PR linked on issue |

**Release gate.** All rows above pass in CI on the implementation PR(s); T08 styling merged or explicitly deferred by the owner; CHANGELOG updated.

## STATE

- Researched/decided: this plan r1 (decisions D1–D7).
- Implemented: nothing. Verified: nothing. Tests executed by planner: none (planning only).
- Owners: planner releases after publication (OWNER=NONE). Next implementer: unassigned. T08: Leonardo's front-end team (handoff posted on this issue).
- Risks: UI guard may flag rendered time strings (T01e); copy/find may read DOM text (T01d); `ConversationPane`/`SideChat` may lack an easy path to preferences (T01c).
- Exact next step: an implementer claims T01 on this issue and posts discovery results.

## REFERENCES

- Proposal source: Gen-V1 feature proposals batch 2, item 1 "Message timestamps (S)" (researched by the feature bot, approved by Leonardo 2026-11-21). Key content is reproduced in META/OBJECTIVE.
- External demand: https://github.com/anthropics/claude-code/issues/111413 (timestamps requested for the Claude Code desktop app).
- Repo: `apps/web/src/time-format.ts`, `packages/contracts/preferences.ts`, `apps/web/src/App.tsx`, `apps/web/src/conversation-workspace/ConversationPane.tsx`, `apps/web/src/SideChat.tsx` at `e883ac0327c834120d89c3697dec7380a342ba4d`.
- Plan contract: `AGENTS.md` "Complete Markdown plan publication".
- MDN `Intl.DateTimeFormat`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
