# C2 independent UI primitive review, sizing addendum

Reviewed at 2026-11-16T01:28:24.334437+00:00. This is a read-only source and retained-evidence review. It runs no browser or test job and changes no product or test file.

**Disposition:** the measured source-dialog overflow at 200% CSS zoom is corrected in the reviewed source. No additional material behavioral regression was found in this narrow sizing correction. Complete current-cut gates are not certified by this review; root reported `c2-workbench-app-03` running when this addendum began, with the full shared and workbench runs still to be reconciled.

This addendum preserves and supersedes the sizing portion of `c2-ui-primitives-independent-review.md`, SHA-256 `f2955507c5e5aa2edb6c21bb01c1d9ce8e16d6fdbe335c34fdb16fc915ac13c4`. That earlier static review was sealed just before the full App failure report arrived and remains an interim review, not a complete acceptance result. The retained `c2-workbench-app-02` result remains FAIL with 19 passed and 2 failed cases. Its zoom failure led to the concrete reproduction below. Its separate reload failure was observed at workspace startup after the draft/focus checks; this addendum does not classify that failure as draft loss or assign an unproven root cause.

## Measured defect and correction

At body CSS zoom 2 in a 1280 by 800 viewport, the initial Sources view fit. Switching to the taller Evidence view exposed the shared `.ui-modal` rule winning the cascade with `max-height: calc(100dvh - 16px)`. The retained red computed a 784 CSS-pixel maximum, producing a physical dialog height of 1568 pixels centered at y=-384. Both the Close control and navigation were above the viewport. The earlier test's initial bounds checks did not cover this content-dependent expansion.

The correction replaces viewport-unit width and maximum-height bounds with percentages of the fixed containing block. The containing block already represents the zoom-adjusted layout space. The shared Modal retains fixed positioning, inset/margins, box sizing, scroll overflow, animation, and padding. The workbench width/height and narrow-screen width variants use the same percentage basis, so their constraints remain valid if their cascade order wins. The shared native-titlebar variant retains `top:42px` and the existing 58 CSS-pixel total height subtraction; only the percentage basis changes. The workbench preview's separate `50dvh` content limit is unchanged and is contained by the dialog's scrollable maximum.

The test now checks the dialog, Close control, and navigation again after entering Evidence and retains measured geometry. The measured red and green use identical test bytes, SHA-256 `f7d8151795a3ee1706f65d381aa1f6c5df9d5e3f1993229ada00ee0065e73912`. Only the two CSS files differ between those selected runs. Modal JavaScript, source ownership, selection validation, focus handling, and draft lifetime do not change in this repair.

| Measurement at CSS zoom 2 | Red | Green |
| --- | --- | --- |
| Initial Sources dialog y / height | 76.53125 / 646.9375 | 76.53125 / 646.9375 |
| Evidence dialog y / height / bottom | -384 / 1568 / 1184 | 16 / 768 / 784 |
| Evidence Close y | -334 | 66 |
| Evidence navigation y | -143.8125 | 256.1875 |

The selected green completes the full test, including returning to Sources, closing and restoring opener focus, preserving the authored draft, reopening and attaching the complete canonical message range, and asserting no `message.send`. Geometry alone is not substituted for those assertions.

## Unchanged migration invariants

Recomputed hashes confirm that 16 of the 19 files in the prior review are byte-for-byte unchanged. The only differences are the two CSS files and the stricter App test/diagnostics. The prior review of the optional `Popover.getAnchorRect` remains applicable: a real connected anchor continues to own the document, portal, observers, dismissal and focus destination; the optional callback supplies raw viewport placement geometry before existing zoom normalization; omitted callbacks retain the original bounding-box path.

The source toolbar still preserves pointer selection, uses explicit Shift+F10 focus entry, respects both composition indicators, revalidates exact canonical UTF-16 ranges before actions, and dismisses when its underlying source scrolls. The contained-toolbar scroll filter remains unchanged from its meaningful red-02 to green-01 reproduction. Native Modal and shared Select behavior, including nested toolbar ownership, disabled retained AFTER_CURRENT mode, disabled Diff placeholder, and explicit reload-to-retry wording, is unchanged by the sizing correction.

## Retained evidence identities

### `c2-ui-modal-zoom-red-01`

Observed command status `FAIL`, exit `1`. Playwright counts: 0 expected passes, 1 unexpected failures, 0 skipped, 0 flaky.

| Artifact | SHA-256 |
| --- | --- |
| Command receipt | `72fbc73ae558031d7332f43319337b77c2cbee85c2a864245c72c069a7b84f34` |
| Bounded log | `3f4f7c934e96af5d2dc2a79edfa7ae6e8968a7b3550c7b4126f2a0153679c67f` |
| Result JSON | `c693cdcf98e1b73198188613d8ae9e4c0677f920841f9605b9ff4482de6ff2b4` |
| Source and geometry JSON | `73856b8f356893c090a0a05e3499b301ee770ead26c9f8703a266edc426fd536` |

### `c2-ui-modal-zoom-green-01`

Observed command status `PASS`, exit `0`. Playwright counts: 1 expected passes, 0 unexpected failures, 0 skipped, 0 flaky.

| Artifact | SHA-256 |
| --- | --- |
| Command receipt | `edc1acc6dd202fa42467ca949b5105ccce4c1d1907bd84d423e7ce6c63812ac9` |
| Bounded log | `e34f501313e8f3ba53918f93fe9de4cd2d06f31d9f03fedb60f758cecd3cb9b6` |
| Result JSON | `fca5e14d31e98348a33a21c37dfc4a936d7e2ac83b57e826b6541dd1b9ba44ea` |
| Source and geometry JSON | `c889f428ff3f6f0cf5c7299478a9d18b424e17d440da22e9315c8611b6a3dd5d` |

Log and result digests were recomputed against the retained files and matched both command receipts and source/geometry records. The red remains a failed attempt; the green does not replace or relabel it.

## Limits and remaining gate ownership

This addendum establishes a static review and one local selected browser regression result. The complete current App, workbench, shared overlay/control, UI-policy, typecheck and build results belong to root's final gate receipts. Earlier complete-suite results for different CSS/test bytes are not reused as current-cut passes. The files still declare 21 App cases and 18 workbench cases; declaration counts alone do not establish passing execution.

The measured App case uses production App/client/journal/composer code with explicitly deterministic host HTTP and CSS body zoom. It does not establish actual browser zoom, Windows display scaling, installed desktop/WebView behavior, a native IME device session, native source-file access, or real Hermes execution. The shared suites contain native-titlebar fixtures and root-element zoom cases, but this review does not claim their pending execution results. The measured App run does not itself exercise the native-titlebar variant. Existing other modal callers have their own sizing overrides; no claim is made that every caller-specific viewport-unit override has been repaired or tested by this narrow change.

## Exact current source identities

| Reviewed file | SHA-256 |
| --- | --- |
| `packages/ui-shell/Modal.tsx` | `3b07a74846a4c15c9e7497ee8d8d1ffee8e17ea95d089d2db68026b018cba4eb` |
| `packages/ui-shell/Popover.tsx` | `fb5c94be1a32ba8d77d0dd919fab3a2917d207cba8096e56f47622535c9b6b4a` |
| `packages/ui-shell/Select.tsx` | `de0ea16b5992e56ab96b3bc7c16a11fb304a4822dc8b6bb961c700914e6ebbbb` |
| `packages/ui-shell/focus-retention.ts` | `3b4bd0ffe9f36f79678f05678cfe0d6adc66fda12831314531c732b3f24415dc` |
| `packages/ui-shell/list-navigation.ts` | `8cdcbcde83606b791aed704c63b73152b3fa6c15303683e7ee803ddde4dc7662` |
| `packages/ui-shell/overlay-position.ts` | `5aff00ab185315278c14b58e59db4d6ac2f3400ce88e76ecd3c5e20b396d29ed` |
| `packages/ui-shell/controls.css` | `bc7748d1ebc5d3992823ce92c93058a2f3ee18b47e70206cd3e1fefcd25cb424` |
| `packages/ui-shell/tokens.css` | `92f4d06b982aec3104484142bb305b8c570631e14d953fdf50abbf1a31b19c6e` |
| `apps/web/src/SourceSelectionActions.tsx` | `89306758de311d070aa8f90b1a39c1be5a58a2dc01aa2ff1e26ace65fc292d2d` |
| `apps/web/src/SourceWorkbench.tsx` | `309199491dcede75bffbb08bc73bf7fd5d2493601191fd11fc5392c77820e419` |
| `apps/web/src/WorkbenchPanelContent.tsx` | `baf2e842d74dbbb66a02ecaf25a25299fa42da5fae8c5c6a951be34c2a4bfa33` |
| `apps/web/src/source-workbench.css` | `b60a1aaa3596bef94b1ad2481f66c4378186b93221ec727065995293fe81b531` |
| `apps/web/src/focus.ts` | `8ca47390b2047777f6539a8c14cd397c2fe37aa75685ad9929d0cdd255be13c1` |
| `apps/web/src/App.tsx` | `35c85b82775d7268a1ff7d412b2bc328b38121b6defbafd45dca2068391d862b` |
| `tests/e2e/workbench-fixture.tsx` | `e59ee834615e3c3a9a393bf2b399e502bcdaed5d843b3189eadf8fdaac0e1e71` |
| `tests/e2e/workbench.spec.ts` | `56dbae9c54d6fbafdfa02d3ee8f0e6303f508a7642a2496eee7d325a4e15b2bd` |
| `tests/e2e/workbench-app.spec.ts` | `f7d8151795a3ee1706f65d381aa1f6c5df9d5e3f1993229ada00ee0065e73912` |
| `tests/e2e/workbench.playwright.config.ts` | `8fc46e2ac81103eb3674ad3cf0a0b550c673395b3aa2d6aeb14310d229b7e8c4` |
| `tests/e2e/workbench-app.playwright.config.ts` | `2ab30cea0296d11dd68e850160d9f41754588abdf2709a264941376ff51e80c6` |
