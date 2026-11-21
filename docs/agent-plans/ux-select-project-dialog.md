# Plan: Fix ambiguous selection indicator and naming in project dialogs

## META
- Feature: Select/Connect project dialog clarity
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1136
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
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

## DESIGN SPEC (exact values — no design choices left)

**Selection vs status marks** (`.project-picker-option`, min-height 32px, `padding:6px 8px`, gap 8px, `border-radius:4px`)
- ✓ check: only on the row with `aria-selected="true"` — lucide `Check` 14px, `color:var(--accent)`, right-aligned (`margin-left:auto`).
- Status dot: 6×6px circle `background:var(--success)` for connected/active project, `aria-label="connected"` on the span — never read as selection. If a row is both selected and connected, show dot then ✓ in that order.
- Focused (keyboard-active) row: `outline:2px solid var(--ui-focus-ring,#808080);outline-offset:-2px` (`data-active=true` pattern) — no ✓, no background change; selected row background `var(--selection-bg)`; hover `var(--hover)`.
- `No project` row follows identical rules (✓ only when actually selected).
- `Recent` badge unchanged: 10px `var(--muted)`.

**Dialog title by intent**
- `ProjectPicker` gains optional `title` prop, default `Select project`.
- Sidebar `Connect project` button opens it with `title="Connect project"` and primary hint text unchanged otherwise; composer chip and New thread keep `Select project`.
- Dialog chrome: `.dialog` width 440px, `max-width:calc(100vw - 32px)`, padding 22px, `border:1px solid var(--border)`, `border-radius:16px`, `background:var(--surface)`, `box-shadow:var(--elevation)`; header 14px weight 500 `var(--text)`; close × `.icon-button` `lucide-x` `var(--danger)` on hover `var(--danger-soft)` bg.
- Footer hint unchanged: `↑↓ navigate · Enter select · Esc cancel`, 10px `var(--muted)`.

## DESIGN
Use the ✓ for current selection only; move connected/active status to a colored dot with aria-label "connected" that is not read as selection. If a row can be both, ✓ wins. Pass an optional `title`/`intent` prop from the launch button.

## EXECUTION_DAG
- T01: Read ProjectPicker; separate selection-mark vs status-mark. done-when: only the real selected project shows ✓.
- T02: Title/intent prop wired from entry points. done-when: Connect shows connect-oriented title.
- T03: a11y pass — aria-checked/aria-current correct.
- T04: Screenshots.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- Fixture: open via composer chip, Connect project, New thread; verify marks and titles.
- Keyboard: arrow navigation doesn't move the ✓.

## STATE
- rev 2: full design spec added.
- Researched: /tmp/audit/07-new-thread.png, /tmp/audit/08-connect-project.png. Implemented: nothing. Next: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1136 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit screenshots: 07, 08 (identical dialog from two different buttons).
