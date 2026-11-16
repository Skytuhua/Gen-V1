# Proposed cold-recovery handoff boundary

**Design only. No patch has been applied or executed.** The existing failed native-close case is retained as the behavioral red. New owner/recovery boundary cases must be written and run before implementing this design.

## Decision

Use one owner-bound helper for the source-specific portion of both App and SourceWorkbench handoff. It must distinguish a failed initial recovery with no locally owned work from a failed handoff of work already owned by this renderer. Keep ordinary `journalFlush`, the editor registry, DesktopProvider closing/cancellation and every current source owner/generation/acknowledgment check. Do not add a feature-flag bypass.

The exceptional permission to close is deliberately narrow: the current owner’s initial source, canonical text and pending-input recovery attempts have all settled with storage failure before any record was recovered; no local source/draft/pending mutation was attempted; there is no recovered non-null pending input; no source operation is in flight; and the ordinary journal flush succeeds. A successful empty recovery is a distinct state, not a failed initial recovery. Once this owner has successfully recovered or attempted local work, it cannot become cold again in this renderer merely because an effect remounted or its epoch changed.

All other paths use the existing fresh source read, strict logical-owner parse, canonical text composition, `agents-pending` acknowledgment and `prepareWorkbenchHandoff` conflict behavior. An unavailable journal on those paths remains a rejection. Malformed or foreign metadata must never receive the cold allowance: record acquisition succeeded before parsing failed.

## Smallest coherent implementation boundary

1. Add metadata-only per-key recovery/operation observation at the existing journal boundary. Observe `journalReadRecord`, journal writes and both compare-and-swap entry points. Register work synchronously before its first await, retain operation identity until settlement, and include direct source import CAS. Do not create another draft store or copy text/source payloads into a new active model. Preserve existing IndexedDB transactions and generation checks.
2. Expose a narrow owner handoff observation/drain for the exact source-context key, `draft:<thread>` and `agents-pending:<thread>`. Await outstanding reads and CAS operations. Return an observation revision so the helper can recheck after flushing and retry its decision if new work entered. Undefined `journalGeneration` is only one observation; it is never the permission condition.
3. Keep initial read failure distinct from any successful read, a recovered record, a pending operation and an attempted/failed mutation. A failed local mutation remains a blocking obligation until that operation is explicitly superseded by an acknowledged successful retry or intentional discard. A later unrelated read or no-op CAS cannot silently clear it; old callbacks cannot clear newer failures. Existing failed journal writes retain their current generation-specific persistence semantics.
4. Track the start of source-changing UI operations before their host or journal awaits, including first attach, refresh and delivery-mode changes. This prevents a pending first capture from appearing untouched before its first journal transaction. Bind this observation to the captured logical owner and preserve it across the provider’s active/held/epoch rerenders. Existing current-scope checks continue to decide whether an async result may update UI. Closing itself changes active/held scope, so do not make every healthy close fail merely because that presentation scope changes.
5. The source helper drains those obligations, performs ordinary flush, checks the observation revision again and takes the cold allowance only under the exact predicate above. Otherwise it runs the existing source handoff logic. Both App and provider call this helper; it must not call `prepareEditorHandoff` recursively. Their duplicate registration may remain for the narrow fix.
6. A source backup import begins before its journal CAS, while the file is read and references are resolved. DraftTransfer currently has no handoff guard for that operation. Register a settle-only guard for its already-started import so close cannot pass between the cold observation and a later source CAS. Any source write failure remains owned by the journal/source obligation logic; parsing an invalid file alone need not create an unsaved draft. Root owns the separate status-role correction in this component, so its changes must be combined deliberately.

Expected product file boundary: `journal.ts`, `workbench-recovery.ts`, `SourceWorkbench.tsx`, the narrow App import/prepareSourceJournal call site, and the pending-import hook in `DraftTransfer.tsx`. No host/Store/runtime/flag/native-guard changes. A broader journal rewrite or general UI loading-state redesign is not required.

## Required boundary cases

| Case | Required result |
| --- | --- |
| Untouched owner, source/text/pending initial reads all fail, no source actions or writes | Ordinary journal flush succeeds and close acknowledges; composer remains unrecovered/disabled until close. Existing desktop case remains unchanged. |
| Authenticated catalogue explicitly disabled, otherwise same cold state | Same result, without relying on the fixture’s404 routes. This adds genuine default-off projection coverage. |
| Source recovery is held; pending input has independently recovered | Handoff remains pending until source recovery settles, then an uncertain source input remains blocked with exact source/text retained. |
| First attachment CAS is held before transaction.oncomplete and generation is undefined | Handoff cannot acknowledge before settlement. Successful commit enters the normal retained-source path; failed commit remains blocking. |
| First source backup CAS is held, including file-read phase before any journal call | Import guard prevents early acknowledgment; the final exact owner and paired text/source records remain intact. |
| Failed source write or CAS followed by an available but empty read | Read availability cannot erase the failed local obligation. Explicit successful retry/discard is required. |
| Retained source with `agents-pending` input, disabled actions or unavailable storage | Existing acknowledgment conflict/fail-closed behavior remains. Flag changes cannot drop the obligation. |
| Text write fails with in-memory draft retained | Ordinary flush still rejects and native close returns false; the exact draft survives cancellation. |
| Foreign/malformed source record | Parse/access error propagates; never classified as cold absence. |
| A→B→A or account/epoch round trip while recovery/operation is pending | No old result can clear newer work or authorize the replacement owner; presentation closing scope alone does not discard obligations. |
| One guard fails while another save is pending | Registry still awaits all mounted guards before reporting failure. |

Use actual journal functions with the existing controllable IndexedDB boundary double for unit cases. Keep storage doubles explicitly separate from browser/installed-desktop evidence. Run the unchanged native-close browser case plus the existing real source navigation/conflict cases only after the new red boundary tests and source freeze. Do not relax deadlines, skip the unavailable-journal case or alter its expected acknowledgment.

## Limits

The retained trace establishes the unconditional-read cause. This proposal has not established runtime correctness of the new observation/drain API; no such API exists yet. In particular, first-write tracking, direct import CAS, sticky failure ownership, epoch transitions and rechecking after awaits are implementation requirements, not passing claims. The report does not attribute or fix the three separate status-role failures.
