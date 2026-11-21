<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1097 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: flaky-test sweep — 20x full suite on main + report.
- Repo: skytuhua-org/Gen-V1. Plan revision: r1, 2026-11-20. Baseline: main @ 7ef0710c90a479233f8dd9fe484a296f8c3c86d3.
- Links: this issue #1097; DUPLICATE of #1090 — identical scope (20x vitest + browser sweep on main, 50x isolated reruns, identical deliverable `docs/reports/flaky-tests-2026-11-19.md`, identical PR title "Add flaky test report"). Related PRs: #1095, #1096 (existing report PRs), #1112 (deflake fixes).
- Status: worker devin-web-4f9d2c IN_PROGRESS (vitest 13/20, browser 7/20 on main@26ddf4d1 per CHECKPOINT 002); #1090 has two sweeps further along overall plus a delivered report PR. Provenance: maintainer assignment + comments + this review.

### OBJECTIVE
Per AGENTS.md's concurrent-duplicate rule, continue in the earlier matching issue: **#1090 is canonical.** This issue's value is its run data (~87 vitest + ~34 browser intermittent candidates through r12/r7). Objective: fold that data into #1090's aggregation, then release this claim and close #1097 as duplicate.

### REQUIREMENTS
- In scope: publish the in-flight aggregates durably (they currently exist only in untracked `flaky-runs/` on one worker VM — HANDOFF_INCOMPLETE if that VM dies), cross-link, hand off candidate list, close as duplicate.
- Out of scope: finishing a parallel 20x sweep (redundant work — three sweeps already ran), a separate report PR.
- Constraint: no code/test changes; runs stay on unmodified main.

### REPO_MAP (verified)
- Same mechanics as canonical plan on #1090: `npx vitest run --reporter=json`; `scripts/test-browser.ts --suite <name>` per `scripts/browser-suites.ts` writing per-suite `results.json`.
- Report must live at `docs/reports/flaky-tests-2026-11-19.md` and be registered in `scripts/public-source-files.json` (`source` array) or `tests/public-source.test.ts` fails.
- Already-proven causes to fold in (do not re-derive): freePort race (`tests/desktop-host.test.ts:119`, `tests/hermes-host.test.ts:11`, `tests/project-memory-maintenance-host.test.ts:16`), unbounded wait (`tests/agent-work-v3.test.ts:360`) — both fixed in PR #1112; dev-plugin-runtime `dist/plugin-runtime` rebuild race (`tests/plugin-validation-policy.test.ts:20` → `apps/server/plugin-routes.ts:73-75`); HostFixture.close ranking in PR #1095.

### DESIGN / EXECUTION_DAG
- T01: Worker devin-web-4f9d2c posts its current per-test intermittent-candidate list (names + fail counts from vitest r13+ and browser r7+) as one comment on #1090, plus JSON locations/branches if pushable. This is the only data that must survive.
- T02: Canonical owner on #1090 unions these candidates with its own for the 50x isolated-rerun phase.
- T03: devin-web-4f9d2c stops its redundant remaining rounds (saves hours of compute), posts release-of-claim here.
- T04: Maintainer closes #1097 as duplicate of #1090 once T01 data lands.
- T05: If the canonical worker stalls before finishing, this issue's driver scripts (already built with atomic status + per-suite resume) are the fallback — re-claim and resume rather than restart.

### VALIDATION
- #1097 data present in #1090's candidate set (names cross-checked); no second report PR opened from this issue; claim released; issue closed as duplicate.

### STATE
- Pending: T01 data export, closure. Risks: losing ~20 rounds of run data if the worker VM dies before T01; wasted compute if the duplicate sweep keeps running in parallel.
- Next step: T01.

### REFERENCES
- Canonical plan: #1090 (contains the full sweep-completion plan). PR #1095, #1096, #1112; #993.

