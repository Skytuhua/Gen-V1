<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1125 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: Worker-4 exploration/workflow surface refinements — seven UIs (16 pin annotator, 17 schedule picker, 18 log explorer, 19 workflow board, 20 architecture canvas, 21 trace waterfall, 28 task plan/progress).
- Repo: skytuhua-org/Gen-V1. Plan rev 1, 2026-11-20.
- Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified).
- Issue/PR: this issue #1125; PR [#1143](https://github.com/skytuhua-org/Gen-V1/pull/1143), branch `refine/exploration-workflows@9cd04f37e26bf8d5230be2e85972995271bce496`.
- Status: implementation **DONE and verified** by `devin-a-cloud-fe8fda` (checkpoint 003, STATUS=DONE): all 7 UIs implemented, e2e 60/60 pass, typecheck/lint clean, 7 MP4s delivered. PR #1143 open, checks SUCCESS but **merge conflict detected**. **This plan covers remaining scope only: conflict resolution → CI → merge → verify.**
- Provenance: issue checkpoint 003 + `git merge-tree` conflict analysis at snapshot.

### OBJECTIVE
Land PR #1143 on main without losing any of its verified geometry/motion changes while adopting main's new control-token names. Success: PR merged, main HEAD checks green, no regression in the three e2e suites.

### REQUIREMENTS
- In scope: conflict repair on `refine/exploration-workflows` (merge `origin/main` into it), CI watch, merge, post-merge verification.
- Out of scope: any redesign, any change to the seven UIs' behavior, additional features.
- Conflict specifics (verified via `git merge-tree --write-tree origin/main pr-1143`):
  - Conflicted files: `apps/web/src/exploration-tools.css`, `apps/web/src/work-objects.css` ONLY.
  - Cause: main commits `7a693d71 fix(ui): preserve distinct selected control outlines` and `c19a605d fix(ui): strengthen remaining selected control outlines` renamed tokens on the same lines the PR rewrote: `--border` → `--control-border` on interactive control borders (`.exploration-field textarea`, `.log-search`) and `--selection-border,var(--muted)` → `var(--text)` on `.schedule-interval[aria-selected=true]` border-color.
  - Resolution rule (exact, no design decisions): in every conflicted hunk keep the PR's rule structure and property values **except** apply main's token renames inside them — i.e. `var(--control-border)` wherever main renamed `--border` on an interactive control, and `var(--text)` for the schedule-interval selected border-color (matching `.schedule-interval[aria-selected=true] .schedule-choice`'s existing `--text`). For `work-objects.css` apply the identical rule: keep PR geometry/motion, adopt main's token names. Verify no other token renames landed on main in these files (`git diff merge-base origin/main` on each file) — apply each main rename inside PR rules.
- Merge rules: individual merge of #1143 only, no squashing others in; do not touch `scripts/ui-overlay-legacy.json` (PR deliberately kept fingerprints).

### REPO_MAP (verified)
- `apps/web/src/ExplorationTools.tsx`, `exploration-tools.css` — UIs 16/17/18 (conflict: css only).
- `apps/web/src/WorkObjects.tsx`, `work-objects.css` — UIs 19/20/21 (conflict: css only).
- `apps/web/src/PlanStatus.tsx`, `apps/web/src/plan-timeline/timeline.css`, `TimelineRows.tsx` — UI-28 (clean).
- `tests/e2e/exploration-ui.spec.ts`, `work-objects.spec.ts`, `plan-timeline.spec.ts` — specs (merge cleanly per merge-tree).
- Main-side token commits: `7a693d71`, `c19a605d`, `147208df` (also touches these css files).

### DESIGN — conflict resolution procedure (exact)
1. `git checkout refine/exploration-workflows && git merge origin/main` in the PR worktree.
2. For each conflicted hunk in the two css files: take the PR (theirs-in-diff) version as base text, then re-apply each main token rename found in `git diff $(merge-base) origin/main -- <file>` to the corresponding selectors. Result must contain: PR's new geometry (ruler band, lane/card sizes, row heights, inset shadows), PR's motion rules, AND main's `--control-border`/`--text` selections — never a bare `--border` or `--selection-border,var(--muted)` on the touched interactive rules.
3. `git add` both files, `git commit` the merge, push to `refine/exploration-workflows`.
4. Sanity-grep the merged css: no `<<<<<<<`/`=======`; every PR-introduced selector from the PR diff still present.

### EXECUTION_DAG
- **T01 — Conflict repair.** Deps none. Procedure above. Done-when: merge commit pushed, PR shows mergeable.
- **T02 — Fresh CI.** Deps T01. Wait for the full required check set on the merge commit; rerun once on environmental flake (`Browser tests` known main-wide flake signature).
- **T03 — Merge.** Deps T02 green + no open review comments. Individual merge.
- **T04 — Post-merge verify.** Deps T03. Fresh main worktree: `pnpm exec playwright test --config tests/e2e/clarity-schedule-logs.playwright.config.ts tests/e2e/exploration-ui.spec.ts` (expect 16/16), `--config tests/e2e/generated-selects.playwright.config.ts tests/e2e/work-objects.spec.ts` (26/26), `tests/e2e/plan-timeline.spec.ts` via `playwright.config.ts` (18/18); `pnpm typecheck`; `pnpm lint`. Post AGENTS.md merge checkpoint (merged vs verified-on-main distinct).

### VALIDATION
- Already executed on branch `9cd04f37`: exploration-ui 16/16, work-objects 26/26, plan-timeline 18/18, typecheck PASS, lint 0 violations, 7 MP4s + viewport matrix (no overflow any viewport/motion policy).
- Planned: PR CI green on merge commit; post-merge suite re-run per T04.
- Acceptance: (1) conflict resolved keeping both PR rules and main token renames; (2) merged; (3) verified-on-main suites green.

### STATE
- Implemented+verified on branch @9cd04f37. Blocked only by two-file CSS token conflict vs main@7ef0710.
- Risks: main keeps landing token/outline commits — recheck `git diff merge-base origin/main` on the two files right before resolving; a second conflict cycle possible.
- Exact next step: T01 merge `origin/main` into `refine/exploration-workflows`, apply token-renames-inside-PR-rules resolution.

### REFERENCES
- PR: https://github.com/skytuhua-org/Gen-V1/pull/1143 · issue checkpoints 001–003 (comment-7035255926, -7035465827, DONE comment).
- Main token commits: `7a693d71`, `c19a605d`, `147208df`.
- Canonical Worker-4 plan file: `docs/agent-plans/worker-4-exploration-workflows.md` (merged via PR #1124 @ed778bb).
- File attachment: `.md` upload unavailable via `gh`; plan lives in issue body (HANDOFF_COMPLETE).

