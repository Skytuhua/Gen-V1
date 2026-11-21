# Plan: Unify secondary-surface container behavior (panels vs dialogs vs popovers)

## META
- Feature: Consistent containers for auxiliary surfaces
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1133
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app on :4317

## OBJECTIVE
Auxiliary surfaces behave inconsistently: "Linked pull requests" opens as a docked split area (drag/dock chrome), "Settings" and "Usage" open as modal dialogs, project/model pickers are popovers, and "Project overview" is a collapsed strip in the right column. Users can't predict where a feature opens or how to dismiss it. At ≤700px the docked PRs panel consumes ~half the screen and squeezes the chat. Success: one documented pattern per surface class + responsive behavior.

## REQUIREMENTS
- Define and apply a rule: persistent contextual panels → docked areas; focused forms/config → dialogs; lightweight single-choice → popovers. Choose one target class per surface and document the decision in the PR.
- Candidates: PRs and Project overview are both "project context" — unify (both docked or one tabbed inside the other). Usage and Settings dialogs are fine together.
- Responsive: below a width breakpoint, docked panels must collapse to overlay/on-demand instead of halving the chat (observed at 700px).
- Keep drag-detach/dock and Layouts behavior working after rehoming surfaces.

## REPO_MAP
- `apps/web/src/WorkspacePanel.tsx`, `WorkspacePanelBodies.tsx`, `WorkspaceSurfaceBody.tsx` — docked-area system (Split this area / Move or detach / Minimize).
- `apps/web/src/UsageDialog.tsx`, settings dialog components (`Settings` nav + `AppearanceSettings.tsx`, `compact-settings-data.ts`) — modal system.
- `apps/web/src/ModelPicker.tsx`, `ProjectPicker.tsx` — popover/dialog pickers.
- `apps/web/src/App.tsx` (1210 lines) — layout orchestration; aside `Conversation summaries` holds "Project overview window".
- Discovery: layout manager and how surfaces register (drag targets, areas); viewport breakpoints.

## DESIGN SPEC (exact values — no design choices left)

**Container-class mapping (fixed decision for this plan)**
- `Linked pull requests` + `Project overview` → merge into ONE docked workspace area titled `Project`, with two tabs: `Pull requests` | `Overview`.
  - Tab row: reuse area tab pattern — `aria-selected` buttons, font-size 12px, `color:var(--muted)` unselected / `var(--text)` selected, padding `6px 8px`, selected indicator = bottom border 2px `var(--accent)`; header keeps `Split this area` `◩`, `Area actions` `⋯`, `Minimize` `▴` chrome.
  - `Project overview` body moves from the collapsed `Conversation summaries` strip into the `Overview` tab; the bottom-right collapsed strip is removed.
- `Settings`, `Usage` → modal dialogs (unchanged class): `.dialog` width 440px, `max-width:calc(100vw - 32px)`, `max-height:calc(100dvh - 50px)`, padding 22px, `border:1px solid var(--border)`, `border-radius:16px`, `background:var(--surface)`, `box-shadow:var(--elevation)`; Esc + scrim click close; scrim `background:#0006` (`.sidebar-scrim` value), z-index `var(--ui-layer-scrim)`.
- Pickers (`Select project`, model picker, task mode, menus) → popovers: `border-radius:8px`, `background:var(--surface)`, `border:1px solid var(--border)`, `box-shadow:var(--elevation)`; light-dismiss.

**Responsive rule (fixed)**
- Below 700px viewport width, docked secondary areas do NOT split: they auto-minimize to their header strip and open as overlay when summoned, using the existing drawer pattern: `position:fixed;inset:0`, scrim `#0006` `z-index:var(--ui-layer-scrim)`, panel slides `transform:translateX(0→0%)` `transition:transform var(--ui-motion-panel-enter) var(--ui-ease-enter)` (220ms), width `min(320px, 88vw)`.
- At ≤700px the chat column keeps ≥ calc(100% - 24px) when panels are closed (existing `.composer-dock` margin pattern).

**Interactions:** drag-detach/dock edge targets, `Move or detach` button, Layouts menu — unchanged after rehoming; tab switch keeps per-tab scroll position.

## DESIGN
The DESIGN SPEC mapping is the decision of record: PRs + Project overview merge into one "Project" docked area with Pull requests | Overview tabs; pickers stay popovers; Settings/Usage stay dialogs; ≤700px docked areas become drawer overlays. No further mapping decisions are left open.

## EXECUTION_DAG
- T01: Inventory surfaces + their containers; write the mapping table. done-when: mapping agreed in PR body.
- T02: Merge/tab PRs + Project overview (or chosen unification). done-when: both reachable from one surface.
- T03: Responsive collapse rule for docked areas under breakpoint. done-when: 700px shows chat usable.
- T04: Regression: drag-detach, split, minimize, Layouts menu still work; screenshots at 4 widths.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- Fixture: open each surface; confirm container per mapping; resize 1280→500px and verify collapse behavior.
- Keyboard/Esc dismissal consistent per class.

## STATE
- rev 2: full design spec added; container mapping is fixed (Project area w/ Pull requests + Overview tabs; dialogs for Settings/Usage; popovers for pickers; ≤700px drawer behavior).
- Researched: ss_82c5efa7.png (All Agents), ss_ff37eacc.png, audit-05/09/10. Mapping proposed above, final mapping is PR-level decision. Implemented: nothing. Next: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1133 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit screenshots: ss_ff37eacc.png, /tmp/audit/05-project-overview.png, /tmp/audit/09-narrow-700.png.
