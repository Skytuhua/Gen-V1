# Lean performance implementation plan

**Goal:** Reduce unnecessary source and repeated work while preserving features, recoverable state, validation and resource boundaries.

**Architecture:** Keep the existing React/HTTP/SSE/Node/SQLite design. Fix measured hot paths, bound validation compilation, retire proven historical tools and normalize repetitive settings data. No framework replacement or line-count minification.

**Baseline:** `2ce8aaf`; 16,490 production lines, 4,611 script lines, 14,651 test lines. Lockfile and binary references are measured separately. Existing verification: 670 units and 516 distinct browser cases, with six explicit skips.

## Constraints and review focus

- Keep all 48 catalog components, provider adapters, history, drafts and approved-operation semantics.
- Preserve source/grant identity, cancellation, frame ownership and native process isolation.
- Keep recordings, evidence, installations and local task/user data intact.
- No live subscription retries, extra billing or generated-code enablement.
- Verify Unicode split at process chunk boundaries, archived/snapshot-version content, changed schemas and bounded caches, empty/nonempty thread search, and first-open Settings focus.
- Measure operation counts and output size as well as elapsed time; do not infer production readiness from fixtures alone.

## 1. Backend hot paths and process output

- Add regressions in `tests/store.test.ts` and `tests/service.test.ts` for constant archive-query count, pinned versions and settings updates without full snapshots.
- Read threads once and archived IDs once in `packages/storage/store.ts`; use the settings entity directly in `packages/core/service.ts`.
- Add a real-child UTF-8 split regression in `tests/process.test.ts`; decode streams continuously in `packages/capabilities/process.ts`.
- Repeat the 100-thread/5,000-message snapshot benchmark and relevant operation/cancellation suites.

## 2. Frontend work and bounded validation

- Pin search behavior with focused tests: empty query, title/project/message matches, cross-message phrases, side-thread exclusion and ordering.
- Remove repeated history scans from `App.tsx`; index message text once when searching and skip it entirely for empty queries.
- Lazy-load Settings while preserving shortcut/open/focus/search/dismissal behavior.
- Reuse schema-content validators through one bounded cache for App and Artifact. Keep Ajv authoritative, release its obsolete schema identities and test equivalent/changed/invalid schemas and eviction.
- Remove compiler-proven unused App calculations and imports. Repeat browser typing/SSE checks and compare actual production initial/gzip assets.

## 3. Source reduction and verification tooling

- Freeze a hash of every current settings row; replace 136 repeated object shapes in `settings-inventory.ts` with typed tabular data and one mapping. Preserve all strings and order.
- Retire only four unreferenced historical assemblers: `assemble-initiated-review.ts`, `finalize-review.ts`, `build-centered-review-index.ts`, `build-smooth-review.ts`. Preserve the current 30-video pipeline and all outputs.
- Remove compiler-proven unused imports/locals, then enable no-unused compiler checks.
- Make the default browser runner Vite-only on a dedicated port; build production web assets before actual-host tests.
- Keep per-feature config aliases unless a shared setup measurably improves maintenance with no lost options.

## 4. Acceptance

- Run focused regressions before/after changes, then the full unit suite, strict typecheck, production and desktop builds, and complete browser regressions on frozen source.
- Independently review the coherent patch for correctness, authority and lost coverage.
- Report production/test/tool line and byte deltas, bundle and hot-path results, removed files and remaining production gates. Preserve the baseline commit for recovery.
