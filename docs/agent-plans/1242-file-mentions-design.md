# Design plan: @-mention file picker, mention chips and sent-message list (issue #1242, task T10)

## META

| Field | Value |
|---|---|
| Feature | Visual design, motion and front-end treatment for `@`-mention files in the composer |
| Issue | https://github.com/skytuhua-org/Gen-V1/issues/1242 (canonical plan: `docs/agent-plans/composer-file-mentions.md`, rev r1) |
| Scope | T10 only — how the mention menu, in-text mentions and sent-message list look and move. Behavior, data, contracts, keyboard and a11y semantics are already fixed by plan r1 (R01–R15) and are NOT re-decided here. |
| Baseline | `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52` (read on 2026-11-21) |
| Author | `devin-cloud-frontend-a3f9` (front-end team), revision r1, 2026-11-21 |
| Grounding files | `apps/web/src/ComposerCommands.tsx`, `apps/web/src/composer-commands.css`, `packages/ui-shell/Popover.tsx`, `packages/ui-shell/tokens.css`, `apps/web/src/styles.css`, `apps/web/src/composer-entry.css`, `apps/web/src/ComposerAttachments.tsx`, `apps/web/src/motion-policy.ts` |

Everything below is normative. The implementer makes no design decisions: sizes, spacing, type, colors, copy, states and motion values are all specified. Where a token or class name is quoted, it already exists in the codebase at the baseline SHA.

## 1. Design intent

The mention picker must feel identical to the existing `/` command menu: same popover surface, same row rhythm, same enter/exit motion, same footer hint. Users should learn zero new patterns. S prefers compact UI: tighter rows than the command menu (34 px vs 38 px), narrower popover, smaller footer.

Mentions themselves are shown as **chips**, reusing the existing `resource-chip` visual language (already used for attachments and skill bindings), not inline-styled text — the composer is a plain `<textarea>` and cannot style substrings. The literal `@path` in the text stays plain.

## 2. Components

Three new styled surfaces, all in `apps/web/src/composer-mentions.css` (new file):

| Class root | Component | Purpose |
|---|---|---|
| `.composer-mention-*` | `ComposerMentions.tsx` popover | File picker anchored above the composer |
| `.composer-mention-chip` | Mention chips in the composer's attachment band | One chip per recorded mention |
| `.message-file-mentions` | `MessageFileMentions.tsx` | List under a sent user message |

No new tokens. Use only the existing custom properties from `styles.css` and `ui-shell/tokens.css`.

## 3. Mention popover (`ComposerMentions.tsx`)

### 3.1 Placement and geometry

- Same `Popover` call shape as `ComposerCommands.tsx:105`: `preferredSide="above"`, `align="start"`, anchored to the `<textarea>` element.
- **Width: 480 px** (narrower than the 600 px command menu — file rows carry less text). `placePopover` already clamps to viewport gutters (`--ui-popup-gutter`, 8 px).
- **Height: `Math.min(304, Math.max(92, items.length * 34 + chrome))`** where `chrome` = footer hint (28 px) + status rows when present. Max 304 px shows ~7 rows; list scrolls beyond that. Min 92 px keeps the empty/loading states from collapsing into a sliver.
- Repositioning, outside-pointer dismiss, focus retention and portal mounting are already handled by `Popover`; do not add geometry code.

### 3.2 Surface

Reuse the command popover surface verbatim:

```css
.composer-mention-popover {
  background: var(--surface, #0f0f0f);
  color: var(--text, #e6e6e6);
  border: 1px solid var(--border, #282828);
  border-radius: 12px;
  box-shadow: var(--elevation, 0 12px 34px -12px #0009);
  padding: 5px;
  display: flex; flex-direction: column; gap: 3px;
  overflow: hidden; font-size: 13px;
}
```

(These are the same declarations as `.composer-command-popover` — duplicate them under the new class; do not restyle the command menu's class.)

### 3.3 Option rows

`.composer-mention-list` = `.composer-command-list` rules (`min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; flex:1`).

Each `role="option"` row, in order:

```
[icon 14px] [file name 13px/550] [directory path, truncated, muted 12px] [(truncated badge)]
```

```css
.composer-mention-option {
  display: flex; align-items: center; gap: 8px;
  min-height: 34px; padding: 5px 9px;          /* 4 px tighter than command option (38px) */
  border-radius: 7px; cursor: pointer; line-height: 1.35;
}
.composer-mention-option[aria-selected="true"] { background: var(--hover, rgba(127,127,127,.14)); }
.composer-mention-icon { color: var(--muted, #969696); flex: 0 0 auto; }   /* lucide File, size 14, strokeWidth 1.75 */
.composer-mention-name { font-weight: 550; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.composer-mention-dir {
  color: var(--muted, #969696); font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
}
```

- Icon: `lucide-react` `File` at `size={14}`. No file-type-specific icons in v1 (no icon map exists; adding one is out of scope).
- `name` is the basename; `dir` is the dirname from the suggestion item (`directory` field), shown empty string → render nothing (no leading `/`).
- `title` attribute on the row = full `path`, so hover reveals the complete path for truncated names.
- The `directory` element is the flex-grow:1 item; `name` never shrinks below its natural width until the row runs out of space, then `name` ellipsizes (it has `overflow:hidden` first in flex order with `max-width:55%` — see mobile rule).

### 3.4 Footer hint

Identical pattern to `.composer-command-hint`, with mention-specific copy:

```css
.composer-mention-hint {
  display: flex; justify-content: space-between;
  padding: 5px 8px 2px; border-top: 1px solid var(--border, #333);
  color: var(--muted, #969696); font-size: 11px;
}
```

Copy (exact strings):
- Left: `↑ ↓ Navigate`
- Right: `Enter Select · Tab Select · Esc Close`
- `aria-hidden="true"`.

### 3.5 Status rows

Same layout as `.composer-command-status` (`display:flex; align-items:center; gap:7px; padding:8px; font-size:12px`), role `status`, plus `aria-live` off (the parent polite region already announces; see §7). Exact copy per state (from plan r1 §5):

| State | Icon (lucide, size 13) | Text |
|---|---|---|
| Loading | `LoaderCircle` + class `spinning` | `Searching files…` |
| Empty query, results listed | — | (rows only; no status) |
| No results | `Search` size 14 | `No matching files` |
| Partial results (`complete:false`) | — | `Showing first results; keep typing to narrow` |
| Error | `ErrorState` component, `retryLabel="Retry"` | `Couldn't load files.` + `Retry` button |
| No project bound | `FolderOpen` size 13 | `Connect a project to mention files.` |
| Flag off (`enabled:false`) | — | menu closes (§4.4) |

Error retry button: inherits `.composer-command-status button` styling — copy that rule: `border:0; background:none; color:var(--accent,#8b83ff); padding:5px; cursor:pointer;`.

### 3.6 Mention chips in the composer

Recorded mentions render inside the existing attachment band, **before** attachment chips, in a `role="group"` `aria-label="Mentioned files"` wrapper. Reuse `resource-strip` and `resource-chip` so chips match attachments exactly; add a modifier:

```css
.composer-mention-chip { }
.composer-mention-chip>svg { color: var(--accent-fg); }      /* File icon, size 12 — accent marks it as a mention, not an upload */
.composer-mention-chip>span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.composer-mention-chip button {
  display:inline-flex; align-items:center; justify-content:center;
  background:none; border:0; color:inherit; cursor:pointer; border-radius:4px; padding:3px;
}
.composer-mention-chip button:focus-visible { outline:2px solid var(--ui-focus-ring,#808080); outline-offset:1px; }
```

- Chip content: `File` icon (size 12, `aria-hidden`), basename (`title` = full path), and an `X` (size 12) remove button with `aria-label="Remove mention <basename>"` and `disabled` mirroring the composer disabled state.
- Max width 220 px, `font-size:12px` (shell.css already sets `.resource-chip` to 12 px), `padding:4px 7px`, `border-radius:6px`, `border:1px solid var(--border)` — all inherited from `.resource-chip`; the modifier class adds only the accent icon and the remove button.
- Chip click (on the label, not the X): no action. Chips are not buttons; keep them non-interactive except the X.
- Removing a chip deletes the recorded mention **and** strips the first literal `@path` / `@"path"` occurrence plus one trailing space from the draft text (implementer: the parser in `composer-mentions.ts` already computes the literal; reuse `mentionLiteral(path)`). If the token is not found in the text (user already deleted it), just drop the record — no text edit.
- Order = insertion order, matching the draft's left-to-right mention order (the list is already ordered by selection).
- Max 8 mentions (contract). When the draft holds 8 mentions the picker still opens but selecting a 9th is impossible by construction — no UI needed beyond that.

### 3.7 Sent-message list (`MessageFileMentions.tsx`)

Under the user message bubble (`App.tsx:1178` user-row branch), after the `Markdown` body, inside `.message-content`? No — outside the bubble so the bubble keeps its shape: render as a sibling after `.message-content`, right-aligned to match `.message-user`'s `align-items:flex-end`.

```css
.message-file-mentions {
  display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end;
  margin-top: 4px; max-width: 86%;           /* same as .message-user>.message-content max-width */
}
.message-file-mentions-label { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
.message-file-mention {
  display:flex; gap:5px; align-items:center;
  border:1px solid var(--border); padding:4px 7px;
  font-size:12px; border-radius:6px;
  max-width:220px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;
  color:var(--muted);
}
.message-file-mention>svg { color:var(--accent-fg); }
.message-file-mention-truncated { color:var(--muted); font-size:10px; flex:0 0 auto; }
```

- Wrapper: `<div className="message-file-mentions">` containing `<span className="message-file-mentions-label">Mentioned files</span>` (sr-only text, use the existing `.sr-only` class instead of duplicating it — the declaration above is only shown for reference) then one `.message-file-mention` chip per item.
- Chip content: `File` icon (size 12), `path` (full relative path, `title` = path + sha256 prefix is unnecessary — title = full path only), and when `truncated` the literal text `(truncated)` in `.message-file-mention-truncated`.
- On 700 px breakpoint the wrapper follows the existing `.message-user>.message-content{max-width:92%}` rule — add `.message-file-mentions{max-width:92%}` inside the existing `@media(max-width:700px)` block.
- Non-interactive: chips have no hover state, no click. They are metadata.

## 4. Behavior-impacting visuals

### 4.1 Draft-time in-text token

Nothing. The `@path` in the textarea is plain text in `var(--text)` — no highlight, no pill. This is deliberate: the textarea cannot style substrings, and the chips row (§3.6) is the visual record.

### 4.2 Prediction ghost text

While the mention menu is open the existing prediction ghost text is hidden (plan r1 flow 7). Implementation detail for the implementer; visually the ghost simply does not render. No fade — instant removal, matching how it already appears/disappears.

### 4.3 Slash/mention exclusivity

Only one popover is ever visible. If a `/` token is active the mention menu does not mount (and vice versa); no crossfade — one is simply unmounted while the other mounts, each running its own enter animation.

### 4.4 Flag-off close

When a response returns `enabled:false`, the popover closes via the normal dismiss path (runs the exit animation, §5). A per-owner ref then prevents reopening — `@` remains plain text with no visual indication. No toast, no banner.

### 4.5 Send-failure error

Host rejections (`FILE_MENTION_UNAVAILABLE`, `CAPABILITY_DENIED`, `RESOURCE_LIMIT`) surface through the **existing** composer error path — the `composer-command-error`-style inline row below the composer is already the established pattern for send errors in this codebase (`.composer-command-error` / the `error-text` class). Reuse the existing renderer's error surface; do not invent a new toast. The error text is the host's message verbatim; draft and chips stay put.

## 5. Motion spec

All motion reuses existing token values. No new keyframes, no new tokens, no JS springs.

| Surface | Property | Value |
|---|---|---|
| Popover enter | `ui-popover-in` keyframes (opacity 0→1, translateY 4px→0, scale .98→1) | `var(--ui-motion-popup-enter)` 180 ms, `var(--ui-ease-enter)` `cubic-bezier(.16,1,.3,1)` |
| Popover exit | `ui-popover-out` | `var(--ui-motion-popup-exit)` 140 ms, `var(--ui-ease-move)` `cubic-bezier(.4,0,.2,1)` |
| Chip insert (composer + sent list) | `ui-item-in` (already applied to `.resource-chip:not([data-leaving])`, `styles.css:358`) | `var(--ui-motion-insert)` 180 ms, `var(--ui-ease-enter)` |
| Chip remove | `ui-item-out` via `data-leaving` (already in `styles.css:359`) | `var(--ui-motion-remove)` 140 ms, `var(--ui-ease-move)` |
| Option hover/selected change | `background-color` transition | `var(--ui-motion-hover)` 120 ms, `var(--ui-ease-move)` |
| List content swap (loading → rows) | none — instant replace; the popover container does not animate height | — |

**Height changes**: the popover's `height` prop changes as items load/filter. Do **not** transition `height` (a `position:fixed` popover re-anchored per frame reads as jitter; the command menu does not animate it either — parity wins).

**No stagger** on list items: results arrive as one fetched batch and re-rank on every keystroke; animating rows on each keystroke is motion for its own sake (see `remove-animations` skill: no motion on functional, high-frequency updates).

**Interrupted close**: `Popover` already holds the exit lifecycle (`leaving`) — closing mid-enter is handled by the keyframe reversal, no extra work.

**Reduced motion** — three cases, all already covered by existing infrastructure; the implementer must not add motion that bypasses them:
1. `prefers-reduced-motion: reduce`: `tokens.css:70-73` swaps popover animations to `ui-popover-fade` at `var(--ui-motion-press)` (80 ms); `styles.css:369` swaps chip/item animations to the same fade.
2. `data-motion="reduced"|"off"` on `:root` (app setting via `motion-policy.ts` `readMotionPolicy`): the same reduced policy applies; `.app-shell[data-panel-animations="false"]` disables panel animations.
3. Chip enter/leave bookkeeping must follow `ComposerAttachments.tsx` exactly: check `reducedMotion()` (from `./task-motion`) and `data-panel-animations` before scheduling `data-leaving` — when motion is off, delete from the cache immediately (no ghost chips).
4. `LoaderCircle.spinning` keeps spinning under reduced motion (existing convention — it is a progress indicator, not decoration; `prefers-reduced-motion` guidance allows it, and the codebase keeps it).

**Forced colors** (`@media (forced-colors:active)`): add `.composer-mention-option[aria-selected=true]{outline:1px solid Highlight;background:Highlight;color:HighlightText}` and `.composer-mention-chip,.message-file-mention{border-color:ButtonText}` — same treatment as the command option and skill chip rules in `composer-commands.css`.

**Focus-visible**: rows are not focusable (focus stays in the textarea per R12), but the Retry button and chip remove buttons get `:focus-visible{outline:2px solid var(--ui-focus-ring,#808080);outline-offset:1px}` — copy the existing rule.

**Mobile** (`@media(max-width:480px)`, matching `composer-commands.css`):
```css
.composer-mention-option { gap:6px; padding:5px 7px; }
.composer-mention-dir { font-size:11px; }
.composer-mention-name { max-width:55%; }
.composer-mention-hint { font-size:10px; }
```

## 6. States matrix (every visible state, settled)

| # | State | What renders |
|---|---|---|
| 1 | Closed, plain `@` | Nothing. Text is plain. |
| 2 | Open, loading (first or refetch) | Popover + status row `Searching files…` (spinner). If a previous result set exists, keep showing it **under** the loading row — no flicker (status row appends below, list stays). |
| 3 | Open, results | Rows per §3.3, first available option `aria-selected`. Footer hint visible. |
| 4 | Open, empty query | Rows = nearest-root files (behavior in r1); identical to state 3 visually. |
| 5 | Open, no results | `No matching files` status row; list empty; hint stays. |
| 6 | Open, partial (`complete:false`) | Rows + `Showing first results; keep typing to narrow` status above the hint. |
| 7 | Error | `ErrorState` with `Retry` (accent link-style button). List area empty. Hint stays. |
| 8 | No project | `Connect a project to mention files.` — no list, no hint; popover at min height 92 px. No request is sent (r1). |
| 9 | Flag off | Menu closed after first response; `@` types as text. |
| 10 | 8 mentions recorded | Chips row shows 8; picker behavior unchanged. |
| 11 | Chip removed | Chip plays `ui-item-out`; siblings reflow instantly (wrap, no FLIP animation). |
| 12 | Send rejected | Composer unchanged (draft + chips retained); error text via existing error surface (§4.5). |
| 13 | Sent | Bubble + `.message-file-mentions` chips row (§3.7); `@path` literals remain inline in the message text. |
| 14 | `aria-disabled` rows | Not used — the suggestion API never returns unselectable items. |

## 7. Accessibility (visual side of the already-fixed contract)

R12 fixes the ARIA contract; this section only assigns the visible treatment:

- `aria-activedescendant` = the `aria-selected` row id — the `var(--hover)` background IS the focus indicator; do not also draw an outline on the row.
- Result-count/status announcements use the same polite status region pattern as the command menu (`role="status"` rows inside the popover + the app's existing `announcement` live region for out-of-menu state changes). Copy from §3.5 exactly.
- `aria-label` on the popover listbox: `"File suggestions"`.
- Chip group `aria-label`: `"Mentioned files"`. Sent list label text: `Mentioned files` (sr-only).
- Tab order never enters the popover (pointer-only interactions inside, same as commands) — so no `:focus-visible` styles on rows or the hint.

## 8. Implementation notes for the implementer

- `ComposerMentions.tsx` mirrors `ComposerCommands.tsx` structure; copy its DOM skeleton and swap the classes named here. Do not share the command CSS file — create `composer-mentions.css` and duplicate only the declarations listed above (command-menu classes must not change).
- New files for the manifest (`scripts/public-source-files.json`, `source` entries): `apps/web/src/composer-mentions.css`, `apps/web/src/MessageFileMentions.tsx` (plus whatever r1 already lists for `.ts` files).
- Icons: `File`, `LoaderCircle`, `Search`, `FolderOpen`, `X` from `lucide-react` — all already imported elsewhere in the app.
- Do not add dependencies, tokens, keyframes or font files.
- Type: rows at 13 px / name weight 550 / dir 12 px match the command menu; chips at 12 px match `.resource-chip`; hint 11 px matches command hint.

## 9. Open questions — none

All decisions above are final and grounded in existing code at the baseline SHA. If implementation discovers the Popover `width`/`height` props cannot express the values in §3.1, use the closest clamped values and record the deviation in the T10 checkpoint — do not invent an alternative geometry.
