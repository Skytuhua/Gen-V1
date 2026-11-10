# Composer predictions

Status: proposed design, with an interactive preview. Product implementation and live inference are not included in this change.

## Intent and chosen approach

Suggest one plausible next **user** message inside the existing composer, using the current conversation and the user's own phrasing. Tab accepts the text as a normal draft; Enter sends it through the existing send path. An unaccepted suggestion is never a message, approval or action.

The recommended design is one separate, bounded, tool-free prediction request after an eligible assistant reply. It covers ordinary replies as well as completed tasks. It uses the thread's selected model and pinned account, so it consumes that provider's subscription quota and may have startup latency. This is a proposed implementation choice, not a claim about Codex's internal implementation.

Alternatives considered:

- An optional suggestion on the existing `task_finish` tool is smaller and avoids an additional request when that tool already occurs. It misses ordinary replies: `task_finish` means the task is complete, not simply that the assistant stopped speaking. Do not change its meaning.
- A new suggestion tool inside the main run is best-effort and can itself cause another model round-trip. Hidden response trailers complicate streaming. Neither provides a reliable no-extra-call shortcut.
- Canned phrases cannot provide the requested conversation/style prediction. Do not present them as a fallback.

## Interaction

1. The assistant's reply settles normally. There must be no active run, unanswered decision, unknown operation outcome or queued input requiring attention.
2. The active main composer in a focused, visible app window is empty and its journal recovery has finished. After 300 ms of idle time, it may request a prediction for this newly observed reply settlement. Initial snapshots, reload, reconnect or focus alone never generate a prediction for historical replies. A new conversation without a completed exchange has none.
3. One short suggestion appears in a muted text layer at the textarea's normal text position. It wraps naturally and occupies the same line box as accepted text. Show a quiet `Tab to accept · Esc to dismiss` hint. No popup, suggestion list, shimmer, typewriter effect or loading indicator.
4. Plain Tab, while the textarea is focused and empty, copies the visible candidate through the existing draft-update/journal function. Focus and caret remain in the textarea, with the caret at the end. Tab does not send.
5. Enter sends the accepted/typed draft through the existing form submission. Enter on an empty box never sends ghost text. Preserve custom send-key preferences, Shift+Enter, modifier keys, composition input and normal Tab/Shift+Tab navigation whenever no candidate can be accepted.
6. Typing, paste, voice input or a prepared-PR draft immediately takes ownership of the box and clears the candidate. First version predicts whole messages for an empty box; it does not complete partially typed text.
7. Escape dismisses the candidate for this reply. It must not also trigger the app's Escape-to-stop shortcut. It does not immediately regenerate. Starting work, switching threads/models, losing the editing surface or disabling predictions clears it too.
8. On touch devices, the hint becomes a real `Use suggestion` button. It accepts through the same path and never sends. Native Send remains available.

Retain the pinned T3/Pitus palette, current composer dimensions, model picker, account label and toolbar. Suggested text uses the same font/size/wrapping as real text, with a readable muted tone. Fade the complete suggestion in over about 120 ms; respect existing motion preferences and reduced motion. Acceptance changes text color in place without moving the composer. Use no new animation dependency.

The preview uses example conversation text and simulated local submission. It does not contact any model or send a real chat message.

## User control, style and context

Add one preference in the existing Chat settings: **Suggest my next message**, with helper text **Uses your selected model and subscription quota.** Existing profiles default off until enabled. After enabling, suggestions are automatic; no per-reply button is required.

The host builds context from the selected thread's most recent user/assistant messages: at most 12 messages, capped at 16 KiB of text, selected newest-first and restored to conversation order. User messages provide examples of language, brevity and phrasing. Do not introduce a separate style profile, embeddings, cross-thread history scan or learning service. Do not read attachments, native history files, tool activity logs or credential fields for prediction.

Ask for one concise next user message in that style, or no suggestion when uncertain. Do not invent facts, approvals or completed work. Do not propose publishing/deleting or other consequential actions unless already part of the user's stated task. Treat conversation excerpts as data, not instructions to execute.

Output is strict JSON: `{ "suggestion": "one paragraph" }` or `{ "suggestion": null }`. Accept at most 280 Unicode characters, with no control characters or line breaks. Render as text only. Invalid output produces no candidate, with no repair call or canned fallback.

## Host and runtime boundaries

- Add an authenticated, CSRF-protected `POST /api/composer-prediction`. The browser identifies the thread, latest assistant reply and chosen model; the host resolves the actual account binding and canonical conversation. Never trust a client-supplied account or transcript.
- Admit only an eligible idle, unarchived thread and an advertised model compatible with its pinned provider/account. Recheck after asynchronous generation. Bind the result to the reply ID, model, account and context version; stale results are discarded.
- Keep candidates and in-flight requests in bounded host memory. A newly settled reply creates an eligibility slot; only that transition can create it. Share identical requests across windows, with at most one prediction generation globally, no queue, and at most 32 slots with a ten-minute lifetime. A slot records eligible, pending, result or no-result state. An absent, evicted or expired slot is ineligible; an HTTP request cannot recreate it. Host restart does not restore slots or generate predictions for old replies. No new SQL table, outbox item, task message, finish record or side-conversation thread.
- Only the focused composer requests. Coalesce duplicate callers; one disappearing caller must not cancel another current caller. Cancel when there are no callers, the context becomes stale, real work starts or the host closes. A client remembers dismissal for its current reply and does not request it again. Failed/timed-out generation leaves a no-result slot, with no automatic retry. These are recent-reply/host-lifetime rules, not a durable once-ever prediction ledger.
- Start from the existing runtime factory and account/profile ownership rules, in a separate prediction session. Reserve ownership before asynchronous startup; keep it until confirmed teardown. Model work has priority. The editor remains usable during prediction cancellation; no claim that killing a local process reverses consumed quota.
- A **trusted prediction-purpose mode is required** in the runtime/provider integration. It must remove host/native tools, delegation, approvals and model-accessible filesystem tools. Owned native credential/session I/O remains necessary; this is not an OS sandbox. Empty grants plus a rejecting callback alone do not establish a tool-free model run. Never invoke ordinary `message.send`, visible `side.send`, native-history recovery or the main task's saved session to generate a prediction.
- Pi can use the installed SDK's in-memory session facility. Official adapters need separately owned prediction-session handling. Enable each provider only after tool denial, account pinning, cancellation and cleanup pass its conformance tests. Unsupported prediction mode leaves suggestions unavailable for that provider; existing chat features remain available. Do not silently change providers or add API-key billing fallback.
- Target quick warm results, but use a fifteen-second generation deadline and leave the box unchanged on timeout. A current-source signed-in OpenAI run took 11.3 seconds including cold native startup; the original five-second budget expired before its response. Any real work still cancels the optional generation immediately. Provider adapters must enforce a small output budget where supported and stop at the response boundary. Prediction usage stays separate from the main task's usage; show only measurements actually reported by the provider.

The recent audit's native pipe-error handling gaps must be fixed before enabling automatic native prediction runs. Prediction must not call history recovery, avoiding the audited history/disposal overlap. Normal lifecycle/account guards still apply.

## Frontend integration and accessibility

`App.tsx` currently owns `Composer`, journal recovery, `updateDraft`, thread migration and submission. Keep those functions as the draft authority. A small `useComposerPrediction` hook owns request/candidate state; a text overlay shares the existing textarea's metrics and scroll/wrapping. Unaccepted text never enters `value`, localStorage, IndexedDB, draft export, voice input or form submission. Once accepted, it is an ordinary durable draft and participates in existing generation checks and native handoff.

Keep the native textarea and `aria-label="Message"`. Hide duplicate visual ghost text from the accessibility tree. Announce a newly available candidate once, politely, with its text and accept/dismiss instruction; do not repeatedly announce it during snapshots. Keep the hint/use button keyboard accessible. Preserve zoom, font preferences, high contrast, dark/light themes and narrow layouts. Show no tooltip or control that requires hover.

Failure is quiet and optional. Prediction errors must not replace the composer's real send/upload error or display a provider sign-in modal. The Settings toggle and any unsupported-provider explanation are the persistent control surface.

## Acceptance evidence required for implementation

- Keyboard/browser tests: ghost is not the textarea value; Tab accepts once; Enter before acceptance sends nothing; Enter afterward uses normal sending; typing wins over late responses; Escape dismisses without triggering Stop; modifier/Shift+Tab/IME behavior and custom send shortcuts remain correct. Explicitly test IME confirmation with `keyCode===229` even when `isComposing` is false and composition-end already fired.
- Draft tests: accepted text survives reload and new-thread migration; unaccepted text is absent from journal/export; voice, PR insertion, concurrent draft updates and native handoff preserve newer user input.
- Race tests: change thread/model/account/context while pending, start/stop a real run, archive, disable predictions, duplicate windows, caller cancellation and host disposal. No stale candidate, repeated generation within an eligibility slot or early account release. Reload, host restart and slot eviction must not generate a historical prediction.
- Runtime tests: genuine tool-free mode, no main-session writes/history reads, bounded input/output, no provider fallback, safe pipe errors, timeout/startup cancellation, reported usage separation and all advertised-provider conformance.
- One batched desktop/narrow, dark/light, reduced-motion visual inspection; fix found defects together and confirm once. The interactive preview is design evidence only.
- Explicitly chosen live test accounts are needed for prediction relevance, language/style fit, latency and quota acceptance. Fixtures and successful packaging alone cannot prove those qualities.

The first implementation should add no suggestion carousel, partial-word completion, cross-thread personalization database, background polling, telemetry dashboard or new dependency.

## Design-pass verification

The independent builder/code review identified the bounded-cache deduplication contradiction and the IME confirmation edge case; both are corrected above. The local preview passed 12 behavioral/layout/contrast checks with no page errors, including Tab/Enter separation, typing, Escape, post-composition `keyCode=229`, Shift+Enter, Shift+Tab and touch acceptance. Ghost text contrast measured 5.27:1 in light and 7.52:1 in dark at the standalone preview's fallback colors. Receipt: `.harness-composer-prediction-preview-checks.json`.

These checks validate the design demonstration only. No production composer, runtime, account, preference or API code changed; no provider authentication or model inference ran. The implementation acceptance list above remains open.
