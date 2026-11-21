<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1098 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: Gen V1 UI acceptance repair — eighteen-outcome delivery (R01–R18).
- Repo: skytuhua-org/Gen-V1. Plan revision: r1, 2026-11-20. Baseline: main @ 7ef0710c90a479233f8dd9fe484a296f8c3c86d3.
- Links: issue #1098; delivery PR #896 (branch `repair/ui-acceptance-20261118`, OPEN); canonical design/acceptance spec `gen-v1-ui-acceptance-plan.md` on that branch (tasks T00–T17).
- Status: implementation reportedly complete on the branch with typecheck/lint/ui-guard/unit/e2e/desktop-verify green (see issue body "Verification"). Remaining work is independent verification and landing the PR. Provenance: maintainer-authorized repair delivery + this review.
- Verdict: NOT a planning-from-scratch job — the fix exists. This plan is the acceptance/landing plan: verify each of the 18 outcomes against the branch, then merge. If verification finds a gap, the remediation task names the owning T-task in `gen-v1-ui-acceptance-plan.md`.

### OBJECTIVE
Confirm — observable, per outcome — that all eighteen user-facing defects from the 2026-11-18 click-through are repaired on `repair/ui-acceptance-20261118`, and land the delivery via PR #896. Success = every R01–R18 row verified PASS with evidence, required CI green on the PR head, then merge.

### REQUIREMENTS
- In scope: per-outcome verification on the delivery build, CI green, merge of PR #896, post-merge spot check on main.
- Out of scope: new features, redesign, changing the agreed design spec in `gen-v1-ui-acceptance-plan.md`, fixing unrelated defects (file separate issues).
- Constraint: implementers made zero design decisions — the spec in `gen-v1-ui-acceptance-plan.md` (spacing, type, layout budgets, states) is binding; verification must check against it, not against taste.

### REPO_MAP (verified)
- `gen-v1-ui-acceptance-plan.md` (branch `repair/ui-acceptance-20261118`, root): binding spec — shared design table, reference layouts, R01–R18 acceptance table, tasks T00–T17, closure packet requirements.
- `docs/acceptance.md` (branch): historical acceptance ledger.
- Surfaces named by the spec: `apps/web/src/**` (workspace/split, drawer, settings, agents board, plan timeline, scroll rail), `apps/desktop/**` (packaged startup/recovery), `tests/e2e/**`, `scripts/verify-desktop.ts`.
- PR #896 head branch is up to date with main (merge commit 8f018d6 pulled main in on 2026-11-20).

### DESIGN (the eighteen outcomes, each = acceptance row → verification)
| Outcome | Spec source | Verify this observable behavior |
|---|---|---|
| R01 slim scroll indicator | plan R01, T03/T04 | 1 px rail / 3 px thumb / ~24 px pointer strip; wheel+drag+keyboard reach oldest+newest message; usable in shallow pane; absent when no scrolling |
| R02 detach preserves main | T01/T02 | Detach A, select B in sidebar, dock+detach A again: main keeps B's title/history/draft, secondary keeps A's |
| R03 one placement grip | T02/T03 | Single six-dot grip; drop left/right/top/bottom creates real split; float shows dots without extra toolbar |
| R04 resize/float readable | T02/T03 | Resize float 480×680→~818×356 reflows text; a 158 px docked pane still shows ≥80 px transcript + composer row per shallow-pane budget |
| R05 saved-layout removed | T04 | No "Save current layout"; Panels menu replaced by one panel-toggle icon |
| R06 drawer launcher | T04 | Fresh drawer = "Open a surface" list; after selection, tabs + plus menu; Browser and Side chat reachable from both entries |
| R07 no drawer-level X | T04 | Drawer closes/restores only via global panel toggle |
| R08 no Switch layout | T02/T04 | Chat chrome has no Switch layout; Move grip is the only placement control |
| R09 drop preview | T03 | 1 px neutral outline + ~8% fill only during eligible edge drag, aligned to eventual divider; gone after drop |
| R10 settings nav/search | T06/T07 | Every enabled settings row changes+persists its feature; search lands on real targets (e.g. "Providers" → Models & Accounts) |
| R11 four agent cards | T10 | 4 cards/row at ≥1080 px content width (≈261–278.5 px/card); ≥2/3 history per 420 px card; 5th wraps |
| R12 retired workspaces | T05 | Code Review, Research, Custom, Visuals removed from all entry points incl. restored profiles + installed contributions |
| R13 artifact collapse | T11 | Collapsing a topic shrinks outer artifact and pulls following content up; nested evidence collapses; reopen preserves edits |
| R14 no trailing topic box | T12 | No automatic trailing topic box; authored evidence/fields/pending inputs never dropped |
| R15 sidebar expands | T04/T17 | First click and keyboard expand collapsed sidebar, including in Electron |
| R16 dense plan at 280 px | T13 | Plan status/checks/branches/results/expansion usable at 280–320 px; nested indent ≤16 px |
| R17 color state language | T14 | Running/attention/completed/failed each have one consistent text+icon+color in both themes |
| R18 provider connect/readiness | T08/T09/T17 | Codex→ChatGPT and Claude Code→Claude connect flows; pending sign-in recoverable across Settings lifetime; account+model readiness accurate |

### EXECUTION_DAG
- T01 (deps: none): Fetch PR #896 head; run required gates locally where possible: `pnpm typecheck`, `pnpm lint`, `pnpm test:ui-guard`, `pnpm exec vitest run` (note: path-guard suites fail on Linux — env-determined, not a regression; compare failure set vs unmodified main).
- T02 (deps: T01): Browser/UI verification pass over R01–R18 using the spec's "What the user will test" flows: run the relevant `tests/e2e` suites on the branch and manual spot-checks of R02, R04, R06, R09, R11, R13, R15–R17 (visual/state outcomes least covered by automation).
- T03 (deps: T01; platform: Windows, separate worker): Packaged-desktop outcomes — `pnpm desktop:build` + `scripts/verify-desktop.ts` 13/13 (cold start, crash recovery, cold restart with thread/edits/drafts) covering R15/R17/R18 native cases. Cannot run on Linux.
- T04 (deps: T02, T03): Record per-outcome PASS/FAIL/BLOCKED in a results table posted as an issue comment; every FAIL names its owning T-task in `gen-v1-ui-acceptance-plan.md` for remediation on the same branch.
- T05 (deps: T04 all PASS or waived): Wait for required CI on PR #896 (`git_pr_checks wait_mode=all`), confirm mergeable, merge through protections.
- T06 (deps: T05): Post-merge verification on main: pull, re-run typecheck + one smoke e2e spec; post STATUS=DONE checkpoint; close issue only on maintainer authorization.

### VALIDATION
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test:ui-guard`, `pnpm test`, `pnpm test:e2e` (all 80 suites claimed green on branch — re-verify changed-surface suites), `pnpm desktop:build && node --import tsx scripts/verify-desktop.ts` (Windows only).
- Planned vs executed: implementer's run already executed (6051 pass/517 files, 80 browser suites, verify-desktop 13/13); this plan's T02/T03 is independent re-verification on the current head.
- Acceptance matrix = the R01–R18 table above; release gate = all rows PASS (or maintainer-waived) + required CI green + merge.

### STATE
- Researched/decided: spec binding and complete; implementation delivered on branch; PR #896 open.
- Pending: independent per-outcome verification (T02), Windows desktop verification (T03), CI, merge.
- Risks: spec images referenced under `../specs/gen-v1-harness-repair-reference/` may be local-only — verify via behavior not images; env-determined test failures on Linux mask real regressions — diff failure sets vs main.
- Next step: T01 (reviewer) then T02/T03 in parallel.

### REFERENCES
- Spec: `gen-v1-ui-acceptance-plan.md` @ `repair/ui-acceptance-20261118` (SHA-pinned read recommended via `git show origin/repair/ui-acceptance-20261118:gen-v1-ui-acceptance-plan.md`).
- PR: https://github.com/skytuhua-org/Gen-V1/pull/896 ; related #896 "Fixes" link per issue body.

