# Plan: Reduce composer control crowding and wrapping

## META
- Feature: Composer toolbar density/overflow
- Repo: skytuhua-org/Gen-V1 — plan rev 1, 2026-11-20
- Baseline: main @ f8e9a8314fea0dc7bb1ab5d59bfe741f7083273e
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

## DESIGN
Add an overflow group: when `composer` width < breakpoint, render Changes/Create PR/Saved drafts/etc. inside one dropdown menu button. Reuse the overflow/menu primitive used by area headers ("⋯" area actions) for consistent look.

## EXECUTION_DAG
- T01: Inventory controls + identify shared menu primitive. done-when: tier list in PR description.
- T02: Implement overflow collapse at breakpoint(s). done-when: composer never exceeds 2 rows at ≥700px and 1 row preferred; menu contains hidden items.
- T03: Keyboard/focus pass — opening menu, arrowing items, Esc returns focus.
- T04: Screenshots at 1280/900/700/500px before/after.

## VALIDATION
- Fixture at 4 viewport widths; count visible rows; verify menu items still work.
- Tab order check; axe pass if a runner exists.

## STATE
- Researched: ss_76f7d0be.png + narrow screenshots. Implemented: nothing. Next: T01.

## REFERENCES
- Audit screenshots: ss_76f7d0be.png, /tmp/audit/09-narrow-700.png, /tmp/audit/10-narrow-500.png.
