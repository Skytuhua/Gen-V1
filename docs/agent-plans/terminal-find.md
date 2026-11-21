# Plan: Find in terminal output (search the focused terminal's retained output)

> **Design ownership (batch 6).** There is no separate front end team designing this feature: this plan itself specifies the visual design and the animation (section VISUAL_DESIGN_AND_MOTION). Implementers build exactly that specification. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T06) and does not close this issue until that review is recorded on the issue.

## META

| Field | Value |
|---|---|
| Feature | Find in terminal output: Ctrl+F (or a Find button) in a workspace terminal opens a find row that searches that terminal's retained output, highlights every match, shows "3 of 12", and moves between matches with Enter / Shift+Enter, without sending anything to the shell |
| Size | small (labels `feature`, `small`); one issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue |
| Plan file | `docs/agent-plans/terminal-find.md` (identical to this body; SHA-pinned link at the top of the issue) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified by clone) |
| Existing work | None. No issue or PR title matches "terminal find"/"terminal search"; `apps/web/src/TerminalBody.tsx` loads only `@xterm/addon-fit`, and `package.json` has no `@xterm/addon-search`. Related but different: Find in the conversation (`apps/web/src/ConversationFind.tsx`, Ctrl+F over the transcript) and terminal excerpts (`apps/web/src/terminal-excerpts.ts`, "Add selection to prompt") |
| Implementation status | NOT_STARTED. Planning only; no code written |
| Source provenance | Feature proposal batch 6, item 1 ("Find in terminal output", small), filed directly per the maintainer's standing instruction; static repository research at the baseline SHA; public prior art: VS Code integrated terminal Find, xterm.js `@xterm/addon-search` 0.16.0 source and typings at tag `6.0.0` |

## OBJECTIVE

**Problem.** A workspace terminal in Gen (`TerminalBody`, rendered for `kind==='terminal'` in `apps/web/src/WorkspaceSurfaceBody.tsx`) keeps up to 2,000 lines of scrollback (`scrollback:2000` in the xterm `Terminal` options), but there is no way to find a line in it. Users scroll by hand to find an error message, a URL, a test name or a port. Pressing Ctrl+F while the terminal has focus today does not search: xterm turns it into the Ctrl+F control character and sends it to the shell through `onData` → `command({type:'input',data})`; with focus elsewhere in the conversation, Ctrl+F opens the conversation Find, which searches the transcript and not the terminal. VS Code solves this with a terminal-scoped Find ("Ctrl+F … highlight matches, Enter / Shift+Enter to move") built on the same xterm search addon.

**Intended behavior.**
1. With focus in a terminal (its xterm textarea), **Ctrl+F** (⌘F on macOS, per the registry's "Ctrl means either platform modifier" rule) opens a **find row** directly under that terminal's toolbar and focuses its input. The key is not sent to the shell, the browser's own find bar does not open, and the conversation Find does not open.
2. A **Find** button (search icon) in the terminal toolbar does the same for pointer users.
3. Typing in the find input searches the terminal's retained output (literal text, case-insensitive by default), highlights all matches, selects and scrolls to the first match at or after the current viewport, and shows `3 of 12`.
4. **Enter** goes to the next match, **Shift+Enter** to the previous one, wrapping at the ends. Up/Down arrow buttons do the same.
5. A **Match case** toggle switches to case-sensitive matching.
6. **Escape** (or the close button) closes the row, removes the highlights, and returns focus to the terminal.
7. Find keeps working after the process ended (phase `Ended`) and while reads are interrupted, because it only reads the local xterm buffer.
8. Nothing typed in the find row is ever sent to the shell; no new request to the host is made.

**Measurable success.** In a terminal whose output is `line-0` … `line-2049` (the existing 2,050-line scrollback fixture): focus the terminal, Ctrl+F, type `line-204` → counter shows `1 of N`, where N is the number of buffer lines containing `line-204` that are still in the 2,000-line buffer (computed from the buffer in the test, not hard-coded), the viewport shows the active match, Enter advances the counter by one, Shift+Enter goes back, Escape clears the highlights and focuses the terminal; across the whole flow the host receives zero `input` commands. A search over the full 2,000-line buffer updates within one animation frame of the debounce (≤ 150 ms after the last keystroke on a developer laptop).

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows in VALIDATION)

- **R01 Search engine.** Use the official `@xterm/addon-search` at exactly `0.16.0` (the release published with `@xterm/xterm` `6.0.0`, which Gen pins; both published 2025-12-22), added to `dependencies` in the root `package.json` with an exact version like the existing `@xterm/addon-fit` `0.11.0`, and lazily imported in the same `Promise.all` as xterm and the fit addon. Load it with `instance.loadAddon(search)` after `new Terminal(...)`. No hand-written buffer search.
- **R02 Proposed API.** The addon's highlight decorations call `terminal.registerDecoration`, which runs `_checkProposedApi()` in xterm 6.0.0 (`src/browser/public/Terminal.ts`). The `Terminal` options therefore add `allowProposedApi: true`. No other proposed API is used.
- **R03 Matching.** Literal text only: `regex: false`, `wholeWord: false`; `caseSensitive` follows the Match case toggle (default off). The query is not trimmed (spaces are searchable); an empty query clears decorations and shows no counter. Matches inside wrapped lines are found (the addon handles wrapped rows). Search scope is the whole active buffer (scrollback + viewport) of that one terminal instance; when the terminal is in the alternate screen (full-screen programs such as `less`/`vim`), the addon searches what that buffer holds; no special handling.
- **R04 Highlights and counter.** Every search call passes `decorations` (R08 colors) and `incremental` as listed in DESIGN, so `onDidChangeResults` fires (it fires only when decorations are set: `fireResultsChanged(hasDecorations)` in `SearchResultTracker.ts`). Counter text: `{resultIndex+1} of {resultCount}`; `No results` when `resultCount===0`; when `resultCount` equals the highlight limit (1,000, the addon default `DEFAULT_HIGHLIGHT_LIMIT`, kept) show `{resultIndex+1} of 1000+`. When `resultIndex===-1` and count>0 show `{resultCount} results`.
- **R05 Keys inside the terminal.** In the existing `attachCustomKeyEventHandler`, a new first check (before the `canCapture()` early return, gated only by `ownerCurrent()` and `!event.isComposing`) handles Ctrl/⌘+F without Shift/Alt: on `keydown` it calls `event.preventDefault()` and `event.stopPropagation()` and opens find; it returns `false` for both keydown and keyup so xterm never sends it to the PTY. Stopping propagation keeps the document-level `ConversationFind` listener (`root.ownerDocument.addEventListener('keydown',…)`, which opens when the active element is inside its scope) from also opening. When find is already open, Ctrl+F refocuses and selects the find input.
- **R06 Keys inside the find row.** In the find input: Enter → next; Shift+Enter → previous; Escape → close. All three call `preventDefault()` and `stopPropagation()`; Escape must not reach the global Stop shortcut (`preferences.keybindings.stop`, default `Escape`, handled by the `window` keydown listener in `apps/web/src/App.tsx`), so a run is not stopped by closing find. Keys are ignored while `event.isComposing` (IME). The find input is a normal `<input>` outside xterm, so its text never reaches `onData`.
- **R07 Lifecycle.** Find state (open, query, match case) lives in `TerminalBody` React state. It resets (closed, empty, decorations cleared) when the terminal effect re-runs (new `generation`, project/thread/terminal change) and on unmount; the addon is disposed with the terminal (`instance.dispose()` already runs in the cleanup). While find is open and the query is non-empty, new output appended by `append()` refreshes highlights and the counter, debounced 250 ms, with `incremental: true` so the active match stays where it is when it still exists. Retry, Stop and New terminal keep working while find is open.
- **R08 Visual design.** As in VISUAL_DESIGN_AND_MOTION (find row, toolbar button, highlight colors, motion).
- **R09 Selection side effect.** The addon selects the active match. That fires the existing `onSelectionChange`, so "Add selection to prompt" becomes enabled for the match text. This is allowed (it is still only a local selection), but nothing is added to the prompt unless the user clicks that button; a test asserts no `addExcerpt` call and no `input` command during find.
- **R10 Shortcut registry.** Add to `KEYBOARD_BINDINGS` in `apps/web/src/keyboard-bindings.ts`, scope `Terminal` (already a `KeyboardScope`, used by `terminal-select-all`): `terminal-find` (`Ctrl+F`, label "Find in terminal output", handler `module('TerminalBody.tsx')`), `terminal-find-next` (`Enter`, "Next terminal match"), `terminal-find-previous` (`Shift+Enter`, "Previous terminal match"), `terminal-find-close` (`Escape`, "Close terminal find"), the last three with handler `module('TerminalFind.tsx')`. Each key comparison and its modifier guards sit in one statement, as `tests/keyboard-bindings.test.ts` requires (it splits handler source on `;` and checks the guards around `.key === '…'`). Not rebindable in v1 (no `preference`).
- **R11 Accessibility.** Find input `aria-label="Find in terminal"`; toolbar button `aria-label="Find in terminal"`, `title="Find in terminal (Ctrl+F)"`, `aria-expanded` reflecting the row, `aria-controls` the row id; the xterm host keeps `aria-label="Terminal output"` and gains `aria-keyshortcuts` with `ariaKeyShortcuts(['Ctrl+F'])` from `keyboard-bindings.ts`. Counter is a `role="status"` `aria-live="polite"` element (scope Playwright queries to `.terminal-find` because the toolbar already has a `role="status"` phase label). Previous/Next/Close are icon buttons with `aria-label` "Previous match", "Next match", "Close find"; Match case is a toggle button with `aria-pressed`. Focus: open → find input (text selected); close → the xterm textarea (`instance.focus()`), or the Find toolbar button if it opened from there.
- **R12 Privacy and data.** No new storage, no new host route, no network call; find reads only the in-memory xterm buffer that is already on screen. Queries are not journaled or persisted.

### Out of scope (v1)

- Regex and whole-word options (the addon supports them; can be added later as two more toggles).
- Searching output that has already expired from the 2,000-line scrollback or the bounded host buffer (the `[Earlier output expired from the bounded host buffer]` marker stays the boundary); no host-side search, indexing or larger retention.
- Searching all terminals at once, or terminals in other threads.
- Find in other workspace tools (Review diff, Pull requests) or a change to conversation Find.
- Rebinding the keys or a setting to turn the feature off.
- An overview-ruler scrollbar (the addon's `matchOverviewRuler` colors are required fields and are set, but Gen does not enable xterm's `overviewRuler` option, so nothing is drawn).

### User flows

1. **Keyboard.** Terminal focused → Ctrl+F → row opens, input focused → type `error` → all `error` matches highlighted, first one at/after viewport selected, counter `1 of 4` → Enter `2 of 4` → Shift+Enter `1 of 4` → Escape → row closes, highlights gone, terminal focused, typing goes to the shell again.
2. **Pointer.** Click Find → row opens → type → click Next/Previous arrows → click X.
3. **Ended terminal.** Process exited, phase `Ended` → Ctrl+F still opens (the xterm textarea still takes focus) → search works over retained output.
4. **Live output.** Row open with query `ready` while the server prints → counter grows (debounced) without jumping the active match.
5. **No match.** Query `zzz` → counter `No results`, input gets the no-result style, Enter does nothing.

### Error and recovery

- Addon import fails (chunk load error): the terminal still starts (import it in the same `Promise.all`; if that rejects, the existing `.catch` already sets `unconfirmed`; to avoid making search a hard dependency, import the addon in a separate `import('@xterm/addon-search').then(...).catch(()=>setFindAvailable(false))` after the terminal opened; when unavailable, the Find button is hidden and Ctrl+F falls through to the previous behavior). Decision: use the separate, non-blocking import.
- `findNext` throws (should not, but defensive): catch, show counter `No results`, keep the row open.
- Ownership changes while open (`ownerCurrent()` false): ignore find key handling (the existing handler returns early) and the reset in R07 clears state.

## REPO_MAP (verified at the baseline SHA unless marked discovery)

| Path | What it is / why it matters |
|---|---|
| `apps/web/src/TerminalBody.tsx` (128 lines) | The terminal view. Creates `new Terminal({convertEol:false,fontSize:13,scrollback:2000,theme:{background:'#101010',foreground:'#dedede',…}})`, loads `FitAddon`, `append()` writes host output, `attachCustomKeyEventHandler` handles Ctrl+Shift+A (select all) and Tab-with-selection, `onSelectionChange` feeds "Add selection to prompt". Renders `.live-terminal.terminal-read` > `.panel-toolbar` (Terminal / status / Stop / Retry / New terminal) > `.error-text` > `.xterm-host` > `.terminal-selection-actions`. Main edit target |
| `apps/web/src/terminal-read.css` (6 lines) | Toolbar and error rules for `.terminal-read`; focus-visible outline `2px solid var(--text)` for toolbar buttons |
| `apps/web/src/workspace-tools.css` | `.live-terminal` is a column flex; `.xterm-host{flex:1;min-height:100px;overflow:hidden;padding:8px;background:#101010}`; `.panel-toolbar` flex with gap 8px; canvas-panel toolbar `min-height:36px;padding:8px 12px` |
| `apps/web/src/terminal-excerpts.css` | `.terminal-selection-actions` bottom row (pattern for a bordered row inside the terminal: `padding:var(--ui-space-2) var(--ui-panel-inset);border-top:1px solid var(--border)`) |
| `apps/web/src/WorkspaceSurfaceBody.tsx` line 73 | Renders `<TerminalBody key=… projectId threadId terminalId active excerptComposer openAnother/>` |
| `apps/web/src/ConversationFind.tsx` | Conversation Find: document `keydown` listener, opens on `matchesShortcut(event, chordFor('find-in-conversation'))` when focus is inside its scope; uses `lucide-react` `ArrowDown, ArrowUp, Search, X` icons. Pattern for find UI and for not colliding |
| `apps/web/src/keyboard-bindings.ts` | `KEYBOARD_BINDINGS` registry; `terminal-select-all` (`Ctrl+Shift+A`, scope `Terminal`, handler `TerminalBody.tsx`) is the model entry; `ariaKeyShortcuts` helper |
| `tests/keyboard-bindings.test.ts` | Verifies each binding's handler module contains a comparison for the chord's key guarded by exactly its modifiers in one `;`-separated statement |
| `apps/web/src/App.tsx` ~line 794 | `window` keydown: `matchesShortcut(event, preferences.keybindings.stop)` stops the focused run. Reason for `stopPropagation` on Escape in R06 |
| `tests/e2e/terminal-read.spec.ts` (+ `.playwright.config.ts` port 5814, `.vite.config.ts`, `fixtures/terminal-read.html/.tsx`, `fixtures/terminal-read-fixture.css`) | Browser suite `terminal-read` (registered in `scripts/browser-suites.ts`). `mount()` routes `/api/terminals*`, records every request (so tests can assert no `input` command), blocks other origins; `window.terminalFixture.instances` exposes the real xterm `Terminal`; includes a 2,050-line scrollback test and dark/light narrow reduced-motion test that asserts no running animations in `.live-terminal` |
| `package.json` | `@xterm/xterm` `6.0.0`, `@xterm/addon-fit` `0.11.0` (exact pins); scripts `typecheck`, `lint`, `test:ui-guard`, `test`, `test:browser`, `build` |
| `pnpm-lock.yaml` | Must be updated by `pnpm install` (not hand-edited) |
| `scripts/public-source-files.json` | Reviewed source manifest; every new tracked file (e.g. `apps/web/src/TerminalFind.tsx`, `apps/web/src/terminal-find.css`) is added in sorted order |
| `DESIGN.md` | Motion token table (Hover/focus 120ms; Dropdown/popover 180/140ms; Reduced motion: no spatial transforms, opacity at most 80ms; entrance easing `cubic-bezier(.16,1,.3,1)`, move `cubic-bezier(.4,0,.2,1)`; exits about 20% shorter); "primitive-only overlays" guardrail (the find row is inline layout, not an overlay, so no Popover primitive is needed) |
| `packages/ui-shell/tokens.css`, `apps/web/src/styles.css` | Define the tokens this plan uses: `--hover`, `--danger`, `--control-border`, `--surface`, `--accent`, `--ui-panel-inset`, `--ui-space-2` (verified definitions at baseline), plus `--ui-motion-hover`, `--ui-ease-enter`, `--ui-ease-move` (used across apps/web CSS). Reduced-motion global selectors `:root[data-motion=reduced]` and `:root[data-motion=off]` exist in `apps/web/src/appearance.css` / `composer-toolbar.css` |
| External: `@xterm/addon-search` 0.16.0 typings (`addons/addon-search/typings/addon-search.d.ts` at xterm tag 6.0.0) | `new SearchAddon({highlightLimit?})`, `findNext(term, options)`, `findPrevious(term, options)`, `clearDecorations()`, `clearActiveDecoration()`, `onDidChangeResults: IEvent<{resultIndex, resultCount}>`; `ISearchOptions {regex, wholeWord, caseSensitive, incremental, decorations}`; decorations need `matchOverviewRuler` and `activeMatchColorOverviewRuler` (required strings) |

## DESIGN

### Components

- **`apps/web/src/TerminalFind.tsx`** (new): presentational + key handling for the find row.

```ts
export interface TerminalFindProps {
  id: string;                       // for aria-controls
  query: string; caseSensitive: boolean;
  result: {index: number; count: number} | null;  // null = not searched yet / empty query
  limit: number;                    // 1000
  onQuery(value: string): void;
  onCaseSensitive(value: boolean): void;
  onNext(): void; onPrevious(): void; onClose(): void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}
export function terminalFindCounter(result: {index:number;count:number}|null, limit:number): string; // pure, R04 text
```

  Key handling in the input's `onKeyDown` (each comparison in one statement with its guards, for the registry test), e.g.:
  `if(!event.nativeEvent.isComposing&&event.key==='Enter'&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopPropagation();onNext();return;}` and the same shape for `Shift+Enter` and `Escape`.

- **`apps/web/src/TerminalBody.tsx`** (edit):
  - Terminal options add `allowProposedApi:true`.
  - After `instance.open(...)`/`fit.fit()`: non-blocking `import('@xterm/addon-search')` → if `ownerCurrent()`, `search=new SearchAddon(); instance.loadAddon(search); search.onDidChangeResults(e=>{if(ownerCurrent())setFindResult({index:e.resultIndex,count:e.resultCount});}); setFindAvailable(true);` and store it in the `actions` ref object (extend the `actions.current` shape with `find(query, caseSensitive, direction:'next'|'previous'|'refresh')`, `clearFind()`, `focusTerminal()`) so render code never touches a stale instance.
  - `find()` calls `search.findNext(query,{caseSensitive,regex:false,wholeWord:false,incremental:direction==='refresh'||direction==='type',decorations:DECORATIONS})` or `findPrevious(...)` with `incremental:false`. Typing uses `incremental:true` so the active match grows with the query instead of jumping; Enter uses `incremental:false`.
  - Typing is debounced 120 ms (setTimeout in the component; cleared on each keystroke and on close/unmount); Enter/Shift+Enter run immediately (flush pending debounce first).
  - `append()`: after `instance.write(...)`, if a find refresh callback is set (find open and query non-empty) schedule `find(query,caseSensitive,'refresh')` with a 250 ms trailing debounce. Use `instance.write(data, callback)` so the refresh runs after xterm parsed the data.
  - Custom key handler: first statement handles Ctrl/⌘+F (R05). Write it so the registry test sees `event.key.toLowerCase()==='f'` with `(event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey` in the same statement.
  - Render: Find icon button in `.panel-toolbar` after the status label and before Stop (hidden when `!findAvailable`); `{findOpen&&<TerminalFind …/>}` between `.panel-toolbar` (and `.error-text`) and `.xterm-host`.
  - Close: `search.clearDecorations()`, reset result, keep query in state until the terminal resets (reopening shows the last query selected, like VS Code), focus per R11.
  - Reset (R07): in the effect start (`setSelection(null)…` line) also `setFindOpen(false);setFindResult(null);setFindQuery('');setFindAvailable(false)`.

- **Decorations constant** (`TerminalBody.tsx` or `TerminalFind.tsx`): see VISUAL_DESIGN_AND_MOTION for values.

### Data / control flow

Key/typing in find input → React state `findQuery` → debounced `actions.current.find(...)` → addon searches xterm buffer → decorations drawn by xterm + `onDidChangeResults` → `setFindResult` → counter re-renders. No host request in this flow. New output → `append()` → `instance.write(data, cb)` → cb schedules refresh.

### Security boundaries

Unchanged. The only new trust question is that the find input must never feed `onData`: it is an ordinary DOM input outside the xterm element, and the Ctrl+F key in xterm returns `false` from the custom handler. Tests assert zero `input` commands (R12).

### Migration and rollback

No data or schema. Rollback = revert the PR (dependency removal included). `allowProposedApi:true` only unlocks decoration/marker APIs inside our own code; no addon other than search is added.

## VISUAL_DESIGN_AND_MOTION

Follows `DESIGN.md` (motion token table, reduced-motion rules, "typing … respond immediately", primitive-only overlays: the find row is inline layout, not an overlay) and the existing terminal panel look. New CSS goes in a new `apps/web/src/terminal-find.css` imported by `TerminalFind.tsx`.

### Toolbar Find button

- `<button type="button" className="quiet terminal-find-toggle">` with lucide `Search` icon, `size={14}`, no text; sits immediately after the status label (the status label keeps `margin-right:auto` behavior from `strong`; the button is part of the right-hand control group before Stop).
- 28×28px hit area, radius 7px, color `var(--muted)`, hover/`aria-expanded=true` color `var(--text)` and background `var(--hover)`. Color transitions `var(--ui-motion-hover)` (120ms) `var(--ui-ease-enter)`. Focus-visible: same outline as the other toolbar buttons (`2px solid var(--text)`, offset 2px).

### Find row

- Element: `<div className="terminal-find" id=… role="search" aria-label="Find in terminal">`, placed between toolbar/error and `.xterm-host`; full width; `display:flex; align-items:center; gap:6px; min-height:36px; padding:4px var(--ui-panel-inset,12px); border-bottom:1px solid var(--border); background:var(--surface)`; `flex-shrink:0`.
- Input: `flex:1 1 160px; min-width:0; height:28px; padding:0 8px; font:13px/1 var(--font-mono,monospace)` (terminal text is monospace, so the query looks like what it matches); `border:1px solid var(--control-border); border-radius:7px; background:transparent; color:var(--text)`; placeholder `Find in output`; focus border `var(--accent)`. When `count===0` and query non-empty: border `var(--danger)` and the counter text in `var(--danger)`.
- Counter: `font-size:12px; color:var(--muted); min-width:72px; text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap`. Text from `terminalFindCounter` (R04). Counter changes are instant (no tween).
- Match case toggle: 28×28 button with text `Aa` (12px, weight 600), `aria-pressed`; pressed state: color `var(--accent)`, background `var(--hover)`, `border:1px solid var(--accent)`; unpressed: transparent border, `var(--muted)`.
- Previous / Next / Close: 28×28 quiet icon buttons with lucide `ArrowUp`, `ArrowDown`, `X` at 14px (same icons as `ConversationFind`). Previous/Next disabled (opacity .5) when `count===0`.
- Press feedback for all four buttons: DESIGN.md "Press/release 80ms, scale .97 without shifting layout" (`transform:scale(.97)` on `:active`, transition `transform 80ms var(--ui-ease-move)`); none under reduced motion.
- Narrow (container ≤ 360px, use a container query on `.live-terminal`, or `@media (max-width:360px)` if container queries are not set up on that element; discovery): hide the `Aa` toggle's border, shrink counter `min-width` to 52px, input `flex-basis:100px`; the row must not overflow horizontally (existing narrow test asserts every `.live-terminal button` stays within 320px).

### Match highlights (inside xterm; the terminal is always dark, `background:#101010`, in both app themes)

```ts
const DECORATIONS = {
  matchBackground: '#4a3b12',            // dim amber, all matches
  matchBorder: '#7a6220',
  matchOverviewRuler: '#b08a2e',          // required by the type; not drawn (no overviewRuler)
  activeMatchBackground: '#8a5a00',       // stronger amber for the current match
  activeMatchBorder: '#ffd166',
  activeMatchColorOverviewRuler: '#ffd166',
} as const;
```

Contrast check (T05): foreground `#dedede` on `#4a3b12` and on `#8a5a00` must be ≥ 4.5:1 (compute in the test or record the computed ratio in the PR; if it fails, darken the background, never lighten the text). Forced colors (`@media (forced-colors: active)`): discovery whether xterm decorations render; if they are invisible, the selection (which the addon sets on the active match) still shows the active match; record the result in the PR.

### Motion

- Row entrance: `animation: terminal-find-in 140ms var(--ui-ease-enter)` from `opacity:0; transform:translateY(-4px)` to `opacity:1; transform:none`. Exit: the row unmounts immediately after a 110ms `terminal-find-out` (opacity 1→0, `translateY(-4px)`, `var(--ui-ease-move)`) only if implementable without delaying focus return; otherwise unmount immediately (decision: focus returns to the terminal immediately on Escape, before any exit animation). The xterm host below shifts down by the row height without animation (layout must not tween; FitAddon refits through the existing `ResizeObserver`).
- Highlights appear and move instantly (no animation in the canvas/DOM decorations).
- Reduced motion (`@media (prefers-reduced-motion: reduce)`, `:root[data-motion=reduced]`, `:root[data-motion=off]`, `.app-shell[data-panel-animations=false]`): no transform; opacity fade at most 80ms, or none for `data-motion=off`. After the animation ends nothing keeps running (the existing test counts running animations in `.live-terminal` and expects 0).

### Resize note

Opening/closing the row changes `.xterm-host` height, the `ResizeObserver` calls `fit.fit()` and sends a `resize` command (rows change). That is expected and already handled; the active match must remain visible after the refit (call `find(...,'refresh')` once after the row opens and first search runs, test it).

## EXECUTION_DAG

Tasks run in order T01 → T02 → T03 → T04 → T05 → T06. All touch the terminal area, so one worker owns T01–T05 on one branch; T06 is the review handoff.

### T01 Add the search addon and the proposed-API option
- **Goal:** `@xterm/addon-search@0.16.0` installed and loaded non-blockingly in `TerminalBody`, `allowProposedApi:true` set, `findAvailable` state, actions ref extended with `find/clearFind/focusTerminal` (R01, R02, R07 reset, error-and-recovery).
- **Depends on:** none.
- **Edits:** `package.json` (exact pin), `pnpm-lock.yaml` via `pnpm add @xterm/addon-search@0.16.0 --save-exact`, `apps/web/src/TerminalBody.tsx`. Discovery: check `tests/e2e/terminal-read.vite.config.ts` and its shared `isolated` config for an `optimizeDeps.include` list that names `@xterm/xterm`; if present, add the addon there too. Check `scripts/` for a dependency/license allowlist (grep `addon-fit` across `scripts/` and `tests/` returned no hits at baseline outside lockfile/package.json; re-check) and update it if one exists.
- **Tests:** existing `pnpm test:browser --suite terminal-read` still passes (no behavior change yet); `pnpm typecheck`.
- **Done when:** both pass and `window.terminalFixture.instances[0].options.allowProposedApi===true` in a quick fixture check.

### T02 TerminalFind component and counter
- **Goal:** `apps/web/src/TerminalFind.tsx` + `apps/web/src/terminal-find.css` per DESIGN and VISUAL_DESIGN_AND_MOTION (R04 text, R06 keys, R08, R11).
- **Depends on:** T01.
- **Edits:** the two new files; entries in `scripts/public-source-files.json` (sorted); new unit test `tests/terminal-find.test.ts` for `terminalFindCounter`: `null`→`''`; `{index:-1,count:0}`→`No results`; `{index:2,count:12}`→`3 of 12`; `{index:-1,count:5}`→`5 results`; `{index:9,count:1000}` with limit 1000 → `10 of 1000+`.
- **Done when:** `pnpm exec vitest run tests/terminal-find.test.ts` and `pnpm typecheck` pass.

### T03 Wire find into TerminalBody
- **Goal:** Ctrl+F handler (R05), toolbar button, row mounting, debounced typing search, Enter/Shift+Enter, close and focus (R11), live-output refresh (R07), selection side effect untouched (R09).
- **Depends on:** T02.
- **Edits:** `apps/web/src/TerminalBody.tsx` only.
- **Negative checks:** Ctrl+Shift+F / Alt+F inside the terminal still go to the shell as before; Ctrl+Shift+A still selects all; with `ownerCurrent()` false Ctrl+F does nothing special.
- **Done when:** manual check in `pnpm dev` (open a terminal in a project, run `seq 1 3000`, Ctrl+F `29`, Enter/Shift+Enter, Escape, type `echo ok` reaches the shell) matches user flows 1–5; `pnpm typecheck`, `pnpm lint`, `pnpm test:ui-guard` pass.

### T04 Register shortcuts
- **Goal:** four `KEYBOARD_BINDINGS` entries (R10); `aria-keyshortcuts` on the xterm host (R11).
- **Depends on:** T03 (handler code must exist in the shape the test parses).
- **Edits:** `apps/web/src/keyboard-bindings.ts`; adjust statement shape in `TerminalBody.tsx`/`TerminalFind.tsx` only if the test needs it.
- **Done when:** `pnpm exec vitest run tests/keyboard-bindings.test.ts` passes and the Settings keyboard reference lists the four rows under Terminal (that test renders `KeyboardReference`).

### T05 Browser tests and evidence
- **Goal:** extend `tests/e2e/terminal-read.spec.ts` (same suite, same fixture; no new config needed).
- **Depends on:** T04.
- **Scenarios (each asserts `api.requests` has no `input` command produced by the find flow, `api.blocked` and `api.errors` empty):**
  1. Scrollback fixture (reuse the 2,050-line `create` route from "real scrollback…" test): focus `.xterm-helper-textarea`, press `Control+f` → `.terminal-find input` focused; type `line-204`; counter equals `1 of N` where N is computed in the page by scanning `buffer.active` lines for the substring; Enter → `2 of N`; Shift+Enter → `1 of N`; active match row is inside the viewport (`buffer.active.viewportY <= row < viewportY + rows`, row from `terminal.getSelectionPosition()`); Escape → row gone, `.xterm-helper-textarea` focused, then pressing `x` sends exactly one `input` command `x`.
  2. Ctrl+F in terminal does not open conversation Find (the fixture has none; assert `defaultPrevented` via a capture listener installed with `page.evaluate`) and sends no input.
  3. No results: query `zzz` → `No results`, Previous/Next disabled.
  4. Match case: output `Error error ERROR` → `1 of 3`; toggle `Aa` → `1 of 1` for `error`.
  5. Ended terminal (reuse "bounded host output" route, `exited:true`): find works, counter `1 of 1` for `tail`.
  6. Live output refresh: read route appends a second `ready` line after the first search → counter becomes `1 of 2` (or keeps index) within 1 s, active index unchanged.
  7. Toolbar button opens/closes the row, `aria-expanded` toggles, focus returns to the button on close via the X button.
  8. Escape in find input is not propagated: install a `window` keydown listener in the page that records Escape; assert it did not fire.
  9. Reduced motion + narrow 320px dark and light (extend the existing loop or add a sibling): row open, no horizontal overflow, all buttons within 320px, zero running animations after 200ms; screenshots `04-${theme}-narrow-find.png` and a 1000×760 `05-${theme}-find.png` via `info.outputPath`.
  10. Highlight contrast: compute contrast of `#dedede` on both decoration backgrounds (pure function in the spec or unit test) ≥ 4.5.
- **Done when:** `pnpm build && pnpm test:browser --suite terminal-read` passes locally; screenshots attached to the PR.

### T06 Front end team review (required by the maintainer)
- **Goal:** send the finished work (PR link, screenshots from T05, a short screen recording of flows 1–5 in the real app) to the front end team for review, and record their verdict on this issue.
- **Depends on:** T05.
- **Done when:** the front end team's review is linked or summarized on this issue and requested changes are resolved. The issue stays open until then.

## VALIDATION

### Commands (planned, none executed yet)

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test:ui-guard
pnpm exec vitest run tests/terminal-find.test.ts tests/keyboard-bindings.test.ts tests/public-source.test.ts --maxWorkers=1
pnpm build && pnpm test:browser --suite terminal-read
```

### Acceptance matrix

| Req | Check | Task |
|---|---|---|
| R01 | `package.json` exact pin; lockfile updated; addon loaded (fixture check) | T01 |
| R02 | fixture: `options.allowProposedApi===true`; highlights render (screenshot) | T01, T05 |
| R03 | browser scenarios 1, 4 (literal, case toggle) | T05 |
| R04 | unit counter cases; browser 1, 3 | T02, T05 |
| R05 | browser 1, 2: Ctrl+F opens, no input sent, default prevented | T03, T05 |
| R06 | browser 1, 8: Enter/Shift+Enter/Escape, no propagation | T03, T05 |
| R07 | browser 5, 6; reset on New terminal (manual) | T03, T05 |
| R08 | screenshots dark/light, narrow, reduced motion; front end review | T05, T06 |
| R09 | browser 1: no `addExcerpt` and no prompt change (fixture has no excerptComposer unless provided; add one via `terminalFixture.update` with a recording `addExcerpt`) | T05 |
| R10 | `tests/keyboard-bindings.test.ts`; Settings reference rows | T04 |
| R11 | browser: roles, labels, `aria-pressed`, `aria-expanded`, focus return | T05 |
| R12 | browser: request log shows no new paths and no `input` commands from find | T05 |

Release gate: all commands pass, screenshots on the PR, T06 review recorded. Browser fixtures do not prove packaged Windows behavior; a short check in the packaged desktop app (Ctrl+F in a terminal does not open the Electron/Chromium find or conversation Find) is recorded separately in the PR.

## STATE

- Researched and decided: everything above (r1). Implemented: nothing. Verified: nothing.
- Owners/branches: none yet. Plan file branch `devin/terminal-find-plan` (docs-only PR).
- Risks: (1) `allowProposedApi` is a global xterm option; acceptable because only our own code calls APIs. (2) The registry test's statement parsing may require the Ctrl+F guard in a specific shape (T04 handles). (3) Highlight refresh on heavy output could cost CPU: debounced to 250 ms and capped at 1,000 highlights by the addon.
- Next step: an implementing agent claims this issue per AGENTS.md and starts T01.

## REFERENCES

- VS Code terminal basics, Find: https://code.visualstudio.com/docs/terminal/basics/#_find — terminal-scoped Find with Ctrl+F, Enter/Shift+Enter navigation and highlighted matches.
- xterm.js search addon source and typings at the version Gen pins: https://github.com/xtermjs/xterm.js/tree/6.0.0/addons/addon-search (`typings/addon-search.d.ts`; `src/SearchAddon.ts` `DEFAULT_HIGHLIGHT_LIMIT = 1000`; `src/SearchResultTracker.ts` `fireResultsChanged(hasDecorations)` fires only with decorations). `@xterm/addon-search` 0.16.0 and `@xterm/xterm` 6.0.0 were both published 2025-12-22 (npm registry).
- xterm.js `registerDecoration` requires `allowProposedApi` (`src/browser/public/Terminal.ts` at tag 6.0.0, `_checkProposedApi()`).
- Repository files listed in REPO_MAP at `e883ac0327c834120d89c3697dec7380a342ba4d`; `DESIGN.md` motion and overlay rules; `AGENTS.md` publication and checkpoint contract.
