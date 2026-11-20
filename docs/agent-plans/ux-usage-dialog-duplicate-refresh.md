# Plan: Remove duplicate Refresh buttons in Usage dialog empty state

## META
- Feature: Usage dialog empty state
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1137
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app on :4317

## OBJECTIVE
The Usage dialog renders a "Refresh" button in its header and a second identical "Refresh" inside the empty-state body. Two same-labeled controls in one dialog is confusing and redundant. Success: exactly one refresh affordance per dialog state.

## REQUIREMENTS
- Keep a single Refresh action: header Refresh while content is present; empty state may keep its inline Refresh only if the header one is hidden when empty (pick one consistent rule).
- No behavior change to what Refresh does.
- Match the codebase's existing dialog-empty-state conventions.

## REPO_MAP
- `apps/web/src/UsageDialog.tsx` — verified: contains the dialog, header Refresh, and empty-state markup with a second Refresh.
- Discovery: shared EmptyState component if present (`rg "Empty" apps/web/src -g '*.tsx'`).

## DESIGN SPEC (exact values — no design choices left)

**Decision:** the header `Refresh` is the single refresh control in every state; the empty-state copy contains no second button.

- Header Refresh: `.secondary` button, `min-height:var(--settings-row-height)`, `border-radius:var(--control-radius)`, font-size 12px, right-aligned in the dialog header. States: hover `background:var(--hover)`; `:focus-visible` 2px `var(--ui-focus-ring)` outline; `:disabled` (while fetching) `opacity:.5`.
- Empty state (replaces the second Refresh): centered block — `.empty-symbol` 34×34px `var(--muted)` icon + `<p>` 14px `var(--muted)` `margin-top:12px;line-height:1.8` text: `No usage recorded yet.`; below it a `var(--muted)` 12px hint `Usage appears after the first model request.`
- Populated state unchanged except the single header Refresh stays.
- Dialog chrome unchanged: `.dialog` width 440px, `max-width:calc(100vw - 32px)`, padding 22px, `border:1px solid var(--border)`, `border-radius:16px`, `background:var(--surface)`, `box-shadow:var(--elevation)`.

## DESIGN
Implement exactly the DESIGN SPEC decision: header Refresh is the single control in every state; the empty state shows icon + message + hint only. One-line conditional on the empty-state body; no new components unless an EmptyState helper already exists — then use it.

## EXECUTION_DAG
- T01: Conditional-render so only one Refresh shows in empty state. done-when: DOM contains one button named Refresh in empty state and one in populated state.
- T02: Screenshot empty + populated states.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- Fixture: open Usage from sidebar; confirm one Refresh in empty state.
- If a fixture path exists for populated usage, check there too; otherwise unit/DOM check.

## STATE
- rev 2: full design spec added.
- Researched: ss_a0a27405.png. Implemented: nothing. Next: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1137 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit screenshot: ss_a0a27405.png (Usage dialog with two Refresh buttons).
