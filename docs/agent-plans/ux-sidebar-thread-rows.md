# Plan: De-clutter sidebar thread rows (project label repetition, a11y name, grouping)

## META
- Feature: Sidebar thread list UX cleanup
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-20
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app served by `scripts/review-host.ts` on :4317

## OBJECTIVE
Every row in the thread sidebar renders the project avatar ("UR") plus the full project name "UI review recordings", so a list of same-project threads repeats the label 9 times and truncates thread titles. Screen readers announce "URUI review recordings" as one word. Users cannot scan titles quickly. Success: the list is scannable, titles get max width, accessible names are correct.

## REQUIREMENTS
- Show the project chip once per group (or only when a row's project differs from neighbors), not per row.
- Accessible name must be the thread title (+ status), never avatar initials concatenated with project name.
- Keep existing status indication, unread/pin affordances, hover actions, and drag-to-pin.
- Optional: group rows by recency (Today / Earlier) or by project; pick whichever the codebase already supports cheapest. Mark as a design choice in the PR.
- Compact density default stays compact (S prefers compact UI).

## REPO_MAP
- `apps/web/src/ShellSidebar.tsx` (506 lines) — renders `nav[aria-label="Threads"]`, the `Pinned` section, filter ("Filter: all..."), and rows. Verified: row markup emits `<span>{initials}{projectName}</span>` producing "URUI review recordings".
- `apps/web/src/App.tsx` — passes thread/project data into the sidebar.
- Discovery: CSS module/class names for rows; whether grouping helpers already exist.

## DESIGN
Group rows under a single project header (avatar + name) when consecutive threads share a project; inside a row show only status dot/label + title + time. Fix a11y: put the avatar initials in `aria-hidden` span and set `aria-label="{title}, {status}"` on the button. Filter indicator: when the "working" filter is active, show a persistent visible chip ("Filtering: working · clear") instead of only a small blue dot — currently the whole list empties with a nearly invisible state change.

## EXECUTION_DAG
- T01: Restructure row markup + project grouping in ShellSidebar.tsx. done-when: same-project rows render one shared header; diff shows per-row label removed.
- T02: Fix row aria-label and aria-hide initials. done-when: accessible name reads title+status only (verify via DOM or axe).
- T03: Visible active-filter chip + clear action. done-when: toggling filter shows/hides the chip.
- T04: Screenshots light/dark + compact density; update any sidebar tests/snapshots.

## VALIDATION
- `pnpm build` and fixture host on :4317; visually verify 9 seeded threads group under one project header.
- Keyboard/screen-reader name check via DOM inspection.
- Run existing web tests touching the sidebar if present (discovery: `rg ShellSidebar apps/web -g '*test*'`).

## STATE
- Researched: DOM + screenshots (see REFERENCES). Decided: grouping + a11y fix + filter chip. Implemented: nothing. Next step: T01.

## REFERENCES
- Audit evidence: screenshots ss_8023892c.png (sidebar), ss_88934711.png; DOM dump confirms `aria-label="Workspace & settings Ready"` + inner "URUI review recordings".
- AGENTS.md plan-publication contract (repo root).
