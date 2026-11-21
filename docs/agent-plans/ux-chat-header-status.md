# Plan: Trim redundant chat-header status string

## META
- Feature: Chat header status line
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1138
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app on :4317

## OBJECTIVE
The chat header prints "Local UI demo · no model inference · recording fixture · UI review recordings · R…" — four dot-separated segments, and the project name "UI review recordings" is already in the breadcrumb directly above it. Long status text pushes and truncates, duplicating information. Success: one concise status; project shown once.

## REQUIREMENTS
- Remove the duplicated project name from the status string when it equals the breadcrumb project.
- Keep the meaningful state segment (e.g. "Ready", "Working…") and environment badge ("Local UI demo") but deduplicate/redact fixture-internal segments like "recording fixture" from user-facing chrome, or collapse all env info into one badge.
- Keep Find-in-conversation and History buttons untouched.

## REPO_MAP
- `apps/web/src/WorkspaceSurfaceBody.tsx` / `WorkspacePanelBodies.tsx` — chat header composition (verified: header contains breadcrumb + status string).
- `apps/web/src/App.tsx` — supplies status/model labels.
- Discovery: the exact element rendering the `·`-joined status (`rg "Ready" apps/web/src` + status builder).

## DESIGN SPEC (exact values — no design choices left)

**Header layout** (unchanged structure: breadcrumb → status → actions)
- Breadcrumb: `.breadcrumb` — `display:flex;align-items:center;gap:9px;font-size:12px;color:var(--muted)`; project segment stays, `strong` = thread title `var(--text)` weight 500, ellipsis.
- Status string: single element after breadcrumb — `{envLabel} · {stateLabel}` at font-size 11px, `color:var(--muted)`, `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, `max-width:40%` of the header row.
- `{envLabel}` = one badge only: `Local UI demo` for the fixture; in real builds it is the existing env/runtime label (do not add "no model inference" / "recording fixture" as separate `·`-segments — join them into the env badge's `title` tooltip instead).
- `{stateLabel}` = existing state (`Ready`, `Working…`, etc.).
- Project name is removed from the status string when it equals the breadcrumb project segment.
- Find-in-conversation and History buttons keep `.icon-button` (var(--ui-row-compact)) and `.secondary` styling respectively; no visual change.
- States/transitions unchanged: `connection-state` pending color `var(--pending)` 11px when not ready.

## DESIGN
Status line becomes `{env badge} · {state}` (e.g. "Local UI demo · Ready"). Project moves solely to the breadcrumb. If multiple env flags exist, join them inside the single badge tooltip instead of the visible string.

## EXECUTION_DAG
- T01: Locate status-string builder; remove project duplication and fixture segment. done-when: header shows ≤2 segments.
- T02: Verify all seeded scenarios render the trimmed status.
- T03: Screenshot before/after.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- Fixture: open 2+ threads; header shows short status; breadcrumb still shows project.
- No test regressions.

## STATE
- rev 2: full design spec added.
- Researched: ss_76f7d0be.png, audit-01/02. Implemented: nothing. Next: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1138 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit screenshots showing the long status line.
