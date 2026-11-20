<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1108 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: investigation card Comparison redesign (option cards + diff grid)
- Repo: skytuhua-org/Gen-V1 · Plan rev: 1 (2026-11-20)
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3`
- Issue: #1108 · Implemented by `devin-a-cloud-7ff3a7` on `devin/1795160811-comparison-option-cards@e77335a` (approved variant A) — PR #1113 open, mergeable, CI pending. Independent QA by `devin-a-cloud-8b2b16`: all checks PASS on fixture host.
- Source provenance: review by devin-a-cloud-9c41e2.

### OBJECTIVE
The redesigned Comparison already exists and passed QA: radiogroup of `.everyday-option-card` (role=radio, roving tabindex) above a slim `.everyday-diff` grid (role=table), `.everyday-comparison` top margin separating it from the preceding Source toggle, hook-order fix. Remaining scope is PR #1113's merge gates and post-merge verification on main.

### REQUIREMENTS
- Implemented design (already shipped in PR #1113): option cards as radio inputs in a radiogroup; diff grid of subgrid rows, selected column tinted `--accent-soft`; heading clears the Source disclosure via `margin-top` on `.everyday-comparison`; keyboard ArrowLeft/Right/Home/End; state in shared store (`selectedId`, `differencesOnly`); footer action and source disclosure unchanged.
- Remaining: CI green, independent review, merge, verify on main in dark + light.

### REPO_MAP (verified)
- `apps/web/src/EverydayData.tsx`, `apps/web/src/everyday-data.css` — Comparison render + styles.
- `tests/e2e/everyday-ui.spec.ts`, `tests/e2e/task-design.spec.ts`, `tests/e2e/wo8.spec.ts` — updated selectors (radio/`aria-checked`).
- `scripts/capture-ui/screen-map.ts`, `scripts/record-task-design.ts` — capture recipe fix (`.error-text` wait, new classes).
- PR: https://github.com/skytuhua-org/Gen-V1/pull/1113 (head `e77335af738c387b9d488f36b6ac4a4c4d4b8920`, open, mergeable).

### DESIGN
Already implemented — no further design decisions. Acceptance restated: single outer artifact container, compact header, option cards above diff grid, no absolute/floating fragments; dark + light verified (QA covered 1440/768/375 default/narrow/focus/hover/empty/error/loading in dark; light theme still to be confirmed on merged main or via capture suite).

### EXECUTION_DAG
- T01 — Merge-gate PR #1113: all required CI checks pass, review recorded, merge to main. Deps: none.
- T02 — Post-merge verify on current `main`: run `pnpm typecheck`, `pnpm lint`, `pnpm exec playwright test --config tests/e2e/everyday.playwright.config.ts`, and `pnpm capture:ui --screens task-everyday`; view the catalog scene in dark and light themes to confirm the single-artifact composition and no regression vs. PR screenshots. Deps: T01.
- T03 — Completion checkpoint on #1108 + close when authorized. Deps: T02.

### VALIDATION
- Executed (author): typecheck/lint PASS; vitest task-surfaces 13/13; Playwright everyday suite 11/11; capture at 1440/1024/768/375. QA (independent): radiogroup semantics, diff grid, mouse/keyboard, differences-only, source toggle, spacing, narrow widths — all PASS.
- Planned: PR CI; post-merge re-runs per T02 incl. light-theme screenshot.
- Acceptance: CI green; merged; main verification shows the card as one artifact in both themes.

### STATE
- Decided: variant A approved; implemented + QA'd; PR open.
- Verified: everything except CI and on-main/light-theme confirmation.
- Risks: none known.
- Next step: watch #1113 CI; merge when green and reviewed; run T02.

### REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1108 · PR: https://github.com/skytuhua-org/Gen-V1/pull/1113
- Worker checkpoint 002 + QA checkpoint 001 on the issue (full test matrix and evidence).

