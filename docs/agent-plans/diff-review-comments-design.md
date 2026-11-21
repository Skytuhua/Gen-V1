# Design: Comment on the diff, agent fixes it (issue #1288, task T09)

Front-end design spec. Behavior/data/wiring is plan r1 (`docs/agent-plans/diff-review-comments.md`, pinned `8f86cf1`); this file owns the visuals and motion for the gutter affordance, range highlight, inline composer, comment cards, outdated list and send bar.

Mockup: `docs/agent-plans/assets/design/diff-review-comments.png`

## Gutter affordance and range selection

- Diff rows keep the existing grid; a third 20px gutter column (`.plus`) sits between the line numbers and code, empty by default.
- On `.dl:hover` the gutter shows `+` in `var(--accent)` — the "comment on this line" affordance. Click/drag from `+` selects a range.
- Selected range: `.dl.range` gets `background:var(--accent)/8%` (≈ `#91a7ff14`) and a `2px` inset left bar `box-shadow: inset 2px 0 0 var(--accent)`. The accent rail marks the range; the existing add/del green/red backgrounds stay underneath (comment selection never masks diff semantics).
- Untracked files: rows render with a muted meta line `Stage the file to comment` (12px `var(--muted)`), no `+` affordance.

## Inline comment composer

- Inserts as a full-width row inside the diff grid under the last selected line: `.comment-box`, `border-top:1px solid var(--border)`, `background:var(--subtle)`, `padding:10px 12px`, sans-serif (escapes the mono diff context).
- Textarea: `var(--canvas)` background, `1px var(--control-border)`, 8px radius, `min-height:56px`; placeholder `Comment on lines 42–43…` (actual range interpolated; single line → `Comment on line 42…`).
- Footer row: left — 11px `var(--muted)` `Sent to the agent with the diff hunk · Enter to add`; right — `Cancel` (ghost, 12px, `padding:5px 10px`) and `Comment` (`.primary`, same metrics).
- Enter submits, Shift+Enter newline, Esc cancels and restores the diff scroll position. Draft text persists per file+range in the journal (plan requirement) — reopening the same range restores it.

## Comment cards

- Rendered in `.comment-box` strips attached to their hunk: `var(--surface)` body, 8px radius, 12.5px, `border:1px solid var(--border)` — no colored side rail; the anchor to code is a quote block instead of a rail.
- Header: author `You` (12px/600), status pill right:
- Quote block under the header: the commented lines, `11px var(--mono)`, `background:var(--subtle)`, 6px radius, `padding:5px 8px`, `var(--muted)` text, leading line-number column (`512`, `513`) so every comment visibly quotes its hunk; range comments quote up to 3 lines then `…`.
  - `Draft` — neutral pill, only for unsaved text restored from journal;
  - `Sent to agent` — `var(--warning-fg)`/`var(--warning-bg)`;
  - `Resolved` — `var(--success-fg)`/`var(--success-bg)` (card at `opacity:.8`);
  - `Outdated` — neutral pill, when the hunk moved.
- Resolved cards keep visible text (no collapse); an `Outdated comments` disclosure at the file header (`3 comments` pill in `.fhead`, `var(--selection-bg)` neutral) filters the list when clicked.

## Review bar

- `.shell-notice`-style bar pinned at the bottom of the diff pane when ≥1 unsent comment exists: pill `N comments pending`, 12px `var(--muted)` `They go to the agent as one review.`, actions `Send review` (`.primary`, 12px) and `Discard` (ghost, 12px).
- Discard needs no confirmation in v1 if drafts are journal-restorable (plan keeps the text); otherwise a one-line confirm `Discard 2 unsent comments?`.

## States

| State | Treatment |
|---|---|
| Flag off | diff renders exactly as today; no gutter column |
| Loading diff | existing skeleton; comment UI waits |
| Send in flight | bar buttons disabled, label `Sending…` |
| Send failed | bar persists; error toast `Couldn't send the review — <reason>.` + retry; drafts kept |
| Empty (no comments) | no bar, no `.fhead` count pill |
| Resolved all | `.fhead` pill flips to success `All resolved` |

## Motion

- `+` gutter icon and row range highlight: 120ms color (`--ui-motion-hover`).
- `.comment-box` insert/remove: height + opacity, 180/140ms list tokens.
- Review bar: toast tokens (200/160ms).
- No spatial travel for comment cards; status pill changes crossfade 160ms.
- Reduced motion: opacity ≤80ms, highlight instant.

## Accessibility

- `+` affordance is a real button (`aria-label="Comment on line N"`); range selection is keyboard-reachable: focus a line, Shift+↑/↓ extends, Enter opens the composer.
- Comment composer `aria-label="Comment on lines X–Y"`; status pills are text, not color-only.
