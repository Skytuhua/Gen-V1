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

## What has been verified

The [geometry regression tests](../tests/desktop-display-layout.test.ts) exercise negative coordinates, mixed scale factors, reconnect, source-display placement and deliberate rescue override with simulated displays.

Historical runs of v0.3, v0.4.1 and v0.5.1 reported 15 checks each on one physical display at 150% scaling. See the [acceptance summary](acceptance.md) for release context. Those runs covered native menu placement, independent minimization, cold restart, reattachment and cleanup. Their raw receipts are not included in this checkout. They are not evidence for the current package or for live-provider authentication.

The [physical-display verification script](../scripts/verify-physical-displays.ts) records the package version and executable hash, attached displays, and the scope of each new run. It does not exercise hotplug.

Multiple physical displays, negative-coordinate transitions, mixed-DPI transitions and hotplug remain unverified. Simulated geometry and one physical display do not establish those hardware behaviors. Native bounds can be further adjusted by Windows window-management policies.

Subscription sign-in accepts an optional supported provider ID through the same narrow native bridge. The provider is validated against the application's connection manifest before passing a fixed `--provider` argument to the bundled login helper; arbitrary executable arguments and generic API-key billing are not exposed. Current v0.5.1 source includes nine connection IDs through Pi OAuth, dedicated plan keys or the published official Claude/Gemini/Cursor runtimes. The [provider-expansion milestone](archive/provider-expansion-milestone.md) distinguishes source integration from pending package and live-account acceptance. The delivered v0.3 package retains the earlier four OAuth paths.
