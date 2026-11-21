# Restore and dock affordances for minimized context and usage tools

## META

- Feature: discoverable restore/dock path for minimized Project overview and Live usage tools
- Repo: `skytuhua-org/Gen-V1`
- Plan revision: r1, 2026-11-21
- Baseline: `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d`
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/590
- Related: #579 (canvas detachment — out of scope), README "context and usage tools minimize within the workspace"
- Current implementation status: minimizing exists (collapsed `DockedSummary` chips drop to a bottom row); restore is only "click the collapsed header"; there is no dedicated keyboard path; Live-usage open state is not persisted
- Source provenance: design plan written by `devin-a-cloud-72b7882f` from the issue body, `AGENTS.md`, `DESIGN.md`, and the verified files in REPO_MAP

## OBJECTIVE

When a person minimizes the Project overview or Live usage tool, they must be able to find it again and restore it without hunting. Today the collapsed header chip is the only way back, and it is visually indistinguishable from a closed panel: nothing says where the tool went, no keyboard path restores a specific tool, and Live usage forgets that it was open between sessions.

Done when: a minimized tool is visible as a labeled tray chip at the bottom of the workspace with icon, name and live summary; the chip restores on click and on a rebindable keyboard chord; Escape still minimizes; collapsed state and Live-usage open state both survive reload; every value below is implemented as specified, leaving no free design decisions.

## REQUIREMENTS

### In scope

- A named "minimized tools tray" region that owns every minimized `DockedSummary` in the conversation workspace (Project overview `id="plan"`, Live usage `id="usage"`).
- Tray chip: icon + title + live summary + restore affordance, fully specified below.
- Whole-header toggle stays the mouse path (DESIGN.md: "the entire header is an accessible disclosure"); Escape-inside-panel minimizes (already implemented — keep).
- Two rebindable Workspace-scope keyboard bindings to toggle each tool by name.
- Persistence: collapsed state (existing `harness:summary:{id}:v1`) plus a new open-state key for Live usage.
- Accessibility: `aria-expanded`, `aria-label`, `title` tooltip, `aria-keyshortcuts`, focus-visible ring, focus handoff on restore, `prefers-reduced-motion` behavior.
- Narrow (< 706 px) and wide (≥ 706 px) tray geometry.

### Out of scope

- Canvas/surface detachment (#579) and detached conversation floats.
- Changing what the tools contain (Project overview body, usage details) or adding new tools.
- Drag-to-reorder, drag-to-dock, or tray customization.
- Persisting Project overview open state — it is driven per-thread by `planVisibility` and stays that way.

### User flows

1. **Minimize with pointer.** Click the expanded tool's header → the body collapses, the header chip moves into the minimized tools tray at the bottom-right of the workspace.
2. **Minimize with keyboard.** Focus anywhere inside the expanded tool → `Escape` → the body collapses and focus moves to the tray chip (already implemented; keep).
3. **Restore with pointer.** Click the tray chip → the tool re-expands in the right dock column; focus moves to the expanded header's disclosure button so `Escape` can immediately re-minimize.
4. **Restore with keyboard.** Press the tool's chord (`Alt+1` overview / `Alt+2` usage by default, rebindable) → same as flow 3. If the tool is expanded, the chord minimizes it instead (toggle semantics).
5. **Update while minimized.** The chip keeps its live summary; when an expand request arrives (`expandRequest`) while the tray is in row layout, the chip shows "Update available" instead of the summary (existing `expansionPending` behavior — keep).
6. **Reload.** Collapsed state and Live-usage open state are restored from storage; a tool the user left minimized stays minimized.

## REPO_MAP

Verified at the baseline SHA:

| File | Role |
| --- | --- |
| `packages/ui-shell/SummaryDock.tsx` | `DockedSummary` (collapse state, `readSummaryCollapsed`/`writeSummaryCollapsed` under `harness:summary:{id}:v1`, Escape-to-collapse, `expandRequest`/`expansionPending`, focus-on-close restore), `SummaryDock` (`<aside class="summary-dock">`), `SummaryLayout` (grid owner) |
| `packages/ui-shell/summary-dock.css` | Tray mechanism already exists: when no summary is expanded and width ≥ 706 px, `.summary-dock` goes `flex-direction:row; justify-content:flex-end` (bottom row); `< 706 px` stacks below chat |
| `packages/ui-shell/tokens.css` | Motion/easing tokens: `--ui-motion-hover 120ms`, `--ui-motion-press 80ms`, `--ui-motion-insert 180ms`, `--ui-motion-panel-exit 180ms`, `--ui-ease-enter cubic-bezier(.16,1,.3,1)`, `--ui-ease-move cubic-bezier(.4,0,.2,1)`, `--ui-focus-ring` |
| `apps/web/src/App.tsx` (~L1119–1154, ~L521, ~L745, ~L447) | `SummaryDock` composition: `DockedSummary id="plan"` (Project overview, `expandRequest={planExpandRequest}`) + `UsageFooter id="usage"`; `liveUsageOpen` is `useState(false)` — not persisted; composer usage launcher button (Activity icon) toggles open/close |
| `apps/web/src/UsageFooter.tsx` | `DockedSummary id="usage"`, title "Live usage", `collapsedLabel="Inspect live usage"`, `minimizeLabel="Minimize live usage"`, summary = Activity icon + "N input tokens" |
| `apps/web/src/keyboard-bindings.ts` | `KEYBOARD_BINDINGS` registry, `chordFor(id)`, scopes `Global`/`Workspace`/`Conversation`/`Sidebar`/`Terminal`/`Settings`; rebindable bindings carry `preference:` into `UiPreferences['keybindings']`; Workspace scope currently holds `toggle-workspace-panel`, `window-move/restore/close` |
| `apps/web/src/WorkspaceHost.tsx` (~L235–239) | Global `keydown` dispatch via `matchesShortcut(event, preferences.keybindings.<pref>)` |
| `apps/web/src/shell-layout.ts` | `matchesShortcut`, `useShellLayout` persistence pattern (`harness:shell-layout:v1`) |
| `apps/web/src/settings-inventory.ts`, `apps/web/src/KeyboardReference.tsx` | Settings/reference surfaces — registry entries surface automatically; check whether a new preference needs an inventory row |
| `DESIGN.md` | "Project overview and compact Live Usage use normal-flow docks; a hidden/collapsed summary releases its space"; "the entire header is an accessible disclosure"; tool minima 280–720 px, stack below chat under 706 px |
| `tests/` | `split-app-browser.test.ts`, `conversation-placement.test.ts`, `split-workspace-renderer.test.ts` touch dock/summary behavior — verify which assertions the tray rename affects (discovery task T05) |

Unverified/discovery: exact test files asserting on `.summary-dock` row layout; whether a keyboard preference needs a Settings UI row (`settings-inventory.ts`).

## DESIGN

### Concepts

- **Minimized** — tool body hidden; a tray chip (the tool's own header) sits in the minimized tools tray. `data-collapsed=true` on the `.docked-summary`.
- **Expanded** — tool occupies its slot in the right dock column (`grid-template-columns:minmax(420px,1fr) minmax(280px,300px)`).
- **Minimized tools tray** — the existing bottom-row form of `.summary-dock`, formalized: when no docked summary is expanded, the dock becomes a bottom tray; when any is expanded it returns to the right column. No new DOM region is added.

### Layout and geometry

Tray (`.summary-dock` in row form, ≥ 706 px container width):

- `display:flex; flex-direction:row; justify-content:flex-end; align-items:center; gap:6px; padding:6px 12px 12px` (current values — keep).
- Sits inside `.summary-layout` as the bottom grid row (existing container query); does not overlay chat or composer.
- Chip order is DOM order: Project overview left, Live usage right (Live usage is always the rightmost chip — `margin-top:auto` in column form, last child in row form).
- Each chip: `flex:0 1 300px` (current); add `min-width:180px`. Height `36px` (existing `.docked-summary-toggle` `min-height:36px`).

Chip interior (`.docked-summary[data-collapsed=true] .docked-summary-toggle`, new):

- `display:flex; align-items:center; gap:8px; padding:8px 12px; min-height:36px; width:100%`.
- **Icon** (new): 16 px square, `color:var(--muted)`, `flex:none`, `aria-hidden`. Project overview → `PanelsTopLeft` (lucide). Live usage → `Activity` (lucide — same glyph as the composer launcher, keeping one identity per tool).
- **Title** `<strong>`: `font-size:14px; font-weight:550; color:var(--text); flex:0 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.
- **Summary** `.docked-summary-caption`: `font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; flex:0 0 auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis` — icon + value for usage ("1,234 input tokens"), no summary for overview.
- **Chevron**: `ChevronUp` 14 px, `color:var(--muted)`, `flex:none; margin-left:auto`. (Expanded state keeps `ChevronDown`.)
- Long title + summary: title ellipsizes first; if space remains < 56 px, summary hides (`.docked-summary-caption { min-width:56px }`, below that `display:none`).

Tray in narrow layout (< 706 px container): unchanged stacking below chat (existing `.summary-dock` rules in the `< 706 px` container query); chips keep the same interior.

### Copy

| Element | Text |
| --- | --- |
| Project overview chip title | `Project overview` (unchanged) |
| Live usage chip title | `Live usage` (unchanged) |
| Chip accessible name (collapsed) | `Expand Project overview` / `Inspect live usage` (existing `collapsedLabel` values — unchanged) |
| Expanded header accessible name | `Minimize Project overview` / `Minimize live usage` (existing `minimizeLabel` values — unchanged) |
| `title` tooltip on chip | same string as its accessible name |
| Update badge | `Update available` (existing — unchanged) |
| Keyboard reference rows | `Toggle Project overview` / `Toggle Live usage`, scope `Workspace` |

### Interactions

- **Chip click**: restores the tool — `collapsed → false`, focus moves to the expanded header disclosure (`focus({preventScroll:true})`). Whole chip is the button (existing).
- **Expanded header click**: minimizes — existing toggle; keep.
- **`Escape` inside expanded tool**: minimizes; focus moves to the chip (existing `DockedSummary` behavior — keep).
- **Chords** (new, `Workspace` scope, rebindable via `UiPreferences['keybindings']`):
  - `toggleProjectOverview` default chord `Alt+1` — toggle Project overview minimized/expanded.
  - `toggleLiveUsage` default chord `Alt+2` — toggle Live usage minimized/expanded **and** open: when Live usage is closed (`liveUsageOpen=false`), the chord opens it expanded; when expanded it minimizes; when minimized it restores.
  - Toggle press while expanded also returns focus to the tray chip (same as Escape path).
  - `aria-keyshortcuts` on the chip carries the resolved chord (`ariaShortcut(chord)` helper exists in `keyboard-bindings.ts`).
  - Dispatch site: `WorkspaceHost.tsx` global `keydown`, after existing bindings; ignore when `event.defaultPrevented`, composing, or target is editable — reuse the same guard the file already applies.
- **Composer launcher** (Activity icon, existing): unchanged — toggles Live usage open/closed, not collapsed; its `aria-pressed` already reflects open state. When Live usage is minimized-but-open the launcher stays `aria-pressed=true` (open ≠ expanded).
- **Update-while-minimized**: `expandRequest` keeps current semantics — row-layout tray shows `Update available` caption instead of auto-expanding (do not break it).
- **No tools minimized**: tray collapses to zero height; workspace takes the full width (existing `[data-summaries]`/`grid-template-columns` rules — keep).

### States

| State | Trigger | Result |
| --- | --- | --- |
| `rest` | — | surface chip, `border:1px solid var(--control-border); border-radius:12px; background:var(--surface)` (existing `.docked-summary`) |
| `hover` | pointer over chip | `background:var(--hover)` on the toggle (existing rule) |
| `focus-visible` | keyboard focus | `outline:2px solid var(--ui-focus-ring); outline-offset:-2px` (existing) |
| `update-pending` | `expansionPending` | caption swaps to `Update available` (existing `role="status"`) |
| `update-pending` + hover/focus | — | same as above; caption stays |
| `closed` (usage only) | `liveUsageOpen=false` | chip absent entirely; tray may hold only the overview chip |
| `disabled` | none | no disabled state — a minimized tool is always restorable |
| `long title/summary` | measured | title ellipsizes, summary hides under 56 px (see geometry) |
| `both minimized` | — | two chips, right-aligned, 6 px gap |
| `one expanded` | — | tray dissolves to column; the remaining minimized chip stays a 36 px header in the column |

### Motion

- **Chip enters tray** (tool minimized): fade + rise — `opacity 0→1`, `translateY(4px→0)`, `var(--ui-motion-insert) 180ms var(--ui-ease-enter)`. Implement on `.docked-summary` entering `data-collapsed=true` in row layout via a CSS `@keyframes`; single-element animation, no choreography needed (one moving part per gesture).
- **Body collapse**: `docked-summary-content` → `hidden`+`inert` (existing instant swap); chevron `rotate(0→180deg)` over `var(--ui-motion-panel-exit) 180ms var(--ui-ease-enter)` (existing transition — keep).
- **Restore**: body appears; the header chip itself does not move (same element persists, no FLIP). Body content fade: reuse `.floating-window-body` pattern — `opacity 0→1` over `var(--ui-motion-hover) 120ms var(--ui-ease-enter)`.
- **Grid/column reflow**: instant (no transition on `grid-template-columns`) — matches current behavior.
- **Focus**: `preventScroll` on all programmatic focus (existing convention).
- **`prefers-reduced-motion:reduce`**: no translate, no fade, no chevron rotation (instant); tray/dock swaps are instant. Extend the existing reduce block in `summary-dock.css`.
- **Full motion off** (`data-panel-animations` policy, if the app honors it here): same as reduced motion — settle instantly mid-flight, no reversal animation.

### Persistence

- Collapsed: keep `harness:summary:{id}:v1` `{"collapsed":boolean}` via existing `writeSummaryCollapsed`/`readSummaryCollapsed` (also reads legacy `harness:floating:{id}:v1` — keep).
- **New** — Live usage open: `harness:task-tool-open:usage:v1` `{"open":boolean}`.
  - Write on every `liveUsageOpen` change (same try/catch-tolerant pattern as `writeSummaryCollapsed`).
  - Read once at `useState` init in `App.tsx`; malformed/absent → `false`.
  - Opening restores to the persisted collapsed value, i.e. open ∧ collapsed → tray chip.
- Project overview open: unchanged (`planVisibility` per-thread; not persisted).
- Storage blocked or quota errors: keep current silent-fallback convention (in-memory state only).

## EXECUTION_DAG

| ID | Goal | Deps | Files / procedure | Done-when | Tests |
| --- | --- | --- | --- | --- | --- |
| T01 | Tray chip interior: icon + ellipsized title + bounded summary | — | `packages/ui-shell/SummaryDock.tsx` (add icon slot via `DockedSummaryProps.icon`), `packages/ui-shell/summary-dock.css` (chip interior rules, `min-width:180px`, caption `min-width:56px`+hide), icon params at the two call sites | Chips render icon/title/summary/chevron at specified metrics; long title ellipsizes | `tests/split-workspace-renderer.test.ts` or a new summary-dock render test |
| T02 | Restore affordance semantics: tooltip, `aria-keyshortcuts`, focus handoff to expanded header on chip restore | T01 | `SummaryDock.tsx` (`title` attr = collapsed label; `aria-keyshortcuts` prop passthrough; focus the disclosure after expand-by-click) | `title` and `aria-keyshortcuts` present; after chip click, `document.activeElement` is the expanded disclosure | extend T01 test with focus assertion |
| T03 | Keyboard bindings `toggleProjectOverview`/`toggleLiveUsage` (Alt+1/Alt+2) with toggle semantics | T02 | `keyboard-bindings.ts` (two `Workspace`-scope entries with `preference`), preferences type/defaults, `WorkspaceHost.tsx` dispatch (chord toggles target tool; usage chord opens closed tool), `App.tsx` wiring of the toggle calls | Chords toggle per spec; rebinding via preferences works; editable-field targets ignored | `tests/keyboard-bindings.test.ts` registry assertions + handler-level test |
| T04 | Live usage open persistence `harness:task-tool-open:usage:v1` | — | `App.tsx` `liveUsageOpen` initializer + write effect (try/catch) | Reload restores open+collapsed combination; malformed value → closed | unit test of the read/write helper (co-locate with T03 preference helpers or `shell-layout.ts`) |
| T05 | Chip entrance/fade motion + reduced-motion block | T01 | `summary-dock.css` (`@keyframes` chip-in 180 ms ease-enter; body fade 120 ms; extend reduce block) | Animation runs once per minimize; `prefers-reduced-motion` produces instant swap | visual check in browser test or manual screenshot evidence |
| T06 | Discovery: registry/Settings inventory + affected tests | T03 | `settings-inventory.ts` audit (does a new keybinding preference need an inventory row? follow the file's own convention); grep tests asserting `.summary-dock` row layout and update | No stale assertions; settings surfaces list the new bindings if the convention requires | `pnpm exec vitest run` on touched test files |

Parallelizable: T04 independent of T01–T03; T01→T02→T03 and T04 can run as two scopes. T05 after T01; T06 after T03.

## VALIDATION

- Lint/typecheck: `pnpm lint && pnpm typecheck` — clean.
- Unit: `pnpm exec vitest run tests/keyboard-bindings.test.ts` (+ whichever summary/split test files T06 finds); new persistence helper test.
- Browser: fixture host + Vite per repo environment (`node --import tsx` review host on :4317 + `vite` on :5173). Manual/recorded checks:
  1. Expand both tools → minimize overview (click) → chip in tray bottom-right, 36 px, icon+title+chevron, tooltip on hover.
  2. Minimize usage via `Escape` → focus lands on its chip; chips right-aligned with 6 px gap.
  3. `Alt+1` → overview restores, focus on its header; `Alt+1` again → re-minimizes.
  4. `Alt+2` with usage closed → opens expanded; `Alt+2` → minimizes; `Alt+2` → restores.
  5. Reload → minimized states persist; closed-usage + reload → stays closed.
  6. Narrow window (< 706 px owner) → tray stacks below chat, same chips.
  7. Reduced-motion emulation → all transitions instant.
- Acceptance matrix: every REQUIREMENTS row ↔ T-id ↔ a numbered check above.
- Release gate: docs-only PR merged is the deliverable for this planning task; implementation follows the DAG in a later session.

## STATE

- Researched/decided: everything in DESIGN — geometry, copy, interactions, motion, persistence keys.
- Implemented: nothing (planning-only task; no app code changed).
- Verified: repo map entries by direct reads at baseline SHA.
- Pending/risks: whether `settings-inventory.ts` needs an entry for new keybinding preferences (T06); test files asserting tray layout (T06); `PanelsTopLeft` icon choice is a single-point decision — any 16 px lucide panel glyph is acceptable if it is absent from the icon set.
- Next step: implement T01–T06 on a fresh branch from `main` after the docs-only PR lands.

## REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/590
- `AGENTS.md` plan-publication contract; `DESIGN.md` dock/header/tool-minima rules
- `packages/ui-shell/SummaryDock.tsx`, `packages/ui-shell/summary-dock.css`, `packages/ui-shell/tokens.css`, `apps/web/src/App.tsx`, `apps/web/src/UsageFooter.tsx`, `apps/web/src/keyboard-bindings.ts`, `apps/web/src/WorkspaceHost.tsx`, `apps/web/src/shell-layout.ts`
