# Plan: Unify secondary-surface container behavior (panels vs dialogs vs popovers)

## META
- Feature: Consistent containers for auxiliary surfaces
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-20
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
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

## DESIGN
Step 1 is a decision record (in the PR): map every auxiliary surface to {docked area | dialog | popover} with rationale; only then migrate outliers. Recommended mapping to evaluate: PRs + Project overview merge into one "Project" docked area with tabs; pickers stay popovers; Settings/Usage stay dialogs. Add a `min-width` rule so docked areas auto-collapse under the breakpoint.

## EXECUTION_DAG
- T01: Inventory surfaces + their containers; write the mapping table. done-when: mapping agreed in PR body.
- T02: Merge/tab PRs + Project overview (or chosen unification). done-when: both reachable from one surface.
- T03: Responsive collapse rule for docked areas under breakpoint. done-when: 700px shows chat usable.
- T04: Regression: drag-detach, split, minimize, Layouts menu still work; screenshots at 4 widths.

## VALIDATION
- Fixture: open each surface; confirm container per mapping; resize 1280→500px and verify collapse behavior.
- Keyboard/Esc dismissal consistent per class.

## STATE
- Researched: ss_82c5efa7.png (All Agents), ss_ff37eacc.png, audit-05/09/10. Mapping proposed above, final mapping is PR-level decision. Implemented: nothing. Next: T01.

## REFERENCES
- Audit screenshots: ss_ff37eacc.png, /tmp/audit/05-project-overview.png, /tmp/audit/09-narrow-700.png.
