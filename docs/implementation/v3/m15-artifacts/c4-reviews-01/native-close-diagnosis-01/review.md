# Native-close source diagnosis

Status: established source-attributed failure; repair design only, unimplemented and unexecuted. Active repository source and tests remain unchanged.

The retained `c4-desktop-regression-01` run remains **FAIL: 26 passed, 4 failed, 0 skipped**. The assigned case completed in 2,448 ms and returned `false` where it expected the native close acknowledgment to be `true`. The close callback itself took 71.074 ms, from trace `call@86` at 45,277.644 to 45,348.718 ms. The disabled Message composer and its recovery-failure alert were both confirmed before that callback. This is a direct behavioral failure, not an assertion deadline.

## Established call path

`ConversationWorkspace` registers its composer close guard in App.tsx:460. That guard now calls `prepareSourceJournal` (802–809). For any current thread, it calls `readSourceDraft` before its ordinary journal flush. Independently, SourceWorkbench.tsx:83–89 registers another handoff guard and makes the same unconditional source read for any owner. Fixing only the App callback leaves the provider rejection.

`readSourceDraft` calls `journalReadRecord(sourceDraftKey(owner))`. The journal checks its in-memory record and synchronous staging record, then opens IndexedDB. The fixture at desktop-surfaces.spec.ts:94 forces every `indexedDB.open` call to throw `IDB unavailable`, and rejects local journal staging writes. It performs no authoring or source selection before requesting close. Neither source guard has an owning source record to read from memory.

`prepareEditorHandoff` runs every registered guard with `Promise.allSettled` and throws a rejection afterward. DesktopProvider catches that rejection, restores its closing state and returns `false`. The trace does not expose which failing guard was selected first. Both source reads are independently sufficient to reject on the inspected code and injected storage behavior.

The common journal flush has a different contract: it drains pending persistence and retries still-current failed writes. It does not open IndexedDB when those sets are empty. Artifact state also distinguishes an untouched recovered failure from a dirty editor: its flush returns when there is no dirty state, pending action or pending save. The retained network shows only a successful ordinary `edit.end` command during close, with no source capture, send or state save.

At accepted `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`, the composer guard and `prepareWorkspace` use `journalFlush` directly. The journal, editor registry and DesktopProvider bytes are identical to that base. The added unconditional source probes are the attributable change. No new base execution was performed.

## Scope and source identity

The full test bytes in the trace match the active spec SHA `ac297e23346e5964394920bec2b17a874328f8a9d0d81b5cb61ede8e45f01ef2`. Every reviewed current source file matches frozen cut `692fe4b7bfd8bf7de881d11f2a0603e82e88ad9b7c3d55b289b506893010689a`. Exact source, receipt, raw log, JSON and trace hashes are in review.json. The recorder raw-log digest was independently recomputed.

This browser fixture uses a scripted native bridge. Its workbench endpoints return404, so it proves the unavailable/no-local-source path rather than an authenticated `enabled:false` response from Service. It does not exercise installed desktop. The three other failed assertions are root-owned alert-role migration issues.

## Repair boundary

Retain the fail-closed source path whenever a source record, local operation or pending source input is owned by this renderer. Permit the existing untouched/unrecovered composer behavior only through explicit recovery and operation evidence. A feature toggle, an undefined generation or a caught storage exception is not evidence of absence. The concrete bounded design and required tests are in proposal.md.

No product/test/deadline/skip/flag changes, staging, browser run, build or remote action were performed for this diagnosis.
