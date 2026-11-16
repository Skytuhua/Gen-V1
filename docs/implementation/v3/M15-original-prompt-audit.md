# M15 original prompt audit: C4 reconciliation

C4 accepts main `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`, including owning M05 contracts, and preserves the incoming published branch and all previous evidence. The original uploaded M15 prompt was read in full during this continuation. Exact earlier audits remain in the publication archives. This document maps the requirements to implemented behavior and current evidence boundaries; it is not a claim of full independent product approval.

The final local source cut is [final-03](m15-artifacts/c4-validation-final-03/source-cut.json), SHA-256 `0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260`, containing 2,391 non-document paths. On that cut, the host selection passed **410 cases with two Windows-only skips**; the complete App, desktop and renderer suites passed **26, 31 and 21 cases**, respectively, with no failures, skips, flaky outcomes or report errors. Typecheck, production build and UI policy passed. The 31-case handoff result is included in the host selection and is not added to a unique total.

The earlier complete App attempt remains **22 passed/four failed**, and desktop remains **26 passed/five failed**, on their earlier source cut. The asynchronous empty-owner handoff defect was reproduced and corrected; the two earlier App startup/reload failures retain unknown causes despite the later pass. Current C4 Windows/native/Edge, paired root browser and full-repository execution are **NOT_RUN** at this publication checkpoint. Historical failed target runs and unavailable capability requirements keep overall acceptance incomplete.

The current execution ledger is [M15-c4-regression-review.md](M15-c4-regression-review.md). Historical successful bodies, Linux skips, static reviews and byte-integrity checks do not satisfy an unexecuted C4 target requirement. Failed and superseded attempts retain their source identities and nonzero results. Production activation and reviewerApproval remain false.

## Execution and custody requirements

| Requirement | C4 disposition | Evidence boundary |
| --- | --- | --- |
| Isolated branch and preserved original checkout | Existing draft branch in `m15-v3`; original `gen-v1` stays at 399cde3 | Final custody checks the original checkout and all previously published logs/artifacts. |
| Exact prerequisite contracts | Accepted b4aa source lock includes 17 owning contracts and 58 inspected paths | [Dependency review](M15-dependency-review.md), controller-derived exact Git blobs and ancestry. |
| No guessed integration under drift | M05 adapted through its existing reader, Service and review UI; newer main observed separately | No replacement memory store, fabricated diff witness, historical artifact reader or revived retired host. |
| Frozen dependencies | Existing pnpm10.30.3 declaration and lockfile, unchanged ordinary CI | Explicit public-source admission retains its existing admission contract and runtime membership. |
| Host sole writer and synchronous Store | Existing Store, request custody and input outbox remain authoritative | Async reads are fenced before synchronous final admission; no awaited Store callback. |
| Epoch/account/grant/cancellation | Full owner/source/account identity and lifetime checks remain | Focused host contracts and actual Windows bodies have separate receipts. |
| Failing evidence before correction | Initial M05/launcher/browser/handoff failures are retained | Exact source cuts and subsequent results are recorded without replacing failed attempts. |
| Approval/activation separation | Draft publication only; both flags false | Tests and integrity never grant release authority. |

The original prompt prohibited publication. The subsequent direct request to review, fix and open the PR authorized draft PR #390 and its continuation. That authorization does not include merge, deployment or activation.

## Requirement-to-implementation coverage

The behavior column describes carried-forward implementation contracts. A named test or historical pass is not an assertion that the current C4 cut executed that case.

| Prompt item | Implemented behavior | Qualification or current proof requirement |
| --- | --- | --- |
| Strict SelectedSourceV1 union | MESSAGE, FILE_RANGE, DIFF_HUNK and ARTIFACT_REGION reject extra authority fields, invalid ranges and mismatched owner/revision/digest | Schema coverage does not enable unsupported native source kinds. |
| UTF-16 messages and one-based file lines | Half-open UTF-16 plus selected-text digest, surrogate-split rejection; inclusive one-based file lines | Windows file reads/original-Hermes need actual target evidence; Linux skips do not count. |
| DraftContextV1 | Exact owner, revision, authored text, at most eight distinct refs, NOW/AFTER_CURRENT and conflict state | Existing text journal remains canonical locally; source companions grant no tool authority. |
| WorkbenchViewV1 | Owner/revision, view, selected item, logical scroll anchor, device identity and bounded local cache | Presentation state cannot restore task/runtime facts or replace thread ownership. |
| Reuse current owning surfaces | Shared composer, Find, Inbox, ContextInspector, UsageDialog, checkpoints and handoff remain owned by existing components | Accepted base `b4aa2ca` retires Research/Code Review/Custom/Visuals creation. M15 must preserve those removals and canonical split/SurfaceBoundary routing. |
| Ask, Attach and Open | Host-resolved assistant text and declared artifact/range descriptors; visible exact destination | Ask preserves authored text and never sends. File capture is platform-gated; diff capture requires its owner's atomic witness. |
| Valid visible pointing | Registered React root, exact canonical identity, clipping/hidden/input/link/foreign/iframe refusal | Cross-origin DOM is not read. Formatted text uses an explicit canonical selector until trusted offsets exist. |
| Keyboard, Escape and IME | Focus belongs to the correct pane/native modal; Shift+F10 and Escape work without consuming composition | Current App/direct-component results must remain separate. |
| Preview and retained source identity | Bounded preview and immutable retained bytes with source/range/revision/capture time | One MiB source, 64 KiB capture, 1,024-byte preview; full material is not copied into the browser journal. |
| Refresh or explicitly Keep | New capture on refresh; explicit old-version intent; exact original bytes on Open | Unauthorized or unavailable retained bytes block misleading source-aware sends. |
| Explicit destination and durable send | Existing message.send with frozen source identity and mode; receipt-first idempotency | No automatic project routing, implicit task creation, second send queue or hidden stop. |
| First-account and rollback custody | Provably unbound captures gain an atomic host witness; proven-uncommitted M04 transitions can be undone narrowly | Original capture data/grants stay unchanged; legacy, accepted, newer, changed-account/epoch and finalized custody cannot be reopened. |
| Module contribution points | Authorized M04 context/tools, M06 evidence and retained M08/M09/M11 owner read models | M05 uses the existing project-memory review with read-only workbench access and awaited owner fencing. M10/M14 still lack tested workbench adapters. |
| Evidence chain and grades | Requirements/checks/artifacts/sources, command/revision links, freshness and Reported/Observed/Verified | Incomplete/foreign evidence cannot become Verified. Historical log/screenshot opening awaits an authenticated reader. |
| Bounded long output | Stable row IDs and incremental rendering without deleting canonical messages | Maximum 300 mounted rows; complete host limits remain 4 MiB, 100,000 rows and 500 messages. |
| Full search and copy | Host-authorized complete output verified against exact owner/revision | Mounted DOM never implies completeness; stale, partial or denied reads reject. |
| Logical scroll anchors | Stable row/offset across prepend, stream, resize and restoration | Local presentation only; renderer fixture and actual App evidence are distinct. |
| Owner switch and handoff | Journal flush/CAS/generation fences, conflict copies and A-to-B-to-A protection | C4 records first-read/CAS/preprocessing obligations before await and permits only untouched failed-recovery close. Explicit retry, stale cleanup and same-owner schedules have separate boundary cases; mounted App close/import and native return have browser fixtures. Their exact results are in the C4 ledger. Scripted bridges do not prove installed-desktop behavior. |
| Loading, error and unsupported states | Explicit loading, empty, stale, partial, denied/offline and read-only states | A SurfaceBoundary retry is not proof of dynamic-import retry or durable-write acknowledgment. Unknown remains unknown. |
| Save/export/import recovery | Bounded source companions, version 2 source exports, version 1 ordinary text, explicit text-only restore | Multi-key atomic CAS protects newer source generations and conflict copies. |
| Accepted-input recovery | Inspect, explicit Keep and proven-undispatched Cancel with saved-input equality fences | Runtime ambiguity blocks cancellation; Keep requires Resume; lost receipts retain exact retry identity. |
| Large fixtures and performance | 10,000 metadata entries, 500 task records, 100,000 output rows in the controlled fixture | The current complete workbench result and renderer attachment belong to their recorded cut. The stub read model and click-to-MutationObserver metric establish no whole-App, task-tree/timeline, paint, native-history or general-device guarantee. Earlier timings remain historical. |
| Layout, zoom, motion and reachability | 1280x800 and 1920x1080 cases, CSS zoom 200%, keyboard, reduced motion, streaming, owner/reload/offline | Current C4 executions need their own receipts; CSS zoom is not native DPI certification. |
| Workflow comparison | Input, state transition, failure behavior, owner and test mapping | [M15-feature-comparison.md](M15-feature-comparison.md); suite names denote coverage, not current execution. |

## Source and permission limits

Logical ownership comes from the exact task/thread, project, working-copy workspace and account/epoch boundaries. Canvas IDs, split panes, presets, local retry metadata and active global presentation state cannot create or rebind authority. Legacy layouts remain parseable without reviving removed hosts. A generic diff/output panel does not imply an owning capture capability.

The first-account witness remains transaction-owned. M04 rollback requires absence of matching receipt/outbox commits and only undoes exact admission advances and a newly acquired claim. Acquired native guard or uncertain process-teardown failures remain visible. The new handoff observer stores operation/recovery metadata, not a second draft or task database.

M05 review is implemented read-only through the existing owner. The new two-turn native source/memory fixture uses a seeded null account and scripted model text; first non-null admission, queued expiry, checkpoint/compaction, extraction and live-provider behavior remain separately scoped. M10/M14, atomic complete-diff capture, trusted formatted-text offsets and authenticated historical artifacts remain unavailable. Installed desktop, Pi continuity and device/DPI performance retain separate acceptance limits.

## Historical and current execution

The C3 Windows cohort is now complete and admitted with exact raw receipts/logs/source metadata and seven independently retained ZIPs. Its native command passed 326 with one Linux-only skip; four full shards passed 3,604 with 46 skips. The 16-command browser aggregate remains 302 passed/29 failed. Accepted49 and C3 root runs remain 30/82/1 and 31/81/1, respectively. The 81 candidate failure identities also failed accepted 49, which establishes outcome overlap rather than a blanket common cause. C3's source and accepted base remain explicit in its cohort map.

External reconciliation Windows and Linux failures remain failures. The current C4 plan and ledger identify every new local and target result separately. Original C1/C2/C3 failures, unchanged-fixture successes and setup-only attempts remain in their immutable archives. No total is formed by adding overlapping focused suites.

Later main was observed at `199a2e240aac0374228e82599fe7aeba4afafaf2` and is not the accepted execution base. The earlier bounded reviews retain backend Research retirement at main109, desktop alert-to-status assertion changes at main5fa, and pointer/layout/browser fixture changes at main5f. The subsequent 44-path delta through main199, including M07 and additional ownership/UI changes, was inventoried without adoption or a compatibility claim. C4 retains alerts for actual recovery failures. Accepted b4aa still constructs its Research repository and dispatches its Research commands; its retired workspace presets and UI creation remain absent. Ordinary PR merge-tree CI stays separate.

The intended publication parent advanced from eeda to `98db97d1d0a1910f47879f0e3d54477bcc59feed`, tree `19d92af279985a059bbda7a9be4f5bb95b70f842`. That single incoming commit changed only the generated M15 source cut and validation timestamp. Their exact Git bytes are preserved in [the incoming metadata archive](m15-artifacts/external-publication-cut-98db97d/archive-manifest.json). It changed no product source, test, published log or artifact and created no new test execution. The final-03 test context remains eeda with local changes.

## Rollback

Default-off rollback retains current code, messages, captures, drafts, evidence, pending ambiguity and accepted-input custody, with retained inspection/removal, NOW reset and proven-undispatched cancellation. It does not promise binary downgrade. The first publication lacks the later account-admission witness and may fail closed; no legacy capture receives migrated authority to hide that limitation.
