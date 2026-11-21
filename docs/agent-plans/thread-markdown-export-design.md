# Design: Export a thread to Markdown (issue #1236, front-end handoff)

Front-end design spec for the visual/animation decisions plan r1 reserves for this team. Behavior and the `toast`/`ActionMenu` reuse contract are unchanged.

Mockup: `docs/agent-plans/assets/design/thread-markdown-export.png`

## Entry points

- **Thread header actions menu** (`SessionBranchMenu` `ActionMenu`, the `⋯` button): new item `Export to Markdown…` with a download glyph (`⤓`/lucide `download`), meta `.md`. Sits with copy/duplicate actions, above the archive divider.
- **Composer/header secondary spot:** no second button is added — the menu item is the single entry (keeps the header compact).
- Item disabled only for an empty thread; label then `Export to Markdown…` with meta `nothing to export` and `aria-disabled`.

## Save sheet (in-app confirmation)

Small dialog (not a blocking settings modal — uses the shared modal backdrop, 6px blur):

- Title `Export thread to Markdown` (14px/600), sub `Includes messages, plans and tool activity.` (12px `var(--muted)`).
- `File name` field, prefilled `<thread-slug>.md`, mono not required — regular input.
- Footer: `Cancel` (ghost) + `Save…` (`.primary`). `Save…` hands to the native save dialog / downloads; Enter submits, Esc closes.
- Width: 460px max, `var(--ui-dialog-inset)` 24px padding.

## Result feedback — existing `toast` only

- Success: `✓ Exported “<thread title>”` (success pill mark + 12px text).
- Cancel (native dialog dismissed): **no toast** — silence is correct.
- Failure: `Export failed: <reason>` + `Try again` action, error tone (`var(--danger)` mark).
- Toast tokens: 200/160ms, 6s, pause on hover/focus.

## States

| State | Treatment |
|---|---|
| Empty thread | menu item disabled as above |
| Export running | `Save…` becomes `Exporting…` disabled; sheet stays open under 1s is fine |
| Large thread | same sheet; no progress bar (export is local, sub-second to a few seconds) |
| Native dialog cancelled | sheet closes, no toast |

## Motion

- Menu item: standard ActionMenu (180/140ms popover).
- Sheet: shared modal entrance; backdrop blur per modal rules.
- Reduced motion: opacity ≤80ms.

## Accessibility

- Menu item keyboard-reachable like its siblings; the sheet traps focus while open and restores it to the menu trigger.
- Toasts are announced; failure uses `role="alert"` content per the existing toast's behavior.

## Copy

- Menu: `Export to Markdown…`; sheet title same without ellipsis.
- Success: `Exported “<title>”`. Failure: `Export failed: <reason>` + `Try again`.
