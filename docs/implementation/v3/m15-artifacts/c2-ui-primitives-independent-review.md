# C2 independent UI primitive migration review

Reviewed at 2026-11-16T01:19:47.439941+00:00. This review is read-only. It inspects the frozen source, shared primitive APIs, new regression cases, and the retained toolbar-scroll reproduction receipts. It runs no browser or test job and preserves all earlier review artifacts.

**Disposition:** the previously reported internal-toolbar scroll defect is corrected. No further material behavioral regression was found in the reviewed migration. This conclusion is limited to source inspection and the specific retained red/green evidence below; complete final gates and target-platform acceptance have their own receipts.

## Ownership, placement, and compatibility

`Popover.getAnchorRect` changes only placement geometry. The real `HTMLElement` anchor still supplies the owner document, nearest native/modal portal root, connection check, outside-interaction scope, observers, and Escape focus destination. Callers that omit the optional callback take the original `element.getBoundingClientRect()` path and retain the same effect dependencies in practice. The callback is destructured and does not leak to the DOM.

The source toolbar supplies the selected cloned range's viewport rectangle. A long source block can extend above and below the viewport without making the visible selected range unplaceable. Raw range coordinates enter the existing physical placement calculation before the existing CSS-zoom normalization. A changed selection supplies a new callback dependency, so an already-open toolbar is placed against the current range. Numerical placement equality prevents a state-update loop.

The migration keeps the original source authority checks: exact rendered text must match canonical text; selected text must map uniquely to canonical UTF-16 offsets; hidden, clipped, transformed, foreign, and ambiguous ranges are refused. Capture actions recheck the current enabled/text/visibility conditions, and the provider retains its owner/generation checks around asynchronous host work. This review does not turn DOM geometry into host authority or replace the separate host custody tests.

## Focus, IME, scrolling, and draft lifetime

The toolbar does not request initial focus, so ordinary pointer selection keeps its focus/selection context. Pointer-down still prevents selection loss. Shift+F10 explicitly enters the actions; the existing capture-phase Escape handler clears only the selection toolbar and restores the source focus. Both composition indicators and composition lifecycle guards remain. The toolbar has `tabIndex=-1`, allowing shared focus retention to keep focus inside while its actions are disabled, before the owning Modal's frame-delayed retention runs.

The corrected scroll listener ignores events whose target lies inside the toolbar. It still dismisses on source, ancestor, document/window, or non-node scroll targets and on resize. This preserves access to wrapped actions and long errors in the shared scrollable popup without preserving a stale selection when its underlying view moves.

The source panel now uses the shared native `Modal`; its former custom portal and `useModalRegion` trap are removed. Shared Modal owns the native top layer, initial close control, Tab containment, cancellation, and focus return. The existing parent-region hook already defers when a native modal is active. The shared Popover places a nested toolbar inside the native dialog, avoiding an inert body portal.

Shared Select maps delivery values through `onValueChange`. `AFTER_CURRENT` remains visibly selected but unavailable for a new choice when the feature is disabled; `NOW` remains available to clear a retained mode-only draft. The Diff selector keeps its disabled empty placeholder and complete-hunk start/end mapping. The migration does not create an unavailable native diff capability.

The provider stays outside the dialog lifetime, and the composer remains mounted. Conditional panel lifetime, owner fences, guarded dynamic import, stable content component identity, and the explicit reload-to-retry failure wording remain. Closing, loading failure, and source attachment do not implicitly send or replace authored draft text.

## Reviewed regression coverage

The new tall-source case asserts that the complete source root spans beyond both viewport edges while the range toolbar remains visible. It exercises CSS zoom 1 and 2, changed ranges while open, no unsolicited focus, Shift+F10, both IME indicators, toolbar-only Escape, exact selected offsets/text on pointer attachment, and parent modal focus return.

The narrow-toolbar case proves real overflow at a 280-pixel viewport, focuses a lower action, waits for the resulting scroll, retains the toolbar, executes the selected action, then verifies that window scrolling dismisses it. Its retained evidence is:

| Attempt | Observed outcome | Receipt SHA-256 | Log SHA-256 |
| --- | --- | --- | --- |
| `c2-ui-toolbar-scroll-red-02` | FAIL, 1 selected case; toolbar disappears after the lower action receives focus | `155eb55fecf636ceeb7791c6fb3ff4eb35384283ff987ef47ccc2a5323d247e4` | `cd08744b086967c80223ec8e3a3afdf39a46a02f459f064821eaecb69a259afc` |
| `c2-ui-toolbar-scroll-green-01` | PASS, 1 selected case after the contained-scroll filter | `60ac027c0909cf24c5ec7fc2dc18daf3188fd2b8abbd2f7aac36cbd099fe63c4` | `9f86e9f07819a1266624d2632506d1079ec85f754a6999a44c5acb3d1fa12f88` |

Both log digests were recomputed and match their receipts. The new actual-App case uses the production App, client, journal, and composer with explicitly deterministic host HTTP. It checks the real source modal, delivery control, navigation and attachment controls at CSS zoom 2, preserves the authored draft, verifies focus return, verifies the complete canonical source range, and asserts no `message.send`.

There are **21 declared App cases and 18 declared workbench cases** in the reviewed files. These are case counts, not post-migration pass counts. This review does not borrow the earlier pre-migration `c2-workbench-app-01` or `c2-workbench-browser-01` passes for these new bytes.

## Limits

The reviewed reproduction is one local browser case. Full App/workbench, shared overlay/control, policy, typecheck, and build outcomes must be read from root's final gate receipts. The workbench spec disables trace capture for its controlled renderer measurement; the scroll reproduction retains its log and failure context, not a claimed trace. CSS `zoom:2` is explicit test coverage and does not establish native browser zoom, desktop display scaling, an installed desktop/WebView, Windows native file access, or an actual IME device session. Deterministic HTTP fixtures do not replace host authorization or real Hermes integration evidence.

## Exact source identities

| Reviewed file | SHA-256 |
| --- | --- |
| `packages/ui-shell/Modal.tsx` | `3b07a74846a4c15c9e7497ee8d8d1ffee8e17ea95d089d2db68026b018cba4eb` |
| `packages/ui-shell/Popover.tsx` | `fb5c94be1a32ba8d77d0dd919fab3a2917d207cba8096e56f47622535c9b6b4a` |
| `packages/ui-shell/Select.tsx` | `de0ea16b5992e56ab96b3bc7c16a11fb304a4822dc8b6bb961c700914e6ebbbb` |
| `packages/ui-shell/focus-retention.ts` | `3b4bd0ffe9f36f79678f05678cfe0d6adc66fda12831314531c732b3f24415dc` |
| `packages/ui-shell/list-navigation.ts` | `8cdcbcde83606b791aed704c63b73152b3fa6c15303683e7ee803ddde4dc7662` |
| `packages/ui-shell/overlay-position.ts` | `5aff00ab185315278c14b58e59db4d6ac2f3400ce88e76ecd3c5e20b396d29ed` |
| `packages/ui-shell/controls.css` | `f9b0798408972e5b931a87dafb5cbfb92670d2cb0186484dfae221c0e9ff30d8` |
| `packages/ui-shell/tokens.css` | `92f4d06b982aec3104484142bb305b8c570631e14d953fdf50abbf1a31b19c6e` |
| `apps/web/src/SourceSelectionActions.tsx` | `89306758de311d070aa8f90b1a39c1be5a58a2dc01aa2ff1e26ace65fc292d2d` |
| `apps/web/src/SourceWorkbench.tsx` | `309199491dcede75bffbb08bc73bf7fd5d2493601191fd11fc5392c77820e419` |
| `apps/web/src/WorkbenchPanelContent.tsx` | `baf2e842d74dbbb66a02ecaf25a25299fa42da5fae8c5c6a951be34c2a4bfa33` |
| `apps/web/src/source-workbench.css` | `61e90e24151b466536dab9a5803d4edf859efcfcdb3e2fd377027173364e2940` |
| `apps/web/src/focus.ts` | `8ca47390b2047777f6539a8c14cd397c2fe37aa75685ad9929d0cdd255be13c1` |
| `apps/web/src/App.tsx` | `35c85b82775d7268a1ff7d412b2bc328b38121b6defbafd45dca2068391d862b` |
| `tests/e2e/workbench-fixture.tsx` | `e59ee834615e3c3a9a393bf2b399e502bcdaed5d843b3189eadf8fdaac0e1e71` |
| `tests/e2e/workbench.spec.ts` | `56dbae9c54d6fbafdfa02d3ee8f0e6303f508a7642a2496eee7d325a4e15b2bd` |
| `tests/e2e/workbench-app.spec.ts` | `c6bc1cf0166e1f38521d13e6391bc7f63c809040f7147406a0b6b10bd828e155` |
| `tests/e2e/workbench.playwright.config.ts` | `8fc46e2ac81103eb3674ad3cf0a0b550c673395b3aa2d6aeb14310d229b7e8c4` |
| `tests/e2e/workbench-app.playwright.config.ts` | `2ab30cea0296d11dd68e850160d9f41754588abdf2709a264941376ff51e80c6` |
