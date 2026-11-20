# Plan: Fix dead-end states in Linked pull requests panel

## META
- Feature: Linked PRs panel empty/disconnected state UX
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-20
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app on :4317

## OBJECTIVE
The panel shows "Connect this project to a local folder." in red error styling but the text is not clickable and gives no path to act. "New draft PR" is disabled with no explanation. Users hit a dead end twice. Success: every blocked action explains why and offers the next step.

## REQUIREMENTS
- "Connect this project to a local folder." must be a button/link that opens the existing connect-project flow (the same one the sidebar "Connect project" button and the composer's Select project dialog use), or restyle it as neutral info text if it is purely informational. Red is reserved for errors.
- "New draft PR" disabled state needs an inline reason (tooltip already common in this codebase — e.g. Saved drafts explains itself) plus a link to the unblock action (connect folder / sign in).
- The same red dead-end text also appears in the expanded "Project overview" panel — fix both occurrences consistently (shared component if one exists).
- "Sign in to GitHub" and "Link a pull request by number" behaviors unchanged.

## REPO_MAP
- `apps/web/src/WorkspacePanelBodies.tsx`, `apps/web/src/WorkspaceSurfaceBody.tsx`, `apps/web/src/WorkspacePanel.tsx` — right-panel bodies; PRs panel renders "Linked pull requests", Refresh, New draft PR, Sign in to GitHub, link-by-number form.
- `apps/web/src/ShellSidebar.tsx` — "Connect project" button (verified aria-label) whose handler is the reuse target.
- `apps/web/src/ProjectPicker.tsx` — Select project dialog opened by that flow.
- Discovery: exact component file for the PR list body; whether a shared `ConnectProjectPrompt` exists.

## DESIGN
Make the notice a `ConnectFolderNotice` component (message + primary "Connect folder" action + secondary "Learn more" if docs exist). Reuse it in Linked pull requests and Project overview. Change color token from error/danger to accent or neutral. New draft PR gets `title`/`aria-describedby` reason text consistent with the disabled Saved-drafts pattern already shipped.

## EXECUTION_DAG
- T01: Locate PR-panel body component and the connect-project handler; extract/reuse ConnectFolderNotice. done-when: clicking the text opens the connect flow.
- T02: Swap error styling for actionable/neutral styling in both panels. done-when: no red text unless an actual error occurred.
- T03: Disabled-reason tooltip on New draft PR (+ Link button if it needs a folder too). done-when: hover/focus reveals why.
- T04: Screenshots before/after on :4317 fixture; run related tests.

## VALIDATION
- Fixture: open Linked pull requests and Project overview; click the notice → connect flow opens; New draft PR explains itself; no red styling remains.
- Keyboard: notice reachable by Tab, activates with Enter.

## STATE
- Researched: DOM + screenshots ss_ff37eacc.png, audit-05. Decided above. Implemented: nothing. Next: T01.

## REFERENCES
- Audit screenshots: ss_ff37eacc.png (PRs panel), /tmp/audit/05-project-overview.png (duplicate red text).
