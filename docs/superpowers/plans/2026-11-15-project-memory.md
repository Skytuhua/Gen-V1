# M05 Source-linked Project Memory Implementation Plan

> **For agentic workers:** Use the execution and verification skills. Write and record failing fixtures before fixing a new boundary. Preserve earlier failed attempts.

**Goal:** Add bounded, source-linked, user-reviewed project knowledge without promoting model claims into authority.

**Architecture:** A separate host entity family owns source cuts, immutable revisions, consent, indexes, leases and deletion fences. Service and authenticated routes share one ProjectMemoryHost. Accepted M04 custody supplies exact request IDs/generations, admission and final dispatch checks. Settled tasks schedule tool-free ephemeral extraction, user review and local reference consolidation. Supported native compaction requires host checkpoint API v2.

**Stack:** Existing TypeScript, Zod, SQLite Store, React and Vitest/Playwright. No dependency or lockfile changes.

**Spec and handoff:** `docs/implementation/v3/M05-spec.md` and `docs/implementation/v3/M05-handoff.md`.

## Constraints and accepted source

- Preserve the original checkout, the prior `agent/m05-v3` worktree and user changes. Continue in isolated `agent/m05-v3-continuation`.
- Original base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`. Accepted M04 core entered main at `9d4a5141173f54f0f47ff70dcc5167a5c781389e` through PR 351 after all eight Windows CI jobs passed. Broader draft PR 326 remains separate.
- Current accepted main base: `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42`, including M09 PR 350. Latest main has been merged into the continuation; the merged local tests, typecheck and build pass.
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
- [ ] Complete exact-head Windows/native and installed-desktop verification. Controlled native worker fixtures are not substitutes for target-platform execution.

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
- [ ] Execute those browser suites successfully on the continuation's final head. Discovery and local controller assertions are not browser passes.

## Task 4: Evaluation, proof and publication

Files: offline fixture, `evals/project-memory-study.ts`, runner tests/README, handoff, strict verification/source lock and bounded logs.

- [x] Add scenarios for contradicted claims, changed APIs, renamed projects, stale references, malicious memory, secrets, corrections and repeated tasks.
- [x] Implement a real-host runner with three frozen tasks, alternating isolated arms, identical provider/model/account/reasoning, verified zero-memory warmups, thread-note-only controls and exact preparation/exclusion tokens.
- [x] Score actual task output; record bytes and latency; wait for scheduled auxiliary work and include setup/extraction/consolidation spend while retaining unknown measurements.
- [x] Preserve raw foreground usage snapshots without guessing cumulative/per-run accounting. Do not report an unsupported net-cost result.
- [x] Record fail-first and green tests for protocol ownership, captured binding/redaction, strict selection/query/numeric evidence and incomplete cost.
- [x] Map all twelve implementation steps and four UI requirements to production callers and remaining gates in the handoff.
- [x] Preserve the first published Windows purge failure, old Linux full-suite/browser restrictions and all intermediate regression failures.
- [x] Preserve continuation Windows run 43714076939 and import its 24 observed command records: 21 passed, three failed. All 15 M05 browser scenarios passed; current compaction, UTF-8 and root-baseline repairs require a new full run.
- [x] Run the final focused regression (331 memory cases and 125 contract/packaging cases), full typecheck, production build and UI policy checks.
- [x] Reproduce and fix optional consolidation dispatch after Forget/revocation/lease changes and missing pre-dispatch cost metadata; independent review passes all 73 consolidation cases.
- [x] Restore legacy native compaction argument compatibility, explicitly decode Windows UTF-8 history, and repair baseline browser selectors/readiness and narrow Skills layout without weakening behavior assertions.
- [ ] Complete current Windows full-suite evidence and refresh strict CORE/INTEGRATION/PLATFORM receipts.
- [ ] Obtain the continuation's exact-head Windows and browser CI result and disposition every required failure. M04's green CI is dependency evidence only.
- [ ] Obtain installed-desktop execution proof. A desktop build alone does not satisfy it.
- [ ] Run the live repeated-task comparison using an authorized actual host/model and disposable opted-in project/source. Current live status is NOT_RUN; manifests and mocked protocols are not live proof.
- [ ] Commit only reviewed M05 changes, publish the updated head, complete independent review and merge under the user's authorization. Report the final commit separately from files in that commit.

## Evidence boundaries

The current handoff records named local runs, including 27 Service cases, 12 HTTP cases, 14 study protocol cases, 88 renderer/controller cases, 114 native checkpoint cases and three actual pinned Worker Python cases with scripted ACP. These are overlapping scoped runs, not one aggregate or live/platform acceptance result. The current focused aggregate passes 331 memory cases across 21 files and 125 dependency/compatibility cases across nine files; typecheck and build pass. Current Windows and live proof are reported separately.

Default flags stay off. No endpoint, account or credential is guessed or borrowed. Retained records/tombstones remain user-editable under rollback, source authorization and CAS. External provider deletion, arbitrary same-user process protection and whole-parent/system rollback resistance are not claimed.
