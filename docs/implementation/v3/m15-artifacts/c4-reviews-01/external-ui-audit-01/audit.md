# External UI union audit

## Immutable inputs and limits

The external input is `0f487aa82fba616131d7f9e547076d3a14d67f48`, tree `4eda96307edd16e63c4e32c3c3a9d718b117a703`. It descends from published C3 `3f68a8f1bc1ca5a588862571d905163861e94492` and contains the parallel UI work, the M05 merge and later evidence updates. This is an inspected external input, not a newly accepted or tested source cut.

The local input is the frozen C4 merge with HEAD `3f68a8f1bc1ca5a588862571d905163861e94492`, MERGE_HEAD `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`, the staged UI union and the newly authorized 26-case App/eight-case source-composer tests. This audit made no active source/index edits and ran no tests, build or browser. `audit.json` records exact external blobs and both SHA-256 values for every reviewed path. `inputs/` retains both text cuts, and `reviewed-ui.diff` retains the comparison.

No Windows CI log or artifact was inspected. The parent-reported C3 source-workbench browser failure has no cause attribution in this report.

## Findings and combined resolution

| Area | Observed difference | Required combined behavior |
| --- | --- | --- |
| Shared composer | External and local are byte-identical, SHA `cb45da090074eb8b84dec3223644c6295a220f8a2355f8424c7e2389d4bb5c23`. | Preserve the union: prepared token, source references, source owner/generation and delivery mode persist in the same pending record and replay together on uncertain retry. |
| App queue | Local additionally disables Queue after current when a new, non-retry memory preparation is blocked. | Keep this integration guard, then validate the held-preparation/working-queue case. The hook's `disabled` argument prevents inspection edits but does not itself set `blocked`; a working queue without unresolved preparation remains usable. |
| App panel opener | External restores a header toggle guarded by `!embeddedThreadId`; local lacks it. | Preserve access from pinned native thread windows, where WorkspaceControls is omitted. Avoid also rendering that header toggle in the main fallback/new-conversation branch where WorkspaceControls already renders the identically named toggle. |
| ContextInspector | Only the order of two integer height additions differs. | Either exact form is equivalent. Preserve both memory recall height and the M15 context-navigation height. |
| Split fixture | External accepts `string | Snapshot`; local accepts only Snapshot. The production reducer and strict `thread.reconcile` handling are otherwise identical. | Retain external backward compatibility, and retain the three local Snapshot callers so their initial project binding and canonical reconciliation have the actual snapshot. |
| Artifact acknowledgment | Only the helper argument differs. | Keep the local Snapshot argument. Both cuts retain canonical table readiness, the upstream initial visibility wait, and every original acknowledgment/revision assertion. |
| App and native fixture | External retains the original C3 App22/native fixture. Local adds the Snapshot arguments and the approved four memory integration cases. | Preserve C3 activity synchronization and held canonical native-return sequence, plus the approved test-only additions. The extra tests have not run. |
| Canonical ChatView tests | External changes only initial input readiness from five to 15 seconds and adds a baseline/candidate comment. | Preserve this externally authored startup policy with explicit provenance. All later geometry, DOM identity, selection, reading-position and reduced-motion assertions remain unchanged. This audit does not independently establish the comment's baseline comparison. |
| Full-result clipboard test | External normalizes only CRLF pairs to LF before its logical-line assertions. | Preserve the platform normalization and all existing prefix, suffix, 100001-line, forged-DOM rejection and offscreen-search assertions. This proves logical lines, not identical OS clipboard byte encoding. It does not diagnose the pending C3 Windows failure. |

### Concrete App branch issue

In the external App, the non-embedded ChatView header has an additional `Open workspace panel` / `Hide workspace panel` button. The main fallback body can satisfy all of these conditions simultaneously: no pinned thread, no embedded thread and no canonical split root. In that branch, WorkspaceControls already receives `panelToggle`, and its workspace switcher renders it. The restored header renders a second control with the same accessible name and state. The reviewed CSS does not hide either control in that branch. A global exact-name Playwright selector would be ambiguous there.

Pinned native thread windows are different: `!pinnedThreadId` suppresses WorkspaceControls, so the external header opener supplies a missing access point. The combined resolution should retain that opener only where the root one is absent, for example by rendering the existing `panelToggle` in the header when `pinnedThreadId && !embeddedThreadId`, while retaining the root control elsewhere. This is a source-backed rendering overlap, not a reproduced browser failure. It does not affect the canonical embedded-thread selector directly because that header guard is false for embedded children.

## Preserved parallel work

The earlier external primitive commit `0201626386db623eb8016c0650c474f3d309d4c7` described a positioned marker anchor. The final external head does not retain that older implementation. Its SourceSelectionActions, SourceWorkbench, WorkbenchPanelContent, source-workbench.css, shared Popover/Modal/controls.css, direct ChatView Escape tests, agents browser spec, browser registry and ordinary CI workflow all match the current local bytes. The existing real-element/range-rectangle placement, internal-toolbar scroll filter, native modal ownership, percentage sizing at CSS zoom, shared selects, source fences and lazy panel boundary are already shared. Do not resurrect the earlier marker implementation based on the old commit title.

The external clipboard change is traceable to `6345c886c0c950b0e40a11560f01adb958900e7a`. The external final App still contains the C3 providers, queue-aware hint, source-aware handoff and canonical native return. M05 origin binding, parent-owned right tools and conditional summary behavior are also retained. The nine file differences in the bounded comparison consist of the integration details above and the local test additions; no additional primitive replacement is required by this sync.

## Smallest required validation scopes after authorized reconciliation

1. Exercise main empty/fallback and pinned native thread opener branches, requiring exactly one reachable panel control and no new visible composer. Keep the existing canonical split pane test as a separate branch.
2. Run the complete actual-App 26 cases after the new memory adapter/readOnly feature is implemented, retaining a pre-feature red for its new launch cases. The already-correct composer union needs observed results, not a counterfactual rollback.
3. Run source-composer and shared agents-composer coverage to verify exact token/source/mode retry identity. Host admission and actual REFERENCE plus MEMORY delivery remain the independent Service suite's scope.
4. Run all six canonical/direct ChatView cases with the external startup policy, the complete 18-case renderer suite including clipboard/search, and artifact acknowledgment with the Snapshot caller. Windows clipboard behavior requires the actual Windows run.
5. Run the existing ordinary project-memory suite after adding readOnly reuse, so the existing writable caller retains its behavior. Preserve the native-return, source account and current-owner response boundaries already encoded in the new tests.

Historical C3 Linux failures, the diagnostic source cut, the later activity-only corrected App pass and each actual Windows attempt remain separately attributable. None is overwritten by importing external source or by a later platform result.
