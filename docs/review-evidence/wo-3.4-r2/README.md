# WO-3.4 round-2 evidence

skills: ponytail, review-animations

For the corrected owner map, prepared baseline collection and fresh finite
production captures, see the [round-3 evidence](../wo-3.4-r3/README.md).
The results below are retained as historical round-2 measurements.

Measured source: `82d795829be621538fe6bbac72411a2a6d3b6e8a`.
The desktop gate fix is `71101ef2b224014a672a402f492bc4c7fe757182`.
Subsequent publication changes only documentation and the source allowlist;
[summary.json](summary.json) records the exact runtime/spec SHA-256 hashes.
The PR body names the final publishing head separately. These measurements use
synthetic host data and bundled Chromium, not a live provider or physical device.

## Results, including failures

| Check | Actual result |
| --- | --- |
| `pnpm typecheck` | Exit 0 |
| `pnpm lint:ui` | Exit 0; 446 sources, zero violations |
| Browser-runner and public-source Vitest | Exit 0; 2 files, 21 passed, zero failed; Vite runner required by read-only node_modules |
| Existing UI verify script, `pnpm exec tsx scripts/test-browser.ts --suite thread-move` | Exit 0; 24 passed, zero failed; boots Vite/Playwright and drives the flow |
| New fixture/spec on old `7a7addc` implementation | Exit 1; 2 failed, zero passed, at 1024 and 1440: order changed but zero of four expected animations appeared |
| Named 58 baseline files on measured head | Exit 1; 58 failed files, 216 failed / 156 passed tests; 4 unhandled errors |
| Same 58 files on `d720300` main | Exit 1; 58 failed files, 216 failed / 156 passed tests; 4 unhandled errors |
| Baseline comparison | Zero new failed-test/file-error identities; neither failing run is a passing suite |
| `capture:ui` | Exit 0; 42 captured states, 12 strips, 140 motion records; zero output failures or reduced-motion offenders above 1 ms |
| Additional web-quality audit | **Exit 1**: axe violations, unavailable phone menu audit and Lighthouse SEO below 90 |
| Windows CI | **Failure**: billing/spending-limit annotation says the job never started; CodeRabbit skipped |

No full `pnpm test` run was made. Raw baseline JSON/logs remain in the ledger
because their environment failures are not a new thread-move regression.
The [audit archive](audits.zip) contains functional logs, motion/state manifests,
axe and Lighthouse reports, CI annotations, and the supplemental reproducer scripts.
The [feature map](../../feature-map.md) identifies the existing reusable UI runner;
no package script or product dependency was added.

## Screens and states

Each sheet contains both `app-shell` and `sidebar-menu` at native capture scale,
with default, hover, focus, open, empty, error and loading states (14 tiles each).

- [375 state screenshots](states-375.png)
- [768 state screenshots](states-768.png)
- [1440 state screenshots](states-1440.png)

All 42 individual PNGs and the complete capture index are under
`/home/box/gen-company/ledger/WO-3/qa-r2-3.4/captures/ui/`.
The sidebar-menu shots are explicitly fixture captures; they do not turn the
failed actual-app phone menu probe below into a passing test.

## Motion and layout

| Before | After | Why |
| --- | --- | --- |
| [Main: instant jump](3.4-before.gif) | [Current runtime: pointer FLIP](3.4-after.gif) | Follow the deliberately moved thread without animating keyboard actions |
| Mid-motion-only evidence | [Complete top strip](thread-move-top.png), [bottom strip](thread-move-bottom.png) | Include 0 / 50 / 100 percent, not only settled frames |
| No measured layout-shift evidence | PerformanceObserver entries in summary/archive | Distinguish thread-move CLS from initial application navigation |

The [after WebM](3.4-after.webm) and GIF are 1440×1000, 2.80 seconds, from a real
pointer Move to top with manual ordering and `open=false` on desktop.
Four affected rows animate for 180 ms, `cubic-bezier(0.4, 0, 0.2, 1)`, delay 0;
the subsequent bottom move affects six rows. Frames are transform-only.
Top strip: 0/20/45/70/90/120/150/180 ms; bottom strip: 0/90/180 ms.
Every adjacent pair within each strip differs; pixel hashes and maximum channel
deltas are in summary.json. There is no before strip because main jumps instantly.
The supplemental keyboard and OS reduced-motion moves observed zero row animations.

Pointer-move CLS is **0**, including raw shifts with recent input, at 768/1024/1440;
the surrounding main rectangle is identical before/after.
Full production-bundled navigation CLS is **not zero**: 0.00384737 at 375,
0.00258060 at 768 and 0.00123492 at 1440. This includes startup and the audit flow;
it is not presented as a clean full-page CLS audit.

## Accessibility and Lighthouse

Automated axe tags: WCAG 2 A/AA, 2.1 A/AA and 2.2 AA. Results are **not a WCAG
conformance claim**: accessible-name/visible-label mismatches were found in all
five completed scans (two affected nodes at 375; four at 768/1440). Open menus at
768/1440 also have one target-size finding. Incomplete items need manual review.
The actual-app 375 menu probe timed out after clicking thread options; that scan
did not complete and is recorded as failed, not as zero violations.
Completed scans measured no horizontal document overflow.

| Production-bundled synthetic app | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| 375 | 100 | 100 | 96 | **82** |
| 1440 | 100 | 96 | 96 | **82** |

Lighthouse used the actual Vite production bundle with synthetic API responses
and local, unthrottled Chromium. SEO misses include the absent meta description
and invalid/missing robots response; the favicon returns 404. These are failed
measurements against the 90+ bar, not exemptions or changes made by this PR.
Scores are a local fixture measurement, not a deployed preview acceptance test.

An initial axe harness attempt exited 1 because the shorthand browser page did
not permit axe's additional context page. A second attempt exited 1 on the
actual-app phone menu timeout. Their logs are retained in the archive. The final
audit completed the other measurements and still exited 1 for the reported findings.

Motion-contract preflight: **approve**. General web-quality status: **not green**.
No phone redesign, unrelated accessibility/SEO fix, CI billing change, merge or
deployment was performed. The independent QA/owner decision remains separate.
