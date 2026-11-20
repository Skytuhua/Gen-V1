# Plan: De-clutter sidebar thread rows (project label repetition, a11y name, grouping)

## META
- Feature: Sidebar thread list UX cleanup
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1139
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
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

## DESIGN SPEC (exact values — no design choices left)

All values reuse existing tokens/classes in `apps/web/src/styles.css`; do not invent new tokens.

**Project group header** (replaces per-row project label; render when ≥1 threads share a project)
- Reuse `.thread-group h2`: font-size 11px, font-weight 450, color `var(--muted)`, padding `7px 7px 8px`, gap 7px, letter-spacing 0.
- Left: avatar 17×17px circle (`.workflow-avatar` pattern): background `var(--subtle)`, color `var(--text)`, font-size 8px, border-radius 50%, initials centered, `aria-hidden="true"`.
- Text: project name, 11px `var(--muted)`, single line, `text-overflow:ellipsis`.

**Thread row** (`.thread-item` — keep existing box)
- Padding `10px 11px`, border-radius 8px, width 100%, margin-bottom 3px, `display:flex;flex-direction:column;gap:5px`.
- Remove the `<span>{initials}{projectName}</span>` meta line entirely.
- Line 1: title — `.thread-item-title` 12px, line-height 1.4, `var(--text)`, `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`.
- Line 2: `.thread-item-meta` — flex, space-between, `var(--muted)`, 10px: status dot 5×5px circle `var(--muted)` (`.local-status>span` pattern) + status text left, `<time>` right.
- States: `:hover` → `background:var(--hover)`; `.active` → `background:var(--hover)`; `::focus-visible` → `outline:2px solid var(--ui-focus-ring,#808080); outline-offset:1px`; transition `background-color var(--ui-motion-hover) var(--ui-ease-move)` (hover=120ms default speed).
- a11y: button `aria-label="{title}, {status}"`; remove title/status duplication inside label; initials `aria-hidden`.
- Keep insert animation `ui-item-in var(--ui-motion-insert) var(--ui-ease-enter)` (180ms).

**Active-filter chip** (when filter ≠ `all`, currently only a blue dot shows)
- Render below the search row: pill — `background:var(--subtle)`, border-radius 18px, font-size 11px, padding `7px 10px`, min-height 30px, gap 5px, `color:var(--muted)`.
- Text: `Showing {filter} threads` + trailing `×` clear button (`.icon-button`, 24px). Clicking Clear restores `all`.
- Empty filtered list keeps `.sidebar-empty` (12px, `var(--muted)`, padding `12px 9px`, line-height 1.6).

**Interaction:** click row = open thread (unchanged); drag-to-pin unchanged; hover shows existing hover actions; keyboard: Tab reaches rows, Enter opens, focus ring as above.

## DESIGN
Group rows under a single project header (avatar + name) when consecutive threads share a project; inside a row show only status dot/label + title + time. Fix a11y: put the avatar initials in `aria-hidden` span and set `aria-label="{title}, {status}"` on the button. Filter indicator: when the "working" filter is active, show a persistent visible chip ("Filtering: working · clear") instead of only a small blue dot — currently the whole list empties with a nearly invisible state change.

## EXECUTION_DAG
- T01: Restructure row markup + project grouping in ShellSidebar.tsx. done-when: same-project rows render one shared header; diff shows per-row label removed.
- T02: Fix row aria-label and aria-hide initials. done-when: accessible name reads title+status only (verify via DOM or axe).
- T03: Visible active-filter chip + clear action. done-when: toggling filter shows/hides the chip.
- T04: Screenshots light/dark + compact density; update any sidebar tests/snapshots.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- `pnpm build` and fixture host on :4317; visually verify 9 seeded threads group under one project header.
- Keyboard/screen-reader name check via DOM inspection.
- Run existing web tests touching the sidebar if present (discovery: `rg ShellSidebar apps/web -g '*test*'`).

## STATE
- rev 2: full design spec added (above). Implementer executes T01–T04 against the spec verbatim.
- Researched: DOM + screenshots (see REFERENCES). Decided: grouping + a11y fix + filter chip. Implemented: nothing. Next step: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1139 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit evidence: screenshots ss_8023892c.png (sidebar), ss_88934711.png; DOM dump confirms `aria-label="Workspace & settings Ready"` + inner "URUI review recordings".
- AGENTS.md plan-publication contract (repo root).
