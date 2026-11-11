# WO-6 before / after

All conversation content is synthetic. Baseline screenshots were captured from d720300 before changing the UI, at 1440 then 1024. After screenshots cover every mode at 1440/1024 and the 768 smoke width (900px high).

## Screenshots

| Width | Before | Full page | Side drawer | Pop-up |
| --- | --- | --- | --- | --- |
| 1440 | [before](before-1440.png) | [full](after-full-1440.png) | [drawer](after-drawer-1440.png) | [pop-up](after-popup-1440.png) |
| 1024 | [before](before-1024.png) | [full](after-full-1024.png) | [drawer](after-drawer-1024.png) | [pop-up](after-popup-1024.png) |
| 768 | — | [full](after-full-768.png) | [drawer](after-drawer-768.png) | [pop-up](after-popup-768.png) |

## Motion

GIFs show the before state, the interaction, and the after state. Baseline had one static layout and no corresponding transitions. Strips read left to right, top to bottom. Mode changes are sampled from the actual paused WAAPI effect every 50ms through 360ms; pointer sequences use real pointer events with rAF paints. GIFs are encoded at 20fps and 960px; strips have eight sampled frames. They demonstrate geometry/easing and are not real-time frame-rate benchmarks.

| Interaction | GIF | Frame strip |
| --- | --- | --- |
| Full → drawer | [GIF](full-to-drawer.gif) | [strip](full-to-drawer-strip.png) |
| Drawer → full | [GIF](drawer-to-full.gif) | [strip](drawer-to-full-strip.png) |
| Full → pop-up | [GIF](full-to-popup.gif) | [strip](full-to-popup-strip.png) |
| Pop-up → full | [GIF](popup-to-full.gif) | [strip](popup-to-full-strip.png) |
| Drawer → pop-up | [GIF](drawer-to-popup.gif) | [strip](drawer-to-popup-strip.png) |
| Pop-up → drawer | [GIF](popup-to-drawer.gif) | [strip](popup-to-drawer-strip.png) |
| Drawer edge resize | [GIF](resize-drawer-edge.gif) | [strip](resize-drawer-edge-strip.png) |
| Drawer corner resize | [GIF](resize-drawer-corner.gif) | [strip](resize-drawer-corner-strip.png) |
| Pop-up edge resize | [GIF](resize-popup-edge.gif) | [strip](resize-popup-edge-strip.png) |
| Pop-up corner resize | [GIF](resize-popup-corner.gif) | [strip](resize-popup-corner-strip.png) |
| Detach button | [GIF](detach-button.gif) | [strip](detach-button-strip.png) |
| Dock button | [GIF](dock-button.gif) | [strip](dock-button-strip.png) |
| Detach by header drag | [GIF](detach-header.gif) | [strip](detach-header-strip.png) |
| Drag to dock target | [GIF](dock-drag.gif) | [strip](dock-drag-strip.png) |

## Reference and review

The supplied reference was studied at 10fps across its 18.4 seconds, with a 50fps detail pass around the first layout switch. The inferred settling interval is approximately 300–400ms; implementation uses 360ms with existing `--ui-ease-enter` and no bounce. Drawer defaults to one third of the viewport, 20px gutters; pop-up defaults to 350×500 at bottom right. User resizing overrides these defaults and saves each mode independently.

[Motion review](motion-review.md) · [sampled panel geometry](motion-samples.json) · [validation](validation.md)

Reproduce: start Vite on 5490, then run `pnpm exec tsx scripts/record-chat-view-modes.ts`. The optional `--before` switch is for an untouched base checkout only. `WO6_CAPTURE_DIR` and `WO6_CAPTURE_URL` override the output folder and server. Requires local Chromium and ffmpeg.

Ctrl/⌘+Shift+L cycles full page → drawer → pop-up while chat has focus. The menu also supports arrows, Enter/Space and Escape. Move/resize buttons support arrow keys, with Shift for 32px steps (8px otherwise). Keyboard changes and reduced motion settle instantly. Sizes/positions are viewport-clamped; drag/resize Escape or pointer cancellation restores the prior state.

The resize preview transforms the live surface while the pointer is held, then commits one content reflow on release. Native Windows/Electron and physical touch-device feel checks were not available on this Linux Chromium runner.

## QA r1: drawer anchoring

A docked drawer now derives its x position from the current viewport's right edge after its size is clamped. A resized 424px drawer retains a 20px right margin throughout 1024→1440 and after reload. Detached drawers and pop-ups retain their absolute positions. All original transition, resize and docking GIFs/strips were refreshed after the fix.

| Growth and reload | GIF | Frame strip | Measured bounds |
| --- | --- | --- | --- |
| Reviewed head before r1 fix | [before](drawer-grow-before-r1.gif) | [strip](drawer-grow-before-r1-strip.png) | [samples](drawer-grow-before-r1.json) |
| After r1 fix | [after](drawer-grow-after-r1.gif) | [strip](drawer-grow-after-r1-strip.png) | [samples](drawer-grow-after-r1.json) |

Growth GIFs are 10fps on a fixed 1440px canvas; the unused portion is padded while the actual viewport changes. The final frame shows a reload at 1440px. [QA r1 validation](r1-validation.md) and [r1 review](r1-review.md) record red/green tests and full-suite limits.
