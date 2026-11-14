# Multi-monitor detached windows

> Thread detachment into native windows is available again; the main workspace returns to an empty container and stays usable while a thread is detached. Existing child-window recovery and saved placements are retained. Physical mixed-DPI and multi-monitor acceptance remains a separate gate. See the [current preview notes](public/release-notes.md).

Last updated: 2026-10-31.

Detached chat, artifacts, Plan, Usage, navigation, workspace and browser windows remain independent native Electron windows. They share the existing backend and save/lease handoff. Moving a window never creates another task runtime or bypasses a pending edit.

- A new detached window opens centered on its source window's display. Previously used surfaces restore their saved display and bounds.
- Window geometry uses Electron device-independent pixels (DIP), including monitors left of or above the primary display. Physical pixel scale factors are not multiplied into these coordinates.
- Window > Move to Display lists the connected displays. Ctrl+Alt+Right/Left moves the focused window to the next/previous display. The existing native Reset action centers the window on its current display.
- A disconnected display's windows are rescued into the primary work area. Their original placement remains saved, and reconnecting that display restores it. A deliberate move after rescue establishes a new preferred monitor instead.
- Work-area and DPI changes preserve relative placement and clamp the window into the available work area. Existing version-1 saved records without display metadata remain accepted.
- Moving, resizing or recovering a window retains its renderer and editing session; it does not remount an artifact or discard a journal draft. Existing close/dock save checks are unchanged.

The display menu is native and reachable using Alt on Windows; no arbitrary screen geometry or raw Electron APIs are exposed to application or remote-browser pages.

Verification uses focused geometry tests for negative-coordinate displays, mixed scale factors, reconnect, source-display placement and deliberate rescue override, plus the existing native authority, browser isolation and backend checks. A separate [actual-display receipt](evidence/t3-centered-workspace-20261031/physical-displays/run-2026-10-31T11-34-48-103Z/verification.json) records 15 passed checks using the existing v0.3 package on one actual display at 150% scale. It covers native display-menu placement, independent minimization, cold restart, reattachment and owned-process cleanup; it does not verify current source provider changes.

A fresh [v0.4.1 actual-display run](evidence/current-goal-audit-20261031/physical-displays/run-2026-10-31T14-49-49-754Z/verification.json) passed the same 15 checks on the one connected 150% display. The receipt records the actual v0.4.1 executable/archive hashes and two owned startup/shutdown cycles. It does not contain the newer Cursor adapter or verify provider authentication.

A fresh [v0.5.1 actual-display run](evidence/runtime-clarity-20261031/physical-displays/run-2026-10-31T17-43-41-601Z/verification.json) also passes 15 checks on one actual display, with both owned processes and backend ports closed afterward. Its one hardware case remains explicitly unverified. This is separate from live-provider acceptance.

Multiple physical displays, negative-coordinate transitions, mixed-DPI transitions and hotplug remain unverified. Simulated geometry and one physical display do not establish those hardware behaviors. Native bounds can be further adjusted by Windows window-management policies.

Subscription sign-in accepts an optional supported provider ID through the same narrow native bridge. The provider is validated against the application's connection manifest before passing a fixed `--provider` argument to the bundled login helper; arbitrary executable arguments and generic API-key billing are not exposed. Current v0.5.1 source includes nine connection IDs through Pi OAuth, dedicated plan keys or the published official Claude/Gemini/Cursor runtimes. The [provider-expansion milestone](provider-expansion-milestone.md) distinguishes source integration from pending package and live-account acceptance. The delivered v0.3 package retains the earlier four OAuth paths.
