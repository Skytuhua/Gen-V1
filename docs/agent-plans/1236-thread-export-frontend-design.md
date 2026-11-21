# Front-end design plan: Export a thread to Markdown

## META

| Field | Value |
|---|---|
| Feature | Export a thread to Markdown — visual design, copy, states and motion for the UI surface |
| Repo | skytuhua-org/Gen-V1 |
| Issue | https://github.com/skytuhua-org/Gen-V1/issues/1236 |
| Design revision | d1, 2026-11-21 |
| Baseline | `main` @ `1f9466ab3fde0713b42430d0e59e08f744637d52` (verified by fetch on 2026-11-21) |
| Behavior plan | [`docs/agent-plans/thread-markdown-export.md`](./thread-markdown-export.md) r1 (PR #1241) — owns behavior, data, contracts, wiring. This document overrides its "placeholder UI choices in T05", as that plan explicitly provides. |
| Implementation status | NOT_STARTED. Design spec only; nothing is implemented. |
| Provenance | Front-end design team (S's front-end team) per the issue's "Design and animation ownership" note. Every value below was read from source at the baseline SHA; anything not verifiable is marked DISCOVERY. |

**Scope.** This document is the complete, normative front-end spec for the feature. The implementer makes zero design decisions: every layout value, color token, type size, icon, copy string, state and motion parameter is fixed here. It adds **no new components** — the surface is two existing `ActionMenu`s plus the existing `toast` system, so the spec is written as (a) exact menu-item definitions, (b) exact toast definitions, (c) state and motion tables, (d) accessibility contract.

## OBJECTIVE

Let the user save a whole thread as `.md` from the two places the behavior plan names — the sidebar row's **Options** menu and the thread header **History** menu — with feedback that matches the app's existing notification language. Success, cancel and failure are all reported; nothing blocks the composer, and nothing new is invented visually.

**Success (visual/interaction, measurable).**
- The entry appears in both menus, in the position specified below, with the specified icon and label.
- Export outcomes produce exactly the toasts specified (tone, icon, copy, duration, action button).
- No new animation is introduced; the popover and toast animations already defined by ui-shell tokens are the whole motion surface, and `prefers-reduced-motion` degrades them per the existing rules.

## REQUIREMENTS (design, normative)

### Entry point 1 — sidebar thread "Options" menu

`apps/web/src/ShellSidebar.tsx` `renderMenu(item)`, the `ActionMenu` opened by the 23×23 px `MoreHorizontal` trigger (`sidebar-thread-menu-button`).

Add one item. **Position: between `settle` and `archive`** — export sits with the other non-destructive actions and `Archive thread` stays last (destructive-adjacent action last is the existing convention).

| Field | Value |
|---|---|
| `id` | `'export-markdown'` |
| `label` | `Export as Markdown…` (ellipsis character `…`, not three periods) |
| `accessibleLabel` | `Export “${item.title}” as Markdown` |
| `title` (tooltip) | `Save the whole conversation as a .md file — every message, plan and tool entry.` |
| `icon` | `<FileDown size={13} />` from `lucide-react` (matches the menu's 13 px icon size: `Pin`, `Check`, `Archive` all use `size={13}`) |
| `shortcut` | none (no keyboard shortcut in v1, per the behavior plan's out-of-scope) |
| `disabled` | `false` |
| `hidden` | for archived threads only — the row's menu does not list it there (behavior plan: export route rejects archived threads) |

The item exports **the row's thread** (`item`), never the active thread — the behavior plan's R6 already requires this; the menu closes via `ActionMenu.choose` before `onSelect` runs.

### Entry point 2 — thread header "History" menu

`apps/web/src/SessionBranchMenu.tsx` — the `ActionMenu` labelled **History** in the `ChatView` header (`apps/web/src/App.tsx` header actions row, next to `ConversationFind`).

Add one item. **Position: after `import` (`Import ArchiveV1 JSON…`), before the conditional `capture`/`archive` items** — export is grouped with the other "data in/out" actions.

| Field | Value |
|---|---|
| `id` | `'export-markdown'` |
| `label` | `Export as Markdown…` |
| `accessibleLabel` | `Export “${thread.title}” as Markdown` |
| `title` | `Save the whole conversation as a .md file — every message, plan and tool entry.` |
| `icon` | `<FileDown size={14} />` (this menu's icons are `size={14}`: `History`, `GitBranch`, `Import`) |
| `disabled` | `!overview` — the menu itself is already `disabled={!overview}`; the item needs no extra rule. Keep it enabled during an active run (exporting a running thread is supported and its doc is marked "Run in progress"). |

### Menu appearance (fixed, from existing CSS — the implementer adds no styles)

Both menus render `.ui-control-popup` / `.ui-control-option` (`packages/ui-shell/controls.css`), so each item is already exactly:

- Row: `display:flex; align-items:center; gap: var(--ui-space-2)` (8 px); `min-height: var(--ui-row-compact)` (32 px); `padding: 6px var(--ui-control-inset)` (6 px 8 px); `border-radius: 4px`; font inherits the popup's 12–13 px UI font.
- Popup: `padding: var(--ui-panel-inset)` (12 px); `gap: var(--ui-nav-gap)` (4 px); `border-radius: 8px`; `border: 1px solid var(--border)`; `background: var(--surface)`; width 280 px, height `min(420px, items.length * 36 + 26)` (ActionMenu computes this).
- States: hover `background: var(--hover)`; focus-visible `outline: 2px solid var(--ui-focus-ring); outline-offset: -2px`; disabled `opacity: .45`.
- Icon slot: leading, `flex-shrink: 0`, inherits text color. Label in `<span>`, `overflow-wrap: anywhere`.

### Feedback — toasts (final copy, replacing the behavior plan's placeholders)

Use `toast(message, options)` from `packages/ui-shell/Toast.tsx`. No inline banners, no dialogs, no progress bar. Exactly one toast per export attempt.

| Outcome | Tone | Message (exact) | Options |
|---|---|---|---|
| Saved (desktop or web download dispatched) | `success` | `Exported “<thread title>”` | `action: { label: 'Export again', onSelect: rerun the export }`; default `durationMs` (6000) |
| Save-dialog cancel / web owner navigated mid-save | `info` | `Export cancelled` | none |
| Any failure (HTTP error, `EXPORT_TOO_LARGE`, old desktop, receipt mismatch) | `error` | `Export failed: <reason>` | `durationMs: 9000` (errors read longer); no action |

Copy rules: the thread title is interpolated verbatim inside curly quotes `“…”`; truncate the displayed title at 80 chars with `…` if longer (toast `overflow-wrap: anywhere` handles the rest). `<reason>` is the `Error.message` from the client (`messageOf(cause)` pattern, same as the sidebar's settle error). Do not prepend "Error:".

**In-flight indicator.** Export is expected under ~2 s; the menu closes on select, so there is no persistent control to disable. If `exportThreadMarkdown` has not resolved 800 ms after select, fire one `info` toast `Exporting “<title>”…` with no duration override; when the outcome resolves, its toast replaces the pending one (the toast helper already de-duplicates only identical messages, so the implementer must keep the returned toast `id` and call `dismissToast(id)` before posting the outcome). Under 800 ms, only the outcome toast appears — no flash of a spinner.

### Motion (all pre-existing; the implementer writes none)

| Surface | Animation | Duration | Easing |
|---|---|---|---|
| Options/History popup open | `ui-popover-in` (fade + 4 px translate + scale .98→1) | `var(--ui-motion-popup-enter)` = 180 ms | `var(--ui-ease-enter)` = `cubic-bezier(.16,1,.3,1)` |
| Popup close | `ui-popover-out` | `var(--ui-motion-popup-exit)` = 140 ms | `var(--ui-ease-move)` = `cubic-bezier(.4,0,.2,1)` |
| Menu item hover | background transition | `var(--ui-motion-hover)` = 120 ms | inherit (controls.css) |
| Toast enter | `ui-toast-in` (fade + 8 px translateY + scale .98→1) | `var(--ui-motion-toast-enter)` = 200 ms | `var(--ui-ease-enter)` |
| Toast exit | `ui-toast-out` | `var(--ui-motion-toast-exit)` = 160 ms | `var(--ui-ease-move)` |

**Reduced motion.** `prefers-reduced-motion: reduce` and `:root[data-motion="reduced"|"off"]` are already honored by `tokens.css`/`feedback.css`: popovers/toasts swap to `ui-popover-fade`/`ui-feedback-fade` (opacity only, `var(--ui-motion-press)` = 80 ms). The export UI adds no animation outside these elements, so no extra reduced-motion code exists — the spec is "inherits the system policy, zero bespoke motion".

### Desktop save dialog (Electron)

Native `item.setSaveDialogOptions({ defaultPath: <slug>-<YYYY-MM-DD>.md, filters: [{ name: 'Markdown', extensions: ['md'] }] })` — platform-native chrome, no custom styling possible or wanted. Cancel → the `info` toast above. Web fallback: browser's own download UI; the `success` toast is the only in-app confirmation.

### States matrix

| State | Sidebar item | Header item |
|---|---|---|
| Default | visible, enabled | visible, enabled |
| Archived thread | hidden (item not in `items`) | n/a — archived threads don't render the chat header |
| Run in progress | enabled | enabled |
| Menu closed mid-export | n/a (fire-and-forget; toast carries result) | same |
| Multiple exports | allowed; each posts its own outcome toast (max 3 visible, newest wins — `MAX_VISIBLE = 3`) | same |
| Old desktop build without the bridge | n/a — failure toast `Export failed: This desktop version cannot export threads.` | same |

### Accessibility contract

- `role="menuitem"` is automatic (`checked === undefined`); `aria-label` carries the thread title since the visible label alone doesn't name the target.
- Keyboard: `ArrowDown`/`ArrowUp` opens/focuses via `useListNavigation`; `title` feeds the shared tooltip layer (160 ms enter, `var(--ui-tooltip-dwell)` 350 ms dwell).
- Success/cancel toasts use `role="status"`; error uses `role="alert"` (Toast.tsx tone mapping) — screen readers announce them without focus theft.
- Focus returns to the menu trigger after select (`ActionMenu`'s `restoreAfterAction`), unchanged.

## REPO_MAP (verified at baseline)

| Path | Fact used by this design |
|---|---|
| `apps/web/src/ShellSidebar.tsx:205-221` | `renderMenu` item list, icon sizes 12–14, `toast` already imported/used for settle. |
| `apps/web/src/SessionBranchMenu.tsx:130-164` | Header `ActionMenu` item order and `size={14}` icons; `disabled={!overview}` on the menu. |
| `packages/ui-shell/ActionMenu.tsx` | Item shape (`id,label,accessibleLabel,title,shortcut,icon,disabled,checked,onSelect`); popup metrics 280 px × `min(420, n*36+26)`; focus restore. |
| `packages/ui-shell/Toast.tsx` | `toast(msg,{tone,action,durationMs})`, `dismissToast(id)`, `VISIBLE_MS=6000`, `MAX_VISIBLE=3`, tones `info/success/error`, icons `Info/CheckCircle2/AlertCircle` at 15 px. |
| `packages/ui-shell/controls.css` | Option/popup layout, hover/focus/disabled styles. |
| `packages/ui-shell/tokens.css`, `feedback.css` | All motion tokens, popover/toast keyframes, reduced-motion fallbacks. |
| `apps/web/src/sidebar-context.css:425+` | Sidebar trigger button 23×23, hover `var(--hover)`. |

DISCOVERY: confirm `toast`/`dismissToast` are exported from the same barrel `SessionBranchMenu.tsx` and `App.tsx` import them through (grep for the existing import line used by `ShellSidebar`); if `SessionBranchMenu` cannot reach `toast`, the caller in `App.tsx` passes the outcome handler — the item contract above does not change.

## DESIGN

No new components, styles, tokens or animations. The whole front-end diff is:

1. `ShellSidebar.tsx`: append the `export-markdown` item to `renderMenu`'s `items` array at the specified position; `onSelect` calls the behavior plan's `exportThreadMarkdown(item)` and posts the outcome toast; skip the item when the row is archived.
2. `SessionBranchMenu.tsx` (or `App.tsx` header actions): append the same item at the specified position; `onSelect` exports `thread`.
3. Shared helper (in `apps/web/src/thread-export-api.ts` from the behavior plan, or colocated): `runExportWithFeedback(thread)` implementing the 800 ms pending-toast + `dismissToast` + outcome mapping above, so both entry points produce identical feedback.

Insert-order rationale: destructive-adjacent actions last in the sidebar menu; import/export adjacent in the header menu. Icon `FileDown` reads "file out" and is visually distinct from `Import` (arrow in) and `History` (clock) already present.

## VALIDATION

- Visual: open the sidebar Options menu and the header History menu on a fixture thread; item appears at the specified position with `FileDown` icon and `…` label; hover/focus/disabled styles match sibling items.
- Toast: success → `success` toast `Exported “<title>”` with `Export again` action, auto-dismiss 6 s; cancel → `info` `Export cancelled`; forced failure → `error` `Export failed: <reason>` persisting 9 s, `role="alert"`.
- Pending: throttle the route (e.g. Playwright route delay >800 ms) → one `Exporting “<title>”…` toast that is replaced by the outcome toast, never stacked.
- Reduced motion: `page.emulateMedia({ reducedMotion: 'reduce' })` → popover and toast use fade-only animation.
- e2e belongs to the behavior plan's T06 (`tests/e2e/thread-export.spec.ts`); this doc's acceptance is folded into that spec's assertions.
- **None of these have been run; this is a design spec.**

## STATE

- Decided (this document, d1): item definitions, positions, icons, copy, toast contract, pending threshold, motion table, a11y.
- Open: none for front end. Behavior/data decisions remain in `thread-markdown-export.md`.
- Next step: implementer executes T05 of the behavior plan against this spec.

## REFERENCES

- Behavior plan: `docs/agent-plans/thread-markdown-export.md` (r1) — architecture, route, desktop lane, execution DAG.
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1236
- Sources read at baseline: `ShellSidebar.tsx`, `SessionBranchMenu.tsx`, `ActionMenu.tsx`, `Toast.tsx`, `controls.css`, `tokens.css`, `feedback.css`, `sidebar-context.css`.
