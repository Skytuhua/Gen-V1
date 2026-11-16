# M15 continuation plan

## Source custody

The 2026-11-15 conversation reported an unpublished M15 commit, but its source,
commit SHA and evidence bytes are unavailable in this session. Neither the
connected repository nor the available working directories contain the M15
branch. Those reported test counts are historical claims, not this run's proof.
Reconstruct the requested behavior in `agent/m15-v3` in a separate worktree.
The repository was transferred from `Skytuhua/Gen-V1` to
`skytuhua-org/Gen-V1`. Execution base is
`399cde39ff4ee82272c7a7700944325c44b36070`; prior session base was
`fcaa52f7fcdc9f39420118a79f9a8250ba83c563`. No previous checkout is changed.
The user's request to review, fix and open a PR authorizes publication; merge
and activation are not part of this continuation.

## Design

Use the existing host, Store command receipts, authenticated routes, shared
composer and IndexedDB journal. Selected sources are untrusted references until
the host verifies owner, revision, range and content digest. Retained immutable
source bytes remain host-owned and are reauthorized on every read and send.
Context is data, never a resource grant or approval. The finite host registry
owns `ui.sourceWorkbenchV1`, default false. Optional module controls must reflect
actual tested capabilities. Presentation cache stores no task authority.

## Sequence

1. Verify M01/M02 source contracts, merged ancestry and current tests. Record
   remaining activation/platform gates. Record setup and all failed attempts.
2. Write failing strict-union, authorization, retention and send fixtures; add
   source/draft/view contracts and host resolution through existing owner reads.
3. Add pure bounded-window and owner-fenced journal helpers with failing tests
   for delayed reads, uncertain flush, reload and source-context preservation.
4. Connect selection actions, source chips, explicit destination and evidence
   navigation to existing surfaces. Preserve single-subtree chat placement.
5. Exercise authenticated host integration, actual browser flows, performance
   fixtures, both layouts, zoom, focus, IME, offline and rollback behavior.
6. Run typecheck, complete tests and build. Independently review against every
   prompt requirement. Fix introduced defects and separate platform limitations
   from measured results. Validate evidence hashes and exact source list.
7. Publish reviewed changes and open a PR with honest readiness and remaining
   gates. Do not enable flags or merge while gates remain unmet.

## Review focus

Cross-owner and revoked grants, source changes between capture/send, retained
source access after rollback, old-owner async responses, uncertain acknowledgments,
UTF-16 ranges and surrogate pairs, hidden/clipped/forged selection roots, long
output copy/search beyond mounted rows, and module freshness/unknown outcomes.
