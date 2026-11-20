<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1115 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1) — remaining scope only

### META
- Feature: Worker 3 remaining work — UI29 context inspector, then recordings + PR
- Repo: skytuhua-org/Gen-V1 · Plan rev: 1 (2026-11-20) · Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3`; worker branch `refine/forms-charts-motion` based on `26ddf4d16c2fc1196b520d8a46c5441d64d01463`
- Issue: #1115 · Active worker: `devin-cloud-636f3f` (checkpoint 007, UTC 2026-11-20T10:17Z). Progress: T13/T14/T15/T22/T23/T24/T26 DONE-VERIFIED at HEAD `c6fdab19`; **remaining: T29 (UI29), T-RECORD (8 MP4s), T-PR (push + PR)**. Branch is UNPUSHED — absent from `git ls-remote`; work lives in the worker's local worktree `/home/ubuntu/worker3/src` on its VM.
- Source provenance: review by devin-a-cloud-9c41e2; spec text quoted from the canonical plan (issue comments PLAN PART 2/2 and the pinned .md).

### OBJECTIVE
Finish the last unimplemented interface (UI29 context inspector) exactly per the canonical plan, then produce the eight required MP4s and land the branch. Success = UI29 browser acceptance green + 8 validated 1920×1080/30fps MP4s + pushed branch + PR.

### REQUIREMENTS (in scope — remaining tasks only)
- T29 UI29 must satisfy the canonical §29 implementation + browser acceptance (full spec in DESIGN).
- T-RECORD must produce `13-review-queue.mp4`, `14-editable-table.mp4`, `15-parameter-controls.mp4`, `22-faq-disclosure.mp4`, `23-source-tables.mp4`, `24-chart-variants.mp4`, `26-form-controls.mp4`, `29-context-inspector.mp4` — 1920×1080, 30 fps, H.264, real-time compositor, decode-clean to EOF, per-file SHA-256 + `manifest.json` + `review.md`.
- T-PR: `pnpm typecheck`, `pnpm lint`, `git diff --check`, stage explicit source/test paths, commit, push `refine/forms-charts-motion`, open PR.
- Out of scope here: T13–T26 (already VERIFIED per checkpoints); any re-design.

### REPO_MAP (verified on baseline; worker's tree extends it)
- `apps/web/src/ContextInspector.tsx` — `ContextSession`, `ownedCompaction`, `acceptedCompaction`, `contextSegments`, `Category`, shared `Popover` (packages/ui-shell/Popover). Confirmed: `acceptedCompaction` reconciles receipt `{beforeTokens, afterTokens, contextWindow}` against measured segments (freed = before−after only when `before<=window`, `after<=before`, `window===measured.total`, `after===measured.used`).
- `apps/web/src/ContextMeter.tsx` — `.context-meter` group + `context-measurement-accepted` marker class (line 69).
- `apps/web/src/context-inspector.css` — line 10 has the offending `transition:width var(--ui-motion-receipt) var(--ui-ease-move)` on `.context-measurement-accepted .context-segment`; line 44 has the reduced-motion overrides block (`.context-category-detail.ui-popover`, `.context-inspector.ui-popover`, `.context-compaction-shimmer`, `.context-measurement-accepted .context-segment`, `.context-receipt-pulse`).
- `tests/e2e/usage-context.spec.ts`, `tests/e2e/usage-context-fixture.tsx`, `tests/e2e/operational-motion.spec.ts`, `tests/e2e/context-compact.spec.ts` — acceptance fixtures/specs; fixture actions `categories`, `request-compaction-many`, `foreign`, `unmeasured`, `accepted`, `restart` (receipt id `receipt-one`, before=8000, after=4000, window=10000).
- Recorder seed: `scripts/record-task-design.ts`, scenes from `tests/e2e/task-design-scenes.ts`; fixture host on :4317 + Vite; `CAPTURE_OUT` env.

### DESIGN (UI29 exact spec — implementer makes zero decisions)

1. **Intrinsic height** — Keep dialog width 328 px, padding 12 px, section gap 12 px, header/body/footer DOM order, two-column category grid. Wrap all body content in one natural-flow inner div; register it via callback ref so measurement starts after the Popover portal mounts. Local numeric `requestedHeight`, initial estimate 200 px; after mount, layout-time measure intrinsic body content + real top/bottom padding, border, visible header/nav/footer and flex gaps in CSS px (offsetHeight or untransformed ResizeObserver border-box) — exclude portal transform/zoom. Round up once; update state only on change. Use inner body's intrinsic height even when the outer scroll body is clamped.
2. **Observers** — ResizeObserver on the inner content and each fixed band; reattach on nav/band changes; content wrap, font load and evidence expansion trigger re-measure; disconnect on close/identity change. Body stays `flex:1; min-height:0; overflow:auto`; header/footer non-shrinking; feed requested size to the existing Popover (it owns clamping/reposition). Baseline six categories ≈ 210–225 px; acceptance: ≤2 CSS px unused body space unconstrained.
3. **Category tooltips** — Replace per-Category 120 ms hover/focus timers with one group-owned active-category state + one cancellable 200 ms dwell timer in ContextMeter. First pointer hover: 200 ms. Pointer transfer to another category inside the same grid: immediate switch. Pointer through grid whitespace retains warm state until pointer leaves the grid. Pointer entry animation: opacity .85→1 over 125 ms. Keyboard focus opens immediately, no entrance. Escape closes the nearest shown tooltip and keeps focus on its button; suppress reopen until next focus or fresh pointer entry. Keep PageUp/PageDown scrolling and tooltip descriptions. Track focused ID and hovered ID separately; keyboard focus has priority until blur. On grid pointer-leave discard hover ID + timer; retain focused tooltip only while a keyboard-focused ID remains; on focus leaving the group clear focused ID; if pointer still inside, continue its hover state. Clear both on owner change/unmount.
4. **Source updates** — Remove the `.context-measurement-accepted .context-segment` width transition (context-inspector.css:10). Every source update renders exact validated absolute values, proportions, unknown fields and partial-breakdown copy together. During compaction hold last valid reported counts until fresh valid data. Restore unknown state on thread/session ownership change, revoked evidence, or explicit invalid source report. No predicted freed count. Keep existing pending/failed/cancelled copy and command gates.
5. **Receipt acknowledgment** — Only a new matching accepted receipt from `acceptedCompaction` triggers one local 160 ms footer opacity/color acknowledgment. Key by receipt ID per owned run/session; establish the initial ID as baseline so reopening never replays. Keep all ID/run/session/epoch checks and numeric reconciliation for `Freed N`. Shorten the existing 600 ms local receipt flag timer to 160 ms; no minimum busy dwell. Reduced/off ends motion and suppresses shimmer/entrance/receipt travel. Do not modify shared Popover.

**Browser acceptance (exact tests):**
- New `six reported categories fit intrinsically and long evidence stays within the viewport` in usage-context.spec.ts: `update(page,'categories')` (6000/10000, six categories) → click `Inspect context`; at 1440×1000 and 390×844 assert `.context-inspector-body.clientHeight` vs inner natural height diff ≤2 CSS px, no vertical clipping; at 390×300 `request-compaction-many` → Compaction tab → open Retained constraint references → `Show 2 more references`; assert `scrollHeight > clientHeight`, shell fits viewport margin, footer fully visible while body scrollTop changes.
- Rename/extend `reported categories reveal token/share/subitems on focus after dwell; IME and nested Escape work` → `reported categories open immediately on focus and after dwell on first pointer hover`: Playwright clock before navigation, freeze after fixture readiness; hover Tools & MCP, advance to 199 ms → tooltip absent; +1 ms → `500 tokens` and `Reported tool instructions` appear; hover adjacent Skills without leaving grid → immediate tooltip; move outside, keyboard-focus Tools & MCP, composing Escape then plain Escape then Escape again; keep existing nested-Escape/restored-focus assertions.
- In the accepted-receipt test use fixture actions `foreign`, `unmeasured`, `accepted`, `restart` for authority coverage; separate fresh fixture with `categories` + `accepted` twice, same ID `receipt-one` (before=8000, after=4000, window=10000): exactly one footer acknowledgment, never a width transition, `Freed 4K tokens` matches receipt data. Update `accepted transition uses reference timing…` test: replace asserted 600 ms segment animation / 0.6 s transition / 0.24 s footer with zero animated factual widths, exact first-frame proportions, 0.16 s footer. Keep `.context-measurement-accepted` marker for the 160 ms window (invalidating-a-receipt test still verifies immediate cancellation). Keep reduced-policy checks; run context-compact smoke unchanged.
- Run commands: `pnpm exec playwright test --config tests/e2e/usage-context.playwright.config.ts tests/e2e/usage-context.spec.ts --grep 'categories|segments|receipt|accepted transition|pending sweep|category|six reported'`; `pnpm exec playwright test --config tests/e2e/frontend-refinement.playwright.config.ts tests/e2e/context-compact.spec.ts`; `pnpm exec playwright test --config playwright.config.ts tests/e2e/operational-motion.spec.ts --grep 'context|token decrease'`.

### EXECUTION_DAG
- T29 — UI29 implement per DESIGN items 1–5; deps: worker's current HEAD `c6fdab19`. Done-when: the three acceptance commands pass + typecheck/lint green.
- T-RECORD — Record the 8 MP4s from the exact branch SHA in a separate capture worktree (full recipe in canonical plan §"Record the review videos": `local-w3-catalog.ts` on port 6213 for the 7 catalog scenes, `local-w3-host.ts` on port 6283 for context-inspector; 500 ms pre-publication hold, chapter actions per film, 900 ms final hold; packaging `PYFILMS` script enforces H.264/1920×1080/30 + SHA-256 + manifest). Done-when: `videos/` + `manifest.json` + `review.md` exist, all 8 decode to EOF.
- T-PR — `pnpm typecheck` && `pnpm lint` && `git diff --check`; stage only listed source/test paths; commit; push `refine/forms-charts-motion`; open PR with changed paths, check results, video links, any unmeasured/skipped items. Done-when: PR exists, CI queued.
- T-COMPLETE — CI green + review + merge; post-merge re-verify of a sample spec on main; completion checkpoint with branch/base/result SHAs, counts, video links. Deps: T-PR.
- Ordering: T29 → T-PR commit/push → T-RECORD (from the pushed SHA) → T-COMPLETE. (Recording may start once the final commit exists; per plan, record videos from the exact committed SHA.)

### VALIDATION
- Executed during planning: checkpoint history read (T13–T26 verified with per-suite pass counts); baseline files exist and contain the spec'd defects (`.context-measurement-accepted` width transition present at context-inspector.css:10; branch unpushed confirmed via `git ls-remote`).
- Planned: §29's three Playwright commands; full typecheck/lint/diff-check; `ffprobe -show_streams -show_format -of json` per film (codec h264, 1920×1080, avg_frame_rate 30); `ffmpeg -v error -xerror -i` decode; watch each film once; per-film chapters present in manifest.
- Acceptance matrix: every §29 browser case green; 8 films validate; PR merged with evidence posted; HANDOFF_COMPLETE only after branch is pushed.

### STATE
- Done (per worker checkpoints): T13 ui13 tests, T14 editable table, T15 Split+ParameterControls @17507a01 (39/39), T22 disclosure @f082392e (6/6), T23 migration tables (op-motion), T24 charts @9e2db649 (21/21), T26 delivery preferences @c6fdab19 (16 pass/2 skip).
- Remaining: T29, T-RECORD, T-PR, T-COMPLETE.
- Blocker: the worker's branch is unpushed — if its session is dead, a new worker must either get the pushed branch or re-implement T13–T26 (context preserved in checkpoints + canonical plan); first action is `git push` by the current worker.
- Next step: T29 (devin-cloud-636f3f owns unless reassigned).

### REFERENCES
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1115 (PLAN PART 1/2 + 2/2 comments = complete canonical plan; checkpoints 001–007)
- Pinned plan file: https://github.com/skytuhua-org/Gen-V1/blob/fb0694b911d46afb837bc3dd6e43c5742b450a18/docs/agent-plans/worker-3-forms-charts-motion.md
- Baseline `26ddf4d1`; latest reported HEAD `c6fdab19` on `refine/forms-charts-motion` (unpushed).

