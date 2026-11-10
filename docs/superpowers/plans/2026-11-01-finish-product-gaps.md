# Finish the remaining product gaps

Continue the original user requests with Ponytail: reuse current ownership,
draft, provider and UI machinery; add no new framework or dependency.

## Acceptance checklist

- [x] Refresh current source and distinguish implemented code from live acceptance.
- [x] Implement composer predictions from the existing approved design: optional
  empty-composer ghost text, Tab acceptance, normal Enter sending, durable accepted
  drafts and no automatic request for historical replies.
- [x] Verify prediction-purpose native execution: tool denial, in-memory Pi
  conversation, bounded input/output, account ownership, cancellation and cleanup.
- [x] Add per-account authentication readiness and owned desktop login completion,
  cancel/retry and supported local signout. Keep labels separate from identity.
- [x] Check authenticated identity where the native API supplies it; preserve the
  prior connection on wrong-owner Cursor reconnect. Explicitly represent SDKs that
  cannot provide verified identity; never replace that with a token fingerprint.
- [x] Exercise actual-host generated-app isolation, acknowledged state, recovery,
  same-mount interaction and responsiveness before enabling its discovery and
  execution together. Keep all existing grants, validation and watchdog limits.
- [x] Run a genuine current-Hermes task-interface creation, same-artifact
  continuation and restart/recovery using the owned selected subscription.
- [x] Inspect every provider's actual connection readiness. Successful model-list
  fixtures cannot substitute for interactive authorization or real task inference.
- [x] Resolve independent code/security review findings and freeze source.
- [x] Run appropriate unit, Python, browser, type and build checks with tracing off
  by default. Keep source and package custody checks exact.
- [x] Build one new release without replacing retained releases; verify its native
  task, restart and draft recovery. Preserve existing-install refusal and other
  installation ownership safeguards.
- [x] Publish exact completed checks and any provider/hardware/user-presence gates.

## Implementation boundaries

Prediction HTTP contract: `POST /api/composer-prediction` accepts only
`{threadId,replyId,modelId}` and returns `{suggestion,replyId,modelId}` plus optional
reported usage. Service alone creates bounded live-settlement eligibility slots.
The runtime factory uses trusted `modelOnly:true,purpose:'prediction'`; Hermes
keeps its existing independent model transport and original learning engine.

Authentication status and signout are separate from soft account removal. Secret
entry remains in native provider consoles/browser flows. A missing public identity
API is represented as unavailable, not as a verified person. Cross-account thread
migration and remote provider-token revocation need explicit supported contracts.

Keep completed helper results recoverable. Archive only when task metadata proves
completion, result availability and no pending children; otherwise retain visibility.
