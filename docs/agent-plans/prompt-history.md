# Plan: Up-arrow prompt history in the composer (recall and search earlier prompts)

> **Design ownership (batch 5).** There is no separate front end team designing this feature: this plan itself specifies the visual design and the animation (section VISUAL_DESIGN_AND_MOTION). Implementers build exactly that specification. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T07) and does not close this issue until that review is recorded on the issue.

## META

| Field | Value |
|---|---|
| Feature | Up-arrow prompt history: Up/Down in an empty composer steps through prompts the user already sent (this thread first, then other threads); Ctrl+R opens a search over the same history |
| Size | small (labels `feature`, `small`); one issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue |
| Plan file | `docs/agent-plans/prompt-history.md` (identical to this body; SHA-pinned link at the top of the issue) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified by clone) |
| Existing work | None. `gh issue list --search "prompt history"` returns no matching issue; no `promptHistory`/`inputHistory` code exists in `apps/web/src`. Related but different: Saved drafts (`apps/web/src/SavedDrafts.tsx`, named drafts the user saves on purpose) and thread search (sidebar, `apps/web/src/thread-search.ts`) |
| Implementation status | NOT_STARTED. Planning only; no code written |
| Source provenance | Feature proposal batch 5, item 2 ("Up-arrow prompt history", small), filed directly per the maintainer's standing instruction; static repository research at the baseline SHA; public prior art: Codex CLI developer commands (Up/Down restores draft history, Ctrl+R searches prompt history) and openai/codex#24298 (resumed thread prompts are recalled before global history) |

## OBJECTIVE

**Problem.** People often resend or tweak a prompt they already wrote ("run the tests again", a long instruction with one word changed). In Gen today the only way is to scroll the conversation, select the old message, copy it and paste it. In the main composer (`apps/web/src/App.tsx`, the `<textarea aria-label="Message">` in `function Composer`) the Up and Down keys do nothing except move the caret; they only have a meaning while the slash-command menu is open (`apps/web/src/ComposerCommands.tsx`, `keyDown` handles `ArrowUp`/`ArrowDown` only when `open`). Terminal agents solved this long ago: the Codex CLI documents "Press Up or Down to restore draft history" and "Press Ctrl+R to search prompt history, then press Enter to use a match or Escape to cancel", and openai/codex#24298 (merged) fixed the case where a resumed thread fell through to another thread's prompt: "prompts from the resumed thread are recalled first, with global history only as a fallback".

**Intended behavior.**
1. In an empty composer, **Up** puts the most recent prompt the user sent in this thread into the composer. Each further Up goes one prompt older. After the oldest prompt of this thread, Up continues with prompts from the user's other threads, newest first.
2. **Down** goes back toward newer prompts; Down past the newest entry restores what the composer held before history started (normally empty).
3. **Escape** while stepping through history restores that original draft and leaves history.
4. Typing, pasting or any other edit of a recalled prompt turns it into an ordinary draft (saved like any draft) and ends history stepping; the user then sends it with the normal send key.
5. **Ctrl+R** (⌘R on macOS, following the registry's "Ctrl means either platform modifier" rule) in the composer opens a "Search prompts" popover above the composer: a search field plus a list of matching earlier prompts. Enter puts the selected prompt in the composer, Escape closes and restores focus to the composer without changing the draft.
6. Recall never sends anything by itself.

**Measurable success.** In a thread where the user sent `alpha`, then `beta`: focus the empty composer, Up shows `beta`, Up shows `alpha`, Up shows the newest prompt of the next most recent other thread, Down, Down shows `beta`, Down shows the empty draft; with `beta` recalled, typing `!` makes the draft `beta!` and the next Up only moves the caret. Ctrl+R, typing `alp`, Enter fills `alpha`. Every step takes under one frame of perceived delay (no network call for the first 300 prompts of a thread).

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows in VALIDATION)

- **R01 History source.** History entries are the `content` of `Message` records with `role: 'user'` (`packages/contracts/index.ts`, `interface Message`) that are already in the app: `snapshot.messages`. Order: (a) the current thread's user prompts, newest first; then (b) user prompts of every other non-archived thread in `snapshot.threads`, ordered by message `createdAt`, newest first. Archived threads (`snapshot.archivedThreads`) and messages of threads not in `snapshot.threads` are excluded.
- **R02 Older prompts of the current thread.** The snapshot keeps at most 300 messages per thread (`MESSAGE_WINDOW = 300` in `packages/storage/store.ts`; the rest is counted in `snapshot.messagesTruncated[threadId]`). When Up reaches the oldest in-snapshot prompt of the current thread and `snapshot.messagesTruncated[thread.id] > 0`, history loads the next older page with the existing `getThreadMessages(threadId, beforeId, 300)` (`apps/web/src/api.ts`) before falling through to other threads. Other threads are never paged (only their in-snapshot prompts are used).
- **R03 Clean entries.** An entry is the text the user typed, not the serialized attachments: when the message content contains the terminal-excerpt block that `serializeTerminalExcerpts` (`apps/web/src/terminal-excerpts.ts`) appends (`"\n\nTerminal excerpt · project "`), only the part before the first such block is used. Entries that are empty after `trim()` are dropped. Consecutive duplicates (identical text, after trimming trailing whitespace) are collapsed to one entry, keeping the newest. At most 1,000 entries are kept in memory.
- **R04 When Up/Down mean history.** Up starts history only when **all** hold: no Alt/Ctrl/Meta/Shift modifier; not composing (IME, `isComposing` from `packages/ui-shell/list-navigation.ts`); the slash-command menu did not consume the key (`commands.current?.keyDown(event)` returns false, i.e. it keeps priority); the textarea is enabled; and the draft is empty after `trim()`. While stepping (state `browsing`), Up moves older only when the caret is on the first line of the recalled text (no `\n` before `selectionStart`), and Down moves newer only when the caret is on the last line (no `\n` at or after `selectionEnd`); otherwise the key moves the caret as normal. In any other state Up/Down keep their default caret behavior. When the key is used for history it calls `preventDefault()`.
- **R05 Caret.** After each recall the caret is placed at the end of the recalled text and the textarea scrolls to show it.
- **R06 Leaving history.** Any `onChange` whose value differs from the recalled entry ends `browsing` (the text becomes an ordinary draft through the existing `updateDraft`, so it is journaled under `draft:<threadId>` like any draft). Escape while `browsing` restores the stashed original draft and ends `browsing`, and stops propagation so the global Stop shortcut (default `Escape`, `preferences.keybindings.stop`) does not also fire. Sending, switching threads, or the composer unmounting ends `browsing`.
- **R07 Drafts are not overwritten by browsing.** While `browsing`, the recalled text is shown in the textarea but is **not** written to the draft journal on each step; only the stashed original draft stays in the journal. If the window closes while browsing, the original draft is what returns. (Writing happens only on R06's "edit" exit.)
- **R08 Predictions.** If a next-message prediction (`useComposerPrediction`, ghost text `.composer-prediction-text`) is showing, Up dismisses it (`prediction.dismiss()`) and recalls history. While `browsing`, the prediction hook receives `blocked: true` so no ghost text appears over a recalled prompt.
- **R09 Search (Ctrl+R).** With focus in the composer textarea, `Ctrl+R` (canonical chord `Ctrl+R`; on macOS ⌘R) calls `preventDefault()` (this also stops the browser's page reload in the web build; the desktop app's custom menu in `apps/desktop/main.ts` `installApplicationMenu` has no reload accelerator) and opens the Search prompts popover (VISUAL_DESIGN_AND_MOTION). Matching: case-insensitive substring of the query in the entry text; an empty query lists all entries; results keep R01 order; at most 50 rows shown. Each row shows the first line of the prompt (ellipsis) and, for entries from another thread, that thread's title. Up/Down move the active row, Enter or click puts the prompt in the composer as an ordinary draft (through `updateDraft`, so it is journaled) with the caret at the end, Escape or outside click closes without change. Focus returns to the composer textarea in every close path.
- **R10 Composers covered.** The main `Composer` in `apps/web/src/App.tsx` (used for ordinary and canvas threads, including the shared-composer path through `sharedComposers.edit`) and `ScopedConversationComposer` (`apps/web/src/ScopedConversationComposer.tsx`). In the scoped composer, the "current thread" is `context.owner.threadId`. For a new conversation (`key === 'new'`, no thread yet) the current-thread part is empty and history starts with other threads.
- **R11 Shortcut registry.** Three entries are added to `KEYBOARD_BINDINGS` in `apps/web/src/keyboard-bindings.ts` with scope `Conversation`: `prompt-history-previous` (`ArrowUp`, label "Previous prompt from history"), `prompt-history-next` (`ArrowDown`, label "Next prompt from history"), `prompt-history-search` (`Ctrl+R`, label "Search prompt history"), each listing the module that compares the key as its handler, so the Keyboard Shortcuts reference in Settings lists them and `tests/keyboard-bindings.test.ts` passes. They are not rebindable in v1 (no `preference`).
- **R12 Accessibility.** The textarea gets `aria-keyshortcuts` including the three chords (via `ariaKeyShortcuts([...])`). Each recall updates a polite live region with "Prompt 3 of 42 from history" (current-thread entries) or "Prompt 3 of 42 from history, from <thread title>" (other threads). The search popover is a `listbox` driven by `aria-activedescendant` from the search field, like the slash-command menu.
- **R13 Privacy and data.** No new storage, no new server route, no new network call except R02's existing messages endpoint for the current thread. History is read from data the window already holds; nothing is sent to a model.

### Out of scope (v1)

- A setting to turn history off or rebind its keys (Codex CLI has none; can be added later through the `keybindings` preference).
- History for the side composers (`SideThreadComposer` in `App.tsx`, `SideChat.tsx`) and the Agents workspace dispatcher (`agents-workspace/AgentsWorkspace.tsx`).
- Recalling attachments, terminal excerpts, selected skills, model or reasoning level with a prompt: only text is recalled.
- Paging other threads' older messages, server-side history search, fuzzy matching, deleting entries from history.
- Prompts sent before a thread was deleted/forgotten (they are not in the snapshot).

### User flows

1. **Resend.** Agent finished; composer empty → Up → last prompt appears → Enter sends it unchanged.
2. **Tweak.** Up, Up → older prompt → type to change a word → it is now a normal draft → send.
3. **Changed mind.** Up, Up → Escape → composer is empty again (or the original draft if one was stashed: not possible from R04 except whitespace-only drafts, which are restored exactly).
4. **From another thread.** New conversation → Up → newest prompt from the most recently used other thread, live region names that thread.
5. **Search.** Ctrl+R → type `migrat` → list filters → Down to second row → Enter → prompt in composer, popover closed, focus in composer.

### Error and recovery

- R02 page load fails or is slow: Up does not wait; history falls through to other threads immediately and the failed page is retried on the next Up that reaches the same boundary. No error banner (history is a convenience); the failure is logged with `console.warn` only in development builds.
- Snapshot changes while browsing (new message arrives, thread renamed): the entry list is recomputed, the currently shown text stays as is and the index is re-found by entry identity (message id); if the entry disappeared, browsing keeps the text and continues from the nearest older entry.
- Composer disabled (`!ready`, `busy`, held/inert scoped composer): no history and no search popover.

## REPO_MAP (verified at the baseline SHA unless marked discovery)

| Path | What is there today | Change |
|---|---|---|
| `apps/web/src/App.tsx` `function Composer` | Main composer: `draft`/`updateDraft`, textarea `onKeyDown` (IME guard, `/btw` submit, `commands.current?.keyDown`, prediction Escape/Tab, submit key), `useComposerPrediction({... blocked ...})`, `composer-caption` div under the form | Wire `usePromptHistory`; add key handling after `commands.current?.keyDown(event)`; add caption chip and search popover; pass `blocked` while browsing |
| `apps/web/src/ScopedConversationComposer.tsx` | Scoped composer textarea with `onKeyDown` that defers to `commands.current?.keyDown` then handles Enter | Wire the same hook with `composers.edit(target, value)` as the draft writer |
| `apps/web/src/ComposerCommands.tsx` | Slash menu; consumes `ArrowUp`/`ArrowDown` only when its popover is open | No change (keeps priority) |
| `apps/web/src/keyboard-bindings.ts` | `KEYBOARD_BINDINGS` registry; `ariaKeyShortcuts` | Add three `Conversation` entries (R11) |
| `tests/keyboard-bindings.test.ts` | Reads each binding's `handlers` modules and checks a key comparison guarded by exactly the chord's modifiers | Must pass with the new entries (no edit expected) |
| `packages/contracts/index.ts` | `Message {id, threadId, role, content, createdAt, runId}`, `Snapshot {threads, archivedThreads?, messages, messagesTruncated?}` | Read only |
| `packages/storage/store.ts` | `MESSAGE_WINDOW = 300`, fills `messagesTruncated` | Read only |
| `apps/web/src/api.ts` | `getThreadMessages(id, beforeId?, limit = 300)` returns `{messages, truncated}` | Used for R02 |
| `apps/web/src/terminal-excerpts.ts` | `serializeTerminalExcerpts` joins text and excerpt blocks with `'\n\n'`, blocks start `Terminal excerpt · project ` | Read only; R03 strips the blocks |
| `apps/web/src/useComposerPrediction.ts` | Prediction hook with `blocked` input | Read only |
| `packages/ui-shell/Popover.tsx`, `packages/ui-shell/tokens.css` | Popover primitive (`.ui-popover`, `ui-popover-in/out`, `--ui-motion-popup-enter: 180ms`, `--ui-motion-popup-exit: 140ms`) | Used for the search popover (UI guard requires primitive overlays) |
| `apps/web/src/composer-commands.css` | Styles for the slash popover (`.composer-command-popover`, `-option`, `-hint`) | Reuse classes; new rules go in a new `prompt-history.css` |
| `apps/web/src/styles.css` | `.composer-caption`, `.composer-prediction-text`, reduced-motion rules, `.app-shell[data-panel-animations=false]` | Read only |
| `scripts/browser-suites.ts` | Each Playwright suite registered once (`suite('composer-commands')`) | Add `suite('prompt-history')` |
| `tests/e2e/composer-commands.spec.ts` + `.playwright.config.ts`, `tests/e2e/task-interface-fixture.ts` | Pattern for a composer browser test with a fixture snapshot and routed API | Template for the new spec |
| `scripts/public-source-files.json` | Reviewed source manifest | Add every new file (discovery: confirm with `tests/public-source.test.ts` which lists are required) |
| New: `apps/web/src/prompt-history.ts` | — | Pure functions: collect, clean, order, search, step |
| New: `apps/web/src/usePromptHistory.ts` | — | React hook: state, key handling, paging |
| New: `apps/web/src/PromptHistorySearch.tsx`, `apps/web/src/prompt-history.css` | — | Search popover and styles |

## DESIGN

### Data

```ts
// apps/web/src/prompt-history.ts
export interface PromptHistoryEntry { id: string /* message id */; threadId: string; text: string; createdAt: string; current: boolean }
export const EXCERPT_MARKER = '\n\nTerminal excerpt · project ';
export const HISTORY_LIMIT = 1000, SEARCH_LIMIT = 50;
export function promptText(content: string): string;             // R03: cut at first EXCERPT_MARKER (also when content starts with 'Terminal excerpt · project '), return '' if blank
export function collectPromptHistory(input: {messages: readonly Message[]; threads: readonly Thread[]; currentThreadId?: string; older?: readonly Message[]}): PromptHistoryEntry[]; // R01-R03, newest first, current thread first
export function searchPromptHistory(entries: readonly PromptHistoryEntry[], query: string): PromptHistoryEntry[]; // R09
export type HistoryState = {mode: 'idle'} | {mode: 'browsing'; index: number; entryId: string; stash: string};
export function stepHistory(state: HistoryState, entries: readonly PromptHistoryEntry[], direction: 'older' | 'newer', draft: string): {state: HistoryState; text: string} | null; // null = key not used
```

`older` holds the current thread's pages loaded by R02, merged before other threads and de-duplicated by message id.

### Control flow

1. `usePromptHistory({snapshot, threadId, draft, write, input, disabled})` memoizes `collectPromptHistory` on `[snapshot.messages, snapshot.threads, threadId, older]` and returns `{keyDown(event): boolean, browsing, position, total, sourceTitle, searchOpen, openSearch, closeSearch, choose(entry), onDraftChange(value)}`.
2. In `App.tsx` the textarea `onKeyDown` order becomes: IME guard → `/btw` submit → `commands.current?.keyDown(event)` → **`history.keyDown(event)`** → prediction Escape → Tab → submit. `history.keyDown` handles `ArrowUp`/`ArrowDown` (R04), `Escape` while browsing (R06), and `Ctrl+R` (R09).
3. A step sets the textarea text **without** journaling: the hook keeps a local `shown` string; the composer renders `value={history.browsing ? history.shown : draft}`. The `onChange` handler calls `history.onDraftChange(value)` first: if browsing, it ends browsing and the value goes through `updateDraft(value)` (journaled).
4. Choosing a search result calls `updateDraft(text)` directly (journaled) and ends browsing.
5. R02 paging: when `stepHistory` reaches the last current-thread entry and `messagesTruncated[threadId] > 0` and no page is in flight, the hook calls `getThreadMessages(threadId, oldestLoadedId, 300)`, appends to `older`, and the step that triggered it already falls through to the next entry in the current list (no waiting).

### Security boundaries

Read-only use of the user's own messages already delivered to this window. No new endpoint, storage key or model request. Prompt text is rendered as text (React text nodes), never as HTML.

### Migration and rollback

No data migration. Rollback is reverting the PR; no stored state is left behind.

## VISUAL_DESIGN_AND_MOTION

Follows `DESIGN.md` (motion token table, "Send, Stop, typing and held/dragged controls respond immediately", reduced motion rules) and the existing composer look.

### Recalled prompt in the composer

- The recalled text replaces the textarea content **immediately** (no fade, no slide): typing-path controls must respond immediately per DESIGN.md.
- While browsing, the `composer-caption` row under the composer shows a history chip in place of empty space (it never replaces "Connect a model to start" or the prediction controls, which take priority; predictions are blocked while browsing per R08):
  - Text: `History 3 of 42` for current-thread entries; `History 3 of 42 · <thread title>` for other threads (title truncated with ellipsis at 28 characters), followed by the hint `↑ older · ↓ newer · Esc restore` (`aria-hidden`; the live region in R12 carries the spoken version).
  - Style: class `prompt-history-chip`; font-size 12px; color `var(--muted)`; the counter (`History 3 of 42`) in `var(--text)` with font-weight 550; separator `·` with 6px horizontal margin; no border or background; single line, `text-overflow: ellipsis`.
  - Motion: entrance opacity 0→1 over `var(--ui-motion-hover)` (120ms) with `var(--ui-ease-enter)`; exit opacity 1→0 over 100ms (about 20% shorter) with `var(--ui-ease-move)`; counter text changes without animation. Reduced motion (`prefers-reduced-motion: reduce`, `:root[data-motion=reduced|off]`, `.app-shell[data-panel-animations=false]`): opacity at most 80ms or none, no transforms.
- The textarea itself gets no new border or color while browsing.

### Search prompts popover (Ctrl+R)

- Primitive: `Popover` from `packages/ui-shell/Popover.tsx`, `anchor={input}`, `preferredSide="above"`, `align="start"`, `width={600}`, height `Math.min(360, Math.max(120, rows * 40 + 92))`, `className="composer-command-popover prompt-history-popover"` so it shares the slash menu's surface, border, radius 12px, elevation and padding.
- Header: a search input (`aria-label="Search prompts"`, placeholder `Search prompts…`, 13px, full width, 32px tall, 8px horizontal padding, `background: transparent`, bottom border `1px solid var(--border)`), with a `Search` lucide icon 14px in `var(--muted)` at its left. It takes focus on open (`initialFocus`).
- List: `role="listbox"`, `aria-label="Prompt history"`, rows use `.composer-command-option` (min-height 38px, radius 7px, selected background `var(--hover)`). Row content: prompt first line (class `prompt-history-text`, flex 1, ellipsis) and, for other-thread entries, the thread title in a `.composer-command-source` tag (max-width 140px here). The matched substring is wrapped in `<mark class="prompt-history-match">` with `background: transparent; color: var(--accent); font-weight: 600` (no highlight box).
- Empty state: `.composer-command-status` with `Search` icon and `No earlier prompts match` (or `No earlier prompts yet` when history is empty).
- Footer: `.composer-command-hint` with `↑ ↓ Navigate` and `Enter Use · Esc Close`.
- Motion: the Popover primitive's own entrance/exit (`ui-popover-in` 180ms `--ui-ease-enter`, `ui-popover-out` 140ms) only; list filtering re-renders without row animation; the selection background follows instantly (no tween). Reduced motion: as handled by the primitive's existing rules.
- Forced colors: reuse `.composer-command-option[aria-selected=true]` forced-colors rule; `.prompt-history-match` uses `color: Highlight` under `@media (forced-colors: active)`.
- Narrow windows (≤480px): same as slash menu rules; thread tag hidden below 360px.

## EXECUTION_DAG

Tasks run in order T01 → T02 → (T03 ∥ T04) → T05 → T06 → T07. T03 and T04 edit different files.

### T01 Pure history model
- **Goal:** `apps/web/src/prompt-history.ts` with the Data section's exports.
- **Depends on:** none.
- **Edits:** new `apps/web/src/prompt-history.ts`; new `tests/prompt-history.test.ts`; manifest entries in `scripts/public-source-files.json`.
- **Tests (positive):** order current thread first then others by `createdAt`; excerpt stripping (`'fix it\n\nTerminal excerpt · project "p" …'` → `'fix it'`); excerpt-only message dropped; consecutive duplicates collapsed; archived/unknown-thread messages excluded; limit 1,000; `older` merged and de-duplicated by id; search case-insensitive, order kept, 50 cap; `stepHistory` older/newer/past-newest returns stash; caret-line rules are not here (T02).
- **Tests (negative):** assistant/activity messages never appear; non-empty draft → `stepHistory` from idle returns null.
- **Done when:** `pnpm exec vitest run tests/prompt-history.test.ts` passes; `pnpm typecheck` passes.

### T02 Hook and key handling
- **Goal:** `apps/web/src/usePromptHistory.ts` implementing Control flow 1, 3–5 and R04–R08, R13.
- **Depends on:** T01.
- **Edits:** new hook file; register the three bindings in `apps/web/src/keyboard-bindings.ts` with `handlers: [module('usePromptHistory.ts')]` (the key comparisons and modifier guards live in this file, in one statement each, as `tests/keyboard-bindings.test.ts` requires); unit tests in `tests/prompt-history.test.ts` for the hook's pure key decision helper (export a `historyKeyAction(event-like, {draft, caret, end, browsing, composing})` function).
- **Tests:** Up with empty draft → older; Up with text → none; Up while browsing and caret not on first line → none; Down on last line → newer; Shift/Alt/Ctrl/Meta+Up → none; composing → none; Escape while browsing → restore; Ctrl+R → search; Meta+R on mac platform → search.
- **Done when:** unit tests and `pnpm exec vitest run tests/keyboard-bindings.test.ts` pass.

### T03 Main composer wiring and caption chip
- **Goal:** wire the hook into `function Composer` in `apps/web/src/App.tsx` (R04–R10, R12), render the caption chip and live region.
- **Depends on:** T02. **Files:** `apps/web/src/App.tsx`, new `apps/web/src/prompt-history.css` (chip rules), import it once.
- **Done when:** manual check in `pnpm dev` matches user flows 1–4; `pnpm typecheck`, `pnpm lint`, `pnpm test:ui-guard` pass.

### T04 Scoped composer wiring
- **Goal:** the same behavior in `apps/web/src/ScopedConversationComposer.tsx` with `composers.edit(target, value)` as the writer and `context.owner.threadId` as current thread; respect `held`.
- **Depends on:** T02. **Files:** that file only (chip styles come from T03's CSS; if T03 is not merged yet, import the CSS file created in T03 after rebasing).
- **Done when:** typecheck passes; unit test or browser check that a held composer ignores Up and Ctrl+R.

### T05 Search popover
- **Goal:** `apps/web/src/PromptHistorySearch.tsx` per VISUAL_DESIGN_AND_MOTION and R09, used by both composers.
- **Depends on:** T03, T04. **Files:** new component, `prompt-history.css`, the two composer files (mount only).
- **Done when:** popover opens on Ctrl+R, filters, Enter/click chooses, Escape/outside click closes, focus returns to the textarea; UI guard passes (primitive Popover only).

### T06 Browser test and evidence
- **Goal:** `tests/e2e/prompt-history.spec.ts` + `tests/e2e/prompt-history.playwright.config.ts` (copy the composer-commands config with a free port, e.g. 5351; discovery: check no other config uses it), registered as `suite('prompt-history')` in `scripts/browser-suites.ts`; fixture snapshot from `taskFixture` with two threads and user messages `alpha`, `beta` (current) and `gamma` (other).
- **Depends on:** T05.
- **Scenarios:** the Measurable success sequence; edit ends browsing and the journal (`draft:task-thread`, read as in `composer-commands.spec.ts` `journalValue`) then holds the edited text, while during browsing it still holds `''`; Escape restores; slash menu open → Up moves the menu, not history; Ctrl+R search flow; page does not reload on Ctrl+R; reduced-motion (`page.emulateMedia({reducedMotion: 'reduce'})`) chip has no transform; screenshots of chip and popover in dark and light theme at 1280×800 and 420×800.
- **Done when:** `pnpm test:browser --suite prompt-history` passes locally; screenshots attached to the PR.

### T07 Front end team review (required by the maintainer)
- **Goal:** send the finished work (PR link, screenshots from T06, a short screen recording of flows 1–5) to the front end team for review, and record their verdict on this issue.
- **Depends on:** T06.
- **Done when:** the front end team's review is linked or summarized on this issue and requested changes are resolved. The issue stays open until then.

## VALIDATION

### Commands (planned, none executed yet)

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test:ui-guard
pnpm exec vitest run tests/prompt-history.test.ts tests/keyboard-bindings.test.ts tests/composer-commands.test.ts tests/composer-prediction.test.ts tests/public-source.test.ts --maxWorkers=1
pnpm build && pnpm test:browser --suite prompt-history
pnpm test:browser --suite composer-commands   # regression: slash menu keeps Up/Down
pnpm test:browser --suite composer-prediction # regression: predictions
```

### Acceptance matrix

| Req | Check | Task |
|---|---|---|
| R01 | unit: order and exclusions | T01 |
| R02 | unit: `older` merge; browser: truncated thread routes `/api/threads/*/messages` and Up reaches the paged prompt | T01, T06 |
| R03 | unit: excerpt strip, blank drop, duplicate collapse | T01 |
| R04 | unit: `historyKeyAction` cases; browser: text in draft → Up moves caret only | T02, T06 |
| R05 | browser: caret at end after recall | T06 |
| R06 | browser: edit ends browsing, Escape restores, Stop not fired | T06 |
| R07 | browser: journal holds original during browsing | T06 |
| R08 | browser (prediction fixture): Up dismisses ghost text, none while browsing | T06 |
| R09 | browser: search flow, no page reload | T05, T06 |
| R10 | browser: main composer; unit or browser: scoped composer | T03, T04, T06 |
| R11 | `tests/keyboard-bindings.test.ts`; Settings shortcut reference lists three rows | T02 |
| R12 | browser: live region text, `aria-keyshortcuts`, listbox roles | T03, T05, T06 |
| R13 | code review: no new routes/storage; network log in browser test shows only the messages endpoint | T06 |
| Visual/motion | screenshots, reduced-motion check, front end team review | T06, T07 |

Release gate: all commands above pass, screenshots on the PR, T07 review recorded. Browser fixtures do not prove packaged Windows behavior; a short check in the packaged desktop app (Up, Ctrl+R) is recorded separately in the PR.

## STATE

- Researched and decided: everything above (r1). Implemented: nothing. Verified: nothing.
- Owners/branches: none yet. Plan file branch `devin/prompt-history-plan` (docs-only PR).
- Risks: `tests/keyboard-bindings.test.ts` statement-based guard parsing may need the comparisons written in a specific shape (T02 handles); Ctrl+R handled only while the composer has focus, so it does not change the page elsewhere.
- Next step: an implementing agent claims this issue per AGENTS.md and starts T01.

## REFERENCES

- Codex CLI developer commands (keyboard shortcuts section): https://learn.chatgpt.com/docs/developer-commands.md?surface=cli — "Press Up or Down to restore draft history." and "Press Ctrl+R to search prompt history, then press Enter to use a match or Escape to cancel."
- openai/codex#24298 "Seed prompt history from resumed messages" (merged): https://github.com/openai/codex/pull/24298 — current-thread prompts are recalled before global history.
- Repository files listed in REPO_MAP at `e883ac0327c834120d89c3697dec7380a342ba4d`; `DESIGN.md` motion and composer rules; `AGENTS.md` publication and checkpoint contract.
