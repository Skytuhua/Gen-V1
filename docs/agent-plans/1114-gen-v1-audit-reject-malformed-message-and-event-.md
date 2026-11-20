<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1114 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: reject malformed message-page limits and event-stream cursors
- Repo: skytuhua-org/Gen-V1 · Plan rev: 1 (2026-11-20)
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (defects verified present on this SHA)
- Issue: #1114 · Fixes authored by `dot-cloud-75d2b1`: PR #1121 (T01, branch `dot/audit-0818-message-limit@8b3decb`) and PR #1120 (T02, branch `dot/audit-0818-event-cursor@f045cf1`) — both open, mergeable, 9 CI checks pending at review time.
- Source provenance: review by devin-a-cloud-9c41e2; code re-verified on baseline.

### OBJECTIVE
Both defects are confirmed on baseline: `apps/server/server.ts:136` uses `Number.parseInt(limit, 10)` (accepts `"3x"`, `3.5` → `3`); `server.ts:281` uses `Number(query.after ?? 0)` (accepts `"0x10"` → `16`, `"1e3"` → `1000`). The fix code is written and PR'd; remaining scope is gate passage: CI, independent review, sequential merges, post-merge verification on main.

### REQUIREMENTS
- Both endpoints must return the existing 400 `INVALID_INPUT` for non-complete-decimal input; omitted params keep defaults (limit=200, after=0); complete decimals and existing Store bounds/authorization unchanged. No client/docs changes. (Already implemented in the PRs.)
- Remaining: CI green on both PRs; independent review; merge each independently; after each merge, validate current main; observe post-merge checks.

### REPO_MAP (verified on baseline)
- `apps/server/server.ts:131-138` — message paging: `parsed = limit === undefined ? 200 : Number.parseInt(limit, 10)`.
- `apps/server/server.ts:279-285` — `/api/events`: `after = Number(query.after ?? 0)`, then `Number.isSafeInteger(after) && after >= 0` check.
- `tests/server.test.ts` — message paging regression spec (T01).
- `tests/event-stream.test.ts`, `tests/event-stream-fairness.test.ts` — SSE cursor specs (T02).
- Exact shipped fix shape (from PR diffs): full-text decimal validation before conversion — T01 requires the supplied `limit` to match a complete signed decimal then safe-integer/bounds checks unchanged; T02 requires supplied `after` to match complete nonnegative decimal text before `Number()` conversion and before `registerEventStream`.

### DESIGN
No new design — both fixes are already authored per the issue. Reviewer's verification of the code shape:
- T01 (`8b3decb`): validate `limit` is a complete decimal string (e.g. `/^-?\d+$/.test(limit)` or equivalent full-consume check) before `Number.parseInt`/bounds; invalid → `HarnessError('INVALID_INPUT', …)` → 400.
- T02 (`f045cf1`): validate `after` is complete nonnegative decimal text (`/^\d+$/` or equivalent) before `Number()`; invalid → same 400; omitted still yields `after=0`.
- Merge order: either; second PR must be validated against post-first-merge main (rebase or fresh CI on merge queue behavior per repo policy).

### EXECUTION_DAG
- T01 — REVIEW/merge-gate PR #1121. Done-when: all required CI checks pass, independent review recorded, merged to main.
- T02 — REVIEW/merge-gate PR #1120. Done-when: same gates pass after T01's merge state is accounted for (re-check mergeable/conflicts on current main).
- T03 — Post-merge: fetch `main`, run `pnpm exec vitest run tests/server.test.ts tests/event-stream.test.ts tests/event-stream-fairness.test.ts` at repo root; confirm the two new regression specs pass and no new failures vs. baseline (known unrelated failure: one file-grant fixture asserts 200 vs 403 on unmodified main — record, do not fix here). Done-when: output recorded on the issue.
- T04 — Completion checkpoint + close #1114 when authorized. Deps: T01–T03.

### VALIDATION
- Executed during planning: baseline `server.ts` lines 136/281 confirmed unpatched; PRs verified open/mergeable; CI pending at time of review.
- Author's recorded evidence: red tests on base (200 instead of 400 for fractional limit and non-decimal cursor); green after fix — T01 `vitest run tests/server.test.ts -t 'malformed message limit|repeated message-paging'` 2/2; T02 `tests/event-stream.test.ts tests/event-stream-fairness.test.ts` 10/10; combined `tsc --noEmit` + `scripts/build.mjs` PASS; whitespace PASS.
- Planned: PR CI (Tests shards 1-4, Windows checks, Desktop build, Browser tests, Hermes contracts, Desktop memory retention); post-merge re-run per T03.
- Acceptance: each endpoint rejects malformed input with 400 INVALID_INPUT on merged main; defaults and decimal inputs verified; per-criterion evidence posted.

### STATE
- Researched/decided: fix approach (full-decimal validation) decided and authored.
- Implemented: T01, T02 on published branches. Verified: locally green; CI pending.
- Blockers/risks: none known; capy-ai review bot is out of credits (context-only, not a merge gate unless required).
- Next step: watch PR CI on #1120 and #1121; merge when green and reviewed.

### REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1114 · PRs: https://github.com/skytuhua-org/Gen-V1/pull/1120 and /1121
- Author checkpoints 001–005 on the issue (red/green commands, staged trees, CI run IDs 44703066696/44703064006).
- `apps/server/server.ts:131-138,279-285` on baseline.

