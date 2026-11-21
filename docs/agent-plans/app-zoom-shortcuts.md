# Plan: App zoom with Ctrl+=, Ctrl+− and Ctrl+0

## META
- Feature: Zoom the whole Gen V1 desktop interface in, out and back to 100% from the keyboard, Ctrl+mouse wheel and a new View menu, with the level remembered across restarts and the docked Browser kept aligned.
- Repo: skytuhua-org/Gen-V1
- Plan revision: r1, 2026-11-21 (UTC)
- Baseline: `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da` (verified with `git log -1` on a fresh clone)
- Size: small. Labels: `feature`, `small`.
- Existing issues/PRs: no open or closed `feature` issue covers app zoom (searched "zoom"). Related, not duplicates: [#589 Verify layout resilience at UI zoom and OS text scaling](https://github.com/skytuhua-org/Gen-V1/issues/589) (audits layouts at 110–200% zoom; this plan gives users the control that makes that zoom reachable in the desktop app) and [#1474 Responsive width presets in the docked Browser](https://github.com/skytuhua-org/Gen-V1/issues/1474) (docked Browser page width, not app zoom). The existing "Default browser zoom" setting (`apps/web/src/settings-inventory.ts` row `browser-default-zoom`) scales pages inside the Browser tool, not the Gen UI.
- Implementation status: NOT_STARTED. Plan only; nothing in this plan has been implemented or run.
- Source provenance: repository read at the baseline SHA, Electron 45 API documentation and the user requests listed in REFERENCES. Filed directly at the owner's request ("just post the issue and attach a detailed md file").
- Design and animation owner: there is no separate front-end design pass for this feature. This plan specifies the visual design and animation (DESIGN §5–§6). The last task (T07) sends the finished work to the front-end team for review.

## OBJECTIVE
**User problem.** In the Gen V1 desktop app, people on high-resolution or small screens, and people who need larger text, cannot make the interface bigger or smaller. `apps/desktop/main.ts` replaces Electron's default menu with its own (`installApplicationMenu`, File and Window only). The Window menu has only `role:'zoom'` (window maximize on macOS), and no `zoomIn`, `zoomOut` or `resetZoom` role, so the standard Chromium chords Ctrl+=, Ctrl+− and Ctrl+0 do nothing. `apps/web/src/keyboard-bindings.ts` registers no zoom chord. Competing desktop agents get the same request repeatedly (REFERENCES), including a regression where Ctrl++ stopped working.

**Intended behaviour.** In every Gen desktop window:
- Ctrl+= (also Ctrl++ and Ctrl+numpad +) zooms in one step; Ctrl+− (also Ctrl+numpad −) zooms out one step; Ctrl+0 (also Ctrl+numpad 0) resets to 100%.
- Ctrl+mouse wheel (and touchpad pinch, where Electron reports it) zooms one step per wheel notch.
- A new View menu lists Zoom In, Zoom Out and Actual Size with their shortcuts.
- A small indicator shows the new level (for example "110%") with a Reset button, then fades away.
- The level survives restarts. The docked Browser view stays exactly inside its slot at every level.

**Measurable success.**
- Each shortcut changes the zoom factor of the focused Gen window by exactly one step from the fixed list (R2), verified by reading `webContents.getZoomFactor()` in a desktop test.
- After restart, the saved level is applied before the main window is shown.
- At 50%, 100%, 150% and 200%, the docked Browser native view bounds equal `nativeBrowserBounds(slotCssRect, contentSize, zoomFactor)` within the existing inward-rounding rule, verified by test.
- With no change by the user, every window opens at 100% and behaves exactly as today.

## REQUIREMENTS
### In scope
- R1 Shortcuts: Zoom in = `Ctrl+=`, `Ctrl++` (Shift+=), Ctrl+numpad add; zoom out = `Ctrl+-`, Ctrl+numpad subtract; reset = `Ctrl+0`, Ctrl+numpad 0. On macOS, Cmd replaces Ctrl (same rule as the existing registry: a lone `Ctrl` means either platform modifier). The chords work while focus is anywhere in a Gen window, including the composer, the terminal and the docked Browser view.
- R2 Steps: fixed list `[0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]` (50%–200%, Chromium's own steps inside that range). Zoom in or out moves to the next list value above or below the current factor. A factor not in the list (should not happen; defensive) snaps to the nearest list value in the requested direction. At 200% zoom in does nothing, and at 50% zoom out does nothing; the indicator still shows the level, with the "+" or "−" button disabled (DESIGN §5).
- R3 Ctrl+mouse wheel: one step per wheel event that Electron reports through `webContents` `zoom-changed` (`zoomDirection` `in` or `out`). Default Chromium wheel zoom must not run in addition (Electron does not apply wheel zoom itself when `zoom-changed` is handled; T01 verifies).
- R4 View menu: a new top-level `View` menu between `File` and `Window` with items `Zoom In` (shown accelerator `CmdOrCtrl+=`), `Zoom Out` (`CmdOrCtrl+-`), `Actual Size` (`CmdOrCtrl+0`). Items act on the focused Gen window. The existing Window menu `role:'zoom'` item stays (it is window maximize, unrelated).
- R5 Scope of a zoom change: the level is **app-wide**: one level shared by every Gen surface window (main, navigation, workspace, plan, usage, thread, artifact, agent, plug-in surfaces). See "Agreed decisions" D1 for why this replaces the earlier "per window" idea. Attention popups (`partition:'gen-attention'`, `data:` URL) and the startup window are never zoomed.
- R6 Persistence: the level is saved in the existing desktop state file `desktop-windows.json` (user data folder) as a top-level field `appZoom` (number from the R2 list), next to `windows`, keeping `version:1`. Missing, malformed or out-of-list values load as 1. It is applied to each Gen window before that window is first shown.
- R7 Docked Browser alignment: after every zoom change, the docked Browser `WebContentsView` of each affected window is re-placed immediately with `nativeBrowserBounds(lastCssBounds, contentSize, newZoomFactor)` so it never shows one frame misaligned; the renderer's existing bounds update (`apps/web/src/DesktopBrowser.tsx`, keyed on `devicePixelRatio` and the slot rect) then sends fresh CSS bounds as today. The page inside the Browser keeps its own page zoom (the "Default browser zoom" setting); app zoom does not change it.
- R8 Zoom indicator: shown in the window where the change happened (DESIGN §5), live-region announced, with Reset, zoom −, zoom + buttons; auto-hides after 1600 ms without a further change; pauses while hovered or focused.
- R9 Keyboard reference: three new rows in `KEYBOARD_BINDINGS` (scope `Global`): `app-zoom-in` "Zoom in", `app-zoom-out` "Zoom out", `app-zoom-reset` "Reset zoom", with a hint "Desktop app; in a browser tab your browser's zoom applies". They appear in Settings → Keyboard → All shortcuts automatically.
- R10 Web build (browser tab): no app code intercepts these chords; the browser's own zoom keeps working unchanged. The indicator never appears in the web build.

### Out of scope
- Per-window zoom levels (D1).
- A Settings slider or Appearance row for zoom, and Command menu (#1371) entries. A follow-up can add them using the same IPC from T02.
- Chat width, font size and density settings (already exist and stay independent).
- Zooming pages inside the docked Browser (`browser-default-zoom` stays the only control for that).
- Fixing layouts that break at high zoom: that is #589. This plan only must not make them worse; T06 records findings on #589.
- macOS-specific menu roles beyond R4 (Gen ships for Windows; the chords still map Cmd on macOS through the shared rule).

### Agreed decisions vs proposed options
- D1 App-wide, not per window. Electron documents that zoom is same-origin at the Chromium level: setting the zoom of one `webContents` propagates to every window with the same origin. All Gen surface windows load the same backend origin, and their URLs are locked (`will-navigate` rejects any URL other than the window's own; `trustedDesktopUrl`). Making URLs differ per window to defeat the policy is rejected because it would weaken those navigation checks. T01 verifies the propagation on Electron 45.2.0; if T01 proves per-window zoom works without changing URLs, the plan is still implemented app-wide (simpler, matches what the user sees after propagation) and T01 records the finding on the issue.
- D2 Main-process key handling. Chords are handled in the main process with `webContents.on('before-input-event')` on each Gen window and on each docked Browser view, calling `event.preventDefault()` when a chord matches. Menu items show accelerators with `registerAccelerator:false` so they never fire twice. Reason: the docked Browser is a separate `WebContentsView`, so a renderer `keydown` listener would miss chords pressed while it has focus, and hidden menu items' accelerators are not guaranteed on Windows.
- D3 Keys are matched on `input.key` with `input.code` fallbacks for the numpad (`NumpadAdd`, `NumpadSubtract`, `Numpad0`), on `keyDown` only. Auto-repeat is allowed, so holding Ctrl+= keeps stepping (the Chromium behaviour); each repeat is one step.
- D4 Alt and AltGr: a chord with Alt held (`input.alt`) is not a zoom chord, so AltGr layouts typing characters are never captured.
- D5 Indicator in the renderer, state from main: main broadcasts the level in `DesktopState` (new optional field `appZoom:{factor:number;sequence:number;origin?:string}`), the renderer shows the indicator only when `sequence` changes after the window's first state and `origin` equals its own window id.

### UX, accessibility, errors
- Indicator text: "Zoom 110%" (integer percent, `Math.round(factor*100)`). Buttons: "Zoom out" (icon `Minus`), "Zoom in" (icon `Plus`), "Reset" (text button, hidden at 100%). Icons from `lucide-react` (already used by `ShellNotice`).
- `role="status"` with `aria-live="polite"`; the text node changes on every step so screen readers announce the new level. Buttons have `aria-label` and `aria-keyshortcuts` from `ariaKeyShortcuts([...])`.
- The indicator never takes focus on its own. Keyboard users reach it with Tab only while visible.
- Errors: if saving the state file fails, zoom still applies for the session and the existing `layoutError` path is not used (zoom is cosmetic); log once to the startup diagnostic only in test mode. Invalid IPC input is rejected with `Error('Invalid zoom command')`.
- Performance: one `setZoomFactor` per window per step; no animation of the zoom itself (Chromium re-lays out instantly).
- Security: the new IPC accepts only `{type:'in'|'out'|'reset'}` from a sender that passes the existing `authorize(event)` check.

## REPO_MAP (verified at baseline unless marked DISCOVERY)
- `apps/desktop/main.ts` (393 lines): `installApplicationMenu()` line 108 builds File (Restore chat, Quit `Control+Shift+Q`) and Window (`minimize`, `zoom`, Move to Display, Move to Next/Previous Display `Control+Alt+Right/Left`, Reset window position). Gen windows are created with `new BrowserWindow({... webPreferences:{preload, partition:'persist:harness', sandbox:true, contextIsolation:true, ...}})` (~line 161); docked Browser views with `new WebContentsView({webPreferences:{session:browserSession, sandbox:true, ...}})` (~line 127). Browser command `bounds` (~line 299) calls `browser.view.setBounds(nativeBrowserBounds(command.bounds, record.window.getContentSize(), record.window.webContents.getZoomFactor()))`. `persist()` writes `{version:1, windows:saved.slice(-24)}` to `desktop-windows.json`; `loadSaved()` reads it, rejecting files over 128 KiB or with `version!==1`. `broadcast()` sends `snapshot(record)` (`DesktopState`) to every window. `authorize(event)` resolves the trusted sender's `WindowRecord`. `focusedRecord()` returns the focused window's record. Attention popup window ~line 226 (`partition:'gen-attention'`, `data:` URL); startup window ~line 386.
- `apps/desktop/browser-bounds.ts`: `nativeBrowserBounds(bounds, [width,height], zoom)` converts owner CSS px to native DIP, rounds inward, rejects non-finite or out-of-window input.
- `apps/desktop/preload.ts`: builds the frozen `DesktopBridge` exposed as `window.harnessDesktop`; each method is `ipcRenderer.invoke(channels.<name>, ...)`.
- `packages/desktop-contract/index.ts`: `DesktopState` (line 20), `DesktopBridge` (line ~40–50), `DESKTOP_CHANNELS` (line 51), `DesktopBrowserCommand` (line 23).
- `apps/web/src/DesktopBrowser.tsx` line 14: the renderer measures the slot with `getBoundingClientRect()`, keys on `JSON.stringify([devicePixelRatio, value])`, and sends `desktop.bridge.browser({type:'bounds', bounds})` from `ResizeObserver` and `MutationObserver` callbacks.
- `apps/web/src/DesktopEntry.tsx` (56 lines): `DesktopEntry()` reads `window.harnessDesktop`, loads `getContext()` and subscribes to state. DISCOVERY (T04): confirm it renders for every Gen desktop surface, so the indicator can mount once there; otherwise mount it in `App.tsx` and `WorkspaceHost.tsx`.
- `apps/web/src/desktop-context.tsx`: `useDesktop()` hook used by `DesktopBrowser.tsx`.
- `apps/web/src/ShellNotice.tsx` + `apps/web/src/shell.css` lines 279–283: existing toast (`.shell-notice`, fixed bottom 64px, `var(--surface)`, `var(--border)`, `var(--elevation)`, radius 10px, 12px text, enter `shell-notice-in` `var(--ui-motion-toast-enter)` `var(--ui-ease-enter)`, exit `var(--ui-motion-toast-exit)` `var(--ui-ease-move)`, reduced motion → no animation). Pattern to copy for timers and hover/focus pause.
- `packages/ui-shell/tokens.css`: `--ui-ease-enter: cubic-bezier(.16,1,.3,1)`, `--ui-ease-move: cubic-bezier(.4,0,.2,1)`, `--ui-motion-toast-enter: 200ms`, `--ui-motion-toast-exit: 160ms`.
- `apps/web/src/keyboard-bindings.ts`: `KEYBOARD_BINDINGS` registry (`id`, `label`, `scope`, `chords` or `preference`, `hint`, `handlers` = repository-relative files that compare the chord). `readChord` supports a literal plus (`Ctrl++`).
- `apps/web/src/KeyboardReference.tsx`: renders every registry row by scope.
- `tests/keyboard-bindings.test.ts`: requires each binding to have exactly one chord source, readable `handlers`, a handler predicate where the key comparison (`.key === '<key>'` or `[...].includes(event.key)`) and the chord's modifiers (`ctrlKey`, `metaKey`, `altKey`, `shiftKey`) appear in the same `;`-separated statement, and no undeclared key literals in handler files.
- `tests/native-browser-bounds.test.ts`: unit tests for `nativeBrowserBounds` (zoom 1.25 and 0.8 cases). `tests/e2e/native-browser-bounds.spec.ts` + fixture + config: browser-level bounds test.
- `packages/contracts/preferences.ts`: default rebindable keybindings `Ctrl+K`, `Ctrl+Shift+O`, `Ctrl+B`, `Ctrl+Shift+B`, `Ctrl+Comma`, `Escape`; none conflict with R1. No `apps/web/src` key comparison uses `=`, `-`, `+` or `0` (grep at baseline).
- `package.json`: Electron `45.2.0`; scripts `typecheck`, `test` (vitest), `lint`, `test:browser`, `desktop:build`, `desktop:dev`.
- DISCOVERY (T01): where desktop main-process tests live (search `tests/` for files importing `apps/desktop/`), and whether an Electron-driven test harness exists (`HARNESS_DESKTOP_TEST_DATA_DIR` is read by `main.ts`, so a desktop test mode exists; find its runner in `scripts/` or `tests/`).

## DESIGN
### 1. Pure zoom module `apps/desktop/app-zoom.ts` (new)
```ts
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export type ZoomCommand = 'in' | 'out' | 'reset';
export interface ZoomKey { type: string; key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }
/** Next factor for a command; clamps at the ends, snaps unknown factors in the command's direction. */
export function nextZoom(current: number, command: ZoomCommand): number;
/** Loads a saved value: any value not in ZOOM_STEPS becomes 1. */
export function parseSavedZoom(value: unknown): number;
/** Maps a key event to a zoom command, or null. keyDown only; Alt never matches. */
export function zoomCommandFor(event: ZoomKey): ZoomCommand | null;
```
`zoomCommandFor` is written as one statement per chord so `tests/keyboard-bindings.test.ts` finds each predicate, for example:
```ts
if (event.type !== 'keyDown' || event.altKey) return null;
if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === '=') return 'in';
if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === '+') return 'in';
if ((event.ctrlKey || event.metaKey) && event.code === 'NumpadAdd') return 'in';
if ((event.ctrlKey || event.metaKey) && event.key === '-') return 'out';
if ((event.ctrlKey || event.metaKey) && event.code === 'NumpadSubtract') return 'out';
if ((event.ctrlKey || event.metaKey) && event.key === '0') return 'reset';
if ((event.ctrlKey || event.metaKey) && event.code === 'Numpad0') return 'reset';
return null;
```
T03 adjusts the exact spelling until the registry test passes for chords `Ctrl+=`, `Ctrl++`, `Ctrl+-`, `Ctrl+0`; it must not weaken the test.

### 2. Main process wiring (`apps/desktop/main.ts`)
- State: `let appZoom = 1;` loaded in `loadSaved()` via `parseSavedZoom(raw.appZoom)`; `persist()` writes `{version:1, appZoom, windows:...}`.
- `function setAppZoom(factor:number, origin?:WindowRecord)`: if `factor === appZoom` still broadcast (so the indicator shows the clamped level) but skip `setZoomFactor`; otherwise set `appZoom`, then for every live Gen `WindowRecord`: `record.window.webContents.setZoomFactor(appZoom)` and, if `record.dockedBrowser` has `lastCssBounds`, `record.dockedBrowser.view.setBounds(nativeBrowserBounds(lastCssBounds, record.window.getContentSize(), appZoom))` in a try/catch (a throw hides the view with `{x:0,y:0,width:0,height:0}`, same as the existing invalid-bounds path). Then `persist()` and `broadcast()` with `appZoom:{factor, sequence:++zoomSequence, origin:origin?.id}`.
- `function zoom(command, origin)`: `setAppZoom(command==='reset' ? 1 : nextZoom(appZoom, command), origin)`.
- The `bounds` browser command stores `browser.lastCssBounds = command.bounds` before calling `setBounds` (new optional field on `BrowserRecord`).
- Window creation: after `new BrowserWindow(...)` for Gen surfaces, `native.webContents.setZoomFactor(appZoom)` once the page has loaded (`did-finish-load`), before `show()`; and `native.webContents.on('before-input-event', (event, input) => { const command = zoomCommandFor({type: input.type, key: input.key, code: input.code, ctrlKey: input.control, metaKey: input.meta, altKey: input.alt, shiftKey: input.shift}); if (command) { event.preventDefault(); zoom(command, record); } })`; and `native.webContents.on('zoom-changed', (_event, direction) => zoom(direction, record))`.
- Docked Browser views: the same `before-input-event` handler (origin = owner record). No `zoom-changed` handler on the view (wheel over the page keeps the page's own behaviour; Chromium wheel zoom of the page is already disabled there? T01 checks and records; if the page zooms on Ctrl+wheel today, leave it unchanged).
- Attention popup and startup windows get no handler and no `setZoomFactor`. If T01 shows same-origin propagation reaches the attention popup (it uses a `data:` URL, so it should not), call `setZoomFactor(1)` on it after each change.
- Menu: insert `{label:'View', submenu:[{label:'Zoom In', accelerator:'CmdOrCtrl+=', registerAccelerator:false, click:()=>zoom('in', focusedRecord())}, {label:'Zoom Out', accelerator:'CmdOrCtrl+-', registerAccelerator:false, click:()=>zoom('out', focusedRecord())}, {label:'Actual Size', accelerator:'CmdOrCtrl+0', registerAccelerator:false, click:()=>zoom('reset', focusedRecord())}]}` between File and Window.

### 3. IPC for the indicator buttons
- `DESKTOP_CHANNELS.zoom = 'harness-desktop:zoom'`.
- `DesktopBridge.zoom(command: 'in'|'out'|'reset'): Promise<void>`; preload: `zoom: command => ipcRenderer.invoke(channels.zoom, command)`.
- Main: `ipcMain.handle(channels.zoom, (event, command) => { const record = authorize(event); if (!['in','out','reset'].includes(command)) throw Error('Invalid zoom command'); zoom(command, record); })`.
- `DesktopState.appZoom?: {factor:number; sequence:number; origin?:string}`; `snapshot()` always includes `{factor:appZoom, sequence:zoomSequence}`; the change broadcast adds `origin`.

### 4. Data and control flow
Key press (Gen window or docked Browser) → `before-input-event` → `zoomCommandFor` → `zoom()` → `nextZoom` → `setZoomFactor` on all Gen windows (Chromium also propagates same-origin, which is harmless) → re-place docked Browser views → `persist()` → `broadcast()` → renderer in the origin window shows the indicator → renderer `ResizeObserver` fires because CSS sizes changed → existing `bounds` command → `nativeBrowserBounds` with the new factor (already read live from `getZoomFactor()`).
Restart: `loadSaved()` → `appZoom` → each Gen window gets `setZoomFactor(appZoom)` before first show.
Rollback: deleting `appZoom` from the state file or pressing Ctrl+0 returns to today's behaviour; older builds ignore the extra JSON field.

### 5. Visual design of the zoom indicator (new `apps/web/src/ZoomIndicator.tsx`, styles in `apps/web/src/shell.css`)
- Placement: `position:fixed; top:12px; left:50%; transform:translateX(-50%); z-index:56` (one above `.shell-notice` at 55, so both can show). Top-center avoids the composer and the bottom toast.
- Box: `display:inline-flex; align-items:center; gap:4px; height:32px; padding:0 4px 0 12px; border:1px solid var(--border); background:var(--surface); color:var(--text); box-shadow:var(--elevation); border-radius:999px; font-size:12px; font-variant-numeric:tabular-nums;` (pill).
- Content left to right: label "Zoom" in `var(--muted)` then the percent in `var(--text)` with `font-weight:600` and `min-width:4ch; text-align:right` (no width jump between 90% and 110%); a 1px divider `width:1px; height:16px; background:var(--border); margin:0 4px`; buttons "Zoom out" (Minus, 14px icon), "Zoom in" (Plus, 14px icon), each `width:24px; height:24px; border-radius:999px` using the existing `.icon-button` class; "Reset" text button `height:24px; padding:0 8px; border-radius:999px` using existing quiet button styling, hidden at 100%. Disabled "Zoom in" at 200% and "Zoom out" at 50% use the existing disabled button style.
- Themes: tokens only, so dark, light and high-contrast follow automatically. No new colors.
- Lifetime: appears on a change, stays 1600 ms after the last change; each further change resets the timer and updates the number in place (no re-entry animation). Hover or focus inside pauses the timer (same logic as `ShellNotice`); leaving resumes with at least 400 ms.

### 6. Animation
- Enter: `@keyframes zoom-indicator-in { from { opacity:0; transform:translate(-50%,-6px) scale(.98); } }` over `var(--ui-motion-toast-enter)` (200 ms) with `var(--ui-ease-enter)`.
- Exit: `@keyframes zoom-indicator-out { to { opacity:0; transform:translate(-50%,-6px); } }` over `var(--ui-motion-toast-exit)` (160 ms) with `var(--ui-ease-move)`, then unmount (timer 160 ms, as `ShellNotice`).
- Value change while visible: the percent text gets a 120 ms opacity pulse `@keyframes zoom-indicator-value { from { opacity:.55; } }` with `var(--ui-ease-move)`, restarted by keying the element on `sequence`.
- `@media (prefers-reduced-motion: reduce)` and the app's `data-motion` off setting (whatever selector `motion-policy.ts` applies; T04 reads it): no keyframes at all; the indicator appears and disappears instantly.
- The zoom of the page itself is never animated.

## EXECUTION_DAG
- **T01 Verify Electron zoom behaviour (discovery, no product code).** Deps: none. Steps: with Electron 45.2.0 from the repo, write a throwaway script or desktop test that opens two `BrowserWindow`s on the same `http://127.0.0.1` origin with partition `persist:harness`, calls `setZoomFactor(1.25)` on one and reads both; checks `zoom-changed` fires for Ctrl+wheel and whether Chromium also applies wheel zoom when the event is handled; checks a `data:` URL window is unaffected; checks `before-input-event` fires on a `WebContentsView` with focus and that `preventDefault()` stops the key reaching the page; finds the desktop test runner (REPO_MAP DISCOVERY). Output: an issue comment with each result (PASS/FAIL, Electron version, OS). Done when: comment posted; D1–D2 confirmed or the exact deviation recorded. Owner boundary: no edits to `apps/` or `packages/`. Handoff: T02.
- **T02 Zoom module, contract and IPC.** Deps: T01. Edits: new `apps/desktop/app-zoom.ts` (DESIGN §1); `packages/desktop-contract/index.ts` (`DESKTOP_CHANNELS.zoom`, `DesktopBridge.zoom`, `DesktopState.appZoom`); `apps/desktop/preload.ts` (`zoom`). Tests: new `tests/app-zoom.test.ts`: `nextZoom` for every step both directions, clamping at 0.5 and 2, snapping 1.05→1.1 (in) and 1.05→1 (out), reset; `parseSavedZoom` for 1.25, `'1.25'`, 3, NaN, null, undefined → 1.25, 1, 1, 1, 1, 1; `zoomCommandFor` positives for each R1 chord with ctrl and with meta, negatives: no modifier, Alt+Ctrl+=, `keyUp`, Ctrl+Shift+- , Ctrl+9. Done when: `pnpm typecheck` and `pnpm vitest run tests/app-zoom.test.ts` pass. Handoff: T03, T04.
- **T03 Main-process wiring and menu.** Deps: T02. Edits: `apps/desktop/main.ts` only (DESIGN §2–§3): `appZoom` load/save, `setAppZoom`, `zoom`, `before-input-event` and `zoom-changed` on Gen windows, `before-input-event` on docked Browser views, `lastCssBounds`, View menu, `ipcMain.handle(channels.zoom)`, `snapshot()` field. Edits `apps/web/src/keyboard-bindings.ts`: three rows (R9) with `handlers:['apps/desktop/app-zoom.ts']`, chords `['Ctrl+=','Ctrl++']`, `['Ctrl+-']`, `['Ctrl+0']`. Tests: `pnpm vitest run tests/keyboard-bindings.test.ts tests/native-browser-bounds.test.ts` pass unchanged plus a new case in `tests/native-browser-bounds.test.ts`: the same CSS rect at factors 0.5, 1, 1.5, 2 gives bounds scaled by the factor and rounded inward. If T01 found a desktop test harness, add a desktop test: press Ctrl+= three times → factor 1.25 in both open windows; Ctrl+0 → 1; restart with `appZoom:1.5` in the state file → first shown window reads 1.5; malformed `appZoom:"big"` → 1. Negative: Alt+Ctrl+= changes nothing; the attention popup stays at 1. Done when: those pass and `pnpm desktop:build` succeeds. Handoff: T04, T05.
- **T04 Zoom indicator.** Deps: T02 (contract only; can run in parallel with T03 using a mocked bridge). Edits: new `apps/web/src/ZoomIndicator.tsx`; CSS in `apps/web/src/shell.css` after the `.shell-notice` block (DESIGN §5–§6); mount point per REPO_MAP DISCOVERY in `DesktopEntry.tsx` (or `App.tsx` + `WorkspaceHost.tsx`). Behaviour: reads `appZoom` from desktop state; ignores the first state; shows on a new `sequence` when `origin` is this window's id; buttons call `bridge.zoom(...)`; never renders without `window.harnessDesktop`. Tests: new `tests/zoom-indicator.test.tsx` with `renderToStaticMarkup`/fake timers following the existing test style: hidden on first state; shown with "Zoom 110%" after a new sequence; hidden for another window's origin; Reset hidden at 100%; Zoom in disabled at 200%, Zoom out disabled at 50%; `role="status"`; auto-hide after 1600 ms + 160 ms exit; not rendered without a desktop bridge. Also `pnpm lint` and `pnpm test:ui-guard` pass (UI guard rules on overlays and numeric children apply; if the guard flags the fixed overlay, register it the way the guard's documentation requires, never by disabling the guard). Done when: tests and guards pass. Handoff: T05.
- **T05 Docked Browser alignment check.** Deps: T03, T04. Extend `tests/e2e/native-browser-bounds.spec.ts` (or its fixture) with zoom factors 0.5, 1.5 and 2 if the fixture can drive zoom; otherwise do a manual desktop check (`pnpm desktop:dev`): open the docked Browser on a public page, step through 50%→200% and back, and screenshot at 50/100/150/200% showing the page edges flush with the slot. Done when: test passes or screenshots are attached to the issue with a PASS/FAIL note per level.
- **T06 Real-user regression pass.** Deps: T03, T04. In `pnpm desktop:dev`: shortcuts with focus in composer, terminal, Settings search, docked Browser; numpad keys; Ctrl+wheel; View menu items; restart persistence; second window (detach a thread) follows the level; web build in Chrome: Ctrl+= is the browser's zoom and no indicator appears; dark, light, high-contrast; reduced motion. Record layout breakage seen at 150–200% as a comment on #589 (do not fix here). Done when: a results table (case × PASS/FAIL) is posted on this issue.
- **T07 Front-end team review handoff.** Deps: T05, T06. Open the implementation PR (template in `.github/pull_request_template.md`), attach indicator screenshots (dark, light, high-contrast; 100%→110%, 200% with Zoom in disabled) and a short screen recording of stepping 100→200→50→100 with the docked Browser open; request review from the front-end team on the PR and post a handoff comment on this issue naming what to review (DESIGN §5–§6 fidelity, motion, contrast). Done when: the review request and comment are posted; the issue stays open until the front-end team approves.

Parallel scopes: T03 owns `apps/desktop/main.ts` and `keyboard-bindings.ts`; T04 owns `ZoomIndicator.tsx`, `shell.css` and the mount file; T02 owns the contract, preload and `app-zoom.ts`. No two tasks edit the same file.

## VALIDATION
- Setup: `pnpm install`; Node ≥ 24.10; Windows for real-user checks (the desktop host targets Windows: `node.exe` path in `main.ts`).
- Commands: `pnpm typecheck`; `pnpm vitest run tests/app-zoom.test.ts tests/zoom-indicator.test.tsx tests/keyboard-bindings.test.ts tests/native-browser-bounds.test.ts`; `pnpm lint`; `pnpm test:ui-guard`; `pnpm desktop:build`; `pnpm test:browser` for the bounds spec when extended.
- Acceptance matrix:

| Req | Check | Task |
|---|---|---|
| R1 | `zoomCommandFor` unit cases; T06 focus cases incl. docked Browser and numpad | T02, T06 |
| R2 | `nextZoom` unit cases; clamp at 50/200 | T02 |
| R3 | T01 wheel finding; T06 Ctrl+wheel | T01, T06 |
| R4 | View menu items act on focused window (T06) | T03, T06 |
| R5 | two windows share level; popup stays 1 | T03, T06 |
| R6 | restart with saved/malformed `appZoom` | T03 |
| R7 | bounds unit case + T05 screenshots/spec | T03, T05 |
| R8 | indicator tests; screenshots | T04, T07 |
| R9 | registry test + Settings reference renders three rows | T03 |
| R10 | web build check in T06 | T06 |

- Release gate: all commands pass; T05 and T06 tables posted with no FAIL; front-end review requested (T07).
- Executed so far: none. Every test above is planned, not run.

## STATE
- Researched and decided: everything above (r1). Implemented: nothing. Verified: nothing.
- Owners/branches: none yet. The plan file is proposed in a docs-only PR linked from this issue.
- Risks: (1) Same-origin propagation behaves differently than documented (T01 catches it). (2) The UI guard may flag a new fixed overlay (T04 handles it through the guard's own registration). (3) Layouts already fragile at high zoom (#589) become reachable; mitigated by recording findings on #589, not by limiting the range.
- Exact next step: an implementing agent claims this issue per AGENTS.md and starts T01.

## REFERENCES
- User requests: [openai/codex#23139 UI scale request](https://github.com/openai/codex/issues/23139); [openai/codex#59419 Ctrl++ zoom regression](https://github.com/openai/codex/issues/59419); [anthropics/claude-code#105333](https://github.com/anthropics/claude-code/issues/105333).
- Electron docs: [`webContents.setZoomFactor` / zoom same-origin policy](https://www.electronjs.org/docs/latest/api/web-contents#contentssetzoomfactorfactor); [`before-input-event`](https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event); [`zoom-changed`](https://www.electronjs.org/docs/latest/api/web-contents#event-zoom-changed); [MenuItem `registerAccelerator`](https://www.electronjs.org/docs/latest/api/menu-item).
- Repo at baseline: [`apps/desktop/main.ts`](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/desktop/main.ts), [`apps/desktop/browser-bounds.ts`](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/desktop/browser-bounds.ts), [`apps/web/src/keyboard-bindings.ts`](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/web/src/keyboard-bindings.ts), [`apps/web/src/ShellNotice.tsx`](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/web/src/ShellNotice.tsx), [`tests/keyboard-bindings.test.ts`](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/tests/keyboard-bindings.test.ts).
- Related issues: [#589](https://github.com/skytuhua-org/Gen-V1/issues/589), [#1474](https://github.com/skytuhua-org/Gen-V1/issues/1474), [#1371 Command menu](https://github.com/skytuhua-org/Gen-V1/issues/1371).
