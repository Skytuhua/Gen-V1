<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1116 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META
- Feature: Worker-2 developer-tools/data refinements (UIs 05,06,07,08,10,11,12) + compact design pass.
- Repo: skytuhua-org/Gen-V1. Plan rev 1, 2026-11-20.
- Baseline: `main@7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified).
- Issues/PRs: this issue #1116; implementation PR [#1127](https://github.com/skytuhua-org/Gen-V1/pull/1127) `refine/developer-tools-data@96a150c4` (mergeable); stacked compact-design PR [#1142](https://github.com/skytuhua-org/Gen-V1/pull/1142) `devin/1795159200-w2-compact-design@43f0ce97` targeting `refine/developer-tools-data` (mergeable, retargets to main automatically once #1127 merges).
- Status: Worker-2 implementation DONE at `b5144b92` + 4 Devin Review fixes at `96a150c4` (all review threads resolved); QA on #1142 PASS (responsive/keyboard/regression at 1440/768/375). **Work paused by maintainer when team switched to review-only; this plan covers remaining scope only: re-review #1127 → CI → merge → resume decision + merge #1142 → verify.**
- Provenance: issue checkpoints (devin-web-2162c5 CP005, devin-cloud-rev41 CP002–004, devin-qa-compact-36d862 CP001) + live PR reads.

### OBJECTIVE
Merge PR #1127 then PR #1142 so the seven refined surfaces and the approved compact design land together. Success: both merged, main HEAD green, no open review threads.

### REQUIREMENTS
- In scope: independent re-review of #1127 at `96a150c4`; fetch the 2 Devin Review flags not posted to the PR (https://app.devin.ai/review/skytuhua-org/gen-v1/pull/1127); CI watch (10 pending incl. Markdown links); merge; then evaluate/merge #1142; post-merge verification.
- Out of scope: further design work, re-implementation, new scope, closing #1142 without maintainer direction (it was PAUSED by maintainer — resuming needs that same approval; if not resumed, leave open and documented, do not merge silently).
- Gates: (1) no unresolved review threads on #1127; (2) all required checks green on both PRs; (3) #1142 merges only after #1127 (stacked; retargets automatically); (4) no code edits by the reviewing worker beyond mechanical conflict repair.

### REPO_MAP (verified)
- `apps/web/src/SoftwareDevelopment.tsx` + `software-development.css` — UIs 05/06/07/08 (diagnostics, change-set patchLines/ChangeSet, API explorer, pipeline).
- `apps/web/src/EverydayData.tsx` + `everyday-data.css` — UIs 10/11 (statistics, comparison).
- `apps/web/src/CredentialEntry.tsx` + `credential-entry.css` — UI-12.
- Specs: `tests/e2e/clarity-software*` (36 tests), `everyday*` configs (14), `tests/credential-entry-ime.test.ts`, `tests/credential-slots.test.ts` (22+34). `pnpm build:widgets` needed once per fresh checkout for credential vitest.
- Review-fixed commit `96a150c4`: patch overflow scoped selector, scroll-restore reset for unvisited files, cellAnimations active-only tracking, idempotent usePublicationEntrance disposer.
- Known pre-existing failure (unrelated, verified on clean main): `tests/runtime-pi.test.ts:148` providerId typecheck error — do not block on it; DO confirm typecheck failure set is identical to main's.

### DESIGN — remaining procedure (exact, zero open design decisions)
1. Re-review #1127 diff vs merge-base: seven-surface scope, shared motion machinery (pointer-only opacity handoffs, entity-keyed check effects, `data-entry-phase`-gated ornaments), responsive rules (diagnostics two-pane ≥640px via `clamp(220px,calc(100% - 416px),240px) minmax(0,1fr)`; paired API flow only with request example AND >540px; pipeline linear-chain rail below/above 616px for 1–4 stages), lossless state (per-file patch scroll restore + "Patch updated" marker, "Trend unavailable"/"No trend values supplied" cases, intent-versioned preference receipts, checking/saving/removing credential labels).
2. Fetch the 2 un-posted Devin Review flags on #1127; classify each real-vs-noise; if real, post HANDOFF_BLOCKED on this issue with the finding (no silent fixes by reviewer; fixing is the implementation worker's scope unless trivially mechanical).
3. CI watch on both PRs; treat `Browser tests` flake per #891 note (rerun once, compare signature).
4. Merge #1127 when green + threads resolved. Then confirm #1142 retargeted to main, recheck its mergeability + CI, and merge **only if the maintainer resume is in effect** (checkpoint 004 recorded stop per maintainer; verify current direction before merging).
5. Post-merge verify per VALIDATION; post AGENTS.md merge checkpoints on this issue for each PR.

### EXECUTION_DAG
- **T01 — Re-review #1127 + fetch unposted flags.** Deps none. Done-when: verdict + flag disposition recorded on this issue.
- **T02 — Merge #1127.** Deps T01 clean + CI green.
- **T03 — Resume decision + merge #1142.** Deps T02. Verify maintainer direction; then retarget check, CI, merge — or document pause with exact state.
- **T04 — Post-merge verification.** Deps T02 (+T03 if merged). Commands below.

### VALIDATION
- Already executed: #1127 typecheck clean, lint 0, diff --check clean, clarity-software 36/36, everyday 14/14, credential vitest 22/22; #1142 vitest 56/56, same e2e suites, QA visual PASS at 3 widths + keyboard + no overflow.
- Planned on merged main: `pnpm build:widgets` once, then `pnpm exec vitest run tests/credential-entry-ime.test.ts tests/credential-slots.test.ts`; `pnpm exec playwright test --config tests/e2e/clarity-software.playwright.config.ts` (36) and everyday config (14); `pnpm typecheck` — accept only main's pre-existing `tests/runtime-pi.test.ts` failure set.
- Acceptance: (1) #1127 merged; (2) #1142 merged or documented-paused; (3) main verified green; (4) all review threads resolved.

### STATE
- #1127: implemented+review-fixed+resolved @96a150c4; awaiting re-review + CI.
- #1142: implemented+QA'd @43f0ce97; open, paused per maintainer.
- Risks: maintainer resume status for #1142 is external state — confirm before T03; `Browser tests`/`Markdown links` pending checks may flake.
- Exact next step: T01 fetch the 2 unposted Devin Review flags at https://app.devin.ai/review/skytuhua-org/gen-v1/pull/1127 and record verdict.

### REFERENCES
- PRs: https://github.com/skytuhua-org/Gen-V1/pull/1127 , https://github.com/skytuhua-org/Gen-V1/pull/1142
- Design-review plan: issue comment-7035939376. Checkpoints: devin-web-2162c5 CP005 (comment ~10:05Z), devin-cloud-rev41 CP004 (pause), devin-qa-compact-36d862 CP001 (QA PASS).
- Canonical Worker-2 plan: `docs/agent-plans/worker-2-developer-tools-data.md` (PR #1127 commit 5279cf2).
- File attachment: `.md` upload unavailable via `gh`; plan lives in issue body (HANDOFF_COMPLETE).

