# Conditional main109 Research host audit

## Disposition

No concrete owning dependency in the reviewed Research retirement delta invalidates current C4 M15/M05 source authority or requires accepting main109. Accepted base remains `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`. Observed main `109797cb195b842d44dfc05dafaa6100531396df` is **not accepted or adopted**. The parent separately adopted four UX files from branch eeda. The held final28 host plan remains unchanged. Current `tests/research-service-integration.test.ts` still matches b4aa exactly.

This is a read-only source review. No tests, builds, browser jobs, merge, source edits or index mutations were performed. Exact immutable blob IDs, SHA-256 hashes, sizes and local comparison-source hashes are in `audit.json`.

## Reviewed changes and ownership

The complete changed Research contract, capture helper, repository and fixture files, the complete old/new Service integration tests, all three deleted test files, and the relevant complete Service diff were read. Current Service construction, M15 module projection, accepted-input commit/rollback, M05 access fence and native-file imports were compared. An immutable reference search found no remaining removed Research API use under packages/apps/tests at109.

At109, `packages/contracts/research.ts` removes capture/document-write command schemas and `ResearchProvider.command`, keeping exact revision/hash/range read contracts. `packages/research/repository.ts` removes command/fileReference and writer/provider paths. Its retained source/document/passage/list paths keep current personal/thread/project authorization, exact stored material hash/length checks, bounded UTF-8 passages and file-grant digest checks. There is no deletion or migration of retained Research rows in this delta.

`packages/core/service.ts` rejects every `research.*` command before `Store.receipt`, preventing old write receipts from making a retired command appear accepted. It removes only Research-specific browser options, capture pending/abort tracking and disposal. The shared file-access implementation, ProjectMemory implementation, contracts/index and server entry file are unchanged across b4aa..109.

Current M15 imports `readBoundFile`/`withResourceGrant` from core/file-access, not Research capture. Current M05 uses its own ProjectMemory access/read/assertAccess and the Service-supplied metadata-only SourceWorkbench callback. Research's removed native capture helper therefore supplies no present M15/M05 authority. Current M15/M04 first-account witness, claim/admission rollback, source identity and queued lifecycle remain separate. No new module or generic source adapter is justified by retained Research reads.

## Requirements only if main109 is accepted later

Preserve the incoming UNKNOWN_COMMAND check before duplicate receipt replay. Remove only Research-specific provider/import/abort paths, while retaining the current SourceWorkbench host readers, effective requestContextEnabled callback, synchronous first-account witness, M04 rollback and queued input behavior. Keep legacy Research reads owner checked; do not restore retired writers to satisfy old tests or convert retained Research material into a new M15 capture capability.

After such an adoption, typecheck and explicitly execute the replacement Research Service integration suite, alongside the then-current source/memory/host gates. This is conditional future validation, not an instruction to change the accepted base or current28 selection. Current native37 does not name that Research file; unfiltered full-repository shards are separate.

## Coverage change is confined to the unaccepted incoming delta

At b4aa, the deleted artifact/capture/review-regressions files declare10,9,4 cases, respectively. The old Service integration suite declares4 cases;109 replaces it with2. These are static declaration counts, not execution counts. Current C4 has not deleted these23 cases or replaced its Service suite.

The two incoming cases use real Store/Service and scripted runtime: retired capture/bookmark/save rejection, sequence/no-record checks, refusal to replay an old receipt, HTTP retired route denial; then read-only seeded legacy material after Store reopen, exact passage/document bytes, no read writes, wrong-thread denial, malformed cursor denial, stale revision, material corruption and changed file-grant denial. The latter seeds retained file metadata; it does not exercise native file capture.

The incoming suite does not retain all prior capture/CAS/browser-provider, shutdown/update freeze, input-size, UTF-8-boundary, Company/delegate, paging and high-citation verification assertions. Many are tied to intentionally removed execution. Unchanged retained-read code does not turn those absent assertions into executed coverage. No native capture, Windows, browser or latest-main runtime pass is claimed.
