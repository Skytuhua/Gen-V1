# M05 Source-linked Project Memory Implementation Plan

> **For agentic workers:** Use the execution and verification skills. Write and record failing fixtures before fixing a new boundary. Preserve earlier failed attempts.

**Goal:** Add bounded, source-linked, user-reviewed project knowledge without promoting model claims into authority.

**Architecture:** A separate host entity family owns source cuts, immutable revisions, consent, indexes, leases and deletion fences. Service and authenticated routes share one ProjectMemoryHost. Accepted M04 custody supplies exact request IDs/generations, admission and final dispatch checks. Settled tasks schedule tool-free ephemeral extraction, user review and local reference consolidation. Supported native compaction requires host checkpoint API v2.

**Stack:** Existing TypeScript, Zod, SQLite Store, React and Vitest/Playwright. No dependency or lockfile changes.

**Spec and handoff:** `docs/implementation/v3/M05-spec.md` and `docs/implementation/v3/M05-handoff.md`.

## Constraints and accepted source

- Preserve the original checkout, the prior `agent/m05-v3` worktree and user changes. Continue in isolated `agent/m05-v3-continuation`.
- Original base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`. Accepted M04 core entered main at `9d4a5141173f54f0f47ff70dcc5167a5c781389e` through PR 351 after all eight Windows CI jobs passed. Broader draft PR 326 remains separate.
- Current accepted main base: `399cde39ff4ee82272c7a7700944325c44b36070`, including M09 PR 350 and M11 PR 345. M11 advanced main before the next Windows run; preserve both feature sets and explicitly verify shared scheduler admission, maintenance observation ownership and metadata privacy.
- Origin redirects from `Skytuhua/Gen-V1` to the same repository ID 1442565952 at `skytuhua-org/Gen-V1`. Exact final source/base identities belong in the source lock.
- The host is the sole SQLite writer. No Store.command/Store.internal callback awaits. Preserve native history, epochs, account pinning, grants, cancellation, existing task notes and Hermes skills.
- Both memory flags default off. Item text is at most 2 KiB UTF-8; recall is at most eight items/4 KiB including framing; local lexical selection uses the remaining 750 ms budget.
- Only authenticated users accept, edit, reject, expire, resolve, confirm preferences or forget. Extraction only proposes. Project opt-in and explicit source scope are required.
- External embeddings/recall, auto-acceptance and user-wide sharing remain disabled. Provider-specific and native capabilities retain independent proof gates.
- Later user authorization permits completion, publication and merge and supersedes the attachment's original publication restriction. Production activation and deployment remain separate.

## Task 1: Contracts, durable review and deletion

Files: `packages/contracts/project-memory.ts`, `packages/core/project-memory.ts`, `packages/core/capability-flags.ts`, storage protection and focused lifecycle tests.

- [x] Record failing registry/contract fixtures before implementation.
- [x] Define the four V1 contracts, strict review/read models and byte/row limits.
- [x] Bind physical profile/project/workspace identity, account and explicit source-thread consent.
- [x] Implement immutable exact-source snapshots, exact-source reuse, revisions, CAS correction, conflicts, explicit resolution and expiry.
- [x] Implement project-only reusable-preference confirmation without automatic preference publication or global sharing.
- [x] Implement durable immediate tombstones, protected authoritative sibling and local mirror, fail-closed enrollment, source-collateral invalidation and replay protection.
- [x] Enable secure deletion before retention; add versioned legacy VACUUM plus nonbusy WAL checkpoint before committing `secure-delete-v1`.
- [x] Keep maintenance bounded to at most 256 deleted entity rows per call and seven-day retention; preserve original task/file history.
- [x] Reproduce and fix freed-page retention, source-only replay, pinned-reader migration, full-profile restoration, revoked FILE grants and matched-term receipt retention; retain red/green evidence.

## Task 2: Production request, extraction and native integration

Files: `packages/core/project-memory-host.ts`, `packages/core/service.ts`, `memory-retrieval.ts`, `memory-extraction.ts`, `memory-consolidation.ts`, production service composition, checkpoint contracts and runtime bridges.

- [x] Test and implement lexical eligibility, ranking, exact source ownership, expiration, stable ties, byte caps and tombstones.
- [x] Integrate accepted M04 custody with host-issued request/generation snapshots, exact-draft preparation, per-request exclusion, final revision/source/consent checks and actual prompt injection.
- [x] Return no editable preview for an unbound first send; capture its automatically allocated request after account binding.
- [x] Publish CAPTURED recall and usage/last-used projection only after native acceptance of the exact input.
- [x] Persist only IDs/counts/digests and numeric scores in request receipts; keep plaintext matched terms ephemeral.
- [x] Implement the separately disabled bounded external-recall adapter and its synthetic timeout/cancellation/orphan/circuit tests.
- [x] Register metadata-only extraction scheduling in the accepted settled projection before event publication.
- [x] Connect bounded authorized message extraction to the production tool-free ephemeral Pi transport, preserving provider/model/account/reasoning and refusing unsupported transports before source dispatch.
- [x] Validate exact references, unsupported action fields and secrets before proposed publication; distinguish unresolved work; require separate user preference confirmation.
- [x] Keep FILE grant custody private. Public cuts explicitly omit host-only metadata; any future FILE-cut caller must validate and strip it.
- [x] Connect review/settled consolidation to the per-project lease/watermark reference index; unchanged inputs skip work and stale/deleted inputs cannot publish.
- [x] Connect native host checkpoint API v2 through pinned Pi and Hermes compaction boundaries; reject unsupported adapters and recheck owner/session after asynchronous persistence.
- [x] Fix pending count deduplication, orphan accounting, checkpoint session races, executor/outbox cancellation and running-schedule drain; preserve unknown attempted costs on interrupted recovery.
- [x] Close the M09 delegate-startup scheduling interaction and include it in the passing 331-case focused memory regression.
- [x] Complete Windows/native contract verification on the recorded reviewed source cut in run 43726164418. All 33 Python/native contracts pass on Windows; earlier results remain preserved.
- [x] Author three unmocked Windows FILE cases for exact guarded UTF-8 capture/reuse and rejection after grant revocation or physical replacement; local full typecheck passes and capability flags remain false.
- [x] Execute all three unmocked native FILE cases on Windows in run 43733008039 at head `5a647b04c14ba4de8d80411aeba7e649227664fc`, tree `2f8043bbb9dcd95c068eb91380ca5c897f0c754f`: three passed, zero failed or skipped. The [independent review](../../implementation/v3/M05-native-file-review-43733008039.json) closes this bounded native capture/reuse/revocation/replacement proof, without claiming installed or live-provider execution.
- [ ] Obtain full enabled installed-desktop memory lifecycle proof. The separately authored default-off retention verifier cannot establish enabled injection/exclusion, automatic extraction or native checkpoint execution.

## Task 3: Authenticated review and preparation UI

Files: authenticated project routes, `ProjectMemoryReview.tsx`, API/CSS, `ProjectContextSurface.tsx`, preparation controller/hook, `App.tsx`, shared composer and `ContextInspector.tsx`.

- [x] Record failing session/CSRF, strict schema, owner/account/revision and source-fabrication tests before integration.
- [x] Implement four tabs, source/age/expiry/last-used metadata, lazy project entry, explicit opt-in and exact supporting bytes verified by SHA-256.
- [x] Implement accept/edit/reject/expire/resolve, explicit project-only preference confirmation, forget preview/purge state and redacted export.
- [x] Connect Why recalled to real request preparation with exact serialized terminal excerpts and opaque-token plumbing in ordinary/shared sends.
- [x] Fence late owner responses and preserve retry command identity. Draft/model/reasoning/owner changes invalidate preview; pending/failed exclusion blocks token use until explicit reprepare or draft change.
- [x] Show the last accepted capture for an empty draft; disable exclusion for captured requests, missing adapters, pending work or unbound/disabled preparation.
- [x] Author/discover 15 synthetic browser scenarios and retain fixture ownership separate from real HTTP/Service integration.
- [x] Add actual CI execution of M05, usage-context, frontend-refinement and root baseline suites; retain failure artifacts and native Edge on Windows.
- [x] Preserve the complete browser result on earlier published head a0755d34 in Windows run 43721299625: 267 passed, two skipped, no failures or flaky cases. All 15 M05, 17 plan and four document-width cases passed on that exact cut.
- [x] Verify the initial-navigation repair in run 43724428807: all 29 split-browser baseline cases passed and all four subsequent suites executed. The earlier run 43723377122 remains failed with 28 baseline passes, one failure and four later suites unexecuted.
- [x] Complete all required browser suites with both fixture repairs in run 43726164418: 267 passed, two skipped, zero failed or flaky. Split baseline 29, project-memory 15, usage/context 21, frontend-refinement 90 and root 112 passed. The FAQ assertion executed successfully; run 43724428807 remains failed with 266 passes, one failure and two skips.
- [x] Execute the acknowledgment-readiness repair and every required browser suite in run 43733008039: 267 passed, two skipped, zero failed or flaky. The acknowledgment case passed in 8.6 seconds whole-test time; all 15 M05, 17 plan and four document-width cases passed. The [case audit](../../implementation/v3/M05-browser-cases-43733008039.json) preserves individual results. The overall workflow still failed its separate packaging job.

## Task 4: Evaluation, proof and publication

Files: offline fixture, `evals/project-memory-study.ts`, runner tests/README, handoff, strict verification/source lock and bounded logs.

- [x] Add scenarios for contradicted claims, changed APIs, renamed projects, stale references, malicious memory, secrets, corrections and repeated tasks.
- [x] Implement a real-host runner with three frozen tasks, alternating isolated arms, identical provider/model/account/reasoning, verified zero-memory warmups, thread-note-only controls and exact preparation/exclusion tokens.
- [x] Score actual task output; record bytes and latency; wait for scheduled auxiliary work and include setup/extraction/consolidation spend while retaining unknown measurements.
- [x] Preserve raw foreground usage snapshots without guessing cumulative/per-run accounting. Do not report an unsupported net-cost result.
- [x] Record fail-first and green tests for protocol ownership, captured binding/redaction, strict selection/query/numeric evidence and incomplete cost.
- [x] Map all twelve implementation steps and four UI requirements to production callers and remaining gates in the handoff.
- [x] Preserve the first published Windows purge failure, old Linux full-suite/browser restrictions and all intermediate regression failures.
- [x] Preserve continuation Windows run 43714076939 and import its 24 observed command records: 21 passed, three failed. All 15 M05 browser scenarios passed; the later compaction, UTF-8 and root-baseline corrections are verified by run 43721299625.
- [x] Preserve the earlier 331-memory/125-contract local aggregate and complete the final M11-integrated 347-memory/185-dependency/runtime/packaging aggregate, full typecheck, production build and UI policy checks.
- [x] Reproduce and fix optional consolidation dispatch after Forget/revocation/lease changes and missing pre-dispatch cost metadata; independent review passes all 73 consolidation cases.
- [x] Restore legacy native compaction argument compatibility, explicitly decode Windows UTF-8 history, and repair baseline browser selectors/readiness and narrow Skills layout without weakening behavior assertions.
- [x] Preserve second continuation Windows run 43716553796: all 3,709 application cases and 33 native contracts pass; that historical root-browser result has 20 failed cases. Import 24 observed command records, including its failing browser command.
- [x] Diagnose the root plan fixture returning the app HTML fallback and restore desktop manual expansion in the document fixture. The exact fixture route passes HTTP/module checks, typecheck and all 17 actual plan browser cases in run 43721299625.
- [x] Resolve the M11 merge and verify shared background account admission, memoized cancellation lifetime, maintenance observation ownership and metadata-only diagnostics. Final local checks pass 347 memory cases and 185 dependency/runtime/packaging cases, typecheck, build and UI policy; the source lock records the accepted M11 contracts.
- [x] Preserve the earlier complete Windows run 43721299625 and its strict receipts. All eight jobs passed on that exact source cut; all 24 observed command records were imported without replacing prior evidence.
- [x] Record failed documentation-final run 43723377122: all seven non-browser jobs passed, including 3,746 application cases with 39 skips and 33 native contracts. The split baseline had one initial-navigation failure and 28 passes; the four later browser suites did not execute.
- [x] Apply the minimal split-app fixture repair: initial `page.goto` timeout 20 seconds, unchanged seven-second action waits, unchanged outer test bounds and assertions. Cold first-load delay remains an inference, with no subresource trace identifying a bottleneck.
- [x] Preserve startup-fix run 43724428807 at head 2e210878, checkout af91fb49, tree 236d62b5: seven jobs passed; application 3,746 passed/39 skipped, Hermes 33 and policy/plugin 37 passed. Browser baseline 29, project-memory 15, usage/context 21 and root 112 passed; frontend-refinement recorded 89 passes, one FAQ failure and one skip. Total browser 266 passed/one failed/two skipped.
- [x] Diagnose Escape preceding the expanded FAQ snapshot and add one exact `Collapse artifact` focus assertion after Expand, before the retained-value check and Escape. Preserve production source, every existing assertion and the failed trace.
- [x] Complete full Windows verification after the FAQ readiness assertion in run 43726164418: all eight jobs passed on head d081973e, actual checkout 9caea6e0, exact tree ffac9062. Preserve that observed result for its immutable source/test cut; retain both intervening failed attempts and keep later documentation-commit execution separate.
- [x] Verify exact combined source head a0755d34 and actual merge checkout 887a831e share tree c391fa72. Run 43721299625 passed all required application, native, browser, policy and build checks on that historical cut; earlier failures and the later failed documentation-final attempt are retained.
- [x] Preserve finalization run 43727736261: seven jobs passed; browser 266 passed/one failed/two skipped. The sole host-operation setup failure occurred before approval assertions, when the artifact-bearing snapshot arrived near the end of the combined five-second publication/render wait, after sequential guarded-file preparation. Individual native-operation durations are unmeasured.
- [x] Separate bounded fixture publication from rendering: add a 15-second attachment assertion before the unchanged five-second visibility assertion, retaining the outer bound and every native approval/effect/restart assertion. Preserve the exact failed trace and source identities.
- [x] Preserve run 43729864202: seven jobs passed; browser 266 passed/one failed/two skipped. The repaired host-operation case passed in 9.1 seconds of whole-test time, and all 15 M05, 17 plan and four document-width cases passed. The sole acknowledgment fixture failed its initial checked-row wait before any selection command.
- [x] Preserve the acknowledgment trace diagnosis and add only a 15-second initial visibility assertion before the existing selection assertions. Keep save/acknowledgment barriers, revision ordering, exact save count, 650 ms quiescence, outer timeout and zero retries unchanged.
- [x] Preserve terminal run 43733008039 at head `5a647b04`, actual checkout `a6853729ff49ce2b42ec5cb29526a731e38a07df`, tree `2f8043bb`: eight jobs passed and the installed packaging job failed. Application 3,754 passed/39 skipped, Hermes 33, policy/plugin 37 and browser 267 passed/two skipped/zero flaky. Three real native FILE cases passed. Import the 26 observed commands as 25 PASS and one package FAIL, retaining all earlier records and no invented skipped-verifier command.
- [x] Preserve terminal run 43736761161 at head `828cdf52c76e44ca07c0fcdd647601a64bf30081`, actual checkout `ce93c20a3394157af18f585f794c97dd067f37a5`, tree `a3f5f1b083689302f85dfd68fa5fcf735f5d401b`: seven jobs passed, installed verifier and browser failed. Application 3,782 passed/39 skipped; Hermes 33; policy/plugin 37; browser 266 passed/one failed/two skipped/zero flaky. All 15 M05, 17 plan and four document-width cases passed. Import the 27 observed commands as 25 PASS and two FAIL, retaining all 492 previous records and bytes. Record wheel staging as observed script metadata without fabricating an executable command.
- [x] Review the bounded read-only preflight repair and operation-only fixture readiness/diagnostic repair. Preserve every native custody, approval, revision, effect and restart assertion. Record 15 passing local preflight cases and the final combined full typecheck. Actual Windows execution remains pending.
- [ ] Complete a fresh full nine-job Windows workflow after the installed-preflight and browser fixture findings are addressed. Run 43736761161 remains failed despite its successful canonical package, application cases and native FILE proof.
- [x] Author explicit installed retention mode, canonical disposable-profile seeding through production Store/ProjectMemory APIs, two exact installed executable launches, pinned-source/review/redacted-export/Forget/restart assertions and identity-bound uninstall. Keep the installed host default-off and provider-network metrics unmeasured.
- [x] Add the bounded Windows packaging/install job using declared pinned inputs, exact expanded verifier argv logging, and report/screenshot preservation. Preserve the legacy verifier path when retention mode is absent.
- [x] Record installed seed/option/custody fail-first evidence, 13 passing local cases and successful full typecheck. These results do not execute an installer or installed UI.
- [x] Implement and independently review explicit wheel-authenticated canonical RECORD mode while retaining the original v1 lock and all 7,324 non-RECORD hashes. Preserve both reproduced metadata ownership failures and fixes. Final focused suite: 28 passed; final full typecheck: PASS. All 28 cases also pass in Windows run 43736761161. Actual packaging and installed execution retain separate proof boundaries.
- [x] Execute production canonical packaging and NSIS generation in Windows run 43736761161. The [actual review](../../implementation/v3/M05-canonical-package-review-43736761161.json) verifies the emitted 7,415-path receipt, all 7,324 protected non-RECORD rows, 91 exact wheel pins and build-manifest binding. Preserve the preceding exact-lock packaging failure. This result is distinct from the desktop shell-only build.
- [ ] Complete NSIS installation, default-off installed retention/restart and owned uninstall on Windows; review actual receipts and screenshots. In run 43736761161, the verifier executed and failed its first read-only preflight before installation. Its receipt records no launches and cleanup not-installed. Installation, retained-memory UI actions, restart and uninstall remain NOT_RUN.
- [ ] Run the live repeated-task comparison using an authorized actual host/model and disposable opted-in project/source. Current live status is NOT_RUN; manifests and mocked protocols are not live proof.
- [x] Commit reviewed M05 changes, publish the combined source and complete independent source/original-prompt review.

Publication and merge are authorized by the user and tracked by [PR 347](https://github.com/skytuhua-org/Gen-V1/pull/347). The final PR state and merge commit are reported outside files in that same commit; implementation evidence does not authorize activation.

## Evidence boundaries

The current handoff records named local runs, including 27 Service cases, 12 HTTP cases, 14 study protocol cases, 88 renderer/controller cases, 114 native checkpoint cases and three actual pinned Worker Python cases with scripted ACP. These are overlapping scoped runs, not one aggregate or live/platform acceptance result. The final M11-integrated focused aggregate passes 347 memory cases across 22 files and 185 dependency/runtime/packaging cases across 13 files; typecheck, build and UI policy pass. The earlier Windows run 43721299625 passed all eight jobs, including 3,746 application and 267 browser cases. Later documentation-only run 43723377122 passed seven jobs but failed its first split-app fixture at initial navigation, before assertions; the remaining 28 baseline cases passed and four subsequent browser suites did not execute. Run 43724428807 then passed the repaired 29-case baseline and executed all four later suites, but its one FAQ readiness failure kept the full workflow failed: 266 browser passes, one failure, two skips. Run 43726164418 subsequently passed all eight jobs with both fixture repairs, including 3,746 application cases/39 skips, 33 Hermes contracts, 37 policy/plugin cases and 267 browser cases/two skips/zero failed or flaky. Production-source review remains complete; the earlier 21-screenshot inspection is historical on unchanged production/UI source, with four test-only baseline fixture repairs plus native FILE and installed-verification coverage outside documentation. No new image inspection is claimed for run 43733008039. That run closes the bounded native FILE proof; installed-desktop and live-study proof remain open.

The later finalization run 43727736261 failed one root host-operation setup case while all other browser and non-browser checks passed. Run 43729864202 then executed and passed the publication-readiness repair; the host-operation case took 9.1 seconds as a whole test, with no separate native-operation timing claim. That workflow remains failed because the acknowledgment fixture exhausted its initial startup/checked-row wait. The checked row appears 16.324 ms after failure in the retained DOM, before any selection command. Run 43733008039 executes the new initial visibility assertion and passes the acknowledgment case in 8.6 seconds whole-test time. It also passes the host-operation case in 9.1 seconds and FAQ in 2.6 seconds. Historical failures are not relabelled as passing results, and these timings do not measure individual startup or native operations.

Run 43733008039 tested head `5a647b04c14ba4de8d80411aeba7e649227664fc`, actual checkout `a6853729ff49ce2b42ec5cb29526a731e38a07df`, exact tree `2f8043bbb9dcd95c068eb91380ca5c897f0c754f`. Eight jobs passed and the installed job failed packaging preflight. Application results were 3,754 passed/39 skipped; browser results were 267 passed/two skipped/zero failed or flaky. Three real unmocked Windows FILE cases passed, including retained-candidate denial after grant revocation or same-byte physical replacement. The [native review](../../implementation/v3/M05-native-file-review-43733008039.json) closes only this source-cut custody proof. It does not establish arbitrary filesystem coverage, installed execution or live-provider behavior.

Run 43736761161 tested canonical packaging head `828cdf52c76e44ca07c0fcdd647601a64bf30081`; all nine jobs used checkout `ce93c20a3394157af18f585f794c97dd067f37a5`, tree `a3f5f1b083689302f85dfd68fa5fcf735f5d401b`. Seven jobs passed and two failed. Application results were 3,782 passed/39 skipped; browser results were 266 passed/one failed/two skipped/zero flaky. All 15 M05, 17 plan and four document-width cases passed. Acknowledgment and FAQ passed in 6.3 and 2.4 seconds of whole-test time. The host-operation fixture failed its 15-second attachment wait before approval/restart assertions. Its cause is not inferred from the earlier passing host-case runs.

Canonical production packaging passed in this run, preserving the original v1 lock and all 7,324 protected non-RECORD hashes. The 91-wheel marker records the original lock SHA256 `264d28c353d065001daaad796abf3602074599ab5fbd630bcb0958c529b63700`. Actual cache diagnosis reports 7,415 expected files, 7,595 actual files, 180 added, zero missing and 91 changed. The complete changed list consists of `RECORD` paths; the added list contains only 100 of 180 entries and is explicitly truncated. The [actual package review](../../implementation/v3/M05-canonical-package-review-43736761161.json) separately verifies 7,415 exact projected paths, 7,324 unchanged protected rows, 91 pinned archives, and the build-manifest receipt digest. Canonical-versus-v1 comparison has 75 unchanged and 16 changed `RECORD` rows; this does not describe the input cache's separate 91 changed rows. The legacy exact-v1 mode remains available. All 28 canonical fixtures passed on Windows.

The installed verifier then executed and failed its initial read-only preflight's 15-second process bound with `Owned installer verification process exceeded its deadline.` The [actual receipt](../../implementation/v3/m05-platform-43736761161/verification.json) has no completed preflight, expected-payload, install-command or memory-retention observation; launches are empty and cleanup is not-installed. Actual installation, retained-memory UI actions, restart persistence and owned uninstall remain NOT_RUN. There are no installed owner receipts or screenshots. The successful package is not an installed pass, and both current failures require a new Windows result after reviewed repairs. All historical failures remain immutable.

The installed helper requires the same physical backend/project identities and disposable Electron profile path, source-linked seeded records, reviewed corrections, acceptance/rejection, a redacted download and a Forget tombstone across two installed launches. It changes no account/provider configuration and leaves host flags false. Even a future default-off retention pass would leave the full enabled installed lifecycle and authorized live repeated-task study unproven. Provider network-call measurements remain null.

Default flags stay off. No endpoint, account or credential is guessed or borrowed. Retained records/tombstones remain user-editable under rollback, source authorization and CAS. External provider deletion, arbitrary same-user process protection and whole-parent/system rollback resistance are not claimed.
