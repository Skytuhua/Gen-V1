# Responsive width presets in the docked Browser

## META

- Feature: batch 6, item 6; size Medium; repository `skytuhua-org/Gen-V1`.
- Revision: 1, 2026-11-21. Baseline: `main` at `e883ac0327c834120d89c3697dec7380a342ba4d`, fetched and verified against `origin/main`.
- Status: researched design and execution plan only. No feature implementation or feature verification is included in this change.
- Publication: a docs-only branch and source-manifest entry are authorized. No issue or PR is to be opened for this assignment; no existing issue/PR is asserted. Issue-body publication, attachment, review and receiver ACK are not claimed. Before later implementation, coordinate ownership and publish the complete accepted plan under AGENTS.md when authorized.
- Provenance: user requirements; inspected baseline files below; Microsoft Edge responsive viewport and Electron WebContentsView documentation in REFERENCES. All new names below are explicitly proposed, not existing APIs.
- Conventions: the baseline contains only one file in `docs/agent-plans/`, `worker-1-documents-graph-decisions.md`. It was inspected along with its `source`-only manifest entry; two or three examples do not exist at this baseline. Use executable tasks, explicit evidence boundaries and existing UI motion conventions rather than copying its unrelated assignments.

## OBJECTIVE

Let a person inspect a page's CSS breakpoints using **Fit**, **390 px** and **768 px** inside the existing docked Browser, without resizing the Gen window. Fit is the initial and recovery mode. A fixed width is offered only when it fits the usable dock slot: never zoom down an oversized preset, overflow the slot or silently substitute a smaller fixed width.

Success means a fitting selection changes the native content viewport, reports its actual applied width, leaves navigation and focus intact, and stays inside the clipped slot through layout and zoom changes. An unavailable preset is disabled with an understandable reason. A selected preset that no longer fits falls back to Fit with a polite notice.

## REQUIREMENTS

### In scope and concrete flows

1. Open docked Browser: Fit selected, actual width reported after native acknowledgement. Navigate, reload, back and forward without resetting the selection.
2. Choose a fitting fixed preset: maintain slot height, horizontally center the narrower native view, expose app-colored gutters, preserve the loaded page and scroll context as far as normal page reflow permits. No reload or new WebContents is needed.
3. Try a too-wide preset: it is visibly unavailable and cannot activate; expose e.g. `768 px needs 768 px; available 520 px` to sighted and assistive users.
4. Resize panels, change canvas layout, resize/scroll the owner or change owner zoom/display scaling: recompute from the current clipped slot. Retain a fitting selection. If it becomes too wide, commit Fit and announce `768 px no longer fits. Switched to Fit.` once. Growing again enables the preset but does not reselect it.
5. Close/reopen Browser or change browser identity: start at Fit. Temporarily hide it behind a modal/menu or during canvas interaction: send zero bounds, report `Preview hidden`, but retain a still-valid selection. Dismissing an overlay restores the current mode.
6. On IPC failure, retain the last acknowledged readout marked stale, expose `Preview size could not be updated`, and retry on the next geometry change or explicit preset activation. Do not falsely show a successful applied width or loop retries at animation-frame frequency.

### Agreed exclusions and constraints

- Manual preview only. M06 in `docs/progress.md` concerns automated build/browser evidence and bounded repair; its viewport policy and activation flag are not this manual UI. Do not change M06, verification recipes, capture sizes or automated testing controls.
- No device profiles, touch, UA or DPR emulation; no orientation/height presets, custom sizes, network throttling, DevTools or extra browser privileges. Do not use `enableDeviceEmulation`, CSS transforms, page zoom or screenshots to fake a viewport.
- Docked native Browser only; detached `DesktopBrowserSurface` remains unchanged. There is currently one owned docked browser per main window, not a tab strip. Do not invent tabs.
- Session-only state per docked browser identity in React, not saved layout, browser storage or global preferences. This keeps an inspection choice out of future sessions and needs no migration. A component remount resets Fit deliberately; ordinary navigation and state broadcasts must not remount/reset it.
- Preserve owner-only IPC dispatch, malformed-input rejection, sandbox, context isolation, denied permissions/downloads/popups, public HTTP(S) policy and proxy protections. No remote page script execution or telemetry is needed to measure bounds.
- Widths mean page viewport CSS pixels at the existing native content zoom, not physical display pixels or owner-renderer CSS pixels. Do not equate devicePixelRatio with Electron owner zoom. See DESIGN for conversion and inward-rounding disclosure.

## REPO_MAP

Verified at the pinned baseline:

| File and symbols | Current behavior / planned responsibility |
| --- | --- |
| `apps/web/src/DesktopBrowser.tsx`: `DesktopBrowserDock`, `DesktopBrowserToolbar`, `DesktopBrowserSlot`, `DesktopBrowserSurface` | Dock composes toolbar and slot with no sizing controls. Toolbar handles navigation/error sequences. Slot measures and sends bounds. Surface is the separate detached browser UI. |
| `apps/web/src/browser-slot-bounds.ts`: `BrowserSlotRect`, `browserSlotRect` | Clips DOM rectangle to viewport and excludes full-span resize handles; partial overlays remain subject to hit testing. Extend only with pure sizing/presentation helpers if needed. |
| `apps/web/src/desktop.css` | Toolbar currently fixed at 96 px (44 px header + 52 px form); native element flexes into remaining space. Dock defaults to at most 520 px / 45vw, so 768 will often be unavailable. |
| `apps/web/src/styles.css`: `.segmented`; `packages/ui-shell/tokens.css`, `controls.css`, `Tooltip.tsx` | Existing segmented button styling, space/control/focus/motion tokens and tooltip primitive. No dedicated segmented-control component was found in ui-shell. Reuse native buttons and these conventions; no design-system API expansion. |
| `apps/web/src/motion-policy.ts`, `task-motion.tsx` | `readMotionPolicy`, `observeMotionPolicy`, `animateTask` provide app/OS motion policy and motion-speed handling. |
| `apps/web/src/shell.css`, `workspace-canvas.css`, `native-chrome.css` | Toolbar-height minimum assumptions, canvas browser bottom margin and detached native-titlebar rules must remain compatible. Preserve 96 px toolbar to avoid a layout-wide minimum-height change. |
| `apps/desktop/preload.ts`: `bridge.browser` | Forwards browser commands on the existing IPC channel; no new bridge capability needed. |
| `packages/desktop-contract/index.ts`: `DesktopBrowserCommand`, `DesktopBridge.browser`, `DesktopBounds` | Bounds command currently carries only a rectangle; `browser` returns `Promise<void>`. A narrow optional sizing request/result extension is proposed below. |
| `apps/desktop/window-policy.ts`: `parseBrowserCommand` | Strict command shape; bounds require exactly four finite bounded numeric fields. Any extension must explicitly update strict accepted keys. |
| `apps/desktop/main.ts`: `browserRecord`, `moveBrowser`, browser channel handler | Creates secured WebContentsView; handler parses commands and resolves owned browser. Only `record.dockedBrowser` may set bounds, using owner content size and actual owner `getZoomFactor()`. Detached resizing uses a separate full-width path. |
| `apps/desktop/browser-bounds.ts`: `nativeBrowserBounds` | Rejects nonfinite, negative or out-of-window values, converts owner CSS coordinates to native DIP using owner zoom, rounds inward, and canonicalizes zero rectangles. It validates the owner window, NOT a separately known DOM slot. |
| `tests/native-browser-bounds.test.ts` | Covers clipping handles, viewport containment, zoom conversion, inward rounding, hidden bounds and malformed/out-of-owner rejection. |
| `tests/desktop-native.test.ts`, `tests/docked-browser-open.test.ts` | Existing `parseBrowserCommand` consumers/tests; preserve strict command and dock ownership behavior. |
| `tests/e2e/native-browser-bounds.spec.ts`, `native-browser-bounds-fixture.tsx` | Vite/React geometry fixture records bridge calls and applies real `nativeBrowserBounds`; tests zoom resends, dialogs, shared menu/select hiding and focus restoration. This is a mock bridge, NOT an Electron rendering test. |
| `scripts/browser-suites.ts`, `playwright.config.ts` | `native-browser-bounds` is registered for scoped browser execution. Extend the existing spec rather than silently adding an unregistered suite. |

Current slot dispatch: ResizeObserver, DOM MutationObserver, window resize, capturing scroll and `harness:canvas-layout` schedule a single requestAnimationFrame measurement. `browserSlotRect` excludes `.panel-resizer,.split-divider`. Dialogs, expanded artifacts, aria-modal content, shared popups, inert/hidden ancestors, canvas interaction and five-point occlusion suppress native bounds. JSON key includes devicePixelRatio so scaling can resend unchanged CSS bounds. Cleanup sends zero. Keep all of these paths.

Integration status: baseline main only was inspected, not live open/merged GitHub work. No related issue, PR, worker ownership or future interface compatibility is assumed; T01 must refresh integration context before edits.

## DESIGN

### Ownership and control/data flow

`DesktopBrowserDock` owns proposed local `widthPreset: 'fit' | 390 | 768`, last acknowledged sizing metrics, pending/error state and fallback notice, keyed/reset by `docked.browserId`. Pass controlled sizing props to toolbar and slot. Keep `DesktopBrowserSlot` callable without sizing props with legacy Fit behavior for current consumers/fixtures. Do not persist the preset in `DesktopLayoutEntry` or put it in URL/history state.

Renderer measures the **outer usable slot**, not a CSS-narrowed child. Preserve `browserSlotRect` then existing conservative full-slot occlusion checks. Send the existing `bounds` command with that full clipped slot, plus proposed optional `widthPreset`. Main is the sole authoritative native sizing calculator. Do not run the current native DIP conversion twice. Legacy commands without the new field retain their existing behavior.

Proposed contract additions (implement together, not as existing facts):

- Optional `widthPreset: 'fit' | 390 | 768` on the bounds command; no arbitrary widths and no separate channel.
- For opt-in sizing requests return a typed bounds result containing requested/effective preset, the applied rectangle in owner CSS coordinates, actual viewport width in CSS pixels, available viewport width, availability for both presets, and hidden/fallback status. Legacy non-bounds actions still return void. Use a discriminated result and safely narrow it at callers rather than broad `any` casts.
- `DesktopBridge.browser` becomes `Promise<void | DesktopBrowserBoundsResult>`; existing callers ignoring results remain valid. Preload forwards the result unchanged. Do not publish metrics to remote content.

### Geometry and zoom

Extend `apps/desktop/browser-bounds.ts` with a proposed pure `nativeBrowserPreviewBounds` helper wrapping `nativeBrowserBounds`:

1. Validate the supplied slot through existing `nativeBrowserBounds(slot, ownerContentSize, ownerZoom)` first. Never relax finite/nonnegative/window checks or the inward-rounding rule. Validate content zoom as finite and positive.
2. Let resulting integer DIP rectangle be S; read content zoom with the owned view's `webContents.getZoomFactor()` in main. Available viewport CSS width is S.width / contentZoom. Fit uses S unmodified.
3. For a preset p, required native width is `ceil(p * contentZoom)`. It is available iff this fits S.width and S has positive height. If unavailable, effective mode is Fit and return an explicit fallback reason. Never scale p down to fit.
4. Center a fixed width in S with x = S.x + floor((S.width - requiredWidth) / 2); y and height remain S.y and S.height. The two gutters can differ by one DIP. Re-clamp to S defensively; assert all applied edges are inside S and therefore inside owner content bounds. No negative gutter, overflow or rounding outward.
5. Return actual width = applied DIP width / contentZoom, not the requested label. Integer native DIP quantization may produce a fraction at nondefault content zoom: render up to two decimals, with an accessible exact-value description if rounding matters. At default content zoom both fixed widths are exact. Do not change content zoom to force equality.
6. Convert the applied DIP rectangle back to owner CSS coordinates only for gutter decoration using ownerZoom. The request always remains the full slot. OS scaling/devicePixelRatio is not part of this math; Electron already uses DIP.

The main process cannot independently verify an arbitrary DOM slot: retain that existing renderer-measurement trust boundary explicitly. The new helper guarantees a selected rectangle is a subset of the supplied, window-validated slot; it must never allow a preset to expand an accepted slot. No claim is made that main can authenticate DOM geometry.

Keep zero requests as zero. Overlay suppression returns hidden, not unavailable: do not discard the last valid availability/preset merely because a menu opens. A genuinely empty measured slot falls back to Fit; distinguish this in renderer local state before sending the common zero rectangle. Report hidden instead of a fictitious 0 px visible preview. Re-evaluate on restore.

### State transitions, acknowledgement and recovery

Selection commits accessible pressed state immediately; actual width remains last acknowledged with `Updating` until success. Include preset in the slot deduplication key as well as devicePixelRatio and geometry. Ignore stale promises with a per-request sequence and browser identity/unmount guard. A stale reply must not revert a newer selection or emit an obsolete fallback notice.

Main returns Fit immediately on nonfitting requests so no oversized intermediate view is applied. Latest renderer acknowledgement commits Fit, availability and one polite notice; the next request deduplicates or confirms Fit, without oscillating. Growing the slot never automatically restores an earlier preset. A fresh user choice clears the previous notice; navigation errors remain independent of sizing notices.

IPC errors do not reset navigation or claim a new width. Explicit retry is pressing the desired enabled preset again (including currently selected Fit); allow this action to bypass failed-request deduplication. Geometry changes also retry once. Cleanup invalidates pending replies and sends legacy zero bounds. Do not create a busy retry loop, new native view or network request. Rollback removes the sizing props/optional contract/helper and leaves legacy Fit commands working; no stored data migration.

### Visual design and animation

- Keep the 96 px toolbar and the existing navigation/address form unchanged. Add sizing controls to the 44 px header between the ellipsized title and close button, docked only. Title gets `min-width:0` and yields space first. At narrow dock widths hide the visual title (retain its accessible context) and put the readout/reason in a reserved line within the header; controls remain visible with no horizontal scroll. Use a two-line compact header arrangement within 44 px, not a taller toolbar. At coarse-pointer 44 px targets, place readout/reasons as noninteractive text in the top of the gutter area instead; exclude that text's occupied strip from the measured slot so it is never covered by native content. Test this explicitly rather than overlapping the native view.
- Segment labels: `Fit`, `390`, `768`, group accessible name `Preview width`. Follow `.segmented` with `--subtle` background, 8 px group radius, 3 px inset, 6 px segment radius, `--surface` selected fill, `--text` selected foreground, `--muted` unselected text and `--control-border` outline. Use ui-shell `--ui-space-1/2`, compact row and focus-ring tokens. Scope CSS to docked browser; no global segmented restyling. Disabled text stays legible and gains an unavailable indicator, not color alone.
- Visible readout: `390 px actual`, `Fit · 512 px actual`, `Updating` or `Preview hidden`. Tabular digits; reserved readout space prevents toolbar jitter. Disabled reason text lists unavailable widths compactly, wrapping outside the native area if necessary; provide full reason through aria-describedby and the existing Tooltip primitive. Do not rely on hover/title alone.
- Outer slot/gutters use `var(--canvas)` with a subtle inset `var(--border)` edge at each native boundary, no fake device bezel, ruler, patterned image or white page-colored gutter. Decoration is pointer-events:none. Keep resize handles and the canvas bottom margin accessible. No new loading skeleton or overlay above WebContentsView.
- Native `setBounds` changes immediately, once per coalesced geometry frame; **the native view cannot be CSS-animated**. Never animate its wrapper width/transform or interpolate IPC bounds. Only segment background/text color transitions use `--ui-motion-hover` (120 ms) and `--ui-ease-enter`; notice opacity may enter over 120 ms through existing `animateTask`/motion-policy handling. No sliding indicator or gutter travel. Keyboard activation updates without decorative delay. Reduced motion/off: settle these decorations immediately, including a policy change mid-animation; respect existing motion speed. Readout, disabled state and live announcement commit with state, not after animation completion.

### Accessibility

Use a labelled group of native buttons with `aria-pressed`; normal Tab/Shift+Tab traversal and Enter/Space activation, not an incomplete custom radio pattern. Disabled presets use native disabled plus a described visible reason; expose the reasons through the group's description because disabled controls are skipped in tab order. No global shortcuts, no forced page focus after selection. If an already focused preset becomes unavailable on resize, move focus to Fit only when focus is still on that control; never steal focus from address input or native content. Fit remains reachable and enabled whenever the toolbar exists. Preserve close/back/forward/address accessible names and focus restoration after shared popups. Use a single polite status for fallback, no announcement on every ResizeObserver tick. Test light/dark/forced-colors focus and disabled contrast, 200% UI zoom and coarse-pointer target sizes.

## EXECUTION_DAG

All tasks below are future implementation work, NOT authorization to implement during this docs-only assignment. Stable IDs are sequential to avoid overlapping ownership of the contract and fixture.

### T01 — Refresh baseline and lock geometry/contract tests

- Depends on: accepted revision 1 and authorization to implement; read complete plan, AGENTS.md and related issue/journal when available.
- Owner boundary: one desktop/contract worker; files `tests/native-browser-bounds.test.ts`, `tests/desktop-native.test.ts`, `packages/desktop-contract/index.ts`, `apps/desktop/window-policy.ts`.
- Steps/input: refresh main and search related open/merged work; verify exact callers of `DesktopBridge.browser`, inspect parser tests and add the optional preset/discriminated result contract described above. Preserve old commands and reject unknown fields, arbitrary preset numbers/strings, malformed rectangles and invalid zoom inputs. Record any integration conflicts before editing shared code.
- Output: typed request/result and decision-level tests for Fit, both presets, insufficient space, hidden/empty and invalid input. Add proposed test names `centers fitting preview widths inside the rounded slot`, `falls back to Fit when a preset exceeds available width`, and `rejects unknown preview presets without relaxing legacy bounds validation` in the existing relevant test files.
- Tests: focused Vitest files in VALIDATION; normal, exact-fit, one-DIP-short, fractional origin/zoom, empty and parser-error cases. New behavior tests may initially fail until T02; record this intentionally, never call it passing.
- Done when: contracts compile with callers and each proposed behavior has a specific assertion; hand exact result shape and test cases to T02 worker. No UI ownership yet.

### T02 — Apply native sizing inside the validated slot

- Depends on T01. Same desktop/contract owner; files `apps/desktop/browser-bounds.ts`, browser handler in `apps/desktop/main.ts`, forwarding only if necessary in `apps/desktop/preload.ts`, related tests from T01 and `tests/docked-browser-open.test.ts`.
- Steps/input: implement `nativeBrowserPreviewBounds` and metrics using owner and content zoom; integrate only the docked bounds branch after parser/ownership checks. Preserve legacy Fit/zero and detached paths. Return typed acknowledgement; do not touch browser security setup, network/permission handlers or navigation.
- Output: authoritative clamped rectangle, width/availability/effective-mode result. Add `keeps narrowed preview inside slot across owner and content zoom` and `preserves hidden bounds and rejects invalid preview geometry` unit cases, including 0.8, 1, 1.25, 1.5 zooms and malicious/NaN/Infinity values.
- Tests: T01 focused tests plus docked-open regressions; prove output edges remain inside the already rounded slot, not merely the window. Check denied detached bounds and unchanged sandbox/public URL policy assertions in desktop tests.
- Done when: focused unit suite passes and main uses one setBounds per valid request with no view recreation; hand result semantics to T03.

### T03 — Build docked controls, state and gutters

- Depends on T02. Frontend worker owns `apps/web/src/DesktopBrowser.tsx`, `browser-slot-bounds.ts`, `desktop.css`; read existing ui-shell/styles/motion primitives without changing global tokens.
- Steps/input: add controlled state at Dock, optional Slot/Toolbar props, identity reset, acknowledgement/error sequencing, reason/readout/status rendering, keyboard and focus behavior exactly as DESIGN. Keep all measurement/occlusion listeners and cleanup; measure outer slot, include preset in dedupe key, derive gutter decoration from acknowledged metrics. Keep toolbar height; apply narrow/coarse-pointer arrangement and exclude any readout strip from the content measurement. Style only this surface and its decorative motion.
- Output: working controls and immediate native resizing, session-only state, safe fallback and error recovery. No persistent settings, emulation, detached controls or M06 edits.
- Tests: add helper assertions to `tests/native-browser-bounds.test.ts` only if new pure renderer helpers are introduced; test empty rectangles and rounding there. T04 exercises the composed UI. Review rapid selection, failed reply, stale reply, unmount and identity changes before handoff.
- Done when: typecheck/build succeed, navigation and baseline Fit geometry remain unchanged, all controls fit the narrow dock; hand exact DOM/accessibility contract to T04 with implementation SHA.

### T04 — Extend scoped browser coverage and gather native evidence

- Depends on T03. Verification worker owns `tests/e2e/native-browser-bounds.spec.ts` and `native-browser-bounds-fixture.tsx`; production edits go back to their owning task. Preserve old Slot-only fixture geometry for existing tests; add a composed dock fixture mode with controllable slot dimensions, result metrics and synthetic failures/delayed replies. Mock the same pure main sizing helper rather than making the mock return requested labels blindly.
- Add named tests: `docked width presets center native bounds and report actual width`; `unavailable widths explain why and shrink falls back to Fit once`; `preview selection survives navigation and occlusion but resets for a new browser`; `latest preview request wins and failures expose retry`; `width controls remain keyboard accessible in narrow and reduced-motion layouts`.
- Assertions/input: use slots above 768, exactly 768/390, one unit below each and zero; Fit default; disabled reasons; centered x with full height; no overflow; fallback notice count; growth does not reselect; pointer and keyboard; focus only recovered when needed; content/owner zoom metrics; dialog/menu/select suppression and restore; zero on cleanup; error/stale response; no excess identical IPC calls. Existing fixture's 300 px slot cannot test fitting 390/768: deliberately provision wider cases and increase mock owner dimensions consistently.
- Tests/output: scoped commands below, screenshots of Fit/390/768 and narrow-disabled/fallback in light/dark and reduced motion. These mock tests do not prove Electron pixels. On supported Windows desktop run a synthetic public HTTP(S) responsive test page, verify page CSS breakpoint labels/viewport width against readout without adding production automation APIs, compare gutters/native edges, exercise panel resize, display scaling/owner zoom, modal hiding and navigation preservation. Keep page under existing public-URL policy; no localhost/private-network exception. Record any external fixture hosting prerequisite before this check; do not deploy from this task.
- Done when: automated checks pass and redacted native screenshot evidence with OS/build/scale/zoom captions exists, or the native gate is explicitly BLOCKED with responsible verifier named. Hand evidence to T05; do not treat mocks as native proof.

### T05 — Hand the finished work to the front end team for review

- Depends on T01–T04 passing, including supported Windows native evidence. Release/review owner consolidates plan, implementation SHA, exact commands/results, screenshots and acceptance matrix; update the plan's STATE only with observed facts. If any gate is blocked, report blocked rather than finished.
- Files/output: update this plan only for accepted decisions/results, with revision increment as required; no unrelated code. Supply complete source and evidence links to the front end team, explicitly requesting review of control density, gutter/native alignment, readout accuracy, keyboard/focus, disabled explanations, fallback notice and motion policy. Follow authorized issue/PR workflow for implementation, not this docs-only publication.
- Positive/negative review: team checks Fit and both fitting presets, narrow unavailable/fallback, IPC failure/stale result, reduced-motion/off and detached/no-emulation regressions against acceptance below.
- Done when: finished work has been handed to the front end team with retrievable artifacts and acknowledgement requested; track receiver ACK separately. This is the LAST task. Review is not merge, release or verified-on-main.

## VALIDATION

### Reproducible setup and planned commands

From repository root, use Node >=24.10.0 and pnpm 10.30.3; `pnpm install --frozen-lockfile`. Linux shells here require loading `/home/ubuntu/.nvm/nvm.sh`; supported native release testing requires Windows x64 and setup in `docs/getting-started.md`. Provision Chromium and any channel required by scoped config. Planned implementation checks, not executed for this documentation assignment:

```sh
pnpm exec vitest run tests/native-browser-bounds.test.ts tests/desktop-native.test.ts tests/docked-browser-open.test.ts --maxWorkers=1
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm exec playwright test tests/e2e/native-browser-bounds.spec.ts --config playwright.config.ts
```

Run the Windows packaging smoke required by CONTRIBUTING.md after desktop edits; establish the current packaging prerequisites with the Windows verifier. Save redacted logs and native screenshots in a durable authorized evidence location, not OS temporary storage or a source commit containing profiles/traces. Baseline snapshot fixtures use mock IPC only; native confirmation remains mandatory before finished implementation handoff.

Docs publication checks: stage the new Markdown so the git-tracked-link checker sees it, then run `pnpm check:docs-links` and `pnpm exec vitest run tests/public-source.test.ts --maxWorkers=1`. Add the plan only to `source` in `scripts/public-source-files.json`, matching the sole existing agent plan; documentation is not runtime payload. Do not add application files in this assignment. External source URLs were fetched successfully during research; external link crawl of the whole repository is optional, not a feature verification claim.

### Acceptance and requirement-to-task audit

| Check | Observable acceptance | Tasks |
| --- | --- | --- |
| A01 | Fit defaults; navigation preserves choice; new browser/remount starts Fit; no persisted preference | T03, T04 |
| A02 | 390/768 fit only inside slot, centered with full height; actual applied CSS width, zoom/rounding disclosed | T01, T02, T03, T04 |
| A03 | Unavailable presets disabled with visible/accessible reason; shrink switches once to Fit, growth does not reselect | T01–T04 |
| A04 | Viewport/handle clipping, dialogs, menus, selects, inert/canvas interactions, DPR resend and zero cleanup preserved | T02–T04 |
| A05 | Strict parser, owner-only IPC, window and slot-subset validation, invalid zoom/geometry rejection preserved | T01, T02, T04 |
| A06 | Header fits narrow docks/200% zoom; themed gutters and readout never covered by native content; no native CSS animation | T03, T04 |
| A07 | Keyboard/focus, disabled descriptions, contrast and one polite fallback announcement; reduced/off immediate | T03, T04 |
| A08 | Latest request wins; stale/error state is honest; explicit/geometry retry works; no busy loop | T02–T04 |
| A09 | Detached browser, security policy, M06 and automation controls unchanged; no emulation or new privilege | T01–T04 |
| A10 | Unit/e2e results distinguished from Windows native evidence; front end team receives finished artifacts | T04, T05 |
| A11 | Complete plan and source-only manifest entry; docs/manifest checks; isolated pushed docs branch, no PR/issue opened | Docs publication, outside future implementation DAG |

Release gate: A01–A10 all evidenced and front end review requested; no unsupported claims based on mocks. Every in-scope requirement and exclusion maps above; T01→T02→T03→T04→T05 has no parallel overlapping file scopes. This docs change satisfies only planning/publication, not these future feature gates.

## STATE

- Researched/decided: baseline code paths, Fit-first session-only ownership, authoritative main sizing within measured slot, zoom-aware actual readout, centered gutters, unavailable/fallback/error rules, visual/motion and accessibility design.
- Implemented feature: nothing. Feature unit/e2e/native/visual checks: NOT RUN. No feature screenshot exists; visual design is unverified until T04.
- Current owner/scope: docs planning worker only, branch named `devin/<timestamp>-browser-width-presets-plan`; exact branch and final immutable SHA are reported at publication, not fabricated here. T01–T05 NOT_STARTED; front end receiver ACK not requested yet because there is no finished implementation.
- Risks/pending: native DIP quantization vs page viewport metrics, extreme toolbar density/coarse-pointer arrangement, stale IPC ordering, and real Windows compositor behavior. T02/T04 must prove these cases. External public test-page availability and Windows verifier access are prerequisites for native evidence, not reasons to weaken browser network restrictions.
- Integration unknown: current GitHub issue/PR work was not surveyed; no issue was opened or modified under the explicit docs-only/no-issue request. Do not claim AGENTS issue publication or HANDOFF_COMPLETE; this is a retrievable branch artifact awaiting authorized review, not an acknowledged implementation handoff.
- Next action after plan acceptance: an authorized implementing worker executes T01 from the pinned baseline or explicitly reconciles a newer main, with complete issue/journal coordination when authorized. Do not begin feature implementation in this planning session.

## REFERENCES

- [Microsoft Edge: Responsive Viewport Mode](https://learn.microsoft.com/en-us/microsoft-edge/devtools/device-mode/#responsive-viewport-mode): numeric viewport dimensions expose responsive layout/media-query behavior. Edge can scale oversized viewports to accommodate them; this plan deliberately does NOT copy that behavior—unfitting presets are unavailable. Device emulation features elsewhere in that guide are out of scope.
- [Electron: WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view): native child view hosting a WebContents, positioned through view bounds rather than DOM layout. Native geometry is applied through `setBounds`; CSS transitions in the owner cannot animate this native surface. Retain the existing secured webPreferences and ownership lifecycle.
- [AGENTS.md](../../AGENTS.md), [contribution guide](../../CONTRIBUTING.md), [setup](../getting-started.md), [progress/M06](../progress.md).
- Baseline sources: [renderer browser](../../apps/web/src/DesktopBrowser.tsx), [slot clipping](../../apps/web/src/browser-slot-bounds.ts), [desktop main](../../apps/desktop/main.ts), [native geometry](../../apps/desktop/browser-bounds.ts), [strict parser](../../apps/desktop/window-policy.ts), [contract](../../packages/desktop-contract/index.ts), [geometry unit tests](../../tests/native-browser-bounds.test.ts), [geometry e2e](../../tests/e2e/native-browser-bounds.spec.ts). Relative links resolve to the branch source; use META's verified baseline SHA when comparing original behavior.
