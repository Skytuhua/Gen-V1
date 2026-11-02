# Hermes Learning Implementation Plan

> **For agentic workers:** Use the existing native collaboration workflow with explicit file ownership and tests first. Parent reviews integration and obtains independent code/security review before completion.

**Goal:** Integrate a useful, recoverable Hermes-style skill-learning loop into the existing Harness across its nine provider IDs.

**Architecture:** One Store-backed library, one shared tool set and one bounded post-turn review owner. Reuse existing account/runtime lifecycle, command receipts, Settings and SSE; passive curation is a small idle-time policy, not another scheduler service.

**Tech Stack:** Existing TypeScript/React/Node/SQLite/Pi and official runtime adapters; no new dependency.

**Spec:** `docs/superpowers/specs/2026-11-01-hermes-learning-design.md`.

## Global Constraints

- Skill content grants no permission and is never executed while loading.
- Existing grants, exact approvals, revision/epoch checks, account ownership, draft safety and all providers/components remain.
- Do not write this Codex profile's global skills or memories.
- Preserve MIT attribution and source pin. Distinguish synthetic integration from live learning quality.

## Review Focus

- Multi-skill failure must roll back the whole batch; stale approval must preserve pending data.
- Background writes require fresh reads and current ownership, including async startup/Stop races.
- Disabled/protected/user-owned skills survive automatic learning and idle curation.
- Catalog changes reach existing/new sessions without stuffing full bodies into every snapshot.
- Read-only children, malformed paths and skill text cannot widen tool or filesystem authority.

### Task 1: Versioned skill library

Files: new `packages/contracts/skills.ts`, `packages/core/skills.ts`, `tests/skills.test.ts`.

- [x] Write/run failing tests for metadata-first discovery, atomic operations, immutable versions, approval, rollback/archive/restore, usage and protected/disabled behavior.
- [x] Implement synchronous Store transaction helpers. Export typed metadata/detail/operation interfaces, `listSkills`, `viewSkill`, `applySkillOperations`, `decideSkillProposal`, `setSkillFlags`, `skillIndex`, `curateSkills`. Mutators run inside the caller's existing Store transaction.
- [x] Confirm focused tests and typecheck; publish exact exports to parent before integration.

### Task 2: Runtime learning ownership and shared integration

Files: new `packages/core/learning.ts`, Service/contracts/shared tool metadata and relevant runtime error paths/tests.

- [x] Write/run failing real-Service tests for shared skill tools and cross-thread/restart reuse; keep child mutation denial.
- [x] Add current skill metadata and concise learning instructions through shared host context; `/learn` uses ordinary input with source-aware guidance.
- [x] Write/run failing review tests for ten-call cadence, separate runtime/account, fresh-read dispatch, sixteen-call/64-KiB/60-second bounds, cancellation, stale context and no recursive/restart generation.
- [x] Implement one owned learning coordinator, bounded search and passive curator. Store truthful review/usage/change status; keep skill bodies out of snapshots.
- [x] Reproduce/fix native output-pipe failures before automatic native execution; retain safe public errors and settlement.

### Task 3: User-owned skill and learning controls

Files: Settings, one small skills panel, skill detail HTTP/API, metadata snapshot and browser tests.

- [x] Write/run failing browser cases for inspect/edit conflicts, enable/protect, staged approve/reject, history/rollback, archive/restore and saved learning controls.
- [x] Implement with existing tokens/components, text-only body/file viewing and accessible controls. No dashboard, visual graph or new navigation framework.
- [x] Inspect desktop/narrow and light/dark in one batch; correct defects together and confirm once.

### Task 4: Acceptance and comparison

- [x] Add all-nine-provider synthetic routing and installed shared-tool/MCP tests, preserving source/account identity.
- [x] Independently review code and security, fix confirmed findings with regressions, then run full units, typecheck, web/desktop builds and appropriate browser/native checks.
- [x] Publish pinned primary-source comparison, source attribution and an explicit implemented/different/unverified parity matrix. Commit the coherent result; never promote fixture proof to live-provider quality or universal open-source superiority.

Final verification and proof boundaries: `docs/2026-11-01-hermes-learning-verification.md`. Browser coverage combines the complete sweep with all affected files rerun; it is not described as a second clean complete sweep. Production sources remained unchanged through the final test-helper corrections.
