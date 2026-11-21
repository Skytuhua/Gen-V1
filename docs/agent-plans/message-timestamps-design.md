# Design: Message timestamps and date headers (issue #1282, task T08)

Front-end design spec. Behavior, formatting rules and markup come from plan r1 (`docs/agent-plans/message-timestamps.md`, pinned `fccf74c`); this document owns every visual and motion decision. Placeholder classes `message-time` and `conversation-day-divider` are final names.

Mockup: `docs/agent-plans/assets/design/message-timestamps.png`

## Layout

- **Message time.** A single line under each message, `.message-time`: `font-size:11px`, `color:var(--muted)`, `line-height:1.4`, `margin-top:4px`. User messages: right-aligned, `padding-right:4px`, inside the bubble's flex column. Agent/activity messages: left-aligned, `padding-left:2px`.
- **Date divider.** `.conversation-day-divider`: full-width flex row, `gap:12px`, `margin:26px 0`, 11px `var(--muted)` label centered between two `1px var(--border)` rules. The label itself sits on a pill: `padding:2px 10px`, `background:var(--surface)`, `border:1px solid var(--border)`, `border-radius:12px`.
- **Sticky.** The divider is `position:sticky; top:0; z-index:1` with `background:var(--canvas)` so it pins while scrolling its day. No shadow or elevation change when stuck — it reads as structure, not chrome.

## Visibility rule

- Desktop (`hover:hover`): the `.message-time` of a message is `opacity:0` and reveals on `.message:hover` and `.message:focus-within`. Date dividers are always visible.
- Touch (`hover:none`) and keyboard-only contexts: timestamps are always visible (same rule as `.copy-button`, styles.css:377).
- Format: today → `h:mm AM`; earlier → `Yesterday · h:mm AM`; older → `MMM d · h:mm AM`. User messages append `· Delivered`/`· Sending`/`· Failed` only when the send state is not delivered-by-default — no clutter on the common path.

## States

| State | Treatment |
|---|---|
| Default (no hover) | `.message-time` opacity 0 on hover-capable devices; dividers always shown |
| Hover/focus-within | timestamp fades to opacity 1, 120ms `var(--ui-ease-move)` |
| Sending | time + `· Sending`, muted |
| Failed | time + `· Failed`, text `var(--danger)` |
| Empty thread | nothing renders (no dividers) |
| Copy button present | timestamp sits below content, never overlaps the hover copy button |

## Motion

- Timestamp reveal: opacity only, 120ms. No transform, no layout shift (the line height is reserved: `.message` keeps `min-height` of content + 18px meta row? — no: reserve nothing; use `opacity` on an element that already occupies layout space, so reveal never reflows. The `.mtime` row is always in layout at `opacity:0`).
- Divider: no entrance animation; sticky behavior has no animation.
- Reduced motion: identical layout; reveal is instant (opacity ≤80ms) and nothing is spatially animated.

## Accessibility

- Time text is real text (`<time datetime=…>`), not a tooltip — screen readers get it without hover.
- Divider is `role="separator"` with `aria-label="Today"`/`"March 3"`.
