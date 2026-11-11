# WO-6 QA r1 review

What this change does: A docked drawer keeps its chosen size and follows the viewport's right edge on growth and reload. A detached panel keeps its saved absolute position. Expected load is one local interactive client.

Looks good. Ship the focused QA fix as a draft. Checked the shared geometry helper, every caller in ChatView (initial layout, docking, viewport observation, keyboard movement/resizing), persisted preferences, the original UI tests, and the new red/green regressions. The helper remains constant-time and preserves the existing storage validation and viewport clamps.

| Before | After | Why |
| --- | --- | --- |
| `chat-layout.ts:22` returns a docked saved absolute x | For a docked drawer, return `area.right - rect.width` after clamping | Restores the 20px right anchor without discarding the chosen size |
| Only pop-up shrink was exercised | Unit and browser growth/restore regressions; detached-position guard | Catches the reported grow/reload case and protects free floating placement |

Animation verdict: Approve the motion change. Existing 360ms transform-only, no-bounce mode transitions, pointer rAF tracking, cancellation, keyboard paths, and instant reduced-motion behavior are unchanged. Refreshed all original motion captures and inspected the paired viewport-growth strips. There is no new per-frame layout animation or additional entrance choreography.

Verdict: Ship the QA fix as a draft; keep the full-suite release gate blocked as recorded in r1-validation.md.
Not checked: native Windows/Electron and physical touch hardware. Full-project failures are explicitly reported, not claimed green.

skills: ponytail, ponytail-review, gestures, review-animations, astryx, superpowers:using-superpowers, superpowers:receiving-code-review, superpowers:systematic-debugging, superpowers:test-driven-development, superpowers:verification-before-completion, cloud-environment:cloud-environment-runtime
