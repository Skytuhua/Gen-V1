# C3 private App reconciliation proposal

This is a private proposal for the follow-up merge of upstream `49cd633273a3f61c14a4191a9877e99ab23ec88f`. It does not modify the active C2 checkout and is not an integration, browser, native Windows, or release result.

## Source identity

The reviewed upstream range is `138b1356495bb3a2c9b35020240513f8faa84964` to `49cd633273a3f61c14a4191a9877e99ab23ec88f`. The initial conflict comes from the parent's private merge probe tree `7c6fac6a46fbbc6b095cfba3b1a261fbb2b57856`. Alternate Git objects were read from `m15-publication/c2/mergeability-probe-01/objects`; no objects, refs, index entries, or active source were changed by this review.

| File in this directory | Role | SHA-256 |
| --- | --- | --- |
| `App.c2.tsx` | Frozen C2 App snapshot | `35c85b82775d7268a1ff7d412b2bc328b38121b6defbafd45dca2068391d862b` |
| `App.upstream49.tsx` | Exact upstream49 Git blob export | `d48f71c3f2815b0356114ec6a28984048df21e079017481a0cc01f161c84a168` |
| `App.conflict.tsx` | Exact App from the conflict tree | `2f42d8ac7e6c9b0345232613401db95cfc93cb9e0ab2824bd57ccf58cb3ffde9` |
| `App.proposed.tsx` | Proposed combined App | `9eb5a0241349cdf64c6860b63080fea3ca29c155dd1c6ffed7ccf6a6cf7e3ee4` |
| `workbench-app.proposed.spec.ts` | Proposed strengthening of one existing case | `26d7eec38adae678f8dfd7347f24ea3d5a5ff182a53b89f53c3cee7c64e30353` |

`App.c2-to-proposed.diff` contains the complete App change relative to frozen C2. `workbench-app.proposed.diff` contains only the proposed browser-case change. `upstream-App.diff` retains the upstream App delta. `prepare-proposal.py` reproduces the two proposals from the retained inputs and the frozen active browser spec.

## Conflict resolution

The App conflict has one block, at lines 1072 through 1078 of `App.conflict.tsx`. The upstream half wraps the fallback project summary in `SurfaceBoundary`. The C2 half adds `SourceWorkbenchProvider` to the following chat subtree.

The proposal takes the summary line from upstream and the provider/ChatView opening line from C2. The summary boundary closes before `DockedSummary` closes. It does not wrap the source provider, chat transcript, or composer. The provider keeps its original closing position after ChatView. The surrounding conditional `SummaryLayout` ownership and visibility expressions stay the same.

The two source-provider call sites retain their exact C2 props: thread, project and working-copy owner; thread epoch; account; active/visible; and held state. The proposal retains the exact two `SourceMessage` call sites and single `WorkbenchComposer` call site. `CanvasThread` is unchanged. These are structural source comparisons, not a substitute for observing mounted DOM identity or focus in the integrated browser run.

## Upstream behavior retained

The proposal retains all App changes in the reviewed upstream range: the new `SurfaceBoundary` import; guarded workspace panel rendering; non-thread split-view boundaries; guarded project summaries in both layouts; guarded tool-dock rendering; canonical split readiness for native return; and the working empty-transcript wording.

The native-return effect exactly matches upstream49. It waits for `convSplitState.layout` before consuming a returning main-window thread intent and calls `select(target.threadId)`. That reaches the retained C2 `prepareWorkspace` path, which prepares the source journal before editor handoff, then reaches `selectNow` and `placeSplitThread`. The proposal does not restore the old selected-ID shortcut for that path. `resolvedMainId`, workspace artifact state, artifact active-owner expressions, and held-state computation match C2.

No retired workspace surface, route, host, import, control, or browser-suite entry is restored by this App proposal. The rest of the upstream merge, including the surface-retirement deletions and the upstream `SurfaceBoundary.tsx` addition, remains necessary. The public-source allowlist conflict is parent-owned and is not included here.

## Working composer hint

Upstream's new working-composer advice appears for ordinary authored text that lacks `/btw` or `/side`. Applied without reconciliation, it would appear next to C2's valid **Queue after current** action and imply that the valid queued message must instead become a side question.

The proposal adds one exclusion to that hint:

```tsx
!(workbench?.enabled && workbench.draft?.sendMode === 'AFTER_CURRENT')
```

This is the same feature-and-mode condition that exposes the existing queue action. Ordinary working/NOW text retains the upstream hint. A valid explicit queue mode suppresses that hint. A disabled M15 feature does not advertise queue support through this change. The `send` function, side-command precedence, working-state send guard, source-context visibility flag, shared composer submission, durable command path, and queue/stop controls remain byte-identical to C2. This changes advice only; it grants no new authority.

## Proposed regression

The private spec changes only the existing case **after-current mode is explicit and queues through message.send while the task is working**. Its suite count remains 21. It attaches a captured assistant source, authors a message, marks the owner working in NOW mode, and observes the upstream `/btw` hint. It then selects **After current run**, requires the hint to be absent, and verifies that the authored text remains and no send occurred during the mode change.

The explicit queue click must produce exactly one `message.send` for `task-thread`, with the exact authored content, exact captured `sourceRefs`, and `sendMode: AFTER_CURRENT`. It must produce no `run.stop` or side-thread `thread.create`. The draft and source chip clear only after acceptance, followed by another exactly-one-send assertion. Existing deadlines, fixture readiness, the shared combobox interaction, and the rest of the suite remain intact.

This proposed case has not executed. The static parser accepted it. No browser success or failure is claimed for the proposal.

Upstream's changed desktop-surfaces regression now selects the canonical split thread explicitly, detaches it, verifies held editors are inert, switches to a second conversation, returns the original native thread, and checks its artifact edit. It does not cover an M15 capture combined with delayed source reads and split readiness. That combined native/source handoff remains an integration coverage boundary, as identified in the independent host review.

## Static review and remaining gates

`verify-proposal.mjs` produced `static-review.json`: **31 static comparisons passed**, including TSX syntax for both proposals, unchanged active C2 App/spec hashes, unchanged Composer after removing only the inserted hint, exact C2 source and handoff declarations, unchanged provider/artifact owner props, unchanged chat ancestor structure except the accepted summary child boundary, and exact upstream surface/native-return declarations.

The initial checker result is retained in `static-review-initial-checker-diagnostics.json`. Three checker diagnostics came from two nonexistent local names (`activeArtifact` and `renderRootSplitView`) and comparison of the entire SummaryLayout opening text without accounting for the accepted nested summary boundary. The checker was corrected to inspect `workspaceContext`, the actual `Artifact` props, `renderConversationView`, and normalized summary-child wrapping. No proposal source or test was changed to obtain the final static result. These diagnostic results are not behavioral red/green evidence.

The proposal still requires integration with the complete upstream tree, dependency-aware typecheck/build and UI policy checks, the affected actual-App/browser regressions, and actual target-platform evidence. C2's existing ChatView readiness failure, pre-UI full-suite failure, and native Windows/Edge limitations remain recorded in C2; this private review does not supersede them or activate M15.
