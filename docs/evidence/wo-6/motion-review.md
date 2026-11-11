# WO-6 motion review

Reference: the supplied 18.4s, 2560×1440, 50fps recording. Extracted the whole recording at 10fps, then inspected the full→drawer handoff around 5.6–6.0s at 50fps. Visible movement settles in approximately 300–400ms, with a steep initial response, a gentle tail and no overshoot. The exact source spring constants are unavailable.

Implementation: 360ms with the existing `--ui-ease-enter` (`cubic-bezier(.16,1,.3,1)`). This is an occasional layout change for spatial continuity; the explicit WO-6 300–400ms reference requirement justifies exceeding the skills' usual 300ms budget. Keyboard changes and reduced motion are instant. The header, transcript and composer move together, without staged child entrances.

| Before | After | Why |
| --- | --- | --- |
| Portal focus events replaced the remembered composer focus | Ignore focus outside the live panel; restore its last focused control | Preserve editing context, selection and keyboard continuity |
| Undefined `--bg` on the new surface | Existing `--canvas`, `--border` and `--elevation` tokens | Keep Gen-V1's opaque surfaces and visual language |
| Repeated layout glyphs in compact headers | A grip for movement and the layout glyph for the menu | Make the gesture and layout actions distinguishable |
| Finished WAAPI effects retained a reference | Cancel the completed effect and release its reference | Leave only the final inline geometry after the 360ms handoff |

**Approve.** Transform-only, interruptible FLIP reads the current visible rectangle before retargeting. Resize/drag writes transforms once per rAF with no React state update or layout-size writes per move. Resize commits one content reflow on release; the live content scales with the surface during the preview. Pointer capture, cancellation, Escape, viewport clamps, eight named keyboard resize handles, menu keyboard navigation, blocked-storage recovery, and instant reduced motion are covered by tests. This is a local browser panel; it does not create a native OS window.

Reviewed screenshots at 1440/1024 and 768; all six directed mode transitions and edge/corner resize in both floating modes have GIFs and strips. Native Windows/Electron and physical touch hardware were unavailable in this Linux Chromium environment.
