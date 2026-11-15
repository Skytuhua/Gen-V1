# M05 Source-linked Project Memory Implementation Plan

> **For agentic workers:** Use the execution and verification skills. Each owner writes and runs its failing fixtures before implementation.

**Goal:** Add bounded, source-linked, user-reviewed project memory without promoting model claims into authority.

**Architecture:** A separate host-owned entity family stores immutable source cuts, item revisions, consent, indexes, leases and deletion tombstones. Authenticated project routes admit the existing physical workspace binding and account before reading or changing records. Pure bounded recall and consolidation are independently testable; runtime request preparation and native compaction remain gated on the missing reviewed M04 contract.

**Tech Stack:** Existing TypeScript, Zod, host SQLite Store, React and Vitest/Playwright. No dependency changes.

**Spec:** `docs/implementation/v3/M05-spec.md`.

## Global Constraints

- Isolated `agent/m05-v3` worktree; preserve the original checkout and other worktrees.
- Base `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`; origin redirects from Skytuhua/Gen-V1 to the same repository ID 1442565952 at skytuhua-org/Gen-V1.
- Host is the sole SQLite writer; every Store callback is synchronous. Existing task notes, Hermes skills, native sessions and grants remain intact.
- Memory defaults off. Maximum item text 2 KiB UTF-8, recall 8 items / 4 KiB including serialized envelope, foreground deadline 750 ms.
- Only authenticated users accept, reject, edit, expire, resolve or forget. Agent extraction only proposes. Explicit source scope and account binding are mandatory.
- External recall stays independently disabled. No embedding provider or data egress is configured. User-wide sharing requires separate consent and remains unavailable in this pilot.
- M04 is unmerged draft #326 and absent from the accepted base. Do not guess its context-generation API or inject through task-note memory. Record BLOCKED_SOURCE_DRIFT for dependent runtime stages while completing independent core and review work.
- Latest user instruction authorizes branch publication and PR creation, superseding the attachment's no-push handoff limit. No merge or deployment.

## Review Focus

- A project label or folder alias must not authorize a different physical directory or another account.
- A user correction racing another edit must preserve both candidates and remove stale indexes from recall.
- A deleted claim must remain excluded across restart, stale source proposals, reindex and old SQLite backup replay.
- Provider cancellation must retain occupied capacity until the actual call settles, including orphaned calls.
- UI owner changes and late responses must not expose or mutate another project's memory.

## Task 1: Contracts and durable review lifecycle

Files: `packages/contracts/project-memory.ts`, `packages/core/project-memory.ts`, `packages/core/capability-flags.ts`, `tests/project-memory-v3.test.ts`, `tests/memory-forget-v3.test.ts`.

- [x] Write and record intentional failing registry/contract fixtures before implementation.
- [x] Define the four specified V1 schemas, bounded review/read models and strict commands.
- [x] Bind project identity to host enrollment and physical identity; scope sources to the selected account and explicit thread set.
- [x] Store immutable source snapshots and revisions; implement CAS review, conflict resolution, correction and expiry.
- [x] Implement durable immediate tombstones, protected authoritative sibling deletion storage and local mirror, enrollment checks, collateral derived-reference invalidation, replay exclusion and a 256-row local purge budget without text in event/receipt payloads.
- [x] Run lifecycle, secrecy, scope, race, restart, storage-boundary and restore tests, preserving red runs and later fixes. Final proof-cut counts are recorded separately.

## Task 2: Bounded recall, extraction and consolidation

Files: `packages/core/memory-retrieval.ts`, `packages/core/memory-consolidation.ts`, focused tests.

- [x] Test lexical project/symbol ranking, source authorization, expiration, stable ties, byte caps and tombstones before implementation.
- [x] Implement and test immutable request/generation snapshots and per-request exclusion as a dormant core seam; finalized snapshots cannot be mutated.
- [x] Test/implement keyed bounded provider admission, timeout, cancellation, orphan occupancy and circuits with synthetic callbacks. No live provider is enabled.
- [x] Test/implement settled, authorized source-cut validation and host proposal methods with exact references and secret checks.
- [x] Test/implement reference-only consolidation under per-project lease and source watermark; unchanged inputs skip work and stale output cannot publish.
- [x] Implement and test adapter-gated structured checkpoint preparation with fail-closed unsupported-version handling, without changing native workers.
- [ ] Integrate real M04 request preparation, prompt injection, exclusion and usage/last-used updates. BLOCKED_SOURCE_DRIFT: M04 is absent from the accepted base.
- [ ] Connect automatic settled-task extraction, separately confirmed preference publication and consolidation scheduling. These production callers are absent.
- [ ] Connect and verify a native checkpoint persistence/registration adapter and actual compaction caller. The helper alone does not satisfy native integration.

## Task 3: Authenticated review UI

Files: `apps/server/project-memory-routes.ts`, server registration, `apps/web/src/ProjectMemoryReview.tsx`, API/CSS, ProjectContextSurface and ContextInspector additive seams, browser fixtures.

- [x] Test session/CSRF, owner/account/revision and fabricated-source rejection before wiring routes.
- [x] Add Accepted, Proposals, Conflicts and Deleted history tabs, pinned source detail with byte verification, explicit opt-in and source scope.
- [x] Add accept/edit/reject/expire/resolve actions, forget preview with purge status and explicit redacted export.
- [x] Add optional Why recalled/exclude UI consuming only request-bound results. No runtime caller is connected; exclusion is labelled unavailable without a real adapter.
- [x] Author ten synthetic browser cases and preserve execution attempts for review actions, owner changes, narrow layout and disabled integration.
- [ ] Execute the browser cases and required baseline suite successfully. Current attempts are blocked by denied IPC/socket operations and provide no browser pass.

## Task 4: Evaluation, review and PR

Files: `docs/implementation/v3/M05-verification.json`, source lock, bounded logs, evaluation fixtures and handoff.

- [x] Add offline evaluation scenarios for contradictory claims, changed APIs, renamed projects, stale sources, malicious instructions, secrets, corrections and repeated tasks, with unmeasured live results left null.
- [x] Record current M01/M02 contracts, targeted M05 suites, typecheck, full-test, build and browser attempts with actual exit codes and preserved failures. The full suite fails and browser execution is blocked.
- [x] Map all twelve implementation steps and four UI requirements to implemented core/seams and outstanding gates in `docs/implementation/v3/M05-handoff.md`; add regressions and fixes for confirmed review findings.
- [ ] Finalize `M05-verification.json` and the source lock with separate CORE, INTEGRATION and PLATFORM results and the final focused proof cut.
- [ ] Resolve required full-suite/browser/platform gates. No platform result is claimed from Linux mocks or synthetic renderer fixtures.
- [ ] Run the live repeated-task comparison using an authorized host/model after runtime integration. Current evaluation is MANIFEST_ONLY and the live study is NOT_RUN.
- [ ] Commit only reviewed M05 changes, publish a draft PR if any required gates remain, and report the exact commit separately from its evidence file.
