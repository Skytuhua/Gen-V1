# Plan: Extend the connect-folder notice to workspace surface bodies (Terminal, Files, Diff, Pull request)

## META
- Feature: Consistent actionable prerequisite notice on workspace surfaces
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-21 (design fully specified — implementer makes no design choices)
- Baseline: main @ 4ca1134ae1e4f354064457cb5664b545712da4a9
- Related: #1131 (`ux-linked-prs-dead-end`) already fixes the same notice inside the Linked pull requests panel and Project overview; this issue covers the remaining occurrences in the docked workspace surface bodies.
- Status: planning complete, implementation NOT started
- Source: manual QA of built fixture app on :4317 (UI review recordings project)

## OBJECTIVE
When a thread has no connected local project, the workspace surface bodies for Terminal, Files, Diff and Pull request each render the line `Connect this project to a local folder.` styled as red error text (`--danger`) with no action. The same sentence appears in Project overview as neutral gray info text. A prerequisite that is not an error is styled like an error, styled differently in different surfaces, and gives the user no way to resolve it. Success: one shared notice component, consistent styling, and a click-through to the existing connect-project flow everywhere it appears.

## REQUIREMENTS
- Reuse the `ConnectFolderNotice` component specified in #1131 (`docs/agent-plans/ux-linked-prs-dead-end.md`, DESIGN SPEC) verbatim — same container, padding `6px 10px`, gap `8px`, `min-height:var(--settings-row-height)`, folder-plus icon 14px `var(--muted)`, label 12px `var(--text)`, trailing `›` 12px `var(--muted)`, hover `background:var(--hover)`, focus-visible `outline:2px solid var(--ui-focus-ring,#808080);outline-offset:1px`, transition `background-color var(--ui-motion-hover) var(--ui-ease-move)`.
- Click action: the same handler the sidebar `Connect project` button calls (opens the existing connect-project flow).
- The red `.error-text` styling is removed from this notice on every surface it appears on: Terminal, Files, Diff, Pull request, Linked pull requests, Project overview. `--danger`/`--danger-fg` is reserved for actual errors.
- Surfaces whose real body needs the project (terminal emulation, file listing, diff list, PR list) keep their own body unreachable until a project is connected: the notice is the whole body content, vertically centered (`display:flex;align-items:center;justify-content:center;min-height:120px`), same as current empty-state placement.
- If a surface already shows the notice through a shared prerequisite component, convert that component rather than duplicating.

## REPO_MAP
- `apps/web/src/WorkspaceSurfaceBody.tsx`, `WorkspacePanelBodies.tsx` — surface bodies for Terminal, Files, Diff, Pull request; the red prerequisite line is rendered here (discovery: exact per-surface render function).
- `apps/web/src/ShellSidebar.tsx` — `Connect project` button (aria-label verified); its handler is the reuse target.
- `apps/web/src/ProjectPicker.tsx` — dialog opened by that flow.
- `docs/agent-plans/ux-linked-prs-dead-end.md` — canonical spec for `ConnectFolderNotice`; if that component lands first (its own issue), import it; otherwise implement it here once and let #1131 consume it.

## DESIGN
- New shared component `ConnectFolderNotice` (values copied from #1131 spec, above). Props: none; it reads the connect-project handler from the same context/prop the sidebar uses.
- Each gated surface body becomes: `project ? <SurfaceBody/> : <div class="surface-prerequisite"><ConnectFolderNotice/></div>`.
- No new tokens, no new colors, no copy change (the sentence `Connect this project to a local folder` stays, now as a button label).

## EXECUTION_DAG
- T01: Add `ConnectFolderNotice` in the shared location used by `WorkspacePanelBodies.tsx` (or the file #1131 names). Done when component compiles and matches spec values.
- T02: Replace the red prerequisite render on Terminal, Files, Diff, Pull request bodies with the notice. Depends T01. Done when no `.error-text`/`--danger` remains for this line and click opens connect-project flow in fixture.
- T03: Browser-verify on :4317 with an unconnected project: all four surfaces show the button; hover/focus states work; Enter activates it. Depends T02.

## VALIDATION
- `pnpm build:widgets` + `vite build`, serve fixture on :4317; open a thread with no connected project; open Terminal, Files, Diff, Pull request surfaces; confirm notice renders once, styled per spec, and click opens the connect-project flow.
- Regression: Project overview + Linked PRs panel still show the same component (coordinate with #1131 — whichever lands second adopts the shared component).

## STATE
- Researched/verified: red error-styled line on Terminal, Files, Diff, Pull request bodies; gray info text in Project overview; no click target anywhere.
- Not implemented.

## REFERENCES
- #1131 plan file `docs/agent-plans/ux-linked-prs-dead-end.md` (component spec source).
- Fixture evidence: QA pass 2026-11-21, :4317.
