# M04/M05 owner adapter proposal

This is an unapplied two-file proposal against adopted external head `0f487aa82fba616131d7f9e547076d3a14d67f48`. The production files under `proposed/` and `production.patch` are outside the repository. The corresponding `base/` files preserve the exact input bytes. No proposed production code has been executed or typechecked.

## Observed initial failure

The authorized `c4-source-memory-initial-01` command ran the unchanged fourteen-case memory/source fixture and eight-case source composer fixture. It exited 1 with **10 passed, 12 failed, no skips**. Composer passed all eight cases. The host fixture passed default-off and absent-reader fallback, then failed three effective-M04 projections and nine M05 projection/reader/error cases.

The combined real Service/Store test failed only at its final M04 projection assertion, line 149. Earlier assertions observed one actual host dispatch with the prepared memory token and retained source, exact quoted envelopes and byte/digest segments, original capture custody, runtime-acceptance usage, and idempotent receipt/outbox retry. Its runtime adapter records dispatch and is not native/provider proof.

The source-cut verifier passed before and after the command: 2,390 files, 55,407,655 bytes, cut SHA-256 `45c8c271338bfda89e8411636d0786430ae387a204cf1187d1f2eed5f7e38141`, HEAD `0f487aa82fba616131d7f9e547076d3a14d67f48`, accepted base `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`.

| Retained initial artifact | SHA-256 |
| --- | --- |
| `docs/implementation/v3/m15-logs/c4-source-memory-initial-01.json` | `231d49c7493e1b5f6ae29d1159edbc5e4650e53c77af16cd411083d1d5ec3a08` |
| `docs/implementation/v3/m15-logs/c4-source-memory-initial-01.log` | `7a73f344926fa02de43dee467036a7760c8a2cac382f4bdc592ecf813f70cd6f` |
| `docs/implementation/v3/m15-artifacts/c4-source-memory-initial-01/results.json` | `d32c824bc50fa7d03e1182ae1abb64ee394e231499d4d048d4bcaf85d1c53481` |

## Interface and behavior

SourceWorkbench gains an optional third constructor argument, `SourceWorkbenchHostReaders`. Existing one- and two-argument callers retain their behavior. This is host composition, not a renderer command or user-configurable activation path.

`requestContextEnabled` delegates to Service's existing private method. That method remains the sole effective decision combining M05 activation, the explicit host option, and the independent M04 flag. The callback uses nullish fallback so a deliberate `false` does not turn into a raw-flag `true`. A bare SourceWorkbench without the callback retains its existing M04 flag projection.

`readMemoryModule` accepts a read-only project-bound logical owner and returns only module state, reason, href, and a mandatory synchronous `assertCurrent` function. It cannot return `UNSUPPORTED`; that state belongs to absence of an owning callback. SourceWorkbench constructs the fixed M05 title and `readOnly: true` row itself. The closure is consumed inside the host and never serialized into the evidence result.

| Owning condition | M05 projection |
| --- | --- |
| No callback | Existing `UNSUPPORTED`, existing reason, no href |
| Callback exists; owner has no project | `EMPTY`, no href, no memory getter or storage initialization |
| Authorized read has `available: false` | `DISABLED`, exact owning retained-read reason, scoped href |
| Authorized read is available; items and tombstones both empty | `EMPTY`, scoped href |
| Authorized read is available; items or tombstones exist | `AVAILABLE`, scoped href |

The Service callback uses its existing `projectMemory` instance, awaits `memory.access(projectId, threadId)`, and calls `memory.read(access)`. It does not duplicate memory activation or project-opt-in expressions. Retained review availability uses the owning view's `available` field, distinct from its project extraction/recall `enabled` setting. The only href is `/api/projects/<encoded project>/memory?threadId=<encoded thread>`, matching the existing authenticated owner reader route.

## Authority and error boundaries

SourceWorkbench captures its existing logical-owner/account/project/root/workspace stamp before the asynchronous evidence read. The owning access path checks the main-thread/project/working-copy binding and physical identity. `memory.read(access)` reasserts the deletion fence and full access digest, including account, epoch, run, model, and workspace binding.

After the reader promise resolves, SourceWorkbench calls the returned `memory.assertAccess(access)` closure immediately before its existing complete owner-stamp check. There is no await between these final checks and the returned evidence object. This retains the owning access across the callback promise boundary, rather than relying only on the earlier read check.

No new catch or error-to-state conversion exists. Changed or unauthorized scope remains `CAPABILITY_DENIED`. Missing project/root, deletion-ledger, migration, filesystem, and unexpected owning failures retain their actual thrown error. A project-bound side/delegate owner still fails the owning main-thread admission; it is not presented as empty memory.

Only metadata leaves the owning memory reader. No item text, sources, memory scope store, generic source capture, recall/preparation, review mutation, or dispatch is added. First use of the existing ProjectMemory host may perform its existing storage initialization or migration; this proposal introduces no separate writer and makes no claim that owner initialization is physically write-free. It adds no Store callback and no asynchronous work inside a Store transaction.

## Scope and validation limits

The fourteen-case fixture remains at `fe2ff72296655c5e847b6a7c1a696711a511c6bd9245e661410d9a19b81e057d`; the composer fixture remains at `126703e57581bc2de0e43a85e32c4722ea20aa8106316546cb18add5ba751da7`. Both their initial results and their prior static-review limits remain preserved. The independent fixture reviewer found no actionable authority or async-settlement defect in the ten added cases.

The proposal changes only SourceWorkbench composition/projection and the Service constructor's reader wiring. It preserves the adopted request-custody-before-SourceWorkbench construction order. Custody admission, rollback, lifetimes, queued delivery, memory checkpoints, native guards, and production capability defaults are unchanged. The initial FAIL is evidence against the base implementation, not a passing result for this proposal. Application and subsequent focused verification remain gated on the parent's release of the source freeze.
