# Plan: Start Gen at Windows sign-in

## META
- Feature: a Settings switch that starts Gen V1 when the user signs in to Windows, with an optional "Start hidden in tray" sub-option, so background tasks, the attention inbox and paired devices are ready without opening a window.
- Repo: skytuhua-org/Gen-V1
- Plan revision: r1, 2026-11-21 (UTC)
- Baseline: `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da` (verified with `git log -1` on a fresh clone)
- Size label: `feature` + `small`
- Existing issues/PRs: none match (searched issue titles for "login", "sign-in", "startup"; only #1081, an unrelated terminal-startup audit). Not in batches 1–7 of the feature proposals and not in the M01–M17 matrix in `docs/progress.md`.
- Implementation status: NOT_STARTED. Filed as a plan only; implementation needs a worker to claim this issue under AGENTS.md.
- Source provenance: reading the repository at the baseline SHA, plus the external sources in REFERENCES (Claude Code requests and bug, Electron API docs).
- **Design owner:** there is no separate front-end design team for this work, so this plan defines the visual design and animation itself (DESIGN → Visual design and motion). The last task (T07) sends the finished work to the front-end team for review.

## OBJECTIVE
**User problem.** Gen already keeps work running from the tray ("Gen V1 — tasks keep running when windows are hidden", `apps/desktop/main.ts` `installTray`), but after a reboot or sign-out nothing runs until the user remembers to open Gen. Scheduled or long-running tasks, attention popups and paired devices are then unavailable. Users of similar tools ask for launch-at-login (Claude Code #111379) and complain when the switch does not reflect the real OS state (Claude Code #81364).

**Intended behaviour.**
1. Settings → General gets a **Start at sign-in** row (Windows desktop only). Off by default.
2. When on, Windows starts Gen V1 at sign-in. A sub-option **Start hidden in tray** (default on once the parent is on) makes that launch open no window: the backend starts, the tray icon appears, and the main window is created hidden.
3. The switch always shows the real Windows state, read from the OS on every Settings open, including the case where the user turned Gen off in Windows Settings → Apps → Startup or Task Manager → Startup apps.
4. A manual launch (Start menu, desktop shortcut, second instance) always shows the window, even when hidden-start is on.

**Measurable success.**
- With the switch on, signing out and in (or rebooting) starts Gen; with hidden-start on, no window is visible and the tray icon is present within the normal startup time; double-clicking the tray shows the workspace.
- With the switch off, no `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value for Gen exists.
- Disabling Gen in Windows Startup apps makes the Settings row show "Turned off in Windows" within one Settings open.
- Uninstalling Gen leaves no Run value behind.

## REQUIREMENTS
### In scope
- R1. Settings row "Start at sign-in" in the General section, switch control, Windows packaged desktop only.
- R2. Sub-row "Start hidden in tray", indented under R1, enabled only when R1 is on.
- R3. Main-process IPC to read and write the login item using Electron `app.getLoginItemSettings` / `app.setLoginItemSettings` (Electron 45.2.0, `package.json`).
- R4. Login launches pass an argument (`--gen-launched-at-login`). Hidden-start applies only when that argument is present, hidden-start is on, and the tray installed successfully.
- R5. The Settings row reflects the real OS state on load and on window focus; it never shows a stored preference that differs from Windows.
- R6. Windows "Startup apps" disablement is surfaced with a link that opens `ms-settings:startupapps`.
- R7. Uninstall removes the Run value (NSIS uninstaller).
- R8. Searchable in Settings search (inventory row with terms) and hidden in the browser build (`PLATFORM_OVERRIDES` = `'desktop'`).

### Out of scope
- macOS/Linux login items (Gen is a Windows x64 beta, `CONTRIBUTING.md`).
- A Windows service, scheduled-task launcher or starting before sign-in.
- Starting specific threads/tasks at login; Gen restores its saved layout exactly as on a normal launch.
- A first-run prompt suggesting the feature.
- Per-machine installs (the installer is per-user: `scripts/desktop-assets.ts` `nsis:{oneClick:true,perMachine:false}`).

### Decisions (agreed for this plan) vs options
- Decided: off by default; Electron API rather than writing the registry directly; registry value name `Gen V1`; OS state is the source of truth, only "hidden-start" is stored by Gen.
- Decided: hidden-start stored in the desktop state the main process already persists (DISCOVERY: `apps/desktop/persistence.ts` / the `stateFile` used by `loadSaved` in `main.ts`), not in web `UiPreferences`, because the main process must read it before any window exists. If discovery finds a better existing main-process settings file, use it and record the choice in a checkpoint.
- Decided: in dev / unpackaged runs (`!app.isPackaged`) and test-data runs (`testData` in `main.ts`), the control is shown disabled with the note "Available in the installed app." so a dev build never registers `electron.exe` at login.
- Option (not chosen): showing the startup splash hidden. Hidden-start skips the 1200 ms "Opening Gen V1" splash entirely.

### UX, accessibility, errors
- Copy (exact):
  - Row title: "Start at sign-in". Description: "Open Gen V1 when you sign in to Windows so tasks and paired devices are ready."
  - Sub-row title: "Start hidden in tray". Description: "Keep windows closed at sign-in. Open Gen from the tray icon."
  - OS-disabled state note: "Turned off in Windows Startup apps." + link button "Open Startup apps".
  - Unavailable note: "Available in the installed app." / browser build: row not rendered.
  - Error toast (write failed): "Couldn't change the sign-in setting. Windows didn't accept the change." The switch reverts to the re-read OS state.
- Both controls use the existing `role="switch"` `settings-switch` button pattern (`AppearanceSettings.tsx` line 75, `IntegrationSettings.tsx`) with `aria-label` equal to the row title and `aria-checked`; the sub-row has `aria-disabled` / `disabled` when the parent is off and is described by the parent row (`aria-describedby`).
- Keyboard: Tab order parent → sub-row → link; Space/Enter toggle (native button).
- While a write is in flight the switch is `disabled` and `aria-busy="true"`; no optimistic flip.
- Recovery: any IPC failure → re-read state, show toast, leave controls usable.

## REPO_MAP (verified at baseline unless marked DISCOVERY)
| Path | What is there | Use |
|---|---|---|
| `apps/desktop/main.ts` | Electron main. Imports `app,…,Tray,…,shell` from `electron` (line 1). `installTray()` (~line 207) creates the tray, context menu "Restore Workspace / Stop running tasks / Quit Gen V1". `mainWindow()` (~line 201) shows/creates the main window. `openSurface()` (~line 152) creates records with `visible: previous?.visible!==false` (~line 165). `registerIpc()` uses `handle(channels.X, …)` (lines ~238–279). Startup in `app.whenReady()` (~line 380): `loadSaved` → `registerIpc` → `installApplicationMenu(); installTray();` → 1200 ms splash timer → `startBackend` → `mainWindow()`. `requestSingleInstanceLock` + `second-instance` → `mainWindow()` (line 376–377). No `setLoginItemSettings` anywhere. | Login item IPC, hidden-start path |
| `apps/desktop/preload.ts` | Builds `DesktopBridge` from `DESKTOP_CHANNELS` and exposes `harnessDesktop`. | Add bridge methods |
| `packages/desktop-contract/index.ts` | `DesktopBridge` interface (line 25), `DESKTOP_CHANNELS` (line 51), strict parsers (`strictRecord`). | New channel names, types, parser |
| `apps/desktop/persistence.ts` | Desktop persistence helpers (DISCOVERY: exact shape of saved desktop state). | Store `startHiddenAtLogin` |
| `apps/web/src/Settings.tsx` | `SETTINGS_SECTIONS` (line 32), `useDesktop()` (line 100), per-row rendering by `matches('<id>')` with `data-setting-id`. | Render the new rows |
| `apps/web/src/settings-inventory.ts` | Rows `[id, title, section, terms]`, e.g. `quit-confirmation` in `general` (line 73). | Add `start-at-sign-in` row |
| `apps/web/src/settings-registry.ts` | `PLATFORM_OVERRIDES` (line 19, empty). | Mark row `'desktop'` |
| `apps/web/src/AppearanceSettings.tsx` | `settings-switch` switch markup and `AppearanceRow` layout. | Visual pattern to copy |
| `apps/web/src/desktop-context.tsx` | `useDesktop()` returns the bridge or null. | Gate rendering |
| `scripts/desktop-assets.ts` | electron-builder config: `appId:'local.generativeharness.desktop'`, `productName:'Gen V1'`, `win.target: nsis x64`, `nsis:{oneClick:true, perMachine:false, …}` (lines 119–126). | Uninstall cleanup (DISCOVERY: whether an `include` NSIS script is supported in this config) |
| `apps/desktop/updater.ts` | Auto-update install after close. | DISCOVERY: confirm the install path (`process.execPath`) is unchanged across updates so the Run value stays valid |
| `tests/desktop-*.test.ts`, `tests/settings-registry.test.ts`, `tests/settings-supported.test.ts`, `tests/e2e/settings-controls.spec.ts` | Existing desktop and settings tests (vitest + Playwright). | Extend |

## DESIGN
### Data and control flow
```
Settings row ──bridge.loginItem.get()──▶ main: app.getLoginItemSettings({path: process.execPath, args:[LOGIN_ARG]})
             ◀── {available, openAtLogin, enabledByWindows, startHidden}
Settings row ──bridge.loginItem.set({openAtLogin, startHidden})──▶ main:
      app.setLoginItemSettings({openAtLogin, path: process.execPath, args:[LOGIN_ARG], name:'Gen V1', enabled:true})
      persist startHidden; re-read; return the same shape as get()
```
- Contract (in `packages/desktop-contract/index.ts`):
```ts
export interface DesktopLoginItemState {
  available: boolean;            // false when !app.isPackaged, testData, or platform !== 'win32'
  openAtLogin: boolean;          // a Run value for Gen exists with our args
  enabledByWindows: boolean;     // false when disabled in Windows Startup apps (StartupApproved)
  startHidden: boolean;          // Gen's stored sub-option
}
export interface DesktopLoginItemChange { openAtLogin: boolean; startHidden: boolean }
// DesktopBridge additions (optional, like other desktop-only methods):
loginItem?(): Promise<DesktopLoginItemState>;
setLoginItem?(change: DesktopLoginItemChange): Promise<DesktopLoginItemState>;
openStartupApps?(): Promise<void>;
// DESKTOP_CHANNELS additions:
loginItem: 'harness-desktop:login-item', setLoginItem: 'harness-desktop:set-login-item', openStartupApps: 'harness-desktop:open-startup-apps'
```
- `parseDesktopLoginItemChange(value)` uses `strictRecord(value, ['openAtLogin','startHidden'])` and requires both booleans; anything else throws `Invalid sign-in setting`.
- `enabledByWindows`: Electron returns `launchItems[]` with `enabled` and `executableWillLaunchAtLogin` on Windows. Use the launch item whose `name` is `Gen V1`; `enabledByWindows = item?.enabled ?? true`. DISCOVERY in T01: confirm on Windows that toggling in Startup apps flips `enabled`.
- `LOGIN_ARG = '--gen-launched-at-login'`; main reads `process.argv.includes(LOGIN_ARG)` once at startup.
- `setStartHidden` only matters when `openAtLogin` is true; turning the parent off keeps the stored sub-option so turning it back on restores it.

### Hidden start
- `const hiddenLaunch = process.argv.includes(LOGIN_ARG) && saved.startHiddenAtLogin === true && tray !== undefined` evaluated after `installTray()`.
- If `hiddenLaunch`: do not start the 1200 ms splash timer; create the main window with `visible=false` (the record's `visible` flag and `window.hide()` / no `show()` in the `channels.ready` handler, which already shows only when `record.visible`). Other saved windows restore with `visible=false` too. Do not `persist()` these forced-hidden visibilities into the layout (so the next manual launch restores the user's real layout). DISCOVERY: the exact place to pass the override into `openSurface` without changing its public behaviour.
- `second-instance`, tray double-click and "Restore Workspace" already call `mainWindow()`, which sets `visible=true` and shows, so the user can always reach the window.
- If the tray failed to install (`tray` undefined), start visibly (never leave Gen running with no UI).
- `startupDiagnostic('hidden-start')` marker for the existing diagnostics.

### Security and boundaries
- Only the `main` surface may call the three channels; plugin surfaces are rejected (mirror the `_caller.surface.kind==='plugin'` checks in `channels.control`).
- `openStartupApps` calls `shell.openExternal('ms-settings:startupapps')` with that literal only; no URL comes from the renderer.
- Path registered is always `process.execPath`; the renderer never supplies a path or args.

### Uninstall and rollback
- NSIS uninstall: delete `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value `Gen V1` (and the matching `StartupApproved\Run` value). DISCOVERY in T05: add via electron-builder `nsis.include` with a `customUnInstall` macro if the build in `scripts/desktop-assets.ts` allows it; if not, record the gap as a checkpoint and add a first-run cleanup of stale values pointing at a missing exe instead.
- Rollback: removing the feature leaves existing Run values; the release that removes it must call `setLoginItemSettings({openAtLogin:false, …})` once on start.

### Visual design and motion
- Layout: same `settings-row` card as other General rows; title 14 px semibold, description in the muted row text, switch right-aligned (existing `settings-row-control`).
- Sub-row: indented 24 px from the row's left text edge with a 1 px left guide line in the existing border token; no new colours. Disabled sub-row uses the existing disabled opacity of `settings-switch`.
- OS-disabled state: a one-line inline note under the description using the existing warning text token with an `AlertTriangle` (lucide, 14 px) icon, followed by a text-style link button "Open Startup apps".
- Motion: the sub-row expands/collapses when the parent toggles: height + opacity 0→1 over 160 ms `ease-out` (collapse 120 ms `ease-in`); the switch knob uses its existing transition. Under `prefers-reduced-motion: reduce`, no height animation, opacity change only, 0 ms. No motion on initial render.
- Light, dark and high-contrast themes use only existing tokens; verify all three in screenshots.

## EXECUTION_DAG
| ID | Goal | Depends | Files | Done when |
|---|---|---|---|---|
| T01 | Discovery: confirm open DISCOVERY items (persistence shape, `openSurface` hidden override point, `launchItems.enabled` behaviour, updater path stability, NSIS include support) | — | read-only | Checkpoint comment lists each answer with file:line |
| T02 | Contract: types, channels, parser | T01 | `packages/desktop-contract/index.ts` | Parser unit tests pass |
| T03 | Main process: get/set/open IPC + persisted `startHiddenAtLogin` | T02 | `apps/desktop/main.ts`, `apps/desktop/persistence.ts`, `apps/desktop/preload.ts` | IPC tests pass |
| T04 | Hidden-start launch path | T03 | `apps/desktop/main.ts` | Hidden-start tests pass |
| T05 | Uninstall cleanup | T01 | `scripts/desktop-assets.ts` (+ NSIS include file if supported) | Packaging test asserts cleanup |
| T06 | Settings UI rows, inventory, platform override, motion | T02 | `apps/web/src/Settings.tsx`, new `apps/web/src/StartupSettings.tsx`, `settings-inventory.ts`, `settings-registry.ts`, CSS next to existing settings styles | UI tests + screenshots |
| T07 | Verification on installed build and hand-off to the front-end team | T03–T06 | docs only | Evidence on issue; front-end review requested |

T05 and T06 can run in parallel with T03/T04 (no shared files). T04 and T03 share `main.ts`: same worker, sequential.

### T01 — Discovery
- Steps: read `apps/desktop/persistence.ts`, `loadSaved`/`persist` in `main.ts`, `openSurface` and the `channels.ready` handler, `apps/desktop/updater.ts`, `scripts/desktop-assets.ts`; read electron-builder 26.18.0 docs for `nsis.include`; on a Windows machine with an installed build, call `app.getLoginItemSettings` before/after disabling in Startup apps (or record NOT_RUN if no Windows box).
- Output: checkpoint with answers; if an answer changes the design, update this plan (new revision) before T02.
- Negative check: confirm no other code path writes the Run key (`grep -rn "CurrentVersion\\\\Run\|setLoginItemSettings" apps packages scripts` returns nothing).

### T02 — Contract
- Add `DesktopLoginItemState`, `DesktopLoginItemChange`, three channel names, three optional bridge methods, and `parseDesktopLoginItemChange` exactly as in DESIGN.
- Tests (`tests/desktop-login-item-contract.test.ts`, new): accepts `{openAtLogin:true,startHidden:false}`; rejects extra keys, non-booleans, arrays, null, prototype-polluted objects.

### T03 — Main-process IPC
- `handle(channels.loginItem, caller => …)`, `handle(channels.setLoginItem, (caller, value) => …)`, `handle(channels.openStartupApps, …)`; reject non-`main` callers.
- `available = process.platform==='win32' && app.isPackaged && !testData`; when unavailable, `get` returns `{available:false, openAtLogin:false, enabledByWindows:true, startHidden}` and `set` throws `Start at sign-in is unavailable in this build.`
- `set`: call `app.setLoginItemSettings({openAtLogin, path:process.execPath, args:[LOGIN_ARG], name:'Gen V1'})`, persist `startHidden`, then return a fresh `get`. If the fresh read disagrees with the request, throw so the UI shows the error toast.
- Preload: wire the three methods.
- Tests: extend the desktop host/IPC tests (`tests/desktop-host-controls.test.ts` style) with an Electron `app` stub: get maps launch items correctly; set passes the exact args; plugin caller rejected; unavailable path; mismatch after write throws.

### T04 — Hidden start
- Implement DESIGN → Hidden start. Keep the forced-hidden state out of the persisted layout.
- Tests: with argv containing `LOGIN_ARG` and stored `startHiddenAtLogin:true`, no splash timer, main window never shown, tray created; without the arg, or with the flag false, or with no tray → normal visible start; `second-instance` after a hidden start shows the window; persisted layout after a hidden start keeps the previous `visible` values.

### T05 — Uninstall cleanup
- If supported, add an NSIS include with `!macro customUnInstall` deleting the `Gen V1` value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` and `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`; reference it from the `nsis` block in `scripts/desktop-assets.ts`.
- Tests: extend `tests/desktop-packaging.test.ts` to assert the include path is set and the file contains both deletes.
- If unsupported: record in checkpoint, implement the fallback from DESIGN, and test it.

### T06 — Settings UI
- Inventory row: `["start-at-sign-in", "Start at sign-in", "general", "launch login boot startup windows tray hidden background autostart"]`; `PLATFORM_OVERRIDES['start-at-sign-in']='desktop'`.
- New `StartupSettings.tsx` rendering both rows with the copy, states, accessibility and motion in REQUIREMENTS/DESIGN; refresh state on mount and on `window` `focus`.
- Render from `Settings.tsx` under `matches('start-at-sign-in')` with `data-setting-id="start-at-sign-in"`, only when `desktop?.loginItem` exists.
- Tests: component tests (off, on, on+hidden, OS-disabled, unavailable, write error reverts, busy state, keyboard toggle, sub-row disabled when parent off); `settings-registry`/`settings-supported` tests include the row and hide it in browser search; `pnpm lint` and `pnpm test:ui-guard` clean; extend `tests/e2e/settings-controls.spec.ts` stray-scalar check if it enumerates General rows.

### T07 — Verify and hand off
- On an installed Windows build: run the acceptance matrix below; capture screenshots of the four row states in light, dark and high contrast, and a short recording of the sub-row animation and reduced-motion behaviour.
- Post evidence on this issue in a checkpoint.
- **Send the finished work (PR link, screenshots, recording) to the front-end team for review** of the visual design and animation; address their feedback before marking DONE.

## VALIDATION
- Setup: `pnpm install`; unit `pnpm test:no-lease` (or `pnpm test` on Windows); `pnpm typecheck`; `pnpm lint`; `pnpm test:ui-guard`; browser `pnpm test:e2e`; installed build `pnpm desktop:package` on Windows x64.
- Acceptance matrix:

| # | Check | Req | Task |
|---|---|---|---|
| A1 | Row visible in General on installed desktop, absent in browser build and browser search | R1, R8 | T06 |
| A2 | Turning on creates the Run value with `--gen-launched-at-login`; off removes it | R3 | T03 |
| A3 | Reboot with hidden off → window visible; with hidden on → no window, tray present, backend reachable | R2, R4 | T04, T07 |
| A4 | Manual launch / second instance while hidden-start is on shows the window | R4 | T04 |
| A5 | Disable in Windows Startup apps → row shows "Turned off in Windows Startup apps."; link opens Startup apps | R5, R6 | T03, T06 |
| A6 | Write failure → toast, switch shows real state | R5 | T03, T06 |
| A7 | Uninstall leaves no Run/StartupApproved value | R7 | T05 |
| A8 | Keyboard and screen-reader labels correct; reduced motion honoured | UX | T06 |
| A9 | Dev / unpackaged build never registers a login item | Decision | T03 |
| A10 | Front-end team review requested with evidence | Design | T07 |

- Executed so far: none (plan only). Every check above is PLANNED.
- Release gate: A1–A9 PASS on an installed build, CI green, front-end review requested (A10).

## STATE
- Researched/decided: everything above. Implemented: nothing. Verified: nothing.
- Owners/branches: none. This issue's plan file lands through a docs-only PR.
- Risks: `launchItems[].enabled` behaviour must be confirmed on real Windows (T01); NSIS uninstall hook support (T05); updates must keep `process.execPath` stable (T01); hidden start must not hide the only UI when the tray is missing (handled in T04).
- Next step: a worker claims this issue and runs T01.

## REFERENCES
- Claude Code launch-at-login request: https://github.com/anthropics/claude-code/issues/111379
- Claude Code bug, switch not reflecting real state: https://github.com/anthropics/claude-code/issues/81364
- Electron `app.setLoginItemSettings` / `getLoginItemSettings` (Windows `path`, `args`, `name`, `enabled`, `launchItems`): https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows
- Baseline code: https://github.com/skytuhua-org/Gen-V1/tree/8fa907f378127bcfc23d71b55c53625ffc43e8da (`apps/desktop/main.ts`, `packages/desktop-contract/index.ts`, `apps/web/src/Settings.tsx`, `scripts/desktop-assets.ts`)
- Repository rules: `AGENTS.md` (plan publication and checkpoint contract), `CONTRIBUTING.md`.
