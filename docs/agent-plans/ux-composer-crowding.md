# Plan: Reduce composer control crowding and wrapping

## META
- Feature: Composer toolbar density/overflow
- Repo: skytuhua-org/Gen-V1 — plan rev 2, 2026-11-20 (design fully specified — implementer makes no design choices)
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1132
- Parent audit issue: https://github.com/skytuhua-org/Gen-V1/issues/1140
- Status: planning complete, implementation NOT started
- Source: manual UX audit of built app on :4317

## OBJECTIVE
The composer packs ~12 controls (attachment chips, Saved drafts, +, project chip, Local env, two icon buttons, Changes, Create PR, model picker, context meter, mic, send) across up to 3 rows; it wraps further when the chat column narrows. Users face a wall of equal-weight buttons. Success: primary actions stay visible at all widths; secondary controls collapse into an overflow affordance.

## REQUIREMENTS
- Define priority tiers: always-visible (textarea, send, model picker, attach) vs collapsible (Changes, Create PR, Saved drafts, context meter, live usage, voice).
- Below a width threshold, low-priority controls move into a "⋯ more" menu instead of wrapping to a third row.
- Keep all controls keyboard reachable; preserve existing disabled-explanation tooltips.
- Respect compact density setting (S prefers compact UI); no removal of functionality.

## REPO_MAP
- `apps/web/src/ComposerToolbar.tsx` (89 lines) — control groups incl. `composer-runtime-controls`; props already include `leading`/`trailing`/`separateActions`.
- `apps/web/src/ModelPicker.tsx`, `apps/web/src/ContextMeter.tsx` — child controls.
- `apps/web/src/App.tsx` — composer composition.
- Discovery: existing overflow-menu primitive; current CSS breakpoints (`rg "composer" apps/web/src -g '*.css'` or styled).

## DESIGN SPEC (exact values — no design choices left)

**Tier assignment (fixed)**
- Tier 1 always visible: attachment chips, textarea, attach `+` (31px `.attach-button`), send (33px `.send-button`), model picker, project chip, `Local` env pill, task-mode toggle.
- Tier 2 collapses into overflow: `Saved drafts`, `Changes`, `Create PR`, live-usage icon, context-meter icon, voice icon.
- Breakpoint: when `.composer` width < 560px, Tier 2 buttons move into a single overflow `⋯` `.icon-button` (width/height `var(--ui-row-compact)`, radius 7px, `color:var(--muted)`, hover `var(--hover)`). At ≥560px the menu disappears and the buttons render inline.
- Composer keeps `padding:11px 14px 10px`, `border:1px solid var(--control-border)`, `border-radius:15px`; never exceeds 2 control rows at ≥700px viewport.

**Overflow menu** (reuse area-actions `⋯` menu pattern)
- Anchored above the `⋯` trigger: `position:absolute;bottom:calc(100% + 6px);right:0`.
- Box: `background:var(--surface)`, `border:1px solid var(--border)`, `border-radius:8px`, `box-shadow:var(--elevation)`, `min-width:180px`, `padding:4px`.
- Items: `.project-picker-option` pattern — `display:flex;align-items:center;gap:8px;min-height:32px;padding:6px 8px;border-radius:4px;font-size:12px;color:var(--text)`; disabled items `opacity:.5` keep their explanation tooltips.
- States: hover `var(--hover)`; keyboard `data-active` `outline:2px solid var(--ui-focus-ring);outline-offset:-2px`; Esc closes and returns focus to the `⋯` button; open/close animation `ui-popover-fade var(--ui-motion-press)` (80ms).

**Labels:** menu items use the same aria-labels/tooltips as the inline buttons (`Inspect recorded changes`, `Ask the agent to prepare a pull request`, etc.) so behavior is identical in both modes.

## DESIGN
Add an overflow group: when `composer` width < breakpoint, render Changes/Create PR/Saved drafts/etc. inside one dropdown menu button. Reuse the overflow/menu primitive used by area headers ("⋯" area actions) for consistent look.

## EXECUTION_DAG
- T01: Inventory controls + identify shared menu primitive. done-when: tier list in PR description.
- T02: Implement overflow collapse at breakpoint(s). done-when: composer never exceeds 2 rows at ≥700px and 1 row preferred; menu contains hidden items.
- T03: Keyboard/focus pass — opening menu, arrowing items, Esc returns focus.
- T04: Screenshots at 1280/900/700/500px before/after.


**Task contract (applies to every task above):** OWNER = one implementing agent claims this issue end-to-end. PREREQ = read this plan plus files in REPO_MAP; a task also depends on the earlier task it edits the same files as (sequential by ID). HANDOFF = implement on a `devin/*` branch off current main (pull latest main before branching), open a PR linking this issue, attach before/after screenshots and the VALIDATION results; post an AGENTS.md checkpoint on this issue at each milestone.

## VALIDATION
- Fixture at 4 viewport widths; count visible rows; verify menu items still work.
- Tab order check; axe pass if a runner exists.

## STATE
- rev 2: full design spec added.
- Researched: ss_76f7d0be.png + narrow screenshots. Implemented: nothing. Next: T01.

## REFERENCES
- Canonical issue: https://github.com/skytuhua-org/Gen-V1/issues/1132 ; audit evidence (screenshots, DOM dumps) is recorded in the audit session https://app.devin.ai/sessions/fdeae51a36244c48af3f43ff6dc04059 and summarized in parent issue #1140.
- Audit screenshots: ss_76f7d0be.png, /tmp/audit/09-narrow-700.png, /tmp/audit/10-narrow-500.png.
