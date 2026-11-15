# M15 original prompt audit

This continuation rebuilt the patch against execution base `399cde39ff4ee82272c7a7700944325c44b36070`. The previous session's final working tree, commit and evidence bytes could not be recovered. Its reported counts are not evidence for this patch. The uploaded original M15 prompt was read in full. The execution record, dependency review and final validation summary identify this continuation's actual sources and results.

## Execution and custody

| Requirement | Disposition and implementation | Evidence or remaining gate |
| --- | --- | --- |
| Separate worktree, branch, preserve original checkout | Isolated `m15-v3`, branch `agent/m15-v3`; original `gen-v1` remains at the accepted base | Original tracked status and final handoff checks; canonical origin is the transferred `skytuhua-org/Gen-V1` |
| M01/M02 exact current contracts | Accepted ancestry, immutable base blobs and current prerequisite tests inspected | `M15-dependency-review.md`; `core-prerequisites`, 71 passing tests |
| Source drift stops guessed integration | Current M04/M09/M11 APIs inspected; unsupported diff and artifact navigation remain gated | `M15-source-lock.json`; native and optional-contract gates below |
| Existing dependencies and frozen installation | Declared pnpm 10.30.3, frozen lockfile, no package additions | Setup receipts; exact locked node-pty rebuilt for the Linux test runner |
| Host sole writer, no awaited Store callbacks | Capture and input recovery use existing Store commands/events; async reads precede synchronous final checks | Host negative/race tests; no parallel task database or delivery queue |
| Preserve epochs, account pinning, grants, cancellation | Full owner/account stamp and retained-byte authorization on every read/send/recovery; final outbox equality fence | `source-workbench-host-v3.test.ts` |
| Failing fixtures before fixes | Strict contracts, host races, renderer and journal defects have recorded failing attempts followed by passing focused runs | Immutable `m15-logs`; nonzero attempts retain FAIL |
| No automatic activation | Host-owned finite flag defaults false; no strict preference key or agent/plugin toggle added | Default-off host and App cases; `reviewerApproval:false` |

The original prompt prohibited publication. The subsequent direct request to review, fix and open a PR authorizes a draft PR for this work. It does not authorize merging, deployment or activation.

## Contract and implementation coverage

| Prompt item | Implemented behavior | Qualification |
| --- | --- | --- |
| SelectedSourceV1 strict union | MESSAGE, FILE_RANGE, DIFF_HUNK and ARTIFACT_REGION reject extra authority fields, invalid ranges, mismatched owner/digest/revision | Union acceptance does not imply every native source kind is enabled |
| UTF-16 messages, one-based file lines | Message offsets are explicit half-open UTF-16 with selected-text digest; surrogate splits reject; file lines are inclusive | Windows actual file-read proof remains blocked |
| DraftContextV1 | Exact owner, revision, text, at most eight distinct source refs, NOW/AFTER_CURRENT, conflict state | Existing text journal remains canonical locally; source companion cannot authorize tools |
| WorkbenchViewV1 | Owner/revision, view, selected item, logical scroll anchor, local device, bounded cache | Presentation only; no task or runtime facts restored from it |
| Reuse existing surfaces | App and Canvas use the shared composer; existing Find, Inbox, ContextInspector, UsageDialog, CodeReviewHost and FileCheckpoints owners remain | New source views complement those owners; no independent task state |
| Explicit contextual actions | Ask, Attach and Open for host-resolved assistant text; Sources view resolves declared artifact bindings and supported range descriptors | Formatted inline selection is gated unless rendered text exactly equals canonical text; each message opens a canonical selector even outside the catalogue. File capture is target-platform gated; diff capture awaits an owning atomic revision witness |
| Valid visible pointing only | Direct registered React root, exact canonical text mapping, visible range checks, forged attributes/hidden/clipped/input/link/iframe refusal | Cross-origin DOM is never read; artifact data is resolved through its declared host binding |
| Keyboard, Escape and IME | Toolbar focus stays in its owning pane/modal; Shift+F10 reaches controls; Escape dismisses; composition events are ignored | Chat drag Escape ordering also repaired without changing geometry or subtree |
| Source preview and retained bytes | Minimal ref and bounded preview; host-retained immutable selected bytes; exact revision/digest identity | Full-read limits remain explicit; large sources are not copied into the draft journal |
| Changed source choices | Refresh creates a new capture; Keep is explicit; exact old capture opens after changes | Unavailable/unauthorized bytes prevent misleading sends |
| Explicit destination and durable send | Current task is visible; existing message.send carries frozen source identity and delivery mode | No automatic project routing or implicit new-task creation |
| Module contribution points | M04 recorded context/tools, M06 evidence, M08/M09/M11 owning read models and existing UI preserved | M05, M10, M14 unavailable; no invented mutation controls, progress, cost or verified results |
| Evidence chain and grades | Requirements/checks/artifacts/sources, command, revision, log/screenshot references, parent links, freshness, retained source opening | Historical log/screenshot navigation is explicitly unsupported because an authorized owning reader is absent |
| Rendering and canonical history | Bounded WorkbenchOutput for long activity, stable source row IDs, incremental window changes | Canonical messages are not deleted; existing task timeline is not replaced |
| Authorized full search/copy | Copy and search read all authorized rows through the host and verify exact revision/owner | Windowed DOM is never treated as complete; stale, partial and denied reads reject |
| Logical scroll anchor | Stable row plus offset through prepend/stream/resize, persisted local presentation state | Renderer fixture evidence and App integration evidence remain distinct |
| Owner switch and handoff | Flush/CAS/generation fences, conflict copies for uncertain acknowledgment, A-to-B-to-A protection | Existing editor handoff and desktop close guards are reused; native installed-desktop execution remains unobserved |
| Panel states | Loading, empty, retained stale, partial, denied/offline errors, explicit unsupported capability and read-only states | Unknown measurements remain unknown, never zero/pass |
| Fixed large fixtures | 10,000 message metadata entries, 500 task records and 100,000 retained output lines | Performance is a controlled renderer comparison, not a whole-App or universal-device claim |
| Reachability and motion | 1280x800 and 1920x1080, CSS zoom 200%, keyboard and reduced-motion cases, stream/owner/reload/offline | Actual Chromium evidence only; CSS zoom is not an installed-desktop DPI certification |
| Workflow comparison | Input, state transition, failure behavior, authority and test mapping | `M15-feature-comparison.md` |

## Additional recovery repairs found by review

Source-aware precommit rejection now distinguishes a proven unaccepted send from an uncertain delivery. Matching command receipts and in-flight admission coalescing prevent a retry from falsely claiming rejection while another admission can commit. A rejected draft remains editable; an ambiguous send retains the exact command and sources.

Accepted queued inputs are no longer stranded when their source becomes stale before runtime entry. The host exposes inspect, KEEP_CAPTURED and CANCEL only for the exact owned input. Keeping retains identity and requires ordinary explicit Resume. Cancellation is restricted to proven undispatched persisted inputs. Both paths recheck against concurrent preparation. A local recovery command record preserves its exact ID/action through lost acknowledgment, including cancellation whose input disappears from the queue before its receipt reaches the browser.

Named drafts and export/import retain bounded source context. Source-bearing exports use a new format version so an older reader cannot silently discard citations. Named-draft restoration is explicitly text-only and preserves the current source context. Modal failures use role=alert; focus restoration waits for the dialog to commit closed.

## Unmet acceptance and release gates

The full repository test and browser attempts failed. Their actual counts and subsequent targeted corrections are in the handoff and regression audit. A focused passing rerun does not rewrite those original attempts into a passing full run.

Transformed inline Markdown selection needs trusted source offsets. A unique substring alone does not prove its original position after escaping or formatting. The explicit per-message canonical selector remains usable and validates exact UTF-16 offsets.

Windows file capture, native runtime history continuity, real installed-desktop handoff and platform-specific path/grant behavior require their actual target. No skipped or mocked case substitutes for that evidence. A first file capture in a truly empty account-unbound task can fail closed when ordinary admission pins a non-null account; that Windows boundary needs explicit resolution and native proof.

Diff capture needs an atomic complete comparison witness from its owner. Historical evidence log/screenshot opening needs an authenticated retained-artifact reader. M05/M10/M14 need their tested owning contracts. Production task-tree/timeline scaling and whole-application latency are not established by the renderer benchmark. These remain separate gates, and the workbench flag remains off.
