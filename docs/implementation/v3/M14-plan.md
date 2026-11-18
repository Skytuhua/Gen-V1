# M14 prerequisite audit and implementation plan

> **For agentic workers:** Use the Superpowers execution and verification workflows. This plan follows the supplied M14 prompt; a failed prerequisite blocks dependent stages.

**Goal:** Deliver safe branchable sessions and inert history imports only after the required source contracts and runtime behavior are verified.

**Architecture:** Preserve host-only SQLite writes, native adapter history ownership, run epochs, account custody and fresh grants. Historical inspection needs an immutable source-bound capture; live branches need an independently proven native fork API. Neither can be inferred from the current UI transcript.

**Tech stack:** Existing TypeScript, Python, SQLite, Vitest and Playwright dependencies. Declared launcher: `corepack pnpm` 10.30.3; Node >=24.10.0.

**Spec:** [Original M14 request](M14-request.md).

## Global constraints

Use only the isolated `agent/m14-v3` worktree. Preserve the original checkout and existing M12 worktree. Accepted base: `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`; audit ancestor: `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54`.

M01, M02, M04 and M05 must have reviewed source contracts and current contract tests on the accepted base. Do not replace missing contracts with guessed APIs. Never await inside Store transaction callbacks. Do not enable features, alter accounts, merge, deploy or rewrite remote refs.

The user's direct instruction to open a PR authorizes publishing this isolated branch for review. The attachment's merge and deployment prohibitions remain in force. An incomplete bundle must be a draft PR and explicitly blocked.

## Review focus

1. A receipt reader must never be reported as a transcript or native fork API.
2. Current mutable message bodies and a pagination row ID do not prove historical snapshot content.
3. A missing required dependency must not become a fabricated contract version, accepted dependency commit or passing feature gate.
4. Failure to install tools must not be counted as an intended-negative feature test or passing test run.
5. A source audit, generated manifest or pure evidence fixture must not be reported as implementation acceptance.

## Task 1: Establish source custody and dependency boundaries

- [x] Read the complete attached prompt, package manifest, lockfile, architecture and every specified target; inspect callers and relevant tests.
- [x] Record repository/origin identity, clean original checkout, isolated branch and accepted base. Verify the audit ancestor.
- [x] Audit exact M01/M02 source blobs and evidence. Inspect the accepted tree for M04/M05 contracts and verify the remote M04 draft status.
- [x] Independently review the current native history capability matrix and reader semantics.
- [x] Resolve the declared pnpm 10.30.3 through Corepack. Preserve setup failures and actual command results.

**Ruling:** M04/M05 cannot be verified on the accepted base. The current adapter contract exposes delivery receipt IDs, not fixed-cut inspection or native fork. Stop dependent implementation. The missing capabilities are baseline limitations, not an observed incompatible source API change.

## Task 2: Preserve independent evidence and negative fixtures

**Files:** `M14-source-lock.json`, `M14-handoff.md`, `M14-verification.json`, `m14/logs/*`, `tests/m14-evidence-gates.test.ts`.

**Interfaces:** Consume the existing M01 `ImplementationEvidenceV3`, source-lock and evidence-validation contracts without changing them. Produce a reproducible handoff and synthetic evidence-gate tests. These tests do not prove M14 functionality.

- [x] Test missing/changed dependencies, false success claims, blocked phases and nonzero setup failures using the existing evidence validator.
- [x] Run the current prerequisite tests if frozen setup succeeds. Run and record the requested target commands, typecheck, test, build and baseline browser command, retaining setup blocks honestly.
- [x] Record actual exit codes, bounded logs, exact source blobs, all unmet feature acceptance cases and rollback status.
- [x] Review source-lock and log digests and validate the handoff against the shared M01 schema where executable setup permits.

## Task 3: Resume dependent product implementation only after the gate opens

**Status: BLOCKED.** No public M14 schemas, production modules, runtime/Store wiring, UI actions or feature flag registration are introduced by this audit.

- [ ] Obtain an approved base with reviewed M04/M05 contracts and current passing contract tests; revalidate M01/M02.
- [ ] Lock exact owner/session/snapshot/attachment/provenance contracts, then write failing M14 feature fixtures before implementation.
- [ ] Implement fixed-cut inspection, preserving owner fences and unavailable source evidence.
- [ ] Prove each native adapter fork separately, with fresh identity/grants/account custody; retain explicit unsupported fallbacks.
- [ ] Implement bounded ArchiveV1 validation, scrub/preview, deterministic deduplication and atomic inert publication with cancellation.
- [ ] Implement distinct UI actions and separate approved M08 file restoration only when that capability is available.
- [ ] Register only `sessions.branchV1` and `sessions.inertImportV1`, both default false, in the existing shared registry.
- [ ] Complete all feature, browser, native and platform gates before any activation claim.

## Task 4: Review and publish the blocked handoff

- [x] Compare every change with the original prompt and fix evidence/reporting errors.
- [x] Obtain an independent final review of the branch; verify original checkout preservation and scoped changed files.
- [ ] Commit only this bundle's reviewed files and open a draft PR. Report its final commit separately from files in that commit.

No data migration is performed. Rollback is removal of the audit additions; native sessions, conversations, grants, checkpoints, credentials and external effects are untouched.

## Validation ruling

The current focused checks passed (225 tests), as did typecheck and the pinned production build. The full direct Vitest attempt failed (244 failed, 2,860 passed, 45 skipped tests; four unhandled errors), so the shared evidence status is FAIL. Product implementation remains BLOCKED. The required test/browser entrypoints also failed before tests at the tsx IPC boundary; the direct root browser attempt stopped at missing native node-pty. No platform/feature claim is inferred from mocks, skips or setup exits.

## Final review

An independent reviewer checked the original prompt, staged changes, all 54 source blobs, schema/log/artifact consistency and six synthetic tests. No Critical or Important issue was found for a draft audit PR. The one Minor wording inconsistency in the coverage table was corrected to the actual FAIL status. No findings were deferred. Native product behavior and causes of the broad regression failures remain outside the proved evidence and stay gated.

The original checkout remains clean at its original SHA. The reviewed scope contains only M14 audit documentation, logs and independent evidence tests. Publishing is limited to the requested draft PR; no merge or activation is authorized.
