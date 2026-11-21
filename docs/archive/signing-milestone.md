# Signing interaction milestone

This delivery covers one document interaction. Capability expansion and the 36-run pilot remain deferred.

## Visible result

The generated card uses a 640 px frame, two equal panes, a focused PDF region, one current question, compact choices and a quiet step footer. Preview controls appear on hover or keyboard focus. The signature step focuses its declared mark area. Narrow layouts put the current question before the scrollable document.

The [supplied signing reference](../reference/signing-18.png) is tracked here. The original milestone recorded light, dark and narrow captures and the completed export from a real Pi task using a synthetic PDF. Those result captures are not tracked in this checkout. Earlier hand-authored renderer fixtures are separate from that run.

## Genuine execution

Subscription Pi (`openai/gpt-6.1-sol`) created the composition and advanced the same artifact from revision 1 to 5. Browser actions chose an email, entered a typed mark, restored both after reload and submitted the review. Local controls did not create agent messages or start a run. The durable submission resumed Pi, which prepared an exact native-approved PDF export and updated the existing artifact with its receipt.

The output's fields and SHA-256 matched the prepared operation; the original PDF was unchanged. A host restart restored the same artifact, state and completed operation before inference, with one recovery event and no repeated effect. The generation, restart and warm-up trace files were local verification artifacts and are not tracked here.

This was not a first-attempt reliability test. Two presentation repairs connected preview focus and replaced a redundant generated approval question with the existing native review. The redundant intent was cancelled before any write. The tool instructions now explain that native review already authorizes prepared operations.

## Complexity removed

- Internal commits no longer generate command IDs or persist retry receipts. UI tools without a supplied retry ID use the same atomic commit path; explicitly identified commands retain deduplication.
- Removed the unread needsReconciliation flag and flag-only writes. Recovery still depends on actual input/run status, persisted session history, operation outcomes and explicit resume.
- Successful model discovery is cached and concurrent discovery is shared. Settings can refresh explicitly; each actual Pi startup still validates subscription authentication and the selected model.
- Moved read-only artifact admission into one plain ui-admission module. Service retains transaction, revision, edit-lease and cancellation authority. No new framework or routing layer was added.

## Verification and limits

At this historical checkpoint, 171/171 unit tests, 72 browser checks with two opt-in capture skips, whole-tree typecheck and production build passed. The final independent review returned GO for the repaired single signing-flow milestone, with no material correctness or security findings in the named changed boundaries. It assessed the desktop visual result as ready to ship, subject to replacing one narrow capture taken during PDF loading. That capture has been replaced after asserting a loaded canvas, settled PDF status and saved state. The original review record is not tracked here. See [acceptance.md](../acceptance.md) for verification guidance.

User visual assessment remains open. Generated-code creation and mounting remain disabled. Novel categories, fresh-run reliability measurement, the full pilot and broader fault-recovery evaluation are later milestones. Visual marks are not certificate signatures; OCR and email delivery are not included.
