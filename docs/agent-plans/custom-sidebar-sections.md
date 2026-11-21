# Plan: Your own sidebar sections

## META

| Field | Value |
|---|---|
| Feature | Custom sidebar sections: the user creates, names, collapses, reorders and deletes their own sections in the sidebar thread list and moves threads between them by drag, keyboard or menu |
| Size | medium (labels `feature`, `medium`); no sub-issues (one DAG, ownership boundaries below) |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue (number assigned at publication; the issue header links it) |
| Plan file | `docs/agent-plans/custom-sidebar-sections.md` (identical to this issue body) |
| Plan revision | r1, 2026-11-21 (UTC) |
| Baseline | `main` @ `e883ac0327c834120d89c3697dec7380a342ba4d` (verified with `git log -1` on a fresh clone, 2026-11-21) |
| Related work | No existing issue or PR for user-defined sidebar sections, folders or topics (searched issues/PRs for "sidebar section", "folder", "topic"). Related but distinct: #1139 (de-clutter sidebar thread rows), #1187 (sidebar/thread-list/hover-card animation spec C1–C7; its spec was not re-read for this plan, see DISCOVERY X7), #1182 (workspace animation coverage). `docs/progress.md` M01–M17 has no row for custom sections. Sibling batch 4 features are planned in their own issues and do not touch the sidebar. |
| Implementation status | NOT_STARTED. Planning only; nothing is implemented. |
| Provenance | Approved for planning by the repository owner (Leonardo) on 2026-11-21 from researched feature proposal batch 4, item 3: "Your own sidebar sections (M): Create named sections or topics in a project's thread list and drag threads between them. Gen's sidebar has four fixed sections (`pinned`, `working`, `flat`, `settled` in `sidebar-reorder.ts`)." Owner instructions for this batch: there is no separate front end team designing these features, so this plan specifies the visual design and animation itself; when the work is finished the implementing agent sends it to the front end team for review (task T09). All repository facts were read by static inspection of the baseline SHA; line numbers refer to that SHA. Decisions marked **DECIDED** were made by the planner (the owner delegates non-approval decisions); options not taken are recorded. No code was built or tested while planning. |

**Design ownership.** This plan defines the visual design and motion (DESIGN §7). Implementers build exactly that with existing tokens. When all other tasks are verified, the implementing agent sends the finished work to Leonardo's front end team for review (T09) before the issue can close.

## OBJECTIVE

**User problem.** Gen's sidebar groups threads only by fixed, app-controlled buckets: Pinned, Working, the ungrouped list ("flat") and Settled (`apps/web/src/sidebar-reorder.ts:6`, `apps/web/src/ShellSidebar.tsx:179–186,429–471`). A user who runs several work streams (features, reviews, bugs, experiments) can only pin, settle or reorder; everything important ends up in Pinned or in one long list. Users of a comparable product ask for exactly this: "Codex Desktop: add project-level topics / grouped threads in the sidebar" (https://github.com/openai/codex/issues/30986, open, 11 reactions: "If I create a separate Codex project for every subproject, the sidebar becomes noisy and fragmented"), "allow custom ordering and sections in the left sidebar" (https://github.com/openai/codex/issues/28692, open: "Users can rename, pin, and archive threads, but that does not let us create a durable personal work structure"), and "add flags, labels, icons, or folders for organizing chats" (https://github.com/openai/codex/issues/28213, open, 8 reactions: "pinning is too coarse: everything important ends up in one bucket"). The batch 4 proposal also reports that ChatGPT desktop has since shipped user sections (not re-verified while planning).

**Intended behavior.** With the flag on, the user clicks **New section** in the sidebar, types a name ("Reviews") and presses Enter. A collapsible section headed "Reviews" appears below Working. The user drags threads into it (or uses the row menu **Move to section → Reviews**, keyboard accessible); they stay there across restarts, in a manual order inside the section. Sections can be renamed, moved up/down, collapsed and deleted; deleting a section returns its threads to the main list, never deletes threads.

**Measurable success.**
1. Create a section and move a thread into it in ≤ 4 interactions by pointer (New section, type name + Enter, drag) and fully by keyboard (T08 browser test).
2. Section membership and section order survive a host restart (T03 unit test reopens the store).
3. Deleting a section with N threads leaves all N threads present in the flat list with no other presentation change (T03 unit test).
4. With the flag off, sidebar DOM, commands and read models equal baseline; stored sections are kept but invisible (T03 unit + T08 browser).
5. All acceptance rows R01–R18 in VALIDATION pass, and the existing sidebar unit and browser suites (`tests/sidebar-reorder.test.ts`, `tests/sidebar-project-order.test.ts`, `tests/e2e/sidebar-shared-menu.spec.ts`, `tests/e2e/sidebar-collapse.spec.ts`, `tests/e2e/thread-move.spec.ts`), keyboard-bindings, reduced-motion coverage and UI guard still pass.

## REQUIREMENTS

### In scope

- **R01 Section entity.** A section has `id` (host-generated, `sec_` + random), `name` (trimmed, 1–60 characters, unique case-insensitively), `order` (finite number, |order| ≤ 1,000,000, same bound as thread order in `packages/core/service.ts:1321`), `createdAt`, `updatedAt`. At most 50 sections; creating a 51st fails with `RESOURCE_LIMIT` "You can have up to 50 sections."
- **R02 Scope.** **DECIDED:** sections are host-global, like the sidebar preferences `projectGrouping`/`projectOrder` (`packages/contracts/preferences.ts:46`, stored in `settings/global`, `packages/core/service.ts:1127–1135`). A section may hold threads from any project; each row keeps its project chip. Per-project sections are out of scope (see Decisions).
- **R03 Membership.** A thread belongs to at most one section through a new optional `presentation.sectionId: string | null`. Membership is set only by explicit user action (drag, row menu, keyboard). New threads have no section.
- **R04 Placement precedence.** Rows are placed with this precedence: Pinned → Working (only when `showWorkingSection` is on, unchanged) → **its section** → Settled → flat. **DECIDED:** pinning, working and settling win over section membership but do not clear `sectionId`, so unpinning, a run ending, or **Return to inbox** puts the thread back in its section. Settling a thread inside a section moves it to Settled (settled means done everywhere).
- **R05 Rendering.** Sections render as collapsible groups after Working and before the flat list, in ascending `order`. Rows inside a section are ordered by `presentation.order` ascending then `updatedAt` descending, in every sort mode (a section is a manual list like Pinned). Project grouping (`orderSidebarProjects`, `ShellSidebar.tsx:68–87`) applies only to the flat list, as today.
- **R06 Create.** **New section** button (DESIGN §7.2) and **Move to section → New section…** in the row menu. Create inserts a section at the end with the inline name field focused and prefilled "New section" selected. Enter or blur commits; Escape cancels and removes the draft; an empty or duplicate name shows the inline error "Enter a name" / "A section named “X” already exists" and keeps the field open. When created from the row menu, the thread moves into the new section on commit.
- **R07 Rename.** Section header menu **Rename** (and F2 on a focused header) turns the header label into the same inline field, prefilled and selected; same commit/cancel/validation rules.
- **R08 Reorder sections.** Header menu **Move up** / **Move down** and Alt+ArrowUp/Alt+ArrowDown on a focused section header move the section by one place. Pointer drag of section headers is out of scope for v1.
- **R09 Collapse.** Clicking the header toggles collapse exactly like Pinned/Working: `layout.folded['section:' + id]` in the browser layout state (`apps/web/src/shell-layout.ts:4–21`, key length < 220 holds for `section:sec_…`). Collapsed state is per browser, not synced (same as existing groups). The header shows the thread count in both states.
- **R10 Delete.** Header menu **Delete section**. Empty section: deleted immediately with toast "Section deleted" + **Undo** (recreates it with the same id, name and order within the toast lifetime). Non-empty: confirm dialog (shared `Modal`, `packages/ui-shell/Modal.tsx`) titled "Delete “Reviews”?" with body "Its 4 threads move back to your thread list. No threads are deleted." and buttons **Delete section** (danger) and **Cancel** (default focus). The host clears `sectionId` on every member thread and deletes the section in one storage transaction (DESIGN §3).
- **R11 Pointer drag.** Threads can be dragged into a section (between rows or into an empty section), between sections, and out of a section into the flat list or Pinned, reusing the existing HTML5 and touch long-press drag (`sidebar-reorder.ts:175–280`). Dropping into a section clears `pinned` and `settled` and sets `sectionId`; dropping onto the flat list sets `sectionId: null`; dropping onto Pinned sets `pinned: true` and keeps `sectionId`. Drops onto Working and Settled remain invalid (unchanged rule, `dropPatch` `sidebar-reorder.ts:45–49`). Hovering a collapsed section header for 600 ms during a drag expands it (spring-load); it stays expanded after the drop.
- **R12 Keyboard and menu move.** Row menu gains **Move to section** with a nested list: every section by name (current one checked and disabled), separator, **New section…**, and **Remove from section** (only when the thread has a section). Alt+ArrowUp/Down keep moving a row within its section (existing `move`, `sidebar-reorder.ts:157–173`). New binding `thread-move-section` (Alt+Shift+ArrowUp / Alt+Shift+ArrowDown, scope Sidebar) moves the focused row to the previous/next section in visual order (flat list counts as the position after the last section), placing it at the end; focus follows the row. After any keyboard/menu move a polite live-region announcement says "Moved “<thread>” to <section>" (or "to your thread list").
- **R13 Empty and locked states.** An empty section stays visible while the list is unlocked, with the dashed hint "Drag threads here." (same treatment as `sidebar-pinned-empty`). While searching or filtering (`locked`, `ShellSidebar.tsx:188`), only sections with matching rows render, without the hint, and drag/reorder/create are disabled as today.
- **R14 Archive and lifecycle.** Archiving keeps `sectionId`; unarchiving returns the thread to its section if it still exists. A `sectionId` pointing to a deleted or unknown section is treated as no section on read (projection drops it) and cleared on the next presentation write of that thread.
- **R15 Flag.** New host capability flag `ui.sidebarSectionsV1`, owner `m15` (the existing UI/workbench owner of `ui.sourceWorkbenchV1`, `packages/core/capability-flags.ts:127`; X2 confirms the owner choice is acceptable), default **false**. Flag off: section commands fail `CAPABILITY_DENIED`, the navigation read model omits `sections` and every `sectionId`, the sidebar shows no New section button or section menu items, and stored data is untouched.
- **R16 Accessibility.** Each section is a `<section>` with an `<h2>` containing the toggle button (`aria-expanded`, label "<name>, <count> threads"); the header menu is an `ActionMenu` labelled "Options for section <name>"; the inline field is a labelled `<input>` ("Section name") with `aria-invalid` and `aria-describedby` for errors; drag has a full keyboard and menu equivalent (R12); all new bindings are registered in `KEYBOARD_BINDINGS` (`apps/web/src/keyboard-bindings.ts:25–48`) and appear in the keyboard reference; IME composition never commits a name.
- **R17 Errors.** Every failed command keeps the previous UI state and shows a toast with the host message (pattern of the settle action, `ShellSidebar.tsx:216–219`): `INVALID_INPUT` name errors are shown inline instead. A failed drag commit leaves the row where it was (existing `commit` abort, `sidebar-reorder.ts:121–134`).
- **R18 Performance.** With 50 sections and 2,000 threads, sidebar render after a refresh stays under 16 ms scripting on the CI browser (measured in T08); section lookup is a `Map` built once per render, never a per-row search.

### Out of scope (v1)

- Per-project sections or sections inside a project's run; nested sections; section colors/icons/emoji; tags/labels with many-to-one membership; smart/rule-based sections; multi-select drag; pointer drag of section headers; syncing collapse state across devices; sections on the paired-device (M17) remote views; any change to Pinned/Working/Settled semantics beyond R04/R11.

### Decisions (DECIDED) and options not taken

| Topic | Decision | Not taken (why) |
|---|---|---|
| Storage of membership | `presentation.sectionId` on the thread (one field, reuses `thread.presentation` command, survives archive) | Membership list on the section (two writers for one fact; drift on delete) |
| Storage of sections | New store entity kind `sidebar_section`, one row per section, `thread_id` null | Inside `settings/global` preferences (whole-object rewrites race with concurrent preference edits; preferences are validated as a closed schema) |
| Scope | Host-global | Per project (Gen's sidebar already interleaves projects; a per-project model needs project headers that do not exist, `ShellSidebar.tsx:436`) |
| Precedence | Pinned > Working > Section > Settled > flat, membership kept | Section beats Pinned (pinning would lose meaning); clearing `sectionId` on pin (surprising loss) |
| Settled inside section | Settled wins, section remembered | Settled rows shown inside their section (sections would fill with done work) |
| Delete | Members return to flat in one transaction | Delete threads too (destructive); block delete of non-empty sections (extra steps) |
| Ordering inside a section | Always manual by `presentation.order` | Follow `projectOrder` (a user-built list should not reshuffle by activity) |
| Section reorder | Menu + Alt+Arrow on header | Drag headers (extra drag target type; deferred) |

### UX flows

1. **Create and fill.** Click **New section** → draft header with focused field "New section" (selected) → type "Reviews", Enter → section appears (empty hint) → drag a thread onto it → thread moves; drop line and section highlight shown during drag; toast none.
2. **Move by menu.** Row **…** → **Move to section** → **Reviews** → row moves; live region announces.
3. **Move by keyboard.** Focus a row → Alt+Shift+ArrowUp → row moves to the previous section, focus stays on it.
4. **Rename.** Header **…** → **Rename** → edit → Enter.
5. **Delete.** Header **…** → **Delete section** → confirm → members appear in flat list with the row-move motion.
6. **Pin and unpin.** Pin a thread in Reviews → it shows in Pinned; unpin → back in Reviews.

### Compatibility, security, privacy, accessibility

- Additive contract change: `presentation.sectionId` optional; old clients ignore it; old hosts reject it (`INVALID_INPUT`) which is why the client sends it only when the read model advertises `sections` (flag on).
- No new HTTP route: commands go through the existing authenticated `/api/commands` envelope with CSRF header (`apps/server/server.ts:55,222`, `apps/web/src/api.ts:115–124`). Names are user text: rendered as text nodes only, never HTML; length-limited at the host.
- Section names are personal data stored locally in `harness.sqlite`; they are not sent to models, telemetry or remote sync.
- Accessibility per R16; reduced motion per DESIGN §7.6.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Area | Location | Fact |
|---|---|---|
| Section model | `apps/web/src/sidebar-reorder.ts:6–10` | `SidebarSection = 'pinned' \| 'working' \| 'flat' \| 'settled'`, `SidebarLists`, `DropTarget {list,index}`, `OrderWrite` |
| Placement | `sidebar-reorder.ts:13–20` `sectionOf` | Pinned, then working (runId/working/awaiting_input when `showWorking`), then settled, else flat |
| Ordering helpers | `sidebar-reorder.ts:23–42` | `orderFor` fractional insert, `rebalance` dense 1-based rewrite |
| Drop rules | `sidebar-reorder.ts:45–49` | Pinned → `{pinned:true}`; others propose `{pinned:false}` valid only if `sectionOf` matches |
| Group clamp | `sidebar-reorder.ts:56–71` | only `flat` is clamped to project runs |
| Hit testing | `sidebar-reorder.ts:73–99` | containers are `[data-thread-list]`, rows `.sidebar-thread-row[data-thread-id]`; X ignored |
| Hook | `sidebar-reorder.ts:101–303` | `useThreadReorder` options `lists, locked, showWorking, groupKey, presentation, ensureManualOrder, prepareMove, toast`; returns `dragging, indicatorTop, begin, end, key`; commit writes moved row then other rows sequentially (not atomic) |
| Keyboard | `apps/web/src/keyboard-bindings.ts:25–48` | `thread-reorder-up/down` Alt+Arrow, `thread-drag-cancel` Escape, scope Sidebar |
| Sidebar lists | `apps/web/src/ShellSidebar.tsx:179–202` | computes pinned/working/settled/remaining, `locked`, passes lists to hook |
| Row menu | `ShellSidebar.tsx:205–223` | `ActionMenu` items: Place, Detach, Rename, Pin, Unread, Settle, Archive |
| Row DOM | `ShellSidebar.tsx:226–334` | draggable button, payload `application/x-gen-thread`, hover card |
| Group renderer | `ShellSidebar.tsx:337–362` | `<section data-thread-list>` + `h2 > button[aria-expanded]` + `MotionRegion` |
| Layout of list | `ShellSidebar.tsx:429–476` | Pinned (always while unlocked, empty hint), Working, flat `div[data-thread-list=flat]`, drop indicator, Settled (first 6 + show more), empty states |
| MotionRegion | `apps/web/src/task-motion.tsx:73` | animated open/close region used by groups |
| Row move motion | `apps/web/src/sidebar-thread-move.ts:8–101` | FLIP of the same DOM node within its list, pointer only, full motion only; node remount (cross-list) is not animated (`:63`) |
| App wiring | `apps/web/src/App.tsx:1150` | `presentation` callback sends `thread.presentation` then `refresh()`; `setFolded` merges `layout.folded`; `ensureManualOrder` |
| Layout storage | `apps/web/src/shell-layout.ts:4–21` | localStorage `harness:shell-layout:v1`, `folded: Record<string, boolean>` |
| Thread contract | `packages/contracts/index.ts:3` | `presentation?: {pinned?, unread?, settled?, order?}` |
| Navigation row | `packages/contracts/shell-read-models.ts:5` | `ThreadNavigationRow` picks `presentation` |
| Projection | `packages/core/shell-read-models.ts:48–50` | `row()` copies presentation fields explicitly (pinned/unread/settled/order); a new field must be added there |
| Navigation read | `packages/core/shell-read-models.ts:70–83` | `navigation(input)` returns `NavigationPage` (page + order + stats) |
| Command | `packages/core/service.ts:1320–1323` | `thread.presentation` allows only pinned/unread/settled/order; shallow merge; `store.put('thread', …)` |
| Settings | `packages/core/service.ts:1127–1135`, `packages/contracts/preferences.ts:46,64` | host-global preferences in entity `settings/global` |
| Store | `packages/storage/store.ts:54–66,145–177` | generic `entities(kind,id,thread_id,body)`; `put` inside a transaction; commands run in `BEGIN IMMEDIATE` with receipts |
| Command route | `apps/server/server.ts:55,222`; client `apps/web/src/api.ts:115–124` | envelope `{id,type,threadId?,payload}` to `POST /api/commands` |
| Flags | `packages/core/capability-flags.ts:41–157,163–204` | key arrays + `hostDefinitions`; env `HARNESS_FLAG_<KEY>`; `capabilityEnabled()` host-side only |
| Flag to web | `apps/server/session-branch-routes.ts:23–25`, `apps/web/src/session-branch-api.ts:4–15` | pattern: host publishes `enabled` in a read DTO |
| Primitives | `packages/ui-shell/ActionMenu.tsx`, `Popover.tsx`, `Modal.tsx`, `Toast.tsx` | menu (items with checked/disabled), popover, modal dialog, toast with action |
| Tokens | `packages/ui-shell/tokens.css:20–72` | easings `--ui-ease-enter/move/spring`; durations hover 120, press 80, insert 180, remove 140, status 160, success 240, panel 220/180; reduced-motion handling |
| Motion policy | `apps/web/src/motion-policy.ts:1–23` | effective full/reduced/off from `data-motion` + OS |
| Sidebar CSS | `apps/web/src/sidebar-context.css:110–165,590–620` | group header styles, settled divider, pinned empty hint, drop indicator, drag source opacity .45 |
| UI guard | `scripts/lint-ui.ts`, `scripts/ui-guard.ts`, `scripts/ui-overlay-legacy.json` | new overlays must use `packages/ui-shell` primitives; no new legacy entries |
| Tests | `tests/sidebar-reorder.test.ts`, `tests/sidebar-project-order.test.ts`, `tests/shell-read-models.test.ts`, `tests/keyboard-bindings.test.ts`, `tests/reduced-motion-coverage.test.ts`, `tests/e2e/sidebar-shared-menu.*`, `tests/e2e/sidebar-collapse.*`, `tests/e2e/thread-move.*` | existing coverage to extend |

**DISCOVERY (implementer verifies before coding; record results in the first checkpoint):**
- X1: How the web client receives `NavigationPage` (fetch path and type in `apps/web/src/`), so `sections` and `sectionsEnabled` can be added to it; and whether `ShellPage` paging can drop a section's members across pages (sections must be built from the rows the client has, same as Pinned today).
- X2: Whether flag `owner` values are validated anywhere besides `hostDefinitions`; confirm `m15` or pick the owner a reviewer prefers.
- X3: The store API for listing entities by kind and deleting an entity inside the command transaction (`packages/storage/store.ts`); add a `delete` only if missing.
- X4: Whether `ActionMenu` supports nested menus; if not, **Move to section** opens a second `ActionMenu` anchored to the row menu button (no new overlay type).
- X5: How the archive read model (`shell-read-models.ts:91`) and unarchive handle presentation, to confirm R14.
- X6: Remote/paired projections (M17) that copy `presentation`; they must not expose `sectionId` or names (R02 privacy).
- X7: Read #1187's C1–C7 spec; if it fixes sidebar motion values that differ from DESIGN §7, follow #1187 and record the deviation.

## DESIGN

### 1. Contracts (`packages/contracts/sidebar-sections.ts`, new; re-export from the contracts index)

```ts
export interface SidebarSectionV1 { id: string; name: string; order: number; createdAt: string; updatedAt: string }
export const SIDEBAR_SECTION_LIMITS = { maxSections: 50, maxName: 60 } as const;
// Command payloads (type → payload)
// 'sidebar.section.create'  { name: string; afterOrder?: number }      → SidebarSectionV1
// 'sidebar.section.rename'  { sectionId: string; name: string }         → SidebarSectionV1
// 'sidebar.section.move'    { sectionId: string; order: number }        → SidebarSectionV1
// 'sidebar.section.delete'  { sectionId: string }                       → { deleted: string; released: string[] }
// 'sidebar.section.restore' { section: SidebarSectionV1 }               → SidebarSectionV1   (Undo of an empty-section delete)
```

`Thread.presentation` (`packages/contracts/index.ts:3`) gains `sectionId?: string | null`. `NavigationPage` gains `sections?: SidebarSectionV1[]` (present only when the flag is on) — X1 finds the exact type.

### 2. Host commands (`packages/core/service.ts`)

- `thread.presentation`: allow key `sectionId` whose value is `null` or the id of an existing section (else `INVALID_INPUT` "Unknown section"); reject it with `CAPABILITY_DENIED` when the flag is off. All other rules unchanged.
- `sidebar.section.create`: flag check; trim name; validate length and case-insensitive uniqueness against existing sections; enforce 50; `order` = max existing order + 1 (or 1); id `sec_` + 12 random base32 chars; `store.put('sidebar_section', id, null, section)`.
- `sidebar.section.rename`: same validation (uniqueness excludes itself); updates `updatedAt`.
- `sidebar.section.move`: validates finite order within bounds; client computes it with `orderFor` semantics over the section list; if neighbours leave no gap the client sends dense rewrites (one command per section, same as thread rebalance).
- `sidebar.section.delete`: in the single command transaction (`store.ts:153–177`) list threads whose `presentation.sectionId === sectionId`, set it to `null` on each, delete the section entity, return released ids.
- `sidebar.section.restore`: recreate the given section if no section with that id or name exists (Undo).
- All section commands are thread-less (`threadId` absent) like `settings.update`.

### 3. Read model (`packages/core/shell-read-models.ts`)

- `row()` (`:48–50`) copies `sectionId` only when the flag is on and the id exists in the section map; otherwise omits it (R14, R15).
- `navigation()` (`:70–83`) adds `sections` sorted by `order` then `createdAt` when the flag is on. The section map is read once per call.

### 4. Client placement (`apps/web/src/sidebar-reorder.ts`)

- `SidebarSection` becomes `'pinned' | 'working' | 'flat' | 'settled' | \`section:${string}\``; `SidebarLists` becomes `Record<string, Thread[]>` keyed by those ids (keep a type alias for the fixed four).
- `sectionOf(item, showWorking, patch, sectionIds)` applies R04: pinned → working → `section:<id>` when `sectionId` is in `sectionIds` → settled → flat.
- `dropPatch`: target `section:<id>` → `{pinned:false, settled:false, sectionId:id}`; target `flat` → `{pinned:false, sectionId:null}` (valid if resulting `sectionOf` is flat; a settled thread dropped on flat stays invalid as today); target `pinned` unchanged.
- `withinGroup` unchanged (sections are not project-clamped).
- New `moveToSection(item, delta)` for Alt+Shift+Arrow: target list = previous/next in `[...sectionLists, 'flat']`, index = end, writes via `orderFor`/`rebalance`.
- Spring-load: in `over`, when the pointer is over a collapsed section header (`[data-section-header]`) for 600 ms, call a new option `expand(sectionKey)`.

### 5. Client sidebar (`apps/web/src/ShellSidebar.tsx` + new `apps/web/src/SidebarSections.tsx`)

- `SidebarSections.tsx` exports `SectionHeader` (toggle, count, menu, inline name field) and `useSidebarSections(sections, rows)` returning `Map<sectionId, Thread[]>` and the visible order.
- `ShellSidebar` renders, after Working: for each section, `group('section:'+id, name, rows, {list:'section:'+id, keepVisible:!locked, empty:hint})` using `SectionHeader`; then the **New section** button (unlocked only); then flat; then Settled.
- Row menu adds **Move to section** (X4) and passes `sectionId` patches through the existing `presentation` callback.
- New props from `App.tsx`: `sections`, `sectionCommand(type, payload)`; App refreshes after each.
- Live region: reuse an existing polite announcer if X1 finds one in App; otherwise a visually hidden `role="status"` element inside the sidebar.

### 6. Data/control flow

User action → `sectionCommand`/`presentation` → `POST /api/commands` → service validates + stores in one transaction → client `refresh()` → `navigation()` returns rows + sections → sidebar re-renders → row-move / insert motion (DESIGN §7). Optimistic UI is not used (matches today's sidebar).

### 7. Visual design and motion (normative; no separate design team)

**7.1 Section header.** Same box as the Pinned/Working headers (`sidebar-context.css:116–141`): button full width, 12px, weight 500, `var(--muted)`, padding 6px 8px, radius 7px, hover `color: var(--text)` with background `color-mix(in srgb, var(--hover) 55%, transparent)`. Content left to right: `ChevronRight` 11px (rotates 90° when open, existing rule `shell.css:9–10`), section name (single line, ellipsis, `title` = full name), count `<small>` 11px pushed right. On hover or `:focus-within` the count is replaced in place by a 22×22 icon button (`MoreHorizontal` 14px) opening the header menu (Rename, Move up, Move down, separator, Delete section in danger color); count and button crossfade. Section block `margin-bottom: 10px`, like other groups. No icon, color or divider per section (out of scope).

**7.2 New section button.** Directly after the last section (or after Working when there are none): a ghost row button, height 28px, padding 6px 8px, radius 7px, `Plus` 12px + "New section", 12px `var(--muted)`; hover as headers. Hidden while locked and when the flag is off.

**7.3 Inline name field.** Replaces the label inside the header, same height (no layout shift): input 12px, padding 2px 6px, radius 5px, background `var(--surface)` (DISCOVERY: exact input surface token used by the search field `.search-field`), 1px border `var(--border)`, focus ring `--ui-focus-ring`. Error text below the header, 11px, semantic danger color, with `aria-live="polite"`.

**7.4 Empty hint.** Reuse `.sidebar-pinned-empty` styles (dashed 1px border, radius 9px, 11.5px muted) with text "Drag threads here."; during any drag its border uses `color-mix(in srgb, var(--accent) 55%, var(--border))` (existing rule `:600–603`).

**7.5 Drag feedback.** Existing 2px accent drop line (`.sidebar-drop-indicator`) and drag-source opacity .45. Additionally the section under the pointer gets `data-drop-target`: background `color-mix(in srgb, var(--accent) 7%, transparent)`, radius 9px, transition background `--ui-motion-hover` (120ms). Invalid targets show no highlight and the `none` drop effect as today.

**7.6 Motion (tokens only).**
- Section created: block grows from `grid-template-rows: 0fr` to `1fr` with opacity 0→1 over `--ui-motion-insert` (180ms) `--ui-ease-enter`; siblings below move with it (no jump).
- Section deleted: reverse over `--ui-motion-remove` (140ms) `--ui-ease-move`; released rows then appear in the flat list with the cross-list landing below.
- Collapse/expand: existing `MotionRegion` behaviour, unchanged.
- Thread moved within a section: existing FLIP (`sidebar-thread-move.ts`), unchanged.
- Thread moved across lists (drop, menu, keyboard, delete): the row lands with opacity 0→1 and `translateY(4px)`→0 over `--ui-motion-insert` (180ms) `--ui-ease-enter`; its old slot collapses over `--ui-motion-remove` (140ms). This is new because FLIP does not cover remounts (`sidebar-thread-move.ts:63`).
- Section moved up/down: FLIP of section blocks (same technique as rows) over `--ui-motion-insert` with `--ui-ease-move`.
- Spring-load expand: the normal `MotionRegion` open.
- Count change: number swaps instantly (no ticking animation).
- No idle, looping or attention motion.
- Reduced motion (`:root[data-motion="reduced"]`, `.app-shell[data-panel-animations="false"]`, `prefers-reduced-motion: reduce`): no transforms or height animation; opacity fades ≤ 80ms (`--ui-motion-press`) only. `data-motion="off"`: none. Respect live policy changes via `motion-policy.ts`. Add the new selectors to what `tests/reduced-motion-coverage.test.ts` inspects.

**7.7 Copy.** New section, Section name, Rename, Move up, Move down, Delete section, Move to section, New section…, Remove from section, Drag threads here., Section deleted, Undo, Enter a name, A section named “X” already exists, You can have up to 50 sections., Delete “X”?, Its N threads move back to your thread list. No threads are deleted. Sentence case, no exclamation marks; "thread"/"threads" pluralized correctly (1 thread).

### 8. Error/cancel/retry

Commands are idempotent through the existing receipt dedup (`store.ts:153–177`). Escape during a drag cancels (existing `thread-drag-cancel`). Escape in the name field cancels. A failed create removes the draft only after showing the error toast; a failed rename restores the old name. Multi-row order rewrites stay sequential like today; a mid-sequence failure leaves a valid (possibly unbalanced) order and the next move rebalances.

### 9. Migration/rollback

Additive: new entity kind, optional field, flag default off. No schema migration (generic `entities` table). Rollback = flag off; data stays. Removing the feature later = delete `sidebar_section` entities and ignore `sectionId`.

## EXECUTION_DAG

| ID | Goal | Depends on | Owner boundary |
|---|---|---|---|
| T01 | Discovery X1–X7 + flag + contracts | — | `packages/core/capability-flags.ts`, `packages/contracts/sidebar-sections.ts`, `packages/contracts/index.ts`, `scripts/public-source-files.json` if new files need listing |
| T02 | Host commands | T01 | `packages/core/service.ts` (section commands, `thread.presentation` key), `packages/storage/store.ts` only if X3 needs `delete` |
| T03 | Read model + host unit tests | T02 | `packages/core/shell-read-models.ts`, `tests/sidebar-sections-host.test.ts` (new), `tests/shell-read-models.test.ts` |
| T04 | Placement, drop and keyboard logic + unit tests | T01 | `apps/web/src/sidebar-reorder.ts`, `apps/web/src/keyboard-bindings.ts`, `tests/sidebar-reorder.test.ts`, `tests/keyboard-bindings.test.ts` |
| T05 | Sidebar UI (headers, menu, inline field, dialog, New section, live region, App wiring) | T03, T04 | `apps/web/src/SidebarSections.tsx` (new), `apps/web/src/ShellSidebar.tsx`, `apps/web/src/App.tsx` (props only) |
| T06 | Visual design and motion | T05 | `apps/web/src/sidebar-context.css`, `apps/web/src/sidebar-thread-move.ts` (cross-list landing + section FLIP), `tests/reduced-motion-coverage.test.ts` |
| T07 | Browser fixture and spec | T05 | `tests/e2e/sidebar-sections.{spec.ts,playwright.config.ts,vite.config.ts,fixture.tsx}` (new, modelled on `sidebar-shared-menu.*`) |
| T08 | Full verification, screenshots, recording, perf check | T06, T07 | evidence only |
| T09 | Front end team review (owner requirement) | T08 | PR + issue comments |

T02 and T04 can run in parallel after T01; T06 and T07 in parallel after T05.

### T01 Discovery, flag, contracts
- Steps: answer X1–X7 in the first checkpoint. Add `"ui.sidebarSectionsV1"` to the M15 key array (or the array X2 names) and to `hostDefinitions` with description "User-defined sidebar sections and section membership for threads." Create the contracts file of DESIGN §1; add `sectionId` to `Thread.presentation`; add `sections` to `NavigationPage`.
- Tests: `pnpm typecheck`; capability flag tests still pass; a new test asserts the flag defaults false and `HARNESS_FLAG_UI_SIDEBAR_SECTIONS_V1=1` enables it.
- Done when: typecheck passes; flag registered; checkpoint lists X1–X7 answers. Handoff: T02, T04.

### T02 Host commands
- Steps: implement DESIGN §2 in the command switch beside `thread.presentation` (`service.ts:1321`).
- Negative cases: flag off → `CAPABILITY_DENIED` for every section command and for `sectionId`; empty/61-char/duplicate name → `INVALID_INPUT`; 51st section → `RESOURCE_LIMIT`; unknown section id in presentation, rename, move, delete → `INVALID_INPUT`/`NOT_FOUND` (use whichever code the service already uses for unknown entities); non-finite or out-of-bound order → `INVALID_INPUT`.
- Done when: T03 tests pass.

### T03 Read model and host tests
- Steps: DESIGN §3. Tests in `tests/sidebar-sections-host.test.ts`: create/rename/move/delete/restore round trips; delete releases exactly the member threads in one transaction (assert no partial state by injecting a failure after the first thread write); membership and order survive closing and reopening the store; projection drops stale `sectionId`; flag off omits `sections` and `sectionId`; archive keeps `sectionId` (X5).
- Done when: tests pass with `pnpm exec vitest run tests/sidebar-sections-host.test.ts tests/shell-read-models.test.ts --maxWorkers=1`.

### T04 Placement, drop and keyboard logic
- Steps: DESIGN §4; register `thread-move-section` (`Alt+Shift+ArrowUp`, `Alt+Shift+ArrowDown`, scope Sidebar, handler `sidebar-reorder.ts`) and `section-move-up`/`section-move-down` (Alt+ArrowUp/Down, scope Sidebar section header, handler `SidebarSections.tsx`) and `section-rename` (F2).
- Tests (extend `tests/sidebar-reorder.test.ts`): precedence table for R04 including sectioned+pinned, +working, +settled, stale id; `dropPatch` for section/flat/pinned/working/settled targets; `moveToSection` order and edge (first/last); `orderFor` inside sections; keyboard-bindings test sees new ids without chord conflicts in scope Sidebar.
- Done when: tests pass.

### T05 Sidebar UI
- Steps: DESIGN §5 and R06–R13, R16–R17. Use `ActionMenu`, `Modal`, `toast` only (UI guard).
- Tests: covered by T07; unit-test `useSidebarSections` grouping/sorting.
- Done when: `pnpm typecheck`, `pnpm lint:ui`, `pnpm test:ui-guard` pass and flows 1–6 work in the fixture.

### T06 Visual design and motion
- Steps: DESIGN §7 exactly, with existing tokens; no new colors except `color-mix` of existing tokens.
- Tests: reduced-motion coverage updated; light and dark screenshots of: sections expanded with counts, header hover with menu button, inline field with error, empty section hint during drag, drop target highlight, delete dialog.
- Done when: screenshots attached to the checkpoint and reduced/off modes show no transforms.

### T07 Browser spec
- Steps: new fixture copying the `sidebar-shared-menu` setup (own port; do not reuse 5502/5504) with flag on and 3 projects × 8 threads.
- Scenarios: flows 1–6 (UX flows); spring-load expand; drop invalid on Working/Settled; search lock hides empty sections and disables drag; flag-off fixture shows no section UI; keyboard-only path (create, move, rename, delete) with focus assertions; IME composition does not commit; touch long-press drag into a section; reduced motion and off.
- Done when: `pnpm exec playwright test --config tests/e2e/sidebar-sections.playwright.config.ts` passes.

### T08 Full verification
- Run the VALIDATION commands; record results, screenshots and one recording of flows 1–5; R18 timing from a 50 × 2,000 fixture via `performance.now()`.
- Done when: every acceptance row has evidence in a checkpoint.

### T09 Front end team review (owner requirement)
- After T01–T08 are VERIFIED and the PR is ready for review, post a HANDOFF checkpoint on this issue addressed to Leonardo's front end team with the PR link, commit SHA, the T06 screenshots, the T08 recording and DESIGN §7; request their review of the visual design and motion. Apply requested changes (bump this plan's revision if they change decisions).
- Done when: the front end team review is recorded on the PR/issue and its requested changes are resolved.

## VALIDATION

**Setup.** Node ≥ 24.10.0, pnpm 10.30.3 (`package.json:6–8`), `pnpm install`; Chrome for Playwright as in `CONTRIBUTING.md`.

**Commands (planned; none executed while planning).**

```sh
pnpm typecheck
pnpm lint
pnpm lint:ui
pnpm test:ui-guard
pnpm exec vitest run tests/sidebar-sections-host.test.ts tests/shell-read-models.test.ts tests/sidebar-reorder.test.ts tests/sidebar-project-order.test.ts tests/keyboard-bindings.test.ts tests/reduced-motion-coverage.test.ts --maxWorkers=1
pnpm exec playwright test --config tests/e2e/sidebar-sections.playwright.config.ts
pnpm exec playwright test --config tests/e2e/sidebar-shared-menu.playwright.config.ts
pnpm exec playwright test --config tests/e2e/sidebar-collapse.playwright.config.ts
pnpm exec playwright test --config tests/e2e/thread-move.playwright.config.ts
pnpm test --maxWorkers=1
```

**Acceptance matrix.**

| Req | Task(s) | Check |
|---|---|---|
| R01 | T02, T03 | name/limit/order validation unit |
| R02 | T03 | sections listed for threads of different projects (unit) |
| R03 | T02, T03 | `sectionId` set only by command; new thread has none (unit) |
| R04 | T04, T07 | precedence table unit; pin/unpin returns to section (browser) |
| R05 | T04, T05, T07 | order inside section independent of `projectOrder` (unit + browser) |
| R06 | T05, T07 | create via button and row menu, Enter/blur/Escape, errors (browser) |
| R07 | T05, T07 | rename via menu and F2 (browser) |
| R08 | T04, T07 | move up/down menu + Alt+Arrow on header (browser) |
| R09 | T05, T07 | collapse persists across reload (browser) |
| R10 | T02, T03, T07 | delete releases members atomically (unit); confirm/undo (browser) |
| R11 | T04, T07 | drag in/out/between, spring-load, invalid targets (browser) |
| R12 | T04, T05, T07 | menu move, Alt+Shift+Arrow, announcement (browser) |
| R13 | T05, T07 | empty hint; locked hides empties and disables drag (browser) |
| R14 | T03 | archive keeps, stale id dropped (unit) |
| R15 | T01, T02, T03, T07 | flag-off unit + browser |
| R16 | T05, T07 | roles/labels, keyboard-only flow, IME (browser) |
| R17 | T05, T07 | mocked failures keep state + toast (browser) |
| R18 | T08 | 50 × 2,000 render timing |
| Visual §7 | T06, T09 | screenshots, reduced-motion test, front end team review |

**Regressions.** Existing sidebar unit and browser suites unchanged with the flag off and on; keyboard reference lists new bindings; UI guard has no new legacy entries.

**Evidence.** Command output in issue checkpoints; screenshots and one recording attached; planned vs executed tests kept separate.

**Release gate.** All rows pass in CI; front end team review (T09) resolved; flag stays default false until the owner enables it.

## STATE

| Item | State |
|---|---|
| Research and design | DONE (this plan r1) |
| Implementation T01–T09 | NOT_STARTED; no owner, no branch |
| Verification | NOT_RUN |
| Risks | Cross-list row motion is new code (FLIP does not cover remounts); paging (X1) could split a section's members across pages; nested menu support (X4) |
| Next step | Implementing agent claims this issue per AGENTS.md and starts T01 |

## REFERENCES

- Feature requests: https://github.com/openai/codex/issues/30986, https://github.com/openai/codex/issues/28692, https://github.com/openai/codex/issues/28213 (all open on 2026-11-21).
- Related Gen-V1 issues: #1139, #1182, #1187.
- Repository files at baseline `e883ac0327c834120d89c3697dec7380a342ba4d`: see REPO_MAP.
- Repo rules: `AGENTS.md` (plan publication, checkpoints, release), `CONTRIBUTING.md`, `docs/motion-refinement.md` (motion principles: no idle loops, reduced motion removes travel).
