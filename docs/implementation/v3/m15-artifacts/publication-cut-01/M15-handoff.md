# M15 source-aware workbench handoff

## Disposition

**Draft PR candidate. Overall verification: FAIL. Production activation: disabled.** The implemented source, recovery, draft and renderer paths have passing focused evidence. The complete repository regression and root browser attempts failed, native platform evidence is missing, and newer `main` has not been reconciled. Neither the implementation receipt nor independent code review grants merge or release approval. `ui.sourceWorkbenchV1` defaults to `false`; `reviewerApproval` is the schema-required literal `false`.

This continuation rebuilt the work because the previous session's final working tree, commit and evidence bytes were unavailable. The earlier transcript's 161-test, 2,916/244/45 full-run, 127-command and renderer numbers do not describe this patch and are not reused as evidence.

## Repository and exact source basis

| Item | Recorded value |
| --- | --- |
| Canonical repository | `skytuhua-org/Gen-V1`, repository ID `1442565952`; the original `Skytuhua/Gen-V1` address redirects here |
| Original checkout | `/workspace/scratch/1b47eb428672/gen-v1` |
| Isolated worktree | `/workspace/scratch/1b47eb428672/m15-v3` |
| Candidate branch | `agent/m15-v3` |
| Execution base | `399cde39ff4ee82272c7a7700944325c44b36070` |
| Audit ancestor | `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54` |
| Accepted M01 merge | `5f0958f4cb5b40bc10c1eea0e1cd517b57aaa1b9` |
| Accepted M02 merge | `f331cf16b268282da888a41da42fc776ea7befd5` |
| Accepted reconciliation | `e871257aa82beb06ab4b8f3989cbe436cb9a6a8c` |
| Runtime | Linux x64, Node `v24.22.1`, declared pnpm `10.30.3`, Playwright Chromium `1.56.1` |

`M15-source-lock.json` identifies immutable execution-base blobs for the reviewed dependency contracts and existing integration targets. `M15-source-cut.json` identifies SHA-256, Git blob and byte length for every changed implementation file. `M15-verification.json` contains the complete changed-file list. The final commit identifier is deliberately reported outside files in that commit.

`M15-dependency-review.md` records source compatibility and the 71 passing current M01/M02 prerequisite tests. The installed dependencies came from the frozen lockfile. No dependencies or lockfile versions were added. The exact locked `node-pty` package was rebuilt for this Linux Node runtime. The Windows credential setup script is a no-op on Linux and does not establish native credential coverage.

Remote `main` was observed 62 commits ahead at `673ca733d306ade463635def2d09299bc37043ec` during publication preflight. The earlier observation at `f5e0af4e1e81c0e9fdd71e2fc56575b33bca9fca` was 57 commits ahead and remains retained. Six paths overlap this candidate: `App.tsx`, the contracts index, the browser suite registry, the public source manifest, and the chat-mode and saved-drafts browser specs. The complete drift observation is retained in `m15-artifacts/publication-main-drift.json`. This evidence remains pinned to the accepted execution base. Compatibility with the newer branch is a separate merge gate.

The original checkout was verified clean at the execution base by `final-checkout-custody-01`. Only this task's duplicate receipt copies and its temporary dependency symlink were removed after byte and target checks. No user work was reset, cleaned, stashed or overwritten. The subsequent direct request to review, fix and open a PR authorizes draft publication despite the original implementation prompt's no-push clause. Merge, deployment and activation remain unauthorized.

## Implemented behavior and authority

### Exact sources and selection

`SelectedSourceV1` is a strict MESSAGE, FILE_RANGE, DIFF_HUNK or ARTIFACT_REGION union. The host validates complete logical ownership, account binding, revision, digest, grants and exact content before capture and again at read/send/recovery boundaries. Message ranges use half-open UTF-16 offsets plus selected-text digests; split surrogate pairs reject. File lines are one-based and inclusive. Artifact pointers address declared data bindings; arrays accept only canonical, safe, in-bounds integer indices.

The selection toolbar accepts registered React roots with exact canonical text. It rejects forged attributes, hidden or clipped text, clipped interior descendants, input/link content, foreign panes and arbitrary iframe content. Escape, keyboard activation and IME behavior retain their existing owners. Formatted Markdown cannot safely infer canonical offsets from a unique substring. Those messages expose an explicit **Select canonical source** action by exact message ID, including messages outside the bounded catalogue. Trusted formatted inline source maps remain unavailable.

Source chips show a bounded preview, name, revision, range and capture time, with explicit removal, refresh and retained-version choices. Open source returns the exact retained bytes. The current task destination stays visible. Source context never grants tool or file access. Limits include eight draft source references, 64 persisted presentation entries, a 1 MiB source, a 64 KiB selected capture and a 1,024-byte preview.

FILE_RANGE uses the existing guarded native reader and remains unsupported on this Linux target. DIFF_HUNK capture remains disabled until its owning service supplies an atomic complete-comparison witness. Declaring the union does not enable these capabilities.

### Durable sends, accepted inputs and drafts

Source-aware NOW and AFTER_CURRENT sends use the existing `message.send` outbox and M04 request custody. Command ID, prompt, owner, model, source identities, delivery mode and draft generation are frozen for an attempt. The host coalesces matching in-flight admission and checks durable receipts before current eligibility. An old acknowledgment cannot clear newer edits. A proven precommit denial unlocks the draft; an uncertain outcome retains the exact retry.

Accepted queued inputs can be inspected, kept with their exact retained captures, or cancelled only when the host proves they are persisted and undispatched. Keeping requires an explicit ordinary Resume. Processing or runtime ambiguity blocks cancellation. Recovery rechecks ownership and the saved outbox snapshot around asynchronous preparation. Cancellation remains available after the workbench flag is disabled and preserves the canonical user message.

The browser journals a recovery command's exact ID and action before transport. It clears only a matching receipt or a definitive rejection. A lost cancellation acknowledgment remains retryable even after its input disappears from the queue. Local retry custody is not task authority. Full owner/account/epoch generation fences reject delayed A-to-B-to-A responses.

Saved drafts and transfer retain bounded source metadata. Source-bearing exports use version 2; ordinary text exports remain compatible with version 1. Restore is explicitly text-only and preserves the active source context. Multi-key journal compare-and-swap preserves conflict copies instead of partially importing or overwriting newer source generations. Existing handoff guards await journal and presentation writes. An uncertain flush preserves recovery data and reports the limit. Agent and scoped composers that have not integrated sources reject hidden source companions rather than silently losing them.

### Workbench panels and output

Existing ContextInspector, UsageDialog, CodeReviewHost, Find, Inbox, checkpoints and chat movement remain owned by their existing components. The workbench presents authorized M04 context/tools, M06 evidence and current run/queue/request observations. Missing M05, M10 and M14 integrations are explicitly unsupported. Unknown cost, progress, outcomes and freshness remain unknown.

Evidence separates Reported, Observed and Verified. Only authorized current linked checks can verify a claim. The reader fetches one extra observation to detect incomplete bounded history; when older outcomes may be absent, requirements become `UNVERIFIED_PARTIAL` and checks cannot receive a verified grade. Historical log and screenshot references are metadata. Opening them remains unsupported until the owning authenticated retained-artifact reader exists. Captured-source links do open exact retained bytes.

Long output uses stable zero-based row IDs and a logical scroll anchor. The complete host reader verifies a framed digest of message identities and content, preserving trailing newlines and empty rows. Search and Copy full result use the authorized complete read, never the mounted DOM. Stale, denied, foreign or partial reads reject. Canonical messages are retained. The host limit is 4 MiB, 100,000 rows and 500 messages; the renderer mounts at most 300 output rows. Presentation writes serialize per device and do not become synchronized task facts.

## Verification results

Each result below names an actual immutable command receipt under `m15-logs`. Passing focused reruns do not replace earlier failed attempts. Some suites overlap; these rows must not be summed into a unique test count.

| Recorded execution | Actual result | Scope |
| --- | --- | --- |
| `core-prerequisites` | 71 passed, 6 files | Current accepted M01/M02 boundary |
| `final-focused-01` | 204 passed, 1 Windows skip, 17 files | Source/composer/draft/recovery/output/packaging suites before the last two review regressions |
| `review-final-core-green` | 48 passed, 1 Windows skip, 3 files | Final host, source contracts and selection DOM, including both added review regressions |
| `host-recovery-final-07` | 80 passed, 1 Windows skip, 4 files | Durable admission, races and accepted-input recovery |
| `host-route-composition-green-08` | 72 passed, 1 Windows skip, 4 files | Host fixture composition and authenticated owning routes |
| `app-browser-final-03` | 19 passed | Final actual App integration, source fallback, durable recovery and anchor restoration |
| `selection-review-green-01` | 2 passed | Interior clipping and transformed-Markdown browser negatives |
| `saved-drafts-browser-full-04` | 27 passed | Complete saved-drafts browser suite |
| `chat-view-modes-final-01` | 24 passed | Complete chat movement, tooltip Escape and IME suite |
| `usage-context-chromium-01` | 21 passed | Explicit Chromium equivalent of declared Edge suite |
| `scoped-conversation-chromium-01` | 15 passed | Explicit Chromium equivalent of declared Edge suite |
| `agents-workspace-chromium-01` | 13 passed, 2 failed | Startup deadline and existing follow-up fixture/receipt mismatch |
| `final-typecheck-03` | PASS, exit 0 | Final source including the corrected evidence controller |
| `output-browser-final-03` | 16 passed | Final renderer, layouts, selection negatives and recovery |
| `final-build-01` | PASS, exit 0 | Final production build |
| `packaging-import-closure-green` | 18 passed | Exact public import closure and input-recovery contracts |
| `final-packaging-01` | 11 passed | Final explicit public source package, including reviewed evidence |
| `evidence-controller-green-01` | PASS, exit 0 | Unchanged bundle accepted; all six corruptions rejected |

The final renderer/layout receipt is `output-browser-final-03`. The final packaging and controller records are identified in the assembled manifest.

### Full regression failures

The declared `pnpm test` attempt failed before discovery because the `tsx` executable's IPC socket is denied in this environment. The supported `node --import tsx` path allowed setup and direct full Vitest execution. `full-vitest-01` recorded **3,202 passed, 289 failed, 51 skipped and four unhandled errors** across 338 files: 51 failed, 284 passed, three skipped. Its JSON suite counters include nested describe containers and are not file counts. The full run overlapped source edits and does not validate the final source cut.

The audit groups failures by observed signatures, including native file-read denials, missing skill inventory, native Cursor/runtime dependencies, Hermes cleanup and other assertions. It does not classify them all as baseline. Two introduced failures were found and corrected: partial host route composition and missing entries in the public-source import closure. Their targeted passing corrections are recorded without changing the original full-run result. See `M15-browser-regression-review.md` and `m15-artifacts/full-vitest-01-audit-summary.json`.

The clean pinned-base root browser run recorded **79 passed, 33 failed, one skipped**. The candidate root run recorded **74 passed, 38 failed, one skipped**, over the same 113 case identities. Thirty-two failures were common, six were candidate-only and one baseline failure passed. A focused rerun passed five of the six candidate-only cases. The remaining artifact-acknowledgment case still failed in a quiet isolated rerun at its original five-second initial checkbox assertion; acknowledgment assertions were not reached. This remains an unresolved candidate startup regression. Neither focused recovery nor trace inspection converts the full candidate browser attempt to PASS.

Declared Edge attempts failed at launch because `/opt/microsoft/msedge/msedge` is absent. Chromium adapters change only channel and test-directory resolution; assertions, deadlines, viewports and environments are unchanged. The two agents-workspace Chromium failures remain failures. The follow-up parser and fixture are byte-identical to the accepted base, but no baseline execution is claimed for those two cases. Chromium coverage does not certify Edge or Windows.

### Review-driven corrections and failed-attempt custody

Independent review found and verified corrections for five source/evidence defects: incomplete history falsely grading evidence Verified, clipped interior selections, transformed Markdown mapping to the wrong canonical occurrence, command recording before output-pipe closure, and artifact array `/length` access. Failing regressions and passing corrections remain in the bundle. The reviewer found no additional unresolved P1 or P2 defect in the inspected host admission, recovery, ownership, draft or full-output paths. This is a code-review finding, not release approval.

The saved-drafts browser sequence exposed four missing alert roles and focus restoration before modal closure. The full final suite passed after those fixes. Chat drag cancellation was reproduced on the accepted base: an open tooltip consumed Escape first. A capture-phase handler corrects ordering while retaining the existing subtree, geometry and rAF path; explicit IME cases pass.

Earlier setup mistakes, incomplete fixtures, HMR-affected runs, narrow test locator errors, the first final typecheck failure and publication credential failure remain immutable records. A nonzero process exit is recorded as FAIL or BLOCKED, never relabeled as expected-negative success. Browser JSON, selected traces, failure contexts and final screenshots are retained where available. Bounded logs may omit early output; their digests identify the exact retained bytes.

## Renderer and layout evidence

The final renderer record uses 10,000 message metadata entries, 500 task records and 100,000 output lines. It compares the windowed component with a controlled unwindowed fixture in the same Vite development React browser harness. Timing measures trusted click to MutationObserver observation, after warmup. It does not measure paint, whole-App latency, production task-tree scaling, native history performance or universal-device performance.

| Final measurement | Controlled unwindowed reference | Windowed component |
| --- | ---: | ---: |
| Mounted output rows | 100,000 | 29 |
| Trusted measured samples | 30 | 30 |
| p95 interaction | 2,230.1 ms | 11.7 ms |

The reference machine exposed an Intel Xeon Platinum 8573C, nine logical CPUs and 10,451,423,232 bytes of memory, with Linux 6.18.57, Node 24.22.1 and headless Chromium 141.0.7390.37. Both conditions ran sequentially at 1280x800 without CPU/network throttling or trace capture. Each used three warmups. The candidate met the declared under-100-ms and at-most-300-row fixture thresholds.

The final report, machine/browser identity, raw samples, both layout screenshots and before/after source digests are retained in `m15-artifacts/browser-final-03/`. All 11 source digests match before-run, report and final source bytes. The report SHA-256 is `080d127388172779f16b47bf5a1810c6752af9cf9bd84153d9cb51dd49eaf4c1`. Both required viewports, CSS zoom 200%, keyboard reachability, reduced motion, streaming, owner changes, reload and offline behavior are browser scenarios. CSS zoom is not a substitute for native desktop DPI testing. The App screenshots independently show retained source access and evidence grades in the actual integration.

## Data migration and rollback

No database schema migration, dependency change or destructive history conversion is introduced. The host remains the sole SQLite writer; Store callbacks stay synchronous. Captures and view records use existing persisted host projections. Local drafts gain bounded source companions; source-bearing transfer uses an explicit new version. Existing plain text drafts remain readable.

Disable `ui.sourceWorkbenchV1` to remove new capture and send contribution points. Existing dialogs/layout, canonical messages, queued-input custody, saved drafts and evidence remain. Retained source inspection and removal, mode reset to NOW and cancellation of proven undispatched inputs stay available. Rollback must not erase retained captures or pending ambiguous recovery receipts. It must not turn local view state into canonical task state. The host and App rollback tests cover these paths.

## Remaining gates

The failed full-repository and root-browser runs remain required regression gates. Reconciliation and tests against current `main` remain required before merging. Native Windows file capture, real native runtime/history continuity, installed-desktop handoff, platform path/grant cases and the declared Edge suites require their actual targets. The Windows host skip is not a pass.

A truly empty account-unbound task can reject its first captured file send when ordinary admission pins a non-null account. This is a fail-closed native boundary requiring explicit resolution and Windows proof without weakening account custody. Linux file leaf reads remain unsupported.

DIFF_HUNK capture requires the complete atomic comparison contract. Historical evidence navigation requires the authenticated retained-artifact reader. Trusted transformed-text offsets and M05/M10/M14 owning integrations remain absent. The renderer benchmark does not close whole-App/task-timeline performance gates. Independent release approval, merge and activation are not granted.

## Evidence reproduction and integrity

`scripts/m15-record.mjs` captures actual argv, executable and working-directory identities, timestamps, termination, exit code, status and bounded-log digest. New records finalize on child `close` so pipes have drained. The controller preserves older receipts as written.

Final evidence review also found two controller coverage gaps: omitted failed/blocked phases could escape plan reconciliation, and malformed receipt JSON could disappear from command coverage. `evidence-controller-red-02` reproduced six altered bundles being incorrectly accepted. After correction, `evidence-controller-green-01` accepted the unchanged bundle and rejected all six mutations: omitted phases/gates, an altered command index, a malformed receipt, a changed legacy renderer exception, altered source-cut metadata and substituted dependency contracts. Tests use disposable copies and restore original evidence bytes. The initial cross-filesystem setup failure is retained separately. The controller now derives phases, cases, membership, gates, command index and dependency metadata from the reviewed plan, parses every command receipt, and pins the sole legacy renderer exception to its exact immutable hash.

`scripts/m15-evidence.mts --assemble` constructs the source lock, source cut, complete artifact hash manifest, command index and strict `ImplementationEvidenceV3` document from actual receipts and the reviewed phase plan. Running it without `--assemble` checks the existing bundle. It validates schema and semantics, accepted ancestry, base blobs, source-lock digest, all embedded receipts and log headers/digests, artifact existence and bytes, exact source and changed-file sets, package-manager declaration and the actual default-off host flag. `M15-validation-summary.json` records the observed controller result. Integrity PASS does not change the bundle's FAIL result.

From the isolated repository root, with the declared pnpm on PATH:

```sh
node --import tsx scripts/m15-evidence.mts
git -c core.whitespace=cr-at-eol diff --check 399cde39ff4ee82272c7a7700944325c44b36070 -- . \
  ':(exclude)docs/implementation/v3/m15-logs/**' \
  ':(exclude)docs/implementation/v3/m15-artifacts/**'
```

The repository preserves existing CRLF bytes through `* -text`; the whitespace command respects that policy and checks authored files. An unrestricted staged whitespace check returned exit 2 because raw command logs retain runner-emitted trailing spaces and blank lines. Those exact evidence bytes are intentionally preserved. The scoped authored-file check passed, exit 0. Generated manifests avoid a self-hash cycle. The final commit SHA belongs in the external PR/handoff response, not a file inside the same commit.
