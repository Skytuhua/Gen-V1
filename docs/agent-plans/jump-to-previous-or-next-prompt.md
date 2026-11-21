# Jump to previous or next prompt

## META

- Repository: `skytuhua-org/Gen-V1`; feature size: **small**; batch 8 item 6. Revision **1**, 2026-11-21.
- Verified baseline: `main@8fa907f378127bcfc23d71b55c53625ffc43e8da`. All baseline code facts below refer to that SHA, not to unmerged work.
- Canonical coordination issue: https://github.com/skytuhua-org/Gen-V1/issues/1581. Its issue body contains this entire plan. Publication PR and immutable file URL are provided in the issue preface and publication checkpoint; they are docs artifacts, not implementation PRs.
- Status: researched and specified only; **do not implement as part of this publication**. No feature tests or visual verification have been performed by the planner.
- Provenance: agreed pitch and scope reproduced below; external motivating reports are linked in REFERENCES. All-state issue searches for prompt, jump and navigate and prompt PR screening found related work, not an existing previous/next sent-prompt navigation issue.

## OBJECTIVE

In a long conversation, a reader should reach their previous or next sent prompt without scrolling through every assistant reply and tool update. Alt+Up / Alt+Down and two small buttons beside the existing scroll indicator navigate between user prompt rows. Focus lands on the target row for assistive technology. Navigation is scoped to the visible conversation and currently rendered history, never to another panel or an unsent draft. Success means both input methods select the same target, preserve conversation state, and work with collapsed prompts and Conversation Find without stealing text-editing shortcuts.

## REQUIREMENTS

These are revision 1 decisions, not an options list.

| ID | Required behavior | Tasks / acceptance |
| --- | --- | --- |
| R1 | Alt+ArrowUp and Alt+ArrowDown navigate to previous/next sent `user` row in the active App transcript, including an active embedded App. Buttons invoke the same operation. | T01–T03 / A1–A3 |
| R2 | Choose targets relative to viewport geometry and repeated navigation intent; no wrap, no assistant/tool/artifact targets, no hidden cached thread targets. No automatic history requests. | T01–T02 / A1, A4 |
| R3 | Land focus on the row with a meaningful accessible name; smooth movement only under full motion, interruptible and owner-safe. Keep streaming tail/restoration/history anchoring correct. | T02–T03 / A2, A5, A8 |
| R4 | Preserve composer/input/contenteditable/IME behavior, sidebar Alt-arrow reordering, floating-window keyboard movement, dialogs, terminals and other panels. Registry and reference accurately describe scope. | T02–T03 / A3, A6 |
| R5 | Collapsed prompt navigation focuses its outer row without expanding it or entering inert clipped content. Find keeps query, match index/count and highlights; its explicit navigation takes precedence over pending prompt movement. | T01–T04 / A7 |
| R6 | Compact, discoverable, accessible button pair beside indicator, explicit disabled boundaries, visible target flash, light/dark/narrow/forced-colors support; animation fully specified below. | T03–T04 / A2, A4, A8 |
| R7 | Browser-local presentation only: no new API, storage, migration, network request, message mutation, telemetry of prompt text, dependencies or outline panel. Finished work must go to the front end team for review. | T02–T05 / A9 |

### Boundaries and flows

1. Focus the ordinary conversation background, prompt row, a prompt-navigation button or the scroll indicator; invoke Alt+Up to reach the nearest earlier user row. Repeat to step backward by sent prompt. Alt+Down reverses direction. At either end do nothing; do not wrap or jump to latest.
2. Click Previous prompt / Next prompt from anywhere. This is explicit navigation even if the composer previously held focus: leave the draft untouched and focus the target. Tab after arrival follows the existing document order, not a new roving-tab system.
3. To reach older unloaded prompts use the existing Load earlier messages control, then navigate again. Do not silently page, fetch or promise whole-history search. Button descriptions say “Loaded prompts only.”
4. Focus in composer text, Find phrase input, editable artifact, select, contenteditable (including inherited editable descendants), terminal, sidebar, floating-window title/control, menu or dialog is excluded from the keyboard gesture. Clickable prompt buttons remain available when the transcript itself is usable.
5. Opening Find and selecting a result may scroll or reveal a collapsed prompt. Subsequent explicit prompt navigation uses that new viewport, not the old prompt cursor. Find query/count/selection stay intact. Find's input retains ownership of Alt-arrow editing; clicking prompt controls intentionally transfers focus.

In scope: App's `.conversation-frame` ordinary and embedded transcript path only. The dedicated `CanvasThread` path has its own transcript/Find and no ChatScrollIndicator at baseline: do not add new controls or listeners there in v1. Also exclude standalone SideChat, scoped ConversationPane, branch previews, delegated readers outside App, global/workspace navigation, prompt editing/rerunning, composer history, bookmarks, outline/minimap, rebinding preferences and backend changes. Preserve all these surfaces. Compatibility with batch 7 means not breaking its disclosure behavior wherever reused; it does not expand this feature's surface scope.

## REPO_MAP

Verified baseline locations (new proposed files are explicitly identified):

| File / symbols | Current behavior and intended integration |
| --- | --- |
| `apps/web/src/App.tsx`: `App`, `messageRows`, `conversation`, `conversationMotion`, `readingPositions`, `rememberPosition`, `findScope` | Builds rows with `groupWorkActivity`; `messageRows` includes user, assistant and grouped activity. Rows carry `data-message-id` and `.message-user`, with sr-only role text, `.message-content`, Markdown and CopyButton. User rows do not yet provide a programmatic row focus target. `.conversation-scroll` contains cached/hidden thread wrappers; only the active visible wrapper may contribute targets. `historyStart` initially shows the last 100 messages, with Load earlier messages and older-page retrieval. Artifact rows can survive filtering, so derive prompts from user roles and rendered owner, not arbitrary message IDs. |
| `App.tsx`: `ChatScrollIndicator`, `ConversationFind`, `latestAvailable`, `embeddedActive`, `threadHeld` | Indicator lives beside the scroller inside `.conversation-frame`. Find uses the `conversation` ref, active/loading/held gates and `onNavigate` to clear latestAvailable. Existing global key listener handles preferences; do not add globally firing Alt arrows there. Preserve inert/held and embedded ownership gates. |
| `apps/web/src/ChatScrollIndicator.tsx`: `ChatScrollIndicator`, `ChatScrollIndicatorProps` | Owns only scrollbar metrics/pointer drag; calls controller `beginManualScroll`, `scrollTo`, `endManualScroll`. Its local `key` currently consumes ArrowUp/Down without excluding Alt modifiers: reachable conflict when indicator has focus! Prompt chord handling must precede it or this handler must explicitly yield modified arrows. Never nest new buttons inside its `role=scrollbar` node. |
| `apps/web/src/chat-scroll-indicator.css` | Left rail is 20px wide (16px below 700px), inset 8px at top/bottom; hides non-scrollable indicator. Prompt buttons must have independent visibility, not inherit `[data-scrollable=false]`. |
| `apps/web/src/conversation-scroll.ts`: `createConversationScroll`, `createHistoryAnchor`, `observeConversationExtent` | Controller uses `createSpringValue` for tail following, and immediate `scrollTo` for manual positioning; it does not expose smooth prompt navigation at baseline. `remember` interrupts unowned scrolling; `update` restores/anchors owners; `jump` follows tail. Extend this authority minimally instead of adding competing native smooth scroll. |
| `apps/web/src/motion-policy.ts`: `readMotionPolicy`, `observeMotionPolicy`; `motion-spring.ts`: `createSpringValue` | Effective motion includes OS reduced motion and app `data-motion` full/reduced/off. Reuse policy; prompt animation must cancel/settle on policy changes. |
| `apps/web/src/ConversationFind.tsx`: `jump`, `onNavigate`; `conversation-find.ts`: `conversationRanges`, `highlightConversation` | Find centers a Range using direct scrollTop at baseline, owns CSS highlights and input focus; scans loaded DOM and watches child/text/hidden/aria-hidden mutations. Coordinate explicit navigation cancellation without changing its query semantics or making focus/highlight attributes trigger rescans. |
| `apps/web/src/keyboard-bindings.ts`: `KEYBOARD_BINDINGS`, `chordFor`, `ariaKeyShortcuts`; `shell-layout.ts`: `matchesShortcut`; `KeyboardReference.tsx`: `KeyboardReference` | Registry drives reference automatically. Existing `thread-reorder-up/down` use exactly Alt+ArrowUp/Down in `sidebar-reorder.ts`; `FloatingWindow.tsx` uses Alt arrows for 2px window moves. Scope, not chord replacement, resolves conflict. No existing prompt binding. |
| `tests/keyboard-bindings.test.ts` | Checks declared handlers/chords and renders reference for platforms; new handler must read `chordFor` and declare its real path. |
| `tests/conversation-scroll.test.ts`, `tests/conversation-find.test.ts`, `tests/e2e/conversation-scroll.spec.ts` | Existing focused scroll/Find regressions; scroll browser suite mounts the controller through Vite. |
| `tests/e2e/conversation-find.spec.ts`, `conversation-find-fixture.tsx`, `conversation-find.playwright.config.ts` | Actual App with synthetic shell routes and a scoped-reader alternative. Best existing fixture for real prompt row/Find integration. Dedicated Vite fixture on port 5524. Reuse rather than inventing a parallel host mock. |
| `scripts/public-source.ts`, `scripts/public-source-files.json`, `tests/public-source.test.ts` | Explicit sorted source allowlist, runtime subset, validation on import. New packaged web modules/CSS require source and runtime entries; test and plan files source-only. |

### Related unmerged work and coordination

- Collapsed prompts: issue https://github.com/skytuhua-org/Gen-V1/issues/1534; docs PR https://github.com/skytuhua-org/Gen-V1/pull/1540 open/unmerged; implementation PR https://github.com/skytuhua-org/Gen-V1/pull/1551 open/unmerged, inspected head `1ece31a591e4a4475443f7a0a243d9f702b3a8bb`.
- PR 1551 proposes `UserPromptDisclosure.tsx`, `user-prompt-disclosure.css`, `prompt-clips.ts` (`registerPromptClip`, `promptClipBoundary`, `promptClipEntry`, `rangeClippedBy`) and `tests/user-prompt-disclosure.test.ts`. Its mounted preview keeps Markdown inert and provides callback-driven reveal for Find. These files are **not on this plan's baseline**; do not import them blindly or copy its implementation. The row outside the disclosure is the navigation focus target, so no reveal dependency is needed for prompt jumps. Coordinate overlapping App/Find/scroll edits with that owner and verify the combined branch before merge.
- Composer history issue https://github.com/skytuhua-org/Gen-V1/issues/1397 and PR https://github.com/skytuhua-org/Gen-V1/pull/1466 are separate: unsent composer editing/history is not transcript navigation. No source from those branches was needed for this plan; final integrated conflict checks remain T01 work.

## DESIGN

### Ownership, target contract and deterministic geometry

Introduce proposed `apps/web/src/prompt-navigation.ts` for pure selection and event-eligibility helpers, plus proposed `usePromptNavigation.ts` for scoped DOM ownership/lifecycle. Inputs: active owner key, active/loading/held status, exact scroller and visible thread wrapper refs, existing controller ref. Outputs: previous/next availability, one `navigate(-1|1)` operation, cancellation/reset. Keep state local, not in preferences or contracts. Derive ordered `{id, element, top}` targets from rendered user rows within the active wrapper; keep stable message IDs and original data-message-id. Filter disconnected, hidden, zero-layout and inert-owner rows. A collapsed disclosure's nested inert content does not exclude its non-inert outer row. Never query document-wide `.message-user`.

Set `data-prompt-row` on user rows only; pass an explicit visible-wrapper ref rather than depending on fragile `:not([hidden])` selectors across the whole document. Use DOM order matching messageRows, not lexicographic IDs/timestamps. No draft, tool activity or artifact-only non-user row becomes a prompt.

Selection algorithm (pure helper accepts ordered finite top coordinates in scroll-content space):

1. Define alignment line `anchor = scrollTop + 16`. Row top is `row.rect.top - scroller.rect.top - scroller.clientTop + scrollTop`. A 2 CSS px tolerance treats a row aligned to anchor as current. Invalid geometry is ignored.
2. With no valid navigation cursor, Previous selects the last top strictly less than `anchor - 2`; Next selects the first top strictly greater than `anchor + 2`. A row within tolerance is current and skipped in both directions. Thus mid-assistant viewport lands on the neighboring user prompts; mid-way through a tall user prompt, Previous returns to that prompt's beginning and Next advances. Above all prompts only Next exists; below all only Previous exists.
3. On an explicit jump, save target ID as a transient cursor. While its movement is in flight, and after landing while alignment is unchanged, subsequent jumps step by adjacent ID, not intermediate animation coordinates. This prevents repeats and supports rapid reversals. At a clamped first/last landing where 16px alignment is impossible, retain that cursor until an external scroll/layout navigation invalidates it.
4. Invalidate cursor on wheel/touch/manual indicator use, scrollbar/keyboard manual scroll, external Find navigation, owner change, hidden/inert owner, removed target, history prepend or layout geometry change. Controller-owned animation frames alone must not invalidate it. After invalidation recompute from actual viewport. Revalidate IDs/DOM at dispatch and before focus.
5. Destination is `clamp(rowTop - 16, 0, scrollHeight - clientHeight)`. No wrap, no history load; missing previous/next returns false without moving/focusing or announcing errors. Zero/one prompt and a non-overflowing transcript still have correct availability by the same rules.

Observe extent with existing `observeConversationExtent`, passive scroll notifications and ResizeObserver; coalesce measurements to one animation frame. Cache ordered row elements until owner/message membership changes; do not force layout per message per animation frame. Recompute coordinates when needed for user intent, resize, disclosure changes and settled extent. No unbounded observer accumulation; clean up on switch/unmount. Pending target removal cancels, leaves current focus if connected, otherwise focuses owning scroller with preventScroll; do not fall through to another owner.

### Scroll, focus and cancellation

Add a narrow controller operation (proposed name `navigateTo`) to `createConversationScroll`. Keep existing `scrollTo` immediate semantics for indicator drag/history/Find compatibility. Prompt operation owns one cancellable 220ms cubic-bezier(0.2, 0, 0, 1) interpolation through controller-owned writes; do not combine CSS scroll-behavior, native smooth scrolling and controller spring. Stop tail following before movement. Owned frames must be excluded from `remember` interruption just as spring writes are. Retarget a repeated command from the actual current scroll offset, not the original start; latest intent wins. Do not restore automatic tail-follow merely because a prompt is within the bottom 80px: deliberate prompt reading remains `tail:false` until normal explicit tail intent / Jump to latest. Preserve saved reading position and App's latest-message behavior.

Wheel/touch/manual scroll, Find navigation, thread switch, disposal, held/inactive owner and target removal cancel pending motion/focus callbacks. History anchoring/restoration cancels before applying its immediate position. Find should cancel prompt movement **before** its Range scroll/reveal, using a small optional pre-navigation callback if needed; baseline `onNavigate` fires after scroll and alone may be too late. Keep its existing after-navigation callback responsibilities. If collapsed-prompt PR introduces `scrollConversation`, integrate through that controller bridge instead of introducing a second authority. Find must not cause a cancelled prompt completion to reclaim focus.

Focus the row immediately after accepting an intent with `focus({preventScroll:true})`, then scroll through controller; revalidate owner first. User rows get `tabIndex={-1}`, `role="group"` and an accessible label “Your prompt N of M” (rendered user-prompt ordinal, not total server history). Preserve sr-only You and readable Markdown; avoid injecting full prompt content in the aria label. Use a shared sr-only description “Loaded prompts only. Alt+Up for previous prompt, Alt+Down for next prompt.” Row focus is outside any disclosure inert boundary. This is not a listbox or selectable option and does not mark messages selected. No live-region duplication of the entire prompt. Do not change normal Tab stops or focus automatically when streaming or updating disabled state.

Under reduced/off motion or hidden document, set the clamped destination immediately and show static focus feedback. Observe OS/app policy changes during movement and settle current accepted target immediately if still valid; owner changes cancel instead. Never leave animation frames/timeouts or stale focus after disposal. All errors caused by missing refs/layout/removed nodes are safe no-ops, not network retries or user error banners.

### Keyboard arbitration

Register `previous-prompt` / `next-prompt` in Conversation scope with `Alt+ArrowUp` / `Alt+ArrowDown`; handler path is proposed `usePromptNavigation.ts`. Use `matchesShortcut(event, chordFor(...))` and registry-generated title/keyshortcuts, not duplicate chord literals in handlers. Hint: “Focused conversation; not while editing. Loaded prompts only.” `KeyboardReference` is registry-driven: update tests and verify both rows appear automatically; do not hard-code a second table or add preference schema fields.

Use a scoped bubbling handler/ref listener shared by transcript and sibling rail, not a window capture listener. Accept only active owner, focused scroller/row/non-editable transcript descendant or this rail; reject `defaultPrevented`, `isComposing`/229, extra Ctrl/Meta/Shift modifiers, inherited contenteditable, input/textarea/select, `role=textbox`, interactive embedded widgets/editors, dialogs/popovers, terminals, sidebar and floating-window move controls. Composer and Find input are excluded even though findScope includes them. Do not intercept plain arrows/Home/End/PageUp/PageDown. Repeated keydown is supported through latest-intent retargeting.

For an eligible recognized chord, prevent default and stop propagation even at a boundary (so browser/indicator/window fallback cannot hijack it); for an excluded context do neither. ChatScrollIndicator's local key must yield Alt arrows to this owner handler. Preserve its unmodified arrow/page scrollbar operation, pointer capture, and sidebar reorder ownership. Test custom global preference chords if set to Alt arrows: when conversation owns the gesture prevent global dispatch via `defaultPrevented`/scoped arbitration; outside it existing owners win. If a global listener fails to honor prevented events, add the minimal guard rather than changing preference values. Windows desktop smoke must check OS/Electron delivery; do not claim a Linux fixture proves desktop accelerators.

### Visual design and animation specification

- Keep the existing thin left scrollbar and thumb. Add a sibling vertical two-button group at the rail's top, 8px from frame top and 4px from its left edge, with 4px gap. Each button is 28×28 CSS px, 6px radius, centered 14px lucide `ArrowUp` / `ArrowDown`, 1px `--border` outline, `--subtle` background and `--muted` icon. Reserve a 36px rail gutter so controls never overlap Markdown, Copy, Load earlier messages or selection. Start the scrollbar track 72px below frame top while pair is shown; keep 8px bottom inset and recalculate thumb metrics. On widths below 700px use the same 28px targets and 36px gutter, not 16px targets. No negative z-index or overlay on content.
- Group label “Prompt navigation”; buttons native type=button, labels “Previous prompt” and “Next prompt”, descriptions “Loaded prompts only”, title with platform-formatted chord and aria-keyshortcuts from registry. Keep buttons separate from role=scrollbar and out of drag hit testing. Hide pair for no usable owner or zero rendered prompts; otherwise show both, even when transcript does not overflow. Native disabled state for no directional target, 40% icon opacity plus unavailable cursor, no hover fill; retain border. Never move focus solely because a focused button becomes disabled; keyboard invocation lands on row first.
- Hover: icon `--text`, background `--selection-bg`, 120ms ease-out color/background transition. Focus-visible: 2px `--ui-focus-ring`, 2px offset; focus must not rely on hover. Active press: stronger selection background, no translation/scale that affects geometry. Light/dark use tokens, not hard-coded luminance.
- Accepted target gets a non-layout-changing inset outline and subtle `--selection-bg` tint on its `.message-content` for 700ms: fade in 80ms, hold 220ms, fade out 400ms, easing ease-out. Restart flash on repeated accepted target intent; never remove the row's persistent focus-visible outline during fade. Keep this separate from Find's CSS text highlights, existing data-arrival animation and Copy feedback. No class/attribute watched by Find's hidden/aria-hidden observer should toggle just for flash.
- Reduced motion: no animated scroll or flash/hover interpolation; static target outline/tint for 700ms, then remove tint. App motion off: no timed flash, persistent focus ring only. Forced colors: use system Highlight/CanvasText outlines and visible arrow shapes; do not depend on tint. At 200% zoom and 375px viewport pair must remain reachable and not cover content/composer/Find. No entrance animation, bouncing, scroll-linked flourish or auto-hiding on hover.

### Data, security, integration and rollback

No persistence or backend schema. IDs already exist; pass element refs and IDs locally, never interpolate raw IDs into unescaped selectors or HTML. No prompt content logging or aria-label excerpts. Copy message remains original content and disclosure state is not changed by navigation. Land minimal changes after coordinating PR 1551 overlap; either validate combined work after it lands or document an approved integration branch. Do not require its unmerged symbols for baseline-only builds. Rollback removes local controls/hook/registry entries and new controller operation together; no data migration or draft loss. Keep source allowlist synchronized with actual new files.

## EXECUTION_DAG

Tasks are serial where they touch shared transcript/scroll files. Only pure helper tests may be developed independently after T01's contract; no concurrent edits to App or Find. Each owner posts claims/checkpoints/releases on the canonical issue under AGENTS.md.

### T01 — Verify integration baseline and implement pure navigation decisions

- Prerequisites: read full issue/source/journal, claim T01, start from latest main and record SHA. Refresh #1534/#1551/#1397/#1466 states and owner claims; check all Alt arrow dispatch sites with `rg 'ArrowUp|ArrowDown' apps/web/src` and inspect active App/embedded gating and global handler order.
- Files/steps: add proposed `apps/web/src/prompt-navigation.ts` and `tests/prompt-navigation.test.ts`; implement ordered geometry selection, transient cursor adjacency, finite/tolerance/clamped-boundary semantics and eligibility predicates described above. Record any changed upstream symbols in a revision before proceeding, not a private assumption. Add source/runtime manifest entries as applicable.
- Inputs: visible ordered user-row metrics, anchor/current intent, owner eligibility. Outputs: target ID/index or null, previous/next availability; no DOM side effects.
- Positive/negative tests: multiple prompts and interleaved non-user rows, exact alignment ±2px, tall prompt midpoint, clamped first/last, empty/one, no wrap, repeated/reverse intent, stale/removed ID, invalid geometry, inherited editability/IME/modifier/excluded owner.
- Done when pure cases pass and current overlap strategy/owner is recorded. Handoff: T02 owner receives exact helper contract and integration baseline; no unspecified selector policy remains.

### T02 — Integrate owner-scoped movement, focus and Find cancellation

- Depends on T01. Own proposed `usePromptNavigation.ts`, App row/scroller wiring, minimal `conversation-scroll.ts` extension and optional Find pre-navigation seam. Coordinate PR 1551 before touching overlapping files.
- Steps: add active visible-wrapper ref and user focus markers/name; construct targets; implement cancellable controller-owned 220ms movement; hook scoped keyboard arbitration and cursor reset events; wire accepted intent to manual reading state and readingPositions; ensure hidden/held/embedded owners cannot dispatch. Connect Find cancellation before scroll/reveal and preserve existing onNavigate callback. Clean up every listener/observer/frame/flash callback by owner.
- Inputs: T01 decisions + existing refs/controller; outputs: one safe navigate operation and availability for T03. No button styling in this task.
- Tests: extend `tests/conversation-scroll.test.ts` for owned frames, cancellation, immediate existing scrollTo, explicit tail:false, reduced/off policy and restoration; helper eligibility tests; extend `tests/conversation-find.test.ts` only for changed pure Find behavior. Add mounted browser cases in T04 for focus and cancellation, since mocked geometry alone cannot prove them.
- Done when no stale owner can focus/scroll, Find wins over pending movement, and tests cover empty/removal/cancel paths. Handoff: T03 receives operation/state and T04 receives cancellation scenarios.

### T03 — Add rail controls, registry/reference and visual feedback

- Depends on T02. Own `ChatScrollIndicator.tsx`, `chat-scroll-indicator.css`, `keyboard-bindings.ts`, App's control props and target feedback CSS in its existing stylesheet (locate the current `.message-content` owner with rg before editing). Do not refactor unrelated styles.
- Steps: add sibling group and rail gutter/track offset per visual spec; button availability/labels/title/aria; share keyboard and click operation; make indicator key yield modified arrows; add registry entries/handler paths and hint. Preserve existing metric/drag semantics. Keep `KeyboardReference.tsx` registry-driven; change component only if necessary for the documented hint, not to duplicate rows. Add token-based focus/target states and motion/forced-colors overrides.
- Inputs: T02 availability and navigate; outputs: discoverable accessible controls with exact visuals/animation. Tests: `tests/keyboard-bindings.test.ts` reference rows/platform spelling and distinct Conversation vs Sidebar scopes; disabled and no-overflow cases in T04; preserve scrollbar unmodified keys/pointer capture.
- Done when labels/reference align with dispatch, button state has no independent selection logic and all visual tokens/states exist. Handoff to T04 for actual rendering; component compilation alone is not visual proof.

### T04 — Validate integrated behavior and capture real visual evidence

- Depends on T03 and an agreed combined collapsed-prompt baseline. Own extensions to `tests/e2e/conversation-find.spec.ts` (reuse actual App fixture/routes) and `tests/e2e/conversation-scroll.spec.ts`; add isolated new fixture/config only if existing fixtures cannot exercise a required case, documenting discovery and manifest/browser inventory updates first.
- Build synthetic 5-prompt thread with tall assistant/tool intervals, a very long collapsed user prompt containing a Find needle, a short prompt, history beyond initial 100 rows, hidden cached thread and two embedded owners. No real accounts or model calls.
- Verify keyboard/click parity, focus attributes/name and scrolling geometry, fast repeat/reversal, first/last/no wrap, empty/single/nonoverflow states, manual wheel cancellation, target deletion, owner switch/unmount while moving, held/inert/loading exclusion, streaming during reading, tail button/restoration/prepend anchor, editable/composer draft/IME exclusion, Sidebar and floating-window conflict isolation and scrollbar unmodified keys.
- On collapsed integration: jump focuses outer row, remains collapsed and Copy original string unchanged; Find counts below-cap matches, reveals only its selected prompt and keeps focus/query/index; explicit Find navigation cancels motion without later focus theft; prompt navigation after Find starts at its viewport. Do not simulate collapse solely with a CSS class and call integration complete.
- Run commands in VALIDATION, then render real changed App once per relevant state: light/dark target focus, first/last disabled, narrow/200% zoom, Find plus collapsed prompt, reduced/off motion and forced colors. Capture screenshots in Playwright `testInfo.outputPath` and a short motion sample proving intermediate positions and settling; redact nothing by using synthetic data. Perform screen-reader smoke and Windows desktop Alt-key delivery or explicitly record these as pending release gates, not passed Linux coverage.
- Done when acceptance matrix has concrete evidence or explicit blocking failures; do not approve release with essential integration checks missing. Handoff: T05 receives artifacts, command output, baseline/head SHAs and outstanding review gates.

### T05 — Send the finished work to the front end team for review

- Depends on T04. Own final documentation/evidence and implementation PR handoff only; do not implement additional UI during review packaging.
- Steps: review diff against every R/A row; run/record manifest import and docs checks for new files; update full canonical plan if decisions changed, preserve prior pinned source, link implementation PR without closing issue prematurely. Post AGENTS checkpoint with exact SHAs, changed files, commands/results, screenshots/motion evidence, pending Windows/assistive-tech checks and integration status. Send finished work explicitly to the **front end team for review**, requesting review of rail placement, focus announcement, keyboard arbitration, animations and collapsed/Find coexistence.
- Positive check: recipient can retrieve exact source and reproduce fixtures/tests. Negative check: no private-only artifacts, fake passes, unmerged dependency assumptions or unpublished requirements. Done when handoff is published; review acceptance stays HANDOFF_PENDING until team ACK. Release ownership/assignee/in-progress labels as mandated. Final recipient: front end team; no further implementation task follows this handoff task.

## VALIDATION

### Setup and commands (planned for implementation, not executed feature results)

From repository root follow `docs/getting-started.md`: Node >=24.10.0, pnpm 10.30.3, locked dependencies via `pnpm install --frozen-lockfile`, `pnpm exec playwright install chromium` plus documented Linux browser dependencies. Use synthetic local routes, not live account/model authorization. Build widgets before focused tests that import them.

```sh
pnpm build:widgets
pnpm exec vitest run tests/prompt-navigation.test.ts tests/keyboard-bindings.test.ts tests/conversation-scroll.test.ts tests/conversation-find.test.ts --maxWorkers=1
pnpm typecheck
pnpm build
pnpm exec playwright test --config tests/e2e/conversation-scroll.playwright.config.ts
pnpm exec playwright test --config tests/e2e/conversation-find.playwright.config.ts
node --import tsx -e "import('./scripts/public-source.ts')"
pnpm exec vitest run tests/public-source.test.ts --maxWorkers=1
pnpm check:docs-links
```

If collapsed work has landed, also run its actual focused test (PR 1551 proposes `tests/user-prompt-disclosure.test.ts`), using its final path discovered at T01. Preserve existing scoped reader, sidebar reorder and floating-window tests found by `rg --files tests | rg 'sidebar|floating|window'`; run the ones covering dispatch files actually changed. Record exact command/counts rather than claiming an unrun broad suite. CI queued or green on a docs PR does not verify feature behavior.

### Acceptance matrix / release gate

| ID | Observable acceptance and evidence | Requirements / task |
| --- | --- | --- |
| A1 | Pure selection tests and real App browser assertions prove viewport-relative previous/next, tolerance, repeated/reverse navigation, role filtering and hidden owner exclusion. | R1–R2 / T01–T02,T04 |
| A2 | Keyboard and each button land on identical data-message-id and focused named row; row has tabindex=-1, no added normal Tab stop; rail/target screenshots match visual spec. | R1,R3,R6 / T02–T04 |
| A3 | Keyboard reference shows both Conversation chords; composer/Find input, editable descendants, IME and extra modifiers remain native; sidebar reorder/window movement preserved, and indicator Alt vs plain arrows distinguished. Draft byte content unchanged. | R1,R4 / T02–T04 |
| A4 | Empty controls hidden; one/nonoverflow case correct; boundaries disabled/no wrap/no fetch, Load earlier still works, new rows become available without cross-thread movement. | R2,R6 / T01–T04 |
| A5 | Movement samples show intermediate values and 220ms nominal easing/settlement; wheel/Find/switch/deletion/unmount cancel safely; no disposed callback, focus theft or snap-back. | R3 / T02,T04 |
| A6 | Multiple active/embedded ownership tests dispatch once only; held/background panels/dialogs never navigate. Existing scrollbar, sidebar and global preference behaviors remain scoped. Windows smoke proves actual chord delivery. | R4 / T01–T04 |
| A7 | Actual integrated collapsed prompt stays collapsed on row jump, Find reveals/searches correctly, query/index/highlights preserved and cancellation wins; original Copy content identical. | R5 / T01–T04 |
| A8 | Reduced/off motion have no interpolated movement; focus/contrast remains clear in light/dark/forced colors and at 375px/200%; streaming, saved positions, history anchor and Jump to latest regressions pass. Assistive-tech smoke announces Your prompt N of M and reads content. | R3,R6 / T02–T04 |
| A9 | Diff contains no server/storage/schema/outline feature; new source allowlist valid, no prompt logging; complete evidence handed to front end team with ACK status recorded. | R7 / T02–T05 |

Release gate: all A1–A9 verified on implementation head, required CI/maintainer review satisfied, front end team review ACK/disposition recorded, dependency integration verified. Do not merge a docs publication as though it implements these criteria. Any failed check records exact failure, owner and next recovery step; no silent scope reduction.

## STATE

- Research/decisions: complete revision 1 against stated baseline; related collapsed code read from unmerged PR, not asserted present on main. External reports are motivation, not imported code or verified upstream reproductions.
- Implementation: not started by publisher. T01–T05 above are future implementation work, not accomplishments. Feature unit/browser/desktop/visual/assistive-technology checks: NOT_RUN.
- Publication owner: `devin-cloud-67cf23`, docs plan and source allowlist only, on dedicated plan branch. Docs PR and issue readback/check evidence appear in publication journal. No application changes authorized by this plan-publication task. Implementation owner: unassigned until explicit claim; front end review unrequested until T05.
- Risks: overlapping collapsed App/Find/controller work; existing sidebar/window Alt-arrow ownership; controller remember vs animated writes; hidden cached thread DOM; focus landing inside inert content if wrong node chosen. Design and targeted tests above address these, but runtime proof is pending.
- Next action for implementing agent after authorization: read complete issue/source/journal, claim T01, fetch latest main and related PR states, record baseline and overlap agreement, then write pure helper tests. Do not start from a synopsis or an unverified dependency branch. No publication failure or feature test outcome is implied here; final publication checkpoint is authoritative for docs PR/readback status.

## REFERENCES

- [Verified main baseline](https://github.com/skytuhua-org/Gen-V1/tree/8fa907f378127bcfc23d71b55c53625ffc43e8da), [App](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/web/src/App.tsx), [scroll authority](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/web/src/conversation-scroll.ts), [keyboard registry](https://github.com/skytuhua-org/Gen-V1/blob/8fa907f378127bcfc23d71b55c53625ffc43e8da/apps/web/src/keyboard-bindings.ts).
- [AGENTS publication and handoff contract](../../AGENTS.md), [contribution checks](../../CONTRIBUTING.md), [setup and scoped browser prerequisites](../getting-started.md).
- [Collapsed prompt canonical plan issue](https://github.com/skytuhua-org/Gen-V1/issues/1534), [proposed implementation](https://github.com/skytuhua-org/Gen-V1/pull/1551), [inspected implementation head](https://github.com/skytuhua-org/Gen-V1/tree/1ece31a591e4a4475443f7a0a243d9f702b3a8bb). Essential integration facts are reproduced in REPO_MAP; no private proposal document is required to implement this plan.
- Pitch sources: [Codex #52603](https://github.com/openai/codex/issues/52603), [Codex #33770](https://github.com/openai/codex/issues/33770), [Claude Code #70678](https://github.com/anthropics/claude-code/issues/70678), [Claude Code #107613](https://github.com/anthropics/claude-code/issues/107613). Supplied pitch: “Alt+Up / Alt+Down (and two small buttons near the scroll indicator) move the thread to your previous/next prompt in long chats.” Agreed v1: keyboard plus buttons, screen-reader row focus, collapsed prompts and Conversation Find coexistence, no outline panel. No other upstream-specific requirement is assumed.
