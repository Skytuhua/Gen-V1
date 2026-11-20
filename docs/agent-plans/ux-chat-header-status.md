# Plan: Trim redundant chat-header status string

## META
- Feature: Chat header status line
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-20
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
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

## DESIGN
Status line becomes `{env badge} · {state}` (e.g. "Local UI demo · Ready"). Project moves solely to the breadcrumb. If multiple env flags exist, join them inside the single badge tooltip instead of the visible string.

## EXECUTION_DAG
- T01: Locate status-string builder; remove project duplication and fixture segment. done-when: header shows ≤2 segments.
- T02: Verify all seeded scenarios render the trimmed status.
- T03: Screenshot before/after.

## VALIDATION
- Fixture: open 2+ threads; header shows short status; breadcrumb still shows project.
- No test regressions.

## STATE
- Researched: ss_76f7d0be.png, audit-01/02. Implemented: nothing. Next: T01.

## REFERENCES
- Audit screenshots showing the long status line.
