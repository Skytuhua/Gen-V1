# Source review — 2026-11-01

This review establishes the repository's first buildable source commit on `feat/generative-harness`; there was no previous `HEAD`. It includes the application, desktop shell, runtime adapters, trusted UI catalog, tests, recording tools and pinned reference images. Local credentials, task/session data, recordings, installers, raw evidence and the separately versioned review site are excluded. Existing local outputs remain intact.

## Corrections

- Signature mode changes, new strokes and unmount invalidate pending PNG decoding. A delayed upload cannot overwrite a newer mark.
- Expanded PDF previews honor Fit page without replacing the committed canvas.
- Editable document windows remain inside their owning artifact's modal scope. Pointer input, keyboard focus and Escape work independently of artifact expansion.
- Sidebar thread menus retain their intended fixed positioning instead of inheriting the generic menu's absolute placement and becoming clipped by an animated group. The correction was independently checked with real Pin/Settle clicks at desktop and narrow widths.
- Side-runtime disposal awaits adapter cleanup that has already begun after normal settlement.
- Approved effects execute through one service-wide queue, including operations from different threads or overlapping grants. Each slot revalidates operation status/approval, retains its original cancellation signal and releases on failure. Queued duplicates cannot repeat a successful effect; Stop followed by Resume cannot revive an old queued attempt.
- Conditional file replacement adds a final bounded hash check and native destination identity/hash verification on one opened handle, held through replacement. It denies in-place writes during that interval and preserves source custody. External atomic saves can still race the destination pathname: this is **not atomic compare-and-replace**. Competing editors must be paused for exact approved replacement. The service-wide queue prevents competing effects from this host.
- Markdown regression input is a standalone sanitized text fixture, rather than a private historical session snapshot.
- Ordinary performance-test runs write to their own Playwright output directory. Explicitly labelled publication still uses exclusive creation, preserving earlier dated evidence.

## Verification

Focused regressions reproduced the reported failures before their fixes. The complete unit run passed **670/670**, and TypeScript, production web build and desktop compilation passed. Independent frontend checks repeated all three original repros successfully; independent backend review accepted the bounded fixes with the atomic-save limitation retained.

The full Chromium sweep completed with 508 passes, four opt-in capture skips and nine failures. The sidebar defect and stale test assumptions were corrected; the affected-case rerun and unchanged-source confirmation each passed eight cases with two explicit generated-app policy skips. Combined coverage is **516 distinct passing browser cases and six explicit skips**. This count combines the broad sweep with the focused rerun, rather than claiming a second complete sweep. The separately run document/signature/Markdown set also passed 38/38. The three historical performance evidence files retained their original SHA-256 hashes.

The browser checks use synthetic fixtures and test-owned resources. Two positive generated-app host scenarios are explicitly skipped while the production capability is disabled; a real-host rejection/no-publication/autosave test verifies the current boundary instead. Positive renderer protocol fixtures remain separate from execution-isolation proof. Whole-page PDF review is tested through Fit page, and Plan geometry checks wait for the real resizing transition to settle.

These checks do not establish live subscription inference, physical multi-monitor behavior or a newly packaged installer. Generated-code applications remain disabled. Other subscription sign-ins, live Pi retries and installer rebuilding remain deferred.

The [existing dark video review](https://generative-harness-video-review.skytuhua.chatgpt.site) remains available. This source review does not claim to have re-recorded or republished its videos. Historical local evidence links in the README require the original workspace.
