# Plan: Anchor model-picker popover within the composer instead of overlapping the sidebar

## META
- Feature: Model picker popover positioning
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1135
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app on :4317

## OBJECTIVE
Opening the model picker renders a wide popover whose left edge extends past the chat column and floats over the sidebar thread list, visually attaching to unrelated UI. Success: the popover is clamped to the chat/composer bounds (or right-anchored to its trigger) so it never covers navigation.

## REQUIREMENTS
- Popover must not paint over the sidebar at any supported viewport (check ~900px and ~1280px widths).
- Keep full option list readable; don't shrink content to fix it — reposition.
- Same fix should apply to sibling popovers opened from the composer row if they share positioning logic.

## REPO_MAP
- `apps/web/src/ComposerToolbar.tsx` — mounts `<ModelPicker>` inside `composer-runtime-controls` (line ~82).
- `apps/web/src/ModelPicker.tsx` — popover implementation (verified exists).
- Discovery: shared popover/anchoring utility (`rg -l "popover|anchor" apps/web/src`).

## DESIGN SPEC (exact values — no design choices left)

**Popover placement and box**
- Anchor: right edge of the model-picker trigger button; `position:absolute; top:calc(100% + 6px); right:0` relative to `.model-picker` (already `position:relative`).
- Width: `min(340px, max(240px, 100vw - sidebarRightEdge - 32px))`; practical rule: `width:340px; max-width:calc(100% - 16px)` of the chat column, and clamp `left` so `popoverRect.left >= chatColumnRect.left + 8` — implement as a collision check that shifts left edge when it would cross into the sidebar (flip is not acceptable: the composer is bottom-docked, open upward as today).
- Box: `background:var(--surface)`, `border:1px solid var(--border)`, `border-radius:8px`, `box-shadow:var(--elevation)`, `max-height:320px`, `overflow-y:auto`, z-index above composer but below scrim layers (use existing popover layer token if present — discovery: `--ui-layer-*` in styles.css).
- Option rows (match `.project-picker-option`): `display:flex;align-items:center;gap:8px;width:100%;min-height:32px;padding:6px 8px;border-radius:4px;font:inherit`.
- States: `:hover` → `var(--hover)`; `aria-selected=true` → `background:var(--selection-bg)`; keyboard `[data-active=true]` → `outline:2px solid var(--ui-focus-ring);outline-offset:-2px`; Enter/exit animations `ui-popover-fade var(--ui-motion-press)` (80ms).
- Verify at 1280px (sidebar open), 900px, 700px (drawer sidebar), 500px — popover never covers `.sidebar`.

## DESIGN
Implement exactly the DESIGN SPEC: right-anchor to the trigger, open upward, clamp left edge to the chat column (no flip). If a shared popover primitive exists, implement the collision clamp there so all users benefit; otherwise apply it in ModelPicker.

## EXECUTION_DAG
- T01: Find popover positioning code in ModelPicker/shared primitive. done-when: root positioning logic identified.
- T02: Add boundary clamp or right-anchored placement. done-when: popover left edge ≥ sidebar right edge at 900/1280px.
- T03: Verify no regression in narrow layout (700px, 500px) and when sidebar is collapsed.
- T04: Screenshots before/after.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- Fixture: open model picker at 1280px and 900px viewport; left edge must not cross the sidebar boundary.
- Keyboard open (if supported) shows same placement.

## STATE
- rev 2: full design spec added.
- Researched: ss_e59042e2.png (overlap visible). Implemented: nothing. Next: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1135 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit screenshot: ss_e59042e2.png.
