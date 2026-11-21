# Plan: Layout resilience at UI zoom and OS text scaling (issue #589)

## META

- Feature title: Verify and fix layout resilience at 110–200% UI zoom and elevated OS text scale
- Repo: `skytuhua-org/Gen-V1`
- Plan revision: 1 — 2026-11-21
- Baseline branch + SHA: `main @ e883ac0327c834120d89c3697dec7380a342ba4d`
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/589
- Current implementation status: plan only — no app code has been written
- Source provenance: issue body, repo survey of `apps/web/src` stylesheets and layout modules on the baseline SHA

## OBJECTIVE

The workspace must remain fully usable when the browser/UI zoom is 110–200% and when the OS text scale is elevated (equivalent to a 200% font-only increase, the WCAG 1.4.4 bar). The audit must find and the fixes must eliminate: clipped controls, truncated labels that lose meaning, overlapping dock panels, and unusable composer/settings surfaces.

Measurable success: at every zoom/text-scale combination in the acceptance matrix, every surface in the audit matrix passes with zero critical failures; every fixed-pixel assumption found is either corrected or filed as a scoped follow-up issue.

## REQUIREMENTS

### In scope

- Browser zoom at 110%, 125%, 150%, 175%, 200% on a 1280×800 viewport (Chrome and the desktop shell viewport).
- OS text scale elevated, simulated with Chrome DevTools rendering flag or by setting `font-size: 200%` on `<html>`; all `px` text must still respect it via `rem`-relative behavior where text size is inherited. (The app sets `font-size` in `px` on many elements — see DESIGN.)
- Surfaces: sidebar/thread list, workspace header, conversation scroll + messages, composer, composer toolbar/footer, side chat, dock panels (`.ui-tool-dock`, `.desktop-browser-dock`, `.workspace-tools`), floating windows, Settings (full `Settings.tsx` and `CompactSettings.tsx`), Artifact/document preview, All Agents inbox.
- Fixes to the fixed-pixel and fixed-viewport assumptions found by the audit, in the same PR per task T03.
- A per-surface results table posted as an issue comment (PASS/FAIL per surface × zoom level) plus screenshot evidence for failures.

### Out of scope

- Changes to the canvas zoom engine (`canvasZoomAt`/`clampZoom` in `workspace-canvas-layout.ts`, which clamps content zoom to 40–200%) except bugs it causes in chrome layout.
- Non-Latin scripts, RTL, high-contrast themes, screen readers.
- Mobile/touch layout below the 700px breakpoint except where zoom forces the breakpoint.

### Decided design rules (the implementer applies these verbatim)

1. **No new fixed `px` for text-bearing layout.** Where the audit finds `font-size` in `px` on text content, change to the `rem` equivalent (`1px` borders/strokes stay `px`). Existing type scale is 9–24px; convert as `Npx → N/16 rem` (e.g. `12px → 0.75rem`, `13px → 0.8125rem`, `14px → 0.875rem`, `11px → 0.6875rem`, `16px → 1rem`, `24px → 1.5rem`).
2. **Icon/control hit areas keep a floor, never a ceiling.** Fixed square buttons (`.send-button` 29–30px, `.attach-button` 29px, `.context-button` 24px, `.icon-button` 23px) keep `width`/`height` in `px` — they must not shrink — but their container must not clip them; add `flex:none` where missing (`.side-chat-composer .send-button` already has `flex:0 0 29px`; verify others).
3. **Text truncation rules.** Any label that may truncate gets `text-overflow:ellipsis` + `white-space:nowrap` + `overflow:hidden` + a `title` attribute (or existing tooltip) carrying the full string. Two-line clamp (`display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical`) is allowed only on message body text and artifact titles, never on controls, tabs, settings row labels, or breadcrumbs.
4. **Wrapping rules.** `.composer-footer-main` and `.workspace-header` keep `min-height` (not `height`) and gain `flex-wrap:wrap` with `row-gap:6px` so wrapped controls stack instead of overlapping. `.breadcrumb` already collapses segments under 700px — keep that behavior; at effective-width <700px caused by zoom the same collapse must trigger (it does, since media queries see effective CSS pixels).
5. **Dock overlap.** `.ui-tool-dock` uses `min-width:280px; max-width:min(720px, calc(100vw - 426px))` (`plugin-tools-dock.css:5`) and `.desktop-browser-dock` uses `flex:0 0 min(520px,45vw); min-width:280px` (`desktop.css:26`); `.workspace-tools` mirrors this via `--right-panel-width` (`shell.css:257`). Rule: when `calc(100vw - 426px)` < 280px, the dock must fall back to the existing `@media(max-width:705px)` stacked layout (grid-area `2/1`, full width) — i.e. change the magic `426px` to `280px + 16px` gap = `max-width:min(720px, calc(100vw - 296px))` is WRONG; instead leave the formula and verify the 705px breakpoint still fires under zoom. Where viewport effective width ≤705px, docks stack vertically; they must never overlay the conversation column or steal its min width below 280px.
6. **Fixed pixel assumptions to hunt.** `grep` patterns for the audit: `width:[0-9]+px`, `min-width:[0-9]+px`, `max-width:[0-9]+px`, `height:[0-9]+px`, `font-size:[0-9]+px`, `calc\([^)]*px`, and media-query breakpoints. Each hit in text-bearing chrome is judged: keep (icon/border/1px hairline), convert to `rem`, or convert to `clamp()`/`min()`.
7. **Scrolling.** Any region that can overflow (composer `.resource-strip` `max-height:128px`, `.side-chat-messages`, settings panes) must scroll (`overflow:auto`), never clip content unreachable.
8. **Motion.** No motion changes are part of this fix set. Existing tokens stay: hover/press transitions use `var(--ui-motion-hover)`/`var(--ui-motion-press)` with `var(--ui-ease-move)`; panel/window moves use `var(--ui-motion-panel-enter)` with `var(--ui-ease-enter)`/`var(--ui-ease-move)`; insert/remove/status/tab use `--ui-motion-insert`/`--ui-motion-remove`/`--ui-motion-status`/`--ui-motion-tab`. `motion-policy.ts` already honors `prefers-reduced-motion` + `data-motion`; any new `animation`/`transition` introduced by a fix must use the existing tokens and must be gated the same way — under `prefers-reduced-motion: reduce`, opacity-fade equivalents only, no transform/size animation.
9. **Colors.** Fixes use existing tokens only: `var(--surface)`, `var(--canvas)`, `var(--border)`, `var(--control-border)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--accent-ink)`, `var(--subtle)`, `var(--success)`, `var(--control-radius)`. No new colors.
10. **Spacing.** Fixes use `var(--ui-space-2)` (2px step) multiples or literal `px` matching the existing rhythm (gap 3–16px); padding on wrapped rows: `row-gap:6px`.

### Accessibility

- WCAG 1.4.4 (resize text to 200%) and 1.4.10 (reflow: no two-dimensional scroll for reading content at effective 320 CSS px width) are the acceptance bars.
- Every truncated control keeps its accessible name in full (`title` or `aria-label`).
- Keyboard focus rings must remain visible on wrapped rows.

## REPO_MAP

Verified on baseline SHA:

- `apps/web/src/styles.css` — global transitions (`:15`,`:18`), composer prediction (`:135`), 700px mobile collapse (`:350`), motion gating (`:355-375`).
- `apps/web/src/workspace-canvas-layout.ts` — canvas zoom math (`clampZoom` 0.4–2.0, `:10`), panel bounds (`:99-150`). Out of fix scope except viewport-size interactions.
- `apps/web/src/composer-entry.css`, `composer-toolbar.css` — composer rows, `min-height:29px` toolbar, fixed 29px buttons.
- `apps/web/src/side-chat.css` — side chat composer, fixed 29px send button, `min-height:80px` messages.
- `apps/web/src/plugin-tools-dock.css` — `.ui-tool-dock` min/max width + 705px stacked breakpoint (`:5`,`:15-17`).
- `apps/web/src/desktop.css:26` — `.desktop-browser-dock` fixed flex basis.
- `apps/web/src/shell.css:257` — `.workspace-tools` right-panel width via `--right-panel-width`, `max-width:min(720px,calc(100% - 426px))`.
- `apps/web/src/appearance.css` — settings/appearance tokens (`--settings-row-height`, `--control-radius`).
- `apps/web/src/motion-policy.ts` — reduced-motion policy (`full|reduced|off`).
- `apps/web/src/settings-inventory.ts` — `browser-default-zoom` setting exists (line 105) for browser preview pages only.
- `apps/web/src/Settings.tsx`, `CompactSettings.tsx`, `AppearanceSettings.tsx` — settings surfaces to audit.
- 65 CSS files under `apps/web/src/` are the audit corpus for fixed-px hunting.

Unverified (discovery, not fact): exact pixel constants inside `FloatingWindow.tsx` drag/resize code and `DocumentPreview.tsx` scroll sync (`App.tsx:330` comment mentions synchronous recheck on zoom/resize — verify it fires on browser zoom via `ResizeObserver`).

## DESIGN

Approach: audit → fix → re-verify, in one PR per task batch.

1. **Audit harness (T01):** Playwright (`playwright.config.ts` exists). For each zoom factor set `viewport` zoom via `page.evaluate(() => { document.body.style.zoom = '<factor>' })` is NOT acceptable (CSS zoom ≠ browser zoom); instead use real browser zoom: launch Chromium with a smaller device viewport is wrong too — correct method is `page.setViewportSize` fixed at 1280×800 and emulate zoom via CDP `Emulation.setPageScaleFactor`? CDP page scale is pinch-zoom, not browser zoom. **Decided method:** run the app at physical viewport `1280/z × 800/z` CSS pixels with `deviceScaleFactor=z`, which is equivalent to browser zoom z at 1280×800 (media queries and layout see effective CSS pixels). For text scale, apply `document.documentElement.style.fontSize='200%'` AND reload to catch `px` font sizes that ignore it — report which surfaces break specifically under text-scale vs zoom.
2. **Surfaces:** drive the fixture host + built UI per repo convention (`node scripts/review-host.ts` on :4317 with built widgets; Vite dev :5173 fails API writes on Linux).
3. **Fixes (T03):** apply rules 1–10 per finding. Each fix edits only the owning `.css` (or the component for a `title`/`aria-label`). One finding = one reviewable hunk.
4. **Evidence:** per-finding before/after screenshot pair at the failing zoom; the results table comments on the issue.

## EXECUTION_DAG

- **T01 Audit matrix run.** Build (`pnpm build` incl. `build:widgets`), start fixture host :4317, drive Playwright over: sidebar, workspace header, conversation/messages, composer + toolbar + footer, side chat, `.ui-tool-dock`, `.desktop-browser-dock`, `.workspace-tools`, floating windows, Settings (full + compact), Artifact/document preview, All Agents. Matrix: zoom {1.10,1.25,1.50,1.75,2.00} × text-scale {1,2}. Record PASS/FAIL + screenshot per cell-surface. Done-when: results table exists covering every surface at every zoom; text-scale-200 run done on composer, settings, dock, sidebar at minimum.
- **T02 Fixed-pixel hunt.** `rg` the corpus for the patterns in rule 6; classify each: keep/convert/rem/clamp. Output: findings list with file:line and chosen rule. Depends on nothing; can parallel T01. Done-when: every hit in text-bearing chrome classified; overlap with T01 failures reconciled.
- **T03 Implement fixes.** One hunk per finding applying rules 1–10. Depends on T01+T02. Done-when: `pnpm lint && pnpm typecheck` pass; audit matrix re-run shows 0 critical failures (a control unreachable, content overlapping, label meaningless) and ≤ tolerable minors (scrollbar present where needed, ellipsis with title).
- **T04 Report.** Post results table + links on #589, mark remaining known-minor findings as filed follow-ups if any. Depends on T03.

## VALIDATION

- `pnpm lint`, `pnpm typecheck` must pass on the fix branch.
- Playwright re-run of the full matrix after fixes; expected: every cell PASS or documented-minor.
- Manual spot check: browser zoom 200%, open composer with a long draft + attachments, open Settings → Appearance, dock a tool panel, open a floating window, send a side-chat message. Expected: no clipped send/attach buttons, no overlapping panels, labels readable or ellipsized with tooltip.
- Reduced-motion check: `prefers-reduced-motion: reduce` emulation — any new transition added by fixes must collapse to the token-gated fade, no transform animation.
- Regression: rerun at zoom 1.0 to confirm the default layout is unchanged.

## STATE

- Researched/decided: audit method, design rules 1–10, repo map above.
- Implemented: nothing.
- Verified: nothing.
- Risks: (a) `font-size` px is pervasive (65 CSS files) — the text-scale fix set may be large; keep it to text-bearing chrome, not every px in the repo; (b) `App.tsx:330` zoom/resize recheck may already cover some surfaces — verify before duplicating.
- Exact next step: T01 audit run.

## REFERENCES

- Issue: https://github.com/skytuhua-org/Gen-V1/issues/589
- `apps/web/src/plugin-tools-dock.css:5,15` — dock min/max width + stacked breakpoint
- `apps/web/src/desktop.css:26` — browser dock flex basis
- `apps/web/src/shell.css:257` — right panel width cap
- `apps/web/src/styles.css:350` — 700px collapse
- `apps/web/src/motion-policy.ts` — reduced-motion policy
- `apps/web/src/App.tsx:330` — zoom/font/resize recheck comment
- WCAG 1.4.4, 1.4.10
