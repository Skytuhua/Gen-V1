# Plan: Taskbar progress and jump list

> **Visual design and animation are specified in this plan.** Leonardo (repository owner) said on 2026-11-21 that there is no front-end team designing batch 3 features, so this plan defines the visuals, copy and motion (see DESIGN section, VD-01..VD-08). Implementers follow them exactly; do not invent other visuals.
>
> **Front-end review on completion (required).** When the implementation is finished and verified, the implementing agent hands the finished work (PR link, commit SHA, screenshots of the taskbar states and jump list, and the Settings rows in dark/light) to Leonardo's front-end team for review before the issue is closed. T07 owns that handoff.

## META

| Field | Value |
|---|---|
| Feature | Taskbar progress (run progress, needs-input and failure states on the Windows taskbar button) and a Windows jump list with **New thread** and recent projects |
| Repository | skytuhua-org/Gen-V1 |
| Size / labels | small; `feature`, `small` |
| Revision / date | r1 / 2026-11-21 |
| Baseline | `origin/main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (fetched and verified 2026-11-21) |
| Planning branch | `devin/taskbar-jump-list-plan` (docs only) |
| Issue / PR | Canonical issue and docs PR links are recorded in the issue body header after publication |
| Implementation status | NOT_STARTED. No runtime, installer or UI code changed by this plan |
| Related work | #1286 “Open in Gen V1” in Windows File Explorer (plans a `--open-project` launch-argument parser and cold/warm delivery to the renderer, T02/T03 there). Batch 3 item 1 “Keep the PC awake during runs” and item 2 “Quick-ask hotkey” also edit `apps/desktop/main.ts`; their issues are planned in parallel (search open `feature` issues for “awake” and “hotkey”) |
| Provenance | Batch 3 feature proposals (research grounded in `main` @ `e883ac03`), item 3: “Taskbar progress and jump list (S): Show run progress, or red on failure, on the taskbar icon, and add "New thread" and recent projects to the right-click jump list. These are standard Windows integrations ([Electron Windows taskbar](https://www.electronjs.org/docs/latest/tutorial/windows-taskbar)). Gen uses neither `setProgressBar` nor `setJumpList`. Repo area: apps/desktop/main.ts.” Approved by Leonardo on 2026-11-21 (“alright create issues for all of them. Plan this out carefully. also tell the assigned agent to give to the front end team for review when finished”). Detailed decisions below were made by the planning agent; repository facts were read at the baseline |

## OBJECTIVE

**User problem.** Gen V1 runs long agent tasks while the user works in other windows. Today the only signals are the tray icon (static) and attention popups (which can be off, in quiet hours, or already gone). Looking at the taskbar tells the user nothing about whether a task is still running, waiting for them, or failed. Starting a new thread or returning to a project always needs the app window first.

**Intended behavior.**
1. While any task runs, the Gen V1 taskbar button shows Windows' native progress bar: determinate (green, filled to the share of completed plan steps) when plan steps exist, otherwise indeterminate (green, marquee).
2. When a task is waiting for user input or approval, the bar turns yellow (paused state).
3. When a task fails and the user has not yet seen it, the bar turns red and a small red overlay badge appears on the button; both clear when the user opens or dismisses the failure in Gen.
4. Right-clicking the taskbar or Start-menu entry shows a jump list with a **Tasks** entry **New thread** and a **Recent projects** category listing up to five recently active projects. Choosing one opens/focuses Gen V1 and starts a new thread, or opens that project.
5. Two Windows-only settings, both default on, turn each half off.

**Success (measurable).** On an installed Windows build: each taskbar state appears within 1 s of the backend state change and clears within 1 s of the clearing event; jump-list entries work on both cold launch (app closed) and warm launch (app running, including hidden to tray); no raw project paths are passed on any command line; turning a setting off removes its taskbar or jump-list effect within 1 s; ordinary launch and startup time are unchanged (no new blocking work before the main window opens).

## REQUIREMENTS

### Agreed scope and decisions

- **R01 — Windows only, packaged-aware.** Everything runs only when `process.platform==='win32'`. Jump-list registration additionally requires `app.isPackaged` (in dev, `process.execPath` is the bare Electron binary and jump-list tasks would launch the wrong program). Taskbar progress also works in unpackaged dev on Windows for local testing. No macOS dock or Linux launcher work.
- **R02 — Single aggregate taskbar state.** Main computes one state from backend facts with this precedence: `error` > `paused` > `normal` (determinate) / `indeterminate` > `none`.
  - *Active task*: a main or delegate thread where `runId` is set or `status` is `working`, or a thread with active planning children (the same thread conditions `isUpdateIdle()` already uses in `packages/core/service.ts:406–412`). Archived threads and side conversations (`kind:'side'`) never count.
  - *Needs input*: any non-archived thread with `status==='awaiting_input'`, or an unread attention item whose `state==='needs-input'`.
  - *Unseen failure*: an attention item of `kind:'thread-failed'` with `read===false` (from the existing attention store behind `harness.attention.read`). The failure clears when the item is read (opening the thread marks it read through existing attention flows) or dismissed. A thread that later succeeds again also clears it, because its failed item is resolved by the existing attention model; T01 verifies this and reports if it is not true.
  - *Progress value*: across active threads that have a current plan with ≥1 step, `completed steps / total steps` (step `status==='completed'`, or `state` in `completed|accepted`), clamped to [0.02, 0.98] while still active so a running task never looks finished or empty. If no active thread has plan steps, use indeterminate.
- **R03 — Error visual semantics.** `error` uses `setProgressBar(value,{mode:'error'})` where `value` is the current determinate progress if tasks are still active, else `1`. A red overlay badge (VD-03) is set with accessible description “A task failed”. `paused` uses `mode:'paused'` with the current value (or `1` if nothing has determinate progress). `none` calls `setProgressBar(-1)` and `setOverlayIcon(null,'')`.
- **R04 — Which window.** Taskbar state is applied to the main window only (`surface.kind==='main'`). Detached windows are not changed (Windows groups them on the same button; duplicating the bar flickers). If the main window is recreated (closed and restored from the tray), the current state is reapplied after the window is ready.
- **R05 — Update cadence and cost.** Main already receives workspace change sequences from `workspaceEvents` (`apps/desktop/main.ts:324`). On each sequence change, and every 15 s as a safety poll while any state other than `none` is shown, main requests one new private backend control `harness.taskbar.read` (R07). Coalesce: at most one request in flight; trailing re-read 250 ms after the last change. Apply native calls only when the computed state differs from the last applied state (compare mode, value rounded to 0.01, overlay presence). No timers while state is `none` and no changes arrive.
- **R06 — Jump list contents.**
  - Category **Tasks** (`type:'tasks'`): one item, title **New thread**, description **Start a new thread in Gen V1**, program `process.execPath`, args `--gen-jump=new-thread`, icon `process.execPath` index 0.
  - Category **Recent projects** (`type:'custom'`, name `Recent projects`): up to 5 projects, ordered by most recent activity (latest `updatedAt` of the project's non-archived main threads; projects with no threads ordered by their own enrollment time, if available — T01 discovers the field). Title = project display name, trimmed, control characters removed, max 60 code points with a trailing `…` when cut. Description = `Open <name> in Gen V1` (same truncation). Args `--gen-jump=open-project --gen-project-id=<id>` where `<id>` passes `desktopId()` from `packages/desktop-contract/index.ts`. **Never** put a filesystem path in args, title or description.
  - No `frequent`/`recent` system categories (Gen has no registered file types).
  - Items the user removed from the jump list (`app.getJumpListSettings().removedItems`) are not re-added: filter by identical `args`. If `setJumpList` returns anything other than `'ok'`, retry once with the Recent projects category omitted, then give up silently until the next refresh (record a non-sensitive diagnostic only when `HARNESS_DESKTOP_TEST_DATA_DIR` is set, following the existing `startupDiagnostic` pattern).
  - Refresh after backend startup (after `startBackend()` resolves in `app.whenReady`), and when `harness.taskbar.read` returns a different recent-project list (compare the ordered id+title list). Never on every sequence when unchanged.
- **R07 — Backend control `harness.taskbar.read`.** New private parent-IPC control with the same launch-token custody as the existing controls in `apps/server/desktop-controls.ts` (no HTTP route). Request: `{type:'harness.taskbar.read',token,requestId}` (exactly 3 keys). Response: `{type:'harness.taskbar.read.result',token,requestId,taskbar:{enabled:boolean,mode:'none'|'indeterminate'|'normal'|'paused'|'error',progress:number|null,failed:boolean},jumpList:{enabled:boolean,projects:Array<{id:string,name:string}>}}`; on any error `{...,error:'Taskbar status is unavailable.'}` and main keeps the last applied state for at most one failed read, then clears to `none`. The host computes the state (R02) so main never parses thread data. Validate the response in main with a strict zod schema in `packages/desktop-contract` (projects max 5, names max 160 before main's own truncation, ids via `desktopId`).
- **R08 — Launch arguments are untrusted.** A pure parser accepts only: exactly one `--gen-jump=new-thread`; or exactly one `--gen-jump=open-project` plus exactly one `--gen-project-id=<id>` passing `desktopId()`. Anything else (repeats, unknown values, missing id) yields “no request” plus a safe error for the open-project case only. It ignores all unrelated arguments (Chromium switches, `--open-project` owned by #1286). Bound total scanned argv to 64 entries / 8192 chars.
- **R09 — Cold and warm delivery.** Cold: parse `process.argv` once at startup. Warm: parse the argv passed to the existing `second-instance` handler (`apps/desktop/main.ts:377`, which today only calls `mainWindow()`), then restore/focus main and forward. Keep at most one pending request, latest wins, delivered only to the trusted main renderer after it subscribes and signals ready; acknowledge by request id; reset readiness when the main renderer reloads. **Share this mechanism with #1286**: if #1286's launch-request delivery (its T02/T03) has merged, extend that parser union and channel instead of adding a second one; if not, build it here as a generic `LaunchRequest` union (`{type:'new-thread'}|{type:'open-project-id',projectId}`) that #1286 extends with its path request. T01 records which case applies.
- **R10 — Renderer actions.** `new-thread`: same effect as the existing new-thread action (`createThread()` in `apps/web/src/App.tsx:765`), with no project if none is selected, else scoped to the currently selected project (identical to the in-app button); then focus the composer. Existing drafts are kept (normal new-thread behavior). `open-project-id`: if the project exists, select its most recently updated non-archived main thread; if it has none, create a new empty thread scoped to it (`createThread(undefined, projectId)`). If the project no longer exists, show the error toast (VD-07) and change nothing. No automatic agent run, no trust change.
- **R11 — Settings.** Two new preferences in `packages/contracts/preferences.ts`, default `true`: `taskbarProgress` and `jumpListRecentProjects`. Rows in Settings → Notifications & usage (General section ids as used by the existing `thread-notifications` row), desktop + Windows only:
  - **Show task progress on the taskbar** — helper text: *Green while tasks run, yellow when one needs you, red when one fails.*
  - **Show recent projects in the jump list** — helper text: *Right-click Gen V1 in the taskbar to open a recent project.*
  The **New thread** jump-list task is always present while the app is installed (it reveals nothing). Turning `jumpListRecentProjects` off re-registers the jump list without the Recent projects category. Turning `taskbarProgress` off clears the bar and overlay immediately and stops the 15 s safety poll. Add both ids to `apps/web/src/settings-inventory.ts` with search terms and to `PLATFORM_OVERRIDES` as `'desktop'` in `apps/web/src/settings-registry.ts`; hide both rows when not running in the Windows desktop shell (`DesktopContext.nativeTitleBar===true` is the existing Windows signal; T01 confirms or finds a better one).
- **R12 — AppUserModelID.** Call `app.setAppUserModelId('local.generativeharness.desktop')` on win32 before any window is created, matching `appId` in `scripts/desktop-assets.ts:119`. T01 verifies that the electron-builder NSIS Start-menu shortcut carries the same AUMID (required for the jump list to attach to the pinned/Start entry) and records evidence.
- **R13 — Privacy and security.** Only project ids and display names reach the jump list (stored by Windows in the user's profile). No paths, thread titles or message text appear in any taskbar or jump-list surface. Overlay description is fixed text. The new IPC follows `authorize()` sender checks; the renderer cannot set taskbar state directly.
- **R14 — Accessibility.** The overlay badge has description “A task failed” (read by screen readers on the taskbar button). Settings rows are standard keyboard-accessible switches with label + helper text associated via `aria-describedby`. The error toast is announced with the existing toast live region.
- **R15 — Reliability.** All native calls are wrapped in try/catch; failures never block startup, window creation or quit. On quit (`closeApplication`), clear progress and overlay before windows are destroyed. Do not call native taskbar APIs on a destroyed window.

### Explicit exclusions

No taskbar thumbnail toolbar buttons, no `flashFrame` attention flashing, no taskbar badge counts, no per-thread jump-list items, no pinning/unpinning, no file-type registration, no macOS/Linux equivalents, no new notification channel, no changes to attention popup behavior, no installer (NSIS) changes beyond verifying the AUMID, no M01–M17 capability changes.

## REPO_MAP

Verified at baseline `e883ac03` (line numbers are baseline references, not targets):

| Location | Fact / integration point |
|---|---|
| `apps/desktop/main.ts:1` | Imports from `electron` include `app, BrowserWindow, Menu, Tray, nativeImage, powerMonitor` — no `setProgressBar`, `setOverlayIcon`, `setJumpList` or `setAppUserModelId` anywhere in the repo (grep verified). |
| `apps/desktop/main.ts:42` | `app.setName('Gen V1')` — place `setAppUserModelId` next to it (win32 only). |
| `apps/desktop/main.ts:201` | `mainWindow()` creates or restores/focuses the single `surface.kind==='main'` window. |
| `apps/desktop/main.ts:202` | `backendRequest(type,...)` with a closed union of control types (`harness.stopAll`, `layout.save`, `plugin.validate`, `update.readiness`, `update.prepare`, `attention.read/open/dismiss`). Add `'harness.taskbar.read'`. |
| `apps/desktop/main.ts:207–211` | `installTray()` builds a 16×16 tray icon with `nativeImage.createFromBitmap` — pattern for the generated overlay badge. |
| `apps/desktop/main.ts:233–234` | `startAttention()` uses `harness.attention.read` and `attentionDeliverySchema`. |
| `apps/desktop/main.ts:237` | `registerIpc()` `handle(channel, action)` wraps `ipcMain.handle` with `authorize()`. |
| `apps/desktop/main.ts:320–326` | `startBackend()` installs `workspaceRelay=workspaceEvents(backendOrigin, change=>…)` — hook point for taskbar refresh on sequence change. |
| `apps/desktop/main.ts:358–374` | `closeApplication()` — clear taskbar state before `destroyWindow`. |
| `apps/desktop/main.ts:376–391` | Single-instance lock; `second-instance` ignores argv; `app.whenReady()` startup sequence. |
| `apps/desktop/preload.ts` | `harnessDesktop` bridge (`DesktopBridge`); add `onLaunchRequest` + `launchRequestReady` + `launchRequestAck` (or extend #1286's). |
| `apps/desktop/workspace-events.ts` | Relays `{connected,sequence}` only; no thread data in main. |
| `packages/desktop-contract/index.ts:25–51` | `DesktopBridge` interface and `DESKTOP_CHANNELS`; `desktopId()` validator at line 54. |
| `apps/server/desktop-controls.ts` | Private launch-token parent IPC controls; add `harness.taskbar.read` with a `taskbarRead?()` host method. |
| `apps/server/host.ts:27,129–130` | `RunningHost` and the control implementations (`updateReadiness` calls `service.isUpdateIdle()`); add `taskbarRead()`. |
| `packages/core/service.ts:406–412` | `isUpdateIdle()` — the thread conditions for “active work” (`runId`, `working`, `awaiting_input`, `planning.hasActiveChildren`). |
| `packages/contracts/index.ts:3` | `Thread` has `status: TaskStatus`, `runId`, `projectId?`, `kind?`, `updatedAt`. |
| `packages/contracts/conversation-read-models.ts:14` | Status values: `ready, working, awaiting_input, stopped, interrupted, completed, failed`. |
| `packages/contracts/planning.ts:19` | Plan step `status: pending|working|completed|blocked`, optional `state` incl. `completed|accepted`. |
| `packages/contracts/attention.ts` | Attention items: `kind` incl. `thread-failed`, `state` incl. `needs-input|failed`, `read`, `threadId`, `projectId?`. |
| `packages/contracts/preferences.ts:40–70` | `preferencesSchema` and `DEFAULT_PREFERENCES` (add the two booleans). |
| `apps/web/src/settings-inventory.ts:51–52` | `thread-notifications`, `in-app-notifications` rows in section `general`. |
| `apps/web/src/settings-registry.ts` | `PLATFORM_OVERRIDES` (empty today) for desktop-only rows. |
| `apps/web/src/Settings.tsx:51` | Option-row config for `thread-notifications` — pattern for new toggles. |
| `apps/web/src/App.tsx:765,1093` | `createThread(prepare?, projectId?)`; `desktop?.bridge.onAttentionOpen?.(id=>select(id))` — pattern for subscribing to a main-process request. |
| `apps/web/src/desktop-context.tsx` | `DesktopProvider`, `useDesktop()`; `context.nativeTitleBar` is true on Windows. |
| `scripts/desktop-assets.ts:119–126` | `appId:'local.generativeharness.desktop'`, NSIS one-click per-user, `createStartMenuShortcut:true`. |
| `tests/desktop-native.test.ts`, `tests/desktop-host-ipc.test.ts`, `tests/desktop-state-broadcast.test.ts` | Existing vitest suites for pure desktop policy modules and host IPC (patterns for new tests). |
| `scripts/verify-installed-desktop.ts:15` | Installed-build verifier with `APP_ID` constant — extend for AUMID/jump-list evidence where practical. |

**Discovery (not verified facts):** where projects are stored and how the host lists them with names and enrollment time (look at `workspace.project.connect` / project store in `packages/core` and `packages/workspace`); the exact accessor for a thread's current plan steps (`this.planning` in `service.ts`); whether attention `thread-failed` items are resolved when the same thread later succeeds; how attention items are marked read when a thread is opened; the Settings switch component used by boolean rows.

## DESIGN

### Architecture and data flow

```
backend store ──(sequence)──► workspaceEvents (main) ──debounce 250ms──► backendRequest('harness.taskbar.read')
                                                                           │
                                         host.taskbarRead(): R02 state + recent projects + prefs
                                                                           ▼
                        main: taskbar-policy.ts (pure) ─► diff vs last ─► win.setProgressBar / setOverlayIcon
                                                       └► jump-list.ts (pure) ─► diff ─► app.setJumpList
Jump list click ─► new process argv ─► single-instance lock ─► second-instance(argv) in running app
               └► (cold) process.argv
                    ▼
        launch-request parser (pure) ─► pending (latest wins) ─► main renderer onLaunchRequest ─► App.tsx action ─► ack
```

### New/changed modules (proposed paths)

- `apps/desktop/taskbar-policy.ts` (new, pure, no electron import): `taskbarNativeState(status:TaskbarStatus|undefined):{progress:number;mode:'none'|'normal'|'indeterminate'|'paused'|'error';overlay:boolean}` and `sameNativeState(a,b)`. Mapping: `none`→`{progress:-1,mode:'none',overlay:false}`; `indeterminate`→`{progress:2,mode:'indeterminate'}` (Electron treats >1 as indeterminate); `normal`→`{progress:p}`; `paused`→`{progress:p??1,mode:'paused'}`; `error`→`{progress:p??1,mode:'error',overlay:true}`; `enabled:false`→ none.
- `apps/desktop/jump-list.ts` (new, pure): `buildJumpList({execPath,projects,includeProjects,removedArgs}):Electron.JumpListCategory[]` and `jumpListKey()` for diffing; label sanitizer (`trim`, strip `\p{Cc}`, 60 code points + `…`).
- `apps/desktop/launch-requests.ts` (new, pure, or extension of #1286's module): `parseLaunchRequest(argv:readonly string[]):{request?:LaunchRequest;error?:string}` and a `createLaunchRequestQueue()` (latest wins, id-based ack, reset on renderer reload).
- `apps/desktop/main.ts`: wiring only — AUMID, taskbar refresher, jump-list refresher, overlay image, argv handling, IPC channels, quit cleanup.
- `packages/desktop-contract/index.ts`: `TaskbarStatus` type + zod schema for the control response; `LaunchRequest` type; bridge methods; channel names `launchRequest`, `launchRequestReady`, `launchRequestAck` (unless #1286's exist).
- `apps/server/desktop-controls.ts`, `apps/server/host.ts`, `packages/core/service.ts`: `taskbarStatus()` on the service computing R02 from the store, plan and attention data; host exposes `taskbarRead()`.
- `packages/contracts/preferences.ts`, `apps/web/src/Settings.tsx`, `settings-inventory.ts`, `settings-registry.ts`: two toggles.
- `apps/web/src/App.tsx`: subscribe to `onLaunchRequest`, perform R10, ack.

### State transitions (taskbar)

`none` → (task starts) `indeterminate` or `normal(p)` → (needs input) `paused(p)` → (input answered) back → (task fails, unseen) `error(p or 1)` → (failure read/dismissed, nothing active) `none`. Any state → `none` when `taskbarProgress` is off, backend read fails twice in a row, or the app quits.

### Visual design (specified here; no front-end team for batch 3)

- **VD-01 Native progress colors.** Use only Windows' native taskbar progress rendering: green = normal/indeterminate, yellow = paused (needs input), red = error. Do not draw custom progress into the icon.
- **VD-02 Progress smoothing.** Determinate value updates are applied as-is but never move backwards during one run unless a plan step count changes (when total changes, jump directly to the new ratio). Values are rounded to 0.01. Windows animates between values itself; do not tween in code.
- **VD-03 Failure overlay badge.** 16×16 px image generated in code with `nativeImage.createFromBitmap` (same approach as the tray icon), plus a 32×32 px variant passed as a second representation (`addRepresentation` with `scaleFactor:2`) for 200% displays. Shape: filled circle, diameter 12 px (24 px at 2×) centered at (11,11)/(22,22) of its canvas so it sits in the bottom-right; fill `#E5484D`; 1 px (2 px at 2×) ring `#0F0F0F` (DESIGN.md task-surface black) so it separates from any icon; a white `#FFFFFF` exclamation mark 2 px wide (bar 5 px tall, 1 px gap, 2×2 dot), centered. Fully opaque, antialias edges by alpha (pixels whose center is within 0.5 px of the circle edge get 50% alpha). Description string: `A task failed`.
- **VD-04 No overlay for other states.** Running and needs-input states show no overlay (the bar color is enough).
- **VD-05 Jump list.** Text only as in R06; icon for every item is the app executable icon (`iconPath:process.execPath, iconIndex:0`). Category title exactly `Recent projects`. Task title exactly `New thread`.
- **VD-06 Settings rows.** Use the same switch row component, spacing and typography as existing boolean rows in Settings (e.g. In-app notifications). Order: directly after the `In-app notifications` row: first *Show task progress on the taskbar*, then *Show recent projects in the jump list*. Switch state change animates with the DESIGN.md “Status/success” token: 160 ms crossfade; with Reduced motion or Off, opacity only, ≤80 ms (DESIGN.md reduced-motion rule). No pending spinner: the preference save is optimistic like other toggles; on save failure revert the switch and show the existing settings error text.
- **VD-07 Toast for a missing project.** Existing error toast tone and placement; copy: **That project is no longer in Gen V1.** with secondary text *It may have been removed. Choose another project from the sidebar.* Entrance/exit use the existing toast motion (no new animation). The toast never shows the project path.
- **VD-08 Arrival after a jump-list action.** The main window restores/focuses (native). For **New thread**, the new empty thread is selected and the composer receives keyboard focus with the caret visible; no extra highlight. For a recent project, the selected thread scrolls into view in the sidebar using the existing selection behavior; the sidebar row uses its normal selected style with the DESIGN.md entrance easing `cubic-bezier(.16,1,.3,1)` only if the existing selection already animates — do not add a new animation.

### Error, cancel and retry

- Backend read failure: keep last state once, clear to `none` on the second consecutive failure; retry on next sequence change or the 15 s poll.
- `setJumpList` non-`'ok'`: one retry without recent projects; then stop until next change.
- Launch request while backend not ready: queue (latest wins) until main renderer is ready; requests older than 60 s when the renderer becomes ready are dropped silently.
- Renderer reload: readiness resets; pending request re-delivered after the new ready signal.

### Security boundaries

Main trusts only the strict-schema backend control response (launch-token custody). Launch args are parsed by a pure allow-list parser; project ids validated by `desktopId()` in main and again by existing store lookups in the renderer. Only the trusted main renderer (existing `authorize()` + `surface.kind==='main'`) receives/acks launch requests.

### Migration / rollback

New preferences default to `true`; older stored preferences simply lack the keys (handled by `getPreferences` defaults — T02 verifies). Rollback = revert the PR; Windows keeps a stale jump list until the next `setJumpList`, so the uninstall path is unaffected and an older build simply never updates it (acceptable; document in the PR).

## EXECUTION_DAG

All tasks are unassigned. Each worker claims its task ID on the canonical issue before editing (AGENTS.md), keeps one concern per PR or one PR for the whole small feature if a single worker does T01–T07, and posts checkpoints.

### T01 — Close discovery gaps and coordination check
- **Goal:** Resolve every “Discovery” item in REPO_MAP; check #1286 status (merged launch-request module or not) and batch 3 items 1–2 issues for overlapping `main.ts` edits.
- **Dependencies:** none.
- **Steps:** read the listed files at current main; trace project storage and naming; trace plan step accessor; trace attention read/resolve rules for `thread-failed`; confirm `nativeTitleBar` as Windows signal; inspect electron-builder's NSIS shortcut AUMID behavior in the installed `app-builder-lib` version (template/source) and record it.
- **Outputs:** an issue comment listing exact symbols/paths for T02–T06, the #1286 decision (extend vs build), and any requirement that cannot hold as written (BLOCK it; do not invent).
- **Tests:** none (research); attach file/line permalinks.
- **Done when:** every discovery item has a pinned permalink answer or an explicit BLOCKED note.
- **Handoff:** T02–T06.

### T02 — Host `taskbarStatus()` and `harness.taskbar.read` control
- **Goal:** R02, R07, R11 (preference read).
- **Dependencies:** T01.
- **Files:** `packages/core/service.ts` (new method next to `isUpdateIdle`), `apps/server/host.ts`, `apps/server/desktop-controls.ts`, `packages/contracts/preferences.ts` (two booleans + defaults), `packages/desktop-contract/index.ts` (response schema/type).
- **Inputs/outputs:** store threads, plans, attention items, preferences → `{taskbar,jumpList}` per R07.
- **Tests (new `tests/desktop-taskbar-status.test.ts` or the service test suite T01 identifies):** positive — idle → none; one running thread without plan → indeterminate; plan 2/5 → normal 0.4; two threads 1/2 + 1/3 → 0.4; awaiting_input → paused; unread thread-failed → error & failed:true; read item → cleared; archived/side threads ignored; preference off → enabled:false; projects ordered by recency, max 5, names untruncated ≤160. Negative — wrong token, extra keys, wrong requestId → control returns false/ignored; host throws → error result.
- **Done when:** tests pass; `npm run check` (or the repo's type/lint command per CONTRIBUTING.md) clean for touched files.
- **Handoff:** schema + fixture JSON to T03/T04.

### T03 — Main taskbar refresher and overlay
- **Goal:** R01–R05, R12, R15, VD-01..VD-04.
- **Dependencies:** T02.
- **Files:** new `apps/desktop/taskbar-policy.ts`; `apps/desktop/main.ts` (AUMID near line 42; `backendRequest` union; refresher wired into the `workspaceEvents` callback; overlay bitmap builder; apply-to-main-window; reapply in `mainWindow()` after ready; clear in `closeApplication`).
- **Tests:** new `tests/desktop-taskbar-policy.test.ts`: mapping table for every mode; diff suppression; clamping; non-regressing value within a run (VD-02); disabled → none; overlay bitmap is 16×16 and 32×32 with expected center/edge pixel colors. Main wiring tested with fake timers like `tests/desktop-workspace-events.test.ts`: coalescing (≤1 in flight, 250 ms trailing), 15 s poll only when not none, two failures → none.
- **Done when:** unit tests pass; manual dev run on Windows shows green/yellow/red bars (evidence in T07).
- **Handoff:** T07.

### T04 — Jump list builder and refresher
- **Goal:** R06, R11 (jump-list half), VD-05.
- **Dependencies:** T02 (can run in parallel with T03; edits a different section of `main.ts` — coordinate by keeping new code in `jump-list.ts` and adding only a small refresher block in `main.ts`).
- **Files:** new `apps/desktop/jump-list.ts`; `apps/desktop/main.ts` (refresher after backend start and on changed project list).
- **Tests:** new `tests/desktop-jump-list.test.ts`: categories exact shape; max 5; sanitizer (control chars, emoji, 61+ code points → 60 + `…`); no path-like strings ever (fixture names containing `C:\` are kept as names but args contain only ids); removed items filtered by args; includeProjects=false omits category; key changes only on order/title change; non-`ok` result triggers one retry without projects.
- **Done when:** tests pass.
- **Handoff:** T07.

### T05 — Launch-request parser, cold/warm delivery and bridge
- **Goal:** R08, R09.
- **Dependencies:** T01 (decides extend vs new).
- **Files:** new `apps/desktop/launch-requests.ts` (or #1286's module), `apps/desktop/main.ts` (`second-instance` handler receives `(event, argv)`; startup parse), `apps/desktop/preload.ts`, `packages/desktop-contract/index.ts`.
- **Tests:** new `tests/desktop-launch-requests.test.ts`: valid new-thread; valid open-project with id; repeats → none; unknown value → none; missing/invalid id → error; unrelated Chromium switches ignored; `--open-project` ignored by this parser (or routed by #1286's branch); queue latest-wins; stale ack ignored; reload resets readiness; untrusted sender cannot ack (pattern: `tests/desktop-host-ipc.test.ts`).
- **Done when:** tests pass; existing desktop suites still pass.
- **Handoff:** T06.

### T06 — Renderer actions and Settings rows
- **Goal:** R10, R11 (UI), R14, VD-06..VD-08.
- **Dependencies:** T02 (preferences), T05 (bridge).
- **Files:** `apps/web/src/App.tsx` (subscribe like line 1093; perform action; ack), `apps/web/src/Settings.tsx`, `apps/web/src/settings-inventory.ts`, `apps/web/src/settings-registry.ts`.
- **Tests:** renderer tests in the repo's existing web test setup (T01 names it): new-thread request selects a new thread and focuses composer without losing drafts; open-project selects most recent thread / creates scoped thread when none; missing project → toast with VD-07 copy, no path; rows hidden when not Windows desktop; toggles persist and revert on save failure; reduced motion respected.
- **Done when:** tests pass; UI guard / numeric-JSX lint (DESIGN.md guardrails) pass.
- **Handoff:** T07.

### T07 — Installed Windows verification, docs and front-end review handoff
- **Goal:** R10 success criteria on a real installed build; R12 evidence; hand to the front-end team.
- **Dependencies:** T03, T04, T05, T06.
- **Steps:** build the NSIS installer per CONTRIBUTING.md; install; verify each VALIDATION row; capture screenshots (taskbar green indeterminate, green determinate, yellow, red + badge at 100% and 200% scaling; jump list with and without Recent projects; Settings rows dark/light). Update `apps/desktop/README.md` with a short “Taskbar and jump list” section. Then post the front-end review handoff comment on the issue (PR, SHA, screenshots) addressed to Leonardo's front-end team and wait for their ACK before closing.
- **Done when:** acceptance matrix all PASS with evidence; front-end team review requested and acknowledged.

## VALIDATION

**Setup:** Windows 10 22H2 or Windows 11, x64; repo install per CONTRIBUTING.md; unit tests via the repo's vitest command (`npx vitest run tests/desktop-*.test.ts` for desktop suites); installer via the desktop packaging scripts referenced by `scripts/desktop-assets.ts`.

**Acceptance matrix (all planned; none executed):**

| # | Check | Expected | Req |
|---|---|---|---|
| A1 | Start a task with no plan | Green marquee within 1 s; clears within 1 s after completion | R02,R05 |
| A2 | Task with a 4-step plan | Green bar grows ~25% per completed step; never full while running | R02,VD-02 |
| A3 | Task asks for approval | Yellow bar; returns green after answering | R02,R03 |
| A4 | Force a task failure, don't open it | Red bar at 100% + red badge; Narrator reads “A task failed” | R03,VD-03,R14 |
| A5 | Open the failed thread | Bar and badge clear | R02 |
| A6 | Turn “Show task progress on the taskbar” off mid-run | Bar clears ≤1 s; no polling | R11 |
| A7 | Jump list → New thread with app closed | App launches; new empty thread selected; composer focused | R06,R09,R10 |
| A8 | Same with app hidden to tray | Window restores; new thread | R09 |
| A9 | Jump list shows ≤5 recent projects in recency order; choose one | That project's latest thread is selected | R06,R10 |
| A10 | Delete a project, then choose it from a stale jump list | VD-07 toast, no change, no path shown | R10 |
| A11 | Remove an item from the jump list via right-click → Remove | It does not come back after refresh | R06 |
| A12 | Turn “Show recent projects” off | Only New thread remains | R11 |
| A13 | Inspect jump-list args (e.g. via `app.getJumpListSettings` debug or shortcut properties) | Only `--gen-jump`/`--gen-project-id`; no paths | R13 |
| A14 | Pin Gen V1 to the taskbar; check AUMID | Jump list attaches to pinned and Start entries | R12 |
| A15 | Ordinary launch, quit, update-restart | No regressions; bar cleared on quit | R15 |
| A16 | Non-Windows / browser build | No rows, no native calls | R01 |

**Release gate:** all unit suites green in CI; A1–A16 PASS with screenshots on the issue; front-end team review acknowledged.

## STATE

| Item | State |
|---|---|
| Research and decisions (this plan) | DONE (r1) |
| Implementation T01–T07 | NOT_STARTED, unowned |
| Verification | NOT_RUN |
| Risks | AUMID mismatch would hide the jump list on pinned entries (T01/A14); shared `main.ts` edits with #1286 and batch 3 items 1–2 may conflict — rebase and keep new logic in separate modules; attention “failed” resolution semantics may differ from assumption (T01 blocks if so) |
| Next step | T01: a worker claims it on the canonical issue and posts the discovery comment |

## REFERENCES

- Electron Windows taskbar guide (progress bar, overlay icons, JumpList): https://www.electronjs.org/docs/latest/tutorial/windows-taskbar
- Electron `BrowserWindow.setProgressBar(progress[, options])` — `mode`: `none|normal|indeterminate|error|paused` (Windows); progress <0 removes, >1 indeterminate: https://www.electronjs.org/docs/latest/api/browser-window#winsetprogressbarprogress-options
- Electron `BrowserWindow.setOverlayIcon(overlay, description)` (Windows): https://www.electronjs.org/docs/latest/api/browser-window#winsetoverlayiconoverlay-description-windows
- Electron `app.setJumpList(categories)`, `app.getJumpListSettings()` (`removedItems`) and `JumpListCategory`/`JumpListItem` structures: https://www.electronjs.org/docs/latest/api/app#appsetjumplistcategories-windows
- Electron `app.setAppUserModelId(id)`: https://www.electronjs.org/docs/latest/api/app#appsetappusermodelidid-windows
- Related plan: #1286 “Open in Gen V1” in Windows File Explorer (launch-argument delivery)
- Repository rules: AGENTS.md (plan publication, checkpoints, RELEASE), CONTRIBUTING.md, DESIGN.md (motion tokens: status 160 ms crossfade; reduced motion opacity ≤80 ms; entrance easing `cubic-bezier(.16,1,.3,1)`; task-surface `#0F0F0F`)
