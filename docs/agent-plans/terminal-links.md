# Plan: Clickable links in terminal output (Ctrl+click a printed URL to open it)

> **Design ownership (batch 7).** There is no separate front end team designing this feature. This plan specifies the visual design and the animation itself (section VISUAL_DESIGN_AND_MOTION), and implementers build exactly that. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T06) and does not close this issue until that review is recorded on the issue.

## META

| Field | Value |
|---|---|
| Feature | Clickable links in terminal output: an `http://` or `https://` URL printed in a workspace terminal is underlined on hover and opens on **Ctrl+click** (⌘+click on macOS) in the user's browser, using the same rules as reply links (http(s) only, new browsing context, no opener, no referrer). Plain click keeps selecting text |
| Size | small (labels `feature`, `small`); one issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue |
| Plan file | `docs/agent-plans/terminal-links.md` (identical to this body; SHA-pinned link at the top of the issue) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `4ca1134ae1e4f354064457cb5664b545712da4a9` (verified by clone and `GET /repos/skytuhua-org/Gen-V1/commits/main`) |
| Existing work | None. No issue or PR matches "terminal link"; `apps/web/src/TerminalBody.tsx` loads only `@xterm/addon-fit`; root `package.json` pins `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 and has no `@xterm/addon-web-links`. Related, open: [#1476 Plan: Find in terminal output](https://github.com/skytuhua-org/Gen-V1/issues/1476) (also edits `TerminalBody.tsx`, `package.json`, `tests/e2e/terminal-read.spec.ts`; see STATE for coordination) |
| Implementation status | NOT_STARTED. Planning only; no code written |
| Source provenance | Feature proposal batch 7, item 2 ("Clickable links in terminal output", small), filed directly per the maintainer's standing instruction; static repository research at the baseline SHA; public prior art: xterm.js `@xterm/addon-web-links` 0.12.0 source at tag `6.0.0`, VS Code terminal links, Claude Code request #95907 |

## OBJECTIVE

**Problem.** Agents and dev servers print URLs into workspace terminals all the time (`Local: http://localhost:5173/`, a CI or PR link, a docs link in an error). In Gen's terminal (`TerminalBody`, rendered for `kind==='terminal'` in `apps/web/src/WorkspaceSurfaceBody.tsx`) such text is plain: hovering does nothing and clicking only starts a selection. The user must select the URL, copy it and paste it into a browser, and a URL wrapped across two rows is easy to copy wrong. VS Code ("Ctrl/Cmd+click to follow a link") and requests against Claude Code (#95907) show this is an expected terminal behavior.

**Intended behavior.**
1. When the pointer is over an `http://` or `https://` URL in terminal output, the URL is underlined, the cursor becomes a pointer, and the terminal toolbar shows the hint `Ctrl+click to open` (`⌘+click to open` on macOS).
2. **Ctrl+click** (or ⌘+click on macOS) on the URL opens it:
   - in the desktop app: in the operating system's default browser (through a new, validated desktop bridge call);
   - in a browser-hosted Gen: in a new browser tab with no opener and no referrer, exactly like reply links (`target="_blank" rel="noreferrer"` in `apps/web/src/Markdown.tsx`).
3. A plain click (no modifier) never opens anything: click, drag and double-click selection work as today, so "Add selection to prompt" (terminal excerpts) keeps working.
4. URLs wrapped across rows are detected as one link (the addon's wrapped-line handling).
5. OSC 8 hyperlinks (`ESC ]8;;https://…`) follow the same rule (Ctrl+click, http(s) only) instead of xterm's built-in plain-click `confirm()` dialog.
6. Nothing is sent to the shell by hovering or clicking a link, and no new request goes to the Gen host in the browser-hosted case.

**Measurable success.** In the terminal fixture with output `see https://example.com/docs?a=1 for details`: hovering the URL shows the hint; Ctrl+click calls the opener exactly once with `https://example.com/docs?a=1`; a plain click calls it zero times; `javascript:alert(1)`, `file:///etc/passwd` and `ftp://x.example` in output are never openable; zero `input` commands reach the host during the flow. In the packaged desktop app, Ctrl+clicking the `http://localhost:5173/` line printed by `pnpm dev` opens the system browser.

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows in VALIDATION)

- **R01 Dependency.** Add `@xterm/addon-web-links` at exact version `0.12.0` (MIT; published 2025-12-22 from the same xterm.js `6.0.0` tag as the pinned `@xterm/xterm` 6.0.0). Load it in `TerminalBody` with the same dynamic `import()` pattern used for `@xterm/addon-fit`.
- **R02 Detection.** Use the addon's default `strictUrlRegex` (http/https only, trailing punctuation `,.!?:` and brackets excluded) and its `new URL()` check. Do not pass a custom `urlRegex`.
- **R03 Modifier.** Activation requires `event.button===0` and `event.ctrlKey||event.metaKey`. Otherwise the activate callback returns without doing anything (the click stays a normal selection click).
- **R04 URL validation (decision).** A pure helper `terminalLinkUrl(raw:string):string|null` accepts only: length ≤ 2048, no characters in `\u0000-\u0020`, `new URL(raw)` succeeds, protocol `http:` or `https:`, empty `username` and `password`, non-empty `hostname`. Returns `url.href`. Loopback and private hosts (`localhost`, `127.0.0.1`, LAN IPs) **are allowed**: they are the user's own dev servers and open in the system browser, not in Gen's pinned in-app browser (whose `remoteBrowserUrl` policy in `apps/desktop/window-policy.ts` blocks them and stays unchanged).
- **R05 Opening.** One function `openWebLink(url)` in a new `apps/web/src/open-web-link.ts`:
  - if `window.harnessDesktop?.openExternal` exists, call it and await;
  - else `window.open(url,'_blank','noopener,noreferrer')`.
  `TerminalBody` calls it only with a value returned by `terminalLinkUrl`.
- **R06 Desktop bridge.** Add optional `openExternal?(url:string):Promise<void>` to `DesktopBridge` in `packages/desktop-contract/index.ts`, a channel `openExternal:'harness-desktop:open-external'` in `DESKTOP_CHANNELS`, the preload call in `apps/desktop/preload.ts`, and a main-process handler in `apps/desktop/main.ts` registered through the existing `handle(...)` helper (so the existing `authorize(event)` trusted-sender check applies). The handler re-validates with a main-process `externalLinkUrl(raw:unknown):URL` in `apps/desktop/window-policy.ts` (same rules as R04, plus `typeof raw==='string'`), then calls `shell.openExternal(url.href,{activate:true})`. The channel is **not** added to the plugin channel allowlist (`pluginChannels`), so plugin surfaces cannot use it.
- **R07 OSC 8.** Set the xterm option `linkHandler:{activate,hover,leave,allowNonHttpProtocols:false}` using the same modifier rule, validation and opener as R03–R05, so OSC 8 links never show xterm's default `confirm()` dialog (verified in xterm `src/browser/OscLinkProvider.ts` at tag 6.0.0: `defaultActivate` calls `confirm(...)` then `window.open()`).
- **R08 Hover hint.** While the pointer is over a link (addon `hover`/`leave` callbacks and the OSC 8 `hover`/`leave`), the toolbar shows `Ctrl+click to open` / `⌘+click to open` (VISUAL_DESIGN_AND_MOTION). The xterm built-in underline and pointer cursor are kept.
- **R09 Failure feedback.** If `openExternal` rejects, the hint area shows `Could not open link` for 4 s. This does **not** use the terminal `error` state (that state also shows the New terminal button), and nothing is logged with the URL.
- **R10 No side effects.** Hover and click on links send no `input` command, do not change the terminal excerpt selection beyond what the click itself selects, and work in phases `Running`, `Ended` and `Read interrupted` (they only read the local xterm buffer).
- **R11 Lifecycle.** The addon and handlers are disposed with the terminal instance (existing cleanup `instance?.dispose()` disposes loaded addons); a link activation after the effect is disposed or ownership moved (`ownerCurrent()` false) does nothing.

### Out of scope (v1)

- File-path links (`src/app.ts:42`) in the terminal (reply file references are batch 7 item 3, a separate plan).
- An "Open links in" setting. Gen has none: `browser-link-target` exists only as a transcribed upstream row in `apps/web/src/settings-inventory.ts`, and `settingAvailability()` in `settings-registry.ts` reports such rows `Unavailable`. Terminal links always use R05.
- Opening terminal links in Gen's docked in-app browser.
- Keyboard activation of links (xterm links are pointer-only). Keyboard users keep select + copy (Ctrl+Shift+A selects output).
- Changing how reply links (`Markdown.tsx`) open in the desktop app. Discovery fact recorded for a follow-up: the main window's `setWindowOpenHandler` in `apps/desktop/main.ts` (`githubDevicePopup`, `apps/desktop/github-device-policy.ts`) returns `{action:'deny'}` for every URL and only opens `https://github.com/login/device` externally, so `target="_blank"` reply links appear not to open in the desktop app. Not changed here; the implementer posts this as a separate issue if confirmed in the packaged app (T05).
- Any link schemes other than http/https (`file:`, `javascript:`, `mailto:`, `vscode:`, custom).

### User flows

1. Run `pnpm dev` in a terminal; hover `http://localhost:5173/` → underline, pointer, hint. Ctrl+click → system browser opens the page; the terminal keeps focus state unchanged; nothing is typed into the shell.
2. Plain click-drag over a URL → text selected; "Add selection to prompt" enabled as today; nothing opens.
3. A long URL wrapped over two rows → hovering either row underlines the whole URL; Ctrl+click opens the full URL.
4. Output contains `javascript:alert(1)` or `file:///C:/x` → no underline, Ctrl+click does nothing.
5. An OSC 8 link (`printf '\e]8;;https://example.com\e\\label\e]8;;\e\\\n'`) → hover hint; Ctrl+click opens `https://example.com`; plain click shows no dialog.

### Error and recovery

- Desktop opener rejects (validation failure or OS error) → R09 message; the next Ctrl+click retries normally.
- Browser popup blocked: `window.open` with `noopener` returns `null` by spec even on success, so failure is not detectable in the browser host; no message is shown there (documented limitation).
- Addon import fails (chunk load error) → terminal still works without links; no error shown; `console` gets no URL. Implement by catching the addon import separately from the core `Terminal` import.

## REPO_MAP (verified at the baseline SHA unless marked discovery)

| Path | Role in this feature |
|---|---|
| `apps/web/src/TerminalBody.tsx` | Creates `new Terminal({...})` inside the effect after `Promise.all([import('@xterm/xterm'),import('@xterm/addon-fit'),import('@xterm/xterm/css/xterm.css')])`; loads `FitAddon`; has `ownerCurrent()`, `canCapture()`, `onSelectionChange` (excerpts), `attachCustomKeyEventHandler` (Ctrl+Shift+A), toolbar `<div className="panel-toolbar">` with `<strong>Terminal</strong><span role="status">…` |
| `apps/web/src/terminal-read.css` | Toolbar styles for `.terminal-read` (focus outline, disabled opacity) |
| `apps/web/src/Markdown.tsx` | Reply links: `<a href target={startsWith('#')?undefined:'_blank'} rel="noreferrer">`, only `http(s)` and `#` targets are linked by `inline()` |
| `apps/web/src/desktop-context.tsx` | `window.harnessDesktop?:DesktopBridge` global declaration, `useDesktop()` |
| `packages/desktop-contract/index.ts` | `DesktopBridge` interface, `DESKTOP_CHANNELS` |
| `apps/desktop/preload.ts` | Builds the frozen `bridge` object exposed as `harnessDesktop` |
| `apps/desktop/main.ts` | `authorize(event)` trusted-sender check (line ~83), `handle(channel,action)` helper (line ~237) used for renderer IPC; main window `setWindowOpenHandler(details=>githubDevicePopup(...))` (line ~167); imports `shell` |
| `apps/desktop/window-policy.ts` | `remoteBrowserUrl`, `parseBrowserCommand`, `pluginDesktopChannelAllowed` / `pluginChannels` |
| `tests/e2e/terminal-read.spec.ts`, `tests/e2e/fixtures/terminal-read.tsx` | Playwright suite `terminal-read` (registered in `scripts/browser-suites.ts`); fixture exposes `window.terminalFixture.instances` (real xterm) and `text()`; `mount()` records every API request and blocks non-origin requests; narrow 320px dark/light reduced-motion test at the end |
| `tests/github-device-policy.test.ts`, `tests/desktop-native.test.ts`, `tests/desktop-host-ipc.test.ts` | Existing desktop policy/IPC unit tests to extend (discovery: pick the one that already covers `window-policy.ts` / channel lists; grep `pluginDesktopChannelAllowed` and `DESKTOP_CHANNELS`) |
| `apps/web/src/keyboard-bindings.ts`, `tests/keyboard-bindings.test.ts` | Key-chord registry. Not changed: Ctrl+click is a pointer gesture, not a key chord (decision) |
| `scripts/public-source-files.json` | Source manifest; every new tracked file is added (sorted) |
| `THIRD_PARTY_NOTICES.md` | Covers npm packages generically via `package.json`/`pnpm-lock.yaml`; no edit needed for an MIT npm package (verified text) |
| `package.json`, `pnpm-lock.yaml` | Dependency pin |

## DESIGN

### Components

- `apps/web/src/terminal-links.ts` (new, pure, unit-tested):
  ```ts
  export const TERMINAL_LINK_MAX_LENGTH = 2048;
  export function terminalLinkUrl(raw: string): string | null; // R04
  export function terminalLinkModifier(event: Pick<MouseEvent,'button'|'ctrlKey'|'metaKey'>): boolean; // button===0 && (ctrlKey||metaKey)
  export function terminalLinkHint(platform: string): string; // /Mac|iPhone|iPad/.test(platform) ? '⌘+click to open' : 'Ctrl+click to open'
  ```
- `apps/web/src/open-web-link.ts` (new): `export async function openWebLink(url: string): Promise<void>` per R05.
- `TerminalBody.tsx` changes (inside the existing effect, after `instance` is created and before `instance.open(...)`):
  ```ts
  const activate = (event: MouseEvent, raw: string) => {
    if (!ownerCurrent() || !terminalLinkModifier(event)) return;
    const url = terminalLinkUrl(raw); if (!url) return;
    event.preventDefault();
    void openWebLink(url).catch(() => { if (ownerCurrent()) flashLinkFailure(); });
  };
  const hover = (_event: MouseEvent, raw: string) => { if (ownerCurrent() && terminalLinkUrl(raw)) setLinkHint('hint'); };
  const leave = () => { if (ownerCurrent()) setLinkHint(current => current === 'hint' ? null : current); };
  instance.options.linkHandler = { activate, hover, leave, allowNonHttpProtocols: false }; // or pass in the constructor options
  instance.loadAddon(new WebLinksAddon(activate, { hover, leave }));
  ```
  New state `linkHint: 'hint' | 'failed' | null`; `flashLinkFailure` sets `'failed'` and a 4 s timer (cleared on effect cleanup) that resets to `null`. The effect's existing reset block (`setSelection(null); …`) also resets `linkHint` to `null`.
- Desktop: `externalLinkUrl` in `window-policy.ts`, channel + bridge + handler (R06).

### Data / control flow

Pointer over link → xterm link provider → `hover` → React state → toolbar hint. Ctrl+click → `activate` → `terminalLinkUrl` → `openWebLink` → (desktop) IPC `harness-desktop:open-external` → `authorize` → `externalLinkUrl` → `shell.openExternal`; (browser) `window.open(…,'noopener,noreferrer')`. No Gen host API request in either path.

### Security boundaries

- Renderer validation (R04) and main-process re-validation (R06) both allow only http(s) without credentials; the main process never trusts the renderer.
- Only trusted Gen windows (existing `authorize`) can call the channel; plugin surfaces are excluded.
- `noopener,noreferrer` in the browser host prevents reverse tabnapping (the addon's own default handler documents this risk).
- URLs are never logged (renderer or main).

### Migration and rollback

No stored data or settings. Rollback = revert the PR (dependency, two new modules, bridge channel).

## VISUAL_DESIGN_AND_MOTION

Follows `DESIGN.md` (motion tokens, reduced-motion rules, primitive-only overlays: the hint is inline toolbar text, not an overlay) and the existing terminal panel look.

### Link in the terminal (always dark, `background:#101010`, both app themes)

- Use xterm's built-in link decoration: underline on hover and `pointer` cursor (`ILinkDecorations` defaults `underline:true`, `pointerCursor:true`). No custom link color: link text keeps the color the program printed, so no ANSI color is overridden.
- No underline when not hovered (matches VS Code; avoids underlining every URL in noisy logs).

### Toolbar hint

- Element: `<span className="terminal-link-hint" aria-live="polite">` inserted in `.panel-toolbar` directly after the existing `<span role="status">` phase label. Rendered only when `linkHint!==null`.
- Text: `Ctrl+click to open` / `⌘+click to open` (from `terminalLinkHint(navigator.platform)`); failure text `Could not open link`.
- Style (new rules in `apps/web/src/terminal-read.css`): `font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:0 1 auto`. Failure state `.terminal-link-hint[data-state=failed]{color:var(--danger)}`. The URL itself is **not** shown in the hint (it is visible under the pointer; keeps the toolbar from overflowing).
- Narrow (≤ 360px wide panel): the hint may ellipsize but must not push Stop/Retry/New terminal outside the panel (existing narrow test asserts every `.live-terminal button` stays within 320px).

### Motion

- Hint entrance: `animation: terminal-link-hint-in 120ms var(--ui-ease-enter)` from `opacity:0` to `opacity:1` (no transform, no layout shift beyond the inline text appearing). Removal is immediate (no exit animation).
- Reduced motion (`@media (prefers-reduced-motion: reduce)`, `:root[data-motion=reduced]`, `:root[data-motion=off]`, `.app-shell[data-panel-animations=false]`): no animation. After 120 ms nothing keeps running (the existing narrow test counts running animations inside `.live-terminal` and expects 0).
- Underline/cursor change is instant (xterm-rendered).

## EXECUTION_DAG

T01 → T02 → T03 → T05; T04 can run in parallel with T02/T03 (different files); T06 after T05. One worker may do all of T01–T05 on one branch; if split, T04's owner touches only `packages/desktop-contract/index.ts`, `apps/desktop/*`, and desktop tests.

### T01 Add the web-links addon
- **Goal:** R01.
- **Depends on:** none.
- **Edits:** `pnpm add @xterm/addon-web-links@0.12.0 --save-exact` (updates `package.json`, `pnpm-lock.yaml`). Discovery: grep `addon-fit` in `tests/e2e/*.vite.config.ts`, `vite.config.*`, and `scripts/` for an `optimizeDeps.include` list or a dependency allowlist; add the new package wherever `@xterm/addon-fit` appears.
- **Tests:** `pnpm typecheck`; `pnpm build && pnpm test:browser --suite terminal-read` still passes (no behavior change yet).
- **Done when:** both pass.

### T02 Pure helpers
- **Goal:** `apps/web/src/terminal-links.ts` and `apps/web/src/open-web-link.ts` per DESIGN (R03, R04, R05 browser path, R08 text).
- **Depends on:** T01 (none functionally; keeps one branch order).
- **Edits:** the two new files; entries in `scripts/public-source-files.json` (sorted); new `tests/terminal-links.test.ts`.
- **Unit cases:** `terminalLinkUrl`: `https://example.com/a?b=1` → same href; `http://localhost:5173/` → accepted; `https://user:pw@example.com` → null; `javascript:alert(1)`, `file:///etc/passwd`, `ftp://x.example`, `mailto:a@b.c` → null; `'https://' + 'a'.repeat(2050)` → null; string containing `\n` or space → null; `not a url` → null. `terminalLinkModifier`: `{button:0,ctrlKey:true}` true, `{button:0,metaKey:true}` true, `{button:0}` false, `{button:1,ctrlKey:true}` false. `terminalLinkHint('MacIntel')` → `⌘+click to open`, `'Win32'` → `Ctrl+click to open`. `openWebLink` with a stubbed `window.harnessDesktop.openExternal` calls it once and not `window.open`; without it calls `window.open(url,'_blank','noopener,noreferrer')`.
- **Done when:** `pnpm exec vitest run tests/terminal-links.test.ts` and `pnpm typecheck` pass.

### T03 Wire links into TerminalBody
- **Goal:** R02, R03, R07, R08, R09, R10, R11 and VISUAL_DESIGN_AND_MOTION.
- **Depends on:** T02.
- **Edits:** `apps/web/src/TerminalBody.tsx` (import addon in the effect: load it after the core terminal import resolves, in its own `try/catch` so a failed addon import leaves the terminal working), `apps/web/src/terminal-read.css` (hint styles and keyframes).
- **Negative checks:** plain click/drag selection and Ctrl+Shift+A unchanged; `onSelectionChange` excerpt capture unchanged; no `input` command on hover/click.
- **Done when:** manual check in `pnpm dev` (flows 1–5) passes; `pnpm typecheck`, `pnpm lint`, `pnpm test:ui-guard` pass.

### T04 Desktop open-external bridge
- **Goal:** R06.
- **Depends on:** none (parallel with T02/T03).
- **Edits:** `packages/desktop-contract/index.ts` (`openExternal?` on `DesktopBridge`, channel in `DESKTOP_CHANNELS`), `apps/desktop/preload.ts` (`openExternal:url=>ipcRenderer.invoke(channels.openExternal,url)`), `apps/desktop/window-policy.ts` (`externalLinkUrl`), `apps/desktop/main.ts` (`handle(channels.openExternal,(_record,value)=>shell.openExternal(externalLinkUrl(value).href,{activate:true}))` alongside the existing handlers).
- **Tests:** extend the desktop policy unit test (discovery per REPO_MAP): `externalLinkUrl` accepts/rejects the same cases as T02 plus non-string (`42`, `null`, `{}`) → throws; `pluginDesktopChannelAllowed(DESKTOP_CHANNELS.openExternal)` → false. If a test enumerates `DESKTOP_CHANNELS` or bridge keys, update its expected list.
- **Done when:** `pnpm exec vitest run <the touched desktop tests>` and `pnpm typecheck` pass.

### T05 Browser tests, desktop check and evidence
- **Goal:** extend `tests/e2e/terminal-read.spec.ts` (same suite and fixture).
- **Depends on:** T03, T04.
- **Setup in each scenario:** before mount, `page.addInitScript` that defines `window.harnessDesktop={openExternal:async url=>{(window as any).opened.push(url);}}` and `window.opened=[]` (exercises R05 desktop path), plus one scenario without it that stubs `window.open` to record arguments. Output is supplied through the existing `create`/`read` routes. Find a link cell position by scanning `terminalFixture.instances[0].buffer.active` for the URL and converting column/row to pixels from `.xterm-screen` bounding box divided by `cols`/`rows`.
- **Scenarios (each asserts `api.blocked` and `api.errors` empty and no `input` command in `api.requests`):**
  1. Output `see https://example.com/docs?a=1 for details`: hover → `.terminal-link-hint` visible with `Ctrl+click to open`; `page.mouse.click(x,y,{modifiers:['Control']})` → `opened` equals `['https://example.com/docs?a=1']`.
  2. Plain click on the same cell → `opened` empty; drag across the URL → `getSelection()` contains the URL.
  3. Unsafe text `javascript:alert(1) file:///etc/passwd ftp://x.example` → Ctrl+click on each → `opened` empty; no hint.
  4. Wrapped URL: output a 200-character `https://example.com/…` URL in an 80-column terminal → Ctrl+click on the second row → full URL opened.
  5. OSC 8: output `\x1b]8;;https://example.com/osc\x1b\\label\x1b]8;;\x1b\\` → Ctrl+click on `label` opens `https://example.com/osc`; plain click → `page.on('dialog')` never fires and `opened` empty.
  6. Browser host path (no `harnessDesktop`): stubbed `window.open` receives `('https://example.com/docs?a=1','_blank','noopener,noreferrer')`.
  7. Failure: `openExternal` rejects → hint shows `Could not open link` with `data-state=failed`, gone after 4 s (use `page.clock` if the suite allows; otherwise wait); the New terminal button does not appear.
  8. Ended terminal (`exited:true` route) → links still open.
  9. Extend the narrow 320px dark/light reduced-motion test: hover a link so the hint shows; assert no horizontal overflow, all buttons within 320px, zero running animations; screenshots `05-${theme}-narrow-link-hint.png` and a 1000×760 `06-${theme}-link-hint.png` via `info.outputPath`.
- **Desktop check (manual, packaged Windows app):** run `pnpm dev` in a workspace terminal, Ctrl+click the localhost URL → system browser opens; record a short screen recording. Also click a reply link in a thread and record whether it opens (the out-of-scope finding); if it does not, open a separate issue describing it with the main.ts reference.
- **Done when:** `pnpm build && pnpm test:browser --suite terminal-read` passes locally; screenshots and the recording are on the PR.

### T06 Front end team review (required by the maintainer)
- **Goal:** send the finished work (PR link, T05 screenshots, the desktop recording) to the front end team for review and record their verdict on this issue.
- **Depends on:** T05.
- **Done when:** the front end team's review is linked or summarized on this issue and requested changes are resolved. The issue stays open until then.

## VALIDATION

### Commands (planned, none executed yet)

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test:ui-guard
pnpm exec vitest run tests/terminal-links.test.ts tests/public-source.test.ts --maxWorkers=1
pnpm exec vitest run <desktop policy test touched in T04> --maxWorkers=1
pnpm build && pnpm test:browser --suite terminal-read
```

### Acceptance matrix

| Req | Check | Task |
|---|---|---|
| R01 | exact pin in `package.json`; lockfile updated; suite still green | T01 |
| R02 | browser 1, 3, 4 | T05 |
| R03 | unit modifier cases; browser 1, 2 | T02, T05 |
| R04 | unit URL cases; browser 3 | T02, T05 |
| R05 | unit opener cases; browser 1 (desktop stub), 6 (browser host) | T02, T05 |
| R06 | desktop unit tests; packaged-app manual check | T04, T05 |
| R07 | browser 5 (no dialog, Ctrl+click opens) | T03, T05 |
| R08 | browser 1, 9; screenshots | T03, T05 |
| R09 | browser 7 | T03, T05 |
| R10 | every browser scenario: no `input` command; browser 2 selection; browser 8 ended | T05 |
| R11 | browser: activation after `terminalFixture.revoke()` opens nothing (add to scenario 1) | T03, T05 |
| Visual/motion | screenshots dark/light, narrow, reduced motion; front end review | T05, T06 |

Release gate: all commands pass, screenshots and desktop recording on the PR, T06 review recorded. Browser fixtures do not prove packaged Windows behavior; the desktop manual check is recorded separately in the PR.

## STATE

- Researched and decided: everything above (r1). Implemented: nothing. Verified: nothing.
- Owners/branches: none yet. Plan file branch `devin/terminal-links-plan` (docs-only PR).
- Coordination: [#1476](https://github.com/skytuhua-org/Gen-V1/issues/1476) (Find in terminal output) edits the same `TerminalBody.tsx` effect, toolbar, `package.json` and spec. Whichever lands second rebases; the two features touch different xterm hooks (search addon/custom key handler vs link provider/`linkHandler`) and different toolbar elements. If both are in progress at once, the later claimant comments on both issues per AGENTS.md.
- Risks: (1) addon 0.12.0 has no declared peer dependency; compatibility with xterm 6.0.0 is inferred from the shared release tag and must be confirmed by T01's test run. (2) Pixel-targeting xterm cells in Playwright can be flaky; compute positions from the buffer and screen box as described, not hard-coded coordinates. (3) Desktop `shell.openExternal` hands the URL to the OS; validation in the main process is the security boundary.
- Next step: an implementing agent claims this issue per AGENTS.md and starts T01.

## REFERENCES

- xterm.js web-links addon at the pinned release tag: https://github.com/xtermjs/xterm.js/tree/6.0.0/addons/addon-web-links (`typings/addon-web-links.d.ts`: `new WebLinksAddon(handler?, {hover?, leave?, urlRegex?})`; `src/WebLinksAddon.ts`: `strictUrlRegex`, default handler opens `window.open()` and nulls `opener`, with a note about reverse tabnapping; `src/WebLinkProvider.ts`: `isUrl` check via `new URL`). npm `@xterm/addon-web-links` latest `0.12.0`, MIT, published 2025-12-22.
- xterm.js OSC 8 handling at tag 6.0.0: `src/browser/OscLinkProvider.ts` (`linkHandler` option; without it `defaultActivate` shows `confirm()` then opens a window); `typings/xterm.d.ts` `ILinkHandler { activate, hover?, leave?, allowNonHttpProtocols? }`.
- VS Code terminal links: https://code.visualstudio.com/docs/terminal/basics#_links (Ctrl/Cmd+click follows a link).
- Claude Code request #95907: https://github.com/anthropics/claude-code/issues/95907 (user demand for clickable terminal URLs).
- Repository files listed in REPO_MAP at `4ca1134ae1e4f354064457cb5664b545712da4a9`; `DESIGN.md` motion and overlay rules; `AGENTS.md` publication and checkpoint contract.
