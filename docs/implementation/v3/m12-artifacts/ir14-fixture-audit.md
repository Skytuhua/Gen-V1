# IR14 browser fixture audit

The M12 fixture response defect is **CORRECTED**. The original terminal rejection and new ownership/method/path boundary checks pass, and conversation-find passes. The complete affected-suite validation remains **FAIL**; remaining nonzero exits are preserved.

Source cut: `8327bd5b99f29a5153504f993cc201e577543dbf43009b41cab2cf2697110384`, verified against [M12-candidate-source-cut.json](../M12-candidate-source-cut.json). All five changed fixture files match that cut. No product parser, API, runtime, styles, or feature flags changed.

## Correction and scope

The shared `scripts/capture-ui/shell-api.ts` helper and independent copies in `terminal-excerpts.spec.ts`, `saved-drafts.spec.ts`, and `conversation-find.spec.ts` previously returned generic HTTP 200 JSON for the new endpoint. The strict production parser correctly surfaced an invalid-response alert. Each helper now returns empty programs and kernels, all availability flags false, and the required reset notice only for an exact encoded known-snapshot-thread list path using GET without a query. Unknown or malformed owner paths, trailing/nested paths, and query variants return 404; writes to a known list return 405 with `Allow: GET`. The existing synthetic 503 branch stays ahead of these routes.

`wo5-app-integration.spec.ts` admits only those exact GET paths before its unchanged unknown-API recording and abort branch. Shared-helper consumers are `scripts/capture-ui/index.ts`, `wo5-app-integration.spec.ts`, and the actual-App paths in `redundant-ui.spec.ts`. The capture workflow was inspected; the browser suites below exercised the affected App fixtures. `frontend.spec.ts` remains unchanged because its existing 404 response already follows the panel's explicit unavailable branch.

## Recorded checks

Every rerun used `pnpm test:browser -- --suite <name>` with its existing browser configuration. No assertion, timeout, retry, or browser channel was weakened.

| Suite | Result | Exit | Expected | Unexpected | Skipped | Recorder ID |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| terminal-excerpts | PASS | 0 | 10 | 0 | 0 | `fixture-02-terminal-program-response-green` |
| saved-drafts | FAIL | 1 | 0 | 26 | 0 | `fixture-03-saved-drafts` |
| conversation-find | PASS | 0 | 10 | 0 | 0 | `fixture-04-conversation-find` |
| wo5-app-integration | FAIL | 1 | 1 | 8 | 0 | `fixture-05-wo5-app-integration` |
| redundant-ui | FAIL | 1 | 12 | 6 | 0 | `fixture-06-redundant-ui` |

Before the route edits, `fixture-01-terminal-program-response-red` recorded 7 expected and 3 unexpected cases: the original two-alert rejection, the new endpoint boundary case, and an animation-count assertion. The post-fix terminal suite passes all 10. The animation assertion also passed on rerun; no separate causal attribution is claimed. Exact terminal raw reports are preserved in [browser-fixture-terminal-red.json](browser-fixture-terminal-red.json) and [browser-fixture-terminal-green.json](browser-fixture-terminal-green.json).

## Remaining failures and limits

The first saved-drafts timeout selects the exact accessible name `Drafts`, while the rendered button is `Saved drafts`. The mismatched selector is present on accepted base `fcaa52f7fcdc9f39420118a79f9a8250ba83c563`. `apps/web/src/SavedDrafts.tsx` is byte-identical to that base, SHA-256 `46ba60e7005308135084cf1cdd3b52a4eccd4e50cd3554b7aee68c8ab0ea1b81`. The first post-fix error context has no tool-program response alert. Only this observed first failure is attributed here; later failures retain their individual evidence, including the fixture server's bounded lifetime.

WO5's three unknown-API assertions now retain only `/api/projects/capture-project/checkpoints/capability`; the rejected `/tool-programs` entry is removed, and its terminal-to-composer case passes. Checkpoint, saved-draft, usage, and other assertions remain intact. No remaining failure is relabelled as a pass. Post-fix failed-case messages containing the invalid program-response alert: **0**.

The original full browser invocation remains FAIL: 80 reports, 16 passing suites, 64 failing suites; 814 expected, 1001 unexpected, and 5 skipped cases. Its long-running invocation spans source changes and is not an immutable-final-cut acceptance result. [browser-full-summary.json](browser-full-summary.json) retains that qualification. The separate final M12 Chromium 7/7 evidence and baseline comparison are unchanged.

[browser-fixture-regression.json](browser-fixture-regression.json) records every affected case and attempt, exact command/log/report paths and SHA-256 values, source hashes, original-to-rerun transitions, and bounded failure messages. No trace ZIP or screenshot was copied into these evidence artifacts.
