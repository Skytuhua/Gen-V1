# Plan: Correct the Diff surface "Current" tab empty-state copy

## META
- Feature: Diff surface empty-state copy per tab
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-21 (design fully specified — implementer makes no design choices)
- Baseline: main @ 4ca1134ae1e4f354064457cb5664b545712da4a9
- Status: planning complete, implementation NOT started
- Source: manual QA of built fixture app on :4317

## OBJECTIVE
The Diff surface has two tabs: `Current` and `Recorded`. The `Current` tab shows the empty-state message `No recorded diffs` — the Recorded tab's copy. "Current" means uncommitted working-tree changes, not recordings, so the copy is wrong and confuses which tab the user is on. Success: each tab's empty state names what it would show.

## REQUIREMENTS
- `Current` tab empty state: heading text `No current changes`; one supporting line `Changes in the connected folder appear here.` Both lines centered, existing empty-state styles (`.empty`/muted text, 12px, `color:var(--muted)`), vertical center `min-height:120px` same as sibling empty states.
- `Recorded` tab keeps `No recorded diffs` unchanged.
- When no project is connected, the connect-folder notice (see related issue on `ConnectFolderNotice`) replaces both empty states — no copy change in that state.
- No layout, spacing, or styling changes other than the two text strings.

## REPO_MAP
- `apps/web/src/WorkspacePanelBodies.tsx` / `WorkspaceSurfaceBody.tsx` — Diff surface body; Current/Recorded tab switch and its empty-state string (discovery: exact component and i18n/string literal location).

## DESIGN
- String change only. `Current` empty: `No current changes` + subline `Changes in the connected folder appear here.` `Recorded` empty: unchanged. Nothing else edits.

## EXECUTION_DAG
- T01: Change the `Current` tab empty-state string to `No current changes` and add the subline using the existing empty-state element structure. Done when the literal `No recorded diffs` no longer renders on the Current tab.
- T02: Fixture verify both tabs on :4317. Depends T01.

## VALIDATION
- Serve fixture on :4317; open Diff surface; `Current` reads `No current changes` + subline; `Recorded` still reads `No recorded diffs`. No other diffs in the render.

## STATE
- Verified: Current tab shows `No recorded diffs` on main @ 4ca1134.
- Not implemented.

## REFERENCES
- QA pass 2026-11-21, :4317, Diff surface.
