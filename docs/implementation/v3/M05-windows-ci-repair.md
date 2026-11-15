# M05 Windows CI repair record

## Status and immutable source identity

**Production-source review is complete. Windows run 43744480609 passed eight jobs and failed the installed verifier at its 600,000 ms installer deadline. Production 7z packaging, both read-only preflights and all browser cases passed. The installer made observed file progress before termination, but installation remains unconfirmed. Retained-memory UI, restart and uninstall remain unexecuted. Activation stays off and the bundle remains PARTIAL.** The [progress review](M05-installer-progress-review-43744480609.json) records zero of 16 sampled payload files present at 300 seconds, then 12 matching expected sizes at 540 seconds, with four absent and the uninstaller absent. The parent process had not exited before the verifier requested termination at 600 seconds. This supports a bounded installer-only **1,200,000 ms** allowance for the measured 92,880-file payload, plus two late diagnostic samples. It is not a percentage-complete estimate or a completion-time prediction. The full installed inventory, registry, provider, launch, restart and owned-cleanup requirements remain mandatory. The uninstaller and read-only preflight limits stay 180,000 and 60,000 ms. Actual Windows execution of this narrow budget repair is pending.

**Earlier complete passing cut:** [Run 43726164418](M05-windows-ci-43726164418.json) records **3,746 application passes/39 skips**, **33 Hermes contracts**, **37 policy/plugin cases**, successful typecheck, UI policy and builds, and **267 browser passes/two skips/zero failed or flaky**. All 29 split baseline cases and all four later suites executed successfully, including the FAQ case with the exact `Collapse artifact` focus assertion. Production source and every pre-existing assertion remain unchanged. This is a pass for the recorded source/test cut. It predates the native FILE cases and installed packaging job; their separate run 43733008039 results are recorded below.

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
| Desktop shell build | Web and shell builds passed. No packaging, installation or launch claim. |
| Browser split / memory / context / frontend / root | 29 / 15 / 21 / 90 / 112 passed, with one frontend and one root skip. Total **267 passed, two skipped, zero failed or flaky**. All 17 plan cases and four document widths execute and pass. |

All 24 observed command records from this run were imported with exact runner working directory, observed step time envelopes, exit basis, raw-log digests, bounded excerpt digests and immutable per-command metadata. No process duration is invented from a whole CI step. Receipt SHA256: `0a0d786b816c53b68147dfc99284114d028fb42a59ad5f4915ea3794fb6006a8`. Raw jobs API SHA256: `fc7557883dc65a730110f256dfca61283f935f854470b9f1e881f66517d458df`. That run's raw browser log is 110,540 bytes with SHA256 `cb63fd852f6ccbc12849bd28365141f008c19f084d4a2eebc35579c1095d3295`.

The browser artifact `browser-43721299625-1`, ID `14164773288`, is 2,471,434 bytes. Its downloaded ZIP SHA256 `64760970da9e8f85ba9dd7a44450f7cc7a190641430fb8e6c695e1fb065f8771` matches GitHub metadata. Archived results independently confirm the same suite counts and no failure traces. These synthetic browser and scripted native results establish the repaired execution boundaries at that historical cut. It did not execute native FILE capture or installed/live-provider checks. The later native FILE result is recorded under run 43733008039; installed-desktop execution and authorized live quality/cost remain open. Both memory flags remain false.


The [browser artifact review for run 43721299625](M05-browser-review-43721299625.json) independently records all suite counts, the two explicit skipped cases, exact viewport/theme/zoom/image identities and observations from 21 screenshots. Nine plan, eight Skills and four usage/context images were inspected. No actionable visual defect was observed; the report limits screenshot claims to visible content and keeps behavioral proof in the executed tests.


## Final documentation CI navigation failure and subsequent startup repair

[Run 43723377122](M05-windows-ci-43723377122.json), attempt 1, tested documentation-only published head `c0399961dee169d9bcdb443e3807436bd4d3aa28`. Every job checked out `f60285443ea20b5bf6039edf7a4aa1798b47648e`, whose parents are accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. The checkout and published head share tree `f4f987bb80b0cbb4abbd5f59e92b4dde18371cc3`. Production, test and workflow source was unchanged from the earlier passing head `a0755d344513feced0f79717cf90d39f64cfe619`; the original split-app test has Git blob `c1b13c2bb6c1d7d658fc306414f44bfdb3e10dda` at both heads. The timeout repair described below came after this failed run.

| Coverage in run 43723377122 | Observed result |
| --- | --- |
| Application shards 1 / 2 / 3 / 4 | 1,073 / 927 / 842 / 904 passed; 0 / 7 / 2 / 30 skipped. Total **3,746 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**, including the pinned facade and actual Worker checkpoint cases. |
| Windows policy/plugin checks and builds | **37 passed**; typecheck, UI policy, production build and desktop shell build passed. All seven non-browser jobs passed. |
| Split-browser baseline | **28 passed, one failed**: 18 split-app cases and ten split-renderer cases passed. The first split-app case failed during initial fixture navigation. |
| Project-memory / usage-context / frontend-refinement / root suites | **NOT_RUN** in this attempt. Their shared workflow step was skipped after the failed baseline step. This is not four executed suites with skipped test cases. |

[Browser job 132839958308](https://github.com/skytuhua-org/Gen-V1/actions/runs/43723377122/job/132839958308) failed `keeps full thread renderers, drafts and exact send owners through tab movement, parking and reload`. The preserved [bounded log](m05-logs/windows-ci-43723377122-132839958308.log) reports `page.goto: Timeout 7000ms exceeded`, navigating to `http://127.0.0.1:5598/split-app-check` while waiting for `load`. The stack points to initial fixture navigation at line 93 of the tested source, reached before its renderer readiness checks and test assertions. The complete first-case duration was 13,793 ms; that includes fixture work and is not a navigation-duration measurement. The report uploader found no files, so this attempt produced no browser artifact or subresource trace.

A cold first-load delay is consistent with the first fixture failing while the other 28 baseline cases pass, and with the same source having passed the earlier workflow. The available log does not identify a measured Vite bottleneck or establish a timing distribution. The observed failure is the initial-navigation deadline; attributing the delay to cold module loading remains an inference.

The repair changes only [the fixture's initial `page.goto`](../../../tests/split-app-browser.test.ts) to pass `{timeout:20000}`. It retains the same URL and `load` completion condition, `page.setDefaultTimeout(7000)` for subsequent actions, the failing case's 30-second outer bound, every other existing test bound, and all ownership, draft, movement, parking, reload and geometry assertions. It adds no retries or skipped cases. Run 43724428807 subsequently passed all 29 split-browser baseline cases with this repair and executed all four later suites. Its separate FAQ failure kept that workflow failed. The later run 43726164418 passed both the split baseline and the complete workflow with the FAQ readiness assertion.

The [failed receipt](M05-windows-ci-43723377122.json) has SHA256 `a31201f3bca8b3806488c9c8065961dbc9c6eee5b02a4e05f6244a3ca1e542a1`. The exact connector-decoded browser log is 67,096 bytes with SHA256 `8873a2b53ddaa240795308f27046fb6607d8ad5be1797b3185605ac16c5d05a1`; the bounded stored log has SHA256 `a2259cec1b1edd33cf20f644bcf068a796707a552d4072ad445b8a0dd86c75fb`. The receipt retains all eight job identities, observed step times, results and raw/stored log identities. Earlier green and failed records remain intact. This historical run supplies no native FILE, installed-desktop or live quality/cost proof. The later native FILE result is recorded under run 43733008039. Production-source review remains complete, both memory flags remain false, and installed/live gates remain open.


The [independent startup review](M05-browser-startup-review-43723377122.json) records the unchanged original test blob, prior whole-test timings, matching runner/toolchain, inference limits and exact reviewed repair digest. [Startup-repair full typecheck](m05-logs/continuation-split-initial-navigation-typecheck.log) passes. Twenty observed commands from the failed attempt were imported: nineteen PASS and one FAIL. The skipped browser step has no invented command or exit record.


## Startup-fix CI and FAQ expansion readiness repair

[Run 43724428807](M05-windows-ci-43724428807.json), attempt 1, tested published head `2e210878eaef60c63e0d02ac2737f9fe6188a96d`. All jobs checked out `af91fb4993bbb05f6429c681073a00c5bd335440`, with parents accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. The published head and checkout share tree `236d62b5ead175670ddfe258848492fae366a835`. This cut includes the initial-navigation timeout repair and predates the new FAQ focus assertion.

| Coverage in run 43724428807 | Observed result |
| --- | --- |
| Application shards | **3,746 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**. |
| Windows policy/plugin checks and builds | **37 passed**; typecheck, UI policy, production build and desktop shell build passed. All seven non-browser jobs passed. |
| Split-browser baseline | **29 passed**, including the formerly failing first fixture with the 20-second initial navigation budget. Its 6,281 ms whole-test duration does not measure navigation duration. |
| Project-memory / usage-context | **15 / 21 passed**. Both suites executed. |
| Frontend-refinement | **89 passed, one failed, one skipped**. The sole failure is `connected FAQ branches and follow-up draft retain independent state`. |
| Root baseline | **112 passed, one skipped**. This suite executed after the frontend failure because the wrapper retains and reports every suite result. |
| Entire browser job | **266 passed, one failed, two skipped**. The workflow failed and is preserved as failed. |

The [browser log](m05-logs/windows-ci-43724428807-132843172407.log) records the FAQ case's post-Escape assertion failing because the `Expand artifact` control was absent. The [trace review](M05-faq-readiness-review-43724428807.json) identifies the missing readiness boundary: Escape began at trace-relative **37,730.573 ms**, before the expanded-snapshot response was fulfilled at **37,732.134–37,733.218 ms**. The before-Escape DOM snapshot at **37,732.286 ms** still shows an inline artifact, `Expand artifact`, no dialog and zero open tooltips. The after-Escape snapshot at **37,762.642 ms** shows the expanded dialog and `Collapse artifact`; the trace contains no collapse command. The existing retained-text assertion had passed against the unchanged inline draft before expansion completed, so it did not establish that the expanded view was ready to receive Escape. The DOM and command sequence establish this readiness race in the recorded execution. These trace timestamps are relative to that execution, not wall-clock times or a general latency measurement.

The repair adds one assertion immediately after clicking `Expand artifact` in [artifact-style.spec.ts](../../../tests/e2e/artifact-style.spec.ts): the exact `Collapse artifact` button must be focused. The retained follow-up value is then checked and Escape is pressed. All existing branch interactions, answer-visibility checks, retained follow-up value and post-Escape focus-return assertion remain. No production source, timeout, retry or skip changes accompany this assertion. The new readiness boundary subsequently passed the complete required Windows workflow in run 43726164418. This failed trace remains preserved as the regression evidence.

Receipt SHA256 is `cd82f10fe3fa036f8d06cbc9ae085bc56db103f5be73d5f4744a6ea9a43888de`. The exact connector-decoded browser log is 113,499 bytes with SHA256 `aa65ea6f1a35e8f0c597aa6e2d384fa03297401913f57342165dd9365cb3c7d1`; the bounded stored log SHA256 is `71f7ce237646152d709faaab305abb518fdd675c715b4d6f026d2f111d986e9d`. Artifact `14166187603` is 3,459,123 bytes, with ZIP SHA256 `da778017323b00d134232be3e1db503f0df809ed2319cc9b14231b6c24a9f1cc`; it supplies the recorded FAQ failure trace. The 21-screenshot review from run 43721299625 remains explicitly historical on unchanged production/UI source. This update carries forward that visual review and cites the new trace for the failed interaction. Both flags remain false. This failed run supplies no native FILE, installed-desktop or live quality/cost proof; the later native FILE pass is recorded separately under run 43733008039.

[FAQ readiness full typecheck](m05-logs/continuation-faq-expansion-readiness-typecheck.log) passed with exit 0. The failed run contributes 24 observed command records, 23 PASS and one frontend-refinement FAIL. Those local typecheck and failed-run records do not establish browser execution of the added assertion. That execution is supplied separately by successful run 43726164418 below.


## Complete Windows verification of both fixture repairs

[Run 43726164418](M05-windows-ci-43726164418.json), attempt 1, completed successfully with **all eight jobs passing** on published head `d081973eedf23c684986076424cbbec9db7af951`. The actual PR checkout is `9caea6e081805c19a961030fe61fa9fa856153e1`, with parents accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. Both share exact tree `ffac9062087884b98f2ba73eb1c03e5219b43edb`. Since the earlier complete passing and visual-review cut, the only changes outside documentation are the two reviewed baseline fixture repairs. Production/UI source is unchanged.

| Required coverage in run 43726164418 | Actual result |
| --- | --- |
| Application shards 1 / 2 / 3 / 4 | 1,073 / 927 / 842 / 904 passed; 0 / 7 / 2 / 30 skipped. Total **3,746 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**, including the five pinned facade and three actual Worker checkpoint cases with scripted responses. |
| Windows policy/plugin checks and builds | **37 passed**; typecheck, UI policy, production build and desktop shell build passed. |
| Split-browser baseline | **29 passed**, using the 20-second initial fixture navigation budget with unchanged action and outer-test bounds. |
| Project-memory / usage-context | **15 / 21 passed**. |
| Frontend-refinement | **90 passed, one skipped**, including `connected FAQ branches and follow-up draft retain independent state` with the added exact Collapse focus assertion. |
| Root baseline | **112 passed, one skipped**. |
| Entire browser job | **267 passed, two skipped, zero failed or flaky**. All four later suites executed after the successful baseline. |

The [browser log](m05-logs/windows-ci-43726164418-132848442428.log) directly records the repaired FAQ case passing. The passing baseline and FAQ case establish execution of both repairs; they do not turn the original cold-load explanation into a measured bottleneck or a navigation-duration benchmark. Runs 43723377122 and 43724428807 retain their original failures, source identities, trace/absence-of-trace limits and command outcomes.

Receipt SHA256 is `1e7cad6540fbd07ff66a1c2aac5732c6e5423c08c249be72b57cde4e926c4e53`. The exact connector-decoded browser log is 111,640 bytes with SHA256 `8cfa7e773ebbe05382c1be062f14527456394893c3806019a8b52cad4fc3b16f`; its bounded stored SHA256 is `1845b1a27af66d025bb8f318db865db487def028f1587869dc300bb894cd0442`. The receipt preserves all eight job identities, observed step timestamps, exact checkout and raw/stored log identities. This observed result applies to the published source/test cut; a later documentation commit is not represented as already executed.

The [21-screenshot review from run 43721299625](M05-browser-review-43721299625.json) remains explicitly historical on unchanged production/UI source. No new screenshot inspection is claimed for run 43726164418. This historical cut did not establish native FILE, installed-desktop or live quality/cost proof. Run 43733008039 later closes the bounded native FILE gate; installed/live gates remain open, both flags remain false and the bundle remains PARTIAL.


## Finalization host-publication failure and bounded setup repair

[Run 43727736261](M05-windows-ci-43727736261.json) tested documentation-only head `5e835ff71ad02298ce3a7c6c080d92f5f04deb47`, actual checkout `a8629917231acf1950145684a38d2c0ff937e3eb`, exact tree `d3dc4a903defee022d79be00391f6a52e7487cc3`. The source/test/workflow cut was identical to the preceding all-green head `d081973eedf23c684986076424cbbec9db7af951`. All seven non-browser jobs passed: application 3,746 passed/39 skipped, Hermes 33 passed, policy/plugin 37 passed, typecheck, UI policy and builds passed. Browser totals were 266 passed, one failed, two skipped. Split 29, M05 15, usage/context 21 and frontend-refinement 90 with one skip passed; root had 111 passed, one failed and one skip. The initial-navigation and FAQ repairs both passed again.

The sole failure was `generated operation button requires native approval; restart restores without repeating effects`. It stopped in `sendFixture` before the approval, file replacement or restart assertions. The original five-second visibility assertion began immediately after Send, combining real native file preparation, import, host publication, snapshot delivery and renderer restoration in one budget.

The [trace review](M05-host-publication-review-43727736261.json) preserves exact API/snapshot identities. The send click ended at 104,893.626 ms. The browser visibility call began at 104,903.014 ms and failed at 109,940.892 ms. The first artifact-bearing snapshot began at 109,827.142 ms and completed at 109,829.162 ms, leaving about 74 ms to the nominal browser-call deadline. Earlier snapshots contained no artifact. The assertion observed the newly mounted artifact as hidden at 109,854.750 ms. The after-failure DOM at 109,955.540 ms already had neither `data-artifact-pending` nor `data-artifact-measuring`. These observations do not support a five-second renderer or journal stall. They establish that the first artifact-bearing snapshot arrived near the end of the combined wait, with readiness observed about 15 ms after assertion failure. Host publication and SSE transit durations are not separately measured.

`ContractRuntime` sequentially awaits `file_replace_prepare`, `text_import` and `ui_present`. The first two use real guarded reads. The Windows guard starts the system PowerShell process and has its own bounded RPC and shutdown. The trace does not measure the individual guard subprocesses, so it does not establish their exact contribution or a platform latency benchmark.

The minimal fixture repair adds `expect(artifact).toBeAttached({ timeout: 15_000 })` before the existing `expect(artifact).toBeVisible()`. Publication now has a separate bounded allowance; the five-second visible-render assertion, outer test limit, action waits, zero retries, native approval checks, exact file effects and restart assertions remain intact. Production behavior is unchanged. Run 43729864202 subsequently executed and passed the repaired host-operation case in 9.1 seconds of whole-test time, including its original approval/effect/restart checks. That workflow failed separately on the initial acknowledgment-fixture readiness assertion described below.

The local package-manager wrapper [attempt](m05-logs/continuation-host-publication-readiness-typecheck.log) stopped before TypeScript with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` while trying an implicit dependency refresh. That failure remains recorded. The follow-up invokes the installed TypeScript compiler directly with the same `--noEmit` project check, without dependency installation or changes. The direct compiler exited 0; its result is retained in [the direct-compiler log](m05-logs/continuation-host-publication-readiness-typecheck-node.log).


## Host-publication repair execution and acknowledgment initial readiness

[Run 43729864202](M05-windows-ci-43729864202.json) tested head `9321f979e8feebe7899be365ad6678ac82343f54`, actual PR checkout `f54bd7b045ec83bd63cb69b46570adf580ba7fea`, exact tree `faccdd5ea6c029573060443a20d06a911c16b34c`. All seven non-browser jobs passed. The earlier failed host-publication receipt from run 43727736261 remains unchanged.

| Coverage in run 43729864202 | Observed result |
| --- | --- |
| Application shards | **3,746 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**. |
| Windows policy/plugin checks and builds | **37 passed**; typecheck, UI policy, production web build and desktop shell build passed. The desktop job did not package or install an application. |
| Split-browser / project-memory / usage-context | **29 / 15 / 21 passed**. |
| Frontend-refinement | **90 passed, one skipped**. |
| Root baseline | **111 passed, one failed, one skipped**. All 17 plan and four document-width cases passed. |
| Repaired host-operation case | **Passed, 9.1 seconds whole-test time**. This is not a measured publication, file-guard or renderer latency. |
| Entire browser job | **266 passed, one failed, two skipped**. The workflow remains failed. |

The sole failure was `an older snapshot cannot replace a newer acknowledged selection` in [artifact-acknowledgment.spec.ts](../../../tests/e2e/artifact-acknowledgment.spec.ts). Its initial `Select row 1` checked assertion started at trace-relative 14,717.137 ms and failed at 19,721.239 ms. Bootstrap began at 19,042.784 ms, about 4.3 seconds into that five-second assertion. The initial snapshot completed at 19,223.898 ms. The final DOM at 19,737.563 ms, **16.324 ms after assertion failure**, contains the expected checked row, without pending or measuring attributes. No `/api/commands` request occurred before failure. The trace therefore does not establish a stale-acknowledgment ordering defect; that behavior had not yet been exercised.

The [bounded diagnosis](M05-acknowledgment-readiness-review-43729864202.json) records the dynamic import in `main.tsx`: document `load` can precede shell module loading, bootstrap and initial rendering. Its network records establish this sequence, but do not separately measure Vite transformation, JavaScript evaluation or CPU scheduling. The first exact instant at which the row became visible is not measured.

The root repair adds only `await expect(selected).toBeVisible({ timeout: 15_000 });` before the existing initial checked assertion. All initial and later checked/unchecked assertions retain their original five-second allowance. The held save-receipt and `edit.end` barriers, stale revision 2 handling, authoritative revision 3 receipt, later revision 4 update, exactly two saves, Saved state, 650 ms quiescence interval, 30-second outer test timeout and zero retries remain. Production behavior is unchanged. Run 43733008039 subsequently executed and passed this case in 8.6 seconds of whole-test time, with every retained behavior assertion.

The raw browser log is 116,112 bytes, SHA256 `6de9449c3585bde649bcf0d1dfac4cda0f3035abb45d13c5f037733ead8f1473`. Artifact `browser-43729864202-1`, ID `14168760821`, is 2,874,047 bytes with verified ZIP SHA256 `44383af5fe0379e17f2198abc5362769dd6db0360941d590bb2a0f2e7eecb0c1`. The acknowledgment trace ZIP has SHA256 `90a37c90a7fc29c18b3813c9d11ace77beb7ab49aa15fb43fc8c94210e26428f`. The diagnosis preserves separate raw, bounded-log, trace and source identities. No new screenshot visual review or provider-spend measurement is claimed.

## Platform-proof run: native FILE passed, installed packaging failed

[Run 43733008039](M05-windows-ci-43733008039.json), workflow run 1074, attempt 1, tested published head `5a647b04c14ba4de8d80411aeba7e649227664fc`. Every job checked out `a6853729ff49ce2b42ec5cb29526a731e38a07df`, whose parents are accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. The actual checkout and published head share tree `2f8043bbb9dcd95c068eb91380ca5c897f0c754f`. All nine jobs completed: **eight succeeded and the installed packaging job failed**. The workflow remains failed.

| Coverage in run 43733008039 | Observed result |
| --- | --- |
| Application shards 1 / 2 / 3 / 4 | **1,095 / 911 / 845 / 903 passed**, with **0 / 7 / 2 / 30 skipped**. Total **3,754 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**. |
| Windows checks | **37 policy/plugin cases passed**; typecheck, UI policy and production build passed. |
| Desktop build | Web and desktop shell builds passed. This job did not package or install an application. |
| Split-browser / project-memory / usage-context | **29 / 15 / 21 passed**. |
| Frontend-refinement / root | **90 / 112 passed**, with one explicit skip in each suite. All 17 plan cases and all four document-width cases passed. |
| Entire browser job | **267 passed, two skipped, zero failed or flaky**. The acknowledgment repair passed in **8.6 seconds**, the host-operation approval/restart case in **9.1 seconds**, and the FAQ case in **2.6 seconds**, each measured as a whole test. |
| Real native FILE capture | **Three passed, zero failed or skipped** in application shard 4 on Windows. |
| Installed desktop memory retention | Declared Git/GitHub CLI staging passed; production packaging failed exact Python payload preflight. The verifier step was skipped. NSIS generation, actual installation, UI retention, restart and owned uninstall are **NOT_RUN**. |

The [browser case audit](M05-browser-cases-43733008039.json), SHA256 `2ab61db16bf8011b412ab4184fc32cf2661d06e3260dec658e0a6c3cb3a670fc`, preserves the individual case lines for all 15 M05, 17 plan and four document-width scenarios, plus the repaired acknowledgment, host-operation and FAQ cases. The raw browser log is 112,777 bytes with SHA256 `d2299c952118cbd1fbb18728c8f98f80dcdde7784e40bc27fce50d1dd641dba5`. These timings do not separately measure navigation, native guarded reads or host publication. No new screenshot inspection is claimed.

### Native FILE proof closed at this source cut

The [independent review](M05-native-file-review-43733008039.json), SHA256 `c13fd63b241017d18d91d6c85be7199447fdfb1b12c721dce4d5305582fa8115`, verifies the actual Windows job, exact source/fixture/guard identities and all three individual results. [The cases](../../../tests/memory-native-file-capture-v3.test.ts) execute the real guarded capture path, immutable UTF-8 source reuse without file changes, and rejection after grant revocation or physical replacement with identical bytes. Each denial also covers a previously retained candidate list, pinned source detail and recapture. No file-access module, guard, native process or retained snapshot is mocked. Constructor-local enablement uses disposable files/profile and leaves the production capability registry false.

The raw shard 4 log is 112,983 bytes with SHA256 `61fd87f5fb3a5d6d3b0e67b42bfd6de05e8a97200d13844620fd36807e39bc38`; its three-case suite reports 2,669 ms. No separate PowerShell PID/event trace was collected. This closes the bounded native FILE custody gate at head `5a647b04`; it does not prove arbitrary filesystem configurations, installed-package execution or a paid-provider evaluation. The prior [local typecheck](m05-logs/continuation-native-file-proof-typecheck.log) remains a distinct compilation result.

### Exact-lock packaging failure and subsequent canonical repair

[Installed job 132869421472](https://github.com/skytuhua-org/Gen-V1/actions/runs/43733008039/job/132869421472) failed `pnpm desktop:package --output-root .harness-installed-package` with `Installed Python integration payload differs from the exact lock` from `collectIntegrationPayload`. This happened before NSIS generation or installed verifier execution. The [bounded job log](m05-logs/windows-ci-43733008039-132869421472.log) preserves the failure. Its exact raw log is 60,653 bytes with SHA256 `5f59df9e8fe9831eaa4806295438fe64b61c352aa6aaf276fd246d67b76053ad`. No installed verification artifact or screenshots were produced, downloaded or reviewed.

The [test-cache recipe](../../../.github/actions/setup/action.yml) requests all 91 pinned wheel URLs as direct installations. The failed job restored that cache. The original [v1 packaging lock](../../../third-party/integrations/PYTHON_LOCK.json) contains only two `REQUESTED` files, no `direct_url.json`, 91 `RECORD` files and **7,324 non-RECORD files**. Pip's installed RECORD metadata includes hashes for Windows launchers excluded from the packaged payload; generated launcher metadata is nondeterministic. These source facts establish the metadata compatibility problem. The failed log does **not** list the actual mismatching paths in the restored cache, so it is not evidence of any particular per-file difference or changed non-RECORD payload.

The explicit wheel-authenticated canonical RECORD mode is implemented and independently reviewed. It verifies all 91 pinned archives, preserves the original v1 lock and every one of the 7,324 non-RECORD hashes, derives distribution ownership from authenticated wheel members, and emits a deterministic v2 installation receipt. The legacy exact-v1 mode remains available. The final focused suite passes 28 cases and full typecheck passes. Real Windows packaging and installed execution were pending at this cut; no repair pass is inferred from run 43733008039. The subsequent canonical package passed in run 43736761161, whose separate preflight and browser failures are recorded below.

The [projection review](M05-canonical-projection-review.json) and [CI/input review](M05-canonical-packaging-input-review-20261115.json) bind the frozen source. Review reproduced and fixed foreign metadata ownership after wheel-path spreading and an own-RECORD alias that generated duplicate self rows. The [28-case final suite](m05-logs/continuation-integration-record-projection-green-3.log) and [final typecheck](m05-logs/continuation-integration-record-projection-final-typecheck.log) pass. Those local checks did not establish compatibility of the real 91 archives or an installed application. The actual package review below supplies the later bounded archive/package result; installed behavior and a complete passing nine-job workflow remain open.

### Installed retention and activation remain open

The [installed verifier](../../../scripts/verify-installed-desktop.ts) has explicit `--project-memory-retention` mode with a [dedicated helper](../../../scripts/installed-memory-retention.ts). The original verifier path remains available when the option is absent. Current accepted Settings labels are used for Models & Accounts and Close dialog. The [installed CI job](../../../.github/workflows/ci.yml) is authored to package the production NSIS target from pinned toolchain/archive/file manifests, install per user, compare payload hashes, establish exact executable/nonce CDP ownership, launch twice with the same disposable physical profile and ports, and perform identity-bound uninstall. Its actual expanded verifier argv is emitted only when that step executes. That step did not execute in this failed run.

The seed uses production Store/ProjectMemory APIs only in a newly created canonical disposable profile. Constructor-local enablement creates four distinct source-backed rows; project opt-in is disabled before closing Store. The installed host retains both false flags, null account/model ownership and its real packaged sidecar. The authored UI flow requires pinned source bytes despite a changed message, accept/edit/reject, sensitive-text redaction in an actual download, Forget, and correction/tombstone persistence after restart. Post-exit observations require no active run, outbox, model-request, extraction or auxiliary-usage records. Provider network calls remain `null`, since those storage observations do not measure network traffic.

The [fail-first run](m05-logs/continuation-installed-memory-retention-red.log) retained four new failures and eight existing custody passes. The [local suite](m05-logs/continuation-installed-memory-retention-custody-green.log) passes 13 cases, and [full typecheck](m05-logs/continuation-installed-memory-final-typecheck.log) passes. These are fixture/option/custody results. That run retains its real package **FAIL**, while its actual installer, installed UI and second-launch checks remain **NOT_RUN**. Even a future retained-memory pass would establish only the seeded default-off subset. Enabled injection/exclusion, automatic extraction, native checkpoints and live task-quality/cost in the installed application remain unproven. Both memory flags remain false and the bundle remains PARTIAL.

The terminal [receipt](M05-windows-ci-43733008039.json) has SHA256 `3a76f4e986b334f9fc9acce1011e55a254e9b536782810a3292b560c9d5488e0`. All nine raw job logs, bounded logs, exact checkout metadata and observed step timestamps remain preserved. Twenty-six observed command records were imported: **25 PASS and one actual package FAIL**. The skipped verifier has no invented command, exit or duration. All 457 preceding ledger records and their bytes were retained. Historical failures, including the acknowledgment-readiness failure, remain failed evidence.


## Canonical packaging execution and two remaining Windows failures

[Run 43736761161](M05-windows-ci-43736761161.json), attempt 1, tested published head `828cdf52c76e44ca07c0fcdd647601a64bf30081`. Every job checked out `ce93c20a3394157af18f585f794c97dd067f37a5`, whose parents are accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. The actual checkout and published head share tree `a3f5f1b083689302f85dfd68fa5fcf735f5d401b`. All nine jobs completed: **seven succeeded; the installed verifier and browser jobs failed**. The previous packaging failure remains unchanged.

| Coverage in run 43736761161 | Observed result |
| --- | --- |
| Application shards 1 / 2 / 3 / 4 | **1,106 / 928 / 845 / 903 passed**, with **0 / 7 / 2 / 30 skipped**. Total **3,782 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**. |
| Windows checks | **37 policy/plugin cases passed**; typecheck, UI policy and production build passed. |
| Desktop build | Web and desktop shell builds passed. This separate job did not package or install an application. |
| Split-browser / project-memory / usage-context | **29 / 15 / 21 passed**. |
| Frontend-refinement / root | **90 passed/one skipped** and **111 passed/one failed/one skipped**. All 17 plan and four document-width cases passed. |
| Entire browser job | **266 passed, one failed, two skipped, zero flaky**. Acknowledgment passed in **6.3 seconds**, FAQ in **2.4 seconds**; the failed host-operation case took **20.9 seconds**, each measured as a whole test. |
| Real native FILE capture | All **three** unmocked Windows cases passed again in shard 4. The original bounded native FILE proof remains attached to its independent review. |
| Canonical projection fixtures | All **28** cases passed on Windows in shard 1. |
| Production package | **PASS**. Declared wheels, Git and GitHub CLI were staged; the production NSIS installer and digest-bound v2 receipt were generated. |
| Installed verifier | **FAIL** in initial read-only preflight, before installation. Actual installation, UI retention, restart and owned uninstall are **NOT_RUN**. |

### Actual canonical archive and package custody

The wheel stage's observed `HARNESS_PINNED_INTEGRATION_WHEELS` marker records **91** archives and original source-lock SHA256 `264d28c353d065001daaad796abf3602074599ab5fbd630bcb0958c529b63700`. The package process's bounded input diagnosis reports **7,415 expected files, 7,595 actual files, 180 added, zero missing and 91 changed**, with `truncated: true`. The complete 91-entry changed list consists of `.dist-info/RECORD` paths. The added list enumerates only 100 of 180 paths; those observed entries are recognized bookkeeping names, while the remaining 80 are not independently enumerated in the log. The reviewed collector still checks the complete input scan. This observed diagnosis belongs to run 43736761161 and does not retrospectively supply missing per-file logs for run 43733008039.

The [independent actual package review](M05-canonical-package-review-43736761161.json), SHA256 `555cc7d6d3ce0b8ed7686bca2e89b8c2f6be96151ac0c3a55a5e693491d611a3`, compares the [emitted v2 installation receipt](m05-platform-43736761161/PYTHON_INSTALLATION_V2.json) and [build manifest](m05-platform-43736761161/build-manifest.json) with the exact original lock and reviewed source. The receipt preserves the original **7,415-path set**, every one of the **7,324 protected non-RECORD byte counts and hashes**, and all **91 name/version/archive-hash pins**. The projected payload is **254,070,241 bytes**. Of its 91 canonical `RECORD` entries, 75 match the original v1 bytes and 16 differ, reducing the total by 2,005 bytes. This canonical-versus-v1 comparison is distinct from the input cache's 91 changed records.

The v2 receipt is 1,511,066 bytes, SHA256 `0eba7dbc92f9ceb13158e4084db3817f952f9704b1856f8ead4d708f91af30bc`. The build manifest is 15,611 bytes, SHA256 `a2fb7b54fcdd1adede5b46a1dfe84e20a41e6178b5faa267d19f6e5204e757c3`; it binds that receipt and records the production installer as 828,427,579 bytes, SHA256 `473ae36cbbd79c020f191e6f25e5fc37150dcbaabded106eb9d6424ee8c5c81d`. Successful execution of the reviewed stage, after-pack and relocated CLI checks establishes the bounded packaging result. The uploaded artifact contains these receipts, not the wheels, payload files or installer; the reviewer did not independently download and rehash every remote payload byte or regenerate a second complete projection. No installed or provider behavior follows from this package result.

### Installed preflight failed before installation

Installed job `132880966492` passed `pnpm desktop:package --output-root .harness-installed-package`. The actual verifier argv marker then identified the generated `Gen-V1-Setup-0.6.5-win-x64.exe`, matching `win-unpacked` directory and `--project-memory-retention`. The verifier step ran from **16:50:26Z to 16:50:44Z** and exited 1 with `Owned installer verification process exceeded its deadline.` Those timestamps are the CI step envelope, not an individual process duration.

The [failed verifier receipt](m05-platform-43736761161/verification.json), SHA256 `7a0f27427cb7394d1245a8544a6666139c7648a18cf1145884d3128254d868e9`, was created at **16:50:29.048Z**. It contains no completed preflight, expected-payload, install-command or memory-retention fields. `launches` is empty, `passed` is false and cleanup is `not-installed`. The reviewed control flow places the deadline in the first read-only preflight's 15-second process bound. No installer, installed executable, retained-memory UI interaction, restart or uninstall executed. There is no owner receipt or screenshot, and no installed visual review is claimed.

Artifact `installed-memory-43736761161-1`, ID `14171500306`, was retrieved once and its ZIP verified at **355,244 bytes**, SHA256 `f205f14fb5456ed1f934acc9512a409ddcd698503f54be7d99c1ea5d22b0cbcb`. It contains the three receipts described above. The raw installed-job log is **124,917 bytes**, SHA256 `d01dda66e6751ebb87b15ba228814e6ee18cdd6a263b90b97f24f3e5197b3234`; the [bounded job log](m05-logs/windows-ci-43736761161-132880966492.log) preserves the observed phase transitions and failure. Repair work and later focused tests do not change this failed attempt or establish Windows installed success.

### Browser publication failure remains a separate finding

The sole failed case is `generated operation button requires native approval; restart restores without repeating effects` in [host-loop.spec.ts](../../../tests/e2e/host-loop.spec.ts). It fails in `sendFixture` at `expect(artifact).toBeAttached({ timeout: 15_000 })`, before native approval, effects or restart assertions. This is the separate publication allowance added after run 43727736261; the current failure is not assigned that earlier cause merely because the same case failed.

The current trace records Send at **84,298.555 ms** and the attachment assertion from **84,318.052 to 99,362.600 ms**. The available snapshots remain at sequence 9 with the thread working, no error, zero operations, zero data and zero artifacts; the last is at **84,393.574 ms**. No later artifact-bearing snapshot or completed publication appears before teardown. Teardown begins at **99,369.875 ms**, before the SSE error at **99,379.844 ms**, so that error does not prove a prior stream failure. Host stage observations were not uploaded. The record establishes missing publication within the fixture's bound; it does not establish a native timeout, a completed success, a renderer delay, or the exact underlying host stage. Further diagnostic repair and a new Windows result are required.

The raw browser log is **115,042 bytes**, SHA256 `ae873113d07ef18a7f1d18515833bcb11bd0b2dac32d5bdd5d26d503bbcc355a`. The [bounded job log](m05-logs/windows-ci-43736761161-132880966837.log) preserves the run boundary and failure. Individual command logs retain the [15 M05 cases](m05-logs/windows-ci-43736761161-a1-j132880966837-s6-browser-project-memory.log) and [root cases](m05-logs/windows-ci-43736761161-a1-j132880966837-s6-browser-root.log), including plan/document coverage and the failed host fixture. Artifact `browser-43736761161-1`, ID `14170209844`, was retrieved once and verified at **5,077,455 bytes**, ZIP SHA256 `0f203a3457cf4c8c9991bad55c1eebf2a01c436c6ed5367c5a02715c7ecc8b33`. The independent trace review inspected one retained pre-failure frame at 1440 by 1000 pixels: it shows the scripted assistant message and Working state, with no artifact or error panel. This is failure evidence, not a new passing visual result.

### Terminal evidence and remaining gates

The terminal [receipt](M05-windows-ci-43736761161.json) has SHA256 `eaf2b2f22a21820c4bb68b3a0393fd78df35a23d06abc136ee514e1d13396967`. All nine raw job logs, bounded logs, actual checkout metadata and API step timestamps remain frozen. Twenty-seven observed command records were imported: **25 PASS and two FAIL**, one for the installed verifier and one for the root browser suite. All **492 preceding records and their 259,502 bytes** were preserved exactly. The wheel-stage script, marker and time envelope are retained as observed metadata attached to the installed command receipts; no single executable command or individual download duration is invented for that compound step.

Canonical packaging and the bounded native FILE proof are now established at their recorded source cuts. Installed retention, a full enabled installed lifecycle, live repeated-task quality/spend and a completely passing nine-job workflow remain open. The default-off retained-memory verifier, even if it later passes, cannot establish enabled injection/exclusion, automatic extraction, native checkpoint behavior or provider network calls. Both memory flags remain false and the bundle remains PARTIAL.


## Reviewed verification repairs before the next Windows execution

The [preflight failure and repair review](M05-installed-preflight-review-43736761161.json) binds the initial 15-second failure, the 60-second read-only probe repair, six fixed phase markers and the [15-case local custody/diagnostic pass](m05-logs/continuation-installed-preflight-diagnostics-green.log). Installer and uninstaller budgets remain 600 and 180 seconds, with every existing custody assertion intact. The old internal preflight bottleneck was not measured.

The [browser trace and repair review](M05-host-publication-review-43736761161.json) binds the missing-publication observation and its unknown pending stage. Only the operation fixture receives a 40-second publication allowance and 60-second outer test limit. It receives its exact HostFixture explicitly, propagates recorded errors, bounds stage metadata and uploads the existing host-observations file. Other fixture publication waits, five-second rendering/approval assertions, zero retries and production guard limits remain unchanged. All revision, file-effect and restart assertions remain.

The [final combined typecheck](m05-logs/continuation-installed-preflight-browser-final-typecheck.log) passes over both frozen repairs. Those local checks supported the next Windows publication and did not change either failed attempt. The actual execution of both repairs is recorded in run 43739565577 below.


## Preflights and browser repair passed; installer deadline failed

[Run 43739565577](M05-windows-ci-43739565577.json), workflow run 1083, attempt 1, tested published head `b2c81411b4783c12a56eda3f0e7cd54d66fe67b4`. All nine jobs checked out `21b97981b0eebc48be38d5d98bb705abaa35f7c3`, whose parents are accepted main `399cde39ff4ee82272c7a7700944325c44b36070` and that head. The actual checkout and published head share exact tree `3a157a5a3be86368e8a4b1404ab2e8886b630bdc`. **Eight jobs passed and the installed verifier job failed.** Earlier failed receipts and logs remain unchanged.

| Coverage in run 43739565577 | Observed result |
| --- | --- |
| Application shards 1 / 2 / 3 / 4 | **1,108 / 928 / 845 / 903 passed**, with **0 / 7 / 2 / 30 skipped**. Total **3,784 passed, 39 skipped, zero failed**. |
| Hermes contracts | **33 passed**. |
| Windows checks and builds | **37 policy/plugin cases passed**; typecheck, UI policy and production web build passed. The separate desktop job built the web and shell only. |
| Split-browser / project-memory / usage-context | **29 / 15 / 21 passed**. |
| Frontend-refinement / root | **90 / 112 passed**, with one explicit skip in each suite. All 17 plan cases and all four document-width cases passed. |
| Entire browser job | **267 passed, two skipped, zero failed or flaky**. Host operation **7.9 s**, acknowledgment **5.1 s**, FAQ **1.6 s**, measured as whole tests. |
| Real native FILE / canonical projection / installed custody cases | **3 / 28 / 15 passed** on actual Windows. These case counts overlap the application total. |
| Production packaging | **PASS**, including declared wheel and Git/GitHub CLI staging, strict package checks and production NSIS generation. |
| Read-only preflights | Both **completed**, with observed elapsed times **29,665 ms** and **22,682 ms** under their 60,000 ms bounds. |
| Actual installer / retained-memory flow | Installer **attempted and failed its 600,000 ms deadline**; installation remains unconfirmed. Installed launch, retained-memory UI, restart and uninstall are **NOT_RUN**. |

### Successful browser operation and measured fixture stages

The [independent operation review](M05-operation-stage-review-43739565577.json), SHA256 `c4611ff9933ff14e8b2ae7d899ba583bb717c9d99dcca7dfd97f98cb46575e13`, verifies the exact case `generated operation button requires native approval; restart restores without repeating effects`. The results artifact records **7,919 ms whole-test time**, a 60,000 ms outer limit, retry 0 and no errors. Every retained assertion executed: source bytes remain unchanged before approval; stale approval revision is rejected; valid approval is required for exact replacement; the succeeded outcome is visible; restart restores state without delivering new runtime work or repeating the file effect. Exactly one operation-started event remains.

The [actual host observations](m05-platform-43739565577/host-observations.json), SHA256 `6ac1e06912a75ca74a6f4c20fc85d220364ce2c36d39f8f146fffc42f3b15118`, record five successful stages, with no failed or pending stages:

| Scripted stage | Observed elapsed milliseconds |
| --- | ---: |
| Runtime start | 3,946.753 |
| `file_replace_prepare` | 3,565.453 |
| `text_import` | 373.586 |
| `ui_present` | 1.580 |
| Runtime follow-up | 2.121 |

The runtime-start row includes its three tool rows and must not be added to them. These measurements include each complete awaited scripted runtime or `Service.tool` callback. They do not isolate PowerShell startup, individual native RPC time, model latency or a benchmark. They describe this passing run and do not retrospectively identify the unobserved pending stage in failed run 43736761161. No production guard or authority limit changed.

The independent reviewer inspected two operation-fixture screenshots: the native approval controls and the restored succeeded outcome after restart. This is not a new visual review of all M05 screens or an installed-memory pass. Browser artifact `14171219295`, `browser-43739565577-1`, was retrieved once and verified at **2,488,308 bytes**, ZIP SHA256 `39a167d17c90a54eee3e0f4f9505f43f757a06b663b8b28181d285ede601f30a`. The raw browser log is **110,836 bytes**, SHA256 `e6922202eb3015716c201b2d1f2a1f4ffec8aacb7ff7321d070dbb8e3733dc68`. The individual [project-memory](m05-logs/windows-ci-43739565577-a1-j132889515502-s6-browser-project-memory.log) and [root](m05-logs/windows-ci-43739565577-a1-j132889515502-s6-browser-root.log) command logs preserve the required case lines.

### Packaging and preflight passed before the installer failure

The production package step ran from **17:11:39Z to 17:22:55Z** and passed. The actual verifier step ran from **17:22:55Z to 17:34:51Z** and failed. These are observed CI step envelopes, not individual process durations. The emitted argv marker names the generated production installer, corresponding `win-unpacked` directory and `--project-memory-retention` option.

The generated v2 installation receipt is byte-identical to the [preceding immutable canonical receipt](m05-platform-43736761161/PYTHON_INSTALLATION_V2.json): **1,511,066 bytes**, SHA256 `0eba7dbc92f9ceb13158e4084db3817f952f9704b1856f8ead4d708f91af30bc`. The original source lock and all non-RECORD pins remain unchanged. The new build manifest is **15,611 bytes**, SHA256 `9c342a08e317f1a653f85c93668f9c3f674670a54b4128ab0f6144d08c4b0b3f`. Actual package success and its receipt remain distinct from installed ownership and post-install payload checks.

The [verification receipt](m05-platform-43739565577/verification.json), SHA256 `a140751889c929b3575732ea391fdaca75e0bcc68a283ca78e85c19a3ddc60c6`, was created at **17:22:59.118Z**. The [installed phase review](M05-installed-phase-review-43739565577.json) verifies the report and its execution boundary. Its `before-install` preflight began at **17:22:59.120Z** and completed with observed elapsed time **29,665 ms**. Its `pre-install-recheck` began at **17:24:26.880Z** and completed in **22,682 ms**. Both records include the fixed six phase markers and a 60,000 ms bound. The observed preflight state has no matching installed registry entries, app shortcuts, updater cache or running app PID. This is direct execution evidence for the reviewed read-only preflight repair; the previous 15-second failure remains recorded separately.

Before the installer attempt, the verifier recorded the expected unpacked payload as **92,880 files**, **2,567,765,358 bytes**, digest `0d2fd55f5424b9c0057306b849d6f4276f7526b1fb81765d4154ec8d764ae604`, and maximum installed path length **240**. These are expected pre-install values, not proof that the installed files exist. The [owner receipt](m05-platform-43739565577/owner.json), SHA256 `ecc9c033455c322c1be254b7cca4ddfb879ce22b2fde15b2dfb18dca2f8c29fb`, records the exact setup hash, owned temporary destination and application GUID. The setup hash is `5980141204c178790423c2803ded5080ea9c43e5d25948dfee47047f38b24afc`.

The actual installer attempt then failed with **`Owned installer process exceeded its 600000 ms deadline.`** No successful install result, installed-registry custody, installed payload comparison, provider verification or memory-retention observation follows. `launches` is empty. Cleanup records **`preserved-unconfirmed-installation`**; it does not claim that the unconfirmed installation was safely uninstalled or removed. No installed screenshot exists. The report establishes an attempted installer deadline failure and preserved unconfirmed state. The installer’s underlying cause remains undetermined.

Installed artifact `14172970343`, `installed-memory-43739565577-1`, was retrieved once and verified at **356,377 bytes**, ZIP SHA256 `4b965d11507bc7f01441310c358581c03b35a19e512e44d304c34e6008eaea90`. It contains the verifier and owner receipts, build manifest and canonical v2 receipt; it contains no installed screenshot. The raw installed-job log is **126,569 bytes**, SHA256 `c15eb4ce2c7b18ae351432b2b9fdb0c257d88f9d022bb7f1246b6ad2a67bd16b`. Its [observed verifier command](m05-logs/windows-ci-43739565577-a1-j132889515576-s7-installed-retention.log) remains **FAIL**.

### Immutable terminal import and open gates

The terminal [receipt](M05-windows-ci-43739565577.json) has SHA256 `b649808b547f9e8f468044e10de57059c21caca6d8d473b1763c5a611482370e`. All nine raw logs, bounded whole-job logs, actual checkout metadata and per-step API timestamps remain frozen. The command import appended **27 observed records: 26 PASS and one FAIL**, preserving all **522 preceding records and their 273,876 bytes** exactly. The wheel staging script and marker remain observed step metadata; no single executable or individual download duration is invented.

Both preflight and browser fixture repairs now have successful target execution. The entire workflow remains failed because actual installation is not confirmed. Default-off retained-memory UI/restart/uninstall, full enabled installed injection/exclusion/extraction/checkpoints, and live repeated-task quality/spend remain unproven. Flags remain false and the bundle remains PARTIAL. Historical failures and successful results retain their original scope and source identities.

## Reviewed installer format and diagnostic repair

The [exact pinned-plugin review](M05-nsis-zip64-review-43739565577.json) verifies the checksum-pinned `nsis-resources-3.4.1` archive and byte-for-byte identity between its Unicode `nsisunz` DLL and the DLL in the original source distribution. The matched parser reads only classic ZIP records. A bounded Linux execution of that unchanged parser traverses all 65,535 classic entries, then rejects the first central-directory record in a 65,536-entry ZIP64 archive with `UNZ_BADZIPFILE`. The allocation-only compatibility header and initial compilation failure are recorded. This proves a format compatibility defect; it does not establish the old installer’s exact error dialog or timeout mechanism. The 92,880 expected unpacked files are not an observed archive-member count because the builder excludes certain media suffixes.

The [reviewed two-file repair](M05-nsis-7z-repair-review-20261115.json) sets `useZip:false` and changes only the corresponding existing packaging expectation. Pinned builder 26.18.0 selects the 7z archive and `Nsis7z` extractor together, with its supported installation-time filter. All other installation policies, resource paths and CRLF bytes remain. The exact pinned decoder also matches the official 19.00 distribution. Its template extracts into a temporary tree and copies during installation or update, adding I/O and approximately one unpacked tree to peak disk use. It does not add extraction to ordinary application launches. Build/decode durations, package size and temporary-path behavior require actual Windows observation. The complete installed inventory remains the acceptance gate even if the pinned extractor or copy fallback silently omits a file.

At the earlier [installer repair cut](M05-installer-repair-review-20261115.json), the four changed source/test files retained spawn PID, separate exit/close timing and status, first terminal failure, termination requests and output byte counts. Four checkpoints at 30, 120, 300 and 540 seconds inspect at most 16 authenticated manifest files plus the fixed uninstaller. Each sample is read-only, limited to five seconds and 1,200 metadata checks, rejects redirected/replaced directories, and retains aggregate counts without paths or file contents. Diagnostic failure cannot authorize cleanup. Clean completion still requires exit 0 and close 0 with no signal; exact registry, executable, payload and uninstaller custody remain unchanged. At that historical source cut, the installer and uninstaller deadlines were 600,000 and 180,000 ms.

Focused evidence preserves the intended packaging mismatch before repair (**one failed, ten passed**) and **11 passes** afterward. The diagnostics fail-first run records **three failed, 15 passed**; its first green records **18 passes**. Independent review then reproduced a late process error overwriting an earlier deadline reason (**one failed, 18 skipped**). The first-failure guard fixes it, and the final custody suite records **19 passes**. The final combined full typecheck exits 0. All commands, times, outcomes and log digests remain in the ledger and final review. That local review did not yet establish Windows package/install success. Run 43744480609 subsequently executed those bytes with package PASS and installer FAIL, as recorded below; the later 1,200-second/six-sample repair remains pending.

## Observed 7z installation progress and bounded budget repair

[Run 43744480609](M05-windows-ci-43744480609.json) tested head `60f030a2a6a764b858da110586c666353705a5fd`, actual checkout `a7ab39080e2d8a27449774a40d55282cd132f828`, tree `b133507695a2130ba4c80cf738e70d4553378864`. Eight jobs passed and the installed verifier failed. Application results were **3,788 passed/39 skipped/zero failed**; Hermes contracts **33 passed**; policy/plugin **37 passed**. Browser results were **267 passed/two skipped/zero failed or flaky**, including all 15 M05, 17 plan and four document-width cases. The complete approval/effect/restart case passed in 19.2 seconds as reported for the whole test. The Windows installer custody and packaging suites passed 19 and 11 cases; those counts overlap the application aggregate.

Production 7z packaging passed in the observed step envelope **18:04:19Z to 18:20:50Z**. The [verifier receipt](m05-platform-43744480609/verification.json), **6,165 bytes**, SHA256 `58b54ce2ab2ee2f523624072613d508368592fc898ccd4c8bd2703e6f5361547`, records clear preflights of **29,997 ms** and **22,749 ms**, followed by the attempted installer. The expected payload is **92,880 files/2,567,765,358 bytes**, maximum installed path length **240**, manifest digest `4e10d6a58d410ffbaab748b459bc44298a924d8cfc883ee8865632f2d18191ce`. These are expected payload measurements, not a completed installed comparison.

The installer started at **18:22:46.286Z** and spawned PID 5628 after 18 ms. All four diagnostic samples completed and observed the same ordinary destination root. At **30,024**, **120,021** and **300,033 ms**, all 16 selected manifest files were absent. At **540,022 ms**, 12 had the expected sizes and four were absent, with no size mismatches or refused paths. The uninstaller remained absent. No exit or pipe close was recorded before the **600,000 ms** deadline triggered termination. Exit and close reported code 1 at **600,211 ms**; zero output bytes were captured. No successful install command, installed-registry custody, full payload comparison, provider result, launch or memory observation follows. Cleanup remains **preserved-unconfirmed-installation** and there are no installed screenshots.

The [independent progress review](M05-installer-progress-review-43744480609.json) admits only forward destination-file progress between the five- and nine-minute samples. A 12-of-16 sample does not establish 75% total completion, continuous progress or a completion-time forecast. The pinned 7z template has separate extraction and full-tree copy work, but the receipt does not isolate their timings. This run also does not retrospectively explain the earlier ZIP timeout.

The narrow follow-up gives only the installer a hard **1,200,000 ms** limit and adds optional samples at **900,000** and **1,140,000 ms**. It retains the first four samples, at most 16 manifest files plus the fixed uninstaller, one in-flight sample, five seconds per sample and 1,200 metadata checks. Read-only preflight remains **60,000 ms** and uninstall remains **180,000 ms**. Both clean process exit and pipe close, complete installed path/size/SHA equality, registry/executable/profile ownership, two real launches, memory review/restart and owned cleanup still gate success. The existing 260-character path budget is conservatively retained and accurately described as a Windows budget after switching archive format. This is a measured workload allowance, not permission to accept an incomplete installation. Actual execution of the new budget remains pending.

Artifact `14174947305`, `installed-memory-43744480609-1`, was retrieved once at **356,644 bytes**, SHA256 `b8d2a59321b58ba20d0799b05d91458240e585eb87c362ddca783b7784e9b41b`. Its four members are the verifier and owner receipts, build manifest and canonical v2 inventory. The raw installed-job log is **126,900 bytes**, SHA256 `40dd0d32afb8319222190334e90c894c575f09f3babcb8888cebf118c0d87992`. The terminal receipt and command import preserve **27 observed records, 26 PASS and one FAIL**, with all **556 preceding rows and 290,419 bytes** unchanged. No prior failed outcome is relabelled, and no unexecuted installed-memory action is reported as passing.

The [budget repair review](M05-installer-budget-repair-review-20261115.json) binds the two changed source/test files, the measured Windows failure and the exact recorder inputs. The existing **19-case custody suite** and **full `pnpm typecheck`** both pass on the new local cut. Their source hashes and command times remain separate from the pending Windows installation outcome.
