# Issue 788 — Keyboard source selection: complete design plan

## META

- **Feature:** Keyboard and assistive access to source selection actions (Ask about this / Attach to prompt / Open source) on `SourceSelectionActions`.
- **Repo:** `skytuhua-org/Gen-V1`
- **Plan revision:** 1 — 2026-11-21
- **Baseline branch:** `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`
- **Issue:** https://github.com/skytuhua-org/Gen-V1/issues/788
- **Current implementation status:** The selection engine already works from the keyboard. Commit `1626c10493bf` (2026-11-19, "support keyboard source selection and toolbar navigation") added `selection.modify`-based Shift+Arrow selection, Ctrl/Cmd+A containment, Shift+F10 toolbar focus, Tab/Shift+Tab focus loop between source body and toolbar, Escape dismissal, and e2e coverage in `tests/e2e/workbench.spec.ts` (`keyboard source selection activates {ask,attach,open}`, `keyboard source select-all and Escape…`, `keyboard source selection supports backward and line boundaries…`). Commit `0deec18c` added forged/hidden/clipped selection refusal. The open gap is **presentation and discoverability**: nothing tells a keyboard user that selection exists or is possible, there is no selection styling contract, no word-level granularity, and no live announcements. This plan fully specifies that layer plus the exact behavior of the existing machinery.
- **Source provenance:** plan authored by `devin-a-cloud-788k` against the baseline commit above; every referenced file, token, keybinding and test was read directly.

## OBJECTIVE

A keyboard-only user must be able to discover, create, adjust, confirm and cancel a text selection inside `.source-selection-text` and reach the three actions, with the same outcomes a pointer user gets — without the message body ever becoming editable or changing its DOM contract (the exact-bytes checks in `SourceSelectionActions` and `mapSelectedText` depend on `textContent` equality). Success is measurable: every step in the issue's reproduction produces a non-collapsed in-element range and the toolbar; WCAG 2.2 targets 2.1.1 (keyboard), 2.4.7 (focus visible), 4.1.3 (status messages) are met for this widget.

## REQUIREMENTS

### In scope

1. `SourceSelectionActions` in `apps/web/src/SourceSelectionActions.tsx` and its stylesheet block in `apps/web/src/source-workbench.css`, used in three places: `SourceWorkbench.tsx:155` (workbench messages), `WorkbenchPanelContent.tsx:62` (`DescriptorSelection`, dock dialog Sources tab), and the formatted-message fallback it renders inline.
2. Visual design of: focus state, keyboard-selection hint, selection highlight, the `Selected source` toolbar, busy/error states, the formatted-message fallback, and the live-region announcements.
3. The complete keyboard contract (table in DESIGN).
4. Reduced-motion, forced-colors and high-zoom behavior.
5. Tests extending the existing e2e/dom suites.

### Out of scope

- Pointer drag behavior (unchanged), `visible()` refusal rules, `mapSelectedText` byte-exactness (unchanged).
- Making the body `contenteditable` or adding caret semantics — explicitly rejected (issue's third option); it would change the DOM contract the byte checks rely on.
- Screen-reader browse mode (already works per the issue).
- Any redesign of `Popover` or the toolbar's three actions.

### Agreed decisions (all taken by this plan; the implementer decides nothing)

- **D1 — Keep boundary-anchored keyboard selection** (the shipped mechanism). A collapsed anchor is created at content start for forward extension and content end for backward extension; the new work is making that anchor *visible and explainable*, not replacing it.
- **D2 — Discoverability via an on-focus hint chip**, not a permanent line under every message (per compact-UI direction). The chip renders only while `.source-selection-text` has focus and no selection exists.
- **D3 — Announce via one visually-hidden live region** per widget instance (`.sr-only` + `role="status"`), mirroring the pattern in `ChatView.tsx:131` and `TaskTableControls.tsx:182`.
- **D4 — Word granularity added**: Ctrl/Cmd+Shift+ArrowLeft/Right extends by word (currently swallowed as character).
- **D5 — Selection styling uses accent tokens**, not the OS default, so the highlight is identical on every platform and legible in both themes.
- **D6 — The toolbar's existing geometry, copy and motion are ratified as-is** and written down below so they can't drift.

### Accessibility / error requirements

- Focus must always be visible (`:focus-visible` ring, 2 px, `var(--ui-focus-ring)`).
- Every state change a sighted user can see is announced in the live region.
- IME composition (existing `composing` guard, `keyCode===229`) suppresses all selection keys — kept.
- The widget never steals the document-wide `Ctrl+A` unless focus is inside the element (already true; restated as a test).

## REPO_MAP (verified)

| File | Role |
| --- | --- |
| `apps/web/src/SourceSelectionActions.tsx` | The widget. `root` = `.source-selection-text` (`tabIndex={enabled?0:undefined}`); `toolbar` = `role="toolbar" aria-label="Selected source"` `Popover`, width 430, height 52 (96 on error). |
| `apps/web/src/source-workbench.css` | `.source-selection`, `.source-selection-text` (`outline-offset:3px`), `.source-selection-toolbar` (row, wrap, `gap: var(--ui-space-1)`, `font-size:13px`, buttons `min-height:32px; flex:1 1 auto`). |
| `packages/ui-shell/Popover.tsx` + `packages/ui-shell/tokens.css` | Portal, placement (`placePopover`, `preferredSide="above"`, `align="start"`, `--ui-popup-gap:8px`, `--ui-popup-gutter:8px`, `--ui-popup-layer:80`), and the popover keyframes. |
| `apps/web/src/styles.css` | Theme tokens (`--accent`, `--selection-bg`, `--text`, `--muted`, `--border`, `--subtle`), `.sr-only` at line 44. |
| `apps/web/src/SourceWorkbench.tsx:155`, `apps/web/src/WorkbenchPanelContent.tsx:62` | The two other call sites — styles must be shared, not per-site. |
| `tests/e2e/workbench.spec.ts` (lines 10–34, 114–115), `tests/source-selection-dom-v3.test.ts` | Existing keyboard + refusal coverage to extend. |

## DESIGN

### A. Keyboard contract (normative — the complete key table)

| Focus is on | Key | Result |
| --- | --- | --- |
| `.source-selection-text` | Shift+ArrowLeft/Right | Create/extend selection by character. No anchor yet → collapse anchor at end (Left) or start (Right), then extend. |
| `.source-selection-text` | Ctrl+Shift+ArrowLeft/Right (⌘+Shift on macOS) | Same, granularity **word**. |
| `.source-selection-text` | Shift+ArrowUp/Down | Extend by line, clamped inside the element (existing behavior). |
| `.source-selection-text` | Shift+Home / Shift+End | Extend to line boundary (existing `lineboundary`). |
| `.source-selection-text` | Ctrl+A / ⌘+A | Select element contents only (existing; never the document). |
| `.source-selection-text` | Tab (selection open) | Move focus to first toolbar button. |
| Toolbar first button | Shift+Tab | Move focus back to `.source-selection-text`, selection kept. |
| Toolbar buttons | Tab / Shift+Tab, Enter, Space | Move between buttons; activate. |
| Anywhere in widget | Shift+F10 (selection open) | Focus first toolbar button (existing). |
| Anywhere in widget | Escape | Dismiss toolbar, keep the `dismissed` range guard, return focus to `.source-selection-text` (existing). |
| `.source-selection-text` | Arrows without Shift | No selection created; element keeps focus (scrolls if scrollable). |

Any keystroke not listed falls through to the browser. `selection.modify` absence (non-Chromium) falls back silently: range creation still happens for the anchor; extension may be no-op — acceptable per existing tests which pin Chromium.

### B. Layout & appearance — source text element

- `.source-selection-text`: unchanged box (fills its parent message block). `outline-offset:3px` retained.
- **Focus ring**: `:focus-visible` → `outline:2px solid var(--ui-focus-ring); outline-offset:3px` (current effective behavior; codified).
- **Selection highlight**: `.source-selection-text ::selection` → `background: color-mix(in srgb, var(--accent) 26%, transparent); color: var(--text)`. Light theme resolves to a pale blue over `#fff`; dark theme to a pale indigo over `#000`. Do not use `--selection-bg` (that's the chrome hover tint, too gray to read as a text selection).
- **Active-selection ring**: while a non-collapsed accepted selection exists inside it, `.source-selection-text` also shows `outline:2px solid var(--accent); outline-offset:3px` (data attribute `data-selection="active"` on the element; the outline appears even when focus has moved into the toolbar so the user sees what they selected). This replaces, not stacks with, the focus ring — same geometry, accent color.
- **Forced colors**: under `@media (forced-colors: active)` the `::selection` rule is omitted (platform Highlight wins) and the active ring uses `outline-color: Highlight`.

### C. Hint chip (new, the D2 affordance)

A small caption chip rendered **above the element's top edge, inline-end aligned**, while `:focus-visible` is on `.source-selection-text` AND no candidate selection exists AND `enabled`.

- Position: absolutely positioned, `top:0; inset-inline-end:0; transform:translateY(-100%)` with `margin-bottom:2px` — sits against the outline without covering text. `.source-selection` gets `position:relative` (currently unset; adding it is safe — `min-width:0` retained).
- Box: `padding:3px 8px; border-radius:6px; background:var(--surface); border:1px solid var(--border); color:var(--muted); font-size:11px; line-height:16px; font-weight:500; letter-spacing:0.01em; white-space:nowrap; box-shadow:none; pointer-events:none` (non-interactive; it must never be a hit target or focusable).
- Copy (exact): `Shift+arrows select · Ctrl+A all · Shift+F10 actions`
- Appearance: mount with `opacity:0→1`, `var(--ui-motion-tooltip-enter)` 160 ms, `var(--ui-ease-enter)`, plus `translateY(2px)→0`. It is removed instantly (no exit animation) the moment a candidate appears or focus leaves.
- Reduced motion: appear/disappear instantly, opacity only, ≤80 ms.
- Announcement-only equivalent: `aria-keyshortcuts="shift+ArrowRight control+a shift+f10"` on `.source-selection-text` and `aria-describedby` pointing at an `.sr-only` sibling whose text is: `Selectable source. Use Shift plus arrow keys to select text, Control A to select all, Shift F10 for actions.` (Visible chip is `aria-hidden="true"`.)

### D. `Selected source` toolbar (ratified as shipped)

- Container: `Popover`, `role="toolbar"`, `aria-label="Selected source"`, width 430 px, height 52 px (96 px while `error` is non-empty), `preferredSide="above"`, `align="start"`, anchored to the live `range.getBoundingClientRect()`; `tabIndex={-1}`, `onPointerDown` preventDefault (focus never leaves source/toolbar to the page).
- Row: `flex-direction:row; flex-wrap:wrap; gap:var(--ui-space-1)` (4 px); `font-size:13px`; `overflow-y:hidden`.
- Buttons (order, copy exact): `Ask about this` · `Attach to prompt` · `Open source`. Each `type="button"`, `min-height:32px`, `flex:1 1 auto`, base `.ui-control-popup .ui-control-option` styling; `:focus-visible` → `outline:2px solid var(--ui-focus-ring); outline-offset:-2px`; `:hover:not(:disabled)` → `background:var(--hover)`; `:active:not(:disabled)` → `transform:scale(.97)` for `--ui-motion-press` 80 ms.
- Busy: all three buttons `disabled` while `onAction` is in flight (existing `busy` state). No spinner is added — the disabled paint is the whole affordance.
- Error: `[role="alert"]` `width:100%` row under the buttons showing the caught message (e.g. `Source could not be captured.`); color `var(--danger)`; popover height 96 px.
- Motion: enter = `ui-popover-in` 180 ms `var(--ui-ease-enter)` (opacity 0→1, `translateY(4px)→0`, `scale(.98)→1`); exit = `ui-popover-out` 140 ms `var(--ui-ease-move)`. Reduced motion: `ui-popover-fade` only, 80 ms (`--ui-motion-press`).
- Placement rules: `placePopover` clamps to the visual viewport with `--ui-popup-gutter` 8 px; if the selection rect is nearer the bottom, `preferredSide` flips below via the existing placement contract (no new code, but an e2e assertion at both existing viewports + 200 % zoom — the test `toolbar stays reachable at both viewports and 200 percent zoom` already exists and is kept).

### E. Live announcements (`.sr-only` `role="status"` `aria-live="polite"` `aria-atomic="true"`)

Sibling inside `.source-selection`, updated on transitions only (never while selection size changes by a few chars — debounce to the same tick the candidate state commits):

| Event | Exact announcement |
| --- | --- |
| Candidate accepted | `Selected “{first 60 chars of selection.text, trimmed, ellipsized}”. Press Shift F10 or Tab for actions.` |
| Selection replaced | same template with new text |
| Toolbar dismissed (Escape / focus out / selection collapsed) | `Selection cleared.` |
| Action succeeded | `Done.` (then selection cleared announcement does **not** fire — single update) |
| Action failed | error text via `role="alert"` (existing), not the status region |
| Formatted-message fallback visible | `Inline selection is unavailable for this formatted message.` (already a `role="status"` `<p>` — kept verbatim) |

### F. Formatted-message fallback (ratified, restyled to match)

The existing `<p className="muted" role="status">` stays. Exact layout: `font-size:12px; color:var(--muted); margin:4px 0 0; line-height:1.5`. The `Select canonical source` button inside it uses the standard control style (`min-height:28px; padding:4px 10px; font-size:12px; border:1px solid var(--control-border); border-radius:6px; background:var(--selection-bg); color:var(--text)`), matches `file-checkpoints button` rhythm. `disabled` while busy; error appended as `[role="alert"]` `var(--danger)`.

### G. State matrix

| State | Visual |
| --- | --- |
| Rest (unfocused) | Plain message text; no ring, no chip. |
| Focused, no selection | Focus ring (muted) + hint chip above, inline-end. |
| Selecting (candidate live) | Accent selection highlight + accent ring; chip gone; toolbar open. |
| Toolbar focus | Accent ring stays on text; toolbar button focus ring. |
| Busy | Buttons disabled; selection + ring persist. |
| Error | Toolbar 96 px; red alert row; selection persists. |
| Dismissed | Selection highlight cleared (or kept range guard for pointer); focus on text; live region `Selection cleared.` |
| Disabled (`enabled=false`) | Not focusable, no chip, no hint. |
| Non-exact rendering | Fallback paragraph only. |

### H. Motion summary

| Element | Enter | Exit | Reduced motion |
| --- | --- | --- | --- |
| Hint chip | 160 ms ease-enter, fade + 2 px rise | instant | instant, opacity only |
| Toolbar | 180 ms ease-enter, fade + 4 px rise + scale .98→1 | 140 ms ease-move, same curve out | 80 ms fade only |
| Active ring / selection | no animation (state paint) | — | same |
| Button press | 80 ms scale(.97) | 80 ms back | none |

## EXECUTION_DAG

Stable IDs; each names files, acceptance and done-when.

- **T01 — CSS: selection + active ring + chip.** Edit `apps/web/src/source-workbench.css`: add `position:relative` to `.source-selection`; add `::selection` rule, `[data-selection="active"]` ring, `.source-selection-hint` chip rules, forced-colors block, reduced-motion overrides. No other file touches these selectors. Done-when: `pnpm exec vitest run tests/source-selection-dom-v3.test.ts` still green (it asserts classes/attrs; add `data-selection` there if the suite reads attributes) and the chip/ring rules exist verbatim in the file.
- **T02 — Hint chip + described-by.** Edit `SourceSelectionActions.tsx`: render chip + `.sr-only` description; add `aria-keyshortcuts`, `aria-describedby`, `data-selection={candidate?'active':undefined}` on `.source-selection-text`. Done-when: DOM test asserts `aria-keyshortcuts`, described-by id resolves, chip hidden once a candidate exists.
- **T03 — Word granularity.** In the existing `keydown` handler, when `event.ctrlKey||event.metaKey` and key is ArrowLeft/Right with Shift, call `selection.modify('extend', dir, 'word')` instead of `'character'`. ~4-line change. Done-when: new e2e assertion selects a whole word from the anchor.
- **T04 — Live region.** Add `.sr-only` `role="status"` sibling wired to the candidate/busy/error transitions per table E. Done-when: DOM test sees `Selected “…”` then `Selection cleared.`/`Done.` strings.
- **T05 — Fallback restyle.** Adjust the fallback `<p>` + button classes in the same files (T01 may carry the CSS). Done-when: snapshot of the formatted-message path shows the spec'd spacing.
- **T06 — Tests.** Extend `tests/e2e/workbench.spec.ts`: chip appears on focus and hides on selection; Ctrl+Shift+Arrow selects by word; live region content; focus ring/`data-selection` present after Escape+reselect. Extend `tests/source-selection-dom-v3.test.ts` for attributes. Done-when: full file green.
- Dependencies: T01 before T02/T05; T02–T05 independent edits in the same component — do them in one commit; T06 last.
- Ownership: single worker, single PR, `apps/web/src/SourceSelectionActions.tsx`, `apps/web/src/source-workbench.css`, the two test files. No other files.

## VALIDATION

Planned (not yet executed in this session):

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck
pnpm exec vitest run tests/source-selection-dom-v3.test.ts tests/source-selection-v3.test.ts
pnpm exec playwright test -c tests/e2e/workbench.playwright.config.ts   # keyboard specs
pnpm exec playwright test -c tests/e2e/workbench-app.playwright.config.ts  # issue's repro fixture
```

Expected: all green. Acceptance matrix:

| Criterion | Check |
| --- | --- |
| Issue repro produces range + toolbar | workbench-app fixture: focus → Shift+Arrow → `rangeCount===1`, toolbar count 1 |
| Discoverability | chip visible on `:focus-visible`, hidden on selection/focus-out |
| Announcements | live region strings per table E |
| No DOM-contract change | `mapSelectedText` + exact-bytes tests unchanged and green |
| Reduced motion | media-emulated run: no transform animations |
| Forced colors | `forced-colors` emulation: Highlight outline, no custom selection bg |
| Regression | existing keyboard, refusal, IME, zoom specs all pass unchanged |

## STATE

- **Researched/decided:** everything above (D1–D6, tables A–H).
- **Implemented:** nothing in this PR — docs only.
- **Verified:** baseline code read at `e883ac0`; issue repro measurements taken on the issue stand for the pre-`1626c104` state and are now partly stale (anchor-creation path exists) — recorded here so the implementer does not re-litigate the mechanism.
- **Pending:** implementation T01–T06.
- **Risks:** (1) `selection.modify` is non-standard — unchanged scope, Chromium-pinned tests; (2) absolute-positioned chip could clip against a scrolled ancestor — `overflow` ancestors audited: `.source-selection` parents do not clip above-box (verify once in workbench fixture, fallback `transform:translateY(calc(-100% - 4px))` if it clips); (3) `aria-keyshortcuts` support varies — purely additive, harmless where ignored.
- **Next step:** implementer claims issue #788, runs T01–T06, opens PR, runs the VALIDATION block.

## REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/788
- `apps/web/src/SourceSelectionActions.tsx` @ `e883ac0`
- `packages/ui-shell/tokens.css`, `packages/ui-shell/controls.css`, `packages/ui-shell/Popover.tsx`
- `apps/web/src/source-workbench.css`, `apps/web/src/styles.css` (`.sr-only`, theme tokens)
- Prior work: `1626c10493bf` keyboard selection; `0deec18c` forged/hidden refusal
- Tests: `tests/e2e/workbench.spec.ts`, `tests/e2e/workbench-app.spec.ts`, `tests/source-selection-dom-v3.test.ts`
- Related: issue #583 (workbench dock accessibility pass)
