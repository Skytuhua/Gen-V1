# Generated app worker runtime

Generated JavaScript runs only in a dedicated browser Web Worker. The real iframe
contains a fixed, CSP-hashed trusted bootstrap and a DOM receiver. Generated HTML
is parsed by Shopify's `@remote-dom/polyfill` inside the worker; only validated
snapshots cross into the real DOM. The receiver never assigns generated HTML to
`innerHTML`, executes generated script, or dispatches arbitrary DOM setters.

**Availability:** `GENERATED_APPS_ENABLED=false`. Creation and mounting stay
disabled until final acceptance. Current delivery focuses on one polished trusted
signing flow; capability expansion is frozen. The runtime contract below does not
claim production enablement or genuine novel-app acceptance.

Integration:

- Bundle `worker.ts` into one browser IIFE, with all imports included, at
  `dist/widget-runtime/worker.js`. Serve it from the host origin at
  `/widget-runtime/worker.js` with JavaScript MIME and
  `WIDGET_WORKER_CSP` as an HTTP response header. The controller fetches only this
  fixed asset with `credentials:'omit'`, `redirect:'error'` and `cache:'no-store'`.
  It relays the installed bytes as data to the receiver; it never starts a
  host-origin worker containing generated code. The asset's HTTP CSP is defense
  in depth if loaded directly, not the opaque-origin execution boundary.
- `widgetShellDocument(artifactId)` returns the trusted iframe document;
  `WIDGET_SHELL_CSP` is its response CSP. The ticket route, token and mountId in
  the URL fragment, sandbox `allow-scripts`, and current iframe identity remain.
  The shell takes no generated source or state.
- `createWidgetRuntime({iframe,identity,html,stateSchemaVersion,onBridge,onFailure})`
  coordinates the receiver, which creates an opaque-origin `data:` worker with
  `credentials:'omit'`. This worker inherits `WIDGET_SHELL_CSP` from its creator.
  `post()` delivers host init and checkpoint receipts; `dispose()` asks the
  receiver to terminate the worker and removes controller listeners.
  Only the controller knows mount credentials. It stamps bridge identities and
  the existing React bridge still validates schemas/actions and owns durability.
- Parent checkpoints include `clientId: widget:${artifactId}:${mountId}`, exactly
  the client ID used by `edit.begin`. A checkpoint resolves only on host receipt.
- `ui_discover` reports generated apps as unavailable with the pending-gate
  reason. Supported APIs, limits and styles are documented below. Final production-host,
  isolation and browser responsiveness evidence must precede enablement.

The receiver sandbox is `allow-scripts` only. Opaque origin rules deny native
persistence even through recovered getters; inherited CSP denies network.
Classic generated JavaScript is evaluated only inside that worker, using the
required `unsafe-eval` allowance. No generated JavaScript executes on the host or
receiver main thread. This boundary is distinct from the trusted PDF draft and
PDF.js workers used by DocumentPreview; generated apps do not gain canvas/PDF APIs.

## Host-owned styles

`theme.ts` exports `WIDGET_BASE_CSS`, injected by the fixed shell. Generated markup can use
`task-stack`, `task-row`, `task-split`, `task-panel`, `task-caption`, `task-choice`,
`task-actions`, `task-primary`, `task-status` and `task-branch` without copying
shell CSS. The host supplies `--foreground`, `--muted-foreground`, `--card`,
`--secondary`, `--border`, `--primary`, `--primary-foreground` and `--accent-surface`
as theme tokens. Use compact system text (13px task text, 14px questions, 11px
metadata), neutral surfaces and restrained blue actions/focus. Artifact width
and card/canvas frame belong to presentation metadata, not generated shell code.

## Worker APIs and limits

Supported source is a single HTML fragment or document containing static CSS and
inline classic JavaScript. Separate script bodies share one worker execution
scope. Use `window.harness.onUpdate`, `.inputs`, `.state`, `.theme`, `.emit`,
`.setDirty`, and `.checkpoint` as before. Native JS, promises and timers run in the
worker. The library supplies DOM trees, creation, text, `innerHTML`, simple
selectors, classList, dataset, and event listeners. The adapter adds `.oninput`,
`.onclick`, local form values, checked/selected controls, and safe `.style` writes.
Events include click, input, change, submit, keydown, focusin and focusout. Submit
is always canceled in the receiver. Native focus and draft control values survive
DOM reconciliation; expansion preserves the iframe, mount and worker.

The receiver permits standard text/layout/table/form tags, bounded inert/ARIA/data
attributes, simple CSS selectors, and a safe CSS property/value subset. Theme
updates use the supplied CSS token map. Rendering is bounded to 800 nodes,
24 levels, 64 KiB content and 16 KiB CSS, sampled at most every 50 ms. A parent
watchdog requires challenge responses and terminates a worker after two seconds
without a response. Invalid DOM or excessive message traffic also stops it. Draft
controls remain visible after termination; retry creates a fresh mount.

Unsupported: external/module scripts and imports; all network/storage APIs;
nested workers; real `parent`/window access and navigation; HTML event attributes;
links/images/media, SVG, canvas, and custom elements; layout measurement; native
FormData(form); arbitrary CSS (including at-rules, animation, URL values, complex
selectors, custom property declarations); and full browser DOM compatibility.
Inline CSS style attributes are sanitized. This is a deliberately limited DOM
runtime, not an implementation of the entire browser API. Browser workers do not
provide a hard memory quota; tests establish CPU responsiveness and network/DOM
boundaries, not resistance to browser memory exhaustion or browser engine bugs.

Primary sources checked during implementation:

- [Shopify Remote DOM architecture](https://github.com/Shopify/remote-dom)
- [Window implementation](https://github.com/Shopify/remote-dom/blob/main/packages/polyfill/source/Window.ts)
- [DOM parsing implementation](https://github.com/Shopify/remote-dom/blob/main/packages/polyfill/source/serialization.ts)
- [Receiver restrictions and deprecation](https://github.com/Shopify/remote-dom/blob/main/packages/core/source/receivers/DOMRemoteReceiver.ts)

`@remote-dom/polyfill` version 1.6.0 is installed by the root owner. The upstream
generic DOM receiver is deprecated; this implementation uses the upstream DOM
polyfill with an application-specific receiver that denies navigation and script
elements altogether, rather than using generic remote property setters.
