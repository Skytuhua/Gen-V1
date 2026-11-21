# Plan: Fix dead-end states in Linked pull requests panel

## META
- Feature: Linked PRs panel empty/disconnected state UX
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1131
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
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

## DESIGN SPEC (exact values — no design choices left)

**`ConnectFolderNotice` component** (used in Linked pull requests body and Project overview)
- Container: full-width button, `background:var(--subtle)`, `border:1px solid transparent`, `border-radius:var(--control-radius)` (default 8px), `min-height:var(--settings-row-height)` (32 compact / 36 comfortable / 44 touch), padding `6px 10px`, `display:flex;align-items:center;gap:8px`.
- Left icon: folder-plus/lucide `FolderPlus`, 14px, `color:var(--muted)`.
- Text: `Connect this project to a local folder`, font-size 12px, `color:var(--text)`, `font:inherit`.
- Trailing: `›` chevron 12px `var(--muted)`.
- States: `:hover` → `background:var(--hover)` + text `var(--text)`; `:focus-visible` → `outline:2px solid var(--ui-focus-ring,#808080);outline-offset:1px`; transition `background-color var(--ui-motion-hover) var(--ui-ease-move)`.
- The red `.error-text` (`color:var(--danger)`) is removed from this notice in BOTH places; `--danger`/`--danger-fg` is reserved for actual errors.
- Click action: same handler the sidebar `Connect project` button calls (opens `ProjectPicker`/connect flow).

**Disabled `New draft PR`**
- Keep `.secondary` button, `min-height:var(--settings-row-height)`, `border-radius:var(--control-radius)`, font-size 12px.
- `:disabled` → `opacity:.5;cursor:not-allowed` (existing button disabled style).
- `title` + `aria-describedby` text: `Connect a local folder and sign in to GitHub to draft PRs` — mirrors the Saved-drafts explanation pattern.
- If project IS connected but GitHub isn't: reason becomes `Sign in to GitHub to draft PRs`.

**`Link` button** (by-number form): same disabled-reason tooltip when the form is inert.

## DESIGN
Make the notice a `ConnectFolderNotice` component (message + primary "Connect folder" action + secondary "Learn more" if docs exist). Reuse it in Linked pull requests and Project overview. Change color token from error/danger to accent or neutral. New draft PR gets `title`/`aria-describedby` reason text consistent with the disabled Saved-drafts pattern already shipped.

## EXECUTION_DAG
- T01: Locate PR-panel body component and the connect-project handler; extract/reuse ConnectFolderNotice. done-when: clicking the text opens the connect flow.
- T02: Swap error styling for actionable/neutral styling in both panels. done-when: no red text unless an actual error occurred.
- T03: Disabled-reason tooltip on New draft PR (+ Link button if it needs a folder too). done-when: hover/focus reveals why.
- T04: Screenshots before/after on :4317 fixture; run related tests.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- Fixture: open Linked pull requests and Project overview; click the notice → connect flow opens; New draft PR explains itself; no red styling remains.
- Keyboard: notice reachable by Tab, activates with Enter.

## STATE
- rev 2: full design spec added. Implementer executes T01–T04 verbatim.
- Researched: DOM + screenshots ss_ff37eacc.png, audit-05. Decided above. Implemented: nothing. Next: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1131 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit screenshots: ss_ff37eacc.png (PRs panel), /tmp/audit/05-project-overview.png (duplicate red text).
