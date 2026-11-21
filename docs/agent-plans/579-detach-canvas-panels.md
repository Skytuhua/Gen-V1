# Plan: Detach canvas panels into pinned native windows

## META

- Feature: canvas panel detachment into native windows (issue #579)
- Repo: `skytuhua-org/Gen-V1`
- Plan revision: 1, dated 2026-11-21
- Baseline: `main` @ `e883ac0327c8` (verified at plan time)
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/579
- Status: planning only. No app code is written by this document; an implementer executes T01–T07.
- Provenance: authored by `devin-a-cloud-7c3a19` from issue #579 and the sources in REPO_MAP.

## OBJECTIVE

Conversations already detach into native pinned windows; canvas panels cannot (README line 104 lists this as a preview boundary). The user can move any canvas panel into its own native window with the same ownership, focus, restore, and close semantics as the conversation-detach model, and return it to its canvas slot. Success: on the desktop app every canvas panel kind can detach and dock back with zero data loss; in the browser (no desktop bridge) nothing changes.

## REQUIREMENTS

### In scope

1. A visible, keyboard-reachable detach affordance on every canvas panel header (desktop bridge present only).
2. A matching entry per panel in the existing Panels menu.
3. A placeholder ("ghost") tile left on the canvas at the panel's saved bounds, consistent with the existing `.panel-note` native-ownership rendering.
4. Pending, success, and failure states identical in spirit to the conversation-detach model.
5. Restore/dock-back via the detached window's existing "Return to workspace" affordance (already implemented by `bridge.reattach()` + the `focusSurface` consumer in `App.tsx`), which writes `placement:'canvas', visible:true`.
6. README preview-boundary line updated to reflect availability.
7. Tests covering the new affordance and placement transitions.

### Out of scope

- Drag-from-canvas-to-desktop gestures that spawn a native window on pointer release (native windows cannot be created mid-DOM-drag; the affordance is click/keyboard only).
- Always-on-top propagation from `panel.alwaysOnTop` to the native window (canvas pin and window always-on-top remain independent; existing `applyLayout` already restores `alwaysOnTop` for saved profiles).
- Changing close-guard, sign-in, or browser-docking flows.
- Web/browser builds: with no desktop bridge the UI is unchanged (feature unavailable, not shown disabled).

### UX requirements (binding — the implementer decides nothing)

**A. Header button**

- A fourth header control is inserted in `.canvas-panel-header` between the pin button and the collapse button, keeping order: move handle | pin | **detach** | collapse | hide.
- Element: `<button class="icon-button canvas-panel-detach">`, reusing the existing header size contract — `width:25px;height:28px;flex:0 0 25px` (28px/`flex-basis:28px` in the larger-density variant rule already covering `.canvas-panel-header .icon-button`). No new sizing CSS.
- Icon: lucide `ExternalLink`, `size={13}`, `aria-hidden="true"`.
- `aria-label={`Detach ${title(panel)} to a window`}`, `title="Open this panel in its own window"`.
- `type="button"`, `disabled={arranging || detachBusy}`.
- Visibility: rendered only when `desktop` (the desktop bridge context) is non-null **and** `panel.placement==='canvas'`. It is not rendered for ghost tiles, in the browser, or while `disabledKinds` hides the kind (the whole panel is absent then).
- Collapsed panels may still be detached; detaching produces a full native window (the collapsed height is a canvas-only state and is not propagated).
- `onClick`: `run(() => onDetach(panel))` — reusing the component's existing `run` error-to-`canvas-error` wrapper.

**B. Ghost tile (placement `'native'`, panel visible)**

- The ghost keeps `panel.bounds`, `order`, `alwaysOnTop`, and `collapsed` metadata. Position/size on canvas do not change when the panel detaches or returns.
- Header stays fully interactive: move handle repositions the ghost, pin toggles `alwaysOnTop`, collapse toggles the ghost height (40px), hide routes through the existing `setPanelVisibility` native path (already implemented — it drives `control({type:'visibility'})` on the owning window).
- No detach button in the ghost header.
- Body: the existing `canvasBody` native branch renders, verbatim:
  - `<div class="panel-note"><p>This view is open in another window.</p><button class="quiet">Focus window</button></div>` — copy, classes, and structure unchanged; `Focus window` calls `desktop.bridge.focus(native.id)` and reports failure via `setError`.
  - No "dock back" button is added to the ghost: returning is owned by the window's own "Return to workspace" affordance, exactly as detached conversations work.

**C. Pending state (detach in flight)**

- While `pendingSurface(desktop, panelDesktopSurface(panel))` is true: the header detach button is disabled; the body renders `<p role="status">Opening window…</p>` (mirroring the conversation model's "Opening conversation window…") and the panel body is `inert`.
- If `bridge.detach` resolves and the placement write succeeds, the ghost appears in the same frame the store update lands — no synthetic delay.

**D. Failure states**

- `bridge.detach` throws: panel stays `placement:'canvas'` fully interactive; the error message surfaces in the existing `.canvas-error` slot (`role="status"`), using the thrown message verbatim (e.g. `The main workspace cannot be detached.` will not occur; realistic copies include `Save the matching task edits before detaching` and `The detached window did not become ready. Your original view remains available.`).
- Placement write fails after the window opened: surface `detachPanelToNative`'s existing message verbatim — `The window opened, but its panel placement could not be saved. Focus the open window or retry Detach to save its placement.` The ghost note for that surface (panel still `'canvas'`) already renders "This view is open in another window." via `panelNativeWindow`, and the detach button must remain enabled so the documented retry works.
- `prepareWorkspace()` (journal/editor handoff) throws before detaching: nothing changes; error surfaces via `run`.

**E. Panels menu (`WorkspaceControls`)**

- Below the existing per-panel `Show/Hide <title>` items, add for every panel with `placement==='canvas'` an item `{id:'detach-'+panel.id, label:`Detach ${title(panel)}`, icon:<ExternalLink size={13}/>, disabled:busy || !desktop}` calling `run(() => detachPanel(panel))`.
- For panels with `placement==='native'` add `{id:'focus-'+panel.id, label:`Focus ${title(panel)}`, icon:<ExternalLink size={13}/>, disabled:busy || !desktop, onSelect: focus the native window via panelNativeWindow + bridge.focus}`.
- When `desktop` is null (browser build), neither item is rendered — same rule as the header button.

**F. Detached window**

- Native window title: `${panelTitle(panel)} — ${canvas.name}`.
- Initial size: `surfaceSize(panelDesktopSurface(panel))` — do not override; plugin/workspace/agent/etc. sizes already encoded there.
- Content: existing `DesktopEntry` workspace-surface branch (already handles `kind:'workspace'` with `panelId`/`tab`, plugin, plan/context, agent, artifact, thread, browser surfaces). No new renderer.
- The window's own header shows the existing "Return to workspace" quiet button (`desktop.bridge.reattach()`); docking writes `placement:'canvas', visible:true` through the existing `focusSurface` consumer — no new code path.

**G. Accessibility**

- Button order in DOM matches visual order; the detach button is reachable by Tab between pin and collapse.
- Focus management: on detach, the ghost's "Focus window" button is a reasonable next target but focus is **not** programmatically moved (matches conversation model); on dock-back, focus returns to the restored panel's move handle via normal remount.
- The `aria-description` on `.workspace-canvas` gains: "Use the detach button in a panel header to open it in its own window." (appended to the existing non-embedded text, before the scroll sentence).

**H. Motion / reduced motion**

- No new CSS or JS animation is introduced. The ghost swap and pending note appear/disappear un-animated (state swap), consistent with `.panel-note` elsewhere.
- The native window's own open animation is OS-owned. All existing `reducedMotion()` and `data-panel-animations` gates are untouched.
- Rationale: this matches the conversation-detach model, which has no in-app transition either — the OS window appearing is the feedback.

**I. Color/spacing/type tokens** (all existing, no new tokens)

- Ghost note text: `.panel-note` — inherits `--text` at default size; paragraph `line-height:1.5` per `.canvas-panel-body .panel-note`.
- Buttons: `.icon-button` chrome `--muted` foreground, hover `--selection-bg` background + `--text`; `.quiet` for `Focus window`.
- Ghost keeps `border:1px solid var(--border)`, `border-radius:12px`, `background:var(--surface,#0f0f0f)` — no dashed/opacity treatment added (the note copy carries the state).
- Header metrics unchanged: `flex:0 0 39px`, `padding:0 7px`, `gap:3px`, title `font-size:12px;font-weight:550`.

## REPO_MAP (verified)

- `apps/web/src/WorkspaceCanvas.tsx` — renders panels; `detach?` prop exists at line 17 but is documented "Ignored compatibility prop; canvas panels remain inside the app." → becomes the real wiring point (T01–T02).
- `apps/web/src/workspace-native.ts` — `panelDesktopSurface`, `panelsForDesktopSurface`, `panelNativeWindow`, `detachPanelToNative` (placement write + error copy), `setPanelVisibility` (native-aware). No changes needed except callers.
- `apps/web/src/App.tsx` — `canvasBody` already renders the native ghost note + `Focus window` (~line 935); `updateCanvasPanel` already calls `prepareWorkspace()` when `patch.placement==='native'` (~line 872); `focusSurface` consumer already docks native panels back (`placement:'canvas',visible:true`, ~lines 935–955). `renderWorkspaceCanvas` does not pass `detach` today.
- `apps/web/src/desktop-context.tsx` — `detachSurface`, `detachedSurface`, `pendingSurface`, `usePendingSurface`, and the "Return to workspace" reattach control (line 60).
- `apps/web/src/DesktopEntry.tsx` — detached-window content for `kind:'workspace'` surfaces incl. `panelId`/`tab` (line 51–52).
- `apps/web/src/WorkspaceControls.tsx` — Panels menu items + `panelVisible`/visibility actions (~lines 25–31).
- `apps/desktop/main.ts` — `channels.detach` handler validates, focuses an existing window for the same surface key, runs editor-handoff close guards, and opens via `openSurface` (line ~249); `channels.reattach` docks back (line ~258).
- `apps/desktop/window-policy.ts` — `desktopSurfaceAllowed`, `surfaceSize` per surface kind, `needsEditorHandoff` (includes `kind:'workspace'` tab artifact).
- `packages/contracts/workspace.ts` — `panelPlacementSchema` already allows `placement:'native'` (line 36).
- `packages/desktop-contract/index.ts` — `DesktopSurface` union includes `{kind:'workspace';panelId?;tab?}`; `detach`/`reattach`/`control`/`focus` bridge methods.
- `apps/web/src/workspace-canvas.css` — header/button sizing and `.panel-note` rules quoted above.
- `README.md` line 104 — the boundary statement to update.
- Split-workspace detach (`WorkspaceSplitLayout.tsx`, `detachConversation` in `App.tsx`) is the reference UX model — menu item "Detach conversation", pending note, "Focus existing window".

## DESIGN

Flow: header button or Panels-menu item → `onDetach(panel)` → `prepareWorkspace()` already runs inside `updateCanvasPanel` for `placement:'native'` → `detachPanelToNative(panel, desktop.detachSurface, updateCanvasPanel)` → `bridge.detach(panelDesktopSurface(panel))` opens or focuses the native window → `workspace.panel.update {placement:'native'}` → canvas ghost renders via existing `canvasBody` native branch. Return: window's "Return to workspace" → `bridge.reattach()` → `focusSurface` broadcast → existing consumer writes `placement:'canvas',visible:true` → full panel remounts at saved bounds.

Error/cancel: detach failure leaves `placement:'canvas'`; placement-write failure leaves the window open and surfaces the retry copy; dock-back `workspace.panel.update` conflicts retry twice on `WORKSPACE_CHANGED` (existing logic). Closing the native window (OS close) leaves the ghost; the existing close-guard (`useDesktopCloseGuard`) covers editable surfaces.

## EXECUTION_DAG

- **T01** Wire the detach callback: in `App.tsx`'s `renderWorkspaceCanvas`, pass `detach={(panel)=>detachPanelToNative(panel,desktop!.detachSurface,updateCanvasPanel)}` guarded by `desktop` non-null. Update `WorkspaceCanvasProps` doc comment (remove "Ignored compatibility prop…", type becomes optional as today). Done-when: `pnpm typecheck` clean; no prop required when `desktop` is null.
- **T02** Header button per spec §A in `WorkspaceCanvas.tsx`: import `ExternalLink`, render conditionally, wire `onDetach`, disable during `arranging` or a local pending set; pending note per §C using `pendingSurface`/`usePendingSurface` on `panelDesktopSurface(panel)`; append §G `aria-description` sentence. Tests: RTL assertion of aria-label and disabled state. Done-when: button renders for every `placement==='canvas'` panel on desktop, hidden otherwise.
- **T03** Ghost state verification + pending copy: confirm `canvasBody` native branch shows verbatim note + `Focus window`; add pending branch (`role="status"`). Add "Opening window…" while pending. Done-when: detach→ghost renders note, focus click calls `bridge.focus`, retry path leaves button enabled.
- **T04** Panels-menu items per §E in `WorkspaceControls.tsx` (`ExternalLink` icon, detach/focus per placement). Done-when: menu lists correct items per placement and hides them without `desktop`.
- **T05** README: replace line 104's "Canvas panel detachment is unavailable; context and usage tools minimize within the workspace." with: "On desktop, conversations and canvas panels can detach into pinned windows. Context and usage tools minimize within the workspace." Done-when: boundary text matches actual behavior.
- **T06** Tests (vitest, `tests/`): `panelDesktopSurface` coverage exists — add (a) detach button absent without bridge, (b) click invokes `detachSurface` then `updatePanel({placement:'native'})`, (c) failed placement write surfaces the retry copy and button re-enables, (d) ghost renders note + focus, (e) menu items per placement. Note: path-guard/file-access tests are Windows-only per repo docs — keep new tests UI/store-level so they run on `windows-latest` CI.
- **T07** Docs/checkpoint: link PR to issue #579; report tests run/skipped. Desktop manual verification (detach each kind, dock back, close-guard prompt on dirty artifact) is listed as a NOT_RUN-by-implementer real-user check if no desktop host is available — record it in the PR as such.

Dependencies: T01 → T02,T03,T04 (parallel-safe, different files); T05,T06,T07 last.

## VALIDATION

- `pnpm lint && pnpm typecheck` — must pass.
- `pnpm exec vitest run tests/<new-file>.test.ts` — new tests pass (CI: windows-latest).
- `pnpm build` — clean.
- Manual/desktop: `pnpm desktop:dev` → add panels of each kind to a canvas → detach via header and menu → ghost appears, Focus works, dirty-artifact close guard prompts, Return to workspace restores at saved bounds, browser build shows no detach affordance. If no desktop host is available to the implementer, this row is reported NOT_RUN with reason, never implied.
- Acceptance matrix: detach affordance on all kinds (desktop only) / ghost + Focus / pending copy / failure copy / dock-back restores bounds / hidden in web build / README updated.

## STATE

- Researched & decided: all UX values above; infra (`detachPanelToNative`, ghost note, reattach consumer, DesktopEntry surfaces) already exists and is verified.
- Pending: T01–T07 implementation, validation, desktop manual check.
- Risks: (a) `disabledKinds`/plugin-authority panels detach surfaces correctly via `panelDesktopSurface` — plugin kind maps to `kind:'plugin'` and is covered by existing plugin window policy; verify in T03 tests. (b) `navigation` and `workspace`-tab panels map to `kind:'workspace'`/`'navigation'` surfaces — all have `surfaceSize` entries; no exclusions needed.
- Next step: implement T01 on a fresh branch from `main`.

## REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/579
- Conversation-detach model: `apps/web/src/WorkspaceSplitLayout.tsx` (grip + "Detach conversation" menu), `apps/web/src/desktop-context.tsx:60` ("Return to workspace"), `apps/web/src/ScopedConversationComposer.tsx:58` ("Focus existing window").
- Native plumbing: `apps/web/src/workspace-native.ts`, `apps/desktop/main.ts` (detach/reattach handlers), `apps/desktop/window-policy.ts` (`surfaceSize`, `needsEditorHandoff`).
