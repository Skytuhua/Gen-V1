# M05 Windows CI repair record

## Status and immutable source identity

This record explains the failures observed in the first Windows CI run of the integrated M05 tree and the resulting repairs. **The observed workflow failed. The repaired browser tests and responsive layout still require a new Windows run.** Test discovery, source inspection, local tests, and a filename containing `green` do not establish a passing Windows workflow.

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

The earlier published M05 attempt is retained separately: [Windows run 43707232893](https://github.com/skytuhua-org/Gen-V1/actions/runs/43707232893), [head 14e6a1743a5eb6a09bd96021ef724ed0967d442b](https://github.com/skytuhua-org/Gen-V1/commit/14e6a1743a5eb6a09bd96021ef724ed0967d442b), [tree 71b3d4d22bf7aab7890cc0e7f75154a32ce354d6](https://github.com/skytuhua-org/Gen-V1/tree/71b3d4d22bf7aab7890cc0e7f75154a32ce354d6). Its SQLite freed-page failure and subsequent storage migration are documented in [its evidence record](M05-windows-ci-43707232893.json) and [the handoff](M05-handoff.md). It is not replaced by the current run.

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
| Every `plan-timeline.spec.ts` case | 17 | The shared setup invoked `getComputedStyle(null)` before React mounted. Replace that immediate script with Playwright's locator-based `toHaveCSS('height', '3px', {timeout: 30000})`, which waits for the renderer and the same computed height. Reachable-step review also updates the invalid-plan notice to its accepted polite `status` role inside the exact task-plan region. | Exact 3px bar height and timeout; owner removal; same-thread revisions; stale epoch rejection; retained graph; collapse persistence; transcript content; focus and reading anchor; branch/join structure; all narrow/zoom/theme geometry. |
| Skills history retirement, restore retirement, retryable transport, stale edit, and blocked cleanup notices | 5 | Tests requested `role=alert`; accepted production has used `role=status` since `c2734be`. Select the status inside the exact `Skill library` region and retain the same error text. | Source retirement affects only its row; current instructions and newer journal generations remain; revision/content and command counts remain; ordinary transport failures remain retryable; explicit stop retry still emits `learning.cancel`. |
| Empty skills library with an old snapshot | 1 | The expected heading was `Skills & learning`; the accepted Settings section heading is `Skills & Integrations`. Use that exact heading. | Empty state, no eager reads, all learning preference updates, and selected-model/subscription description. |
| Skills desktop/narrow theme and editor geometry | 1 | The helper queried `Open navigation` before React mounted, received false, then attempted the offscreen narrow Settings button. Await the Settings control's attachment before checking and opening navigation. A subsequent source review exposed the disconnected narrow Skills stylesheet, repaired separately below. | Real click actionability, both viewport widths and themes, selected navigation bounds, no page overflow, editor values and bounds, and the minimum 250px narrow editor width. |
| Plan summary and docked handoff at 390px | 1 | The test read `data-collapsed=true`, but the accepted plan-appearance effect expanded the summary before the next click. The old `Expand Project overview` button no longer existed. Await the required automatic expansion instead. | Plan summary visible; handoff opens; summary hides while docked; no horizontal overflow; closing the handoff restores an enabled composer. |
| Ordinary signing draft edit | 1 | `document.getAnimations()` does not include the PDF's RAF spring. The test reset its pan counter before initial navigation settled. Await the active field and 250ms of unchanged pan count, bounded to 5 seconds, before reset. After the edit, await persisted state, updated preview readiness, the existing frame flush, and another bounded stability window without resetting the counter. | The changed value is saved; the updated PDF is ready; **exactly zero** additional pan calls are permitted. Any edit-triggered pan remains counted and fails. Other signing geometry/navigation cases are unchanged. |
| Host-loop decision validation | 1 | The exact schema-error notice is a polite status in accepted `InputDecision`; scope the status assertion to the same decision region. | Invalid response rejected, input retained, request pending, exactly one original delivery, accepted response continues the same runtime once, stale response rejected, reload preserves receipt. |
| Host-loop generated operation approval | 1 | `Add resource` moved to Settings, `Projects & Working Copies`. Navigate through those actual controls before calling the existing grant helper. | Explicit native approval, original bytes before approval, stale revision rejection, one effect, exact output bytes, restart restores the receipt without repeating the effect. |
| Host-loop infinite-loop isolation and generated startup failure | 2 | The shared Settings modal now labels its close button `Close dialog`. Scope that exact button to the Settings dialog. Reachable-step review also follows New thread with the existing `Select project` / `No project` choice. | Settings/Stop/navigation timing limits, actual stop, second-thread creation, owned widget failure notices, durable artifact state, and runtime isolation. |
| **Total** | **30** | No failing test was removed or skipped. | No approval, ownership, revision, visibility, geometry, effect-count, or zero-pan assertion was weakened. |

The source files changed for these browser repairs are [plan timeline](../../../tests/e2e/plan-timeline.spec.ts), [skills](../../../tests/e2e/skills.spec.ts), [document window](../../../tests/e2e/document-window.spec.ts), [signing motion](../../../tests/e2e/signing-motion.spec.ts), and [host loop](../../../tests/e2e/host-loop.spec.ts).

### Production repair found after the mobile setup blocker

The 390px Skills test had not reached its editor-width assertion. Source review found that [skill-library.css](../../../apps/web/src/skill-library.css) still required a `.settings-skills` ancestor, but neither the Settings modal nor [Settings.tsx](../../../apps/web/src/Settings.tsx) emitted it. The generic 136px narrow navigation column therefore left less than the existing 250px editor requirement.

The repair adds `settings-layout settings-skills` when `matches('harness-skills')` is true, changes the responsive root selector to `.settings-layout.settings-skills`, and explicitly sets the narrow navigation to `flex-direction: row`. This reconnects the existing responsive layout. The browser test still requires the same editor width, selected navigation bounds, no overflow, and both themes. This is an application repair discovered by reachable-step inspection, not an already observed passing browser result.

## Two other Windows failure groups

| Windows job and count | Cause and repair | Preserved contract |
| --- | --- | --- |
| [Application shard 4, job 132811715440](https://github.com/skytuhua-org/Gen-V1/actions/runs/43714076939/job/132811715440), 9 failures | M05's runtime router forwarded `selected.accountId` and an undefined checkpoint argument to adapters even when no memory checkpoint existed. The established adapter call shape is three arguments for ordinary compaction. [runtime/index.ts](../../../packages/runtime/index.ts) now forwards the extended account/checkpoint arguments only when a checkpoint requirement is present. Two focused default-account regressions were added before that fix. | Account routing still selects the pinned adapter/profile and validates the owner. The nine provider parity assertions are unchanged: `openai`, `openai-codex`, `github-copilot`, `xai`, `claude-code`, `gemini-cli`, `cursor-sdk`, `kimi-coding`, and `opencode-go`. Checkpoint-enabled calls still carry their full requirement. |
| [Hermes contracts, job 132811715487](https://github.com/skytuhua-org/Gen-V1/actions/runs/43714076939/job/132811715487), 1 failure | The worker fixture decoded a UTF-8 history file using the Windows default encoding. The equality assertion therefore compared different decoded text. [memory_native_checkpoint_worker_v3.py](../../../tests/memory_native_checkpoint_worker_v3.py) now calls `read_text(encoding='utf-8')`. | Exact persisted messages still equal the native result; persistence-before-compaction ordering, cancellation, failure isolation, and exact history retention remain asserted. No production native-worker behavior changed for this repair. |

The compact compatibility red attempt is retained in [continuation-compact-compatibility-red.log](m05-logs/continuation-compact-compatibility-red.log), SHA256 `a27908c07ede14dccdb5625575aecec8dec4f22a2f4afae5213c335a09bf1cbe`. The later file named [continuation-compact-compatibility-green.log](m05-logs/continuation-compact-compatibility-green.log) actually records **3 failed and 43 passed** because Linux protected-directory access failed in runtime-router cases; its SHA256 is `872d58da3b2492eb37aa632be7bf6c2cd4411244398264fda30d36789b5dbcc4`. It must not be cited as a fully passing suite. Local follow-up records remain in the command ledger; Windows verification of the repair tree is pending.

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
| `document-window-Plan-summa-6c848-reachable-together-at-390px` | The collapsed attribute read returned true at 69,547.843ms. At 69,578.545ms the snapshot already showed `data-collapsed=false` and `Collapse Project overview`. The stale Expand click started at 69,579.586ms. |
| `skills-skill-controls-and--23490-narrow-light-and-dark-views` | The narrow navigation completed at 383,247.865ms; the immediate visibility check returned false at 383,267.896ms. The subsequent Settings click repeatedly reported its button outside the viewport. The later screenshot shows the mounted, closed mobile navigation. |
| `signing-motion-ordinary-dr-cad72-ot-restart-field-navigation` | At preview readiness, 277,469.708ms, PDF scroll was `(48,29)`. After the Web Animations wait, 277,563.491ms, it was `(71,42)`. The counter reset began at 277,564.662ms; fill input at 277,585.247ms showed `(71,43)`; the final scroll was `(73,43)`. Initial movement therefore preceded and overlapped the edit measurement. |
| `host-loop-durable-decision-ac3f4-he-same-owning-runtime-once` | The snapshot contains the exact expected schema error in a `P` element with `role=status` and `class=error-text`. |

The complete 30-case title/category mapping is retained in the scratch `root-triage.json` note. Local Playwright discovery enumerated the edited UI specs without executing a browser. The host-loop local attempt [continuation-host-loop-selectors-attempt-1.log](m05-logs/continuation-host-loop-selectors-attempt-1.log), SHA256 `5b5f0444b107cf7257d9c5dc70e5e5294f94a28aab6b978c67c8d5104f61fbec`, failed before discovery because the Linux `pty.node` binary was unavailable. This is preserved as a failed attempt. No local unsupported Chromium launch or mocked platform result is substituted for the required Windows rerun.

Versioned command-log digests refer to their bounded, redacted stored bytes. [M05-log-policy.json](M05-log-policy.json) retains each first-observed input digest and any later display-normalization transform; no stored excerpt digest is substituted for a raw-job digest.
