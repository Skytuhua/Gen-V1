# Plan: Fix ambiguous selection indicator and naming in project dialogs

## META
- Feature: Select/Connect project dialog clarity
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-20
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app on :4317

## OBJECTIVE
Two problems in the same flow: (1) In "Select project", "No project" carries a ✓ checkmark while the actually-selected project "UI review recordings" shows a green dot — two different marks compete and the check suggests "No project" is chosen. (2) The sidebar "Connect project" button and "New thread" both open a dialog titled "Select project", which mismatches the action the user clicked. Success: one unambiguous selected marker; dialog title matches entry point intent.

## REQUIREMENTS
- Exactly one indicator marks the currently selected project (keep the check convention or the dot, not both); the focused row must not look selected.
- Keyboard focus ring distinct from selection mark; keep ↑↓/Enter/Esc hints.
- Dialog title follows the launching action where the codebase supports it ("Connect project" from Connect button); otherwise one consistent title with clear copy. "No project" option stays.
- Recent badge behavior unchanged.

## REPO_MAP
- `apps/web/src/ProjectPicker.tsx` (131 lines) — the Select project dialog: search field, "No project" row w/ check, project rows w/ dot + "Recent".
- `apps/web/src/ShellSidebar.tsx` — "Connect project" + "New thread" buttons that open it.
- `apps/web/src/ComposerToolbar.tsx` — composer project chip entry point.
- Discovery: whether the same dialog is reused for connect vs select (likely), and where titles are set.

## DESIGN
Use the ✓ for current selection only; move connected/active status to a colored dot with aria-label "connected" that is not read as selection. If a row can be both, ✓ wins. Pass an optional `title`/`intent` prop from the launch button.

## EXECUTION_DAG
- T01: Read ProjectPicker; separate selection-mark vs status-mark. done-when: only the real selected project shows ✓.
- T02: Title/intent prop wired from entry points. done-when: Connect shows connect-oriented title.
- T03: a11y pass — aria-checked/aria-current correct.
- T04: Screenshots.

## VALIDATION
- Fixture: open via composer chip, Connect project, New thread; verify marks and titles.
- Keyboard: arrow navigation doesn't move the ✓.

## STATE
- Researched: /tmp/audit/07-new-thread.png, /tmp/audit/08-connect-project.png. Implemented: nothing. Next: T01.

## REFERENCES
- Audit screenshots: 07, 08 (identical dialog from two different buttons).
