# M15 source-aware workbench: C4 handoff

## Current disposition

C4 continues draft PR #390 against accepted main `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`, including the owning M05 implementation. The workbench remains disabled by default. Current local results, unsuccessful attempts and actual target results are separated in [M15-c4-regression-review.md](M15-c4-regression-review.md) and the evidence plan. The final publication response identifies the commit; this file does not contain a self-referential commit claim.

The final local source cut is [final-03](m15-artifacts/c4-validation-final-03/source-cut.json), SHA-256 `0c4ceab16a33448876d38b5a3d4e1877c0adf7d267cb587dfa60853db21ff260`, containing 2,391 non-document paths. On that cut, the host selection passed **410 cases with two Windows-only skips**; the complete App, desktop and renderer suites passed **26, 31 and 21 cases**, respectively, with no failures, skips, flaky outcomes or report errors. Typecheck, production build and UI policy passed. The 31-case handoff result is included in the host selection and is not added to a unique total.

The earlier complete App attempt remains **22 passed/four failed**, and desktop remains **26 passed/five failed**, on their earlier source cut. The asynchronous empty-owner handoff defect was reproduced and corrected; the two earlier App startup/reload failures retain unknown causes despite the later pass. Current C4 Windows/native/Edge, paired root browser and full-repository execution are **NOT_RUN** at this publication checkpoint. Historical failed target runs and unavailable capability requirements keep overall acceptance incomplete.

The last completed C3 Windows cohort remains FAIL. Its four full repository shards passed 3,604 cases with 46 skips, while the 16 browser commands had 302 passed and 29 failed. The paired root selection failed on both accepted 49 and C3: 30/82/1 and 31/81/1 passed/failed/skipped, respectively. All 81 candidate failure identities also failed the accepted base, but matching identities do not prove a common cause. Those executions belong to C3 head `3f68a8f1bc1ca5a588862571d905163861e94492` and accepted base49. They are not current C4 results. The seven original ZIPs have independently verified retained copies; their hashes, source identity and all 602 members are indexed in [the C3 cohort](m15-artifacts/c3-windows-run-43797606300-attempt-1/cohort-file-map.json).

No merge, release, deployment or activation is granted. `ui.sourceWorkbenchV1` and `reviewerApproval` remain false. Integrity validation describes the consistency of the source/evidence package, separately from test acceptance.

## Source identity and reconciliation

| Identity | Reviewed value |
| --- | --- |
| Repository and branch | `skytuhua-org/Gen-V1`, `agent/m15-v3`, existing draft PR #390 |
| Accepted C4 main | `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73` |
| Accepted main tree | `cdc9e7ad31a45e9c8ec69fbf1592f0605b033c6f` |
| M05 implementation ancestor | `34d8dd1e0e68af44265cea69b082ce4088366017` |
| Intended publication parent | `98db97d1d0a1910f47879f0e3d54477bcc59feed`, tree `19d92af279985a059bbda7a9be4f5bb95b70f842` |
| Local execution source | Each immutable source-cut file binds the actual parent, accepted base and complete non-document file bytes. |
| Original checkout | `/workspace/scratch/1b47eb428672/gen-v1`, retained clean at `399cde39ff4ee82272c7a7700944325c44b36070` |
| Current platform | Linux x64, Node24, pnpm10.30.3; exact executable and command identities belong to their receipts. |

The C3 publication and subsequent external evidence revisions are preserved byte-for-byte in `publication-cut-03` and the `external-publication-cut-*` archives. The external Windows full attempts remain FAIL, including the distinct 4,038/59/48 attempt and the later 4,030/68/48 attempt. The latter was published at two commits but executed once. The external Linux attempt remains FAIL, 3,644/306/196 with four unhandled errors. Its narrative parity label is not adopted as acceptance evidence.

Later main was observed at `199a2e240aac0374228e82599fe7aeba4afafaf2` and is not the accepted execution base. The earlier bounded reviews retain backend Research retirement at main109, desktop alert-to-status assertion changes at main5fa, and pointer/layout/browser fixture changes at main5f. The subsequent 44-path delta through main199, including M07 and additional ownership/UI changes, was inventoried without adoption or a compatibility claim. C4 retains alerts for actual recovery failures. Accepted b4aa still constructs its Research repository and dispatches its Research commands; its retired workspace presets and UI creation remain absent. Ordinary PR merge-tree CI stays separate.

The intended publication parent advanced from eeda to `98db97d1d0a1910f47879f0e3d54477bcc59feed`, tree `19d92af279985a059bbda7a9be4f5bb95b70f842`. That single incoming commit changed only the generated M15 source cut and validation timestamp. Their exact Git bytes are preserved in [the incoming metadata archive](m15-artifacts/external-publication-cut-98db97d/archive-manifest.json). It changed no product source, test, published log or artifact and created no new test execution. The final-03 test context remains eeda with local changes.

The accepted base retires creation of Research, Code Review, Custom and Visuals surfaces while retaining historical layout parsing. M15 preserves those removals, canonical split placement, SurfaceBoundary containment and owner transitions. Layout and view identity cannot grant thread, account, project or source authority. A generic Diff view does not supply the missing atomic complete-comparison witness.

## Changes in C4

### M05 and effective request context

The source workbench now queries the Service's existing effective request-context predicate. This fixes the case where M05 enables request custody while the independent M04 flag remains off. An optional host-owned reader exposes the existing ProjectMemory review projection for the exact accessible project/thread. It returns module state, reason, scoped link and an owning access fence, without another memory store or copied memory model. Access is checked around the awaited read. Unexpected storage or permission errors propagate rather than becoming EMPTY.

The UI opens the existing ProjectMemoryReview only after an explicit action and lazy import. Workbench access is read-only: configure, accept, edit, reject, expire, forget and conflict resolution are disabled and guarded. Pinned-source reads, conflict history, refresh and explicit export retain their owning authorization. The ordinary project-memory entry keeps its existing behavior. Thread, project, working-copy and account checks, together with import/request lifetime fences, prevent a late result from reopening another owner's review.

Prepared M05 memory and M15 source references reach one ordinary `message.send` through the existing request and input custody. The regression checks exact MEMORY/REFERENCE content and the prepared request identity. The new Windows combined fixture observes native guarded file capture and actual Hermes/Python/ACP/history across two turns, with scripted model text. Its executed target result is reported separately; static review and Linux collection do not prove its native body. It uses an explicitly seeded null-account recipient and does not substitute for first non-null admission, queued expiry, forced compaction, automatic extraction or a live provider.

### Visible Usage ownership

The shared Usage summary follows an eligible visible local conversation. WorkspaceSplitLayout reports its existing active-view calculation; App selects the explicit local owner and forwards it to Usage. Hidden, collapsed, folded-away, removed, archived, project-mismatched, detached and pending-native views cannot supply stale Usage. Canonical main resolution, placement writes and provider keys remain intact.

The legacy global Usage view is restored only after the actual ordinary-chat layout is ready. Fixture corrections observe canonical placement and finite popup animation completion before asserting existing behavior. A plugin surface is selected by its stable owning region rather than a mutable tooltip-derived title. A mobile fixture waits for its first successful snapshot, retaining the original control deadlines. These are functional checks, not whole-application startup measurements.

### Recovery-aware close and draft import

The original browser failure showed that an untouched composer whose initial journal recovery failed could never close. The correction permits close only after the exact source, text and pending-send keys all completed failed recovery reads, with no successful read, acquired record or local attempt, and after ordinary journal flush succeeds. An unobserved key, successful empty recovery, first CAS, source action, staged record or broadcast record prevents that allowance. Missing cache generation is not treated as proof of no work.

The journal records pending reads/writes/CAS and recovery preprocessing before their first await. This is metadata only; the existing journal remains the sole local text/source store. Source handoff drains relevant work, flushes ordinary writes and rechecks revisions. Failed source CAS obligations remain sticky. False CAS, automatic accepted-source cleanup and older successes cannot retire newer failures. Only a successful explicit source edit or atomic source import may acknowledge earlier failed operations for its written keys.

DraftTransfer registers its recovery barrier before file parsing. Because editor guards execute concurrently, a separate settle guard alone could let the source guard approve before a later import failure. The source guard now observes the preprocessing barrier and rechecks the resulting source obligation during the same close attempt. Text and source references still commit atomically. No registry recursion, native deadline extension, new persisted schema or authority bypass is introduced.

The Phase A fixture remains FAIL, 11 passed and 12 failed across 23 cases. Phase B passed all 25, including two concurrent schedules with retained source metadata. The initial complete browser attempt then exposed healthy empty-owner handoffs that never finished. Empty source reads are not cached; concurrent guards repeatedly observed each other as pending work. A separate actual-module diagnostic and two added macrotask-delivered empty-journal cases reproduced the defect. The original passing schedules did not cover that absence case.

Handoff validations now run in order for each thread because logical owners on that thread share the composer and pending-send keys. Every invocation still parses its own complete owner and executes the unchanged drain, flush, failure, fresh-read and revision checks. It does not reuse another invocation's readiness. An earlier rejection remains with its caller and does not poison the next validation; exact-promise cleanup cannot delete a later queued call. The expanded unchanged red/green selection moved from 27 passed/four failed to all 31 passed, including later source failure, first hydration, retained uncertain input and cross-owner ordering boundaries. Complete App/desktop revalidation remains separately reported.

The App-level import fixture holds actual File.text, injects a source transaction failure, requires rejected close and retained UI, then retries the exact bundle. That case and the original cold failed-recovery close case passed in the initial complete desktop attempt, whose other five failures remain recorded. Two initial App startup/reload failures have unclassified causes and are not retrospectively attributed to the FIFO repair. Browser native bridges remain scripted.

### Incoming source presentation and asynchronous selection cleanup

The incoming eeda revision's shorter revision display, local capture time with full title, pressed-tab styling, scrollbar treatment and output spacing are preserved. Its successful-action cleanup could erase a selection made while capture was awaiting the host. A normal browser red run demonstrated both a newer foreign selection and a newer same-source range being erased. The correction snapshots the original range's nodes and offsets, then clears only that exact still-current range and its matching candidate. A newer range stays available. The three regression cases pass within the complete 21-case renderer suite; no send or permission behavior is added.

## Carried-forward source and send contracts

SelectedSourceV1 remains a strict MESSAGE, FILE_RANGE, DIFF_HUNK or ARTIFACT_REGION union. Capture/read/send/recovery check full logical ownership, account, epoch, revision, content digest and grants. Message ranges are half-open UTF-16 with surrogate-split rejection. File lines are one-based and inclusive. Artifact array pointers accept canonical safe in-bounds indices rather than JavaScript properties.

Pointing requires a registered React root, exact canonical text and a visible range. Hidden/clipped descendants, inputs, links, foreign panes, forged attributes and arbitrary iframe content cannot create source authority. Formatted Markdown uses explicit canonical message selection until trusted source offsets exist. Ask preserves authored text and never sends implicitly. Refresh creates a new capture; explicit Keep retains the earlier bytes. Open returns retained bytes rather than silently substituting current content.

The existing bounds remain eight draft references, 64 presentation entries, 1 MiB source, 64 KiB selected capture and 1,024-byte preview. Source context grants no tool or file access. Linux guarded file-leaf reads remain unsupported. The Windows file-reader result must come from an executed native body.

NOW and AFTER_CURRENT use the ordinary durable input outbox and M04 custody. Pending attempts freeze command ID, owner, prompt, model, source identities, generation and delivery mode. Matching admissions coalesce; durable receipts take precedence over a later rejection. Proven precommit rejection unlocks edits; uncertain outcomes preserve exact retry. Older acknowledgments cannot clear newer text or source generations.

A provably unbound task can acquire a host-owned account witness atomically with first accepted input, without rewriting captured refs or bytes. Legacy, foreign, changed-account or changed-epoch captures cannot silently rebind. M04 rollback first proves that no matching receipt/outbox commit exists, then restores only exact admission advances and a newly acquired claim. Accepted, finalized or newer custody cannot reopen.

Accepted-input recovery allows inspect, explicit Keep and cancellation only when the host proves an input is persisted and undispatched. Runtime ambiguity blocks cancellation. Keep requires ordinary explicit Resume. Lost receipts preserve the exact recovery ID/action, including an orphan cancellation retry. Local retry records are not host authority.

Source-bearing backups remain version2, ordinary text version1. Named restore remains explicit text-only and preserves active source context. Multi-key CAS, generation checks, conflict copies and owner lifetime fences protect newer work. Unsupported composers reject hidden source companions rather than silently dropping them.

## Evidence and output

The existing ContextInspector, UsageDialog, Find, Inbox, checkpoint, composer and handoff owners remain in use. M05 now has the read-only integration above. M10 background work and M14 branches remain unavailable without tested owning adapters. Unknown cost, progress and freshness stay unknown.

Evidence distinguishes Reported, Observed and Verified. Only current authorized linked observations can verify. One-extra-observation completeness detection prevents partial history from becoming Verified. Historical logs/screenshots remain metadata until an authenticated retained-artifact reader exists.

Long output retains canonical messages, stable row IDs and an authorized complete-read digest. Full copy and search use complete host material, never mounted DOM. Stale, partial, foreign and denied reads reject. Host limits remain 4 MiB, 100,000 rows and 500 messages; at most 300 output rows mount. Anchors and view cache are local presentation state.

The current [controlled renderer report](m15-artifacts/c4-workbench-final-02/artifacts/workbench-M15-controlled-r-a899a-with-100-000-retained-lines/m15-renderer-performance.json), SHA-256 `48989b4d853933b8b97287db25f7036cb77dff86535c7f3ae31c9beee2b336b2`, measured windowed p95 **5.6 ms with 34 mounted rows**, against **2,038.1 ms with 100,000 mounted rows** in the controlled unwindowed fixture. Each condition used 30 trusted click samples after three warmups, sequentially and without throttling. Both use the same immutable retained data in a Vite/React development fixture on Linux Chromium. The metric ends at MutationObserver delivery and excludes paint. The reader is an explicit fixture stub. This establishes neither whole-application responsiveness nor native, live-provider, device or DPI performance; the earlier 5f and historical renderer measurements remain separate.

## Verification and publication boundaries

The C4 push workflow records exact pushed head/tree, accepted b4aa baseline, run ID and attempt. It retains seven jobs: 37 focused native files, 18 browser commands, a paired complete root browser comparison and four unfiltered full repository shards. The focused native selection cannot replace full shards. Both guarded split-browser bodies are explicitly enabled and record msedge. Declared Edge suites and bundled Chromium suites remain distinct; a successful Edge preflight alone is not browser acceptance.

The v4 ingester requires exact native argv and complete file membership, expected browser receipts, source records, log digests and archive identity. Successful ingestion proves custody of bytes. Original failures and missing executions remain visible. Ordinary PR CI, lockfile, existing job deadlines and public admission contract are preserved.

Local source cuts include every tracked and nonignored untracked non-document path. Documentation/allowlist publication updates have their own final custody record; earlier tests are not silently relabeled as executions at a later commit. The controller assembles the complete changed-file list, artifact hashes, source lock and every command receipt, including failed and superseded attempts.

## Remaining capability and platform requirements

Atomic complete-diff capture, authenticated retained log/screenshot navigation, trusted formatted-Markdown offsets and M10/M14 adapters remain unavailable. Installed-desktop handoff, Pi/native continuity, live-provider behavior and device/DPI performance remain separate unestablished requirements. A scripted desktop bridge, native worker with scripted model text or local CSS zoom fixture does not establish those claims.

## Migration and rollback

There is no replacement task database or history. The host remains the sole SQLite writer; Store callbacks remain synchronous. Existing text records stay readable. Captures and view state use existing projections, and draft formats remain bounded and explicit.

Disable ui.sourceWorkbenchV1 while retaining current code to remove new capture/send contributions. Messages, captures, drafts, evidence, ambiguous retries and accepted-input custody remain. Retained inspection/removal, ordinary NOW reset and cancellation of proven undispatched inputs remain available. Presentation state cannot restore canonical task facts.

Feature-off rollback does not guarantee binary downgrade. The first publication lacks the later account-admission witness and may fail closed. Legacy references are never promoted into authority to hide that incompatibility.

## Publication preparation after the final-03 validation

The [public package command](m15-logs/c4-public-package-final-01.json) passed all 11 contract cases. The [final custody command](m15-logs/c4-final-custody-01.json) passed with the original checkout clean, all 2,390 tested nonmanifest source files unchanged, all 898 previously published evidence files unchanged, the exact six full publication archives and the incoming two-file metadata delta preserved, and the 228-entry runtime array unchanged. The explicit source list contains 4,174 entries. These metadata/package checks do not add product test coverage.

Recorded [assembly](m15-logs/c4-evidence-assemble-01.json) and [checking](m15-logs/c4-evidence-check-01.json) passed integrity validation. After those receipts exist, the final assembler refreshes their membership and hashes all final documentation; the subsequent check verifies that completed package. [M15-validation-summary.json](M15-validation-summary.json) is the final integrity observation. Overall acceptance remains PARTIAL before actual C4 Windows/native/Edge, paired root and full-repository execution. All earlier failures, missing owning capabilities and disabled activation remain explicit.
