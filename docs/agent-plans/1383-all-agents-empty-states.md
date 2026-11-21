# Plan: All Agents empty state — designed empty states for zero agents and zero filter results

## META
- Feature: All Agents empty-state design
- Repo: skytuhua-org/Gen-V1 · Plan rev 1, 2026-11-21
- Baseline: `main` @ `e883ac03` (verified `git log -1` on the working clone)
- Related: #1299 (space-efficient agent cards, complementary — card content, not the empty state), #1295 (workspace hero pattern this reuses), tracking #1281
- Status: planned only — no implementation
- Provenance: visual QA of the fixture build served at http://127.0.0.1:4317 (recording-fixture host)

## OBJECTIVE
When All Agents has zero agents the panel shows one bare text line, top-left: "No active agents. Agents appear here once a conversation starts working." It is the only surface-level empty state in the shell with no iconography, no headline hierarchy and no action. Align it with the workspace hero vocabulary introduced in #1295 so empty states read as one system. Measurable success: the zero-agent and zero-filter-result states render the specified layout in both themes, pass axe checks, and a Playwright spec asserts the specified copy, roles and motion policy.

## REQUIREMENTS
- In scope: the `agents-workspace` zero-agent state and the filters-applied-but-zero-results state; DOM, copy, layout, motion and tests.
- Out of scope: agent card content (#1299), filter control behavior, live badge, any data/host changes.
- User flows: (a) open All Agents with no agents → hero state with "New conversation" action; (b) apply a project/status filter or search that matches nothing → compact state with "Clear filters" action; (c) agents exist → unchanged list.
- Accessibility: hero is a `region` with `aria-label="No active agents"`; icons `aria-hidden`; buttons reachable by keyboard with the shared focus ring; status text is plain text, no color-only meaning.
- Motion policy: honors `:root[data-motion="reduced"|"off"]`, `data-panel-animations="false"`, and `prefers-reduced-motion` exactly as `empty-workspace.css` does.
- Error/recovery: none — pure presentation.
- Compatibility: light and dark themes; widths 320 px–1600 px; no layout overflow at 320 px sidebar-collapsed workspace.

## REPO_MAP (verified on main@e883ac03)
- `apps/web/src/agents-workspace/AgentsWorkspace.tsx` — renders the bare line `No active agents. Agents appear here once a conversation starts working.` (the empty branch beside the `Live` filter row).
- `apps/web/src/agents-workspace/agents-workspace.css` — panel styles; no empty-state rules today.
- `apps/web/src/EmptyWorkspace.tsx` + `apps/web/src/empty-workspace.css` (#1305) — reference vocabulary: `.empty-state`, `.empty-symbol` tile, h1/paragraph hierarchy, `empty-workspace-arrive` keyframes, motion-token names (`--ui-motion-insert`, `--ui-motion-stagger`, `--ui-motion-press`, `--ui-ease-enter`).
- Tokens to reuse: `--border`, `--surface`, `--text`, `--muted`, `--accent`, `--ui-focus-ring`.
- Tests: `tests/e2e/agents-workspace.spec.ts`, `tests/e2e/agents-workspace-evidence.spec.ts` (existing e2e files to extend).

## DESIGN
Two states, one component `AgentsEmptyState` inside `AgentsWorkspace.tsx`:

1. `empty` variant (zero agents overall):
   - Container: `role="region"`, `aria-label="No active agents"`, centered in the scroll area, `max-width: 480px`, padding `48px 16px`.
   - Icon tile: 44×44 px, `border-radius: 12px`, `border: 1px solid var(--border)`, `background: var(--surface)`, `color: var(--text)`, containing `Bot` (lucide) at `size={23} strokeWidth={1.4}`, `aria-hidden`.
   - Headline `h2`: `font-size: 20px`, `line-height: 1.25`, `font-weight: 600`, `letter-spacing: -.02em`, copy "No active agents".
   - Subline `p`: `font-size: 13px`, `color: var(--muted)`, `margin-top: 8px`, copy "Agents appear here once a conversation starts working. Start one from the sidebar or press Ctrl+Shift+O." (Use the real shortcut label from `chordFor('new-thread')`-equivalent binding if one exists; verify binding name during implementation — otherwise literal `Ctrl+Shift+O`.)
   - Action row: one button "New conversation", `min-height: 36px`, `padding: 8px 14px`, `border-radius: 10px`, `border: 1px solid var(--border)`, `background: var(--surface)`, `color: var(--text)`, `font-size: 12.5px`; hover `background: var(--hover)`; active `transform: scale(.97)` (suppressed under reduced/off motion); `focus-visible` `outline: 2px solid var(--ui-focus-ring); outline-offset: 3px`. `onClick` dispatches the same new-thread path as the sidebar "New thread" button (reuse the existing controller/workspace callback — verify the exact prop during implementation; do not invent a new command).
2. `filtered` variant (filters/search yield zero rows while agents exist):
   - Compact: `Bot` icon `size={20}` (no tile), `font-size: 13px` text "No agents match these filters.", followed by a quiet button "Clear filters" (`color: var(--accent)`, `font-size: 12.5px`, `min-height: 32px`) that resets project filter, status filter and search to defaults.
   - Rendered where the grid would be; region `aria-label="No matching agents"`.
- Motion: entrance `empty-workspace-arrive`-equivalent (`opacity 0→1`, `translateY(6px)→0`, duration `calc(var(--ui-motion-insert) * 2)`, easing `var(--ui-ease-enter)`); h2 delay `var(--ui-motion-stagger)`, subline `×2`, action `×3`. Reduced/off/PRM: fade-only or none per the `empty-workspace.css` precedent.

## EXECUTION_DAG
- T01: In `AgentsWorkspace.tsx`, replace the bare empty line with `AgentsEmptyState` covering both variants; wire "New conversation" to the existing new-thread path and "Clear filters" to the existing filter state reset. Done when both states render in the fixture host.
- T02: Add CSS in `agents-workspace.css` per DESIGN values, including the three motion gates. Done when computed styles match spec in devtools in both themes.
- T03: Extend `tests/e2e/agents-workspace.spec.ts`: assert hero region, copy, button role/labels; assert filtered variant appears when a filter excludes all rows and that "Clear filters" restores the list; assert `animationName` under `data-motion=reduced`/`off` mirrors the #1305 test. Done when the spec passes locally.
- T04: Verify at 320 px and 1440 px, light+dark; attach screenshots to the implementing PR. Done when no overflow/clipping.

## VALIDATION
- Commands: `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run tests/agents-workspace-grid.test.ts`, `pnpm exec playwright test tests/e2e/agents-workspace.spec.ts` (planned, not yet executed).
- Fixture: review host on :4317 (recorded fixtures). Manual: open All Agents, apply project filter "No project" to force the filtered variant, run Clear filters.
- Acceptance matrix: copy strings, roles, aria-labels, px values above; zero console errors; both motion policies honored.
- Release gate: CI green on the implementing PR; visual evidence attached.

## STATE
- Researched/decided: everything in DESIGN; open discovery items marked inline (shortcut label source, new-thread callback prop name).
- Implemented: nothing. Verified: nothing.
- Risks: new-thread action may live outside `AgentsWorkspace` props — if so, escalate to Chief of Staff rather than invent a second path.
- Next step: implement T01–T04 on a `devin/<ts>-agents-empty-state` branch.

## REFERENCES
- Fixture evidence: http://127.0.0.1:4317 → All Agents tab shows the bare text line (screenshot in this session's worklog).
- Pattern source: `apps/web/src/EmptyWorkspace.tsx`, `apps/web/src/empty-workspace.css` (PR #1305).
