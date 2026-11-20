# Workspace animation coverage — every action smooth and tasteful

## META

- **Plan revision:** 1, 2026-11-20
- **Repo:** skytuhua-org/Gen-V1
- **Baseline:** `main` @ `0f673214643db10a5e2a62ee531fd66f7db09510`
- **Issue:** https://github.com/skytuhua-org/Gen-V1/issues/1182
- **Status:** Planning only. This document specifies; it does not implement.
- **Provenance:** Requested by S ("cover every action with smooth and tasteful animations; the entire workspace should feel alive"). Values follow the approved motion rules in `DESIGN.md` (IMG_2758 interaction rules) and the emilkowalski/skills motion vocabulary already adopted by this repo.

## OBJECTIVE

Every user-visible state change in the workspace has a defined, tasteful animation — nothing pops in or out abruptly, and nothing animates that should not. The implementer makes **zero design choices**: every animation below lists trigger, properties, duration, easing, delay/stagger, interruptibility, and reduced-motion fallback.

Success measure: walking the surface inventory in REPO_MAP, every enter/exit/state-change/hover/press maps to a row in the spec tables and uses the token system, with no new hardcoded durations, easings, or keyframe geometry outside the tables in this document.

## REQUIREMENTS

### In scope

- All interactive surfaces under `apps/web` and shared primitives in `packages/ui-shell` that mount, unmount, move, resize, change state, or respond to hover/press/drag/dismiss.
- Unifying every duration/easing on the existing token scale (`packages/ui-shell/tokens.css`); replacing hardcoded ms/s/bezier values.
- Enter/exit coverage for every popover, menu, panel, list item, notification, tab, disclosure, and window.
- Reduced-motion and `data-motion=off` fallbacks for every animation added.

### Out of scope

- New animation libraries or dependencies. CSS transitions/keyframes plus the existing `animateTask` WAAPI helper (`apps/web/src/task-motion.tsx`) cover everything.
- Changing layout, copy, colors, or component structure beyond what an animation needs (e.g. a `data-leaving` attribute, a grid-template-rows wrapper).
- The canvas world's own pan/zoom (already pointer-driven 1:1; no tweening by design).
- Idle/decorative animation, bounce, or artificial waiting — explicitly banned by DESIGN.md and kept banned here.

### Global motion contract (applies to every row below)

| Rule | Value |
| --- | --- |
| Entrance easing | `var(--ui-ease-enter)` = cubic-bezier(.16,1,.3,1) |
| Move/exit easing | `var(--ui-ease-move)` = cubic-bezier(.4,0,.2,1) |
| Exits | ~20% shorter than the matching enter; return toward the trigger |
| Interruptibility | Every transition/animation must be interruptible: retarget from current geometry (CSS transitions do this natively; WAAPI calls must `cancel()` cleanly — see `animateTask`). Never tween a control while held or dragged. |
| Keyboard-driven changes | Selection/highlight moves still animate; *content* entrances triggered purely by typing do not replay. |
| `prefers-reduced-motion` / `data-motion=reduced` | No spatial transforms, stagger, or shimmer. Opacity-only fallback at `var(--ui-motion-press)` (80ms) or less. The global reduce block in `styles.css:351` covers any missed case but each component must also declare its own. |
| `data-motion=off` / `data-panel-animations=false` | No animation at all (`appearance.css:17` already enforces). |
| Motion speed scalar | WAAPI durations divide by `--motion-speed` exactly as `animateTask` does; CSS animations honor it via the existing speed hook (settings already exposes it). |
| Compositing | Animate only `opacity` and `transform` for anything that moves per-frame or staggers; `height`/`width`/`grid-template-rows` only for measured layout handoffs (artifact, attachment row, disclosure) where a transform cannot express the change. No `will-change` except on `task-answer-reveal` (already present). |
| Delayed feedback | Loading indicators appear only after 150ms of pending time (existing rule, kept). |

## REPO_MAP — motion surface inventory

### Already correct (verify, do not change)

- **Token scale** — `packages/ui-shell/tokens.css:23-39` defines all duration/easing tokens used below.
- **Modal enter/exit** — `controls.css:91-105`: scale(.97)→1, 180/140ms via `@starting-style` + `allow-discrete`. Correct.
- **Toast** — `feedback.css:30-32`: `ui-toast-in` 200ms enter / `ui-toast-out` 160ms exit. Correct.
- **Tooltip** — `feedback.css:62-65`: 160/120ms + 350ms dwell. Correct.
- **Right panel** — `shell.css:139,214-220`: `panel-enter` 220ms (translateX(14px)→0 with a 78% settle point), `panel-exit` 180ms. Correct.
- **Sidebar collapse** — `shell.css:94-97`: width/flex-basis 220ms enter-eased, `visibility` delayed until exit completes. Correct.
- **Mobile drawer** — `styles.css:350`: translateX(-100%)→0 + scrim. Correct.
- **Shell notice toast** — `shell.css:279-283`: 200/160ms translateY(8px). Correct.
- **Model picker popover** — `model-picker.css:9-14,66-68`: scale(.985)+translateY(4px) 180ms in, scale-fade 140ms out, transform-origin at trigger corner, reduced-motion fade-only variants. **This is the exemplar for all popover work below.**
- **Message/thread-item/tab arrivals** — `styles.css:354-370`: `ui-item-in` 180ms, `ui-item-out` 140ms, `ui-popover-fade` reduced variant.
- **Disclosure height** — `styles.css:364`: `::details-content` block-size transition 220ms.
- **Task motion** — `task-motion.css` + `task-motion.tsx`: pane crossfade 140ms, branch stagger 30ms×2n, status stack handoff, answer reveal, spring helper, policy observer. Correct.
- **Artifact entrance** — `useArtifactEntrance` (task-motion.tsx): translateY(4px) 220ms, suppressed when focused/reduced/restored. Correct.
- **Floating window geometry** — `floating-window.css:1-4`: 220ms move easing on left/top/width/height, `data-interacting`/`data-adjusting` kill transitions mid-drag. Correct.
- **Copy buttons** — `styles.css:375-378`: opacity fade 120ms on hover.
- **Empty/error states** — `feedback.css:85-87`: `ui-state-in` 160ms.
- **Context segments** — `shell.css:199`: width transition 160ms; `context-inspector.css` popover + receipt pulse. Correct.

### Gaps this plan fixes

| Area | File(s) | Current state |
| --- | --- | --- |
| App popovers/menus (5+) | `composer-commands.css`, `saved-drafts.css`, `saved-layout-chooser.css`, `project-picker.css`, `session-branch.css`, `source-workbench.css` (SourceSelectionActions) | Mount/unmount with no enter/exit animation; the shared `Popover` already waits for exit animations (`Popover.tsx:34-42`) — only CSS is missing. |
| Workspace tools dock | `workspace-tools.css`, `workspace-split.css` | Tool panes/docks open, close, and re-split with no motion. |
| Side chat | `side-chat.css` | Opens/closes abruptly. |
| Document / plugin windows | `document-window.css`, `plugins.css` | Open/close/minimize abrupt (floating-window geometry is animated, enter/exit is not). |
| Thread list rows | `sidebar-context.css`, `sidebar-thread-move.css` | Insert uses `ui-item-in` via `.thread-item`, but removal/move has no exit; row hover only partially covered. |
| Agent inbox / task table / background work / file checkpoints / work objects lists | `agent-inbox.css`, `task-table.css`, `background-work.css`, `file-checkpoints.css`, `work-objects.css` | Row insert/remove and status changes abrupt; only hover transitions exist. |
| Settings section switch | `settings.css`, `Settings.tsx` | Section content swaps instantly; save-state chip appears/disappears abruptly. |
| Composer | `composer-entry.css`, `composer-toolbar.css` | Attachment row enters without height animation (spec'd in DESIGN but unimplemented); send/stop state swap abrupt. |
| Workspace error banners | `.workspace-error` in `App.tsx`, `styles.css` | Appears/disappears abruptly; not covered by `ui-item-in` (no `.thread-item`/arrival attr). |
| Chat scroll indicator | `chat-scroll-indicator.css` | Show/hide abrupt. |
| Hardcoded durations | `floating-window.css:38` (320ms), `interaction-tools.css`, `document-preview.css`, `context-inspector.css:1`, `model-picker.css`, `relationship-graph.css`, `planning-question.css`, `sidebar-context.css`, `sentence-reveal.css`, `software-development.css`, `appearance.css`, `loading-state.css`, `map-view.css`, `styles.css:135` | Literal ms/s values bypass the token scale and the `--motion-speed` scalar. |
| Canvas panels | `workspace-canvas.css` | `.canvas-panel` add/remove/collapse has no motion. |

## DESIGN — per-surface animation specification

Every row is normative. "Props" lists the animated properties in order. Durations name the token; the literal value is in the token table at top. Stagger uses `--ui-motion-stagger` (30ms), capped at 150ms total delay. All exits use `var(--ui-ease-move)`; all entrances `var(--ui-ease-enter)` unless noted. "RM" = reduced-motion fallback (always opacity ≤ `--ui-motion-press`, no transform).

### A. Shared popover/menus (one pattern, applied everywhere)

Define once as a reusable pair of keyframes in `packages/ui-shell/controls.css` (or a new `popover-motion.css` imported by it), applied by a `data-popover-motion` attribute every `Popover` consumer sets:

| # | Element | Trigger | Props | Duration | Delay | States & notes | RM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Popover enter | `open` → mounted | `opacity` 0→1, `transform` `translateY(var(--popover-travel)) scale(.98)` → none; `--popover-travel:4px` (above) / `-4px` (below); `transform-origin` = the edge nearest the trigger | `--ui-motion-popup-enter` (180ms) | 0 | Runs once (`both` fill). Origin flips when placement flips (`data-side`). | opacity only |
| A2 | Popover exit | `open`→false; `Popover` keeps mounted (`data-state="closed"`) | `opacity`→0, `scale(.98)` toward origin | `--ui-motion-popup-exit` (140ms) | 0 | `pointer-events:none` while closed. `Popover.tsx` already awaits `getAnimations()` before unmount — the CSS alone completes the contract. | opacity only, 60ms |
| A3 | Option rows inside popover | on enter | `opacity` 0→1, `translateY(2px)`→0 | `--ui-motion-popup-exit` (140ms) | `nth-child(n)` × `--ui-motion-stagger`, cap 150ms | Only on open, never on scroll-into-view or keyboard nav | rows appear at once, opacity only |
| A4 | Check/selected mark inside option | `aria-selected`→true | `opacity` .2→1, `scale(.8)`→1 | `--ui-motion-popup-exit` (140ms) | 0 | Same as `model-picker-check-in` — reuse that keyframe, rename to `ui-check-in` | opacity only |

Apply A1–A4 to: `.composer-command-popover`, `.saved-drafts-popover`, `.saved-layout-popup`, `.project-picker-popover` + its color popover, `.session-branch-menu`, `SourceSelectionActions` menu, `TaskTableControls` dropdowns, `WorkspaceSplitLayout` pane menu, `RelationshipGraph` node popover (`task-node-popover`), `ContextMeter` popover, `DesktopBrowser` menus. `model-picker.css` migrates to the shared keyframes (same values — no visual change).

### B. Menus, tooltips, toasts, dialogs

Already specified and implemented (tokens correct). **Changes:** none, except B1.

| # | Element | Change | RM |
| --- | --- | --- | --- |
| B1 | `.workspace-error` banner(s) | Treat as list inserts: on mount `ui-item-in` (`--ui-motion-insert` 180ms, translateY(4px)+opacity); on dismiss `ui-item-out` (`--ui-motion-remove` 140ms). When a second error stacks, existing banners translate down with `--ui-motion-status` move easing — no overlap pop. | opacity only |

### C. Sidebar & thread list

| # | Element | Trigger | Props | Duration | Delay | States | RM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Thread row insert | new `.thread-item` mounts | `ui-item-in` (exists) | 180ms | 0 | — | fade 80ms |
| C2 | Thread row remove/archive | `data-leaving=true` before unmount (mirror `resource-chip` pattern) | `ui-item-out`: opacity→0, translateY(3px) | `--ui-motion-remove` (140ms) | 0 | `pointer-events:none`; siblings reflow under existing layout (no height tween — rows are fixed height) | fade only |
| C3 | Thread row move (drag or programmatic reorder) | `sidebar-thread-move` commit | FLIP via `animateTask`: measure `getBoundingClientRect()` before/after, animate `translateY(delta)`→0 | `--ui-motion-insert` (180ms) | 0 | Cancel prior move animation before retarget (interruptible); drag itself is 1:1, untweened | skip animation entirely |
| C4 | Thread group expand/collapse chevron | `aria-expanded` toggle | `transform` rotate 0→90deg | `--ui-motion-status` (160ms) | 0 | exists (`shell.css:9`) — keep | none |
| C5 | Group children expand/collapse | `aria-expanded` toggle | `::details-content` block-size transition (reuse `styles.css:364` pattern if rendered as `<details>`; otherwise `grid-template-rows: 0fr→1fr` on a one-row grid wrapper) | `--ui-motion-panel-enter` (220ms) | 0 | children fade with `ui-item-in` | instant height, no fade travel |
| C6 | Row hover | pointer enter/leave | `background-color` | `--ui-motion-hover` (120ms) | 0 | exists on most rows — extend to `.thread-item` rows that lack it | none |
| C7 | ThreadHoverCard | pointer dwell 350ms → open; leaves on exit grace 120ms | `ui-tooltip-in`/`ui-tooltip-out` pattern: opacity + translateY(4px) | 160/120ms | 0 | verify `thread-hover.css` matches tooltip spec; align any deviation | opacity only |

### D. Conversation & composer

| # | Element | Trigger | Props | Duration | Delay | States | RM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Message arrival | `data-arrival=true` | `ui-item-in` | 180ms | 0 | exists | fade |
| D2 | Message hover actions (copy, react) | pointer enter/leave | `opacity` 0→1 (exists `styles.css:375`) | `--ui-motion-hover` (120ms) | 0 | keep; keyboard focus also reveals | none |
| D3 | Attachment chip insert | file added | `ui-item-in` on `.resource-chip` | 180ms | nth×30ms cap 150ms | exists | fade |
| D4 | Attachment chip remove | remove click | `ui-item-out` (exists, `data-leaving`) | 140ms | 0 | exists | fade |
| D5 | Attachment **row** expand/collapse | first chip added / last removed | `grid-template-rows: 0fr→1fr` + `opacity` on a wrapper (row exists only with attachments per DESIGN) | `--ui-motion-panel-enter` 220ms in / `--ui-motion-panel-exit` 180ms out | 0 | **New.** Grid-wrapper, not `height:auto` tween | row snaps, chips fade |
| D6 | Send → Stop state swap | run starts/stops | crossfade: outgoing `opacity`→0 `scale(.9)`, incoming reverse | `--ui-motion-press` (80ms) | 0 | Same-button swap, not a size change; disabled state transitions `opacity`+`color` 120ms | opacity only |
| D7 | Composer command menu | see A1–A4 | — | — | — | opens above caret; origin = bottom edge | — |
| D8 | Prediction/ghost text | new suggestion | `composer-prediction-in` opacity (exists, `styles.css:135-141`) | `--ui-motion-hover` (120ms) | 0 | keep | none (already off) |
| D9 | Sentence reveal (streaming prose) | grapheme batches | existing `SentenceReveal` | per `task-motion` chunk 120ms | — | keep; restored history never re-reveals | shows immediately |
| D10 | Chat scroll indicator ("scroll to bottom") | becomes scrollable-away / reaches bottom | `opacity` + `translateY(4px)` | enter `--ui-motion-status` (160ms), exit `--ui-motion-hover` (120ms) | 0 | `pointer-events:none` while hidden (visibility flip after exit) | opacity only |
| D11 | Typing/queued indicator | pending | existing tail-fallback pulse 900ms alternate (task-motion.css) — keep as-is | — | — | — | static dot |

### E. Right panel, tool docks, split panes

| # | Element | Trigger | Props | Duration | Delay | States | RM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | Right panel open/close | tab open / close-all | `panel-enter`/`panel-exit` (exists) | 220/180ms | 0 | keep | fade 80ms |
| E2 | Panel tab switch | `[role=tab]` activate | content: `task-pane-in` opacity .25→1 (`--ui-motion-tab` 140ms); tab underline `border-bottom-color` + `color` 140ms | 140ms | 0 | exists for task panels — extend `task-pane-in` (or `ui-item-in` at tab duration) to every `[role=tabpanel]` in `.workspace-right` | opacity only |
| E3 | Tool dock open/close | open tool / close tool | **New:** pane enters `ui-item-in`-style `opacity`+`translateY(4px)` `--ui-motion-panel-enter` (220ms); exits `opacity`+`translateY(3px)` `--ui-motion-panel-exit` (180ms); siblings' share change animates via `flex-basis`/`width` `--ui-motion-panel-enter` `--ui-ease-move` | 220/180ms | 0 | During pointer resize: `resizing-panel` already kills transitions — keep | opacity only, geometry instant |
| E4 | Split pane add/remove | split/unsplit | same as E3 on the new/removed pane; remaining panes tween `flex-basis` | 220/180ms | 0 | **New** | geometry instant |
| E5 | Docked summary collapse | `docked-summary-toggle` | chevron rotate (exists); body `grid-template-rows 1fr→0fr` + opacity | 220/180ms | 0 | **New body tween** | instant |
| E6 | Canvas panel add/remove (`.canvas-panel`) | preset/panel add or remove | enter: `opacity`+`scale(.96)`→none 220ms; exit: reverse 180ms, `transform-origin` center-top | 220/180ms | 0 | **New**; canvas pan/zoom stays pointer-driven, untweened | opacity only |
| E7 | Canvas panel collapse | `data-collapsed` toggle | body `opacity`+`grid-template-rows` (like E5) | 180/140ms | 0 | **New** | instant |

### F. Floating & document windows

| # | Element | Trigger | Props | Duration | Delay | States | RM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Floating window open | mount | `opacity` 0→1, `scale(.95)`→1, `transform-origin` = invoker (or center) | `--ui-motion-popup-enter` (180ms) | 0 | **New** — geometry transitions already exist | opacity only |
| F2 | Floating window close | close | `opacity`→0, `scale(.97)` | `--ui-motion-popup-exit` (140ms) | 0 | **New**; unmount after `animationend`/`getAnimations()` settle | opacity only |
| F3 | Minimize/collapse | `data-collapsed` | existing body fade (120ms); **add** height tween `grid-template-rows` 180ms | 180/120ms | 0 | keep drag `data-interacting` kill | instant |
| F4 | `.usage-context-track>span` width | usage updates | `width` 320ms ease-out → **retokenize to `--ui-motion-status` (160ms) `--ui-ease-move`** | 160ms | 0 | fix hardcoded 320ms | none |
| F5 | DocumentWindow open/close/minimize | same as F1–F3 | same as F1–F3 | same | 0 | **New** | opacity only |

### G. Lists & status surfaces

| # | Element | Trigger | Props | Duration | Delay | States | RM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | Agent inbox row insert/remove | row mount/`data-leaving` | `ui-item-in`/`ui-item-out` | 180/140ms | insert only: nth×30ms cap 150ms | **New** | fade |
| G2 | Task table row insert/remove | same | same | 180/140ms | same | **New** | fade |
| G3 | Background work item insert/remove | same | same | 180/140ms | same | **New** | fade |
| G4 | File checkpoint row insert | same | `ui-item-in` | 180ms | 0 | **New** | fade |
| G5 | Workflow card lane change | card dropped in new lane | FLIP `translate` to new lane via `animateTask` | `--ui-motion-insert` (180ms) | 0 | **New**; drag phase untweened 1:1 | skip |
| G6 | Workflow lane drop-target highlight | dragenter/dragleave | `background-color`+`border-color` (exists) | `--ui-motion-hover` (120ms) | 0 | keep | none |
| G7 | Status dot / connection state change | status flips | `background-color`+`border-color`+`color` `--ui-motion-status` (160ms); success gets one `ui-status-pulse` 240ms keyframe (scale 1→1.06→1 + ring fade) — **new shared keyframe, used once per transition** | 160ms / 240ms | 0 | applies to `.connection-state`, `.trace-status`, `.workflow-lane-mark`, save-state chip | opacity only |
| G8 | Architecture node focus/dim | focus change | `opacity` (exists 160ms) — keep; **add** `.architecture-edge` `stroke`+`stroke-width` 160ms | 160ms | 0 | partial exists | instant |
| G9 | Trace row expand/collapse | `trace-collapse` | reuse `::details-content`/grid-rows pattern 220ms | 220/180ms | 0 | **New** | instant |

### H. Settings & dialogs

| # | Element | Trigger | Props | Duration | Delay | States | RM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H1 | Settings section switch | nav select / search result | new content `task-pane-in` opacity .25→1 `--ui-motion-tab` (140ms); preserve scroll position per section (existing rule) | 140ms | 0 | **New** | opacity only |
| H2 | Save-state chip (`settings-save-state`) | `data-state` change | enter `ui-check-in` (A4) 140ms; exit opacity 140ms | 140ms | 0 | **New** | opacity only |
| H3 | Modal enter/exit | any `.ui-modal` | exists (controls.css) | 180/140ms | 0 | keep | fade |
| H4 | Dialog tab switch (UsageDialog `[role=tablist]`) | tab activate | `task-pane-in` 140ms on panel; tab pill `background-color`+`color` `--ui-motion-hover` | 140ms | 0 | **New** | opacity only |
| H5 | Select/checkbox/toggle state | commit | `background-color`+`border-color` `--ui-motion-hover` (120ms); checkmark `ui-check-in` 140ms | 120/140ms | 0 | verify each control; add where missing | opacity only |

### I. Retokenization sweep

Replace every hardcoded duration/easing in app CSS with the nearest token, keeping the visual value where a token is within ~20ms, else add the missing token:

| File:line | Current | Token to use |
| --- | --- | --- |
| `floating-window.css:38` | `width 320ms ease-out` | `--ui-motion-status` `--ui-ease-move` |
| `task-motion.css` pulses (900ms alternate) | loop keyframes | keep literal — ambient loop, exempt (documented in comment) |
| `interaction-tools.css`, `document-preview.css`, `context-inspector.css:1`, `model-picker.css`, `relationship-graph.css`, `planning-question.css`, `sidebar-context.css`, `sentence-reveal.css`, `software-development.css`, `appearance.css`, `loading-state.css`, `map-view.css`, `styles.css:135` | literal `ms`/`s`/`ease-*` | map to `hover/press/status/insert/remove/popup-*/panel-*/toast-*/tooltip-*` by role; `ease-out`→`--ui-ease-enter`, `ease-in-out`/`ease`→`--ui-ease-move` |

Rule for the implementer: grep `apps/web/src` and `packages/ui-shell` for `transition:[^;]*[0-9](ms|s)` and `animation:[^;]*[0-9](ms|s)` after the sweep — only token references and the documented ambient-pulse exemption may remain.

### J. What must NOT animate (negative spec)

- Panel/split **pointer resize** — geometry follows the pointer 1:1 (`resizing-panel`/`floating-window-interaction` already disable transitions; keep).
- Dragging cards, windows, canvas world — 1:1 pointer tracking, no tween on move; only the drop commit animates (C3, G5).
- Keyboard navigation through list rows/menus — selection moves, but no enter/stagger replays.
- Restored/snapshot content — no entrance replays (`useArtifactEntrance` already guards; apply the same `data-arrival`-only rule to G1–G4 lists: animate only items that arrive while the list is mounted and visible).
- Typing — composer and inputs never animate layout per keystroke.
- Scrollbars, caret blink, `spin`/`ui-spinner` loops — ambient loops exempt from stagger/RM travel rules but must still stop under `data-motion=off` (spinner slows to 1600ms under reduced, stops under off — existing, keep).
- Theme/accent change — **no** color-tween on `:root` swaps; a whole-app `transition: background-color,color` on switch is explicitly rejected (repaint flash is cheaper than a slow recolor). Instant.

## EXECUTION_DAG

| ID | Goal | Depends | Files | Done when |
| --- | --- | --- | --- | --- |
| T01 | Shared popover motion: `ui-popover-in`/`ui-popover-out`/`ui-check-in` keyframes + `[data-popover-motion]` contract; migrate `model-picker.css` to it (no visual change) | — | `packages/ui-shell/controls.css` (or new `popover-motion.css`), `model-picker.css` | keyframes defined once; model picker renders identically; grep shows no duplicated `model-picker-in/out` |
| T02 | Apply A1–A4 to all app popovers: composer commands, saved drafts, saved layouts, project picker + color popover, session branch, source selection, task table controls, split-pane menu, relationship-graph node popover, context meter, desktop browser menus | T01 | listed CSS files + add `data-state`/`data-side` hooks where missing (Popover already supplies closed state) | each popover enters A1, exits A2, rows stagger A3, check A4; verified by slow-motion walkthrough |
| T03 | List motion: thread rows (C2/C3), agent inbox, task table, background work, file checkpoints (G1–G4) — insert via `ui-item-in`, remove via `data-leaving`+`ui-item-out`, reorder via FLIP `animateTask` | — | `sidebar-thread-move.*`, `agent-inbox.*`, `task-table.*`, `background-work.*`, `file-checkpoints.*`, `ShellSidebar.tsx` (data-leaving plumbing) | insert/remove/move animate; restored lists don't replay |
| T04 | Composer: attachment row grid-rows tween (D5), send/stop swap (D6), scroll indicator (D10) | — | `composer-entry.css`, `composer-toolbar.css`, `ComposerAttachments.tsx`, `chat-scroll-indicator.css` | row height tweens 220/180; button swap 80ms; indicator fades |
| T05 | Workspace chrome: tool dock open/close (E3), split panes (E4), summary dock body (E5), canvas panels (E6/E7), side chat | — | `workspace-tools.css`, `workspace-split.css`, `WorkspaceSplitLayout.tsx`, `summary-dock.css`, `workspace-canvas.css`, `side-chat.css` | every pane/panel enter+exit animated; resize path untouched |
| T06 | Windows: floating/document/plugin window open/close/minimize (F1–F5) | — | `floating-window.css`, `document-window.css`, `plugins.css`, `FloatingWindow.tsx` (exit wait like `Popover`) | open 180 scale-in, close 140 fade-scale, unmount deferred to animation end |
| T07 | Workspace errors: `ui-item-in/out` + stack shift (B1) | — | `styles.css`/`App.tsx` `.workspace-error` | banners slide in/out; second banner doesn't overlap |
| T08 | Status surfaces: shared `ui-status-pulse` keyframe (G7) applied to connection/trace/lane/save-state marks; architecture edges (G8); trace rows (G9) | — | new keyframe in `controls.css` or `styles.css`; `work-objects.css`, `connections.css`, `settings.css` | one 240ms pulse on success transitions; no replay loops |
| T09 | Settings & dialog content: section switch (H1), save chip (H2), usage tabs (H4), control state sweep (H5) | T01 | `settings.css`, `usage-dialog.css`, `Settings.tsx` | 140ms crossfades; checkmarks pop |
| T10 | Retokenization sweep (I) + grep gate | T01–T09 | all listed files | grep for literal ms/s in transition/animation returns only documented exemptions |
| T11 | Reduced-motion + off audit of every added animation; `--motion-speed` honored by all WAAPI | all | touched files | each new block declares RM fallback; `data-motion=off` shows zero animation (DOM check) |

Ownership boundary: T02 is the largest slice; T03–T09 touch disjoint files and may parallelize freely. T10/T11 run last, together.

## VALIDATION

- **Static gate (must pass in CI or local):** `pnpm lint && pnpm typecheck`; plus the grep gate from T10.
- **Reduced-motion test:** set `:root[data-motion=reduced]` and `prefers-reduced-motion: reduce` in a browser fixture; every spec'd element shows opacity-only ≤80ms or nothing. `data-motion=off` → `getAnimations().length === 0` on the sampled surfaces.
- **Browser walkthrough (fixture host, `scripts/review-host.ts` + vite build on :4317 — the dev server rejects API writes on Linux):** slow the tab via `--motion-speed` or DevTools rendering → "slow down animations"; walk each spec section A–J and confirm enter/exit/stagger/RM per row. Record one pass of: open/close every popover, sidebar collapse + thread add/remove, composer attach/remove + send→stop, open/close a tool dock + split, open/close a floating window, trigger a toast + workspace error, switch settings sections, switch UsageDialog tabs.
- **Interrupt check:** close a popover mid-enter (spam the trigger); it must exit from current position, not jump. Resize a panel mid-open — transitions die instantly under `resizing-panel`.
- **Perf check:** DevTools performance panel during a 10-message burst + panel open: no dropped frames attributable to layout thrash; all per-frame motion is opacity/transform.
- **Regression:** existing vitest suite unchanged; no functional behavior change is expected — record `SKIP: full vitest` acceptable on docs/CSS-only diffs per CI, but run `pnpm exec vitest run` on any touched-logic file.

## STATE

- Researched & specified: entire inventory above; every "exists" claim verified at the file:line cited.
- Implemented: nothing (planning-only session).
- Verified on branch: nothing yet.
- Risks: `data-leaving` plumbing (T03, F2) is the only non-trivial React work — mirror `Popover.tsx:34-42`'s `getAnimations()` wait; `<details>` content transitions need the `::details-content` opt-in already in `styles.css:361-364`; Chromium-only feature — Firefox falls back to instant disclosure (acceptable, note it).
- Next: an implementing worker picks up T01→T11 in order; each task lands behind its own commit on one branch, one PR.

## REFERENCES

- `DESIGN.md` — "Motion follows the approved IMG_2758 interaction rules" + Motion tokens table (source of truth for values).
- `packages/ui-shell/tokens.css` — token definitions.
- `apps/web/src/model-picker.css` — popover exemplar.
- `apps/web/src/task-motion.tsx` — `animateTask`, `useArtifactEntrance`, motion-policy observer.
- `packages/ui-shell/Popover.tsx` — exit-animation wait contract all popovers inherit.
- Issue #1100 (error notification stacking) — B1 must compose with it, not conflict.
- Issue #1099 (reduced-motion a11y) — J/T11 must not regress its coverage.
