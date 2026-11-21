# Plan: Command menu (Ctrl+K)

## META

| Field | Value |
|---|---|
| Feature | One searchable, keyboard-driven menu for every app action: new thread, switch thread or project, open settings sections, run a skill, open or toggle panels |
| Size | small (labels `feature`, `small`); no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | https://github.com/skytuhua-org/Gen-V1/issues/1371 |
| Plan file | `docs/agent-plans/command-menu.md` (identical to the issue body below the file link) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git ls-remote origin refs/heads/main` on 2026-11-21) |
| Related work | No existing issue or PR for a command menu, command palette or quick switcher (searched issues for "command menu", "command palette", "Ctrl+K"). `docs/progress.md` M01–M17 has no palette milestone and no palette flag exists in `packages/core/capability-flags.ts` or `packages/core/host-flags.ts`. Existing related surfaces that are **not** this feature: the composer `/` command menu (`apps/web/src/ComposerCommands.tsx`, models/modes/skills for the draft), conversation find (`ConversationFind.tsx`, Ctrl+F), the sidebar thread search (today on Ctrl+K). Open sibling plans that also touch `keyboard-bindings.ts` / `preferences.ts`: quick-ask hotkey (#1332) and others from batches 3–4; coordinate per AGENTS.md (rebase, refresh before editing shared files). |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 4, item 2: "Command menu, Ctrl+K (S): One searchable menu for every action: new thread, switch project, open settings, run a skill, toggle panels. The Codex/ChatGPT desktop app makes Ctrl+K or Ctrl+Shift+P its main way to get around ([commands reference](https://learn.chatgpt.com/docs/reference/commands.md)). Gen's `keyboard-bindings.ts` has shortcut infrastructure, but the repo has no command palette. Repo area: apps/web/src/keyboard-bindings.ts, App.tsx, new palette component." Repository facts below were read at the baseline SHA; line numbers refer to it. Decisions marked **DECIDED** were made by the planner (the owner delegated every non-approval decision); options not taken are recorded. |

**Design and animation ownership (batch 4 rule).** There is no separate front end team designing this feature: **this plan specifies the visual design and animation** (DESIGN §6–§7), and implementers build exactly that. Leonardo asked that the finished work then be **sent to the front end team for review**: task T07 does that, and the issue is not complete until their review is recorded.

## OBJECTIVE

**User problem.** Gen V1 has many actions spread across the sidebar, the workspace panel tabs, the summary rail, Settings (12 sections) and a handful of rebindable shortcuts. Users must know where each one lives. The ChatGPT/Codex desktop app solves this with one command menu (Windows: Ctrl+K or Ctrl+Shift+P) that searches every action and every chat. Gen has shortcut metadata (`keyboard-bindings.ts`) but no action menu; Ctrl+K today only focuses the sidebar thread search.

**Intended behavior.**
1. Pressing **Ctrl+K** (rebindable) or **Ctrl+Shift+P** (fixed alias) anywhere in the main conversation shell or the All Agents shell opens a centred command menu with the search box focused.
2. With an empty query the menu shows **Recent** commands (last 5 run) then all commands grouped: Actions, Panels, Projects, Settings.
3. Typing filters commands by label and keywords and, from the first character, also lists matching **Threads** and **Skills**.
4. Arrow keys move the highlight, Enter runs the highlighted command, Esc closes. Mouse hover highlights and click runs.
5. The menu closes before the command runs; focus lands where the command puts it (e.g. the new thread's composer).

**Measurable success.**
1. Every action listed in R05 is reachable by typing ≤ 4 characters of its label (unit T02 ranking table).
2. Opening the menu shows the search box focused within one animation frame of the keypress and adds no network request when the query is empty (browser T06).
3. Running "New thread", "Open settings: Appearance", "Toggle sidebar", "Open Files", a thread result and a skill result each produce the same end state as the existing UI path for that action (browser T06).
4. Users who never changed shortcuts get Ctrl+K = command menu and sidebar thread search moves to Ctrl+Shift+F; users who had rebound thread search keep their chord (unit T01/T03).
5. No regression in the suites listed in VALIDATION, including keyboard-bindings, preferences, ui-shell overlays and the UI guard.

## REQUIREMENTS

### In scope

- R01 New rebindable preference `keybindings.commandMenu`, default `'Ctrl+K'`, validated like the other keybindings in `packages/contracts/preferences.ts` (string 1–80).
- R02 Fixed alias `Ctrl+Shift+P` (not rebindable) also opens the menu (D2).
- R03 Thread search default moves from `Ctrl+K` to `Ctrl+Shift+F` (D1), with the migration rule in DESIGN §1 so a user's own rebinding of thread search is kept.
- R04 Availability: the menu opens from the main conversation shell (`App.tsx`, not in embedded threads, same gate as today's listener) and from the All Agents shell (`WorkspaceHost.tsx` `MonitorShell`), each with its own command list (R05). It does not open while another native dialog is open (`dialog[open]`, same as existing globals), while IME composition is active, or for an already-prevented event. While the menu is open, pressing its chord again closes it.
- R05 Commands in v1 (main shell). Each runs the **same existing code path** as the UI control it mirrors (REPO_MAP); none calls backend commands directly.
  - Actions: New thread; Search threads in sidebar; Stop active run (only listed when a run is active); Rename current thread (only when a thread is selected); Keyboard shortcuts (opens Settings → Keyboard Shortcuts).
  - Panels: Toggle sidebar; Toggle workspace panel; Open Files; Open Diff; Open Terminal; Open Notes; Open Plan; Open Output; Open Usage; Linked pull requests.
  - Projects: Choose project… (opens the existing project picker); one "Switch to <project name>" item per connected local project (same handler the picker calls on choice, DISCOVERY X3); Connect a project… (existing connect flow).
  - Settings: Open settings; one "Settings: <section label>" item per entry in `SETTINGS_SECTIONS` (12 sections).
  - Threads (query ≥ 1 char): up to 8 matches from the navigation read model, each "Go to <thread title>" with project name as detail.
  - Skills (query ≥ 1 char, a thread or project context exists): up to 6 skill catalog matches; choosing one inserts the skill into the current composer exactly as the composer `/skill:` menu does, then focuses the composer (DISCOVERY X4).
- R06 All Agents shell commands: New thread, Open settings, Settings: <section> items, Search threads, Toggle sidebar (the actions that shell already owns, `WorkspaceHost.tsx:227–241`). No thread/skill/panel groups there in v1.
- R07 Unavailable commands are shown disabled with a short reason (e.g. "No thread selected", skill availability label from `ComposerCommands.tsx` `availabilityLabel`) and cannot run; commands whose prerequisite is absent by design (Stop with no run) are hidden rather than disabled.
- R08 Matching and ranking as DESIGN §3: case-insensitive, diacritic-insensitive, word-prefix > substring > in-order subsequence; label weighs more than keywords; ties keep group then registry order. At most 50 rows rendered.
- R09 Recent: the ids of the last 5 commands run (excluding thread and skill results) persist in `localStorage` key `harness:command-menu:recent:v1`; corrupt or unknown ids are ignored. Shown only for an empty query.
- R10 Each row shows the command's current shortcut when it has one (live chord from preferences, formatted by the existing `keyboard-bindings.ts` formatter).
- R11 Run semantics: close the menu, then run the command on the next animation frame so the Modal's focus restore happens first and the command's own focus move wins. Errors go to the shell's existing error reporting (`setError` / `fail`). The menu never waits for a command to finish.
- R12 Accessibility: native modal dialog via the shared `Modal` (labelled "Command menu"); search input `role="combobox"`, `aria-expanded`, `aria-controls` the listbox, `aria-activedescendant` the highlighted row, `aria-autocomplete="list"`; `role="listbox"` with `role="group"` per heading (`aria-labelledby`), rows `role="option"`, `aria-selected`, `aria-disabled`; `aria-keyshortcuts` on rows that have chords; a polite live region announces the result count ("12 results", "No results") after typing settles. Focus stays in the input during arrow navigation. Keyboard reference and Settings list the new binding.
- R13 Visual design and animation exactly as DESIGN §6–§7, using existing tokens only; dark, light and high-contrast; density compact/comfortable/touch; reduced-motion and motion-off variants; 100/125/150% zoom; narrow (≤ 700 px) and short windows.
- R14 Security/privacy: no new host command, IPC, capability or network endpoint. Thread search reuses `getShellNavigation`; skill search reuses `getSkillCatalog`. The recent list stores command ids only (never thread titles, project names or query text).
- R15 Hand-off: the finished work goes to the front end team for review (T07) before the issue is closed.

### Out of scope (v1)

- Running arbitrary host/agent commands, plug-in contributed commands, or commands from extensions (a contribution API is a later feature).
- Sub-menus / nested pages (e.g. "Change model ›" listing models); model and mode stay in the composer `/` menu.
- Search inside messages, files or settings rows (Settings has its own search; Files has its own UI).
- Toggling the summary dock/overview rail (no external toggle API exists, `packages/ui-shell/SummaryDock.tsx`; would need an owner API decision).
- Native desktop menu-bar integration and global (OS-wide) shortcuts.
- Command menu inside detached/native secondary windows and embedded threads.

### Decisions (DECIDED by planner)

- D1 Ctrl+K becomes the command menu and thread search moves to Ctrl+Shift+F. Reason: matches the proposal and Codex/ChatGPT (Ctrl+K command menu, chat search unassigned there); the menu also searches threads, so Ctrl+K still finds threads. Options not taken: keep Ctrl+K for search and use only Ctrl+Shift+P (breaks the approved "Ctrl+K" name); remove the search binding (loses a direct way to the sidebar search).
- D2 Ctrl+Shift+P as a fixed, non-rebindable alias (VS Code/Codex habit). Option not taken: make it a second preference (adds a Settings row for little value).
- D3 Use the shared `Modal` (blocking, centred), not `Popover`: the menu has no anchor and must own focus and Escape. Inline combobox/listbox semantics inside the modal are allowed by the UI guard (`scripts/ui-guard-policy.md`).
- D4 Close first, then run (R11). Option not taken: keep the menu open for multi-step commands (no sub-menus in v1).
- D5 Commands are built inside each shell component from its existing closures (a `useMemo` list passed to the menu), not from a new global registry/store. Keeps the existing guarded paths (`prepareWorkspace`, journal flush, owner bindings) intact. A pure module holds only types, ranking and recent storage.
- D6 Thread results use the existing navigation read model with its 180 ms debounce; no client-side scan of the snapshot.
- D7 Recent list in `localStorage` (per browser profile, like `harness:shell-layout:v1`), not a host preference: it is UI history, not a setting.
- D8 No new preference to turn the feature off; users can rebind the chord. Option not taken: a Settings switch.

### Compatibility, performance

- Preferences: `readPreferences` fills missing keybindings from defaults; `commandMenu` needs only a default plus the D1 migration in DESIGN §1. Stored preferences written before this change still parse.
- The new chord could equal a chord a user already gave another binding; the menu handler runs first (DESIGN §2) and Settings shows the duplicate (T03).
- Performance: menu component mounted only while open; ranking is synchronous over ≤ ~60 static commands; thread/skill requests are debounced and aborted on each keystroke (existing helpers do this).

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | File:line | Fact |
|---|---|---|
| Keybinding schema/defaults | `packages/contracts/preferences.ts:30–34` (strict `keybindings` object: search, newThread, toggleSidebar, toggleRightPanel, openSettings, stop), `:71` defaults (`search: 'Ctrl+K'`), `:73–77` `mergePreferences`/patch schema, `readPreferences` below it (per-key safeParse of stored keybindings, unknown stored keys kept) | add `commandMenu`; migration lives in `readPreferences`. |
| Shortcut registry | `apps/web/src/keyboard-bindings.ts:4–5` (scopes), `:8–20` (`KeyboardBinding`: id, label, scope, chords?, hint?, preference?, handlers), `:26–48` (`KEYBOARD_BINDINGS`; `search` is "Search threads", Global, handlers App.tsx + WorkspaceHost.tsx), `:52` `PREFERENCE_BINDINGS` (drives Settings rows), `readChord` below; formatting/`ariaKeyShortcuts` later in the file | metadata only; no action dispatcher. |
| Registry tests | `tests/keyboard-bindings.test.ts` | checks unique ids, scopes, preference coverage and that each `handlers` module calls `matchesShortcut` for the binding. |
| Chord matching | `apps/web/src/shell-layout.ts:23–35` `matchesShortcut` (Ctrl matches Ctrl or Meta, not both; `comma`, `esc` aliases) | reuse. |
| Main shell global keys | `apps/web/src/App.tsx:786–796` | window keydown, skipped for embedded threads and when `event.defaultPrevented || document.querySelector('dialog[open]')`; branches: search (open sidebar + focus `searchRef`), newThread (`newThreadRef.current()`), toggleSidebar (mobile drawer vs collapsed layout), toggleRightPanel, openSettings (`setSettingsSection('general'); setSettingsOpen(true)`), stop. |
| All Agents global keys | `apps/web/src/WorkspaceHost.tsx:227–241` (`action`, `openSettings`, `stopFocused`, `shortcuts` ref, keydown with same gate; search opens sidebar and focuses `searchRef`) | second owner, needs its own menu mount. |
| New thread | `apps/web/src/App.tsx:765–786` (`createThread`, `ensureThread`, `newThreadRef` = `prepareWorkspace()` then `openProjectSelection()`, guarded by `composerPending`/`creationPending`) | |
| Select thread | `apps/web/src/App.tsx:761–764` `select` / `selectNow` | sidebar uses `select`; canvas uses `prepareWorkspace()` then `select(id)` (`App.tsx:914`). |
| Thread search read model | `apps/web/src/shell-navigation.ts:6` `useShellNavigation(text)` (180 ms debounce, abort, `limit: 100`, `getShellNavigation` from `shell-read-api`) | reuse for Threads group (call with the query). |
| Projects | `apps/web/src/App.tsx:572–586` `pickProject` (flushes editor handoff + journal; may create a new thread by design), `:735–741` `openProjectSelection` / `closeProjectSelection`; project connect `openProjectConnect({})` (sidebar prop at `:1150`) | |
| Settings | `apps/web/src/Settings.tsx:32–38` `SETTINGS_SECTIONS` (12 `[id,label]`), `:35` `SECTION_ICONS`; `App.tsx:526` `settingsSection` state, `:1207` `SettingsWindow initialSection` | |
| Panels/tools | `apps/web/src/App.tsx:1046–1069` `openSplitTool`, `revealWorkspaceTool(kind)`; `:917` `openSidebarTool` (usage, linked-pull-requests); `apps/web/src/shell-layout.ts:6` `WORKSPACE_TABS` (artifact, plan, files, diff, notes, output, usage, terminal, pull-request, linked-pull-requests) | Composer already calls `revealWorkspaceTool('files', id)` / `revealWorkspaceTool('diff')` (`App.tsx:1186`). |
| Rename | `App.tsx:1150` sidebar `rename` prop: `prepareSourceJournal().then(()=>{selectNow(id);setTitle(title);setRename(true)})` | |
| Composer skill menu | `apps/web/src/ComposerCommands.tsx:1–40` (`getSkillCatalog`, `SkillCatalogEntry`, `availabilityLabel`, `replaceCommandToken`, `SkillBinding`); `apps/web/src/composer-commands.ts` | reference for skill search and insertion. |
| Modal primitive | `packages/ui-shell/Modal.tsx:7–80` (`open,title,onClose,children,className`; `showModal`, focus retention, restores previous focus on close, Escape/IME handling, Tab wrap, keeps content mounted during exit animation; header `h2` + close button) | |
| Modal styles/motion | `packages/ui-shell/controls.css:75–114` (`.ui-modal` fixed, `width:min(560px, calc(100% - 16px))`, `padding: var(--ui-dialog-inset)`, surface/border tokens, radius 12px, opacity + `scale(.97)` → none over `--ui-motion-popup-enter` with `--ui-ease-enter`, reduced-motion = opacity with `--ui-motion-press`, native titlebar `top:42px`) | |
| Tokens | `packages/ui-shell/tokens.css:2–44` (spacing 4/8/12/16/24, rows 32/36/44, motion tokens: popup enter 180 ms / exit 140 ms, hover 120 ms, press 80 ms, eases), `apps/web/src/styles.css:3–4` (dark: `--surface:#0f0f0f --subtle:#171717 --hover:#262626 --border:#282828 --text:#e6e6e6 --muted:#a0a0a0 --selection-bg:#1f1f1f`; light equivalents), `apps/web/src/useAppearance.ts:18–38` (motion system/reduced/off, speed, `--control-radius`, font sizes), `apps/web/src/appearance.css:17–19` | |
| Shortcut hint style | `packages/ui-shell/ActionMenu.tsx:81` `<kbd className="ui-control-shortcut" aria-hidden="true">` | reuse class for row chords. |
| UI guard | `scripts/ui-guard-policy.md`, `scripts/ui-guard.ts` (approved primitive files list; numeric-children rule), `scripts/ui-overlay-legacy.json` (not permission for new overlays) | compose `Modal`; render numeric gates as `{list.length > 0 && …}`. |
| Browser tests | `playwright.config.ts`, `scripts/browser-suites.ts:3–19` (`rootBrowserSpecs`), `:27,96` suites `ui-shell-overlays`, `ui-shell-controls`, `:83` suite `shell` (`frontend.spec.ts`); `tests/e2e/ui-shell-overlays.spec.ts:12–23` (modal + searchbox focus + Escape restore example) | |
| Unit tests | `tests/preferences.test.ts`, `tests/shell-shortcut-roundtrip.test.ts`, `tests/keyboard-bindings.test.ts`, `tests/ui-shell-overlay.test.ts`, `tests/ui-guard.test.ts` | |
| Source manifest | `CONTRIBUTING.md`, `scripts/public-source-files.json` (e.g. `apps/web/src/ComposerCommands.tsx` listed at `:89`) | every new source file must be listed. |

DISCOVERY items (verify before editing; record answers in the T01 checkpoint):
- X1 Whether `Ctrl+Shift+F` is free in every keydown owner (grep `matchesShortcut`, `key === 'F'`/`'f'` with shift in `apps/web/src`, xterm, editor). If it is taken, use the first free chord of `Ctrl+Alt+F`, `Ctrl+Shift+H` and record it as a plan revision before coding.
- X2 How keys reach the window listener when focus is inside the terminal (`TerminalBody.tsx` xterm) and the code editor: does xterm stop propagation of Ctrl+K? Rule to implement: when the event target is inside the terminal, Ctrl+K is left to the terminal (shell "kill line") and only Ctrl+Shift+P opens the menu.
- X3 The exact handler the project picker calls when a project is chosen (`pickProject` arguments at `App.tsx:572–586` and its caller at `:1201–1204`) so "Switch to <project>" calls it identically.
- X4 How the composer `/skill:` menu binds a chosen skill (`replaceCommandToken`, `SkillBinding`, the composer draft owner and journal), and the smallest exported entry point the command menu can call to insert a skill into the selected thread's composer (e.g. a `composerRequest` state like `modelPickerRequest` at `App.tsx:1186`). If no safe entry point exists without refactoring the composer, ship the Skills group as "Insert /skill:<name>" via a new request prop mirroring `modelPickerRequest`, and record it.
- X5 Whether Settings search inventory (`apps/web/src/settings-inventory.ts`) derives `harness-keybinding-*` rows from `PREFERENCE_BINDINGS` automatically or needs an entry for `commandMenu`.
- X6 Which browser fixture config mounts the full `App` shell with a mock host (candidates: `shell` suite / `tests/e2e/frontend.spec.ts`, `overnight-shell.spec.ts`), to host the new spec.

## DESIGN

### 1. Preferences (T01)

`packages/contracts/preferences.ts`:
```ts
const keybindings = z.strictObject({ /* existing */ commandMenu: z.string().min(1).max(80) });
// DEFAULT_PREFERENCES.keybindings
{ search: 'Ctrl+Shift+F', newThread: 'Ctrl+Shift+O', toggleSidebar: 'Ctrl+B', toggleRightPanel: 'Ctrl+Shift+B',
  openSettings: 'Ctrl+Comma', stop: 'Escape', commandMenu: 'Ctrl+K' }
```
Migration in `readPreferences` (only place that reads stored data): if the stored keybindings object has **no** `commandMenu` key and its `search` equals `'Ctrl+K'` (case-insensitive, trimmed), read `search` as the new default `'Ctrl+Shift+F'`. Any other stored `search` value is kept. Stored data that already has `commandMenu` is read as is. No write-back is needed: the next `settings.update` persists the read value.

### 2. Shortcut handling (T03)

- `keyboard-bindings.ts`: add `{id:'command-menu', label:'Open command menu', scope:'Global', preference:'commandMenu', handlers:[module('App.tsx'), module('WorkspaceHost.tsx')]}` as the **first** entry, and `{id:'command-menu-alias', label:'Open command menu', scope:'Global', chords:['Ctrl+Shift+P'], handlers:[module('App.tsx'), module('WorkspaceHost.tsx')]}`. The existing `search` binding keeps its id and label.
- `App.tsx` and `WorkspaceHost.tsx` keydown listeners: add as the **first** branch (before search), after the existing gate:
```ts
if (!isComposing(event) && (matchesShortcut(event, preferences.keybindings.commandMenu) && !inTerminal(event.target) || matchesShortcut(event, chordFor('command-menu-alias')))) {
  event.preventDefault(); setCommandMenuOpen(true); return;
}
```
  `inTerminal` = target is inside the terminal host element (selector from X2). Add `preferences.keybindings.commandMenu` to the App effect dependency list. `isComposing` from `packages/ui-shell/list-navigation`.
- Because the open menu is a `dialog[open]`, the window listeners ignore keys while it is open; the menu's own input `onKeyDown` closes it on either chord (R04).
- Settings: the keybinding row appears from `PREFERENCE_BINDINGS`; add an inline note under a shortcut input when its chord equals another preference binding's chord: "Also used by <label>" (muted, 12 px). Compare with `readChord` normalisation.

### 3. Pure module `apps/web/src/command-menu.ts` (T02)

```ts
export type CommandGroup = 'recent' | 'actions' | 'panels' | 'projects' | 'threads' | 'skills' | 'settings';
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = ['recent','actions','threads','panels','projects','skills','settings'];
export const COMMAND_GROUP_LABEL: Record<CommandGroup,string> = {recent:'Recent', actions:'Actions', threads:'Threads', panels:'Panels', projects:'Projects', skills:'Skills', settings:'Settings'};
export interface CommandItem {
  id: string;                 // stable, e.g. 'new-thread', 'panel:files', 'settings:appearance', 'project:<id>', 'thread:<id>', 'skill:<id>'
  group: Exclude<CommandGroup,'recent'>;
  label: string; detail?: string; keywords?: readonly string[];
  icon?: LucideIcon;          // type-only import
  bindingId?: string;         // KEYBOARD_BINDINGS id for the chord hint
  disabledReason?: string;    // R07
  remember?: boolean;         // default true; false for thread/skill results
  run(): void | Promise<void>;
}
export function normalize(text: string): string;           // NFD, strip combining marks, lower-case, collapse spaces
export function scoreCommand(query: string, item: CommandItem): number; // 0 = no match
export function rankCommands(query: string, items: readonly CommandItem[], limit = 50): CommandItem[];
export function groupCommands(items: readonly CommandItem[]): {group: CommandGroup; items: CommandItem[]}[];
export function readRecent(storage: Pick<Storage,'getItem'>): string[];          // max 5, strings only
export function writeRecent(storage: Pick<Storage,'getItem'|'setItem'>, id: string): void; // move to front, dedupe, cap 5, try/catch quota errors
```
Scoring (higher is better): label word-prefix match of every query word 100 (+10 if it is the label start); label substring 60; keyword word-prefix 40; label in-order subsequence 20 (only when query ≥ 2 chars); else 0. Multi-word queries must match every word (any field). Stable sort by score desc, then `COMMAND_GROUP_ORDER`, then input order. Empty query: no ranking; shell list order with Recent first.

### 4. Component `apps/web/src/CommandMenu.tsx` (T04)

```tsx
export function CommandMenu(props: {
  open: boolean; onClose(): void;
  commands: readonly CommandItem[];          // static commands from the shell
  threadResults?: (query: string) => {items: CommandItem[]; pending: boolean; error: string; retry(): void};
  skillResults?: (query: string) => {items: CommandItem[]; pending: boolean; error: string; retry(): void};
  chord(bindingId: string): string | undefined; // formatted live chord
  reportError(error: unknown): void;
}): JSX.Element
```
- Renders `<Modal open={open} title="Command menu" onClose={onClose} className="command-menu-dialog">`.
- State: `query`, `activeId`. Reset both every time `open` becomes true (no query memory across opens).
- Rows = empty query ? Recent (resolved from `readRecent` against `commands`, skipping disabled/unknown) + all commands grouped : `rankCommands(query, [...commands, ...threads, ...skills])` grouped.
- Active row: first enabled row after each query change; ArrowDown/ArrowUp move to next/previous enabled row with wrap; PageDown/PageUp move 8; Ctrl+Home/Ctrl+End to first/last (plain Home/End stay with the input caret). Mouse move over a row sets it active (pointermove, not mouseenter, so a stationary pointer does not steal the highlight during keyboard use). The active row is scrolled into view with `block: 'nearest'`.
- Enter (not composing): if the active row is enabled → `writeRecent` when `remember !== false`, `onClose()`, then `requestAnimationFrame(() => Promise.resolve(item.run()).catch(reportError))`. Click does the same. Disabled rows: no-op.
- Thread/skill hooks: the shell passes functions built on `useShellNavigation(query)` and the skill catalog loader; the component calls them only when `query.trim().length > 0`. To respect hook rules the shell owns the hooks and passes `query` down via a lifted state, or the component exposes `onQuery` — implementer chooses one, keeping hooks unconditional.
- Live region: `<div role="status" aria-live="polite" className="visually-hidden">` updated 300 ms after the last keystroke with "N results" / "No results".
- Rendering rule (UI guard): numeric gates as `{rows.length > 0 && …}`.

### 5. Shell wiring (T05)

`App.tsx`: `const [commandMenuOpen, setCommandMenuOpen] = useState(false)`; `const commands = useMemo<CommandItem[]>(() => [...], [deps])` built from the closures in REPO_MAP:

| id | Label | Group | Run | Condition |
|---|---|---|---|---|
| `new-thread` | New thread | actions | `newThreadRef.current()` (respect `composerPending`) | always; disabled "A thread is being created" while pending |
| `search-threads` | Search threads in sidebar | actions | same as the search shortcut branch | always |
| `stop-run` | Stop active run | actions | same as stop branch | listed only when the focused/selected thread has `runId` |
| `rename-thread` | Rename thread | actions | same as sidebar `rename(thread)` | disabled "No thread selected" |
| `keyboard-shortcuts` | Keyboard shortcuts | actions | `setSettingsSection('keybindings'); setSettingsOpen(true)` | always |
| `toggle-sidebar` | Toggle sidebar | panels | same as toggleSidebar branch | always |
| `toggle-workspace-panel` | Toggle workspace panel | panels | same as toggleRightPanel branch | always |
| `panel:<tab>` | Open Files / Diff / Terminal / Notes / Plan / Output | panels | `revealWorkspaceTool(tab)` | disabled "No thread selected" when the tab needs a thread (match the existing tab bar's disabled rule; discover in T05) |
| `panel:usage`, `panel:linked-pull-requests` | Open Usage / Linked pull requests | panels | `openSidebarTool(kind)` | always |
| `choose-project` | Choose project… | projects | `openProjectSelection()` | always |
| `project:<id>` | Switch to <name> | projects | picker's choose handler (X3) | each connected local project except the current one |
| `connect-project` | Connect a project… | projects | `openProjectConnect({})` | always |
| `open-settings` | Open settings | settings | `setSettingsSection('general'); setSettingsOpen(true)` | always |
| `settings:<id>` | Settings: <label> | settings | `setSettingsSection(id); setSettingsOpen(true)` | each `SETTINGS_SECTIONS` entry |

Keywords (examples, extend sensibly): new thread → `chat, conversation, task, create`; toggle sidebar → `navigation, hide, show`; files → `explorer, tree`; terminal → `shell, console`; keyboard shortcuts → `keybindings, hotkeys`; settings sections → their `SECTION_ICONS` meaning plus the section id. Icons: `SECTION_ICONS` for settings rows, lucide icons already used by the matching sidebar/tab buttons for others (no new icon dependency).

Threads: each navigation item → `{id:'thread:'+id, group:'threads', label:title || 'Untitled thread', detail: projectName, remember:false, run: async () => { await prepareWorkspace(); select(id); }}`, max 8, current thread excluded. Skills: X4 entry point, max 6, `disabledReason` from availability.

`WorkspaceHost.tsx` `MonitorShell`: own `commandMenuOpen` state and list per R06 using `shortcuts.current.action('new-thread')`, `openSettings` (extend to accept a section through the existing settings open path; discover how MonitorShell passes a section, else open general), search branch, toggleSidebar branch.

Mount `<CommandMenu …/>` once per shell next to the existing Settings window mount. Both shells never mount at the same time (`WorkspaceHost.tsx:191–193` chooses one), so there is one listener owner.

### 6. Visual design (DECIDED, R13)

All values come from existing tokens/variables; literal pixel sizes below are layout values, colors are always variables (dark values shown for reference).

- Dialog (`.command-menu-dialog` overrides `.ui-modal`): `width: min(640px, calc(100% - 32px))`; anchored near the top: `margin: 12vh auto auto` (keep the native-titlebar rule: never above `top: 42px` + 8 px); `max-height: min(480px, calc(100% - 24vh))`; `padding: 0`; `overflow: hidden`; flex column. Background `var(--surface)`, 1 px `var(--border)`, radius 12 px (as `.ui-modal`), shadow `var(--elevation)`. Backdrop: existing modal scrim + blur tokens (unchanged).
- Header: the Modal header (`h2` + close button) is visually hidden with the standard clip pattern and becomes visible (top-right, 32 px close button) only when the close button has keyboard focus. The dialog keeps its accessible name "Command menu".
- Search row: 48 px tall (touch density 52 px), padding 0 16 px, `Search` lucide icon 16 px `var(--muted)`, 12 px gap, borderless transparent input, font `var(--interface-font)` at `calc(var(--interface-font-size) + 1px)`, text `var(--text)`, placeholder "Search commands and threads…" in `var(--muted)`. 1 px `var(--border)` bottom divider. No focus ring on the input (the dialog itself is the focus context; the active row shows position). A clear (×) button appears at the right when the query is non-empty (28 px, quiet).
- List: scrolls (`overflow:auto`, `scrollbar-width: thin`), padding 6 px, `overscroll-behavior: contain`.
- Group heading: 12 px, weight 500, `var(--muted)`, padding 8 px 10 px 4 px, sentence case (Recent, Actions, Threads, Panels, Projects, Skills, Settings). First heading has 2 px top padding.
- Row: height = density row token (`--ui-row-compact` 32 / `--ui-row-comfortable` 36 / `--ui-row-touch` 44), padding 0 10 px, gap 10 px, radius `var(--control-radius)`; icon 16 px `var(--muted)`; label 13 px `var(--text)`, single line, ellipsis; detail (project name, skill source, disabled reason) 12 px `var(--muted)` after the label, ellipsis, shrinks first; right side chord using `.ui-control-shortcut` kbd styling.
- Active row: background `var(--selection-bg)`, icon `var(--text)`. Hover uses the same active state (hover moves the highlight). No outline. High-contrast: active row also gets a 1 px `var(--text)` inset outline (existing high-contrast variables).
- Disabled row: label and icon at 50% opacity, reason text in detail, `cursor: default`; highlight can land on it (screen readers announce aria-disabled) but Enter does nothing.
- Query match emphasis: matched characters of the label in weight 600 (no color change).
- Loading (threads/skills): while a request is pending and no rows exist yet for that group, one row with the existing small spinner primitive (as used in `ComposerCommands.tsx` `LoaderCircle`) and "Searching threads…" / "Searching skills…" in muted text. Only during real loading.
- Error in a group: one row with the error text (12 px, danger status token + `CircleAlert` icon) and a text button "Retry" calling `retry()`.
- Empty state (query matches nothing and nothing pending): centred block, 24 px vertical padding: "No results for "<query>"" (13 px `var(--text)`) and "Try a different word, or press Esc to close." (12 px `var(--muted)`).
- Footer: 32 px row, 1 px top `var(--border)`, padding 0 12 px, 12 px `var(--muted)`: "↑↓ to move · Enter to run · Esc to close" using kbd chips; hidden at ≤ 700 px window width.
- Narrow (≤ 700 px): width `calc(100% - 16px)`, `margin-top: 8px` below the titlebar reservation, `max-height: calc(100% - 24px)`.
- Light theme uses the same variables (light values from `styles.css`); zoom 125/150% must not clip the footer (list shrinks first).

### 7. Animation (DECIDED, R13)

- Open/close: reuse the shared `.ui-modal` transition unchanged — opacity 0→1 and `scale(.97)`→none over `--ui-motion-popup-enter` (180 ms) with `--ui-ease-enter`; close reverses over the popup-exit token (140 ms) while `Modal` keeps the last content mounted. Add `transform-origin: 50% 0` on `.command-menu-dialog` so it grows from its top edge. Backdrop fades with the existing rule. No new keyframes.
- Interruptible: pressing the chord during the close transition reopens immediately (Modal re-shows; no queued animation).
- Highlight movement: **no transition** (keyboard navigation must be instant). Hover background on pointer move also instant.
- Filtering: rows appear/disappear without animation; list height changes immediately (no height tween). Scroll-into-view uses `behavior: 'auto'`.
- Clear button and footer: no animation. Spinner: existing primitive's rotation, which the motion policy already stops under reduced/off.
- Reduced motion (`motion: 'reduced'` or OS setting with `system`): existing modal rule (opacity only, press-duration token ≤ 80 ms, no scale). Motion off / `panelAnimations: false`: no transitions (existing `appearance.css` rule). `motionSpeed` scaling comes from the existing token multiplier.
- Use token variables only; no literal durations or curves (UI guard).

### 8. Error, cancel, rollback

- Command failure: the error goes to the shell's existing error banner; the menu is already closed; nothing is retried automatically.
- Thread/skill request failure: group error row with Retry (DESIGN §6); static commands still work.
- Closing the menu aborts pending thread/skill requests (existing hooks abort on unmount/query change).
- Rollback: reverting the PR leaves a stored `commandMenu` keybinding, which `readPreferences` keeps losslessly as an unknown key; thread search returns to its stored chord (users migrated by §1 keep `Ctrl+Shift+F` stored only if they saved settings after migration; acceptable).

## EXECUTION_DAG

One implementing worker may do all tasks in order on one branch/PR. T02 can run in parallel with T01; T04 after T02; T05 after T01–T04.

### T01 — Verify assumptions, preferences and migration
- Dependencies: none. Owner: implementing worker.
- Steps: rebase on current main; re-run `rg -n "command menu|command palette|commandMenu" apps packages`; answer X1–X6; post a checkpoint with answers and line drift; then implement DESIGN §1.
- Files: `packages/contracts/preferences.ts`, `tests/preferences.test.ts`.
- Tests: default has `commandMenu: 'Ctrl+K'`, `search: 'Ctrl+Shift+F'`; stored `{keybindings:{search:'Ctrl+K'}}` reads search as `Ctrl+Shift+F`; stored `{keybindings:{search:'Ctrl+Alt+S'}}` keeps it; stored `{keybindings:{search:'Ctrl+K', commandMenu:'Ctrl+K'}}` keeps search `Ctrl+K`; `mergePreferences` accepts `{keybindings:{commandMenu:'Ctrl+P'}}` and rejects an 81-char chord.
- Done when: checkpoint posted; `pnpm exec vitest run tests/preferences.test.ts --maxWorkers=1` and `pnpm typecheck` pass.

### T02 — Ranking, grouping and recent storage
- Dependencies: none. Files: new `apps/web/src/command-menu.ts`, new `tests/command-menu.test.ts`, `scripts/public-source-files.json`.
- Steps: DESIGN §3.
- Tests: ranking table (`"new"` → New thread first; `"nwth"` → New thread via subsequence; `"term"` → Open Terminal; `"appear"` → Settings: Appearance; `"set app"` multi-word → Settings: Appearance; `"café"` matches "Cafe" thread; keyword hit ranks below label hit; no match → []); limit 50; group order; recent: dedupe, cap 5, ignore corrupt JSON and non-strings, setItem throwing is swallowed.
- Done when: `pnpm exec vitest run tests/command-menu.test.ts --maxWorkers=1` passes.

### T03 — Shortcut registry, listeners and Settings note
- Dependencies: T01. Files: `apps/web/src/keyboard-bindings.ts`, `apps/web/src/App.tsx` (listener branch only), `apps/web/src/WorkspaceHost.tsx` (listener branch only), `apps/web/src/Settings.tsx` (duplicate note), `apps/web/src/settings-inventory.ts` if X5 requires, `tests/keyboard-bindings.test.ts`, `tests/shell-shortcut-roundtrip.test.ts`.
- Steps: DESIGN §2. Until T05 lands, `setCommandMenuOpen` can be the state setter with no menu mounted.
- Tests: registry suite passes with both new bindings and handler modules; round-trip: Ctrl+K opens, Ctrl+Shift+P opens, Ctrl+K inside terminal target does not, Ctrl+Shift+F focuses sidebar search; Settings shows "Also used by" when two preference chords are equal.
- Done when: `pnpm exec vitest run tests/keyboard-bindings.test.ts tests/shell-shortcut-roundtrip.test.ts --maxWorkers=1` passes.

### T04 — CommandMenu component and visual design/animation
- Dependencies: T02. Files: new `apps/web/src/CommandMenu.tsx`, new `apps/web/src/command-menu.css` (import style as sibling components do, e.g. `ComposerCommands.tsx` imports `./composer-commands.css`), `scripts/public-source-files.json`.
- Steps: DESIGN §4, §6, §7 exactly.
- Tests: component tests (render with fixture commands): empty query shows Recent then groups; typing filters; arrows skip disabled and wrap; Enter on enabled closes then runs once; Enter on disabled does nothing; click runs; chord closes; live region text; thread/skill pending, error + Retry and empty states. `pnpm lint` and `pnpm test:ui-guard` pass with **no** new entries in `scripts/ui-overlay-legacy.json`.
- Done when: those pass and `pnpm typecheck` passes.

### T05 — Shell wiring
- Dependencies: T01–T04. Files: `apps/web/src/App.tsx`, `apps/web/src/WorkspaceHost.tsx`.
- Steps: DESIGN §5; X3 and X4 entry points; disabled rules for panel tabs copied from the existing tab bar.
- Tests: extend existing App/WorkspaceHost tests if present (discover with `rg -ln "WorkspaceHost|<App" tests`); otherwise covered by T06.
- Done when: `pnpm typecheck`, `pnpm test:no-lease` pass.

### T06 — Browser coverage
- Dependencies: T05. Files: new `tests/e2e/command-menu.spec.ts` in the fixture config found in X6; register it in `scripts/browser-suites.ts`.
- Scenarios: Ctrl+K opens with search focused; Ctrl+Shift+P opens; Esc closes and focus returns to the previous element; type "appear" + Enter opens Settings on Appearance; "new" + Enter starts the new-thread flow (project selection opens as today); "toggle side" + Enter collapses the sidebar; "files" + Enter opens the Files tab; a thread result switches thread; a skill result inserts the skill into the composer; disabled "Rename thread" with no thread; no network request on open with empty query; Ctrl+Shift+F focuses sidebar search; All Agents shell: Ctrl+K opens its menu with R06 commands; IME composition (keyCode 229) in another input does not open the menu. Screenshots: dark, light, high-contrast, compact and touch density, 700 px wide, 150% zoom, empty state, loading row, error row; reduced-motion run asserts no transform transition.
- Done when: `pnpm test:browser --suite <suite from X6>` and `pnpm test:browser --suite ui-shell-overlays` pass.

### T07 — Docs, PR and front end team review
- Dependencies: T06. Files: `CHANGELOG.md`; the user-facing shortcuts doc if one exists (discover with `rg -ln "Ctrl\+K|keyboard shortcut" docs | head`).
- Steps: document Ctrl+K / Ctrl+Shift+P and the Ctrl+Shift+F move; open the PR linked to this issue with the T06 screenshots and a short screen recording of open → search → run → close at normal and reduced motion.
- **Front end team review (requested by Leonardo):** send the finished PR to the front end team for review of the visual design and animation, with the screenshots, the recording and a link to DESIGN §6–§7. Post a HANDOFF checkpoint on this issue naming the front end team as recipient. Apply their requested changes (revise this plan first if they change a DECIDED item) and re-request review.
- Done when: front end team review recorded on the PR, maintainer review requested, CI green; do not close the issue without authorization.

## VALIDATION

### Commands (planned; none executed by this planning session)
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test:ui-guard
pnpm exec vitest run tests/command-menu.test.ts tests/preferences.test.ts tests/keyboard-bindings.test.ts tests/shell-shortcut-roundtrip.test.ts tests/ui-shell-overlay.test.ts --maxWorkers=1
pnpm test:no-lease
pnpm test:browser --suite ui-shell-overlays
pnpm test:browser --suite <suite from X6>
```

### Acceptance matrix

| Req | Tasks | Check |
|---|---|---|
| R01 | T01,T03 | default + merge tests; Settings row present |
| R02 | T03,T06 | Ctrl+Shift+P opens |
| R03 | T01,T06 | migration tests; Ctrl+Shift+F focuses search |
| R04 | T03,T06 | gates: dialog open, IME, embedded, terminal; chord toggles closed |
| R05 | T05,T06 | each command reaches the same end state as its UI control |
| R06 | T05,T06 | All Agents menu commands |
| R07 | T04,T06 | disabled rows with reason; hidden Stop |
| R08 | T02 | ranking table |
| R09 | T02,T04 | recent storage tests; Recent group on empty query |
| R10 | T04 | chord hints follow preferences |
| R11 | T04,T06 | close-then-run order; focus ends at destination |
| R12 | T04,T06 | roles/ARIA, live region, keyboard-only run |
| R13 | T04,T06,T07 | screenshots match §6–§7; reduced/off motion; UI guard green |
| R14 | T05 | no new host command/IPC; recent stores ids only |
| R15 | T07 | front end team review recorded |

Release gate: all rows green, CI green, screenshots and recording attached to the PR, front end team review done. Rows that cannot run are marked NOT_RUN/BLOCKED, never assumed.

## STATE

- Researched/decided: everything above (planner, 2026-11-21). Implemented: nothing. Verified: nothing (no tests run; planning only).
- Owners/branches: none yet. The plan file is added by a docs PR (linked at the top of the issue).
- Risks: moving thread search off Ctrl+K changes a habit (mitigated by the menu's thread search and the migration keeping custom chords); terminal and editor key handling may swallow or need Ctrl+K (X2); skill insertion may need a small composer request API (X4); concurrent sibling plans edit `keyboard-bindings.ts` and `preferences.ts` (rebase and refresh before editing).
- Next step: T01 by the implementing worker.

## REFERENCES

- Proposal source: batch 4 feature list, item 2 (text quoted in META Provenance).
- ChatGPT/Codex commands and shortcuts (Windows: "Open command menu: Ctrl+Shift+P or Ctrl+K"; "Search chats: not assigned by default"): https://learn.chatgpt.com/docs/reference/commands.md
- WAI-ARIA combobox with listbox popup pattern: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- Repository: `AGENTS.md` (plan and checkpoint contract), `CONTRIBUTING.md`, `DESIGN.md` (overlay and motion rules), `scripts/ui-guard-policy.md` at the baseline SHA.
