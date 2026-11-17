# Independent review: source handoff recovery

No remaining actionable static defect was found in the reviewed Phase B cut or proposed browser fixture. This is a narrow source and fixture review, not full C4 acceptance or installed-desktop approval. The reviewer ran no tests and changed no repository files. Recorded execution below belongs to the root's retained receipts.

## Source identity

The six production files match Phase B manifest `d0268b597ca2008a8b4c39e9c28b5fe5d22ec90121541f17f1aca91702be8a04` and patch `2b1ad03c07dd9c0604dcf42cb52c5c56f6442ea442391235432fb28e8b282f8f`. Full base, Phase A and Phase B hashes are in the companion JSON. Journal observation is byte-identical between A and B at `a212c969a005b0658cfe03fc108d6d9573bf4f7a63cfb07698c05070984c9580`; final handoff helper `43466b7cb5c40326c704c56ae1024af07a3a88137ba09bf0c557aa89eaf947ed`.

The original 20-case fixture remains preserved at `0091b68efa2be49c10daf7d4a8d9650ba2fe08a5634826e44ddc0c369cd827df`. The two concurrency cases are appended test-only changes, final hash `a67dea903018123ba825dd63f81d49ef19de775492155f51be4bc8f0e84400bd`.

## Findings and reasoning

First reads and both CAS forms register metadata barriers before invoking their asynchronous bodies. A first CAS is visible before publishing a memory generation. These barriers do not replace journal values, owner/generation checks, atomic commit or ordinary write persistence.

Cold close requires all three exact owner keys to have completed failed recovery reads, with no successful read, acquired record or local work, followed by a successful ordinary journal flush. Successful empty recovery, source actions, writes, CAS attempts, staged records, broadcast and enumeration acquisition remove this allowance. Foreign owner metadata still rejects. Observation survives A to B to A rather than resetting on a mount change. SourceWorkbench keeps its current-owner epoch and abort checks; source Open stays readonly.

Failed source operations remain sticky. Reads, false CAS results, automatic accepted-source cleanup and older successes cannot retire a newer failure. Only explicit committed source edit/import retries opt into acknowledging earlier operations on their written keys. Ordinary failed writes retain their existing exact-generation journal flush retry.

An earlier transfer design had an ordering gap: the source guard could approve while parsing was held, then a separate transfer guard could settle after the imported CAS failed. The final recovery barrier registers before preprocessing and source handoff drains and rechecks it. DraftTransfer uses the wrapper on its actual action, with a settle-only ownerless guard and no registry recursion. The focused same-registry failure case is red under Phase A and green under Phase B.

The possible same-owner read-loop concern was investigated and did not reproduce. Both actual registry guards were invoked together against retained source/text, and again while pending hydration was held and a new source generation committed. Both passed on unchanged Phase B. The 64-inspection sentinel delegates real metadata snapshots before terminating non-progress; no time limit increased. No loop was observed and no coalescing change is justified by this evidence.

## Recorded execution

| Receipt | Source policy | Actual files | Passed | Failed | Skipped | Disposition |
|---|---|---:|---:|---:|---:|---|
| `c4-source-handoff-initial-01` | Phase A, 20 source cases plus 3 registry cases | 2 | 11 | 12 | 0 | Preserved FAIL |
| `c4-source-handoff-policy-01` | Phase B, 22 source cases plus 3 registry cases | 2 | 25 | 0 | 0 | Focused PASS |

Initial log SHA: `c66134bb95a99e050c92585600f048e4a3024d0813432995375c3148255e4d4c`. Results: `99017e4a9c4c74b211db0031c1f7e7619e440c33f7be206c4ff144e5d97af135`. Source cut: `fe8a782f2a48c0a359042c54bce38e1b2003fce00a0e639292a9e283aacad0ae`.

Phase B log SHA: `489602ab47e2987d6dc4a2f021b3fac4f698a448bb684488d8efd52413e27bf0`. Results: `95f2ef1d5178e976c5e0e46a8dbe9f74b877bb63b2151ad2db512b8d1e4b3b99`. Source cut: `4ce32ce11edfac8cfaf89728f783266e67adc17f42a9338ab9d8e48842cc53ed`. Both record local parent `082264877e3bb61e8c87f257ccd831b5c1438472` and accepted main `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`. Every reviewed production hash matches its corresponding cut; log digests were recomputed.

## Mounted component fixture

The proposed desktop spec `07f9b179504a44fc6297f4050663630dd95fd240a58fac756d5eccb9daef773d` equals the preserved base plus addition `ac488f308074e8206309232b293dc61e310de22a2fdeb7acf82f4293dbd9edbf`. Existing cases and deadlines are unchanged. No material static fixture defect was found after reading the addition, bridge, task/split fixture, DesktopProvider close callback and DraftTransfer/import paths.

The fixture holds actual File.text before the component parses its backup, reads the actual pre-key barrier, begins native-close handling through the real registry, and injects a source-key IDB put failure. It requires false close, retained input DOM, no committed text/source rows, another blocked close, then an explicit exact-bundle retry and true close. Host HTTP and the native bridge are scripted, and imported source identities confer no host authority. This browser case is **NOT_RUN** at this review.

## Limits

Focused storage and broadcast surfaces are scripted. Actual journal, owner parsing, CAS, import and registry execute, but these results do not establish real IndexedDB, full React integration, Windows or installed desktop behavior. A to B to A covers metadata and fence helper semantics. Source-action marking prevents cold classification but does not add a barrier around the entire host request when storage is healthy. Mounted import/close behavior, broader regression and exact-head target execution remain separate gates.
