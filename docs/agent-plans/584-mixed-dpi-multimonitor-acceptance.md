# 584 — Desktop acceptance across mixed-DPI and multi-monitor setups

## META

- Feature: physical mixed-DPI / multi-monitor acceptance run for the Electron desktop surfaces.
- Repo: `skytuhua-org/Gen-V1`.
- Plan revision: `584-r1`, 2026-11-21.
- Baseline branch/SHA: `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`.
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/584
- Current status: geometry and persistence are unit-tested (`tests/desktop-display-layout.test.ts`); `scripts/verify-physical-displays.ts` runs the packaged app on real displays but records `unverified` for multi-display, negative-coordinate, mixed-DPI transitions and hotplug. No physical hardware matrix has been run and recorded per surface.
- Source provenance: issue body; `docs/native-multi-monitor.md`; `README.md` preview boundary ("physical mixed-DPI/multi-monitor acceptance remains open"); `docs/public/release-notes.md`; verified source at `apps/desktop/*`, `packages/desktop-contract`, `scripts/verify-physical-displays.ts`.

## OBJECTIVE

Close the open preview boundary: run the packaged desktop app on a documented physical hardware matrix and record, per surface, whether window/panel positioning, popup placement and rendering are correct at differing scale factors across monitors. Measurable success: a committed evidence run (verification.json + report.md + screenshots) in which every hardware matrix row reachable on the runner reports `passed`, and every row not reachable reports `unverified` with the reason — never `passed` by inference. No application code changes; the plan ships only a verification-matrix extension of the existing script and its evidence.

## REQUIREMENTS

### In scope

- Physical runs of the packaged executable (verification only, exclusive profile, actual `screen` inventory — the existing `scripts/verify-physical-displays.ts` contract).
- A hardware matrix covering: ≥2 displays, ≥1 row with negative DIP coordinates (monitor left of or above primary), ≥1 row with differing `scaleFactor` (e.g. 1.0 + 1.5, or 1.0 + 2.0), and a hotplug row (disconnect → rescue → reconnect → restore) performed by physically unplugging/re-plugging or OS display disconnect — never by editing the app's saved state.
- All detachable surfaces exercised per row: `main`, `navigation`, `workspace`, `thread`, `plan`, `usage`, `artifact`, `agent`, `plugin`, `browser` (subject to what the fixture host can open), plus the attention popup.
- Recorded, per-surface results: display menu move, Ctrl+Alt+Right/Left shortcut move, cold-restart restore, rescue/reconnect restore, reattach, independent minimize, DIP bounds-inside-work-area assertion, and a screenshot per surface per display scale factor.
- Attention popup placement on the display matching the main window, at each scale factor present in the matrix.
- Evidence receipt naming package version, executable + app.asar SHA-256, the display inventory, and `hardwareCoverage` flags for every row.

### Out of scope

- Fixing placement bugs found by the matrix (file follow-up issues; this plan is acceptance evidence only).
- OS display setting changes other than connect/disconnect; emulated geometry; provider authentication/inference acceptance; install/upgrade acceptance; the generation-quality pilot.
- Changing the popup, menu or window design — the spec below describes the *expected* design the run verifies, not a redesign.

### User flows under test

1. Operator launches the packaged app on each matrix row; detaches surfaces; moves each to every display via the Window > Move to Display menu and Ctrl+Alt+Right/Left; verifies each lands inside the target work area in DIP coordinates.
2. Cold restart with surfaces on non-primary displays restores each to its chosen monitor.
3. Disconnect a monitor holding windows → all its windows rescue into the primary work area; reconnect → original placement restores; a deliberate move after rescue establishes a new preferred monitor.
4. With the main window on a scaled display, an attention event shows the popup bottom-right of that display's work area at correct DIP size.

### Design spec the run verifies (current intended design — do not change)

The implementer of this plan decides nothing about the app; these are the exact expectations each check asserts.

**Window sizes (DIP, `surfaceSize` in `apps/desktop/window-policy.ts`):**

| Surface kind | Default size (w × h DIP) | Min |
| --- | --- | --- |
| `main`, `thread` | 1440 × 960 | 320 × 160 |
| `browser` | 1160 × 860 | 320 × 160 |
| `plan`, `usage`, `navigation`, `agent`, `plugin` | 430 × 720 | 320 × 160 |
| `workspace`, `artifact`, other | 1000 × 800 | 320 × 160 |

**Placement semantics (DIP only, never physical pixels; `display-layout.ts`):** new detached windows open centered on the source window's display (`placeOnDesktopDisplay` = clamp into that work area); saved placements restore to their `displayId` with proportional position mapping when the work area changed (`restoreDesktopPlacement`); a disconnected display's windows rescue into the primary work area while the placement record is retained (`retainDesktopPlacement`); platform frame/DPI drift is filtered (`createNormalBounds.observe` only accepts `{manual:true, normal:true}` reports).

**Window menu (Windows, Alt-reachable; `installApplicationMenu`):** `Window` → `Move to Display` submenu lists every connected display as `<label> (Primary)` for the primary; `Move to Next Display` Ctrl+Alt+Right and `Move to Previous Display` Ctrl+Alt+Left, disabled when fewer than 2 displays; `Reset window position` centers the focused window on its current display. All geometry stays DIP; no raw screen API is exposed to renderers.

**Attention popup (native transparent window, bottom-right of the main window's display work area; `attention-popups.ts`):**

- Layout: width `min(364, workArea.width − 2·xGap)`, height `min(active×116 + 16, workArea.height − 2·yGap)`, `xGap = min(16, max(0, floor((area.width−220)/2)))`, `yGap = min(16, max(0, floor((area.height−desired)/2)))`; anchored at `area.x + area.width − width − xGap`, `area.y + area.height − height − yGap`. Up to 3 active cards, 6 s auto-expiry, queue cap 30.
- Card (per card, 108 px content + 8 px page padding): `border-radius:12px`, `border:1px solid #2e2e2e`, `background:#161616`, `box-shadow:0 10px 28px rgba(0,0,0,.47)`, `padding:12px 14px`, 3-column grid (`auto 1fr auto`), `column-gap:10px`, cards gap 8 px.
- Type/color: base `13px 'Segoe UI'` `#ededed`; brand line 10 px `#a5a5a5` letter-spacing `.06em`; title `strong` 13 px 600; body `p` 12 px `#bdbdbd`, single-line ellipsis; Open button 11 px 600, `padding:4px 12px`, `border-radius:7px`, `background:#4f6eff` (hover `#6478ff`), text `#fff`; Close 24×24 px, `border-radius:6px`, `#b0b0b0`.
- State dots (8 px, 3 px halo): default `#91a7ff`, needs-input `#ffc247`, completed `#2dd4a0`, failed `#ff6b7e`. Copy: title = item title or `Gen V1 needs your attention` (private preview); body per preview preference = item summary / `Task finished` / `Task needs attention` / `Your response is needed` / `Updated` / `Open Inbox to review.`; failed open/dismiss → `This item is unavailable. Open Inbox to check its current state.`
- Motion: control hovers `transition:background .12s ease` / `color .12s ease`; no entry/exit or travel animation; reduced-motion = the same, nothing to reduce; `forced-colors:active` respected by native chrome.
- Multi-monitor: on `displayChanged` (display-removed/added/metrics-changed) the popup re-lays out via `layout()` onto `screen.getDisplayMatching(mainWindow.getBounds()).workArea`.

**Titlebar:** Windows uses `titleBarStyle:'hidden'` + overlay `height:42`, dark theme `color:#0f0f0f`, `symbolColor:#eeeeee`; light `#ffffff`/`#1f1f1f` (`nativeTitlebarTheme`/`nativeTitlebarOptions`). Startup page: `background:#0f0f0f`, `13px/1.4 'Segoe UI'` `#eee`, 32 px brand mark `border:1px solid #444`, `forced-colors` falls back to `Canvas`/`CanvasText`.

**States per surface per matrix row:** visible/minimized/focused flags; `displayId` reported by `screen.getDisplayMatching`; `bounds` fully inside target `workArea`; `normalBounds` equals saved placement after restart; rescue state (`monitorRescued`) cleared on reconnect; reattach closes the native window and returns the surface to the main workspace; docked browser view re-parents without remount.

**Interactions:** menu click, Ctrl+Alt+Right/Left, Alt key opens the native menu on Windows, drag across monitor boundaries of differing scale factors (manual-check row: window must not jump or rescale; DIP bounds continue across the boundary), independent minimize, reset position, reattach.

**Motion/reduced-motion across rows:** window moves and restores are instant (native OS placement; no app-driven animation exists to reduce); renderer content honors `prefers-reduced-motion` and the app motion policy the same on every scale factor — no scale-factor-dependent timing is allowed; popup hover transitions `.12s ease` only.

## REPO_MAP

Verified at baseline `e883ac0`:

- `apps/desktop/main.ts` — window registry, `displays()` inventory with `scaleFactor`, `installApplicationMenu`, `moveWindowToDisplay`, `moveToAdjacentDisplay`, `resetWindowPosition`, `applyPlacement`, `displaysChanged` on `display-removed|display-added|display-metrics-changed`, attention popup wiring (`workArea()` = display matching main window).
- `apps/desktop/display-layout.ts` — `DesktopDisplay{id,workArea,label,primary,scaleFactor}`, `captureDesktopPlacement`, `restoreDesktopPlacement`, `retainDesktopPlacement`, `createNormalBounds`, `parseDesktopPlacement`.
- `apps/desktop/window-policy.ts` — `clampDesktopBounds`, `surfaceSize`, titlebar options.
- `apps/desktop/attention-popups.ts` — popup layout math, card spec, `displayChanged`.
- `apps/desktop/layout-transaction.ts` — `applyNativeLayout` profile restore with rollback.
- `packages/desktop-contract/index.ts` — surface kinds, `DesktopLayoutEntry.placement` schema.
- `scripts/verify-physical-displays.ts` — existing harness: launch, inventory, menu/shortcut move checks, minimize independence, saved-placement assertion, cold-restart restore, reattach, cleanup, `verification.json` + `report.md` receipts. **Extend this file; do not fork it.**
- `tests/desktop-display-layout.test.ts` — simulated-display unit coverage (do not duplicate in hardware checks).
- `docs/native-multi-monitor.md` — statement of what is verified; update its "What has been verified" section only with the actual run outcome.

## DESIGN

Extend `verify-physical-displays.ts` into a matrix runner. No app source changes.

**Data/control flow:** one run directory `docs/evidence/584-displays-<UTC>/run-<UTC>/` per row. The script enumerates displays once via `screen.getAllDisplays()` (id, bounds, workArea, scaleFactor, primary, internal), writes `actual-displays.json`, then iterates surfaces × displays, then the row's special checks (mixed-DPI transition, negative-coordinate transition, hotplug where hardware allows), then cold restart + reattach + cleanup, then `verification.json` + `report.md`.

**Matrix rows (hardware states, not config):** define rows by the enumerated inventory, so any attached hardware produces its true row:

| Row | Condition | Checks |
| --- | --- | --- |
| R1 single-display baseline | 1 display | existing checks; mark multi-display/mixed-DPI/negative rows `unverified` |
| R2 multi-display uniform DPI | ≥2 displays, equal `scaleFactor` | menu + shortcut moves for all surfaces, restart restore, independence |
| R3 mixed-DPI | ≥2 displays with ≥2 distinct `scaleFactor`s | R2 + screenshot per surface on each scale factor; drag-transition manual note; assert bounds identical in DIP after move (no physical-pixel rescale) |
| R4 negative coordinates | ≥1 display with `workArea.x<0 or y<0` | R2 + explicit move to the negative-coordinate display and restart restore into it |
| R5 hotplug | operator disconnects/reconnects a display | rescue → placement retained → reconnect → restore; deliberate-move-override check |
| R6 popup at scale | any row + fixture attention event | popup bounds inside the main window's display work area, right/bottom anchored per gap formula, correct DIP size on each `scaleFactor` |

Rows are emitted for every condition the inventory satisfies; unsatisfiable conditions record `unverified` with the missing hardware reason (existing receipt already has this shape — keep it).

**Checks added to the script (all per-surface where noted):**

- `display menu lists actual displays` — count equals inventory length, primary labelled.
- `<kind> menu move → display <id>` — `settledOn` (displayId match + bounds inside workArea).
- `<kind> Ctrl+Alt+Right/Left` — adjacent-display wraparound.
- `<kind> cold restart restores <id>` — existing check, applied to every detached surface.
- `rescue on display-removed` — programmatically verified by re-launching with the saved placement record whose display is absent **only if** physical unplugging is unavailable; physical unplug is the required primary method, simulated absence is the documented fallback and is labelled as such.
- `reconnect restores placement` — bounds equal the pre-disconnect bounds within ±4 DIP.
- `deliberate move after rescue sticks` — move rescued window, restart, new display retained.
- `attention popup placement` — assert `popup.bounds` inside `mainDisplay.workArea`, `popup.bounds.x + width = area.x + area.width − xGap` and `popup.bounds.y + height = area.y + area.height − yGap`, within ±2 DIP; repeat per scale factor.
- `DIP-only move` — after a move across a scale-factor boundary, `bounds` stays within target workArea with no dimension change attributable to `scaleFactor` (width/height unchanged ±2 DIP).
- `reattach` and `independent minimize` — existing, extended to detached surfaces on non-primary displays.
- `cleanup` — all owned processes exit, both ports close.

**Error/recovery:** any failed check records `{name, status:'failed', details}` and a failure screenshot per window; the run still writes receipts. `passed` requires zero failed checks and zero owned ports still listening — unchanged semantics.

**Evidence format:** keep the existing `verification.json` receipt; extend `hardwareCoverage` to `{multipleDisplays, negativeCoordinatesAvailable, mixedDpiAvailable, hotplugAvailable, negativeCoordinateTransitions, mixedDpiTransitions, hotplug, popupAtScale}` each `passed|failed|unverified` plus a `matrix` array `{row, condition, surfaces:[{kind,checks[]}]}`.

## EXECUTION_DAG

- **T01** Extend `scripts/verify-physical-displays.ts`: iterate all detachable surfaces the fixture can open (add `thread`, `plan`, `usage`, `agent`, `plugin`, `browser` beyond current `navigation`/`workspace`), matrix-row emission, hotplug sequence (pause for operator disconnect with a 5-min prompt window or `--no-hotplug` flag), popup placement assertion (needs one fixture attention event or direct `attentionPopups.displayChanged()` + render hook — discovery: choose the least invasive trigger that exercises the real layout path), per-scale screenshots, extended `hardwareCoverage`/matrix receipt. Done-when: script runs end-to-end on a single display and emits the matrix with correct `unverified` rows. Tests: run on single-display VM → report shows R1 only.
- **T02** Document the operator runbook inside the script header comment and `docs/native-multi-monitor.md` "how to run": hardware needed, `node --import tsx scripts/verify-physical-displays.ts <exe> <evidence-root>`, hotplug prompt behavior. Done-when: a fresh reader can reproduce the runbook.
- **T03** Execute the matrix on physical hardware (Windows required — CI/dev box with ≥2 displays; at least one mixed-DPI pairing and one negative-coordinate arrangement). Record `verification.json`, `report.md`, screenshots under `docs/evidence/584-displays-<date>/`. Done-when: every reachable row is `passed` or `failed` with evidence; unreachable rows `unverified` with reason. Owner: whoever has the hardware.
- **T04** Update `docs/native-multi-monitor.md`, `docs/acceptance.md`, `docs/public/release-notes.md` boundary lines and `README.md` preview-boundary note to name the run's actual result per row (only what the receipt shows; keep `unverified` rows open). Done-when: docs state exactly the receipt's coverage.
- **T05** File follow-up issues for any `failed` check, each linking the failing check name + evidence path. Done-when: every failure has an issue link in the run receipt or this issue's comments.

Dependencies: T02 ∥ T01; T03 after T01; T04, T05 after T03.

## VALIDATION

- `pnpm exec vitest run tests/desktop-display-layout.test.ts` — existing geometry unit tests still pass (script-only change, but run to confirm no accidental source edit).
- `pnpm lint && pnpm typecheck` — script edits typecheck.
- Self-run on a single display: `passed` or `unverified` only, never `failed` on matrix logic.
- Hardware run per matrix row; acceptance = the `verification.json` receipt + `report.md` + screenshots committed under `docs/evidence/`, with `hardwareCoverage` telling the true story. Release gate: README/release-notes boundary lines updated to match the receipt exactly.
- Acceptance matrix: one line per surface × row × check in `report.md`; a row closes only when every check in it is `passed`.

## STATE

Researched: surface kinds, sizes, placement/rescue/restore semantics, popup layout, menu structure, existing harness and unit coverage — all verified in source at baseline SHA. Not implemented: T01–T05. No blockers; T03 needs physical multi-monitor Windows hardware, which is the whole point of the issue. Exact next step: implement T01 (script extension) — a docs/scripts-only change; then schedule the hardware run.

## REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/584
- `docs/native-multi-monitor.md` (verification statement and hotplug gap)
- `scripts/verify-physical-displays.ts` (harness to extend)
- `tests/desktop-display-layout.test.ts` (simulated coverage — the boundary of what is already proven)
- `apps/desktop/main.ts`, `display-layout.ts`, `window-policy.ts`, `attention-popups.ts`, `layout-transaction.ts` (implementation under test)
- `README.md` § preview boundaries; `docs/public/release-notes.md` (#584 deferred note); `docs/acceptance.md`
