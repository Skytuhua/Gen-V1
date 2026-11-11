# WO-3.4 round-3 evidence

skills: ponytail, review-animations

Measured head: `709a4729a3f09a445fa3281393aa0c8cf9c40d01`.
Baseline: `d72030013715ec94d023195d852562d7d34bc4f4`.
The final PR publishing head is recorded in the PR body; this round changes
documentation and evidence only. Runtime/spec hashes are in [summary.json](summary.json).

| Before | After | Why |
| --- | --- | --- |
| Feature map names missing `Composer.tsx` | `App.tsx` owns composer state; `ComposerView.tsx` owns the view | All 12 documented owner paths now exist; the path check failed before the correction |
| 27 baseline files failed before collecting tests | Built widget assets and authentic compiled `node-pty` 1.1.0 in temporary checkouts; all 58 files collect | Remove the import failures that masked test execution |
| No independently linked complete tiled move strip | [Top](move-top.png) and [bottom](move-bottom.png), 0/90/180 ms | Include initial, midpoint and final positions; adjacent pixels differ |
| Partial post-publication capture commands | Separate finite production-bundle captures, both exit 0 | Collect all required states without a persistent Vite watcher or a merged-run pass claim |

## Functional checks

- Typecheck with `--extendedDiagnostics`: **exit 0**, 22.22 seconds on the repaired dependency path.
- UI lint: **exit 0**, 446 sources, zero violations.
- Browser-runner/public-source Vitest: **exit 0**, 21 passed across two files.
- Existing `scripts/test-browser.ts --suite thread-move`: **exit 0**, 24 passed.
- The original bounded typecheck attempts exited **124**; their logs are retained.
  The successful diagnostic run adds reporting only; it does not disable checking.
- The reconnect left the untracked dependency link pointing to a deleted worktree.
  It was repointed to an existing directory with every declared package version matching.
  No project dependency, package manifest, test assertion or security guard was changed.

The desktop `open=false` motion contract and keyboard/reduced-motion behavior
remain covered by the same 24-case suite. Round 2 already recorded the new
closed-drawer tests failing on the old gate at both desktop widths; no runtime
implementation changed in round 3.

## Prepared baseline: complete collection, restricted execution

| Run | Exit | Files collected | Passed | Failed | Existing skipped | Unhandled errors |
| --- | --- | --- | --- | --- | --- | --- |
| Head | **1** | **58/58** | 334 | 245 | 1 | 4 |
| Main | **1** | **58/58** | 334 | 245 | 1 | 4 |

All 580 tests are collected on each side. The comparison has **zero new failed
identities**, with zero collection errors. This supersedes the earlier comparison
that collected only 31 files. The single skipped terminal test is already
Windows-only in the source; this work did not skip or exclude any test.

Neither baseline run passes. In each run, 137 failed-test messages mention the
real filesystem guard and four reference the unavailable Windows Cursor package;
the remaining failures are preserved without reclassification in the reports.
The Linux guard requires trusted inherited FDs 3/4, a verified mount and an
initial-namespace UID mapping. This sandbox lacks those prerequisites. Its
`uid_map` is `1000 0 1`, and both FDs are absent. No guard was mocked or weakened.
Therefore **fully functioning security-boundary baseline equivalence remains
unverified**; it needs a compatible runner. Matching restricted runs are not a
green baseline or evidence that masked operations would succeed.

Widget artifacts were built from each checkout. The pinned native PTY was built
from its real source with a temporary compiler, loaded successfully, and spawned
a real PTY in a smoke test (exit 0). Only temporary node_modules link farms use
that compiled package. Native/setup metadata and exact failure identities are
in [summary.json](summary.json) and the [audit archive](audits.zip).

## Current runtime state and motion captures

Two separate `capture:ui` commands exited **0**:

- `app-shell`: 21 state screenshots, six strips, no capture failures.
- `sidebar-menu`: 21 state screenshots, four strips, no capture failures.
- Both record zero reduced-motion offenders above 1 ms.

The sheets include default, hover, focus, open, empty, error and loading on
both affected screens at [375](states-375.png), [768](states-768.png) and
[1440](states-1440.png). Raw per-state PNGs, manifests and motion tables remain
under `/home/box/gen-company/ledger/WO-3/qa-r3-3.4/captures/`.
Fixture sidebar-menu captures do not certify the actual phone host's menu flow.

Fresh [top](move-top.png) and [bottom](move-bottom.png) strips are from actual
pointer moves with manual ordering and a closed mobile drawer on desktop.
The four/six affected rows use 180 ms, `cubic-bezier(0.4, 0, 0.2, 1)`, delay 0,
and transform-only keyframes. Every adjacent frame differs; hashes and channel
deltas are recorded. Additional 768/1024 samples are in the raw capture directory.
The [round-2 clips](../wo-3.4-r2/README.md#motion-and-layout) remain historical
recordings of the identical runtime behavior, not newly dated recordings.

## Web-quality audit: failures reproduced on main

The static production-bundle audit closes its HTTP server and browsers on exit;
no build watcher is used. Ports 5704/5714 refuse connections after completion.
Head and main use the same synthetic API data and the same audit settings.

Both audit commands **exit 1**. Axe findings match by rule, width, state and
affected-node count: visible-label/accessible-name mismatches in five completed
scans, plus a target-size finding in 768/1440 menu states. The actual-app phone
menu check fails on both: focus returns to Search and the menu is absent after
clicking Options. That check is a failure, not an empty successful axe scan.
Incomplete axe items require manual review; no full WCAG conformance is claimed.

| Width | Head perf / a11y / best practices / SEO | Main, same settings |
| --- | --- | --- |
| 375 | **59** / 100 / 96 / 90 | **59** / 100 / 96 / 90 |
| 1440 | **47** / 96 / 96 / 90 | **47** / 96 / 96 / 90 |

These Lighthouse runs use its default simulated throttling, not round 2's
unthrottled configuration. The static server returns a genuine 404 for absent
robots.txt instead of a development-server HTML fallback. Different scores from
round 2 do not represent source fixes or relabeled earlier results. The current
performance scores are below the 90 bar on both head and main.

Pointer-move CLS is **0** (including raw recent-input entries) at 768/1024/1440;
surrounding main geometry is unchanged. Full navigation CLS is **not zero** on
both head and main: 0.00384737 / 0.00258060 / 0.00123492 at 375/768/1440.

Motion preflight: **approve**. The broader web-quality bar is **not green** on
either branch. The comparisons provide evidence of matching existing failures;
they do not certify a passing app, manual WCAG compliance, physical devices or
a live provider. No unrelated phone, accessibility, SEO or runtime fix was made.
Windows CI billing and privileged guard prerequisites cannot be repaired by this
PR's evidence changes. No merge, readiness promotion or deployment was performed.
