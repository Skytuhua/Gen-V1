# Design: “Open in Gen V1” in Windows File Explorer (issue #1286, task T08)

Front-end design spec. Behavior/registry work is plan r1 (`docs/agent-plans/explorer-open-in-gen-v1.md`, pinned `166420a`); this file owns the visuals, states and copy.

Mockup: `docs/agent-plans/assets/design/explorer-open-in-gen-v1.png`

## Settings row (Windows desktop only)

- Placement: **Settings › General**, grouped with other desktop/integration rows.
- Label: `Show “Open in Gen V1” in File Explorer` (14px/600). Helper (13px, `var(--muted)`): `Adds a right-click command on folders in Windows File Explorer that opens the folder as a project here.`
- Control: the existing switch (`.toggle`, 36×20px). No new component.
- Row is not rendered outside the Windows desktop build (no disabled placeholder).

## States

| State | Treatment |
|---|---|
| Off | switch left, `--selection-border` track |
| On | switch right, `var(--accent-solid)` track |
| Applying | switch at `opacity:.55`, disabled; helper swaps to `Applying…`. Resolution reads the registry back; no optimistic flip |
| Write failed | helper replaced by `Couldn’t update File Explorer — Windows refused the registry write.` in `var(--danger)` + inline `Retry` link; switch shows the *actual* read state |
| Read/verify failed | helper: `Can’t tell whether the Explorer entry is registered.` + `Retry` |
| Partial registration detected | treated as off; helper adds `Registration is incomplete — turn it off and on to repair.` |
| Non-Windows / web | row absent |

## Folder-opened feedback

When a folder arrives from Explorer, the app opens (or focuses) the project and posts the standard shell toast (`.shell-notice`): `✓ Opened <folder name> as a project` + `Reveal` action that focuses the project/workspace. Error case: same toast shape, `var(--danger)` icon, `Couldn't open <folder>: <reason>`.

- Toast: DESIGN.md toast tokens — 200ms in / 160ms out, 6s visible, pause on hover/focus.
- If the app was already open, the window focuses with the platform's normal activation — no custom splash.

## Motion

- Toggle thumb: 160ms transform (`var(--ui-ease-move)`); track color 120ms.
- Toast per tokens above. No other animation; the settings row never slides or staggers.
- Reduced motion: instant state change, opacity-only toast.

## Accessibility

- Switch is `role="switch"`/`aria-checked`, labelled by the row title; helper is `aria-describedby`.
- Applying and error text announced via `role="status"`.

## Explorer-side presentation (registry content, for T01 implementers)

- Verb label exactly: `Open in Gen V1`.
- Icon: the packaged app icon (`app.ico` equivalent); no menu icon file is invented for v1.
