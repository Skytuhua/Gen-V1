# Plan: Remove duplicate Refresh buttons in Usage dialog empty state

## META
- Feature: Usage dialog empty state
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-20
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
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

## DESIGN
When usage data is empty, hide the header Refresh (or render only the centered empty-state action). One-line conditional; no new components unless an EmptyState helper already exists — then use it.

## EXECUTION_DAG
- T01: Conditional-render so only one Refresh shows in empty state. done-when: DOM contains one button named Refresh in empty state and one in populated state.
- T02: Screenshot empty + populated states.

## VALIDATION
- Fixture: open Usage from sidebar; confirm one Refresh in empty state.
- If a fixture path exists for populated usage, check there too; otherwise unit/DOM check.

## STATE
- Researched: ss_a0a27405.png. Implemented: nothing. Next: T01.

## REFERENCES
- Audit screenshot: ss_a0a27405.png (Usage dialog with two Refresh buttons).
