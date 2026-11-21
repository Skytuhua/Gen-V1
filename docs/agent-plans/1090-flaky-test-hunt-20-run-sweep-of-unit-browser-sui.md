<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1090 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: flaky-test sweep completion — canonical issue for the 20x full-suite + 50x isolated-rerun hunt.
- Repo: skytuhua-org/Gen-V1. Plan revision: r1, 2026-11-20. Baseline: main @ 7ef0710c90a479233f8dd9fe484a296f8c3c86d3.
- Links: this issue #1090; DUPLICATE of this scope: #1097 (same 20x sweep + same deliverable `docs/reports/flaky-tests-2026-11-19.md` + same PR title "Add flaky test report") — see REQUIREMENTS for consolidation. Related PRs: #1095 (HostFixture.close report), #1096 (reduced-scope flaky report), #1112 (deflake fixes for freePort race + unbounded waits). Issue #993 tracks the HostFixture.close stall.
- Status: THREE concurrent sweeps ran/were running — devin-a-cloud-3f9c21 (claimed in issue body; vitest 20/20 done on main@25b441bd, browser ~5-11/20 in grouped runs), devin-0f37ae19 (vitest 20/20 done on main@26ddf4d1, browser ~3%), devin-web-8c41a7 (DONE, reduced scope, delivered PR #1096 + fixes PR #1112). No canonical report merged yet. Provenance: maintainer assignment + issue journal + this review.

### OBJECTIVE
Produce one merged `docs/reports/flaky-tests-2026-11-19.md` listing every intermittently-failing test on main with failure rate, error output, root cause (file+line), sorted by failure rate — from a completed 20x vitest + 20x browser sweep and 50x isolated reruns — landed via one report-only PR titled "Add flaky test report".

### REQUIREMENTS
- In scope: finish aggregate data, write report, one PR, consolidate the duplicated effort.
- Out of scope: code/test fixes (fixes already delivered separately in PR #1112; further fixes need their own issues/PRs).
- DUPLICATE RESOLUTION (per AGENTS.md concurrent-duplicate rule): #1097 duplicates this issue's scope. #1090 is the earlier issue and holds the body-claimed worker, so it is canonical: post a cross-link on both issues, keep this one, release the #1097 claim and fold devin-web-4f9d2c's run data (vitest ~87 intermittent candidates, browser ~34, per CHECKPOINT 002) into this issue's aggregation rather than discarding it.
- Constraint: no code or test changes on the measuring branch; runs must be on unmodified main; scratch scripts/logs stay untracked and are never committed.

### REPO_MAP (verified)
- `docs/reports/` does not exist on main yet — report is a new directory; manifest `scripts/public-source-files.json` (`source` array, sorted style e.g. `docs/acceptance.md` at line 374) MUST list `docs/reports/flaky-tests-2026-11-19.md` or `tests/public-source.test.ts` (manifest check ~line 137) fails.
- Sweep entrypoints: `npx vitest run --reporter=json` (full unit suite); `scripts/test-browser.ts [--suite <name>]` driving `scripts/browser-suites.ts` (each suite writes `results.json` under its output dir; `--list` writes `discovery.json`). Known port-sharing pairs to co-schedule: {side-chat,table-controls}:5480, {model-picker,wo5-app-integration}:5527 (per #1090 journal).
- Already root-caused (do not re-derive, reuse): freePort bind-release-reuse race — `tests/desktop-host.test.ts:119`, `tests/hermes-host.test.ts:11`, `tests/project-memory-maintenance-host.test.ts:16`; unbounded spin-wait `tests/agent-work-v3.test.ts:360` (both fixed in PR #1112); dev-plugin-runtime shared `dist/plugin-runtime` rebuild race — `tests/dev-plugin-runtime.test.ts` vs `tests/plugin-validation-policy.test.ts:20` → `apps/server/plugin-routes.ts:73-75` 503s (verified cause, per #1090 journal); HostFixture.close stall — ranked waits in PR #1095 (`packages/core/service.ts:2348`, `apps/server/server.ts:362-366`).
- Linux-VM caveat (verified): ~293 deterministic `CAPABILITY_DENIED` failures from `packages/core/linux-path-guard.ts` + missing Playwright headless shell — these are environment-broken, NOT flakes; exclude via deterministic-across-runs filter.

### DESIGN (process; exact mechanics so the executor makes no choices)
1. Aggregate: for each test, count runs-failed / 20. Classify: fails 20/20 or identical-count-every-run = deterministic env/baseline (list in an appendix, excluded from flake table); fails 1–19/20 = flaky candidate.
2. Per flaky candidate: `npx vitest run <file> -t "<test name>"` x50 (browser: `scripts/test-browser.ts --suite <suite>` x50 or the spec-level equivalent); record isolated failure rate.
3. Per confirmed flake: root-cause note with file+line, mechanism class (timing / shared state / test order / network / filesystem / port reuse), and the evidence (error output excerpt).
4. Report format: `docs/reports/flaky-tests-2026-11-19.md` — table sorted by failure rate: test, suite/file, full-suite rate, isolated rate, error excerpt, cause(file+line), mechanism class; appendix = deterministic env failures + already-fixed items (#1112) marked with their fix PR.
5. PR: branch `devin/<ts>-flaky-test-report`, title exactly `Add flaky test report`, containing only the report + its one-line manifest entry in `scripts/public-source-files.json`; body lists top 5 causes.
6. Dedup data merge: fold devin-web-4f9d2c (#1097) and devin-0f37ae19 aggregates into the candidate set before reruns — union of intermittent candidates across all sweep sources.

### EXECUTION_DAG
- T01 (deps: none): Cross-link #1097/#1090; confirm one report owner; collect the three existing aggregates (gv-test, /tmp/flaky, flaky-runs/ — ask each worker for its JSON paths; note: devin-a-cloud-3f9c21's comment writes were 401 — read its issue-body journal instead).
- T02 (deps: T01): Finish/merge the 20x browser sweep data — reuse whichever worker is closest; do NOT restart completed suite counts.
- T03 (deps: T02): Union flaky candidates; run 50x isolated reruns; write root-cause notes (reuse REPO_MAP's already-proven causes).
- T04 (deps: T03): Write `docs/reports/flaky-tests-2026-11-19.md`; add manifest line to `scripts/public-source-files.json`; `pnpm exec vitest run tests/public-source.test.ts` + `pnpm check:docs-links` green.
- T05 (deps: T04): Reconcile with existing report PRs #1095 and #1096 — either merge the strongest into one PR or supersede both with the full-sweep report (maintainer picks; recommend superseding, keeping #1095's HostFixture ranking section).
- T06 (deps: T05): Open/retitle canonical report PR, required CI green, merge; close #1097 as duplicate (release its claim) once data is folded in.

### VALIDATION
- Report exists, registered in manifest; `tests/public-source.test.ts` PASS; docs-links PASS; report table covers every test with ≥1 intermittent failure across all three sweep sources; every flaky row has an isolated 50x rate + cause; PR contains only report + manifest line.
- Planned vs executed: 20x vitest already executed by two workers; browser 20x partially executed — T02 completes the remainder.

### STATE
- Done: vitest 20x (x2 workers), several root causes proven, two report PRs open, one fix PR open.
- Pending: browser sweep completion, aggregation, isolated reruns for browser flakes, canonical report, merge, #1097 dedup.
- Risks: run data lives on ephemeral worker VMs (HANDOFF_INCOMPLETE if a worker exits); comment-write 401s moved one journal into the issue body — keep this plan authoritative; do not let three partial sweeps produce three competing reports.
- Next step: T01 — designate canonical owner (recommend devin-a-cloud-3f9c21, farthest along) and merge aggregates.

### REFERENCES
- #1097 (duplicate sweep), PR #1095, PR #1096, PR #1112, #993; journals in this issue's body + comments.

