# M05 Windows CI repair record

## Status and immutable source identity

**Current result: run 43726164418 passed all eight jobs with both reviewed fixture repairs.** The [final observed workflow](M05-windows-ci-43726164418.json) records **3,746 application passes/39 skips**, **33 Hermes contracts**, **37 policy/plugin cases**, successful typecheck, UI policy and builds, and **267 browser passes/two skips/zero failed or flaky**. All 29 split baseline cases and all four later suites executed successfully, including the FAQ case with the exact `Collapse artifact` focus assertion. Production source and every pre-existing assertion remain unchanged. This is a pass for the recorded source/test cut; activation remains disabled and native FILE, installed-desktop and live-study proof remain open.

The previous [run 43724428807](M05-windows-ci-43724428807.json) remains failed with 266 browser passes, one FAQ failure and two skips. Its trace established that Escape preceded expanded-view readiness. The single added focus assertion now has successful execution evidence in run 43726164418.

The preceding [run 43723377122](M05-windows-ci-43723377122.json) remains failed: 28 baseline passes and one initial-navigation timeout, with four later suites unexecuted. Its 20-second initial-navigation-only repair passed in run 43724428807. Cold first-load delay remains an inference; the passing follow-up does not establish a measured startup bottleneck. Production-source review remains complete.

The earlier [run 43721299625](https://github.com/skytuhua-org/Gen-V1/actions/runs/43721299625) remains a complete pass for its exact combined M05/M09/M11 source cut: 3,746 application passes with 39 skips, 33 Hermes contract passes, 267 browser passes with two skips, 37 policy/plugin test passes and successful typecheck, UI policy and builds. All 17 plan bodies and all four document-width cases passed there. The FAQ readiness edit has its own complete passing workflow in run 43726164418. This earlier result remains attached to its original cut. The record below preserves all failed attempts, their repairs and the separately identified successful run. Test discovery, HTTP probes and filenames containing `green` are never substituted for execution.

The first two integrated workflows failed. The initial plan readiness repair was insufficient because the fixture URL served the application fallback; the first document fixture repair incorrectly generalized narrow automatic expansion to desktop. Both failures and the subsequent M11 integration findings are preserved below.

The following table identifies the first failed integrated run. Its immutable evidence remains separate from the later passing cut and the subsequent failed documentation-final attempt.

| Identity | Recorded value |
| --- | --- |
| Pull request | [M05 PR 347](https://github.com/skytuhua-org/Gen-V1/pull/347) |
| Observed Windows run | [43714076939, attempt 1](https://github.com/skytuhua-org/Gen-V1/actions/runs/43714076939) |
| Published head | [88cc734111b6c4b683f7c1469723d5c7ee7b4ea4](https://github.com/skytuhua-org/Gen-V1/commit/88cc734111b6c4b683f7c1469723d5c7ee7b4ea4) |
| Published tree | [aead9025a03226bb994540e19a17622d4aac5f2a](https://github.com/skytuhua-org/Gen-V1/tree/aead9025a03226bb994540e19a17622d4aac5f2a) |
| Actual PR merge checkout | [b93da5f5d615d65edad16f1b4f78a4a9f78904ea](https://github.com/skytuhua-org/Gen-V1/commit/b93da5f5d615d65edad16f1b4f78a4a9f78904ea), whose tree is the same `aead9025a03226bb994540e19a17622d4aac5f2a` |
| Accepted base | [5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42](https://github.com/skytuhua-org/Gen-V1/commit/5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42) |
| Structured run evidence | [M05-windows-ci-43714076939.json](M05-windows-ci-43714076939.json) |

The checkout distinction matters: the job checked out GitHub's PR merge commit, not the branch commit object. The recorded merge parents are the accepted base and published head, and its tree equals the published tree. The checkout response SHA256 is `8d2e4a48a1723fa3ab1d981547690b0c33fd382e30c158b075d541c68ff36a2d`.

The earlier published M05 attempt is retained separately: [Windows run 43707232893](https://github.com/skytuhua-org/Gen-V1/actions/runs/43707232893), [head 14e6a1743a5eb6a09bd96021ef724ed0967d442b](https://github.com/skytuhua-org/Gen-V1/commit/14e6a1743a5eb6a09bd96021ef724ed0967d442b), [tree 71b3d4d22bf7aab7890cc0e7f75154a32ce354d6](https://github.com/skytuhua-org/Gen-V1/tree/71b3d4d22bf7aab7890cc0e7f75154a32ce354d6). Its SQLite freed-page failure and subsequent storage migration are documented in [its evidence record](M05-windows-ci-43707232893.json) and [the handoff](M05-handoff.md). It is retained alongside all later runs.

## What Windows actually executed

[Browser job 132811715250](https://github.com/skytuhua-org/Gen-V1/actions/runs/43714076939/job/132811715250) first ran the existing split-workspace checks, then invoked `pnpm test:browser` for `project-memory`, `usage-context`, `frontend-refinement`, and `root`. The PowerShell loop continued after any failed suite and failed the step if any suite failed. Failure reports and traces were uploaded with `if: always()`.

| Browser group | Observed result in the failed run |
| --- | --- |
| Existing split-workspace browser checks | 29 passed |
| Project memory | 15 passed |
| Usage context | 20 passed |
| Frontend refinement | 90 passed, 1 skipped |
| Root browser suite | 82 passed, 30 failed, 1 skipped |
| Entire browser job | 236 passed, 30 failed, 2 skipped; job failed |

These are results of the immutable observed tree, not claims about the repair tree. The project-memory fixture is authored synthetic UI evidence. It does not establish an installed-desktop flow or a paid-provider repeated-task study.

The application regression shards recorded 3,687 passed, 9 failed, and 39 skipped. The nine failures are the account-parity cases described below. The Hermes job also recorded one failure in its native-worker checkpoint fixture. See the structured run evidence for all eight job identities, commands, timestamps, results, and log digests.

## All 30 root browser failures mapped to repairs

The failed tests were unchanged from accepted base `5098bff` before these repairs. The older accepted-base [root-suite log](logs/brw-02-root-suite.log) already recorded 29 of the same failures. The additional signing-motion failure occurs in unchanged test and production files; its trace shows an unfinished initial animation at counter reset.

| Observed group | Count | Proven cause and repair | Assertions retained |
| --- | ---: | --- | --- |
| Every `plan-timeline.spec.ts` case | 17 | The shared setup immediately dereferenced a missing element with `getComputedStyle(null)`. The first repair replaced it with Playwright's locator-based `toHaveCSS('height', '3px', {timeout: 30000})`. That wait was necessary but insufficient: follow-up inspection of the preserved trace and a failing HTTP probe proved that `/plan-timeline.html` resolved to the main application through Vite's fallback. Add an exact fixture route in the test Vite configuration, preserving the readiness check. Reachable-step review also updates the invalid-plan notice to its accepted polite `status` role inside the exact task-plan region. | Exact 3px bar height and timeout; owner removal; same-thread revisions; stale epoch rejection; retained graph; collapse persistence; transcript content; focus and reading anchor; branch/join structure; all narrow/zoom/theme geometry. |
| Skills history retirement, restore retirement, retryable transport, stale edit, and blocked cleanup notices | 5 | Tests requested `role=alert`; accepted production has used `role=status` since `c2734be`. Select the status inside the exact `Skill library` region and retain the same error text. | Source retirement affects only its row; current instructions and newer journal generations remain; revision/content and command counts remain; ordinary transport failures remain retryable; explicit stop retry still emits `learning.cancel`. |
| Empty skills library with an old snapshot | 1 | The expected heading was `Skills & learning`; the accepted Settings section heading is `Skills & Integrations`. Use that exact heading. | Empty state, no eager reads, all learning preference updates, and selected-model/subscription description. |
| Skills desktop/narrow theme and editor geometry | 1 | The helper queried `Open navigation` before React mounted, received false, then attempted the offscreen narrow Settings button. Await the Settings control's attachment before checking and opening navigation. A subsequent source review exposed the disconnected narrow Skills stylesheet, repaired separately below. | Real click actionability, both viewport widths and themes, selected navigation bounds, no page overflow, editor values and bounds, and the minimum 250px narrow editor width. |
| Plan summary and docked handoff at 390px | 1 | The test read `data-collapsed=true`, but the accepted plan-appearance effect expanded the summary before the next click. The old `Expand Project overview` button no longer existed. Await the required automatic expansion instead. | Plan summary visible; handoff opens; summary hides while docked; no horizontal overflow; closing the handoff restores an enabled composer. |
| Ordinary signing draft edit | 1 | `document.getAnimations()` does not include the PDF's RAF spring. The test reset its pan counter before initial navigation settled. Await the active field and 250ms of unchanged pan count, bounded to 5 seconds, before reset. After the edit, await persisted state, updated preview readiness, the existing frame flush, and another bounded stability window without resetting the counter. | The changed value is saved; the updated PDF is ready; **exactly zero** additional pan calls are permitted. Any edit-triggered pan remains counted and fails. Other signing geometry/navigation cases are unchanged. |
| Host-loop decision validation | 1 | The exact schema-error notice is a polite status in accepted `InputDecision`; scope the status assertion to the same decision region. | Invalid response rejected, input retained, request pending, exactly one original delivery, accepted response continues the same runtime once, stale response rejected, reload preserves receipt. |
| Host-loop generated operation approval | 1 | `Add resource` moved to Settings, `Projects & Working Copies`. Navigate through those actual controls before calling the existing grant helper. | Explicit native approval, original bytes before approval, stale revision rejection, one effect, exact output bytes, restart restores the receipt without repeating the effect. |
| Host-loop infinite-loop isolation and generated startup failure | 2 | The shared Settings modal now labels its close button `Close dialog`. Scope that exact button to the Settings dialog. Reachable-step review also follows New thread with the existing `Select project` / `No project` choice. | Settings/Stop/navigation timing limits, actual stop, second-thread creation, owned widget failure notices, durable artifact state, and runtime isolation. |
| **Total** | **30** | No failing test was removed or skipped. | No approval, ownership, revision, visibility, geometry, effect-count, or zero-pan assertion was weakened. |

The source files changed for these browser repairs are [plan timeline](../../../tests/e2e/plan-timeline.spec.ts), [the root test Vite configuration](../../../tests/e2e/vite.config.ts), [skills](../../../tests/e2e/skills.spec.ts), [document window](../../../tests/e2e/document-window.spec.ts), [signing motion](../../../tests/e2e/signing-motion.spec.ts), and [host loop](../../../tests/e2e/host-loop.spec.ts).

### Follow-up run and independently confirmed fixture-route failure

[Follow-up Windows run 43716553796](https://github.com/skytuhua-org/Gen-V1/actions/runs/43716553796) executed [published head `8547a7cacdc58a661f7dfaa10cdd9fa7c334ede6`](https://github.com/skytuhua-org/Gen-V1/commit/8547a7cacdc58a661f7dfaa10cdd9fa7c334ede6), tree [`0e96f49d4faff4a7ff4ff884f2bbda646218306d`](https://github.com/skytuhua-org/Gen-V1/tree/0e96f49d4faff4a7ff4ff884f2bbda646218306d). Its actual PR merge checkout is `0b626defe3c6fe1c2991fccafc23e84baed35700`, with the same tree. That tree contains the first set of repairs, including the readiness wait, but predates the fixture-route and desktop-expansion corrections. All seven non-browser jobs passed, including 3,709 application tests with 39 skipped and zero failed. [Browser job 132819252727](https://github.com/skytuhua-org/Gen-V1/actions/runs/43716553796/job/132819252727) failed. The separate [follow-up receipt](M05-windows-ci-43716553796.json) retains the complete result and source identity.

| Follow-up browser group | Observed result |
| --- | --- |
| Existing split-workspace checks | 29 passed |
| Project memory | 15 passed |
| Usage context | 20 passed |
| Frontend refinement | 90 passed, 1 skipped |
| Root browser suite | 92 passed, 20 failed, 1 skipped |
| Entire browser job | 246 passed, 20 failed, 2 skipped; job failed |

The root test Vite configuration spreads the application configuration, whose root is `apps/web`. The plan test navigates to `/plan-timeline.html`, but the HTML file lives at `tests/e2e/plan-timeline.html`. No route served that file. The preserved first-run network trace shows HTTP 200 for that URL with `<title>Gen V1</title>` and `/src/main.tsx`, the main application entry. The source response is resource `1cd8a7c2f8dd991d6165186cc1a43d23a6ee4e7f.html` inside the plan-owner-removal trace identified below. All 17 plan traces in the follow-up artifact independently show the same wrong response, and their readiness waits time out. The original immediate-null failure did not prove that the intended renderer was merely late. The readiness repair could not make the absent fixture mount.

The test configuration now registers middleware for exactly `/plan-timeline.html`, reads the fixture HTML, points its module script to the actual renderer through Vite's normalized `/@fs/` path, and calls `transformIndexHtml`. It retains the application root, React plugins, default `/` entry, filesystem allowlist, cache directory, and existing host/port configuration. Independent review checked all 16 root browser specs and their navigation helpers: this was the only fixture HTML URL outside the application root. The other root cases use `/`, their isolated built host, a `data:` URL, or `/src/journal.ts` under the correct application root.

The CSS chain was intact: production `PlanStatus` imports `plan-status.css`, which imports `plan-timeline/timeline.css`; that stylesheet retains the exact 3px overall bar. A pure Node fixture check also accepted its plan schema and revision. The route correction does not change production rendering or weaken the CSS assertion.

| Local route probe | Recorded result and scope |
| --- | --- |
| [continuation-plan-fixture-route-red.log](m05-logs/continuation-plan-fixture-route-red.log) | Before the route correction, exit 1. The actual HTTP response contained the main application entry and failed the required renderer assertion. Vite shutdown also printed canceled scan work; the route assertion had already failed. |
| [continuation-plan-fixture-route-green.log](m05-logs/continuation-plan-fixture-route-green.log) | Despite the filename, this attempt failed with exit 13 during early Vite shutdown. Its HTTP assertions completed, but it is not recorded as a passing command. |
| [continuation-plan-fixture-route-lifecycle-verification.log](m05-logs/continuation-plan-fixture-route-lifecycle-verification.log) | Exit 0 after the scratch probe awaited Vite's real static-import crawl and dependency processing before close. Owned IPv4 loopback requests confirmed the fixture HTML, renderer and production `PlanStatus` module transformations, imported 3px bar CSS, and unchanged `/src/main.tsx` at `/`. The probe explicitly records `browserExecuted: false`. |

The command ledger and log-policy record retain the original input digests and any later display normalization. These probes establish the HTTP entry and module-transform boundary. At that point, browser geometry, interactions, screenshots and the complete 17-case suite still required Windows execution. Run 43721299625 subsequently executed and passed all seventeen cases.

### Three desktop document failures introduced by the first fixture repair

The follow-up run's other three failures were the 1920px, 1440px, and 1280px cases in `document-window.spec.ts`. The 390px case passed. The first repair had generalized the narrow automatic-expansion behavior to every width. This was a test regression introduced in the repair tree, not a newly failing production contract.

Accepted [SummaryDock.tsx](../../../packages/ui-shell/SummaryDock.tsx) deliberately leaves a collapsed desktop row closed on an expansion request and displays `Update available`, because opening its body would move the composer. The column layout expands automatically. Every failing desktop trace shows `data-collapsed=true`, the exact `Expand Project overview` button, and `Update available`. The 1920px trace retains this state at 92,184.066ms, the 1440px trace at 100,996.141ms, and the 1280px trace at 109,698.183ms. These are relative trace timestamps.

The corrected fixture explicitly clicks the scoped `Expand Project overview` control for the three desktop widths, then asserts the same expanded state and visible plan summary. The 390px case retains the automatic-expansion wait, which avoids the original stale-click race. All subsequent document visibility, overview hiding, page overflow, close action, and enabled-composer assertions remain unchanged. [Local discovery](m05-logs/continuation-ci2-plan-document-discovery.log) enumerated all 30 cases in the two affected files without running a browser. Run 43721299625 subsequently executed and passed the three corrected desktop cases and the narrow case.

### Production repair found after the mobile setup blocker

The 390px Skills test had not reached its editor-width assertion. Source review found that [skill-library.css](../../../apps/web/src/skill-library.css) still required a `.settings-skills` ancestor, but neither the Settings modal nor [Settings.tsx](../../../apps/web/src/Settings.tsx) emitted it. The generic 136px narrow navigation column therefore left less than the existing 250px editor requirement.

The repair adds `settings-layout settings-skills` when `matches('harness-skills')` is true, changes the responsive root selector to `.settings-layout.settings-skills`, and explicitly sets the narrow navigation to `flex-direction: row`. This reconnects the existing responsive layout. The browser test still requires the same editor width, selected navigation bounds, no overflow, and both themes. The follow-up Windows run passed this case. Its eight saved screenshots were visually reviewed: controls and editors at 390px and 1440px, each in light and dark themes. The selected navigation item stays visible, editor fields fit the content column, and text and actions remain readable. Skills, signing-motion, and host-loop had no follow-up failures.

## Two other Windows failure groups

| Windows job and count | Cause and repair | Preserved contract |
| --- | --- | --- |
| [Application shard 4, job 132811715440](https://github.com/skytuhua-org/Gen-V1/actions/runs/43714076939/job/132811715440), 9 failures | M05's runtime router forwarded `selected.accountId` and an undefined checkpoint argument to adapters even when no memory checkpoint existed. The established adapter call shape is three arguments for ordinary compaction. [runtime/index.ts](../../../packages/runtime/index.ts) now forwards the extended account/checkpoint arguments only when a checkpoint requirement is present. Two focused default-account regressions were added before that fix. | Account routing still selects the pinned adapter/profile and validates the owner. The nine provider parity assertions are unchanged: `openai`, `openai-codex`, `github-copilot`, `xai`, `claude-code`, `gemini-cli`, `cursor-sdk`, `kimi-coding`, and `opencode-go`. Checkpoint-enabled calls still carry their full requirement. |
| [Hermes contracts, job 132811715487](https://github.com/skytuhua-org/Gen-V1/actions/runs/43714076939/job/132811715487), 1 failure | The worker fixture decoded a UTF-8 history file using the Windows default encoding. The equality assertion therefore compared different decoded text. [memory_native_checkpoint_worker_v3.py](../../../tests/memory_native_checkpoint_worker_v3.py) now calls `read_text(encoding='utf-8')`. | Exact persisted messages still equal the native result; persistence-before-compaction ordering, cancellation, failure isolation, and exact history retention remain asserted. No production native-worker behavior changed for this repair. |

The compact compatibility red attempt is retained in [continuation-compact-compatibility-red.log](m05-logs/continuation-compact-compatibility-red.log). The later file named [continuation-compact-compatibility-green.log](m05-logs/continuation-compact-compatibility-green.log) actually records **3 failed and 43 passed** because Linux protected-directory access failed in runtime-router cases. It must not be cited as a fully passing suite. Local follow-up records and current stored digests remain in the command ledger and log-policy record. The follow-up Windows receipt separately records actual execution of these repairs.

## Accepted-source comparison

Each file below has the listed identical Git blob at historical base `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`, accepted base `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42`, and the observed pre-repair head `88cc734111b6c4b683f7c1469723d5c7ee7b4ea4`. These identities concern the pre-repair files, not the edited working tree.

| File | Identical pre-repair Git blob |
| --- | --- |
| `tests/e2e/plan-timeline.spec.ts` | `911882f8511bc2b5454cbdd18e27b1e70ba8a8b9` |
| `tests/e2e/skills.spec.ts` | `f87c4eb188686a160f0702a580f05704ef8c1f6f` |
| `tests/e2e/document-window.spec.ts` | `02b3418f2fa3e5ae7280bec47aa84d1b12f79102` |
| `tests/e2e/signing-motion.spec.ts` | `b0ba18fc062b60cf9753088cc2f4f4903dfd8e3b` |
| `tests/e2e/host-loop.spec.ts` | `b981e9473dc2d88d72123408d0cb41230fd72258` |
| `tests/host-fixture.ts` | `47ac41180509eec0e9794bfc6d9dd7c86c7982cc` |
| `apps/web/src/SkillLibrary.tsx` | `c22d2745523ec9b79a46d4ddffb83103cd63a031` |
| `apps/web/src/PlanStatus.tsx` | `12ee9d95fea268f0f1fb1b4ad43f07a22e4a71c8` |
| `apps/web/src/DocumentPreview.tsx` | `cb4effa9116ccdf4c46ba360e80197da3e081019` |
| `apps/web/src/Settings.tsx` | `2541ad55f0c1f55147b828e9504d7310b4257368` |
| `apps/web/src/skill-library.css` | `1d536f8c012123f0df440ee1dfb3fce7d1e9fe0e` |
| `apps/web/src/ProjectPicker.tsx` | `ae522627049acb77d45fdc8ccef7b19e6d7aff74` |
| `packages/ui-shell/SummaryDock.tsx` | `ff2e7c720953a0d5d692b28c7ef66a72e4a0b952` |
| `packages/ui-shell/Modal.tsx` | `99e78ac4de21dc04057f19a0e6e950e423f8884f` |

[Accepted commit c2734be4c3d228241a9e672cefff65950e599319](https://github.com/skytuhua-org/Gen-V1/commit/c2734be4c3d228241a9e672cefff65950e599319) deliberately changed routine inline messages to polite status live regions. The complete `App.tsx` blob is not claimed unchanged because M05 adds legitimate composition and memory wiring there; the relevant prior Settings, decision, and plan-appearance behavior was inspected in accepted source.

The missing route also exists unchanged in accepted base `5098bff`, first observed head `88cc734`, and follow-up head `8547a7`: `tests/e2e/vite.config.ts` is blob `dcf8024e4ed442aa3f2a0c6b0ce8f0833ca39b71` at all three, and root `vite.config.ts` is blob `137e702c96cf5f12d1f48e2657354becdd41af69` at all three. The exact fixture-route correction is a later test-configuration change.

## Bounded trace and log provenance

| Evidence | SHA256 |
| --- | --- |
| Exact connector-decoded browser log, 212,563 UTF-8 bytes | `8075753933aed79eedff705e5d6343cd04718c7e870e39a7679ac07dc49ab123` |
| [Versioned bounded browser log](m05-logs/windows-ci-43714076939-132811715250.log) | `e26392925bd5a74e1aeb5e9fea3aac09fdc8d7abd5f17fb1aa202e0f42261340` |
| Exact connector-decoded application shard 4 log | `4ba25ae1a549063146f5d0b41082a968aba950250aaf7baeb6e6fa4fbb36e4f9` |
| [Versioned bounded shard 4 log](m05-logs/windows-ci-43714076939-132811715440.log) | `e7001d0eec8cd6d27df18cf7525e19a4518af1853791c1b3e7bef8af72440ba9` |
| Exact connector-decoded Hermes log | `7955af71ef5ba2776cb9f8b090da31ba8d2e869d5231d84731550169f4bf8eb0` |
| [Versioned bounded Hermes log](m05-logs/windows-ci-43714076939-132811715487.log) | `ea24c00d39f0bbddd5cc63d301eb21d9fe110d83658b2290e44d0bf2c13bb293` |
| Older accepted-base root-suite log | `11a583754014b6d6e8c766f4f97ee4867cbbc8d5438a94de10efd775b0d5f516` |
| Downloaded browser artifact ZIP, 18,889,698 bytes | `efe208355fb65a1a8948024a817ce4c8f677488923e246c09836b201699020da` |

The artifact is `browser-43714076939-1`, GitHub artifact ID `14162625925`, created at `2026-11-15T12:42:39Z`, with its recorded expiry at `2026-11-22T12:42:36Z`. The downloaded ZIP's digest matched GitHub's advertised digest before extraction. It contains 52 entries. Raw logs, the ZIP, and the bounded review notes are retained in the session scratch directories `m05-ci-43714076939` and `m05-browser-triage-43714076939`; they are not embedded as large binary files in this document.

The root suite's artifact prefix is `run-1794746146588-667236d1-4f65-4a58-b331-e5c80cdfaff4/root/artifacts/`. The following observations are taken directly from each ZIP's `0-trace.trace` snapshot/action timestamps, which are relative trace times rather than wall-clock timestamps:

| Trace directory | Bounded observation |
| --- | --- |
| `plan-timeline-does-not-kee-a3ada-t-drops-its-plan-and-thread` | The network response for `/plan-timeline.html` is HTTP 200 with the main application title `Gen V1` and module `/src/main.tsx`; the intended plan renderer entry is absent. The retained response resource is `1cd8a7c2f8dd991d6165186cc1a43d23a6ee4e7f.html`. |
| `document-window-Plan-summa-6c848-reachable-together-at-390px` | The collapsed attribute read returned true at 69,547.843ms. At 69,578.545ms the snapshot already showed `data-collapsed=false` and `Collapse Project overview`. The stale Expand click started at 69,579.586ms. |
| `skills-skill-controls-and--23490-narrow-light-and-dark-views` | The narrow navigation completed at 383,247.865ms; the immediate visibility check returned false at 383,267.896ms. The subsequent Settings click repeatedly reported its button outside the viewport. The later screenshot shows the mounted, closed mobile navigation. |
| `signing-motion-ordinary-dr-cad72-ot-restart-field-navigation` | At preview readiness, 277,469.708ms, PDF scroll was `(48,29)`. After the Web Animations wait, 277,563.491ms, it was `(71,42)`. The counter reset began at 277,564.662ms; fill input at 277,585.247ms showed `(71,43)`; the final scroll was `(73,43)`. Initial movement therefore preceded and overlapped the edit measurement. |
| `host-loop-durable-decision-ac3f4-he-same-owning-runtime-once` | The snapshot contains the exact expected schema error in a `P` element with `role=status` and `class=error-text`. |

The complete 30-case title/category mapping is retained in the scratch `root-triage.json` note. Local Playwright discovery enumerated the edited UI specs without executing a browser. The host-loop local attempt [continuation-host-loop-selectors-attempt-1.log](m05-logs/continuation-host-loop-selectors-attempt-1.log) failed before discovery because the Linux `pty.node` binary was unavailable. This is preserved as a failed attempt, with its stored and first-observed digests in the log-policy record. Run 43721299625 supplies an actual Windows browser result for that historical cut; the later run 43723377122 and the revised harness are recorded separately below.

Versioned command-log digests refer to their bounded, redacted stored bytes. [M05-log-policy.json](M05-log-policy.json) retains each first-observed input digest and any later display-normalization transform; no stored excerpt digest is substituted for a raw-job digest.

### Follow-up artifact provenance

The second artifact is `browser-43716553796-1`, ID `14163317600`, created at `2026-11-15T13:21:01Z` and expiring at `2026-11-22T13:20:59Z`. Its downloaded ZIP is 4,928,351 bytes with 54 entries. SHA256 `6a996011cc93acd4e7ced8762bcb1d6fe25e94488228f8f8b3077959e1be9e89` matched GitHub's advertised digest before extraction. The exact connector-decoded browser log has SHA256 `8cc41883a2ea021d9d112476a50ba8f6de457c2227255586d2094305346ce87e`; the [bounded versioned log](m05-logs/windows-ci-43716553796-132819252727.log) and receipt retain their separate stored identities.

The artifact and review notes are retained in scratch `m05-browser-triage-43716553796`, separately from the immutable first artifact. The root artifact prefix is `run-1794747996180-b2b6273d-5ba6-439b-965b-3ef00b7bab57/root/artifacts/`. Its bounded `root-triage.json` records every failed trace digest, all 17 actual plan responses, all three desktop expansion observations, and each reviewed Skills screenshot digest and dimensions. The eight images are `skills-{390,1440}-{light,dark}-{controls,editor}.png` under `skills-skill-controls-and--23490-narrow-light-and-dark-views/`. No screenshot or trace from the first run was overwritten.


## Accepted M11 advancement before the next run

The fixture-route correction was published as head `998ad77d8a5fb9d50a970edce5ed8a960a20496d`, tree `66fcb0f5e4aa3a19e346e326abad44c73546c1bb`. Before a new Windows run started, accepted main advanced from `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42` to `399cde39ff4ee82272c7a7700944325c44b36070` through [M11 PR 345](https://github.com/skytuhua-org/Gen-V1/pull/345). The pull request became conflicted. No Windows result is claimed for the unpublished combined cut or for the conflicted head.

The textual merge preserves both sets of capability keys, both public-source manifests, M05's checkpoint ownership and M11's request observations/stage callbacks. Memory flags remain false. The UI merge retains exact request preparation, exclusion invalidation on draft/model/owner changes, and disposal of the old controller when a new thread mounts. Separate review identified concrete interactions beyond the textual conflicts:

| Boundary | Repair and evidence |
| --- | --- |
| Native worker host-call ordering | M11 appends `$transport.observation` after `$transport.usage`. The actual-worker success fixture now requires the exact sequence checkpoint, usage, observation; failure/cancellation still allow no native model request. The [red run](m05-logs/continuation-m11-native-worker-red.log) had one failure and two passes; the [green run](m05-logs/continuation-m11-native-worker-green.log) passed all three. |
| Manual compaction measurement ownership | Service admits a fresh maintenance run, while the native source retains its original session context. The broker now measures with the maintenance context, so Service does not discard its observation as stale. Native RPC ownership and all checkpoint fences remain unchanged. The [red run](m05-logs/continuation-m11-maintenance-observation-red.log) had one failure and 38 passes; the [green runtime/checkpoint run](m05-logs/continuation-m11-maintenance-observation-green.log) passed all 67 cases. Both emitted observations retain exact run/epoch/account and measured usage. |
| Metadata-only error diagnostics | Arbitrary adapter exception text could be persisted as a model-request observation, outside memory deletion custody. The broker now emits a fixed failed/cancelled diagnosis, retaining outcome, ownership, usage and timing. Synthetic source/credential sentinels fail in the [original red](m05-logs/continuation-m11-telemetry-red.log) and [complete-channel red](m05-logs/continuation-m11-telemetry-red-callbacks.log), each with three failures/five passes; the [green](m05-logs/continuation-m11-telemetry-green.log) passes all eight transport cases. Stored observations, callbacks and the diagnostic log exclude both sentinels. Failed native cleanup still retains its scheduler permit. This is a guarded synthetic failure path, not a claim that a real provider leaked text. |

Shared provider/account scheduler admission for optional extraction is now connected through the actual production Service and memory host. The explicit background permit is acquired before runtime creation. Cancelled or timed-out queued work records zero calls/source bytes; a late grant is retained before cancellation checks and released without a runtime. Source, consent, model and account are revalidated after admission. The first native cancellation promise is memoized and joined after disposal/startup, immediately before permit release, so failed or hanging cleanup retains occupancy.

The sixteen new scheduler cases cover these boundaries and the production composition hook. The [initial scheduler red](m05-logs/continuation-m11-scheduler-red.log) failed all thirteen initial cases. The [first implementation attempt](m05-logs/continuation-m11-scheduler-green.log), despite its filename, failed one composition fixture and passed 23 cases: the fixture called `runSettled` without first registering its metadata through `scheduleSettled` inside Store.internal. That setup is corrected. The [original-cancellation red](m05-logs/continuation-m11-scheduler-cancel-promise-red.log) had two failures/13 passes, and the [cancellation-during-disposal red](m05-logs/continuation-m11-scheduler-cancel-disposal-red.log) had three failures/13 passes. The [final scheduler/extraction run](m05-logs/continuation-m11-scheduler-green-2.log) passes all 27 cases. Independent source review confirms the complete permit lifetime and all post-admission source fences.

The final combined local cut passes [347 memory cases](m05-logs/continuation-m11-final-memory-regression.log) and [185 dependency/runtime/packaging cases](m05-logs/continuation-m11-final-contracts.log). [Full typecheck](m05-logs/continuation-m11-final-typecheck.log), [production build](m05-logs/continuation-m11-final-build.log), and [UI policy](m05-logs/continuation-m11-final-ui-policy-node.log) pass. The canonical `pnpm lint:ui` attempt is retained as [FAIL](m05-logs/continuation-m11-final-ui-policy.log) because this Linux sandbox denies the tsx CLI Unix IPC socket; the supported Node import-loader invocation executes the unchanged policy script and reports 541 sources with zero violations. Run 43721299625 supplies the complete Windows result for that combined source cut; the historical passing-result table below records its actual counts. The later failed documentation-final and startup-fix attempts, followed by successful execution of the FAQ repair, are recorded below. Historical failed records remain immutable, and credential-shaped synthetic test output is subject to the documented log redaction policy with original input digests retained.


The [pre-merge integrity report](M05-premerge-evidence-integrity-20261115.json) preserves a failed metadata verification attempted while the local merge was still open. The evidence builder correctly refused to treat the new base as an ancestor of an uncommitted merge, and the stale prior receipt listed the newly merged files as unrecorded. After committing the reviewed merge, the source lock was regenerated against accepted main `399cde39ff4ee82272c7a7700944325c44b36070`. This report is historical evidence of that ordering error, not a current runtime failure or a waived check.


## Earlier complete combined Windows verification

[Run 43721299625](M05-windows-ci-43721299625.json), attempt 1, completed successfully on published head `a0755d344513feced0f79717cf90d39f64cfe619`. Every job checked out `887a831e29b6f13ee75cd645e641aeb71855cbfb`, the merge of accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. The checkout and reviewed head share exact tree `c391fa72e7fa1e263442195a119adfc1aa073cd0`.

| Required coverage | Actual result |
| --- | --- |
| Application shards 1 / 2 / 3 / 4 | 1,073 / 927 / 842 / 904 passed; 0 / 7 / 2 / 30 skipped. Total **3,746 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**, including five pinned checkpoint facade cases and three actual Worker cases with scripted responses. |
| Windows policy/plugin checks | **37 passed**, plus full typecheck, UI policy and production build. |
| Desktop packaging | Build passed. No installation or launch claim. |
| Browser split / memory / context / frontend / root | 29 / 15 / 21 / 90 / 112 passed, with one frontend and one root skip. Total **267 passed, two skipped, zero failed or flaky**. All 17 plan cases and four document widths execute and pass. |

All 24 observed command records from this run were imported with exact runner working directory, observed step time envelopes, exit basis, raw-log digests, bounded excerpt digests and immutable per-command metadata. No process duration is invented from a whole CI step. Receipt SHA256: `0a0d786b816c53b68147dfc99284114d028fb42a59ad5f4915ea3794fb6006a8`. Raw jobs API SHA256: `fc7557883dc65a730110f256dfca61283f935f854470b9f1e881f66517d458df`. That run's raw browser log is 110,540 bytes with SHA256 `cb63fd852f6ccbc12849bd28365141f008c19f084d4a2eebc35579c1095d3295`.

The browser artifact `browser-43721299625-1`, ID `14164773288`, is 2,471,434 bytes. Its downloaded ZIP SHA256 `64760970da9e8f85ba9dd7a44450f7cc7a190641430fb8e6c695e1fb065f8771` matches GitHub metadata. Archived results independently confirm the same suite counts and no failure traces. These synthetic browser and scripted native results establish the repaired execution boundaries; actual native FILE capture, installed-desktop execution and authorized live repeated-task quality/cost remain unverified. Both memory flags remain false.


The [browser artifact review for run 43721299625](M05-browser-review-43721299625.json) independently records all suite counts, the two explicit skipped cases, exact viewport/theme/zoom/image identities and observations from 21 screenshots. Nine plan, eight Skills and four usage/context images were inspected. No actionable visual defect was observed; the report limits screenshot claims to visible content and keeps behavioral proof in the executed tests.


## Final documentation CI navigation failure and subsequent startup repair

[Run 43723377122](M05-windows-ci-43723377122.json), attempt 1, tested documentation-only published head `c0399961dee169d9bcdb443e3807436bd4d3aa28`. Every job checked out `f60285443ea20b5bf6039edf7a4aa1798b47648e`, whose parents are accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. The checkout and published head share tree `f4f987bb80b0cbb4abbd5f59e92b4dde18371cc3`. Production, test and workflow source was unchanged from the earlier passing head `a0755d344513feced0f79717cf90d39f64cfe619`; the original split-app test has Git blob `c1b13c2bb6c1d7d658fc306414f44bfdb3e10dda` at both heads. The timeout repair described below came after this failed run.

| Coverage in run 43723377122 | Observed result |
| --- | --- |
| Application shards 1 / 2 / 3 / 4 | 1,073 / 927 / 842 / 904 passed; 0 / 7 / 2 / 30 skipped. Total **3,746 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**, including the pinned facade and actual Worker checkpoint cases. |
| Windows policy/plugin checks and builds | **37 passed**; typecheck, UI policy, production build and desktop packaging passed. All seven non-browser jobs passed. |
| Split-browser baseline | **28 passed, one failed**: 18 split-app cases and ten split-renderer cases passed. The first split-app case failed during initial fixture navigation. |
| Project-memory / usage-context / frontend-refinement / root suites | **NOT_RUN** in this attempt. Their shared workflow step was skipped after the failed baseline step. This is not four executed suites with skipped test cases. |

[Browser job 132839958308](https://github.com/skytuhua-org/Gen-V1/actions/runs/43723377122/job/132839958308) failed `keeps full thread renderers, drafts and exact send owners through tab movement, parking and reload`. The preserved [bounded log](m05-logs/windows-ci-43723377122-132839958308.log) reports `page.goto: Timeout 7000ms exceeded`, navigating to `http://127.0.0.1:5598/split-app-check` while waiting for `load`. The stack points to initial fixture navigation at line 93 of the tested source, reached before its renderer readiness checks and test assertions. The complete first-case duration was 13,793 ms; that includes fixture work and is not a navigation-duration measurement. The report uploader found no files, so this attempt produced no browser artifact or subresource trace.

A cold first-load delay is consistent with the first fixture failing while the other 28 baseline cases pass, and with the same source having passed the earlier workflow. The available log does not identify a measured Vite bottleneck or establish a timing distribution. The observed failure is the initial-navigation deadline; attributing the delay to cold module loading remains an inference.

The repair changes only [the fixture's initial `page.goto`](../../../tests/split-app-browser.test.ts) to pass `{timeout:20000}`. It retains the same URL and `load` completion condition, `page.setDefaultTimeout(7000)` for subsequent actions, the failing case's 30-second outer bound, every other existing test bound, and all ownership, draft, movement, parking, reload and geometry assertions. It adds no retries or skipped cases. Run 43724428807 subsequently passed all 29 split-browser baseline cases with this repair and executed all four later suites. Its separate FAQ failure kept that workflow failed. The later run 43726164418 passed both the split baseline and the complete workflow with the FAQ readiness assertion.

The [failed receipt](M05-windows-ci-43723377122.json) has SHA256 `a31201f3bca8b3806488c9c8065961dbc9c6eee5b02a4e05f6244a3ca1e542a1`. The exact connector-decoded browser log is 67,096 bytes with SHA256 `8873a2b53ddaa240795308f27046fb6607d8ad5be1797b3185605ac16c5d05a1`; the bounded stored log has SHA256 `a2259cec1b1edd33cf20f644bcf068a796707a552d4072ad445b8a0dd86c75fb`. The receipt retains all eight job identities, observed step times, results and raw/stored log identities. Earlier green and failed records remain intact. Production-source review remains complete, both memory flags remain false, and native FILE capture, installed-desktop execution and authorized live quality/cost remain separate unverified gates.


The [independent startup review](M05-browser-startup-review-43723377122.json) records the unchanged original test blob, prior whole-test timings, matching runner/toolchain, inference limits and exact reviewed repair digest. [Startup-repair full typecheck](m05-logs/continuation-split-initial-navigation-typecheck.log) passes. Twenty observed commands from the failed attempt were imported: nineteen PASS and one FAIL. The skipped browser step has no invented command or exit record.


## Startup-fix CI and FAQ expansion readiness repair

[Run 43724428807](M05-windows-ci-43724428807.json), attempt 1, tested published head `2e210878eaef60c63e0d02ac2737f9fe6188a96d`. All jobs checked out `af91fb4993bbb05f6429c681073a00c5bd335440`, with parents accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. The published head and checkout share tree `236d62b5ead175670ddfe258848492fae366a835`. This cut includes the initial-navigation timeout repair and predates the new FAQ focus assertion.

| Coverage in run 43724428807 | Observed result |
| --- | --- |
| Application shards | **3,746 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**. |
| Windows policy/plugin checks and builds | **37 passed**; typecheck, UI policy, production build and desktop packaging passed. All seven non-browser jobs passed. |
| Split-browser baseline | **29 passed**, including the formerly failing first fixture with the 20-second initial navigation budget. Its 6,281 ms whole-test duration does not measure navigation duration. |
| Project-memory / usage-context | **15 / 21 passed**. Both suites executed. |
| Frontend-refinement | **89 passed, one failed, one skipped**. The sole failure is `connected FAQ branches and follow-up draft retain independent state`. |
| Root baseline | **112 passed, one skipped**. This suite executed after the frontend failure because the wrapper retains and reports every suite result. |
| Entire browser job | **266 passed, one failed, two skipped**. The workflow failed and is preserved as failed. |

The [browser log](m05-logs/windows-ci-43724428807-132843172407.log) records the FAQ case's post-Escape assertion failing because the `Expand artifact` control was absent. The [trace review](M05-faq-readiness-review-43724428807.json) identifies the missing readiness boundary: Escape began at trace-relative **37,730.573 ms**, before the expanded-snapshot response was fulfilled at **37,732.134–37,733.218 ms**. The before-Escape DOM snapshot at **37,732.286 ms** still shows an inline artifact, `Expand artifact`, no dialog and zero open tooltips. The after-Escape snapshot at **37,762.642 ms** shows the expanded dialog and `Collapse artifact`; the trace contains no collapse command. The existing retained-text assertion had passed against the unchanged inline draft before expansion completed, so it did not establish that the expanded view was ready to receive Escape. The DOM and command sequence establish this readiness race in the recorded execution. These trace timestamps are relative to that execution, not wall-clock times or a general latency measurement.

The repair adds one assertion immediately after clicking `Expand artifact` in [artifact-style.spec.ts](../../../tests/e2e/artifact-style.spec.ts): the exact `Collapse artifact` button must be focused. The retained follow-up value is then checked and Escape is pressed. All existing branch interactions, answer-visibility checks, retained follow-up value and post-Escape focus-return assertion remain. No production source, timeout, retry or skip changes accompany this assertion. The new readiness boundary subsequently passed the complete required Windows workflow in run 43726164418. This failed trace remains preserved as the regression evidence.

Receipt SHA256 is `cd82f10fe3fa036f8d06cbc9ae085bc56db103f5be73d5f4744a6ea9a43888de`. The exact connector-decoded browser log is 113,499 bytes with SHA256 `aa65ea6f1a35e8f0c597aa6e2d384fa03297401913f57342165dd9365cb3c7d1`; the bounded stored log SHA256 is `71f7ce237646152d709faaab305abb518fdd675c715b4d6f026d2f111d986e9d`. Artifact `14166187603` is 3,459,123 bytes, with ZIP SHA256 `da778017323b00d134232be3e1db503f0df809ed2319cc9b14231b6c24a9f1cc`; it supplies the recorded FAQ failure trace. The 21-screenshot review from run 43721299625 remains explicitly historical on unchanged production/UI source. This update carries forward that visual review and cites the new trace for the failed interaction. Both flags remain false; native FILE capture, installed-desktop execution and authorized live quality/cost remain open.

[FAQ readiness full typecheck](m05-logs/continuation-faq-expansion-readiness-typecheck.log) passed with exit 0. The failed run contributes 24 observed command records, 23 PASS and one frontend-refinement FAIL. Those local typecheck and failed-run records do not establish browser execution of the added assertion. That execution is supplied separately by successful run 43726164418 below.


## Complete Windows verification of both fixture repairs

[Run 43726164418](M05-windows-ci-43726164418.json), attempt 1, completed successfully with **all eight jobs passing** on published head `d081973eedf23c684986076424cbbec9db7af951`. The actual PR checkout is `9caea6e081805c19a961030fe61fa9fa856153e1`, with parents accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. Both share exact tree `ffac9062087884b98f2ba73eb1c03e5219b43edb`. Since the earlier complete passing and visual-review cut, the only changes outside documentation are the two reviewed baseline fixture repairs. Production/UI source is unchanged.

| Required coverage in run 43726164418 | Actual result |
| --- | --- |
| Application shards 1 / 2 / 3 / 4 | 1,073 / 927 / 842 / 904 passed; 0 / 7 / 2 / 30 skipped. Total **3,746 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**, including the five pinned facade and three actual Worker checkpoint cases with scripted responses. |
| Windows policy/plugin checks and builds | **37 passed**; typecheck, UI policy, production build and desktop packaging passed. |
| Split-browser baseline | **29 passed**, using the 20-second initial fixture navigation budget with unchanged action and outer-test bounds. |
| Project-memory / usage-context | **15 / 21 passed**. |
| Frontend-refinement | **90 passed, one skipped**, including `connected FAQ branches and follow-up draft retain independent state` with the added exact Collapse focus assertion. |
| Root baseline | **112 passed, one skipped**. |
| Entire browser job | **267 passed, two skipped, zero failed or flaky**. All four later suites executed after the successful baseline. |

The [browser log](m05-logs/windows-ci-43726164418-132848442428.log) directly records the repaired FAQ case passing. The passing baseline and FAQ case establish execution of both repairs; they do not turn the original cold-load explanation into a measured bottleneck or a navigation-duration benchmark. Runs 43723377122 and 43724428807 retain their original failures, source identities, trace/absence-of-trace limits and command outcomes.

Receipt SHA256 is `1e7cad6540fbd07ff66a1c2aac5732c6e5423c08c249be72b57cde4e926c4e53`. The exact connector-decoded browser log is 111,640 bytes with SHA256 `8cfa7e773ebbe05382c1be062f14527456394893c3806019a8b52cad4fc3b16f`; its bounded stored SHA256 is `1845b1a27af66d025bb8f318db865db487def028f1587869dc300bb894cd0442`. The receipt preserves all eight job identities, observed step timestamps, exact checkout and raw/stored log identities. This observed result applies to the published source/test cut; a later documentation commit is not represented as already executed.

The [21-screenshot review from run 43721299625](M05-browser-review-43721299625.json) remains explicitly historical on unchanged production/UI source. No new screenshot inspection is claimed for run 43726164418. Native FILE capture, installed-desktop execution and authorized live repeated-task quality/cost remain unverified; both flags remain false and the bundle remains PARTIAL.
