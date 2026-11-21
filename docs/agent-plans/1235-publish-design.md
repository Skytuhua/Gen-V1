# Design: Publish (commit, push and PR from a thread) — front-end spec (issue #1235 task T09; covers #1272 T06, #1273 T07, #1274 T08)

Front-end design spec. Structure/behavior lives in the sub-plans (`1235-t06-publish-review-ui.md`, `1235-t07-pr-card.md`, `1235-t08-recovery-ui.md`); this file owns layout, tokens, copy and motion.

Mockups: `docs/agent-plans/assets/design/publish-review-sheet.png`, `docs/agent-plans/assets/design/publish-pr-card-recovery.png`

## 1. Composer "Create PR" chip

- Lives in the composer control row as a `chip`-style action when the thread has a managed copy: `⎇ Create PR · <n> files` — `background:var(--accent-bg)`, `color:var(--accent-fg)`, 16px radius, 12px.
- Hidden when the `publishV1` flag is off or the working copy is clean. While a publish is in flight the chip reads `Publishing…` and is disabled.

## 2. Review sheet (T06)

Shared modal: `var(--ui-modal-scrim)` + 6px backdrop blur, `max-width:720px`, `border-radius:12px`, `var(--surface)`, `var(--elevation)`. Header 14px/600 `Review before publishing`, red `×` close. Body `padding:16px 18px`, footer right-aligned ghost+primary.

Sections, in order, each with an 11px `var(--muted)` label (`field-label`, `margin:14px 0 6px`):

1. **Branch to push** — one mono line `devin/<slug> → origin`, 12px.
2. **Files · <n> changed** — inset card (`1px var(--border)`, 10px radius, `padding:4px 6px`). Each row 7px padding: checkbox (16px, `var(--accent-solid)` fill when on) + mono path + right-aligned `+a −b` (`var(--success)`/`var(--danger)`, 12px). `new` files get a neutral pill. Excluded/untracked rows at `opacity:.6` with meta `untracked — excluded`. Hover: `var(--subtle)`. Whole-file include/exclude only.
3. **Commit message** — single-line input, mono.
4. **Pull request** — title input + body textarea (`min-height:72px`) prefilled by the plan's template.
5. **Base branch** — `ui-select`, default = repo default.

Footer: `Cancel` (ghost) / `Commit, push & open PR` (`.primary`).

### States

- Loading contents: structure-matched skeleton inside the sheet (DESIGN.md loading rules), buttons disabled.
- Empty diff / nothing publishable: sheet doesn't open; the chip is hidden. If reached directly, one line `Nothing to publish — the working copy is clean.`
- Step in flight: primary button `Publishing…` disabled; per-step status text replaces the button row: `Committing…` → `Pushing…` → `Opening PR…` (12px `var(--muted)`), cancel stays available.
- Step failed: error line in the sheet — `Push failed: <reason>` `var(--danger)` + `Retry` — the sheet does not close; review fields keep edits.

## 3. In-thread PR card (T07)

`.card` at narrative width, `padding:12px 14px`:

- Line 1: success `PR` pill + bold 13px `#<n> · <title>` + muted sub `devin/<slug> → main · open|draft` + right-aligned checks pill: `Checks running · 3/5` (`var(--warning-fg)`/`bg`), `Checks passed` (success), `Checks failed` (danger).
- Line 2 (12px links, `var(--accent-fg)`, `gap:14px`): `View on GitHub` · `Refresh checks` · `Open in Pull requests`.
- Insert: list-insert motion, 180ms; check-status pill crossfades 160ms; no polling spinners (auto-refresh swaps text in place).
- Draft PRs: `open` in the sub-line reads `draft`.

## 4. Recovery (T08)

- Reopened thread with an uncertain step shows the PR card in **uncertain** form: `var(--warning-fg/bg)` pill `Uncertain`, title `Push may not have completed` (or the actual last step), muted sub `The app closed before the push was confirmed. Nothing was retried.`
- Actions: `Check what happened` (ghost, enabled — runs inspect) and `Continue from “<next step>”` (ghost, **disabled** until the predecessor confirms). Confirmed state swaps to the normal card with a 160ms crossfade and one 240ms success pulse.
- Terminal failure keeps the card with `danger` pill `Failed`, plain-sentence error naming the next action, and `Retry`/`Discard` actions.

## 5. Motion summary

- Modal: shared modal entrance; scrim fade only (no scale beyond popover rules).
- Chip/card insert: 180ms insert; status pill changes 160ms crossfade; success pulse 240ms once.
- Reduced motion: opacity ≤80ms; the success pulse becomes a static state change.

## 6. Accessibility

- Sheet: `role="dialog"`, labelled by the title, focus trapped, Esc cancels (with edits kept), `×` `aria-label="Close"`.
- File rows: real checkboxes with `aria-label="Include <path>"`.
- PR card: `role="region"` `aria-label="Pull request"`; check pill is text + color.
- Recovery card announces via `role="status"` when it changes.

## 7. Copy

- Sheet title `Review before publishing`; CTA `Commit, push & open PR`.
- Step text `Committing…`/`Pushing…`/`Opening PR…`.
- Uncertain: `Push may not have completed` / `The app closed before the push was confirmed. Nothing was retried.` / `Check what happened` / `Continue from “Open PR”`.
