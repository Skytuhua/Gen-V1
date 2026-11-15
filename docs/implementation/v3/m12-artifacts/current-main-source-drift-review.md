# Independent review of the current-main source-drift addendum

**The documentation and controller changes pass this scoped review. Integration with main `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42` remains BLOCKED_SOURCE_DRIFT. Overall bundle acceptance remains FAIL, implementation/platform coverage remains PARTIAL, and production approval remains false.**

This review covers only the documentation/controller follow-up relative to `d55433f2231597d0efe7515b187e237e11b7ac95`. It does not approve a combined implementation or rewrite the original sixteen-finding review. No product source, branch reference, commit or merge was changed by this reviewer.

## Source and publication identities

| Role | Exact identity |
| --- | --- |
| Accepted and tested base | `fcaa52f7fcdc9f39420118a79f9a8250ba83c563` |
| Reviewed local implementation | `d55433f2231597d0efe7515b187e237e11b7ac95` |
| Observed initial PR publication head | `dd39ce637348445c9db5740b8b05c5d3853c32af` |
| Observed target main | `5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42` |
| Retained audit ancestor | `a7fc0bc7db6ba3e9922b83932aa0aa8490a6fb54` |

An independent GitHub API read at 2026-11-15T12:58:25.581Z confirms [PR #355](https://github.com/skytuhua-org/Gen-V1/pull/355) is open and draft, with that head and base, `merged:false`, `mergeable:false`, `mergeable_state:dirty` and no automatic merge. This is a recorded observation of the initial publication, not a claim about the identity of a later documentation commit.

The accepted source-cut SHA-256 remains `8327bd5b99f29a5153504f993cc201e577543dbf43009b41cab2cf2697110384`; the source-lock digest remains `943b2c4f69146c0f864760d8557b429721eca28f3019b28666be01f201dd97b7`. All 123 source entries were independently rechecked for SHA-256, Git blob identity and byte length. The 69 changed product/test/configuration paths still match the pinned source inventory. There are no non-document changes or untracked non-document files relative to the reviewed implementation. The original checkout remains clean at the accepted base.

The original final-review JSON remains SHA-256 `964cb5afac1baff1488324c4cd47392ca5cdfd483d36ac4615f36955a8630261`; its Markdown remains `c88a88fb91128334288bf5b9708ca7bb956544766db34551f4ec982e634fe2da`. Those records close sixteen findings only for their recorded accepted cut. They are not extended to newer main.

## Exact reviewed documentation and controller bytes

| File | SHA-256 |
| --- | --- |
| `M12-build-evidence.py` | `ee08c4dc3d13e05c68ef08af70ad62b9faf6fc07332a4ce062a045b2049eaf5b` |
| `M12-verify-evidence.mts` | `9ec383d31f16c2af199f164d167ac149c79d74e36db2e9882320578560ab0aff` |
| `M12-handoff.md`, at this review | `f029f7d18b79a26c5724bfc9e284f94a61de1940f151c12ad52a707308a1443b` |
| `current-main-source-drift-check.py` | `15d533451a65297de3b3894093245d7e4caf605f7832d0b02d16e1e5b01dbe39` |
| `current-main-source-drift.json` | `8a71d35378e0f303726abd029d0a4f8f4dd132357e958e0599da05fad6966ebb` |
| `current-main-source-drift.md` | `b4c777e101e6f4a433e09ee784aee00f28e54c3018b45191a2be4ebd4f037148` |

The handoff and controller/audit-script bytes remain frozen at the reviewed hashes. The coordinator will record the actual final controller result in new command logs and regenerate canonical evidence after this review is released. Those future generated artifacts are not claimed already validated here. No final documentation commit SHA is included.

## Source mismatch and behavioral findings

The independent review verified all 54 revision/path pairs across eighteen immutable paths. The inspected Service, StartRun, request-custody, capability-registry, packaging and M12 tool-consumer code supports the seven source findings.

| Boundary | Confirmed change and acceptance consequence |
| --- | --- |
| Runtime input and tool consumers | New main adds `StartRun.requestContext`; reviewed M12 adds `programTools`, consumed by its Pi/Official runtime paths. Selecting either complete conflicting declaration or Service construction loses the other side's extension. |
| Input admission | With request custody enabled, new main prepares and claims an Outbox request context and selects one eligible input. Its finalizer requires exactly one admitted input. The reviewed batching path does not prove that new state machine. |
| Dispatch await | New main awaits `RequestContextCustody.finalize`, checks finalized custody, rechecks current run/account binding and then dispatches. Combined M12 tool selection and cancellation across this await are unvalidated. |
| Authority commitments | The request-context receipt is observed metadata with its own owner/model/generation and whole-registry commitment. It does not replace M12's six-field owner, selected complete-definition commitment or current-grant checks. |
| Lifecycle | New main releases request claims and recovers, revokes and disposes M09 agent work. M12 has distinct program/kernel cancellation, recovery and disposal obligations. Combined cleanup ordering was not tested. |
| Finite flags | New main adds `context.compilerV1` and `agents.workV1`; M12 has three separate default-false registrations. Neither entire conflicting registry is the complete combined set. |
| Finite packaging | Each side adds exact required source/runtime entries. Selecting one complete manifest discards the other's assets; combined closure is untested. |

The finalizer returns `freezeRequestValue({ ...input, prompt, requestContext: receipt })`. It spreads the input, so the review does not assert that finalization inherently discards supplied `programTools`. The confirmed problem is changed API and behavior with unverified composition, not a demonstrated runtime exploit. Five of the six originally named integration targets remain unchanged upstream from the accepted base; Service is the changed original target.

## Recorded commands and their meaning

Both commands ran from `/workspace/scratch/dbebe44a9817/m12-v3`; their exact headers and bounded outputs are retained.

| Command record | Actual exit | Supported conclusion |
| --- | ---: | --- |
| `source-02-current-main-merge-preview` | 1 | Diagnostic merge computation reports the four exact conflicts below. |
| `source-03-current-main-audit` | 0 | Immutable-source/evidence custody passed: 54 revision/path pairs, 123 unchanged reviewed source entries, actual preview exit 1. Integration disposition remains BLOCKED_SOURCE_DRIFT. |

The diagnostic command is `git merge-tree --write-tree --name-only --messages d55433f2231597d0efe7515b187e237e11b7ac95 5098bffbfbcd1725c54d8c2c8b19537e7d2cfa42`. The four conflicting paths are `packages/contracts/index.ts`, `packages/core/capability-flags.ts`, `packages/core/service.ts` and `scripts/public-source-files.json`. Its output tree `7fbcf03cd6c43fbd1d9f9c9a41e09610ac8d3557` is diagnostic output, not an accepted implementation. Merge-tree writes unreferenced Git objects while preserving branch refs, index and checked-out source; no merge or rebase was applied.

The preview log has SHA-256 `689570899c3ad51934aa1ff9203c8b003790a4e2c978d52592a66879a06309b1`. The audit log has SHA-256 `83e9afdaec65db26575f67f72d84a61de1d72c2dc4d42c720aeb926e6484b889`. The audit output explicitly sets `combinedIntegrationExecuted:false` and `productionActivationAuthorized:false`. Its success does not establish combined runtime, browser, package or lifecycle acceptance. No combined tests ran during this audit or review.

## Review corrections applied

The initial handoff incorrectly placed upstream advancement after publication and the source freeze. The upstream commit timestamp is 12:02:38 UTC, before the final source-cut capture at 12:05:53.795209 and initial API publication at 12:42:21. The corrected documentation describes post-publication discovery of an earlier advance. Discovery time is not the event time.

The initial wholly read-only description of merge-tree was also corrected. Current text explicitly acknowledges diagnostic Git-object writes and distinguishes those writes from applying a merge or changing the user worktree and refs. Neither documentation correction modifies product source or relabels an acceptance result. No documentation finding remains open in this reviewed cut.

## Controller disposition and original execution rule

The builder adds `INTEGRATION.current-main-source-compatibility` with phase status **BLOCKED**, an explicit **BLOCKED_SOURCE_DRIFT** reason, the recorded conflict/audit commands, exact audit/review artifacts and a remaining gate. It preserves the actual preview exit 1 and the separate custody-audit exit 0. The only passing case in this phase proves the accepted source cut is preserved; unexecuted combined dispatch/conflict acceptance remains NOT_RUN. The builder also requires a fresh `final-18-evidence-after-source-drift` check after the new documents exist, while retaining prior evidence.

The original accepted-base source audit retains `LOCALLY_RESOLVED_CONTRACTS_REVIEW_PENDING`. Its base, source lock and recorded outcomes are unchanged. The new main integration gate is separate and cannot be satisfied by the earlier accepted-base results or the new audit's successful exit. The unchanged verifier retains its exact source-inventory, review binding, log/artifact integrity, original-checkout and disabled-flag checks.

The original prompt expressly requires stopping an affected phase as BLOCKED_SOURCE_DRIFT when integration APIs change and forbids guessing a replacement API. The documentation-only disposition follows that rule: the mismatch is concrete and inspectable, no competing source is overwritten, and the combined phase is not claimed implemented. Resolving the four conflicts requires a separately accepted composition of both lifecycle/authority contracts and current combined tests.

The existing full unit/browser failures, unsupported bounds, unmeasured platforms and production operator approval gates remain in force. This review approves the accuracy and custody of the documentation/controller delta only. It authorizes no merge, ref update, deployment or execution activation.
