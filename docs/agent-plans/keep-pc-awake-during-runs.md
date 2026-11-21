# Plan: Keep the PC awake during runs

## META

| Field | Value |
|---|---|
| Feature | Keep the PC awake during runs: an opt-in setting that stops Windows from idle-sleeping while a task runs or a schedule is active |
| Size | small (labels `feature`, `small`); no sub-issues needed |
| Repo | skytuhua-org/Gen-V1 |
| Plan file | `docs/agent-plans/keep-pc-awake-during-runs.md` |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified from a fresh clone) |
| Existing issue/PR | None found (`gh issue list --search "awake sleep"` returned nothing). Publication to a GitHub issue and docs PR was authorized by the maintainer (planning only, no implementation); the issue and docs PR numbers are recorded in the issue header. |
| Implementation status | NOT_STARTED |
| Provenance | Maintainer-approved batch 3 proposal, item 1: "A setting that stops Windows from idle-sleeping while a run or scheduled task is active." Repository facts below were inspected at the baseline. **DECIDED** marks a design decision made by this planner; **DISCOVERY** marks a check the implementer must do before relying on it. |

**Visual design and animation are specified in this plan.** There is no separate front end team designing this feature (maintainer, batch 3): the DESIGN section below is the visual and motion contract. **When implementation is finished, hand the completed work (PR, screenshots, recording) to Leonardo's front end team for review** before it is called done (task T07).

## OBJECTIVE

**User problem.** Gen V1 runs long agent tasks and (behind M10 flags) durable schedules on a Windows PC. When the user walks away, Windows idle-sleep suspends the machine: the local backend, model calls and child processes freeze mid-task, and schedules miss their due time. Gen never asks the OS to stay awake. The only power hook in `apps/desktop/main.ts` is `powerMonitor.on('shutdown', ...)` (line 384); `powerSaveBlocker` is never imported (`grep -rn powerSave` finds nothing).

**Intended behavior.** Two opt-in switches in Settings (Windows app only), mirroring the two toggles Claude Desktop offers (one for scheduled tasks, one for running sessions; https://code.claude.com/docs/en/desktop-scheduled-tasks):

1. **Keep PC awake during tasks**: while at least one task is actually running, Gen holds an Electron `powerSaveBlocker` of type `prevent-app-suspension`.
2. **Keep PC awake for schedules**: while at least one schedule is active (not paused, cancelled, delivered or blocked, with a next due time) or background work is running, Gen holds the same blocker.

The blocker is released as soon as no enabled condition is true, when the backend stops or disconnects, on quit, and whenever Gen cannot confirm the activity state. The display may still turn off (Gen never uses `prevent-display-sleep`). Closing the lid, pressing the power button or choosing Sleep still sleeps the PC.

**Measurable success.** With "during tasks" on, a running task on a Windows PC with a 1-minute sleep timeout keeps the machine awake past the timeout (`powercfg /requests` lists Gen V1 under SYSTEM) and the PC sleeps normally within the OS timeout after the task ends. With both switches off (default), `powercfg /requests` never lists Gen V1. All R01–R12 acceptance checks pass.

## REQUIREMENTS

### In scope

- R01 Two persisted boolean preferences, `keepAwakeTasks` and `keepAwakeSchedules`, both default `false`, validated by the shared Zod preferences schema. Missing/legacy stored preferences read as `false`; unrelated preferences survive.
- R02 Host-computed activity: `tasks` is true when any thread has a `runId`, has status `working`, or has active planning children (the same thread predicates `isUpdateIdle()` uses, minus `awaiting_input`); `schedules` is true when any durable wakeup is active (not paused, state not `CANCELLED`/`DELIVERED`/`BLOCKED`, `nextDueAtMs !== null`) or background work is `RUNNING`.
- R03 A new launch-token-bound desktop control `harness.power.read` returns `{tasks, schedules, keepAwakeTasks, keepAwakeSchedules}`. Same custody as `harness.update.readiness`: private parent IPC, exact key count, no HTTP route.
- R04 Electron main holds at most one blocker of type `prevent-app-suspension` when `(keepAwakeTasks && tasks) || (keepAwakeSchedules && schedules)`, and none otherwise.
- R05 Reconcile on every workspace change event (debounced 500 ms), on a 30 s safety poll, after backend (re)start, on `powerMonitor` `resume`, and immediately after a settings save that changes either preference.
- R06 Fail safe: release the blocker when the backend exits or disconnects, when `closeApplication()` runs, when `harness.power.read` fails twice in a row, and when `powerSaveBlocker.start` throws or `isStarted` is false after start (state `unavailable`). Never hold a blocker Gen cannot confirm it still needs.
- R07 Expose `power` in `DesktopState` (`{state:'off'|'idle'|'holding'|'unavailable';reason?:'tasks'|'schedules'|'both'}`) so the Settings rows show live status without polling the renderer.
- R08 Settings rows appear only in the desktop build (`PLATFORM_OVERRIDES` → `'desktop'`) and are searchable ("sleep", "awake", "power", "battery", "screen", "idle", "schedule").
- R09 Tray tooltip reflects holding: `Gen V1 — keeping this PC awake while tasks run` (or `…while schedules are active`), restoring the existing tooltip when released.
- R10 Accessibility: switches keep `role="switch"`, `aria-checked`, accessible names; the status line is a polite live region that announces only state changes, never on every poll; reduced motion respected.
- R11 No new dependency, no new capability flag (default-off preferences keep current behavior), no SQL migration, no change to M10 flags. When M10 is off there are simply no schedules, and the schedules switch says so.
- R12 Unit, IPC and Playwright tests plus real Windows evidence (`powercfg /requests`) before calling it shipped; finished work goes to the front end team for review.

### Out of scope (v1)

- Preventing display sleep, lid-close or user-initiated sleep, hibernate on low battery, waking the PC from sleep for a schedule (Windows wake timers / Task Scheduler), battery-aware auto-off, per-project or per-thread overrides, a time limit on holding, macOS/Linux specific behavior (Electron's API is cross-platform and the code must not crash there, but only Windows is verified).
- Changing schedule semantics, M10 flag defaults or `isUpdateIdle()`.

### Decisions (DECIDED)

1. `prevent-app-suspension`, never `prevent-display-sleep`: keeps work running while letting the screen turn off; lower power, no burn-in.
2. `awaiting_input` threads do not keep the PC awake: nothing runs while Gen waits for a human, and an unanswered question overnight should not drain power.
3. One blocker for both reasons; the reason only changes the status copy. Starting a second blocker for the same need is a bug.
4. Main pulls activity from the host instead of the host pushing to main: main already receives every workspace sequence change from `workspaceEvents` and already uses the same request/acknowledge IPC for update readiness, so no new push channel is needed.
5. Defaults off. A setting that drains battery is opt-in.
6. Settings placement: section `general` ("General"), directly after "Time format" and the confirmation rows, as two switch rows plus one status line.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Path | Fact | Change |
|---|---|---|
| `apps/desktop/main.ts` (393 lines) | Imports `powerMonitor` but not `powerSaveBlocker` (line 1). `backendRequest(type,...)` (line 202) is a typed union of control types with reply type `type+'.result'` for update/attention. `workspaceRelay=workspaceEvents(backendOrigin, change=>...)` (line 324) fires on every workspace sequence change. Backend `child.once('exit')` handler (line 325) and `stopBackend()` (line 330). `closeApplication()` (line 358). `installTray()` sets tooltip `'Gen V1 — tasks keep running when windows are hidden'` (line 209). `powerMonitor.on('shutdown')` (line 384). `broadcast()` (line 71) sends `snapshot(record)` state to windows. | Wire the power keeper (T03). |
| `apps/desktop/power-keeper.ts` | Does not exist. | New pure module with injected Electron API (T03). |
| `apps/server/desktop-controls.ts` (35 lines) | `handleDesktopControl` validates token, requestId, exact key counts; handles `harness.update.readiness` with `Object.keys(input).length===3`. `DesktopHostControls` interface. | Add `harness.power.read` (T02). |
| `apps/server/host.ts` | `RunningHost` (line 27); `updateReadiness()` (line 129) wraps `service.isUpdateIdle()`. | Add `powerRead()` (T02). |
| `packages/core/service.ts` | `isUpdateIdle()` (line 406) uses `thread.runId \|\| thread.status==='working' \|\| thread.status==='awaiting_input' \|\| this.planning.hasActiveChildren(thread.id)`; `private get preferences()` (line 415) reads `getPreferences(store.get('settings','global'))`; `backgroundWork` coordinator. | Add `powerActivity()` (T02). |
| `packages/core/durable-wakeups.ts` | `allSchedules()` (line 586) is the unbounded inventory; active filter pattern `!wakeup.paused && state not CANCELLED/DELIVERED/BLOCKED` (lines 139, 165); `nextDueAtMs` field. | Read only. |
| `packages/core/background-work.ts` | `BackgroundWorkRecord.state` includes `RUNNING`; records in store kind `backgroundWork` (`closeSummary()` line 869). M10 flags `jobs.backgroundV1` etc. default off (`packages/core/capability-flags.ts` lines 149–151). | Read only. |
| `packages/contracts/preferences.ts` (111 lines) | `preferencesSchema` (line 35), `DEFAULT_PREFERENCES` (line 59), strict `patchSchema`, `getPreferences`/`readPreferences`. | Add two booleans (T01). |
| `packages/desktop-contract/index.ts` (89 lines) | `DesktopState` interface (includes `update?`, `backendError?`). | Add `power?` (T01). |
| `apps/web/src/Settings.tsx` (215 lines) | `SETTINGS_ROWS` (line 61) harness rows via `row(id,title,section,terms)`; `preferenceRows` map (line 41) drives `PreferenceControl` switch/select (line 83); `const details = (item)` (line 161) chooses description/control; `useDesktop()` gives desktop context. | Add rows, descriptions, status line (T04). |
| `apps/web/src/settings-registry.ts` (39 lines) | `PLATFORM_OVERRIDES: Record<string, SettingPlatform> = {}` (line 19); `searchSettings(..., platform)` filters by platform. | Add two `'desktop'` overrides (T04). |
| `apps/web/src/settings-inventory.ts` | Pinned T3 inventory "transcribed from the upstream source"; has an unrelated `background-activity` row. | **Do not edit** (upstream transcription). New rows go in `SETTINGS_ROWS`. |
| `apps/web/src/settings.css` | `.settings-switch` (lines 38–41), `.settings-value` pill (line 28), reduced-motion rule (line 98). | Add status-line styles (T04). |
| `packages/ui-shell/tokens.css`, `DESIGN.md` § Motion tokens | `--ui-motion-hover`, `--ui-ease-enter`; Status/success = 160 ms crossfade, one 240 ms pulse; reduced motion = opacity ≤ 80 ms. | Use tokens only. |
| Tests | `tests/desktop-host-controls.test.ts`, `tests/update-readiness.test.ts`, `tests/desktop-state-broadcast.test.ts`, `tests/preferences.test.ts`, `tests/settings-registry.test.ts`, `tests/settings-search-filter.test.ts`. | Extend + new `tests/desktop-power-keeper.test.ts`. |
| Electron | `electron` 45.2.0 (package.json). `powerSaveBlocker.start(type)`, `.stop(id)`, `.isStarted(id)`. | DISCOVERY: confirm signatures in the 45.x typings in `node_modules/electron/electron.d.ts`. |

M01–M17 (`docs/progress.md`) inspected: none implements sleep prevention. M10 owns schedules and is off by default, so on a default host only the tasks switch has an effect.

## DESIGN

### Data and control flow

```
Settings switch ──settings.update──▶ host Store (preferences)
                                         │
thread/run/schedule changes ──▶ workspace event sequence ──▶ main: workspaceRelay notify
                                                                 │ debounce 500 ms
30 s poll / resume / backend start ─────────────────────────────▶ powerKeeper.reconcile()
                                                                 │ backendRequest('harness.power.read')
                                         host.powerRead() ◀──────┘
                                         {tasks,schedules,keepAwakeTasks,keepAwakeSchedules}
                                                                 │
                         want = (kT&&tasks)||(kS&&schedules) ────▶ powerSaveBlocker start/stop
                                                                 │
                                         DesktopState.power ──▶ broadcast() ──▶ Settings status, tray tooltip
```

### Contracts

```ts
// packages/contracts/preferences.ts (add to schema and defaults)
keepAwakeTasks: z.boolean(), keepAwakeSchedules: z.boolean(),
// DEFAULT_PREFERENCES
keepAwakeTasks: false, keepAwakeSchedules: false,

// packages/desktop-contract/index.ts
export interface DesktopPowerState { state: 'off' | 'idle' | 'holding' | 'unavailable'; reason?: 'tasks' | 'schedules' | 'both' }
// DesktopState gains: power?: DesktopPowerState

// apps/server/desktop-controls.ts — DesktopHostControls gains:
powerRead?: () => Promise<{ tasks: boolean; schedules: boolean; keepAwakeTasks: boolean; keepAwakeSchedules: boolean }>;
// request : {type:'harness.power.read', token, requestId}            (exactly 3 keys)
// success : {type:'harness.power.read.result', token, requestId, tasks, schedules, keepAwakeTasks, keepAwakeSchedules}
// failure : {type:'harness.power.read.result', token, requestId, error:'Power state is unavailable.'}
```

`state` meanings: `off` = both switches off; `idle` = a switch is on but nothing qualifies; `holding` = blocker started and `isStarted` true; `unavailable` = start threw, `isStarted` false, or two consecutive read failures while a switch was last known on.

### Service method

```ts
// packages/core/service.ts
powerActivity(): { tasks: boolean; schedules: boolean; keepAwakeTasks: boolean; keepAwakeSchedules: boolean } {
  const prefs = this.preferences;
  const tasks = this.store.all<Thread>('thread').some(t => t.runId || t.status === 'working' || this.planning.hasActiveChildren(t.id));
  const now = Date.now();
  const schedules = this.backgroundWork.scheduler.allSchedules().some(w => !w.paused && !['CANCELLED','DELIVERED','BLOCKED'].includes(w.state) && w.nextDueAtMs !== null)
    || this.store.all<BackgroundWorkRecord>('backgroundWork').some(w => w.state === 'RUNNING');
  return { tasks, schedules, keepAwakeTasks: prefs.keepAwakeTasks, keepAwakeSchedules: prefs.keepAwakeSchedules };
}
```

DISCOVERY: confirm `this.backgroundWork.scheduler` is accessible from `service.ts` (it is used as `service.backgroundWork.scheduler.schedules()` in `apps/server/background-routes.ts` line 15) and that `WakeupRecord` exposes `nextDueAtMs` and `state` (`durable-wakeups.ts`). Remove the unused `now` if not needed. Archived threads: DISCOVERY whether an archived thread can keep a `runId`; if so exclude it with the same `archivedThread` check used elsewhere in `service.ts`.

`host.ts`: `async powerRead(){ if(!accepting) throw Error('Host is not accepting power reads.'); return service!.powerActivity(); }`.

### Power keeper (main process)

```ts
// apps/desktop/power-keeper.ts
export interface PowerApi { start(type: 'prevent-app-suspension'): number; stop(id: number): void; isStarted(id: number): boolean }
export interface PowerReading { tasks: boolean; schedules: boolean; keepAwakeTasks: boolean; keepAwakeSchedules: boolean }
export function createPowerKeeper(options: {
  api: PowerApi;
  read: () => Promise<PowerReading>;
  notify: (state: DesktopPowerState) => void;
  setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; pollMs?: number; debounceMs?: number;
}): { schedule(): void; reconcile(): Promise<DesktopPowerState>; release(): void; state(): DesktopPowerState; dispose(): void };
```

Rules:
- `reconcile()` is serialized (one in flight; a request during flight sets a `dirty` flag and runs once more after).
- `want = (r.keepAwakeTasks && r.tasks) || (r.keepAwakeSchedules && r.schedules)`; reason `both` when both qualify.
- want && no id → `id = api.start('prevent-app-suspension')`; if it throws or `!api.isStarted(id)` → state `unavailable`, id cleared. !want && id → `api.stop(id)`, id cleared.
- Read failure: increment `failures`; at 2 → `release()` and state `unavailable` if last known switches were on, else `off`. Success resets `failures`.
- `release()` stops any held id (try/catch) and is idempotent. `dispose()` = release + clear timers.
- `notify` only when the state object changes (compare `state` and `reason`).
- Poll: `setTimer(reconcile, pollMs=30000)` re-armed after each run.

Wiring in `main.ts`:
1. Import `powerSaveBlocker`; create `powerKeeper` after `registerIpc()` in `whenReady` with `read: async () => parsePowerReading(await backendRequest('harness.power.read'))` (strict booleans; anything else throws) and `notify: state => { powerState = state; updateTrayTooltip(); broadcast(); }`.
2. Add `'harness.power.read'` to the `backendRequest` type union (reply `type+'.result'` already matches).
3. In the `workspaceEvents` notify callback (line 324) call `powerKeeper?.schedule()` (debounced 500 ms).
4. After `backendError=undefined;broadcast();` in `startBackend()` call `powerKeeper?.schedule()`; in the backend `exit` handler and at the start of `stopBackend()` call `powerKeeper?.release()`.
5. `powerMonitor.on('resume', () => powerKeeper?.schedule())`.
6. In `closeApplication()` call `powerKeeper?.dispose()` before `stopBackend()`.
7. `snapshot(record)` includes `power: powerState`.
8. `installTray()` keeps a reference; `updateTrayTooltip()` sets `Gen V1 — keeping this PC awake while tasks run` / `…while schedules are active` / `…while tasks and schedules run` when holding, else the existing string.
9. Settings save: `settings.update` is a store command (`service.ts` line 1127). DISCOVERY: verify a store command advances the workspace event sequence that `workspaceEvents` relays; if not, add `refreshPower?(): Promise<void>` to `DesktopBridge` + channel `harness-desktop:power-refresh` that calls `powerKeeper.schedule()`, and call it after a successful save of either key.

### Security and privacy

No new HTTP route, no renderer access to the blocker API, launch-token custody identical to update readiness, no paths or thread content in the reply (four booleans). Release on any uncertainty.

### Visual design and animation (the contract; no separate design pass)

Placement: Settings → General, after "Unpin confirmation", desktop build only.

```
┌───────────────────────────────────────────────────────────────────────┐
│ Keep PC awake during tasks                                   [  ●]   │
│ Stops Windows from sleeping while a task is running.                  │
│ The screen can still turn off.                                        │
├───────────────────────────────────────────────────────────────────────┤
│ Keep PC awake for schedules                                  [●  ]   │
│ Stops Windows from sleeping while a schedule is active so it runs    │
│ on time. The screen can still turn off.                               │
│ (M10 off:) No schedules are enabled on this PC.                       │
├───────────────────────────────────────────────────────────────────────┤
│ (● 8px dot) Keeping this PC awake: a task is running                  │
│ Closing the lid or choosing Sleep still sleeps the PC.               │
└───────────────────────────────────────────────────────────────────────┘
```

- Rows: existing `settings-row` + `PreferenceControl` switch (`.settings-switch`, 36×24, 16 px thumb); no new switch styling.
- Status line `div.settings-power-status` inside the schedules row's copy column (render only when `desktop.power` exists and either switch is on). 13 px text, `var(--muted)` color, 8 px gap, `role="status"` `aria-live="polite"`.
- Dot `span.settings-power-dot`: 8×8 px circle, `aria-hidden`. Colors by state: `holding` → `var(--accent-solid, var(--accent))`; `idle` → `var(--muted)` at 60% opacity; `unavailable` → the color used by the existing `.error-text` class (defined outside `settings.css`; DISCOVERY: reuse its CSS variable, do not hard-code a hex).
- Copy:
  - `idle`: "Not keeping this PC awake right now."
  - `holding` + `tasks`: "Keeping this PC awake: a task is running."
  - `holding` + `schedules`: "Keeping this PC awake: a schedule is active."
  - `holding` + `both`: "Keeping this PC awake: tasks and schedules are active."
  - `unavailable`: "Gen couldn't keep this PC awake. Windows may still sleep." (no retry button; the next reconcile retries)
  - Second line, always when either switch is on: "Closing the lid or choosing Sleep still sleeps the PC."
- Animation (DESIGN.md motion tokens):
  - Status text change: 160 ms opacity crossfade, entrance easing `cubic-bezier(.16,1,.3,1)`; implement as keyed span with `@keyframes settings-power-fade {from{opacity:0}to{opacity:1}}` (no layout shift: fixed line height 20 px).
  - Entering `holding`: one 240 ms pulse on the dot only (`transform: scale(1) → scale(1.35) → scale(1)`, `opacity 1 → .7 → 1`), easing `cubic-bezier(.4,0,.2,1)`. No looping or breathing animation.
  - Status line appearing/disappearing when a switch toggles: 180 ms height+opacity enter / 140 ms exit (list insert/remove token), via `grid-template-rows: 0fr → 1fr` so content does not jump.
  - Switch thumb: existing `--ui-motion-hover` transition, unchanged.
  - Reduced motion (`prefers-reduced-motion: reduce` or Settings motion = Reduced/Off): no scale, no height animation; opacity changes ≤ 80 ms.
- Tray: tooltip text only (no icon change in v1).
- Browser build: rows hidden; search for "awake" returns nothing.

## EXECUTION_DAG

| ID | Goal | Depends on | Files | Owner boundary |
|---|---|---|---|---|
| T01 | Contracts: preferences + desktop power state | — | `packages/contracts/preferences.ts`, `packages/desktop-contract/index.ts`, `tests/preferences.test.ts` | contracts only |
| T02 | Host activity + `harness.power.read` control | T01 | `packages/core/service.ts`, `apps/server/host.ts`, `apps/server/desktop-controls.ts`, `tests/desktop-host-controls.test.ts`, new `tests/power-activity.test.ts` | server/core |
| T03 | Power keeper module + main wiring | T01, T02 | new `apps/desktop/power-keeper.ts`, `apps/desktop/main.ts`, new `tests/desktop-power-keeper.test.ts`, `tests/desktop-state-broadcast.test.ts` | desktop main |
| T04 | Settings rows, status line, styles, search | T01 | `apps/web/src/Settings.tsx`, `apps/web/src/settings-registry.ts`, `apps/web/src/settings.css`, `tests/settings-registry.test.ts`, `tests/settings-search-filter.test.ts` | web UI |
| T05 | Playwright coverage | T03, T04 | `tests/` browser/desktop specs (DISCOVERY: follow the pattern of existing desktop Playwright specs run by `scripts/test-browser.ts`) | tests |
| T06 | Real Windows verification + docs | T05 | evidence on the issue; `CHANGELOG.md` entry | verifier |
| T07 | Front end team review handoff | T06 | issue comment + PR | implementer |

### T01 Contracts
- Add `keepAwakeTasks: z.boolean(), keepAwakeSchedules: z.boolean()` to `preferencesSchema`; defaults `false` in `DEFAULT_PREFERENCES`.
- Add `DesktopPowerState` and `power?` to `DesktopState`.
- Tests: `getPreferences({})` → both false; `mergePreferences(current, {keepAwakeTasks:true})` keeps other keys; patch `{keepAwakeTasks:'yes'}` throws; stored legacy object without the keys reads false.
- Done when `pnpm exec vitest run tests/preferences.test.ts` passes and `pnpm exec tsc --noEmit -p .` has no new errors.

### T02 Host activity + control
- Add `powerActivity()` per DESIGN; `powerRead()` in `host.ts`; `harness.power.read` branch in `handleDesktopControl` with exactly 3 keys, success/failure replies per contract.
- Positive tests: thread with `runId` → tasks true; status `working` → true; only `awaiting_input` → false; active planning children → true; active unpaused wakeup with `nextDueAtMs` → schedules true; paused / CANCELLED / DELIVERED / BLOCKED / null due → false; `RUNNING` background work → true; preferences echoed.
- Negative tests: wrong token / extra key → returns false and `powerRead` not called; `powerRead` throws → `error:'Power state is unavailable.'`; host not accepting → error reply.
- Done when the new and existing desktop-control tests pass.

### T03 Power keeper
- Implement `power-keeper.ts` per DESIGN with injected API and timers; wire into `main.ts` steps 1–9.
- Tests with fake API and fake timers: off → no start; tasks on + running → exactly one start; second reconcile while holding → no second start; task ends → stop once; both reasons → one blocker, reason `both`; start throws → `unavailable`, no id; `isStarted` false → `unavailable`; two read failures → release + `unavailable`; one failure then success → still holding; `release()` idempotent; concurrent `reconcile()` calls serialize; debounce collapses 10 `schedule()` calls into one read; `dispose()` clears poll timer; notify fires only on change.
- Done when `tests/desktop-power-keeper.test.ts` passes and `DesktopState.power` appears in `tests/desktop-state-broadcast.test.ts` expectations.

### T04 Settings UI
- `SETTINGS_ROWS`: `row('harness-keep-awake-tasks','Keep PC awake during tasks','general','sleep awake power battery screen idle running task suspend')`, `row('harness-keep-awake-schedules','Keep PC awake for schedules','general','sleep awake power battery screen idle schedule scheduled background suspend')` after `unpin-confirmation`.
- `preferenceRows`: map both ids to their keys with the DESIGN descriptions (schedules description adds "No schedules are enabled on this PC." when the snapshot/flags show M10 off; DISCOVERY: find the flag in the settings snapshot or `BackgroundWork` data; if not exposed, omit that sentence rather than guess).
- `PLATFORM_OVERRIDES`: both ids `'desktop'`. Also exclude them from non-search section listing in the browser build (verified: the non-search list at `Settings.tsx` line 153 is `SUPPORTED_SETTINGS.filter(item => item.section === section)` with no platform check; add `&& (item.platform === 'all' || item.platform === (desktop ? 'desktop' : 'browser'))` there).
- Status line + dot + CSS per DESIGN; read `desktop.power` from `useDesktop()`.
- Tests: registry marks both rows desktop; browser search "awake" → 0 results; desktop search "sleep" → both rows.
- Done when tests pass and `pnpm lint` and `pnpm test:ui-guard` pass.

### T05 Playwright
- Desktop-shell spec (or the existing desktop bridge fake): toggle on → switch `aria-checked=true`, row persists after reload; fake `power` state `holding/tasks` → status text and dot visible; `unavailable` copy; reduced-motion emulation → no transform animation on the dot (computed `animation-name` none or opacity-only); browser build → rows absent.
- Done when the spec passes under `pnpm test:browser`.

### T06 Real Windows verification
- Installed Windows build. Set sleep timeout to 1 minute (`powercfg /change standby-timeout-ac 1`), restore afterwards.
- Matrix: (a) both off + running task → `powercfg /requests` shows no Gen V1 entry, PC sleeps; (b) tasks on + running task → Gen V1 listed under SYSTEM, PC stays awake past 3 minutes, display turns off per its own timeout; (c) task completes → entry disappears within 35 s and PC sleeps; (d) Stop running tasks from tray → released; (e) quit while holding → released; (f) kill the backend process → released within 35 s; (g) M10 enabled with an active interval schedule + schedules on → held; pause the schedule → released.
- Record exact commands, outputs and a screen recording; post them on the issue. Add a `CHANGELOG.md` line.

### T07 Front end team review
- After T01–T06 pass, request review of the PR from Leonardo's front end team (mention it in the PR and post an issue checkpoint with RECIPIENT=front end team), attaching screenshots of every status state (light and dark), the reduced-motion check, and the recording. Address their feedback before calling the work done.

## VALIDATION

| Level | Command | Expected |
|---|---|---|
| Unit | `pnpm exec vitest run tests/preferences.test.ts tests/desktop-host-controls.test.ts tests/power-activity.test.ts tests/desktop-power-keeper.test.ts tests/desktop-state-broadcast.test.ts tests/settings-registry.test.ts tests/settings-search-filter.test.ts` | all pass |
| Regression | `pnpm test` (or `pnpm test:no-lease` where the credential lease build is unavailable), `tests/update-readiness.test.ts` unchanged | pass |
| UI guards | `pnpm lint`, `pnpm test:ui-guard` | pass |
| Browser | `pnpm test:e2e` or `pnpm test:browser` after build | T05 spec passes |
| Real user | T06 matrix on Windows | all rows as listed |

Acceptance matrix:

| Req | Task | Check |
|---|---|---|
| R01 | T01 | preference tests |
| R02 | T02 | power-activity tests |
| R03 | T02 | desktop-host-controls tests |
| R04 | T03, T06 | keeper tests; `powercfg /requests` (b) |
| R05 | T03 | debounce/poll/resume tests |
| R06 | T03, T06 | failure tests; (d)(e)(f) |
| R07 | T01, T03 | broadcast test |
| R08 | T04 | registry/search tests |
| R09 | T03, T06 | tooltip check |
| R10 | T04, T05 | role/aria + reduced motion |
| R11 | all | no dependency/flag diff in PR |
| R12 | T05–T07 | evidence + front end review |

Planned tests only; nothing has been executed for this plan.

## STATE

- Researched/decided: this plan (r1). Implemented: nothing. Verified: nothing.
- Owners/branches: none yet. Docs PR holds this file only.
- Risks: (1) the workspace event stream may not fire on every run-state change; the 30 s poll bounds the delay. (2) Corporate power policies can override app requests; T06 records what `powercfg /requests` shows. (3) M10 off means the schedules switch has no visible effect on default hosts; copy explains it.
- Next step: an implementer claims T01 on the issue per AGENTS.md, branches from current `main`, and starts with the preferences schema.

## REFERENCES

- Batch 3 proposal item 1 (maintainer-approved): "Keep the PC awake during runs (S) — A setting that stops Windows from idle-sleeping while a run or scheduled task is active. Claude Desktop has two toggles for this, one for scheduled tasks and one for running sessions. Gen has schedules but never calls Electron's `powerSaveBlocker`."
- Claude Desktop scheduled tasks docs: https://code.claude.com/docs/en/desktop-scheduled-tasks
- Electron `powerSaveBlocker` API: https://www.electronjs.org/docs/latest/api/power-save-blocker
- Windows `powercfg /requests`: https://learn.microsoft.com/windows-hardware/design/device-experiences/powercfg-command-line-options
- Repo: `AGENTS.md` (plan, checkpoint and release contract), `DESIGN.md` § Motion tokens, `docs/progress.md` (M01–M17).
