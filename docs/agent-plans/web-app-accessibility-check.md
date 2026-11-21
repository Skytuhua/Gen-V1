# Plan: Accessibility check for built web apps

## META

| Field | Value |
|---|---|
| Feature | Accessibility check: run axe-core (WCAG 2.2 A/AA rules) on a page in Gen's built-in browser or on the local dev server of the app the agent just built, list the violations, and send them to the thread's agent to fix with one click |
| Size | medium (labels `feature`, `medium`); no sub-issues (one DAG, ownership boundaries below) |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue (number assigned at publication; the issue header links it) |
| Plan file | `docs/agent-plans/web-app-accessibility-check.md` (identical to this issue body) |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git rev-parse HEAD` on a fresh clone, 2026-11-21) |
| Related work | No existing issue or PR for axe or automated WCAG audits of user apps (searched issues/PRs for "axe", "wcag", "accessibility audit"; `axe-core` is absent from every `package.json` and from `pnpm-lock.yaml`). Related but different: #583 / PR #1310 (accessibility pass on Gen's own workspace surfaces), #588 and #789 (contrast of Gen's own themes), `scripts/theme-contrast.ts` (WCAG contrast math for Gen's themes). Sibling batch 4 features (composer spellcheck, Ctrl+K command menu, user sidebar sections, test results view, dependency vulnerability check) are planned in their own issues and do not overlap. |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 4, item 6: "Accessibility check for built web apps (M): Run axe in Gen's browser on the app the agent just built, list WCAG issues, and fix them in one click. Home pages average 56.1 detectable accessibility errors, up 10% in a year (WebAIM Million 2026), and agent-built UIs ship fast without review. Gen has a browser (M15) but no axe or WCAG audit. Repo areas: apps/web/src/DesktopBrowser.tsx, M15 browser control, packages/ui-catalog." Owner instructions for batch 4: there is no separate front end team designing these features, so this plan specifies the visual design and animation itself; when the work is finished the implementing agent sends it to the front end team for review (task T10). All repository facts were read by static inspection of the baseline SHA; line numbers refer to that SHA. Decisions marked **DECIDED** were made by the planner (the owner delegates non-approval decisions); options not taken are recorded. No code was built or tested while planning. |

**Correction to the proposal.** The proposal credits "M15 browser control". At the baseline, M15 is the source-aware operator workbench (`docs/progress.md:35`, flag `ui.sourceWorkbenchV1`) and M16 is the consented browser/desktop control foundation with no live driver (`docs/progress.md:36`). The browser this feature uses is the Electron desktop browser (`apps/web/src/DesktopBrowser.tsx`, `apps/desktop/main.ts:121–136`). Nothing in this plan depends on M15 or M16.

**Design ownership.** This plan defines the visual design and motion (DESIGN §8). Implementers build exactly that, using existing tokens. When all tasks are verified, the implementing agent sends the finished work to Leonardo's front end team for review (T10) before the issue can close.

## OBJECTIVE

**User problem.** Agents in Gen build web apps quickly, and nobody checks them for accessibility. The WebAIM Million 2026 report found home pages average 56.1 detectable accessibility errors, up about 10% in a year (https://webaim.org/projects/million/). Gen has a built-in, isolated desktop browser but no way to audit a page: the browser only accepts public HTTP(S) URLs and rejects localhost and private addresses (`apps/desktop/window-policy.ts:60–68`, enforced at `apps/desktop/main.ts:130–132,301`), so the dev server of the app the agent just built cannot even be opened there, and no axe or WCAG tooling exists (`axe-core` absent from manifests and lockfile). To get an audit today the user must install a browser extension elsewhere, run it, and paste findings back into the thread.

**Intended behavior.** With the flag on, in the Gen desktop app, the browser toolbar has an **Accessibility** button. It offers **Check this page** (audit the page open in that Gen browser, as the user sees it) and **Check a local app…** (enter a loopback dev-server URL such as `http://localhost:5173/`; Gen loads it in a hidden, isolated audit view). Gen injects the bundled axe-core into an isolated JavaScript world, runs the WCAG 2.0/2.1/2.2 level A and AA rules, and shows the results in an **Accessibility panel** beside the page: counts by impact, one row per failed rule with the WCAG criteria, the affected elements and a link to the rule's help page. **Fix in thread** sends one message with the selected findings to the current main thread so its agent fixes them in the project source; **Check again** re-runs the same target after the fix.

**Measurable success.**
1. On the T09 fixture page with five known violations (image without alt, low-contrast text, unlabeled input, button without name, missing `lang`), the check reports exactly those rule IDs (`image-alt`, `color-contrast`, `label`, `button-name`, `html-has-lang`) and nothing else (T04 test with real axe-core).
2. From a loaded page, a user reaches results in ≤ 2 interactions (Accessibility, Check this page) and sends fixes in 1 more (Fix in thread), keyboard-only included (T09 browser test).
3. The renderer can never make the desktop main process run arbitrary JavaScript: the only script ever injected is the bundled axe file plus the fixed runner, and the existing "JS execution commands are rejected" test still passes (T02/T03 tests).
4. Checking a local app never opens loopback access in the normal Gen browser: `remoteBrowserUrl` and its tests are unchanged, and the audit view's requests outside the confirmed origin are blocked (T03 tests).
5. A full check of a typical page finishes within 15 s on the T09 fixture (load + axe run), with hard limits of 30 s load and 30 s run (T03 unit with fake timers; T09 timing log).
6. All acceptance rows R01–R20 in VALIDATION pass; existing desktop browser tests (`tests/desktop-native.test.ts`, `tests/docked-browser-open.test.ts`, `tests/e2e/browser-action.spec.ts`) stay green.

## REQUIREMENTS

### In scope

- **R01 Entry point.** With the flag on and inside the desktop app, every browser toolbar (docked dock, split-panel browser, detached browser window) shows an Accessibility button. Flag off or no desktop bridge: no button, no new IPC traffic.
- **R02 Check this page.** Audits the page currently loaded in that Gen browser, in place, without reloading it, so logged-in and in-app state is what gets checked. Disabled with tooltip "Open a page first" when the URL is `about:blank` or the page is loading.
- **R03 Check a local app.** A dialog takes a URL; accepted only if scheme `http:` or `https:`, host `localhost`, `127.0.0.1` or `[::1]`, any port 1–65535, no credentials, length ≤ 2,048. Any other host gets "Use a localhost address. Public pages can be checked from the browser with Check this page." The last accepted URL is remembered per project (renderer local storage key `gen.a11y.lastLocalUrl.<projectId>`) and prefilled.
- **R04 Isolation of local checks.** A local check runs in a hidden audit view with a fresh in-memory session that is destroyed after the check; it never shares cookies, storage or cache with the Gen browser; requests to any origin other than the confirmed origin (scheme+host+port) are blocked except `data:`, `blob:`, `about:blank`; no permissions, downloads, popups or webviews; the number of blocked requests is reported in the result.
- **R05 Rules.** axe-core with `runOnly` tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`; `resultTypes: ['violations']`; frames included (`iframes: true`, same-process frames only, see DESIGN §4); no best-practice rules in v1.
- **R06 Results.** Header: target URL (truncated in the middle), time, axe version, viewport. Summary: total failed rules and affected elements, with counts per impact (critical, serious, moderate, minor). List: one row per failed rule, sorted critical → minor then by element count; each row shows impact badge (text + color), rule help text, WCAG criteria (for example "1.4.3 Contrast (Minimum)"), element count; expanding shows up to 20 elements each with CSS selector, an HTML snippet (≤ 300 chars) and axe's failure summary (≤ 600 chars), plus "Learn more" opening the rule help URL in the Gen browser (Deque URLs are public and allowed by the existing policy).
- **R07 No violations.** Shows "No WCAG A or AA violations found by automated checks." plus the fixed note "Automated checks find some issues, not all. Test with a keyboard and a screen reader too."
- **R08 Fix in thread.** Each rule row has a checkbox (all checked by default). **Fix in thread** sends one `message.send` to the current main thread with the message in DESIGN §6 built from the checked rules. Disabled with a tooltip when there is no main thread ("Open a thread to send fixes") or nothing is checked. After sending, the button shows "Sent" for 1,500 ms, and an inline status "Sent to <thread title>" stays until the next check.
- **R09 Check again.** Re-runs the same target (same browser page or same local URL and viewport) and replaces the results; the panel keeps scroll position at the top and announces the new counts.
- **R10 Viewport.** Local checks offer Desktop (1280×800, default) or Mobile (390×844, device scale 3, touch emulation off); this-page checks use the page's current size and report it.
- **R11 Progress and cancel.** While running, the panel shows the phase ("Loading page…" for local checks, "Running checks…"), and a **Cancel** button. Cancel stops the run within 1 s and shows "Check cancelled."
- **R12 Limits.** Load timeout 30 s, axe run timeout 30 s, result JSON ≤ 256 KiB after normalization (rules ≤ 100, elements per rule ≤ 20 with the true count kept, strings truncated as R06); one check at a time per desktop window; starting a second check while one runs is refused with "A check is already running."
- **R13 Errors.** Load failure: "Couldn't load <url>: <description>. Is the dev server running?"; timeout: "The page took too long to load." / "The checks took too long."; page crashed: "The page stopped while being checked."; capability off mid-session: "Accessibility checks are turned off."; axe asset missing: "The accessibility checker is missing from this install." Each error offers **Retry**.
- **R14 Flag.** Host flag `browser.accessibilityAuditV1`, default false, checked by the host capability route and again by the desktop main process before every run.
- **R15 Panel placement.** The panel opens inside the same browser container (dock, split panel or detached window) beside the page, shrinking the native page area; it never overlaps the native view (native views cannot be layered under DOM). Close with the panel's X or Escape when focus is in the panel.
- **R16 Keyboard.** All controls reachable by Tab; the Accessibility menu is the shared ActionMenu; the rule list is a list of disclosure buttons (`aria-expanded`); Escape closes menu, dialog or panel in that order; focus returns to the Accessibility button on panel close.
- **R17 Screen readers.** Results summary is announced politely (`role="status"`) when a check finishes; errors use `role="alert"`; impact is conveyed by text, not only color.
- **R18 Privacy.** No telemetry, no network calls besides loading the audited page; findings are kept in renderer memory only (lost on window close) until the user sends them; HTML snippets are only sent to the agent when the user clicks Fix in thread.
- **R19 Packaging.** axe-core is a pinned production dependency; the packaged app reads its `axe.min.js` from the staged host `node_modules`; packaging asserts the file exists; `THIRD_PARTY_NOTICES.md` lists it with its MPL-2.0 license.
- **R20 No regressions.** Normal browser navigation policy, browser IPC command validation and the existing browser e2e suites are unchanged.

### Out of scope (v1)

- An agent-callable tool to run audits itself (needs a host-to-desktop-main bridge for tools that does not exist; follow-up candidate once this ships).
- Automatic dev-server detection or reading the URL from agent output or verification runs (no structured readiness read model exists: `packages/core/project-verification.ts:325–328` only records `listener-probe http://HOST:PORT/PATH` in observation argv).
- Opening loopback pages in the normal Gen browser.
- Best-practice and experimental axe rules, AAA rules, "needs review" (incomplete) results, highlighting elements on the page, screenshots of elements.
- Automatic re-check after the agent finishes; durable storage of results or a results history; exporting reports.
- Cross-origin iframes (axe cannot reach them without injecting into each frame process; documented limitation).
- Web (non-desktop) mode of Gen.

### Decisions (DECIDED) and options not taken

| ID | Decision | Options not taken (why) |
|---|---|---|
| D1 | axe-core, exact pinned version (4.14.1 was latest on npm on 2026-11-21, license MPL-2.0, `npm view axe-core version license`), used unmodified from npm | Lighthouse (much heavier, runs axe internally anyway); Pa11y/HTML_CodeSniffer (fewer rules, less maintained); IBM Equal Access checker (larger, different rule IDs agents know less) |
| D2 | Run in Electron main via `webContents.executeJavaScriptInIsolatedWorld` (fixed world id 1099) with the bundled file text | Playwright from the host (needs a second browser download, not packaged); a renderer-side iframe (cross-origin pages cannot be read); adding a general "evaluate" browser command (explicitly rejected by policy and tests, `tests/desktop-native.test.ts:156–168`) |
| D3 | Check this page: audit the live Gen browser page in place | Reload into a fresh audit view (loses login/app state, audits a different page than the user sees) |
| D4 | Check a local app: hidden `BrowserWindow({show:false})` with a fresh non-persistent partition and its own request filter allowing only the confirmed origin | Relax `remoteBrowserUrl` for loopback (widens the normal browser's attack surface for every page); reuse `secureBrowserSession` (its filter and proxy reject loopback, `window-policy.ts:60–68`, `browser-proxy.ts:19–24`) |
| D5 | Findings go to the agent as one normal user message in the current main thread | A new catalog artifact type with an action (needs artifact creation from the desktop side, a schema in `packages/ui-catalog`, larger scope); prefilling the composer (proposal asks for one click) |
| D6 | Host flag `browser.accessibilityAuditV1` (owner `m06`, the browser QA milestone), default false, exposed by a dedicated capability route and a new backend request for desktop main | Desktop-only setting (repo gates unverified features with host flags, `packages/core/capability-flags.ts:14–24`); reuse `verification.workflowV1` (unrelated feature, would couple rollouts) |
| D7 | WCAG 2.2 A + AA tags, violations only | Include best-practice (noisier, not WCAG); include incomplete (needs human judgment, out of scope) |
| D8 | Results only in renderer memory | Persisting results (privacy and storage questions with no requirement driving it) |
| D9 | Panel inside the browser container, shrinking the native view | Floating popover over the page (native view would cover it; the slot hides the native view when overlays occlude it, `DesktopBrowser.tsx:14–15`, which would blank the page while reading results) |

### UX flows

1. **This page.** User has the app open in the Gen browser (a public preview URL) → Accessibility → Check this page → panel opens with "Running checks…" → results: "7 issues on 23 elements · 2 critical, 3 serious, 2 moderate" → expands "Images must have alternative text" → sees 4 elements → Fix in thread → "Sent" → agent fixes → Check again → fewer issues.
2. **Local app.** Agent says it started the dev server on port 5173 → Accessibility → Check a local app… → dialog prefilled with the last URL, user types `http://localhost:5173/`, picks Desktop → Check → panel: "Loading page…" then "Running checks…" → results → Fix in thread.
3. **No issues.** Results show the R07 empty state with a success icon.
4. **Server down.** Local check of a stopped server → error "Couldn't load http://localhost:5173/: ERR_CONNECTION_REFUSED. Is the dev server running?" → Retry.
5. **No thread.** Results shown but Fix in thread disabled with tooltip "Open a thread to send fixes".

### Compatibility, security, privacy, accessibility

- Windows x64 desktop (supported beta platform per `CONTRIBUTING.md`) and Linux dev. Electron 45.2.0 (`package.json:75`) supports `executeJavaScriptInIsolatedWorld`, `session.fromPartition` with non-`persist:` names (in-memory) and `webRequest.onBeforeRequest`.
- Security boundary: the renderer sends only a strict, schema-checked audit command (target kind, local URL, viewport); desktop main reads the axe file from disk, concatenates it with a constant runner and nothing else. Results are parsed and size-checked in main before returning. The renderer never supplies script text, selectors to run, or axe options. The audit window has `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true`, `allowRunningInsecureContent:false`, `spellcheck:false`, no preload, permission/download/popup/webview denial copied from `apps/desktop/main.ts:114,130–132`.
- Isolated world: page scripts cannot see or tamper with axe's globals; axe reads the shared DOM and computed styles. A hostile page can still alter its own DOM during the run, which only affects its own results.
- Privacy: R18. The message sent to the agent contains selectors, short HTML snippets and failure summaries from the page; the user triggers it explicitly.
- Accessibility of the feature itself: R16–R17, contrast via existing tokens, reduced motion (DESIGN §8.5).
- Licensing: Gen's first-party code is "all rights reserved" (`LICENSE:3–8`). axe-core is MPL-2.0, a file-level copyleft: shipping the unmodified file is allowed with its license and a source pointer; never modify or concatenate-and-save `axe.min.js` into a first-party file (the runner is concatenated in memory at run time only). Add a `THIRD_PARTY_NOTICES.md` row (format `| Component | Provenance | License and notice |`, `THIRD_PARTY_NOTICES.md:7–11`) with version, npm/GitHub source URL and MPL-2.0 text link (T07).

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | Location | Fact |
|---|---|---|
| Browser toolbar/dock UI | `apps/web/src/DesktopBrowser.tsx:6–18` | `DesktopBrowserToolbar({state,detached})` (address bar, back/forward/reload/stop, errors via `role="alert"`), `DesktopBrowserSurface` (detached window), `DesktopBrowserSlot` (sends native bounds; hides native view when overlays occlude), `DesktopBrowserDock` (docked). Icons from `lucide-react` 0.468.0 (`package.json:58`). |
| Split-panel browser | `apps/web/src/App.tsx:914,1054–1057,1127` | Browser panel renders `DesktopBrowserToolbar` + `DesktopBrowserSlot`; opening a browser split surface deletes `threadId`/`projectId` from its binding (1054). |
| Dock mount and thread | `apps/web/src/App.tsx:720–725,1192` | App resolves the current main `thread` from `resolvedMainId`; dock mounted as `<DesktopBrowserDock/>` with no thread prop. The browser components do not know a thread today. |
| Sending a message | `apps/web/src/App.tsx:382`; `apps/web/src/api.ts:115–125`; `apps/server/server.ts:222`; `packages/core/service.ts:1173,1483,1710` | `command('message.send',{content,modelId,...},threadId)` → POST `/api/commands` → `service.command` → `sendMessage` → `runtime.followUp`/`runtime.start`. DISCOVERY X3: exact `message.send` payload fields required (model selection when sending from outside the composer). |
| Bridge exposure | `apps/desktop/preload.ts:14–28`; `apps/web/src/DesktopEntry.tsx:56`; `apps/web/src/desktop-context.tsx:11–13,45–55` | Frozen `window.harnessDesktop` (`DesktopBridge`); `browser()` invokes `channels.browser`; `onState` subscription; React `useDesktop()`. |
| Desktop contract | `packages/desktop-contract/index.ts:12,20–30,51` | `DesktopBrowserCommand` union (open/close/navigate/back/forward/reload/stop/bounds, no evaluate); `DesktopBridge` with optional methods (pattern for a new optional `accessibilityAudit?`); channel constants `harness-desktop:browser`, `:state`, `:context`. |
| IPC registration | `apps/desktop/main.ts:81–84,236–237,279–305` | `registerIpc` wrapper with `authorize` (trusted sender, main frame); browser handler parses with `parseBrowserCommand` and resolves the sender window's browser record. |
| Command parsing | `apps/desktop/window-policy.ts:45–52` | Strict prototype/key-count checks; pattern for `parseAccessibilityAuditCommand`. |
| Browser policy | `apps/desktop/window-policy.ts:53–68`; `apps/desktop/browser-proxy.ts:19–24` | `publicAddress`, `remoteBrowserUrl` (rejects localhost/private/nonstandard ports), `allowRemoteBrowserUrl` (DNS). Must stay unchanged (R20). |
| Browser record | `apps/desktop/main.ts:110,111–119,121–136` | `browserState`; `secureBrowserSession` (permission/download denial, request filter, mandatory local proxy, per-session WeakMap); `browserRecord` creates `WebContentsView` in `persist:harness-browser` with sandbox/isolation, window-open denial, navigation/redirect filtering, `render-process-gone`. |
| Backend requests from main | `apps/desktop/main.ts:202–204`; `apps/server/desktop-controls.ts:19` | `backendRequest(type,extra)` typed union of `harness.*` requests to the backend child; server handlers in `desktop-controls.ts` with strict key-count checks. Pattern for `harness.accessibilityAudit.capability`. |
| Packaging | `scripts/build-desktop.ts:5–9`; `scripts/desktop-assets.ts:31–59,62–76,119–122`; `scripts/package-desktop.ts:21–22,31–34,43`; `apps/desktop/main.ts:56` | Desktop main/preload bundled by esbuild; production deps installed into staged host and copied to `resources/host` (with `node_modules`); required-runtime-file assertions exist; packaged host root = `process.resourcesPath/host`. |
| Source manifest | `scripts/public-source-files.json` (runtime list from line 4525); `scripts/public-source.ts:3–24`; `CONTRIBUTING.md:40–49` | New first-party source files must be listed; npm dependency files are not. |
| Flags | `packages/core/capability-flags.ts:14–24,105–110,126–137,157,183` | All keys default false; key arrays per milestone; `hostDefinitions` `{key,owner,description}`; `capabilityEnabled`; env override `HARNESS_FLAG_*`. DISCOVERY X1: the M06 key array name (grep `verification.workflowV1`). |
| Capability route pattern | `apps/server/workspace-routes.ts:87–91`; `apps/server/source-workbench-routes.ts:15–17`; `packages/core/source-workbench.ts:408–424`; `apps/web/src/SourceWorkbench.tsx:96,152–159` | Feature-specific availability endpoints; UI hides controls when unavailable. No generic flag endpoint exists. |
| Shared UI | `packages/ui-shell/ActionMenu.tsx`, `Modal.tsx`, `Select.tsx`, `Popover.tsx`; `DESIGN.md:56` | Only shared overlays allowed. |
| Tokens and design rules | `packages/ui-shell/tokens.css:2–40,53–59,70–71`; `DESIGN.md:7–9,23,44–48,68–81`; `apps/web/src/styles.css:3–4` | Spacing/focus/easing tokens; motion: hover 120ms, press 80ms, status 160ms, success 240ms, panel enter 220ms / exit 180ms, popup enter 180ms; `--ui-ease-enter cubic-bezier(.16,1,.3,1)`, `--ui-ease-move cubic-bezier(.4,0,.2,1)`; reduced motion via `data-motion`, `data-panel-animations`, `prefers-reduced-motion`; black workspace, `#0F0F0F` task surfaces, `#1F1F1F` selected; status never by color alone. |
| Theme contrast | `scripts/theme-contrast.ts:11,71`; `tests/theme-contrast.test.ts` | WCAG contrast thresholds and luminance; reuse for the impact badge colors (T08). |
| Desktop tests | `tests/desktop-native.test.ts:4,156–168`; `tests/docked-browser-open.test.ts:7–58`; `tests/desktop-state-broadcast.test.ts:5` | Policy and IPC validation tests, including rejection of JS-execution commands. |
| Browser e2e | `tests/e2e/fixtures/browser-action.tsx:1–4,27–34`; `tests/e2e/browser-action.spec.ts:5`; `tests/e2e/browser-action.playwright.config.ts:4`; `tests/e2e/browser-action.vite.config.ts:4–7` | Real `DesktopBrowser` components with a synthetic bridge (no native IPC), Chrome headless, port 5812. |
| Other test infra | `package.json:16–25`; `playwright.config.ts:4`; `tests/reduced-motion-coverage.test.ts`; `tests/ui-guard.test.ts`; `scripts/lint-ui.ts`; `scripts/ui-overlay-legacy.json` | `pnpm test`, `test:browser`, `test:e2e`, `test:ui-guard`, `lint`, `typecheck`. |
| Progress matrix | `docs/progress.md:21–37` | No accessibility-audit milestone; M06 browser QA flag `verification.workflowV1` off. |

**DISCOVERY items** (resolve in the named task, record findings in the issue checkpoint):
- X1 (T01): name of the M06 flag key array and the test asserting registered keys (grep `verification.workflowV1` in `packages/core` and `tests/`).
- X2 (T03): whether a hidden `BrowserWindow({show:false, paintWhenInitiallyHidden:true})` computes layout and styles correctly for axe `color-contrast` on Windows and Linux; if not, use `webPreferences.offscreen:true` (record which).
- X3 (T06): exact `message.send` payload (`content`, `modelId`, attachments?) and how App picks the model for a send that does not come from the composer; reuse the composer's current selection for that thread.
- X4 (T03): how the browser IPC handler at `main.ts:279–305` resolves the browser record for the sender (docked vs detached vs split panel); reuse it for "this page".
- X5 (T07): the packaged path of `axe-core/axe.min.js` under `resources/host/node_modules` and the dev-mode resolution (`createRequire(hostRoot).resolve('axe-core/axe.min.js')`); confirm pnpm's layout in the staged install exposes it (hoisting/symlinks inside asar-excluded host).
- X6 (T05): whether `lucide-react` 0.468.0 exports `Accessibility` (else use `PersonStanding`).
- X7 (T03): Electron 45 behavior of `executeJavaScriptInIsolatedWorld` on cross-origin frames; confirm `iframes:true` simply skips out-of-process frames without throwing.

## DESIGN

### 1. Contracts (`packages/desktop-contract/index.ts`, extended)

```ts
export type AccessibilityImpact = 'critical' | 'serious' | 'moderate' | 'minor';
export type AccessibilityAuditCommand =
  | { type: 'run'; target: { kind: 'browser' } }
  | { type: 'run'; target: { kind: 'local'; url: string; viewport: 'desktop' | 'mobile' } }
  | { type: 'cancel' }
  | { type: 'capability' };
export interface AccessibilityAuditNode { target: string; html: string; failureSummary: string }
export interface AccessibilityAuditRule {
  ruleId: string; impact: AccessibilityImpact; help: string; description: string; helpUrl: string;
  wcag: string[];            // e.g. ["1.4.3"], from tags like "wcag143"
  nodeCount: number;         // true count
  nodes: AccessibilityAuditNode[]; // ≤ 20
}
export interface AccessibilityAuditResult {
  status: 'completed';
  target: { kind: 'browser' | 'local'; url: string; title: string };
  viewport: { width: number; height: number };
  axeVersion: string; standard: 'WCAG 2.2 A/AA';
  startedAt: string; durationMs: number;
  counts: Record<AccessibilityImpact, number>; // rules per impact
  elementCount: number; rules: AccessibilityAuditRule[]; // ≤ 100, sorted
  blockedRequests: number; truncated: boolean;
}
export type AccessibilityAuditOutcome =
  | AccessibilityAuditResult
  | { status: 'cancelled' }
  | { status: 'failed'; code: 'LOAD_FAILED' | 'LOAD_TIMEOUT' | 'RUN_TIMEOUT' | 'PAGE_GONE' | 'DISABLED' | 'ASSET_MISSING' | 'BUSY' | 'NO_PAGE' | 'INVALID_URL'; message: string };
// DesktopBridge gains:
//   accessibilityAudit?(command: AccessibilityAuditCommand): Promise<AccessibilityAuditOutcome | { available: boolean }>;
// channels gains: accessibilityAudit: 'harness-desktop:accessibility-audit'
```

Strings truncated: `target` (selector, joined with ` > ` for frame chains) ≤ 300, `html` ≤ 300, `failureSummary` ≤ 600, `help` ≤ 200, `description` ≤ 400, `title` ≤ 200, `url` ≤ 2048; `helpUrl` must start with `https://dequeuniversity.com/` else dropped (empty string). Impact `null` from axe maps to `minor`.

### 2. Command parsing (`apps/desktop/window-policy.ts`, new exports)

- `parseAccessibilityAuditCommand(raw)`: same strictness as `parseBrowserCommand` (plain object, exact key sets, string lengths); rejects any extra key (e.g. `script`, `code`, `options`).
- `loopbackAuditUrl(raw): URL`: rules of R03; normalizes `localhost` to itself (no DNS); returns the URL with fragment removed. Origin for the filter = `url.origin`.

### 3. Capability

- Host: add `browser.accessibilityAuditV1` to the M06 flag key array (X1) and `hostDefinitions`: `{ key: "browser.accessibilityAuditV1", owner: "m06", description: "Desktop accessibility check: axe-core WCAG A/AA audit of the Gen browser page or a confirmed loopback dev server, findings sent to the thread on request." }`.
- Route `GET /api/browser/accessibility-audit/capability` → `{ available: boolean }` (`Cache-Control: no-store`, same host/origin/cookie hooks as other API routes); file `apps/server/accessibility-audit-routes.ts`, registered beside `source-workbench-routes.ts` (find registration in `apps/server/server.ts`).
- Backend request `harness.accessibilityAudit.capability` (no extra keys) handled in `apps/server/desktop-controls.ts` → reply `harness.accessibilityAudit.capability.result` `{ available }`; desktop main calls it before every run (cache ≤ 5 s) and returns `DISABLED` when false.

### 4. Desktop main runner (`apps/desktop/accessibility-audit.ts`, new)

```ts
const WORLD_ID = 1099;
const RUNNER = `(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']},resultTypes:['violations'],iframes:true,elementRef:false,selectors:true,ancestry:false,xpath:false,absolutePaths:false});return {version:axe.version,url:location.href,title:document.title,width:innerWidth,height:innerHeight,violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,description:v.description,helpUrl:v.helpUrl,tags:v.tags,nodes:v.nodes.map(n=>({target:n.target,html:n.html,failureSummary:n.failureSummary}))}))};})()`;
export async function runAudit(contents: WebContents, axeSource: string, signal: AbortSignal, timeoutMs = 30_000): Promise<RawAudit>
export function normalizeAudit(raw: unknown, meta: {...}): AccessibilityAuditResult // pure, unit-tested
export async function runLocalAudit(url: URL, viewport: 'desktop'|'mobile', axeSource: string, signal: AbortSignal): Promise<AccessibilityAuditOutcome>
```

- `axeSource` read once per process from the resolved `axe.min.js` (X5) with `readFile(...,'utf8')`, size sanity check (100 KiB–2 MiB), else `ASSET_MISSING`.
- `runAudit`: `contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: axeSource }, { code: RUNNER }])`; the promise resolves with the last script's value. Race with timeout and abort; on abort/timeout call `contents.executeJavaScriptInIsolatedWorld(WORLD_ID,[{code:'void 0'}])` is not a cancel, so for this-page checks the result is ignored (axe finishes in the background, harmless); for local checks the window is destroyed.
- `normalizeAudit`: validate shape defensively (unknown shape → `failed` with code `PAGE_GONE` and message "The checks returned an unexpected result."), map tags `wcag(\d)(\d)(\d+)` → `"d.d.d"` (skip level tags like `wcag2aa`), add criterion names from a small static table for the criteria axe 4.14 maps (T02 builds it from axe's rule metadata at implementation time; unknown criteria shown as number only), sort, truncate, compute counts, enforce 256 KiB (drop nodes from the end, set `truncated`).
- `runLocalAudit`: `session.fromPartition('a11y-audit-' + randomUUID())` (no `persist:` → in-memory); set permission request/check denial and `will-download` prevention; `webRequest.onBeforeRequest`: allow `about:blank`, `data:`, `blob:`, and URLs whose `new URL(u).origin === target.origin`, plus `ws:`/`wss:` to the same host+port (dev-server HMR); cancel others and count them. `setProxy({mode:'direct'})`. Create `new BrowserWindow({ show:false, width, height, paintWhenInitiallyHidden:true, webPreferences:{ session, sandbox:true, contextIsolation:true, nodeIntegration:false, webSecurity:true, allowRunningInsecureContent:false, spellcheck:false, backgroundThrottling:false } })` (X2); mobile: `contents.enableDeviceEmulation({screenPosition:'mobile',screenSize:{width:390,height:844},viewSize:{width:390,height:844},deviceScaleFactor:3,viewPosition:{x:0,y:0},scale:1})`; deny window open/webviews; block navigations and redirects leaving the origin (`will-navigate`, `will-redirect` → `preventDefault`). `loadURL(url)` with 30 s timeout; after `did-finish-load` wait for network idle (no request started in 500 ms, max 5 s extra) then run. Always in `finally`: destroy window, `session.clearStorageData()`, `clearCache()`.
- This page: resolve the sender's browser record (X4); reject `NO_PAGE` if URL is `about:blank` or `loading`; run `runAudit` on `record.view.webContents`; `render-process-gone` during the run → `PAGE_GONE`.
- Concurrency: one active run per sender window (map windowId → AbortController); second run → `BUSY`; `cancel` aborts it.

### 5. IPC and bridge

- `channels.accessibilityAudit = 'harness-desktop:accessibility-audit'` in `packages/desktop-contract/index.ts:51`.
- `apps/desktop/preload.ts`: add `accessibilityAudit: command => ipcRenderer.invoke(channels.accessibilityAudit, command)` to the frozen bridge.
- `apps/desktop/main.ts`: `registerIpc(channels.accessibilityAudit, ...)` using the existing `authorize` wrapper; parse with `parseAccessibilityAuditCommand`; `capability` → backend request; `run` → capability check → runner; `cancel` → abort.

### 6. Renderer (`apps/web/src/accessibility/`, new folder)

- `useAccessibilityAudit.ts`: state machine `idle → running(phase) → done(result) | failed(outcome) | cancelled`; `run(target)`, `cancel()`, `retry()`; capability fetched once per mount from both the host route (to hide the button in web mode too) and the bridge (`{type:'capability'}`); button shown only when both say available.
- `AccessibilityButton.tsx`: toolbar button + shared `ActionMenu` with "Check this page", "Check a local app…".
- `LocalAppDialog.tsx`: shared `Modal`; URL input (`type="url"`, label "Local app address", placeholder `http://localhost:5173/`), viewport `Select` (Desktop 1280 × 800 / Mobile 390 × 844), buttons Check (primary) / Cancel; inline validation text from R03 under the input (`aria-describedby`).
- `AccessibilityPanel.tsx`: header, summary, rule list, footer actions (Fix in thread, Check again), states (running, error, cancelled, empty).
- `fix-message.ts` (pure): builds the message:

```md
Fix these accessibility issues found by an automated WCAG 2.2 A/AA check (axe-core <version>) of <url> (<width>×<height>, <time>).
Change the project source, not the page in the browser. Keep the design unless a fix needs it. When done, tell me to run the check again.

1. [critical] image-alt: Images must have alternative text (WCAG 1.1.1). 4 elements.
   - `main > img.hero` `<img src="hero.png">`: Element does not have an alt attribute …
   …
2. [serious] color-contrast: Elements must meet minimum color contrast ratio thresholds (WCAG 1.4.3). 12 elements, first 5 shown.
   …
Rule help: <helpUrl per rule>
```

  At most 5 elements per rule in the message (counts kept), whole message ≤ 24 KiB (drop elements, then trailing rules with "…and N more rules not listed"). Backticks in snippets escaped by using a fence-safe wrapper (replace "`" with "'" in snippets).
- Thread wiring: add an optional `onFixInThread?: { threadTitle: string; send(content: string): Promise<void> } | null` prop threaded from `App.tsx` (current main thread from `resolvedMainId`, `App.tsx:720–725`) into `DesktopBrowserDock` (`App.tsx:1192`), the split-panel browser render (`App.tsx:914`) and, for the detached `DesktopBrowserSurface`, `null` (detached window has no thread context; Fix in thread disabled with the R08 tooltip). `send` calls the same `command('message.send', …, threadId)` path as the composer (X3).
- Layout: `DesktopBrowserToolbar` gets the button; a new wrapper `DesktopBrowserWithPanel` places `[slot | panel]` in a CSS grid used by dock, split panel and detached surface so the slot's measured rect shrinks and the existing bounds effect (`DesktopBrowser.tsx:14–15`) resizes the native view.

### 7. Panel structure

```
┌ Accessibility ─────────────────────── [×] ┐
│ localhost:5173/   · Desktop 1280×800      │
│ axe 4.14.1 · WCAG 2.2 A/AA · 12:04        │
├───────────────────────────────────────────┤
│ 7 issues on 23 elements                   │
│ [2 Critical] [3 Serious] [2 Moderate] [0 Minor] │
├───────────────────────────────────────────┤
│ ☑ ▸ [Critical] Images must have alt text  4│
│      1.1.1 Non-text Content                │
│ ☑ ▾ [Serious] Elements must meet contrast 12│
│      1.4.3 Contrast (Minimum)              │
│      main > p.subtitle                     │
│      <p class="subtitle">Build faster</p>  │
│      Fix: element has insufficient color…  │
│      Learn more ↗                          │
├───────────────────────────────────────────┤
│ [Fix in thread]          [Check again]    │
└───────────────────────────────────────────┘
```

### 8. Visual design and motion (normative; no separate design team)

**8.1 Layout.** Panel width 360px (min 320, max 40% of the container) on the right of the page when the browser container is ≥ 720px wide; below 720px it docks to the bottom with height 45% (min 240px). Separator: 1px `var(--border)` (DISCOVERY in T08: exact border token name in `styles.css:3–4`). Panel background: task surface `#0F0F0F` (light: existing light task-surface token). Header row height 40px, padding `--ui-space-2` `--ui-space-3`; title "Accessibility" 13px semibold `var(--text)`; meta lines 12px `var(--muted)`; target URL single line, middle ellipsis, full URL in `title`. Summary block padding `--ui-space-3`: headline 15px semibold; impact chips in a wrapping row, gap `--ui-space-2`. Rule rows: min height 44px, padding `--ui-space-2` `--ui-space-3`, grid `[checkbox 20px][chevron 16px][badge auto][text 1fr][count auto]`; selected/hover row background `#1F1F1F` (light: selected-surface token); criteria line 12px `var(--muted)`. Expanded element blocks: left inset 44px, selector in `var(--code-font)` 12px `var(--text)`, snippet in `var(--code-font)` 12px `var(--muted)` on `#1F1F1F` with radius 6px padding 6px 8px, `white-space: pre-wrap; word-break: break-all`, max 4 lines with "Show more" toggle; failure summary 12px. Footer sticky at bottom, height 48px, border-top 1px, Fix in thread = primary compact button, Check again = secondary compact button, right-aligned gap `--ui-space-2`. Toolbar button: the same icon-button style as reload (`.icon-button`), icon `Accessibility` 16px (X6), `aria-label="Accessibility check"`, pressed state (`aria-expanded` when menu open, `aria-pressed` when panel open) uses the selected background.

**8.2 Impact badges (text always present).** Pill, height 20px, padding 0 8px, radius 10px, 11px semibold, label text "Critical", "Serious", "Moderate", "Minor". Colors use existing semantic tokens: Critical = danger text on danger at 16%; Serious = warning text on warning at 16%; Moderate = info/accent text on info/accent at 14% (if no info or accent semantic token exists, `var(--text)` on `#1F1F1F`); Minor = `var(--muted)` on `#1F1F1F`. Each pair must meet ≥ 4.5:1 text contrast in dark and light themes (T08 test using `scripts/theme-contrast.ts` functions). Chips in the summary use the same colors with the count first ("2 Critical"); a zero count chip uses the Minor neutral style.

**8.3 States.** Running: below the header a 2px indeterminate progress bar (accent color, 30% width segment moving left→right over 1.2 s linear, infinite while running only) and the phase text 13px with `LoaderCircle` 14px spinning (existing toolbar spinner style); Cancel secondary button. Empty: `CheckCircle2` 20px in success color + R07 text, centered with padding `--ui-space-4`. Error: `AlertTriangle` 16px danger + message + Retry. Cancelled: neutral text + Check again. Local dialog: shared Modal default width; validation text 12px danger color.

**8.4 Motion (tokens only).**
- Panel open: width/height from 0 is not animated (it resizes a native view; animating would cause many native resize calls). Instead the panel content fades in, opacity 0→1 over `--ui-motion-panel-enter` (220ms) `--ui-ease-enter` with 8px translateX from the right (bottom layout: 8px translateY); close: opacity 1→0 over `--ui-motion-panel-exit` (180ms) `--ui-ease-move`, then the grid column is removed. The native slot bounds update once at open and once after close.
- Results arrive: summary and rows fade in, opacity 0→1 over `--ui-motion-status` (160ms); rows stagger 20ms each for the first 8 rows only, then all at once.
- Row expand/collapse: `grid-template-rows: 0fr→1fr` + opacity over `--ui-motion-panel-enter` (220ms) `--ui-ease-enter`; collapse over `--ui-motion-panel-exit` (180ms) `--ui-ease-move`; chevron rotates 0→90° over `--ui-motion-hover` (120ms).
- Counts update on Check again: number crossfade opacity over `--ui-motion-status` (160ms); no counting-up animation.
- Fix in thread success: label crossfades to check + "Sent" over `--ui-motion-success` (240ms), holds 1,500 ms, crossfades back.
- Hover/press: existing button tokens (`--ui-motion-hover` 120ms, `--ui-motion-press` 80ms).
- Progress bar is the only looping animation and runs only while a check is running.

**8.5 Reduced motion.** Under `:root[data-motion="reduced"]`, `.app-shell[data-panel-animations="false"]` or `prefers-reduced-motion: reduce`: no translate, no stagger, no grid-row height animation (rows open instantly), chevron rotates instantly, progress bar replaced by a static full-width 2px bar at 40% opacity, spinner static; only opacity fades ≤ 80ms (`--ui-motion-press`). `data-motion="off"` disables all transitions. Add the selectors to what `tests/reduced-motion-coverage.test.ts` inspects (T08).

**8.6 Copy.** Button and menu labels: Accessibility check (aria), Check this page, Check a local app…, Check, Cancel, Fix in thread, Sent, Check again, Retry, Learn more, Show more, Show less, Close. Texts exactly as in R02, R03, R07, R08, R11–R13. Sentence case, no exclamation marks.

### 9. Error/cancel/retry

All runs carry an AbortController in main keyed by window. Cancel → local window destroyed immediately; this-page result ignored. Renderer unmount (panel closed or window closed) sends `cancel`. Retry re-sends the last command. Errors never leave a hidden audit window or partition alive (`finally` cleanup; T03 asserts `BrowserWindow.getAllWindows()` count returns to baseline in the mocked Electron test).

### 10. Migration/rollback

Additive only: new flag (default off), new route, new backend request type, new IPC channel, optional bridge method, new production dependency. Rollback = flag off (button hidden, main refuses runs). Removing the feature = revert PR; no stored data to migrate.

## EXECUTION_DAG

| ID | Goal | Depends on | Owner boundary |
|---|---|---|---|
| T01 | Flag, capability route, backend request | — | `packages/core/capability-flags.ts`, `apps/server/accessibility-audit-routes.ts` (new), `apps/server/server.ts` (registration only), `apps/server/desktop-controls.ts` |
| T02 | Contracts, parsers, normalizer, fix message | — | `packages/desktop-contract/index.ts`, `apps/desktop/window-policy.ts` (new exports only), `apps/desktop/accessibility-normalize.ts` (new, pure), `apps/web/src/accessibility/fix-message.ts` (new, pure) |
| T03 | Desktop main runner + IPC + preload | T01, T02, T07 | `apps/desktop/accessibility-audit.ts` (new), `apps/desktop/main.ts` (IPC registration, backend request type), `apps/desktop/preload.ts` |
| T04 | Unit tests (parsers, normalizer with real axe output, fix message, runner with mocked Electron) | T02, T03 | `tests/accessibility-audit-*.test.ts` |
| T05 | Renderer: hook, button, dialog, panel, thread wiring | T02 | `apps/web/src/accessibility/*`, `apps/web/src/DesktopBrowser.tsx`, `apps/web/src/App.tsx` (prop wiring at 914/1192 only) |
| T06 | `message.send` integration for Fix in thread | T05 | `apps/web/src/App.tsx` send callback, `apps/web/src/api.ts` reuse only |
| T07 | Dependency, packaging, notices | — | `package.json`, `pnpm-lock.yaml`, `scripts/desktop-assets.ts` (asset assertion), `THIRD_PARTY_NOTICES.md` |
| T08 | Visual design and motion | T05 | `apps/web/src/accessibility/accessibility.css` (new), reduced-motion coverage, contrast test |
| T09 | Browser tests, fixture, evidence | T05, T06, T08 | `tests/e2e/accessibility-check.*`, `tests/e2e/fixtures/a11y-violations.html` |
| T10 | Front end team review (owner requirement) | T04, T09 | issue comment + PR |

T01, T02 and T07 can run in parallel; their file sets do not overlap. T05 may start once T02's contract types exist.

### T01 Flag, capability route, backend request
- Resolve X1. Add `"browser.accessibilityAuditV1"` to the M06 key array and the `hostDefinitions` entry from DESIGN §3.
- Create `apps/server/accessibility-audit-routes.ts` with the GET route; register it in `apps/server/server.ts` next to the source workbench routes; add the file to `scripts/public-source-files.json` (`source`, and `runtime` mirroring `source-workbench-routes.ts`).
- Add `harness.accessibilityAudit.capability` handling to `apps/server/desktop-controls.ts` (strict keys like line 19).
- Tests: registered-key test updated; route returns `{available:false}` by default and `true` with `__setCapabilityFlagForTests`; backend request with extra keys rejected.
- Done when: those tests pass, `pnpm typecheck` passes, default false in `registeredCapabilityFlags()`.

### T02 Contracts, parsers, normalizer, fix message
- Add DESIGN §1 types and channel to `packages/desktop-contract/index.ts`.
- Add `parseAccessibilityAuditCommand` and `loopbackAuditUrl` to `apps/desktop/window-policy.ts` (DESIGN §2); do not touch existing functions.
- Create `apps/desktop/accessibility-normalize.ts` exporting `normalizeAudit` and the criterion-name table (build the table from axe 4.14.x rule tags at implementation time: every `wcagNNN` tag used by the selected rules gets its official WCAG 2.2 short name).
- Create `apps/web/src/accessibility/fix-message.ts` (DESIGN §6).
- Manifest entries for every new file.
- Done when: `pnpm typecheck` passes; T04 covers behavior.

### T03 Desktop main runner + IPC + preload
- Resolve X2, X4, X7. Implement `apps/desktop/accessibility-audit.ts` (DESIGN §4), register IPC (DESIGN §5), extend the `backendRequest` union and reply mapping at `main.ts:202–203`, add the preload method.
- Asset loading via X5 path resolution; `ASSET_MISSING` when absent.
- Tests in T04 with a mocked `electron` module (follow how `tests/docked-browser-open.test.ts` isolates main-process logic; if main.ts cannot be imported, test `accessibility-audit.ts` directly with fake `WebContents`/`BrowserWindow`/`session` objects).
- Done when: T04 runner tests pass and a manual `pnpm` desktop dev run (if available on Linux) shows a completed check of the T09 fixture served on localhost; record the result or NOT_RUN with reason.

### T04 Unit tests
- `tests/accessibility-audit-policy.test.ts`: `parseAccessibilityAuditCommand` accepts the four shapes; rejects extra keys (`script`, `code`, `options`), wrong types, URL > 2048; `loopbackAuditUrl` accepts `http://localhost:5173/`, `http://127.0.0.1:3000/x?y`, `http://[::1]:8080/`, `https://localhost/`; rejects `http://example.com`, `http://192.168.1.2:3000`, `http://localhost.evil.com`, `file:///`, `http://user:pw@localhost:3000`, `http://localhost:0`, `http://localhost:70000`; existing `remoteBrowserUrl` still rejects `http://localhost:5173` (R20).
- `tests/accessibility-audit-normalize.test.ts`: run real axe-core in jsdom or, if axe needs layout, use a recorded fixture JSON produced by T09's Playwright run committed under `tests/fixtures/axe-violations-4.14.json` (real axe output for the fixture page); assert the five rule IDs, WCAG mapping (`wcag143`→`1.4.3`), sort order, truncation limits (synthetic 150 rules × 50 nodes → ≤ 100 rules, ≤ 20 nodes, `truncated:true`, JSON ≤ 256 KiB), impact null → minor, non-Deque helpUrl dropped, malformed input → failure.
- `tests/accessibility-fix-message.test.ts`: content order, 5-element cap with counts, 24 KiB cap with "…and N more rules not listed", backticks replaced, only checked rules included.
- `tests/accessibility-audit-runner.test.ts` (mocked Electron): only `axeSource` and `RUNNER` are passed to `executeJavaScriptInIsolatedWorld` with world 1099; request filter allows same origin and same-host `ws:` and blocks others with count; navigation away is prevented; timeout → `LOAD_TIMEOUT`/`RUN_TIMEOUT`; cancel → `cancelled`; `BUSY` on second run; capability false → `DISABLED` and no window created; window destroyed and storage cleared on success, failure, timeout and cancel; `NO_PAGE` for `about:blank`.
- Done when: `pnpm exec vitest run tests/accessibility-audit-*.test.ts tests/accessibility-fix-message.test.ts tests/desktop-native.test.ts tests/docked-browser-open.test.ts --maxWorkers=1` passes.

### T05 Renderer
- Resolve X6. Implement DESIGN §6 components and hook; integrate the button into `DesktopBrowserToolbar` and the panel wrapper into dock, split panel and detached surface; thread the `onFixInThread` prop from `App.tsx` (null for detached).
- Unit tests for the hook's state machine (export the reducer) and for button visibility (flag off / no bridge → no button).
- Done when: unit tests pass, `pnpm typecheck`, `pnpm lint`.

### T06 Fix in thread
- Resolve X3. Implement `send` with the composer's `message.send` path and model selection for the current main thread; show "Sent to <thread title>"; on failure show the error text from the command response in the panel footer (`role="alert"`) and keep the selection.
- Done when: T09 asserts the command payload and the thread id.

### T07 Dependency, packaging, notices
- Add `"axe-core": "<exact latest 4.x>"` to root `dependencies` (production; repo pins exact versions); `pnpm install`; commit lockfile.
- Resolve X5; add an assertion in `scripts/desktop-assets.ts` (pattern at 31–59) that the staged host contains `node_modules/axe-core/axe.min.js` and `node_modules/axe-core/LICENSE`.
- `THIRD_PARTY_NOTICES.md`: row `axe-core | npm axe-core@<version>, https://github.com/dequelabs/axe-core (unmodified) | MPL-2.0, https://www.mozilla.org/MPL/2.0/; license file shipped at resources/host/node_modules/axe-core/LICENSE`.
- Done when: `pnpm install --frozen-lockfile` and the desktop asset assertion pass (run `pnpm` packaging script if feasible on Linux; else record NOT_RUN and leave it to the Windows check).

### T08 Visual design and motion
- Implement DESIGN §8 in `apps/web/src/accessibility/accessibility.css` (scoped `.a11y-panel`, `.a11y-badge`, `.a11y-rule`, `.a11y-progress`), import it from the panel.
- Contrast unit test for the badge pairs in both themes using `scripts/theme-contrast.ts`; reduced-motion coverage updated; `pnpm lint:ui` and `pnpm test:ui-guard` pass with no additions to `scripts/ui-overlay-legacy.json`.
- Screenshots: dark + light, running, results collapsed, one rule expanded, empty, error, local dialog, narrow (bottom) layout — from T09 Playwright.
- Done when: screenshots attached to the issue checkpoint.

### T09 Browser tests and evidence
- Fixture page `tests/e2e/fixtures/a11y-violations.html` with exactly: `<html>` without `lang`; `<img src="data:…">` without alt; `<p style="color:#777;background:#888">` text; `<input>` without label; `<button></button>` with only an empty SVG; nothing else failing.
- `tests/e2e/accessibility-check.spec.ts` (add to the browser-action Vite/Playwright setup or a sibling config on its own port): (a) **real axe**: load the fixture in Playwright, inject `axe.min.js` via `page.addScriptTag({path})` and evaluate the same RUNNER string imported from the runner module; assert the five rule IDs; save the raw output as the T04 fixture JSON; (b) **UI with synthetic bridge**: the fixture bridge returns canned outcomes; flows 1–5 keyboard-only, menu, dialog validation messages, panel states, Fix in thread payload (`message.send` with thread id and content starting with the DESIGN §6 header), Check again, Cancel, flag off (no button), detached surface (Fix disabled), reduced motion (`page.emulateMedia({reducedMotion:'reduce'})` → computed `transition-duration` ≤ 80ms and no transforms on rows), panel does not overlap the slot (slot rect width shrinks by the panel width).
- Real-user check (pending, not CI): Windows desktop build with `HARNESS_FLAG_*` for `browser.accessibilityAuditV1` on; start a Vite app on `localhost:5173`, run Check a local app, Fix in thread, let the agent fix, Check again with fewer issues; also Check this page on a public site; record a screen recording.
- Done when: spec passes and the recording is attached.

### T10 Front end team review (owner requirement)
- After T01–T09 are VERIFIED and the PR is ready for review, post a HANDOFF checkpoint on this issue addressed to Leonardo's front end team: PR link, commit SHA, T08 screenshots, T09 recording and the DESIGN §8 spec; request their review of the visual design and motion. Apply their requested changes (update this plan's revision if decisions change). The issue is not complete until the front end team has reviewed.
- Done when: the front end team review is recorded on the PR/issue and requested changes are resolved.

## VALIDATION

**Setup.** Node ≥ 24.10.0, pnpm 10.30.3 (`package.json`), `pnpm install`; Chrome installed for Playwright fixtures (`CONTRIBUTING.md:78–87`).

**Commands (planned; none executed while planning).**

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm exec vitest run tests/accessibility-audit-policy.test.ts tests/accessibility-audit-normalize.test.ts tests/accessibility-fix-message.test.ts tests/accessibility-audit-runner.test.ts tests/desktop-native.test.ts tests/docked-browser-open.test.ts tests/desktop-state-broadcast.test.ts tests/theme-contrast.test.ts tests/reduced-motion-coverage.test.ts --maxWorkers=1
pnpm test:ui-guard
pnpm exec playwright test --config tests/e2e/browser-action.playwright.config.ts
pnpm exec playwright test --config tests/e2e/accessibility-check.playwright.config.ts
pnpm test --maxWorkers=1
pnpm check:docs-links
```

**Acceptance matrix.**

| Req | Task(s) | Check |
|---|---|---|
| R01 | T05, T09 | button in dock/split/detached with flag on; absent with flag off or no bridge (browser) |
| R02 | T03, T04, T09 | in-place run on browser webContents (runner unit); disabled on about:blank (browser) |
| R03 | T02, T04, T05, T09 | `loopbackAuditUrl` cases (unit); dialog validation + prefill (browser) |
| R04 | T03, T04 | filter/partition/cleanup (runner unit) |
| R05 | T03, T04, T09 | RUNNER options asserted (unit); real axe run on fixture (browser) |
| R06 | T02, T05, T09 | normalizer fields/sort/truncation (unit); panel rendering (browser) |
| R07 | T05, T09 | empty state text (browser) |
| R08 | T02, T05, T06, T09 | fix message (unit); payload + disabled states (browser) |
| R09 | T05, T09 | Check again replaces results, status announced (browser) |
| R10 | T03, T04 | viewport sizes and emulation call (runner unit) |
| R11 | T03, T05, T09 | cancel ≤ 1 s (unit fake timers; browser) |
| R12 | T02, T03, T04 | timeouts, size caps, BUSY (unit) |
| R13 | T03, T05, T09 | each error code → message + Retry (unit + browser) |
| R14 | T01, T03, T04 | default false; route; main refuses when off (unit) |
| R15 | T05, T08, T09 | slot shrinks, no overlap, Escape closes (browser) |
| R16 | T05, T09 | keyboard-only flows, focus return (browser) |
| R17 | T05, T09 | `role="status"`/`role="alert"` present and updated (browser) |
| R18 | T03, T06 | no network besides target (runner unit); message only on click (browser) |
| R19 | T07 | asset assertion; notices row |
| R20 | T02, T04, T09 | existing desktop tests and browser-action e2e unchanged and green |
| Visual §8 | T08, T10 | screenshots, contrast test, reduced-motion test, front end team review |

**Regressions.** `tests/desktop-native.test.ts` (including JS-execution command rejection), `tests/docked-browser-open.test.ts`, `tests/desktop-state-broadcast.test.ts`, browser-action and native-browser-bounds e2e, UI guard, theme contrast.

**Evidence.** Unit/browser output pasted into issue checkpoints; T08 screenshots and one T09 recording (local app flow with Fix in thread) attached; Windows real-user check recorded separately as PASS/NOT_RUN.

**Release gate.** All rows pass in CI, Windows real-user check done, front end team review (T10) resolved; flag stays default false until the owner enables it.

## STATE

| Item | State |
|---|---|
| Research and design | DONE (this plan r1) |
| Implementation T01–T10 | NOT_STARTED; no owner, no branch |
| Verification | NOT_RUN |
| Risks | Hidden-window layout for contrast checks (X2, fallback offscreen); pnpm layout of axe in the packaged host (X5); axe results differ between hidden local view and what users see (viewport presets mitigate); dev servers that load assets from other origins (blocked and counted, may hide issues); MPL-2.0 obligations (ship unmodified with license, T07) |
| Next step | An implementing agent claims the issue per AGENTS.md and starts T01, T02 and T07 in parallel |

## REFERENCES

- Proposal source: Gen-V1 feature proposals batch 4, item 6 (quoted in META Provenance; the proposal file itself is private to the planning conversation, so its full row is quoted above).
- WebAIM Million 2026: https://webaim.org/projects/million/ (56.1 average detectable errors per home page, up about 10% year over year, as quoted in the proposal).
- axe-core: https://github.com/dequelabs/axe-core (MPL-2.0; npm `axe-core` 4.14.1 on 2026-11-21); API `axe.run` options `runOnly`, `resultTypes`, `iframes`, `selectors`, `elementRef`, `ancestry`, `xpath`, `absolutePaths`: https://github.com/dequelabs/axe-core/blob/develop/doc/API.md; rule tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`): same document, "axe-core Tags".
- Electron APIs: `webContents.executeJavaScriptInIsolatedWorld`, `session.fromPartition` (in-memory without `persist:`), `webRequest.onBeforeRequest`, `webContents.enableDeviceEmulation`, `BrowserWindow` `paintWhenInitiallyHidden`/`offscreen`: https://www.electronjs.org/docs/latest/api/web-contents, https://www.electronjs.org/docs/latest/api/session, https://www.electronjs.org/docs/latest/api/browser-window.
- WCAG 2.2 success criteria names: https://www.w3.org/TR/WCAG22/.
- MPL-2.0: https://www.mozilla.org/MPL/2.0/ and FAQ https://www.mozilla.org/MPL/2.0/FAQ/.
- Repository docs: `AGENTS.md`, `CONTRIBUTING.md`, `DESIGN.md`, `docs/progress.md` at the baseline SHA.
