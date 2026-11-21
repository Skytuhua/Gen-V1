# Plan: Quick-ask hotkey

## META

| Field | Value |
|---|---|
| Feature | A global shortcut that opens a small always-on-top composer from anywhere and sends the prompt into a new thread or the current thread |
| Size | small (labels `feature`, `small`); no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | https://github.com/skytuhua-org/Gen-V1/issues/1332 |
| Plan file | `docs/agent-plans/quick-ask-hotkey.md` (identical to the issue body below the file link) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified by `git fetch` + `git rev-parse origin/main` on 2026-11-21) |
| Related work | No existing issue or PR for a quick-ask window, global shortcut or hotkey (searched issues for "hotkey", "quick-ask", "quick ask"; `rg -n 'globalShortcut|quick.ask|hotkey' apps packages docs/progress.md` finds no implementation). Sibling batch 3 features are planned in their own issues (keep the PC awake, taskbar progress and jump list, fix failing CI, secret check, edit files by hand, image generation, database browser, dev containers). `docs/progress.md` M01–M17 contain no hotkey/quick-ask milestone. |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 3, item 2: "Quick-ask hotkey (S): A global shortcut that opens a small always-on-top composer from anywhere and sends into a new or current thread." Evidence cited by the proposal: the ChatGPT Windows app made Alt+Space its signature feature ([OpenAI help](https://help.openai.com/en/articles/9982051-using-the-chatgpt-windows-app)); Gen registers no `globalShortcut` but already builds a small always-on-top window for notifications. Repository facts below were read at the baseline SHA; line numbers refer to it. Decisions marked **DECIDED** were made by the planner (the owner delegated every non-approval decision); options not taken are recorded. |

**Design and animation ownership (batch 3 rule).** For this batch there is no separate front end team designing the feature: **this plan specifies the visual design and animation** (DESIGN §6–§7), and implementers build exactly that. Leonardo asked that the finished work then be **handed to the front end team for review**: task T08 does that, and the issue is not complete until their review is recorded.

## OBJECTIVE

**User problem.** To ask Gen V1 something today the user must find the Gen V1 window, pick or create a thread and click into the composer. Quick questions while working in another app (an editor, a browser, a terminal) cost a context switch. Competing desktop assistants solve this with a system-wide hotkey that pops a small composer over whatever is on screen.

**Intended behavior.**
1. With the feature enabled (Settings → General → **Quick ask**), pressing the shortcut (default `Alt+Space`) anywhere in Windows shows a small always-on-top, focused composer centred near the top of the display that holds the mouse pointer.
2. The user types a prompt and chooses the target: **New thread** (default) in the current project, or **Current thread** (the thread selected in the main Gen V1 window).
3. Enter sends. On acknowledgement the quick-ask window hides, the main Gen V1 window is restored and focused on the target thread, and the run streams there as usual.
4. Esc, the shortcut again, or clicking elsewhere hides the window without losing the draft.

**Measurable success.**
1. On a packaged Windows build, the shortcut opens the window with the text box focused in ≤ 300 ms after first use (window pre-created and reused) (T08 native check).
2. A prompt sent to New thread creates exactly one thread in the chosen project and one user message; a prompt sent to Current thread appends exactly one message to that thread (unit T04 + browser T07).
3. A failed send keeps the draft and shows an inline error with Retry; no duplicate message is created on retry (unit T04, browser T07).
4. If the shortcut cannot be registered (taken by another app or invalid), Settings shows that state and the app keeps working (unit T02/T03, browser T07).
5. No regression in the suites listed in VALIDATION, including keyboard-bindings, attention-popups, desktop-native and the UI guard.

## REQUIREMENTS

### In scope

- R01 New global (OS-wide) shortcut, registered through Electron `globalShortcut` in the desktop main process only. The browser (non-desktop) build shows no quick-ask setting and registers nothing.
- R02 Preferences: `quickAskEnabled: boolean` (default `false`, D1) and keybinding `keybindings.quickAsk: string` (default `'Alt+Space'`, D2), validated and merged by the existing `preferencesSchema` / `mergePreferences` in `packages/contracts/preferences.ts`.
- R03 Settings → General → **Quick ask** group (desktop only): a switch "Open quick ask from anywhere", a shortcut recorder (existing `ShortcutInput`), and a status line showing the registration result (`Ready`, `In use by another app`, `Not a valid system shortcut`, `Off`). Searchable in settings search (settings-inventory) with terms `quick ask, hotkey, global shortcut, alt space`.
- R04 Shortcut rules (D3): must contain at least one of `Ctrl`, `Alt`, `Meta` (Shift alone is not enough); `Escape`, `Enter`, `Tab`, `Backspace` and bare letters are rejected; function keys `F1`–`F24` are allowed with or without a modifier. Canonical chords are converted to Electron accelerators by a pure function (DESIGN §3). Invalid or unregistrable shortcuts never crash the app and leave no partial registration.
- R05 Quick-ask window: one native window, created lazily on first trigger and reused (hidden, not destroyed) until quit. Frameless, always-on-top at `'floating'` level, skip taskbar, **focusable** (unlike the attention popup), not resizable or movable by the user, never part of saved layouts, layout profiles, the 24-window count or `captureLayout`.
- R06 Trigger behavior: shortcut when hidden → position + show + focus text box; shortcut when visible and focused → hide; shortcut when visible but not focused → focus.
- R07 Composer: multi-line text box (grows 1→6 lines, then scrolls), target switch (New thread / Current thread), project label, send button, keyboard hint line. Honours the existing `sendShortcut` preference (`enter` / `mod-enter-multiline` / `mod-enter`) exactly as the main composer does.
- R08 Target rules (D4): **New thread** uses the project of the thread selected in the main window, else the most recently active project; **Current thread** uses the thread selected in the main window and is disabled (with reason) when there is none or when that thread cannot accept a message (running, stopped without resume, or a model/account is unavailable). Last chosen target is remembered for the app session (main-process memory), not persisted.
- R09 Model: a new thread uses the same default model the main composer would pick for a new thread; the current thread uses its own model. No model picker in the quick-ask window (D5).
- R10 Send semantics: reuse `command('thread.create', …)` and `command('message.send', …)` from `apps/web/src/api.ts` with one stable `commandId` per attempt; the draft clears only after the host acknowledges the send (DESIGN.md "retain edits until host ack").
- R11 After a successful send: hide the window, restore/focus the main window and select the target thread through the existing selection delivery used by notification clicks (`channels.attentionSelected` → `onAttentionOpen` → `select(id)`, `main.ts:218–223`, `App.tsx:1093`).
- R12 Dismiss: Esc, shortcut, or window blur hides the window and keeps the draft for the next open (in renderer memory for the app session). Draft is discarded only after a successful send or app quit.
- R13 No-project state: when no local project exists, the window shows "Add a project in Gen V1 first" with an **Open Gen V1** button (focuses main window) instead of the composer.
- R14 Errors: thread creation or send failure shows an inline error under the text box with **Retry**; Retry reuses the same `commandId` (no duplicate message). If a new thread was created but the send failed, Retry sends into that thread instead of creating another.
- R15 Accessibility: the window has `role="dialog"`, `aria-label="Quick ask"`; text box labelled "Ask Gen V1"; target switch is a radio group; status and errors use `aria-live="polite"`; full keyboard operation (Tab order: target switch → text box → send); `Escape` always hides.
- R16 Security: the window loads the same trusted renderer URL as other surfaces (`persist:harness` partition, sandbox, contextIsolation, no nodeIntegration), passes `authorize()` like other windows, denies navigation/new windows/permissions as `openSurface` does, and exposes no new privileged capability beyond hide/resize/context/sent IPC listed in DESIGN §4.
- R17 Visual design and animation exactly as DESIGN §6–§7, using existing tokens (`apps/web/src/styles.css`, `packages/ui-shell/tokens.css`), dark and light themes, reduced-motion and motion-off variants.
- R18 Lifecycle: shortcut registered at startup from the cached config, re-registered on every preference change, and unregistered (`globalShortcut.unregister(accelerator)`, never `unregisterAll`) during `closeApplication()` before windows are destroyed.
- R19 The keyboard reference (`KeyboardReference.tsx`) lists the new binding under a new **System** scope with the live chord, desktop only.
- R20 Hand-off: the finished work goes to the front end team for review (T08) before the issue is closed.

### Out of scope (v1)

- Showing the answer inside the quick-ask window (companion chat view). v1 always opens the main window on send.
- Attachments, screenshots, @-mentions, skills, model or thinking-level picker in the quick-ask window.
- macOS/Linux-specific polish (code is cross-platform via Electron, but acceptance is Windows only, which is the shipped platform).
- Starting Gen V1 from the hotkey when the app is not running (no OS-level registration outside Electron).
- Persisting the quick-ask draft across restarts.

### Decisions (DECIDED by planner)

- D1 Off by default. `Alt+Space` normally opens the Windows window menu in every app, and PowerToys Run uses the same chord; taking it silently would break user habits. Option not taken: on by default like ChatGPT.
- D2 Default chord `Alt+Space` (matches the proposal and ChatGPT). When registration fails the status line suggests `Ctrl+Alt+Space`.
- D3 Validation rules in R04. Option not taken: allow any chord.
- D4 Default target New thread (ChatGPT companion behavior: quick questions are usually unrelated to the open thread).
- D5 No model picker; keeps the window small. Option not taken: compact model chip.
- D6 Render the window with the existing web app (new desktop surface kind routed by `DesktopEntry.tsx`), not with generated `data:` HTML like the attention popup, because sending needs the authenticated same-origin API (`apps/web/src/api.ts:115–124`), which the `data:` popup cannot reach (`attention-popups.ts:44–46`, CSP `connect-src 'none'`).
- D7 Window pre-created on first trigger, then hidden/reused, so later opens are instant. Option not taken: create at startup (wastes memory when feature unused).
- D8 Main process learns preferences from the main window renderer via IPC and caches the last config in `userData/quick-ask.json`, so the shortcut works right after startup. Option not taken: main process polling the backend settings.
- D9 Hide on blur. Option not taken: stay pinned until Esc.

### Compatibility, performance, privacy

- Preferences migration: `readPreferences` already fills missing fields with defaults; new fields need defaults only, no migration script. Older stored preferences without `quickAsk` read as defaults.
- Performance: no work when disabled (no window, one cached-config read at startup). The window is one extra renderer only after first use.
- Privacy: the window shows the current project name and current thread title only; no message content is shown or sent anywhere except through the normal `message.send` path.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | File:line | Fact |
|---|---|---|
| Desktop lifecycle | `apps/desktop/main.ts:376–392` | single-instance lock, `second-instance` → `mainWindow()`, `whenReady()` loads saved layout, registers IPC, installs menu/tray, opens main, starts updater/attention. |
| Shutdown | `apps/desktop/main.ts:358–373` | `closeApplication()` asks renderers, flushes persistence, sets `quitting`, stops attention, destroys windows, stops tray. Hook unregister here. |
| Surface creation | `apps/desktop/main.ts:152–194` | `openSurface()` parses surface, reuses keyed window, 24-window limit, creates hidden `BrowserWindow` (`persist:harness`, sandbox), loads URL, readiness promise with 20 s deadline, renderer-crash recovery. |
| Attention popup window | `apps/desktop/main.ts:225–231` | 364×132 frameless, `focusable:false`, `alwaysOnTop:true`, `skipTaskbar`, `transparent`, `partition:'gen-attention'`, `setAlwaysOnTop(true,'floating')`, `data:` HTML. Pattern to copy for native options except focusable/partition/URL. |
| Attention placement | `apps/desktop/attention-popups.ts:15–22` | display choice + work-area clamping helpers; pure controller tested with a fake window (`tests/attention-popups.test.ts`). |
| Thread selection IPC | `apps/desktop/main.ts:218–223`; `apps/desktop/preload.ts:17`; `apps/web/src/App.tsx:1093` | notification click: restore/focus main, send `channels.attentionSelected,{threadId}`, renderer selects. Reuse for R11. |
| Focus main | `apps/desktop/main.ts:201` | `mainWindow()` restores/shows/focuses/awaits ready. |
| IPC authorize | `apps/desktop/main.ts:81–85` | `authorize(event)` requires a registered window record with a trusted URL and main frame. |
| Channels + bridge | `packages/desktop-contract/index.ts:4–12` (surface kinds), `:25–50` (`DesktopBridge`), `:51` (channel names `harness-desktop:*`) | add `quick-ask` surface kind and channels here. |
| Preload | `apps/desktop/preload.ts:14–28` | frozen `window.harnessDesktop`; `ipcRenderer.invoke` + `on/removeListener` subscriptions. |
| Surface policy | `apps/desktop/window-policy.ts:36, :70` | `desktopSurfaceAllowed`; `surfaceSize()` per kind. |
| Web entry | `apps/web/src/main.tsx:1–9`; `apps/web/src/DesktopEntry.tsx:56` | `DesktopEntry` reads `getContext()` surface and picks the component; add the `quick-ask` branch. |
| Web bridge type | `apps/web/src/desktop-context.tsx:2–10` | `Window.harnessDesktop?: DesktopBridge`; `useDesktop()`. |
| Keyboard registry | `apps/web/src/keyboard-bindings.ts:4–20, 25–48, 51–52, 55–111` | scopes, `KEYBOARD_BINDINGS`, `PREFERENCE_BINDINGS`, `readChord`, formatting. `Global` means workspace-wide, not OS-wide. |
| Keyboard tests | `tests/keyboard-bindings.test.ts:79–175` | unique ids, scopes, preference coverage, handler path checks, formatting, reference rendering. |
| Keyboard reference | `apps/web/src/KeyboardReference.tsx:6–15` | registry-derived grouped rows. |
| Preferences | `packages/contracts/preferences.ts:30–32` (keybindings schema), `:54–78` (defaults), `:79–110` (merge/read) | strict schema; patches deep-merge keybindings. |
| Settings | `apps/web/src/Settings.tsx:41–83` (rows), `:87–89` (`ShortcutInput`), `:100` (`useDesktop()`), `:140–164` (persist via `command('settings.update')`), `:162,202` (desktop-conditioned notification copy) | |
| Settings search | `apps/web/src/settings-inventory.ts:3–6,144–146`; `apps/web/src/settings-registry.ts:3–38` (`platform:'all'|'desktop'|'browser'`, empty `PLATFORM_OVERRIDES`) | |
| Thread create / send | `apps/web/src/App.tsx:765–784` (`createThread`), `:367–386` (composer submit, draft cleared after ack); `apps/web/src/api.ts:115–124` (`command`); `packages/core/service.ts:1114–1125` (`thread.create`), `:1483–1504` (`sendMessage` preconditions) | |
| Current selection | `apps/web/src/App.tsx:508` (selectedId, localStorage `harness:selected-thread`), `:648–653`, `:761`, `:955–968` | selection lives in the main renderer; main process has no current-thread register. |
| Composer | `apps/web/src/App.tsx:256` (local `Composer`, not exported), `apps/web/src/ComposerView.tsx:4–5` (presentational form), `apps/web/src/agents-workspace/composer.ts:237` | quick-ask builds its own small component on `ComposerView`. |
| Tokens | `apps/web/src/styles.css:3–6`; `packages/ui-shell/tokens.css:2–71`; `DESIGN.md:48–99` | colors, spacing, `--ui-ease-enter`, popup enter 180 ms / exit 140 ms, reduced-motion rules. |
| UI guard | `scripts/ui-guard-policy.md:5–15`; `scripts/ui-overlay-legacy.json`; `scripts/ui-guard.ts:188–190,234–236` | no ad-hoc overlay roles/fixed geometry outside shared primitives; no literal duration/curve duplicates. |
| Tests infra | `tests/attention-popups.test.ts`, `tests/desktop-native.test.ts`, `tests/desktop-preload-accounts.test.ts`, `tests/desktop-state-broadcast.test.ts`; `playwright.config.ts`; `tests/e2e/desktop-surfaces.playwright.config.ts` | |
| Source manifest | `CONTRIBUTING.md:47–48`; `scripts/public-source-files.json` | every new source file must be listed (source, and runtime when packaged). |
| Electron | `package.json:75` | `electron` 45.2.0 (has `globalShortcut`, `screen.getCursorScreenPoint`). |

DISCOVERY items (verify before editing, record findings in the T01 checkpoint):
- X1 How `openSurface` builds the renderer URL for a surface (`main.ts:152–194`) and whether a quick-ask window can be created through it with overridden native options, or needs a dedicated creator that still registers a `WindowRecord` so `authorize()` accepts it.
- X2 How the main composer chooses the default model for a new thread (`App.tsx` `modelId` state / `snapshot.settings.modelId`, `App.tsx:113,308`) so quick-ask uses the same rule.
- X3 How `tests/keyboard-bindings.test.ts` checks `handlers` paths, so a `System` binding whose handler is `apps/desktop/quick-ask.ts` (no `matchesShortcut` call) is accepted.
- X4 Whether the UI guard flags `role="dialog"` in a new file; if so, use the shared dialog/surface primitive from `packages/ui-shell` instead of a raw role.

## DESIGN

### 1. Contracts and preferences (T02)

`packages/contracts/preferences.ts`:
```ts
const keybindings = z.strictObject({ /* existing */ quickAsk: z.string().min(1).max(80) });
// preferencesSchema: add
quickAskEnabled: z.boolean(),
// DEFAULT_PREFERENCES: add
quickAskEnabled: false,
keybindings: { /* existing */ quickAsk: 'Alt+Space' },
```

`packages/desktop-contract/index.ts`:
```ts
// surface kind
{ kind: 'quick-ask' }
export type QuickAskRegistration = 'off' | 'ready' | 'in-use' | 'invalid';
export interface QuickAskConfig { enabled: boolean; shortcut: string }          // canonical chord
export interface QuickAskContext {                                               // main window -> main process
  currentThreadId: string | null; currentThreadTitle: string | null;
  currentThreadSendable: boolean; currentProjectId: string | null; currentProjectName: string | null;
}
export interface QuickAskOpen extends QuickAskContext { target: 'new' | 'current' } // main process -> quick-ask renderer
// DesktopBridge additions
setQuickAskConfig(config: QuickAskConfig): Promise<QuickAskRegistration>;      // main window only
setQuickAskContext(context: QuickAskContext): Promise<void>;                   // main window only
onQuickAskRegistration(listener: (state: QuickAskRegistration) => void): () => void;
quickAskHide(): Promise<void>;                                                  // quick-ask window only
quickAskResize(height: number): Promise<void>;                                  // quick-ask window only, 72..280
quickAskSent(result: { threadId: string; target: 'new' | 'current' }): Promise<void>; // quick-ask window only
onQuickAskOpen(listener: (value: QuickAskOpen) => void): () => void;           // quick-ask window only
// channels: 'harness-desktop:quick-ask-config', ':quick-ask-context', ':quick-ask-registration',
//           ':quick-ask-hide', ':quick-ask-resize', ':quick-ask-sent', ':quick-ask-open'
```
Main-process handlers validate payload shape strictly (string lengths ≤ 200, height integer in range, `threadId` matches the existing id format) and check the sender surface kind (`main` for config/context, `quick-ask` for hide/resize/sent); anything else throws `Desktop request denied`.

### 2. Shortcut coordinator (T03, new `apps/desktop/quick-ask.ts`)

Pure, injectable controller like `createAttentionPopups`:
```ts
export function toElectronAccelerator(chord: string): string | null; // DESIGN §3
export function createQuickAsk(adapter: {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  readCache(): Promise<QuickAskConfig | null>; writeCache(config: QuickAskConfig): Promise<void>;
  cursorWorkArea(): {x:number;y:number;width:number;height:number};
  window(): QuickAskWindowAdapter;       // lazily creates; show/hide/focus/isVisible/isFocused/setBounds/send
  focusMainAndSelect(threadId: string): Promise<void>;
  broadcastRegistration(state: QuickAskRegistration): void;
}): {
  start(): Promise<void>; configure(config: QuickAskConfig): QuickAskRegistration;
  setContext(context: QuickAskContext): void; trigger(): void; hide(): void;
  resize(height: number): void; sent(result: {threadId:string; target:'new'|'current'}): Promise<void>; stop(): void;
};
```
State machine: `configure` unregisters the previous accelerator (if any), then: disabled → `off`; `toElectronAccelerator` null → `invalid`; `register` false or throws → `in-use`; else `ready`. Writes cache on every configure. `trigger` implements R06. `sent` hides, remembers target, calls `focusMainAndSelect`. `stop` unregisters and destroys the window.

`main.ts` wiring: create the coordinator after IPC registration in `whenReady`, call `start()` (reads cache and configures), wire adapter to `globalShortcut`, `screen`, a dedicated `BrowserWindow` (DESIGN §5), and the existing attention-selected path; call `stop()` in `closeApplication()` before windows are destroyed.

### 3. Chord → accelerator

Input is the canonical chord stored by `ShortcutInput` (parse with `readChord`). Modifiers: `ctrl`→`CommandOrControl`, `alt`→`Alt`, `shift`→`Shift`, `meta`→`Super`. Keys: `a`–`z`→uppercase, `0`–`9`, `f1`–`f24`→`F1`…, `space`→`Space`, `comma`→`,`, `period`→`.`, `slash`→`/`, `arrowup|down|left|right`→`Up|Down|Left|Right`, `+`→`Plus`, `minus`→`-`, `equal`→`=`. Anything else → `null`. Then apply R04 rules (null when broken). Examples: `Alt+Space`→`Alt+Space`; `Ctrl+Shift+K`→`CommandOrControl+Shift+K`; `F9`→`F9`; `Shift+A`→null; `Escape`→null; `Ctrl+Enter`→null. Exact canonical key names used by `ShortcutInput` must be read from `Settings.tsx:87–89` / `keyboard-bindings.ts:55–84` and the table adjusted to them (T03 step 1).

### 4. Renderer side (T04–T06)

Main window (`App.tsx`, desktop only): an effect calls `setQuickAskConfig({enabled: preferences.quickAskEnabled, shortcut: preferences.keybindings.quickAsk})` on load and whenever those two values change; another effect calls `setQuickAskContext(...)` when the selected thread, its title/run state, or its project changes. `currentThreadSendable` mirrors the preconditions the main composer uses to enable Send (running, stopped without resume, model unavailable → false).

Quick-ask window (`apps/web/src/QuickAsk.tsx`, new; routed from `DesktopEntry.tsx` when `surface.kind === 'quick-ask'`):
- On `onQuickAskOpen(value)`: store context, set target (`value.target`, forced to `new` when current is not sendable), focus the text box, select-all is **not** applied (draft preserved, caret at end).
- Height: measure content and call `quickAskResize(h)` (debounced to animation frame) when it changes.
- Send (New thread): `command('thread.create', {projectId})` → threadId → `command('message.send', {content, modelId, thinkingLevel: null}, threadId, commandId)`.
- Send (Current thread): `command('message.send', {content, modelId: thread.modelId}, currentThreadId, commandId)`.
- `commandId` = `crypto.randomUUID()` created when the user presses Send and kept for Retry (R14). On ack: clear draft, `quickAskSent({threadId, target})`.
- Esc / blur: `quickAskHide()`; blur is detected in main (`native.on('blur')`) and calls `coordinator.hide()`.
- The exact `message.send` payload fields must match the main composer's call at `App.tsx:367–386`; copy those field names, do not invent new ones.

### 5. Native window (T03/T05)

Options: `width: 640`, initial `height: 72`, `frame:false`, `transparent:true`, `hasShadow:true`, `resizable:false`, `movable:false`, `minimizable:false`, `maximizable:false`, `fullscreenable:false`, `skipTaskbar:true`, `alwaysOnTop:true` + `setAlwaysOnTop(true,'floating')`, `focusable:true`, `show:false`, `title:'Gen V1 quick ask'`, `backgroundColor:'#00000000'`, same `webPreferences` as `openSurface` (`persist:harness`, sandbox, contextIsolation, no nodeIntegration, preload). Navigation/new-window/permission handlers as in `openSurface`. Excluded from `captureLayout`, `remember`, saved layout and the 24-window limit.

Placement on each show: work area of the display containing `screen.getCursorScreenPoint()`; `x = area.x + round((area.width - 640)/2)`; `y = area.y + round(area.height * 0.22)`; width clamps to `min(640, area.width - 32)`. Resize keeps the top edge fixed and grows downward (heights 72–280).

### 6. Visual design (DECIDED, R17)

All values use existing tokens; names in brackets are CSS variables from `styles.css` / `tokens.css` (T05 step 1 confirms the exact variable names and substitutes the nearest existing token if a name differs; no new hard-coded colors).

```
┌──────────────────────────────────────────────────────────────┐  640 px wide, radius 12 px
│ (●New thread  ○Current thread)          Project: gen-website │  header row, 32 px
│ ┌──────────────────────────────────────────────────────┐ (↑) │  text box + 32 px round send
│ │ Ask Gen V1…                                          │     │
│ └──────────────────────────────────────────────────────┘     │
│ Enter to send · Shift+Enter for a new line · Esc to close    │  hint row, 12 px muted
└──────────────────────────────────────────────────────────────┘
```
- Panel: background surface (`#0f0f0f` dark / theme surface light), 1 px border (`#282828` dark / theme border light), radius 12 px, padding 12 px (panel inset), gap 8 px between rows, native shadow (`hasShadow`) plus CSS shadow `0 8px 24px rgba(0,0,0,.35)` only if an existing shadow token exists (else native shadow only).
- Header row: target switch as a compact 2-option segmented control (shared segmented/radio primitive if one exists in `packages/ui-shell`, else two buttons with `role="radio"` inside `role="radiogroup"`), 28 px tall, control radius from preference `controlRadius`; selected option uses accent (`#91a7ff`) text + subtle background (`#171717`); disabled Current thread shows tooltip/description "No thread is open in Gen V1" or "This thread is busy". Right side: muted text "Project: <name>" (ellipsis at 200 px) for New thread, or "Thread: <title>" for Current thread.
- Text box: transparent background, no border, UI font, chat font size preference (`chatFontSize`, default 14 px), line-height 20 px, 1–6 rows auto-grow then scroll, placeholder "Ask Gen V1…" in muted color (`#a0a0a0`). Caret in accent color.
- Send button: 32 px circle, accent background, up-arrow icon from the existing icon set, disabled (40% opacity, no pointer) when text is empty or sending. While sending: icon replaced by the existing small spinner primitive, text box read-only.
- Hint row: 12 px muted text; text follows `sendShortcut` preference (e.g. "Ctrl+Enter to send · Enter for a new line · Esc to close"), formatted with `keyboard-bindings.ts` formatter.
- Error: replaces hint row; 12 px danger-status color token + error icon (status beyond color), message text and a text button **Retry**.
- No-project state: header hidden; body text "Add a project in Gen V1 first" and a secondary button **Open Gen V1**.
- Light theme follows the main app theme (`setTheme` / theme context); high-contrast preference uses the existing high-contrast variables.
- Respect `controlRadius`, `density` (compact reduces panel padding to 8 px), `uiFontSize`.

### 7. Animation (DECIDED, R17)

- Open: panel opacity 0→1 and `translateY(-6px)`→0 over the popup-enter duration token (180 ms) with `--ui-ease-enter`. The native window is shown at full size first; only the inner panel animates (no native window animation).
- Close: opacity 1→0 over the popup-exit token (140 ms), then `quickAskHide()` hides the native window; a second trigger during close cancels the fade and stays open (interruptible).
- Height change: no animation (native `setBounds` is immediate; animating native size causes jank).
- Send pressed: button press feedback uses the existing press token (80 ms). Spinner appears only after the request is in flight (real loading only).
- Error row: opacity fade-in 140 ms; no shake.
- `motion: 'reduced'` (or OS reduced motion when `system`): open/close are opacity only, ≤ 80 ms, no translate. `motion: 'off'` or `panelAnimations: false`: no transitions. `motionSpeed` scales durations exactly as other surfaces do (reuse the existing token multiplier, do not reimplement).
- Use token variables only; no literal durations/curves (UI guard `ui-guard.ts:188–190,234–236`).

### 8. Settings and keyboard reference (T06)

- `Settings.tsx` General section: new **Quick ask** group rendered only when `useDesktop()` is true: switch (row id `quick-ask-enabled`, description "Press the shortcut in any app to ask Gen V1 without switching windows."), shortcut row (row id `quick-ask-shortcut`, existing `ShortcutInput`, disabled when switch off), status line bound to `onQuickAskRegistration` with copy: `ready` → "Ready. Press <chord> in any app."; `in-use` → "<chord> is used by another app. Choose another shortcut, for example Ctrl+Alt+Space."; `invalid` → "Use a shortcut with Ctrl, Alt or Win, for example Alt+Space."; `off` → nothing.
- The generic shortcuts list must not show `quickAsk` a second time: filter it out of the generic keybinding rows built from `PREFERENCE_BINDINGS` (keep it in the registry for the reference).
- `settings-inventory.ts`: entries for both rows with the R03 search terms; `settings-registry.ts` `PLATFORM_OVERRIDES` marks both `desktop`.
- `keyboard-bindings.ts`: add scope `'System'` (append to `KEYBOARD_SCOPES`, listed first in the reference) and binding `{id:'quick-ask', label:'Open quick ask from any app', scope:'System', preference:'quickAsk', handlers:['apps/desktop/quick-ask.ts']}`; `KeyboardReference.tsx` hides the System group in the browser build and shows "(off)" next to the chord when `quickAskEnabled` is false. Adapt `tests/keyboard-bindings.test.ts` (X3) so System-scope handlers are checked for a call to `toElectronAccelerator` instead of `matchesShortcut`.

### 9. Error, cancel, retry, rollback

- Registration failure: never throws out of `configure`; state is broadcast; old accelerator is already unregistered.
- Renderer crash in the quick-ask window: destroy it; next trigger recreates it (draft lost, acceptable).
- Send failure: see R14. Network/host unavailable: same inline error.
- Quit while visible: `stop()` hides and destroys; no close prompt (draft is session-only by design).
- Rollback: turning the setting off unregisters immediately; reverting the PR leaves only two unused preference fields, which `readPreferences` tolerates (strict schema: verify in T02 that removing fields later would still parse stored data — if `strictObject` rejects unknown stored keys, note it in the T02 checkpoint).

## EXECUTION_DAG

One implementing worker may do all tasks in order on one branch/PR; T04 and T06 can run in parallel after T02 (disjoint files).

### T01 — Verify assumptions and resolve DISCOVERY X1–X4
- Dependencies: none. Owner: implementing worker.
- Steps: rebase on current main; re-run `rg -n 'globalShortcut|quick.ask|hotkey' apps packages`; read the files in REPO_MAP at the new SHA; answer X1–X4; post a checkpoint on this issue with the answers and any line-number drift.
- Done when: checkpoint posted with X1–X4 answered; any contradiction with this plan raised as a plan revision before coding.

### T02 — Preferences and desktop contract
- Dependencies: T01. Files: `packages/contracts/preferences.ts`, `packages/desktop-contract/index.ts`, `apps/desktop/preload.ts`, `apps/desktop/window-policy.ts` (`surfaceSize` for `quick-ask` = 640×72).
- Steps: DESIGN §1; preload methods mirror existing invoke/on patterns with argument validation.
- Tests: extend existing preferences tests (discover with `rg -ln 'DEFAULT_PREFERENCES' tests`) — defaults, merge of `keybindings.quickAsk`, reject 81-char chord; extend `tests/desktop-preload-accounts.test.ts` pattern for new bridge methods (reject bad height, bad threadId).
- Done when: `pnpm typecheck` and the touched unit tests pass.

### T03 — Shortcut coordinator and native window
- Dependencies: T02. Files: new `apps/desktop/quick-ask.ts`, `apps/desktop/main.ts`, `scripts/public-source-files.json` (source + runtime).
- Steps: DESIGN §2, §3, §5; IPC handlers with sender-kind checks; unregister in `closeApplication()`.
- Tests: new `tests/quick-ask.test.ts` with fake adapter: accelerator table (all §3 examples), configure states off/ready/in-use/invalid, re-configure unregisters old, register throwing → in-use, trigger R06 three cases, placement math on two displays and a 600 px-wide display, resize clamp, sent → hide + focusMainAndSelect, stop unregisters. Negative: IPC from wrong surface kind rejected (unit-test the validator).
- Done when: `pnpm exec vitest run tests/quick-ask.test.ts tests/attention-popups.test.ts tests/desktop-native.test.ts --maxWorkers=1` passes.

### T04 — Quick-ask renderer behavior
- Dependencies: T02 (T03 for manual runs only). Files: new `apps/web/src/QuickAsk.tsx`, `apps/web/src/DesktopEntry.tsx`, `apps/web/src/App.tsx` (config/context effects), `scripts/public-source-files.json`.
- Steps: DESIGN §4; reuse `ComposerView`; send-key handling identical to the main composer's `sendShortcut` logic (extract to a shared helper only if it is a pure function today; otherwise call the same helper the composer uses).
- Tests: unit/component tests with mocked `command` and bridge: new-thread send creates then sends once; current-thread send; ack clears draft and calls `quickAskSent`; failure keeps draft and Retry reuses `commandId`; thread created + send failed → Retry sends to the same thread; Current disabled when not sendable; no-project state; Esc calls hide.
- Done when: tests pass and `pnpm typecheck` passes.

### T05 — Visual design and animation
- Dependencies: T04. Files: `QuickAsk.tsx` and its stylesheet (follow how sibling components import CSS; discover with `rg -n "import './.*\.css'" apps/web/src | head`).
- Steps: implement DESIGN §6–§7 exactly with tokens; dark, light, high-contrast; reduced/off motion.
- Tests: `pnpm lint` and `pnpm test:ui-guard` pass with no new entries in `scripts/ui-overlay-legacy.json`.
- Done when: guard green and screenshots captured in T07.

### T06 — Settings and keyboard reference
- Dependencies: T02 (registration status needs T03 for live runs). Files: `apps/web/src/Settings.tsx`, `settings-inventory.ts`, `settings-registry.ts`, `keyboard-bindings.ts`, `KeyboardReference.tsx`, `tests/keyboard-bindings.test.ts`.
- Steps: DESIGN §8.
- Tests: keyboard-bindings suite passes with the new System binding; settings search finds "hotkey" on desktop and not in browser; generic shortcut list does not duplicate quickAsk.
- Done when: `pnpm exec vitest run tests/keyboard-bindings.test.ts --maxWorkers=1` passes plus any settings tests found with `rg -ln 'settings-inventory|Settings' tests`.

### T07 — Browser coverage
- Dependencies: T04–T06. Files: new spec in `tests/e2e/` alongside `desktop-surfaces.spec.ts` (uses `tests/e2e/desktop-surfaces.playwright.config.ts` fixture with a stubbed `harnessDesktop` bridge — discover how that spec stubs the bridge).
- Scenarios: quick-ask surface renders composer; type + Enter sends to new thread (mock host) and calls `quickAskSent`; Current thread disabled state; error + Retry; Esc hides; Settings group visible only with bridge, status copy for each registration state; dark/light/reduced-motion screenshots (640 px panel) saved as evidence.
- Done when: `pnpm exec playwright test --config tests/e2e/desktop-surfaces.playwright.config.ts` passes.

### T08 — Native Windows acceptance, docs, front end team review
- Dependencies: T07. Files: `CHANGELOG.md`, the user-facing shortcuts/settings doc (discover with `rg -ln 'keyboard|shortcut' docs | head`).
- Steps: `pnpm desktop:build`; on Windows: enable Quick ask, press Alt+Space from Notepad and a browser, send to new and current thread, check focus returns to Gen V1 on the thread, Esc/blur keep draft, register a chord already used by another app (e.g. start PowerToys Run or another app holding Alt+Space) and confirm `in-use` status, quit and confirm the chord is released (another app can register it). Record a short screen recording.
- **Front end team review (requested by Leonardo):** open the PR as ready for review and hand it to the front end team for review of the visual design and animation, with the T07 screenshots, the native recording and a link to DESIGN §6–§7. Post a HANDOFF checkpoint on this issue naming the front end team as recipient. Apply their requested changes (revise this plan first if they change a decision).
- Done when: native checklist results posted, front end team review recorded on the PR, maintainer review requested; do not close the issue without authorization.

## VALIDATION

### Commands (planned; none executed by this planning session)
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test:ui-guard
pnpm exec vitest run tests/quick-ask.test.ts tests/keyboard-bindings.test.ts tests/attention-popups.test.ts tests/desktop-native.test.ts tests/desktop-preload-accounts.test.ts --maxWorkers=1
pnpm test:no-lease
pnpm exec playwright test --config tests/e2e/desktop-surfaces.playwright.config.ts
pnpm desktop:build   # then native Windows checks in T08
```

### Acceptance matrix

| Req | Tasks | Check |
|---|---|---|
| R01 | T03,T06,T08 | no registration in browser build; native register works |
| R02 | T02 | defaults/merge unit tests |
| R03 | T06,T07 | Settings group, status copy, search terms |
| R04 | T03 | accelerator table + rule tests |
| R05 | T03,T08 | native options, excluded from layout (unit on `captureLayout` input) |
| R06 | T03 | trigger state tests |
| R07 | T04,T07 | send-key behavior per `sendShortcut` |
| R08 | T04,T07 | target defaults and disabled reasons |
| R09 | T04 | model selection matches main composer (X2) |
| R10 | T04 | single commandId, draft cleared on ack only |
| R11 | T03,T08 | main focused on thread after send |
| R12 | T04,T08 | draft kept after Esc/blur |
| R13 | T04,T07 | no-project state |
| R14 | T04,T07 | retry without duplicates |
| R15 | T04,T07 | roles/labels, keyboard-only run |
| R16 | T02,T03 | sender-kind IPC tests; same webPreferences |
| R17 | T05,T07,T08 | screenshots match §6–§7; reduced/off motion; UI guard green |
| R18 | T03,T08 | unregister on quit (native) |
| R19 | T06 | reference shows System group on desktop only |
| R20 | T08 | front end team review recorded |

Release gate: all rows green, CI green, native Windows evidence attached, front end team review done. Rows that cannot run are marked NOT_RUN/BLOCKED, never assumed.

## STATE

- Researched/decided: everything above (planner, 2026-11-21). Implemented: nothing. Verified: nothing (no tests run; planning only).
- Owners/branches: none yet. The plan file is added by a docs PR (linked at the top of the issue).
- Risks: Alt+Space conflicts with the Windows window menu/PowerToys (mitigated by D1 off-by-default and the in-use status); `globalShortcut.register` may return true while another hook (e.g. low-level keyboard hooks) still intercepts — verify natively in T08; focus stealing rules on Windows may block `focus()` from a background process — verify in T08, fallback is `app.focus({steal:true})` only for this window if needed (record in checkpoint).
- Next step: T01 by the implementing worker.

## REFERENCES

- Proposal source: batch 3 feature list, item 2 (text quoted in META Provenance).
- ChatGPT Windows app Alt+Space companion: https://help.openai.com/en/articles/9982051-using-the-chatgpt-windows-app
- Electron `globalShortcut`: https://www.electronjs.org/docs/latest/api/global-shortcut
- Electron accelerators: https://www.electronjs.org/docs/latest/api/accelerator
- Electron `screen.getCursorScreenPoint`: https://www.electronjs.org/docs/latest/api/screen
- Repository: `AGENTS.md` (plan and checkpoint contract), `CONTRIBUTING.md`, `DESIGN.md`, `scripts/ui-guard-policy.md` at the baseline SHA.
