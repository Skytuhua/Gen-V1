# C4 private UI integration test proposal

This is a proposed test-only patch. It has not been applied to the active repository or executed. The active UI remains the staged C4 conflict resolution recorded separately. Apply only when the parent releases the initial prerequisite/typecheck source freeze and the two input hashes in `proposal.json` still match.

## Coverage

The added source-composer case combines prepared request identity, exact M15 source references, logical owner, source generation, delivery mode and command identity. It observes an ambiguous first dispatch, disposal and recovery, a newer draft/source selection/preview, and acknowledgment of the original retry. The later draft and source metadata must survive. The existing journal mock makes this a renderer-state test; the host integration is separate.

Four cases are added to the existing actual-App suite, giving 26 cases total without changing its 30-second test deadline or existing assertion timeouts. A typed deterministic memory fixture is installed after the generic route fixture and before navigation. Its project context has the same thread, project and working copy as the source fixture. The actual M05 HTTP client validates all returned memory envelopes and verifies pinned source bytes.

The queue case holds a memory preparation while the same owner transitions to working. Queue after current must be disabled during pending preparation and become enabled when preparation finishes. The one outbound message must retain the prepared token, exact capture and AFTER_CURRENT mode. Holding its acknowledgment proves draft/source retention before clearing. It does not prove host memory admission or runtime queue dispatch.

The read-only review case exercises Accepted, Proposals and Conflicts, including the pinned source for conflict revision 2. Configuration and every visible mutation action must remain disabled, while source reads remain usable. Escape must restore focus to the launching M15 control and then the original composer control. Authored text and source metadata must remain byte-equivalent through the review, with no memory actions or ordinary commands.

The module-state case proves the M05 launcher remains available for retained DISABLED records and an EMPTY current-owner module. It does not infer availability from a generic module flag; the fixture supplies the typed current-owner read URL.

The account-transition case distinguishes two facts. An old in-flight source request is released after the account change and its observed request failure is retained, without claiming that an aborted response reached application code. Separately, an old-account view is deliberately returned to the newly opened review. The real client must reject that delivered envelope with INVALID_RESPONSE and render no old account rows.

## Red/green discipline

The three M15 memory review cases target the new adapter and must be run before its product changes to preserve a real missing-feature red. The source/token union is already present in the staged merge. Its first execution may pass. Any counterfactual run against the original C3 composer must explicitly record the old source cut and restore the staged merge exactly; a pass on the merged cut is not an observed red or proof of host admission.

All original tests remain unchanged except for adding an optional fixture setup callback and passing their existing defaults. The snapshot-aware split fixture, native held-layout routes, activity synchronization fix, and original native-return assertions remain intact. The three new review cases do not change the ordinary M05 launcher; its existing project-memory suite remains a separate affected caller gate.
