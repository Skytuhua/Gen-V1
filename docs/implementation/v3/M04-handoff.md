# M04 context compiler: implementation handoff (incomplete)

This draft preserves the verified offline implementation. It is **not ready to merge, release or activate**. Keep all four M04 flags off by default. Start from this PR's exact head in a clean checkout. M01 and M02 were reconciled in #303; verify those contracts at the current base. M03 is a separate gate for project execution, not a reason to loosen M04's pure implementation.

## Implemented

- Deterministic context compiler and append-only cache logic; instruction manifest, repository map and relevance helpers. The admitted host submission has a metadata-only projection. Tests verify that this projection does not change the submitted prompt.
- On the supported owned Hermes path, capture observed UTF-8 request size and frozen host schema usage. Deferrals apply to the next admitted request. The host rejects early calls. Do not generalize this result to other adapters or call these provider token counts.
- A bounded app-owned result vault supports one opt-in oversized catalog result path, with owner, run, epoch, workspace, model and account checks. The Context Inspector exposes request/source/tool/compaction evidence. Loss-aware compaction reports unsupported instead of invoking a native path that cannot safely apply a compaction.
- Draft source pin helpers implement revision, refresh/keep decisions, removal semantics and limits. They are **not wired into the composer**.

## Start here

1. Integrate `packages/core/context-draft-sources.ts` with the composer and its attachment controls. Resolve source metadata under current host admission and grants, not browser-provided paths or authority. Use an actual revision and an available retained snapshot before offering Keep; require explicit Refresh for a changed source; Remove affects only the next unsent draft. Cover cross-owner and revoked sources, changed/deleted revisions, reload, and the 8-reference/64 KiB combined bound. Add a scoped real-browser test.
2. Audit adapter integration against the full M04 specification. The incremental history cache is tested in isolation; it is not wired across adapters. Keep exact admitted boundaries, use honest byte-only/native-opaque labels where appropriate, and do not reconstruct native messages or modify authoritative history. Verify real tool disclosure, schema pinning, and bounded authorized retrieval for each additional path before claiming support.
3. Verify the remaining compaction and experiment requirements. Do not emulate native compare-and-swap through a derived shadow or modify native history when unsupported. Keep the report-only observer nonmutating and experimental precompute disabled. Distinguish unsupported paths from completed integration.
4. Classify remaining regression failures against the unchanged base with equivalent prerequisites; keep Windows/local results distinct. Run exact-head typecheck, relevant unit/native contracts, browser checks and Windows CI. Obtain authorized live evidence if required; otherwise record it as missing. Update the `ImplementationEvidenceV3` receipt with actual evidence only, and do not self-approve or merge a partial draft.

## Packaging gap

This draft leaves the existing full source inventory unchanged. Before packaging, review and register the new first-party modules and tests with the repository's source-inventory workflow. Do not treat a source-export or packaging failure as a passing check.

## Verification at handoff

- 121 focused tests passed, and 21 local Chromium tests passed for the observed Context Inspector/usage flow. The original Hermes worker's focused progressive-schema test also passed with the pinned Python runtime.
- The broad local run was not green: 2,826 passed, 218 failed and 45 skipped. An unchanged six-file baseline reproduced 24 failure entries, including the two early Service failures and the skill catalog group. The other results have not all been classified. This is not Windows CI evidence.
- The paired benchmark is synthetic: it measures serialized schema bytes and cache read counts, not live provider tokens, latency or answer quality. There was no authorized live-provider verification in this checkpoint.
- See [the PARTIAL verification receipt](M04-verification.json) and its linked evidence. No outside reviewer acceptance or release readiness is claimed.
