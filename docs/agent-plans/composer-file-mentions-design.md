# Design: @-mention project files in the composer (issue #1242, task T10)

Front-end design spec. Menu structure/behavior stays per plan r1 (`docs/agent-plans/composer-file-mentions.md`, pinned `172b8d9` — existing `ComposerCommands`/`Popover`); this file owns look and motion.

Mockup: `docs/agent-plans/assets/design/composer-file-mentions.png`

## Mention menu (popover)

- Shared composer Popover: opaque `var(--surface)`, 12px radius, 5px inset, 38px rows, `width:360px`, opens **above** the caret, 8px gap.
- Header row (non-interactive): `Files matching “<query>”` — 11px `var(--muted)`, `padding:6px 10px 4px`. With no query: `Project files`.
- Row: file-type glyph (lucide file/document, 13px `var(--muted)`) + basename 13px `var(--text)` + right meta 11px `var(--muted)` = parent dir (`apps/web/src`). Long basenames truncate with ellipsis; the meta never wraps.
- Selected/hover: `background:var(--selection-bg)`; keyboard focus identical. Footer divider + hint row: `↑↓ move · Enter attach · Esc close` (12px `var(--muted)`).
- Max ~6 rows visible then scroll (popover cap per shared rules).

## Empty state

- `No files match — keep typing or press Esc.` single muted row; header keeps `Files matching “zzz”`. No error styling.

## Mention token in the draft

- Confirmed mention renders inline as a chip: `padding:1px 8px`, `border-radius:16px`, `background:var(--accent-bg)`, `color:var(--accent-fg)`, 13px, shown as `@<basename>`. It is one atomic unit — caret stops around it, Backspace removes it whole.
- Mid-typing `@app` stays plain text (no chip) until Enter/click confirms.

## Sent message

- In the user bubble, mentions render as the same accent chip **without** the `@` prefix (basename only), keeping the bubble readable. Path is available on the hover tooltip (350ms dwell).

## States

| State | Treatment |
|---|---|
| `@` typed | menu opens filtered to empty query (`Project files`) |
| Filtering | list updates live; selection resets to first row |
| No matches | empty-state row above |
| Files unavailable (no project) | menu shows `No project selected — attach files with ＋.` muted row |
| Escape/blur | menu closes, `@query` remains plain text |
| Denied send | draft + mention chips persist per composer rules |

## Motion

- Popover: 180/140ms, `.95` scale from the caret's origin, `var(--ui-ease-enter)`.
- Row selection: 120ms color.
- Chip insert: opacity only, 120ms — no layout shift (chip replaces the typed text in place).
- Reduced motion: opacity ≤80ms, no scale.

## Accessibility

- `role="listbox"` menu, `role="option"` rows, `aria-selected` on the active row; query text announced via the header line.
- Mention chip in the draft is focusable (`Tab`/`Shift+Tab` or arrow into it), `aria-label="<path> — remove with Backspace"`, and exposes a visible `×`-free removal (Backspace) per the atomic-unit rule.

## Copy

- Header: `Project files` / `Files matching “<query>”`.
- Empty: `No files match — keep typing or press Esc.`
- No project: `No project selected — attach files with ＋.`
