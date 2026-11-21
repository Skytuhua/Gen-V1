<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1128 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: Land RC review helper fix for early subprocess stdin closure (EPIPE crash).
- Repo: skytuhua-org/Gen-V1. Plan rev 1, 2026-11-20.
- Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified `git rev-parse origin/main`).
- Issue/PR: this issue #1128; implementation PR [#1130](https://github.com/skytuhua-org/Gen-V1/pull/1130), branch `dot/audit-0918-rc-stdin@da1a654d4b8b386595438609b7985d78520234f0`, mergeable, no conflicts.
- Status: fix **already implemented, pushed, locally verified** by worker `dot-cloud-75d2b1` (checkpoints 001–004). CI (9 checks) queued at time of writing; independent review pending. **This plan covers remaining scope only: review → merge → post-merge verification.** No further code edits expected.
- Provenance: issue checkpoints 001–004 + PR #1130 diff read at `da1a654d` vs `origin/main`.

### OBJECTIVE
`run()` in `scripts/rc-review/common.ts` crashed on unhandled `EPIPE`/`error` on `child.stdin` when a probe exited before consuming piped input. Intended: the failure stays inside the ordinary subprocess result — a rejected promise carrying `exitCode` and captured `stdout`, never an unhandled stream error and never a misreported success. Success = PR #1130 merged and the regression test green on post-merge main.

### REQUIREMENTS
- In scope: `scripts/rc-review/common.ts` `run()`; `tests/rc-review.test.ts` regression test; merge of PR #1130; post-merge verification.
- Out of scope: command admission, `.cmd` quoting path, shell policy, release/installer execution, customer data, Windows install flow.
- Behavior contract (as implemented, to verify not redesign):
  1. `child.stdin.on('error', …)` is subscribed **before** `child.stdin.end(options.input)`; error sets a local `inputFailed` flag, is not rethrown.
  2. On `close`: `code===0 && !inputFailed` → `accept(stdout.trim())`; `code===0 && inputFailed` → `reject(Error('RC subprocess did not accept its input'){stdout,exitCode:0})`; `code!==0` → existing `file+' exited '+code` rejection with `{stdout,exitCode:code}` preserved.
  3. No input (`options.input===undefined`) → unchanged `'ignore'` stdio path, no `inputFailed` path reachable.
  4. `child.once('error',reject)` (spawn failure) unchanged; `stdout` accumulation unchanged; `.cmd` admission and `windowsVerbatimArguments` unchanged.
- Test contract: probe spawns `node --input-type=module -e` that calls `run(process.execPath,['-e','process.exit(<c>)'],{capture:true,input:'x'.repeat(4*1024*1024)})` for `c∈{0,3}`; asserts `0:RC subprocess did not accept its input` and `exited 3` in probe stdout, 10s timeout.

### REPO_MAP (verified)
- `scripts/rc-review/common.ts` — sole changed implementation file. Exports `run(file,argv,{cwd,env,capture,input})`, `pnpm()`, `hash`, `json`, `output`, `main`.
- Caller using `input:` — `scripts/rc-review/flags-off.ts:10`: `run(process.execPath,['--input-type=module'],{env,capture:true,input:result.outputFiles[0].text})` — the real crash path (node exits early on a bad bundle → parent writing multi-MB stdin gets EPIPE).
- `tests/rc-review.test.ts` — 16 tests on PR branch incl. new `keeps an early child stdin closure in the RC subprocess result`.
- No other callers pass `input:` (grep verified); `installed-session.ts`, `seed-v061-profile.ts`, `build-candidate.ts`, `profile-manifest.ts` call `run` without `input` — unaffected.

### DESIGN (verified in PR diff — no remaining design decisions)
Exact diff shape in PR #1130: inside `run()`'s `new Promise`, after `spawn`, replace unconditional `child.stdin?.end(options.input)` with `let inputFailed=false; if(options.input!==undefined&&child.stdin){child.stdin.on('error',()=>{inputFailed=true;});child.stdin.end(options.input);}` and rework the `close` handler to the contract in REQUIREMENTS. Test added exactly as specified above. No other files touched.

### EXECUTION_DAG (remaining scope)
- **T01 — Review PR #1130.** Deps: none. Steps: read `git diff --merge-base origin/main dot/audit-0918-rc-stdin`; confirm it matches the design above exactly; confirm no changes to command admission, exit-code semantics on failure, or other exports. Check Devin Review / reviewer comments (capy-ai is out of credits — bot comments non-blocking). Done-when: reviewer records verdict on PR or on this issue.
- **T02 — CI watch.** Deps: T01. Watch the 9 pending checks: Tests shards 1–4, Hermes contracts, Windows checks, Browser tests, Desktop build, Installed desktop memory retention and opt-in. `Browser tests` has a known main-wide/environmental failure signature (see #891 review note); if it fails on this PR, rerun once and compare against the same check on a sibling green PR before treating as blocking.
- **T03 — Merge.** Deps: T01+T02 green and no open review comments. Merge via normal Git merge (no bypass). PR is mergeable at `da1a654d`; if main advances first, re-verify mergeability (files touched: common.ts + test only — low conflict risk) and re-run affected checks.
- **T04 — Post-merge verification.** Deps: T03. On merged main: `pnpm exec vitest run tests/rc-review.test.ts --maxWorkers=1` expect 16/16; confirm the merged SHA on origin/main; post merge checkpoint on this issue per AGENTS.md (SEPARATE ready/merged/verified-on-main).

### VALIDATION
- Already executed (PR branch, worker-reported): `vitest run tests/rc-review.test.ts --maxWorkers=1` 16/16 PASS; `tsc --noEmit` PASS; whitespace check PASS; baseline red repro confirmed (unhandled EPIPE before fix).
- Planned: PR CI rollup green; post-merge `vitest run tests/rc-review.test.ts` on main.
- Negative: regression test asserts exit-3 case still rejects with `exited 3` (no swallowed exit status) and exit-0+failed-write is not success.
- Acceptance matrix: (1) no unhandled stdin error crash — test; (2) failed input write + exit 0 → rejection — test; (3) nonzero exit preserved with stdout — test; (4) callers without `input` unchanged — code inspection.

### STATE
- Implemented: full fix + regression test @ `da1a654d` on `dot/audit-0918-rc-stdin` (pushed).
- Pending: independent review, 9 CI checks, merge, post-merge verify.
- Risks: `Browser tests` environmental flake may force a rerun; main advanced to `7ef0710` since branch base `eb46020` — recheck mergeability at merge time (scoped files unchanged on main).
- Exact next step: T01 review verdict on PR #1130.

### REFERENCES
- PR: https://github.com/skytuhua-org/Gen-V1/pull/1130 · branch `dot/audit-0918-rc-stdin@da1a654d`
- Issue checkpoints: comment-7035578719, -7035595824, -7035658957 (001–004)
- Files: `scripts/rc-review/common.ts`, `tests/rc-review.test.ts`, `scripts/rc-review/flags-off.ts:10`
- File attachment: GitHub `.md` issue upload unavailable via `gh`; this plan lives in the issue body (HANDOFF_COMPLETE — no external file required).

