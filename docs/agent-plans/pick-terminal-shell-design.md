# Design: Pick the terminal shell (issue #1284, front-end handoff of T07)

Front-end design spec for the visual pass the plan reserves for this team. Behavior/detection stays per plan r1 (`docs/agent-plans/pick-terminal-shell.md`, pinned `dec7e66`).

Mockup: `docs/agent-plans/assets/design/pick-terminal-shell.png`

## Placement and layout

- One `settings-row` in **Settings › Projects & Working Copies**, directly under the "Working copy" row. Title `Default terminal shell` (14px/600), helper `New terminals in this project start with this shell.` (13px, `var(--muted)`).
- Control: the shared `ui-select` (Select primitive), trigger `width:200px`, 13px text, showing the effective shell name + `▾`. No new component.
- Hidden entirely off Windows desktop; on Linux/macOS the row does not render (no disabled stub).

## Menu

Shared popover rules (DESIGN.md): opaque `var(--surface)`, 12px radius, 5px inset, 38px rows, opens 8px from the trigger.

Each row: shell display name (13px `var(--text)`) + right-aligned meta (11px `var(--muted)`) with the resolved executable or `wsl.exe -d <distro>`.

- Selected row: `background:var(--selection-bg)`; hover: `var(--hover)`; keyboard focus: `var(--selection-bg)` + focus ring.
- Not-installed shells are listed but `color:var(--muted)`, `aria-disabled`, meta reads `not installed`.
- Exactly one row is the detected default: meta `· default` (Command Prompt when nothing else is set).
- WSL rows display as `WSL · <Distro>` (e.g. `WSL · Ubuntu-24.04`) — name first, never the raw command as the label.
- Empty catalog (should not happen; cmd.exe always exists): single muted row `No shells found — Command Prompt will be used.`

## States

| State | Treatment |
|---|---|
| Catalog loading | trigger shows `Detecting…`, disabled; menu does not open |
| Catalog failed | helper line under the row: `Couldn't detect shells — <reason>.` + inline `Retry` link (`var(--accent-fg)`); select falls back to `Command Prompt (default)` only |
| Saved shell missing | warning pill `var(--warning-fg)`/`var(--warning-bg)`: `<shell> not found`; helper continues: `It may have been moved or uninstalled. Pick another shell — new terminals fall back to Command Prompt until then.` The select still opens; the missing entry is not offered |
| Saving | trigger disabled, label unchanged; no spinner — saves are sub-second |
| Save failed | error line `Couldn't save the shell choice — <reason>.` + `Retry`; effective selection visibly reverts |
| Narrow settings | per `.settings-row` mobile rule: label stacks above a full-width select |

## Motion

- Popover: standard `180ms` in / `140ms` out, `.95` scale from trigger origin, `var(--ui-ease-enter)` (DESIGN.md dropdown/popover tokens).
- Hover/press: 120ms color, 80ms `.97` press scale.
- Reduced motion: opacity ≤80ms, no scale.

## Accessibility

- `ui-select` semantics: `aria-expanded`, `aria-selected` on the current shell, `aria-disabled` on unavailable ones; typeahead by shell name; Escape closes and restores focus.
- Warning/error text is announced (`role="status"` for missing-shell, `role="alert"` for write failures).

## Copy

- Row: `Default terminal shell` / `New terminals in this project start with this shell.`
- Scope note (helper, second sentence): `Existing terminals keep their shell.`
