# Design: Paste images into the composer (issue #1237, task T05)

Front-end design spec for the visible states plan r1 reserves for this team (R9). The implementation reuses `ComposerAttachments` — this file defines the chip's look, upload feedback and motion.

Mockup: `docs/agent-plans/assets/design/composer-image-paste.png`

## Pasted-image chip

- Same `resource-chip`/`atch` geometry as file attachments: 10px radius, `var(--subtle)` fill, `1px var(--border)`, `padding:6px 10px`, 12px label.
- Image attachments show a **28×28px thumbnail** (`border-radius:6px`, `object-fit:cover`) in place of the file icon. `mark.png`-style lock/read-only glyph is unchanged.
- Label: `image.png` pasted-name, then size `142 KB` (11px `var(--muted)`). Truncate middle at ~18 chars.
- Remove `×`: 20px icon button, `var(--danger)` glyph on hover `var(--danger-soft)` background (existing composer-dismiss rule).

## Upload feedback

- **In flight:** a 48×3px progress bar inside the chip (`background:var(--border)`, fill `var(--accent-solid)`, indeterminate = 62% slide) replaces the size text. No spinner.
- **Failed:** chip border `var(--danger)`, background `var(--danger-bg)`, size text becomes `Upload failed · Retry` in `var(--danger-fg)`; `Retry` is a real inline action, `×` still removes. Nothing auto-retries.
- **Done:** bar swaps to the size text, 160ms crossfade.

## States

| State | Treatment |
|---|---|
| Paste with image data | chip(s) insert in the attachment row, one per image |
| Paste with no image data | nothing happens — no chip, no error, no toast (clipboard text pastes normally) |
| Multiple images | chips append in paste order, 8px gap, row wraps (max-height 128px, scrolls) |
| Oversize/unsupported | failed-state chip with the real reason (`too large`, `unsupported type`) |
| Send attempted during upload | Send stays disabled until uploads settle; in-flight chips show the bar |
| Denied send | chips and drafts persist per composer rules |

## Motion

- Chip insert/remove: attachment-row tokens — height + opacity 220/180ms, `var(--ui-ease-enter)`; row exists only while attachments are present.
- Progress bar: linear, indefinite; completion swaps via 160ms opacity crossfade.
- Success pulse: none (the chip already reads as attached).
- Reduced motion: chips appear/disappear ≤80ms opacity; progress bar becomes static filled-at-indeterminate styling.

## Accessibility

- Chip `role="listitem"` inside the attachment `role="list"`; `aria-label="image.png, 142 KB"`; failed chip `aria-label="image.png, upload failed"`.
- Retry and remove are named buttons; progress uses `role="progressbar"` with no value while indeterminate.

## Copy

- Upload error: `Upload failed · Retry`. Too large: `image.png is too large (max <limit>)`. Unsupported: `image.png isn't a supported image`.
