# Native close: source recovery obligations

## Disposition

The proposed six-file policy is now applied by the parent agent and passed its recorded unit gate. This agent prepared and reviewed the proposal outside the repository, then independently read the parent-run receipts, results and current source hashes. It did not run these tests or apply the active source edits.

The original desktop failure is preserved as `c4-desktop-regression-01`. Its assigned case returned `false` from native close while the composer was untouched and its initial recovery had failed. Both App and SourceWorkbench required a new source-journal read. That read threw the fixture's `IDB unavailable` error, and the existing editor registry caused the native close callback to return `false`. This was a scripted native bridge in a real browser App, not an installed desktop test. Its workbench HTTP responses were unavailable fixture routes, so it does not establish an authenticated host-disabled result.

The change permits this one class of close only after all three owner journal reads have failed, no read has succeeded, no record has ever been acquired, and no local work has begun. It does not use a feature flag as a bypass and does not treat an absent in-memory generation as evidence that nothing exists.

## Scope and source custody

The final source files are bound in `phase-b-manifest.json`. App was rebased onto the parent's Usage correction `8d3430ff909d8ea4d5ee3de45453b15d24c1775e56bb142fda48b7b8e4a9fb2d` before the narrow handoff replacement. DraftTransfer retains the parent's alert-role correction. No host Service, contracts, native file guards, M04/M05 lifecycle, or persisted schema is changed by this close repair.

| File | Responsibility |
| --- | --- |
| `apps/web/src/journal.ts` | Observes read, write and CAS entry synchronously, before the first await. Tracks recovery outcomes, record acquisition, pending barriers, operation ordering and failures without storing another draft value. |
| `apps/web/src/workbench-recovery.ts` | Uses the exact parsed logical owner, drains relevant operations and recovery preprocessing, flushes the existing journal, applies the narrow cold allowance, and otherwise performs the original source and pending-send checks. |
| `apps/web/src/SourceWorkbench.tsx` | Calls the shared handoff helper. Marks explicit source editing before capture/refresh can reach the journal. Readonly Open does not become an editing obligation. Existing owner, abort and epoch checks remain in place. |
| `apps/web/src/App.tsx` | Calls the same shared helper from its existing close/workspace guard, retaining the surrounding journal flush and editor registry. |
| `apps/web/src/DraftTransfer.tsx` | Registers preprocessing before calling the action, including `File.text`, and retains an ordinary settle guard for transfers. |
| `apps/web/src/draft-transfer.ts` | Allows only a successful explicit atomic source-group import to acknowledge earlier failed source work. Existing import owner, generation, collision and transaction rules remain. |

The source key still contains thread, project and working-copy identity. The existing text and pending-send keys still belong to their original thread journal owners. The new observer is renderer metadata, not host source authority. It cannot authorize a capture, accept a source reference, send a message, grant filesystem access, or establish an account binding.

## Recovery and operation ordering

A first CAS can be pending before any generation appears in memory. Therefore each read, journal write, single CAS and multi-key CAS enters the observation ledger synchronously. The handoff waits on settle-only barriers, then runs the existing `journalFlush`. It checks the ledger again after that await. It also checks for a changed generation or new operation after the normal retained-source reads and acknowledgment check.

Records acquired from memory, staging, IndexedDB enumeration or broadcast are remembered. A successful empty read is remembered too. Those facts and the attempted-work bit are never reset by an owner remount or A to B to A transition. The ledger is not a second text store: canonical text and source metadata remain in the original journal, with the same IDB transactions and generation comparisons.

The cold allowance requires the source companion, canonical text and pending-send keys all to have failed recovery, with no successful read, acquired record or local attempt for any of them. An unobserved key does not qualify. Previously recovered metadata, an unresolved first read, an active first CAS, a staging replay, a pending send, or a source action before its local CAS prevents that allowance. There is no catch that converts an arbitrary storage error to an empty draft.

Ordinary draft-write persistence failures remain governed by `journalFlush`, including its exact-generation retry. A failed source CAS has no staged value to replay, so the source helper additionally preserves that failure. Automatic accepted-source cleanup cannot acknowledge it. A false CAS cannot acknowledge it. Only a successful explicit source edit/import opts into acknowledging earlier failed source operations for its written keys. Mutation ordering prevents an older success from retiring a newer failure. A later successful explicit edit does not restore the cold allowance; attempted-work and record history remain recorded.

## Import preprocessing and the registry

A settle guard in DraftTransfer alone was insufficient. `prepareEditorHandoff` invokes every guard concurrently. An owner guard could finish before file parsing reached the journal, while DraftTransfer later failed its source CAS and then fulfilled a settle-only barrier. That would let the same close attempt miss the new failure.

The final proposal registers a metadata-only recovery barrier before invoking the transfer action. This includes the time spent in `File.text` and reference loading, through completion of the import CAS. Owner handoff drains this barrier and includes its revision in the before/after check. A failed import for the same source owner is therefore visible to the source guard in that close attempt. The registry itself remains unchanged and still uses `Promise.allSettled`; no guard calls the registry recursively. Export/import functions call the existing journal flush and transactions, not the handoff drain, so the new wait has no self-dependency in the reviewed call graph.

The failed bundle is not partially published. Text and every source companion continue to commit atomically. The external backup file remains available, the error stays in the mounted transfer UI, and a new explicit import can retry. The pending transfer mechanism does not extend native close deadlines or replace existing abort/lifetime checks.

## Recorded unit evidence

The first phase exposed the observation APIs and extracted the original strict source check. It did not activate the cold policy or wire the import barrier. This let the fixture call real functions and produce behavioral failures instead of failing because an export was absent.

| Attempt | Source/test cut | Observed result |
| --- | --- | --- |
| `c4-source-handoff-initial-01` | Phase A, original 20-case test `0091b68efa2be49c10daf7d4a8d9650ba2fe08a5634826e44ddc0c369cd827df`, plus three existing editor-handoff cases | 23 total, 11 passed, 12 failed, zero skipped. |
| `c4-source-handoff-policy-01` | Original Phase B, expanded 22-case test `a67dea903018123ba825dd63f81d49ef19de775492155f51be4bc8f0e84400bd`, plus the same three editor-handoff cases | 25 total, 25 passed, zero failed or skipped. |

The original 20 cases are preserved outside the repository in the sealed proposal. The two extra cases were appended as a separate patch. No deadline was changed. The 12 first-phase failures are required helper boundary assertions, not 12 independently demonstrated native product defects. They cover cold acknowledgment, waiting for hydration/first CAS, source failure retirement, the same-close import failure, and the shared helper's journal flush.

These fixtures use the production journal, source parser, recovery helper, CAS code, importer and editor registry. Only IndexedDB, staging and broadcast boundaries are controlled. They establish ordering and data-retention behavior under those bounded schedules. They do not establish browser-engine or native-platform execution.

The source-cut JSON hashes are `fe8a782f2a48c0a359042c54bce38e1b2003fce00a0e639292a9e283aacad0ae` for the first phase and `4ce32ce11edfac8cfaf89728f783266e67adc17f42a9338ab9d8e48842cc53ed` for the policy phase. The independent readback checked all six active production hashes against the frozen Phase B and the active 22-case test against the appended fixture. Exact receipt, log, result and cut hashes are in `validation-readback-01.json` (`e6f9d082c1ad8a96200ca246a8cfefa103a1d4a0eadefa19f3bc85e7475f887a`).

## Same-owner liveness concern

Review raised a possible interaction between App and SourceWorkbench registering guards for the same owner: each helper observes pending reads, including the other helper's reads. Two bounded schedules were added before making any coalescing change. One starts both real guards with retained source/text and no pending send. The other starts both while a real recovery read is held, commits a new source generation, then releases recovery and verifies the exact new source/text and stale-generation protection.

A diagnostic sentinel delegates actual metadata snapshots unchanged for the first 64 inspections and throws after that only to prevent a pure microtask loop from starving the ordinary test timer. Both cases passed under the unchanged Phase B; the sentinel did not fire. No liveness defect was reproduced, and no coalescing change was made. This result is bounded to those schedules, not a proof of every possible interleaving.

## Remaining browser and target limits

A separate proposed real-App case is frozen in `native-close-browser-proposal-01`. It holds actual `File.text`, verifies the actual preprocessing barrier, begins native close, injects an atomic source-import failure, verifies close rejection and retained UI, then explicitly retries the exact bundle and checks that close can succeed without sending or detaching. It uses a scripted native bridge, storage fault and host HTTP, including a valid host-disabled catalogue. It is NOT_RUN at the time of this report. Its full proposed desktop spec hash is `07f9b179504a44fc6297f4050663630dd95fd240a58fac756d5eccb9daef773d`; the patch is `a9f5106e8b78f1af5efaa1218f6e7637655b1ee47631273225a39d284550df39`.

The unchanged original native-close browser case must also be rerun on the current source. Broader current-source UI/type/build gates and actual Windows/Edge execution remain the parent's separate evidence work. Historical C3 native/runtime successes do not prove this new C4 close policy. No installed-desktop result is claimed here.
