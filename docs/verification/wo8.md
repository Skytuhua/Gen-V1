# WO-8 approved redesign — 2026-11-11

This redesign implements tuhua’s 11:23 AM approval of `ledger/WO-8/redesign/design.md`, the six 1440px mocks, and their HTML prototypes. It supersedes the earlier adjacent-value layout and visible message role badges described below. Existing WO-8 copy cuts and fixed semantic color pairs elsewhere remain in place.

| Before | After | Why |
| --- | --- | --- |
| Adjacent bold values; compact tables | Right-aligned, regular usage values; 728px tables | Restore the approved reading order and spacing |
| Ungrouped counts and inconsistent percentage precision | Grouped actual numbers; one decimal in percentages | Keep counts comparable and preserve `0012` as text |
| Tinted Limits tab, red close icon, raw reset timestamp | Neutral tab/close icon; local short date/time with a four-digit year | Match the approved design and its explicit date exception |
| Visible role badges and literal fragment links | Accessible role text; underlined links; signed add/remove color pairs | Restore the 760px conversation and retain non-color cues |

All icons remain the repository’s Lucide icons. No dependency, API or persistence changes were introduced. The arbitrary prose and unbroken-string Metric regression remains intact; numeric tables still scroll horizontally at narrow widths.

## Verification

- `timeout 300` wraps every build, test and browser invocation. No QA lock is used. Fixture servers run as background children and stop when the browser command ends.
- pnpm uses `/home/box/.local/share/pnpm/store`. pnpm 10’s `exec` and `run` reject the bare `--store-dir` option, so those commands use the equivalent `--config.store-dir=...` setting. `COREPACK_HOME=/tmp/corepack` avoids the read-only system Corepack cache.
- Typecheck, production build (with `--configLoader runner`) and `lint:ui`: pass. Vite’s runner avoids writing bundled config files into the shared, read-only dependencies. Existing bundle-size warnings remain.
- Targeted Vitest: 69 passed across seven files (colors, usage, task interface, everyday catalog, preferences, chat layout, public source).
- Browser suites: WO-8, usage/context, Markdown, everyday data, task interface and chat view modes. Final result: 92 passed, one existing skip. The long metric regression covers both themes at 1440/1024/768; numeric table tests include 375px and a 200% viewport equivalent.
- No repository-wide lint script exists. Biome’s recommended rules plus explicit React rules report the same 137 errors, 69 warnings and 28 informational findings on the pre-redesign merge and the final sources. The diagnostic category/severity/message multisets are identical: no new lint findings. These pre-existing issues were not changed by this redesign.
- First-pass review traced the changed renderers and callers. Independent QA, physical Windows and custom-appearance acceptance remain separate gates. The historical full-suite failures below were not rerun or represented as green.

## Captures and workspace

The [redesign comparisons](../screenshots/wo8/redesign/README.md) show metrics, Usage Limits and thread/diff in dark and light at 1440 × 900, with full-height metrics captures for the content below the fold. Before is PR head `ab167277ee993e294dc320c422a23f5a193efa3f`, captured before UI changes. Main `8db06df5a63d26fcaac3beaa75153dd2f1f478e9` was then merged normally; the only conflict kept both public-source allowlist entries.

Tests and captures write to Playwright output directories or `/tmp/wo8-redesign-evidence`, never the ledger. After verification and publication, a separate explicit copy places the 16 before/after PNGs in `/home/box/gen-company/ledger/WO-8/redesign/captures/`.

The existing worktree’s unrelated changes were preserved in `/home/box/work/Gen-V1-wo8-preserved-20261111`. Initial shared Git metadata was read-only, so the requested clean worktree uses writable metadata at `/tmp/wo8-redesign-git`. After the session’s writable roots changed, final verification and publication use the identical source snapshot at `/tmp/wo8-final`; no protected source files were overwritten.

skills: engineering-team-process (resolved at `/home/box/sand-data/workflows/engineering-team-process/SKILL.md`), ponytail, emil-design-eng, ponytail-review; Astryx consulted under the approved-design constraint.

---

## Historical verification before this redesign

# WO-8 verification

What this change does: Applies the supplied copy cuts, fixed semantic colors and label/value pairing to production surfaces on main. Unmerged WO-5/WO-6 features remain on their branches; their exact copy, token and pairing follow-ups are recorded in the WO-8 ledger decisions and PR body.

| Before | After | Why |
| --- | --- | --- |
| Usage values occupy the opposite edge | Content-sized definition columns with an 8px gap | Keep labels and values together |
| Generic metrics, progress and project counts spread apart | Adjacent values, with independent actions retained at the edge | Preserve the owning label and reading order |
| Known numbers share text alignment and may wrap inside artifacts | Explicit numeric table metadata; right alignment, full numbers and horizontal scrolling | Preserve numeric meaning and text codes such as `0012` |
| Volume output sits with the distant slider | Output sits next to Sound volume and remains associated with its range | Keep the setting value with its label |
| Grayscale roles/types and untinted diff lines | Fixed accessible foreground/background pairs plus labels, extensions and signs | Color accompanies an explicit non-color cue |
| Shared browser results use a separate hidden output root | Results use `test-results/browser/run-*` | Keep test/capture writes in the authorized output locations |

## Results

- `pnpm typecheck`: passed.
- `pnpm lint:ui`: passed, zero violations.
- `pnpm build`: passed; existing large-chunk advisories remain.
- Targeted Vitest: 34 passed, including colors in both themes, numeric schema metadata, public-source, browser-runner, loading states and presentation.
- WO-8 browser-runner suite: 14 passed. Both themes, narrow panels, 200% viewport equivalent, complete numeric values, keyboard scroll focus, and actual inline-artifact numeric rendering are covered.
- Existing related Playwright: 97 passed (Usage/context 20, Files 44, everyday data 11, software diagnostics 7, task interfaces 6, Settings 9). Linux Chromium was used in place of authored Windows Chrome/Edge channels; temporary fixture servers used separate optimizer caches and were stopped afterward.
- Full Vitest was run on WO-8 and an isolated `origin/main` export with two workers. Both fail the same 58 files / 216 tests and report four errors. Main passes 2,172 tests; WO-8 passes 2,175. There are no WO-8-only failure headings. Missing native PTY/build tools, the unavailable Linux guard broker, Windows-only SDK binaries and optional Python integration inputs prevent a full green run in this environment.

All test/capture output was produced in Playwright output directories, `test-results` or `/tmp`. After the scoped checks passed, a separate explicit step copied 112 PNGs and verification logs into `/home/box/gen-company/ledger/WO-8/`. The [16 PR comparisons](../screenshots/wo8/README.md) cover 1440px dark/light before/after; the ledger also contains 1024px secondary captures for every captured surface. Before captures use isolated main `d72030013715ec94d023195d852562d7d34bc4f4`. All fixture content is synthetic.

No QA report existed at resume; this is an implementation first-pass review, not an independent QA verdict. No unresolved blocker/major issue was found in the changed code. No QA minor findings were supplied. Physical Windows rendering and forced-color/custom-appearance acceptance remain follow-ups.

The sandbox protects the worktree's Git index. The published commit is created through a temporary index and the permitted common Git directory, and pushed normally using gh authentication. Protected local checkout metadata remains at WIP `ee16021`; its working files match the published change and need metadata synchronization outside this sandbox.

skills: impeccable, emil-design-eng, ponytail, ponytail-review, engineering-team-process; Astryx consulted under the existing-style constraint. The process skill resolved at `/home/box/sand-data/workflows/engineering-team-process/SKILL.md`.

## QA round 1

The major finding in QA r1 is fixed. `Metric` accepts arbitrary text, so its value now has normal whitespace, `overflow-wrap:anywhere`, `min-width:0` and `max-width:100%`. The approved 8px label/value gap, weight, color and short numeric/unit pairing remain. No backend or contract changes were needed.

Repro first: six actual inline-artifact checks failed on reviewed head `08616a3`, measuring long values outside their owner. The same six pass after the fix at 1440/1024/768px, dark and light. The full WO-8 browser suite passes 20 tests. Updated [1440px screenshots](../screenshots/wo8/README.md#qa-r1-long-metric-strings) show the complete strings. Test/capture output remained in `/tmp`/Playwright outputDir; a separate explicit copy updated the ledger after scoped checks passed.

Merged `origin/main` at `bef62398d95e26e254b8647d73c46bb451c634e4`, preserving its ChatView and project-search changes together with existing WO-8 copy/colors. Relevant unit tests: 159 passed. Merge regression suites: Files 44, chat modes 21, project search 38 passed. Two new-main project-search assertions were aligned with existing WO-8 copy. One chat-animation wait timed out initially; unchanged code passed the full rerun, and the isolated test passed on main. Initial and final logs are retained. Full Vitest: 58 failing files / 216 failed tests; 2300 passed, 35 skipped and four errors. Failure headings match the prior verified baseline; all names and logs are recorded under `ledger/WO-8/qa/r1-fix/`.

QA minors remain follow-ups: activity messages are labeled Tool, and folder/file retry buttons share the accessible name Retry. Process/Windows acceptance gaps in the QA report are unchanged except that main now supplies docs/feature-map.md. This implementation check does not replace independent QA re-review.

skills: engineering-team-process, ponytail, ponytail-review; test-driven-development, receiving-code-review and verification-before-completion applied.
