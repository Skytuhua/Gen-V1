# Plan: Show in File Explorer and Open with default app from project Files

> **Design ownership (batch 8).** No separate front end team designs this feature. This plan specifies the visual design and the animation itself (section VISUAL_DESIGN_AND_MOTION), and implementers build exactly that. **When implementation is finished, the implementing agent sends the finished work to the front end team for review** (task T07). This issue stays open until that review is recorded on it.

## META

| Field | Value |
|---|---|
| Feature | Right-click (or keyboard context menu on) a file or folder in project Files, or use the file actions menu on an open file, to **Show in File Explorer** or **Open with default app** |
| Size | small (labels `feature`, `small`); one issue, no sub-issues |
| Repo | skytuhua-org/Gen-V1 |
| Canonical issue | this issue |
| Plan file | `docs/agent-plans/reveal-open-project-files.md` (identical to this body below the file link; SHA-pinned link at the top of the issue) |
| Plan revision | r1, 2026-11-21 |
| Baseline | `main` @ `8fa907f378127bcfc23d71b55c53625ffc43e8da` (verified by clone on 2026-11-21) |
| Existing work | None for this feature. Searched issues for "reveal explorer" and "open with default app": no match. Related, distinct plans: [#1286](https://github.com/skytuhua-org/Gen-V1/issues/1286) "Open in Gen V1" in Windows File Explorer (the opposite direction: Explorer to Gen), [#1539](https://github.com/skytuhua-org/Gen-V1/issues/1539) clickable file references in replies (opens a file inside Gen's Files panel, not the OS), batch 6 "Copy file reference". |
| Implementation status | NOT_STARTED. Planning only; no code written |
| Source provenance | Feature proposal batch 8, item 5 ("Reveal in File Explorer and open with default app", small), filed directly under the maintainer's standing instruction (no approval step); static repository research at the baseline SHA (line numbers refer to it); public prior art in REFERENCES. Decisions marked **DECIDED** were made by the planner; the owner delegated every non-approval decision. |

## OBJECTIVE

**User problem.** Project Files in Gen shows the working copy, but a user who wants to act on a file outside Gen (open a PDF in its viewer, an image in an editor, a spreadsheet in Excel, or drag a file into another app) has no way to get there. They must copy the project root path from somewhere, open File Explorer by hand and walk the folders. The only existing OS hand-off is the Project context card's "Open in Default editor" row, which opens the **whole project root** in Explorer (`apps/server/workspace-routes.ts:152`, `open-editor`), never a chosen file. Codex and Claude Code users ask for exactly this ([openai/codex#62732](https://github.com/openai/codex/issues/62732), [openai/codex#56637](https://github.com/openai/codex/issues/56637), [anthropics/claude-code#111540](https://github.com/anthropics/claude-code/issues/111540), [anthropics/claude-code#105228](https://github.com/anthropics/claude-code/issues/105228)).

**Intended behavior.**
1. In the Gen desktop app, right-clicking a file or folder row in project Files opens a small menu with **Show in File Explorer** and **Open with default app**. Shift+F10 or the Menu key on a focused row opens the same menu.
2. The preview header of an open project file gets a **File actions** button (three dots) with the same two items.
3. Show in File Explorer opens a File Explorer window on the item's parent folder with the item selected.
4. Open with default app opens a file in the app Windows associates with it, or a folder in File Explorer.
5. Programs and scripts (R05 list) never get Open; the item shows disabled with the reason, and Show in File Explorer still works.
6. Only paths inside the thread's authorized project root (or its managed working copy) can be acted on. The path is resolved and checked by the host, never trusted from the renderer.
7. In the browser build (no desktop bridge), and for Granted Files, none of this appears and the browser's normal context menu is not suppressed.

**Measurable success.**
1. Unit: the host resolver accepts the R04 positive inputs and rejects every R04 negative input with `CAPABILITY_DENIED` (T01 tests).
2. Unit: the main-process handler calls `shell.showItemInFolder` / `shell.openPath` exactly once with the host-resolved absolute path, refuses Open for every R05 extension even if the host said otherwise, and is refused in plug-in windows (T03 tests).
3. Browser: in the Files fixture with a stub bridge, right-click, Shift+F10 and the Menu key open the menu; choosing an item calls the bridge once with `{projectId, threadId, path, action}`; Open is disabled for `run.ps1`; without a bridge no menu appears (T05).
4. Manual Windows check on an installed build: Explorer opens with the file selected; a `.pdf` opens in its default app; a `.bat` cannot be opened (T06).
5. No regression in the suites listed in VALIDATION, including `pnpm lint` (overlay inventory) and the UI guard.

## REQUIREMENTS

### In scope (each maps to tasks and acceptance rows)

- **R01 Entry points.** (a) Context menu on every row in the project Files list (`.files-list li > button`) for `kind` `file` and `directory`, opened by right-click (`contextmenu` event), Shift+F10 or the `ContextMenu` key. (b) A **File actions** icon button in the preview header of the selected project file (`FilesView.tsx` `files-preview header`), opening the same menu items. Tasks T04. Acceptance A01, A02.
- **R02 Show in File Explorer.** Calls Electron `shell.showItemInFolder(absolutePath)` with the host-resolved path. For a folder, Explorer opens its parent with the folder selected. Tasks T01–T04. Acceptance A03.
- **R03 Open with default app.** Calls Electron `shell.openPath(absolutePath)`. A non-empty returned string is a failure and is shown to the user (R08). For a folder, Explorer opens the folder. Tasks T01–T04. Acceptance A04.
- **R04 Path authority.** The renderer sends only `projectId`, optional `threadId`, the project-relative `path` already shown in Files, and `action`. The host resolves it exactly like `ProjectTools.file()` (`packages/workspace/tools.ts:204`): `binding(projectId, threadId)` gives the root; the relative path must pass the existing `pathName` schema (`tools.ts:26`: 1–1024 chars, no NUL, no `:`, no leading slash or backslash, no `..` segment); `realpath(join(root, path))` must be `inside(root, resolved)`; no `.git` segment in the relative input or the resolved relative path (`gitSegment`, `tools.ts:28`); the name `.harness-directory-guard` is rejected. The resolved real path is the one passed to the OS. Rejections throw `HarnessError('CAPABILITY_DENIED', 'Choose a file or folder inside this project.')`. Missing path: `HarnessError('NOT_FOUND', 'This file is no longer in the project. Refresh Files.')`. Positive: `README.md`, `docs/a b.pdf`, `src` (folder). Negative: `../x`, `/etc/passwd`, `C:\\Windows`, `a:b`, `.git/config`, `src/.git`, a symlink whose target is outside the root, an empty string. Tasks T01. Acceptance A05.
- **R05 Programs and scripts are Reveal only.** **DECIDED.** Open is refused for these extensions (case-insensitive, last extension of the resolved real name): `.exe .com .bat .cmd .ps1 .psm1 .psd1 .vbs .vbe .js .jse .wsf .wsh .msi .msp .msix .appx .appxbundle .scr .pif .lnk .url .reg .hta .cpl .jar .application .appref-ms .msc .scf .inf .sys .dll .sh`. The list lives in one shared function `desktopOpenBlocked(name)` in `packages/desktop-contract/index.ts`, used by the web (to disable the item) and by the main process (to refuse, defense in depth). `.js` is included because Windows Script Host runs `.js` by default. Files with no extension are allowed. Tasks T01, T03, T04. Acceptance A06.
- **R06 Surfaces.** Desktop only: the items appear only when `window.harnessDesktop?.projectPath` exists and the Files source is `project`. Allowed in desktop windows whose surface kind is `main` or `workspace` (the kinds that host project Files; confirm in T03 discovery); refused in `plugin` windows (the channel is not added to `pluginChannels`, `apps/desktop/window-policy.ts:31`) and any other kind. Granted Files and the browser build never show it. Tasks T03, T04. Acceptance A07.
- **R07 No HTTP route.** **DECIDED.** The OS launch is reachable only through the trusted desktop IPC and the launch-token parent IPC (`apps/server/desktop-controls.ts`, whose header says "No HTTP bypass"). No new `/api` route and no new `/actions` type, so a browser tab on the loopback port cannot launch programs. Tasks T02, T03. Acceptance A05, A07.
- **R08 Feedback.** Success: no toast (Explorer or the app appearing is the feedback). Failure: one `toast(message, { tone: 'error' })` (`packages/ui-shell/Toast.tsx`) with a plain sentence: host errors pass their message; `openPath` failure shows `Windows could not open this file. <reason>` (reason trimmed to 200 chars); timeout shows `Gen could not reach the local host. Try again.`. While a request is in flight the same item cannot be triggered twice (ignore repeat selection for 1 request at a time per FilesView). Tasks T03, T04. Acceptance A08.
- **R09 Keyboard and accessibility.** The menu is `role="menu"` with `role="menuitem"` buttons, arrow key, Home/End and type-ahead navigation via the existing `useListNavigation` (`packages/ui-shell/list-navigation.ts`), Escape closes and returns focus to the row (or the File actions button). The disabled Open item keeps `aria-disabled` focusable semantics via the native `disabled` attribute as ActionMenu does, plus `title` with the reason. The row gets `aria-haspopup="menu"` only when the menu is available. Tasks T04. Acceptance A02, A09.
- **R10 Visual design and motion.** Exactly as VISUAL_DESIGN_AND_MOTION. Tasks T04, T06. Acceptance A10.
- **R11 Front end team review.** The implementing agent sends the finished work to the front end team for review and records it on this issue (T07). Acceptance A11.

### Out of scope (v1)

- macOS "Reveal in Finder" and Linux file managers (Gen ships Windows x64; the code uses Electron `shell`, which is cross-platform, but no other platform is verified).
- "Open with…" app chooser, "Copy path", "Open in terminal", "Open in VS Code" (batch 6 "Copy file reference" covers copying).
- Granted Files, chat attachments, diff panels, Project Search results and file references in replies (#1539 may reuse the bridge later).
- Running programs or scripts. Changing the existing `open-editor` project action.
- A Settings toggle (the action only runs on an explicit user click on a path already shown).

### Decisions

- **D1 DECIDED:** host-resolved paths over renderer-supplied absolute paths (R04): the renderer never learns or sends the absolute root.
- **D2 DECIDED:** route through desktop main IPC plus the launch-token parent IPC, not the HTTP actions route (R07).
- **D3 DECIDED:** Electron `shell.showItemInFolder` and `shell.openPath` instead of spawning `explorer.exe` (as `open-editor` does): no argument quoting, and `openPath` returns an error string.
- **D4 DECIDED:** Reveal-only list for programs and scripts (R05) instead of a confirmation dialog: smallest safe v1. A later revision may add a confirm for scripts if users ask.
- **D5 DECIDED:** a small context-menu component built on the shared `Popover` primitive and the `ui-control-popup` styles, not a new overlay system, so the overlay policy (`scripts/ui-overlay-legacy.json`) gains no entry.

## REPO_MAP (verified at baseline unless marked DISCOVERY)

| Location | What is there | Change |
|---|---|---|
| `apps/web/src/files/FilesView.tsx` | Presentational Files surface for `source: "project" \| "granted"`. Rows are `<button>`s in `.files-list ul li`; directories call `directory(entry.path)`, files call `onSelect` + `openPreview()`. Preview `<header>` shows the name and an optional Download link. | T04: optional `fileActions` prop; row `onContextMenu`/`onKeyDown`; header button; renders `FileContextMenu`. |
| `apps/web/src/files/ProjectFiles.tsx` | Owns `path`, `selected`; reads `GET {base}/files` and `GET {base}/file`; `owner = {projectId, threadId}` from `base` and `query`. Renders `FilesView source="project"`. | T04: builds `fileActions` from `window.harnessDesktop?.projectPath` and `owner`. |
| `apps/web/src/files/GrantedFiles.tsx` | Granted Files, `source="granted"`. | Not changed. |
| `apps/web/src/files/files.css` | Files styles; rows `min-height:36px`, hover `var(--hover)`, selected `var(--accent-bg)` + inset `var(--accent-fg)` (`:305`). | T04: `[data-menu-open]` row style and header button. |
| `packages/ui-shell/Popover.tsx` | Shared anchored popover: `anchor`, optional `getAnchorRect`, `contentRef`, `open`, `width`, `height`, `preferredSide`, `onDismiss`, `onReady`; handles exit animation. | Reused, not changed. |
| `packages/ui-shell/ActionMenu.tsx` | Button-triggered menu on `Popover` with `role="menu"`, `ui-control-popup`, `ui-control-option`, `useListNavigation`. | Reused for the header button (T04). Not changed. |
| `packages/ui-shell/tokens.css` | Motion tokens `--ui-motion-popup-enter: 180ms`, `--ui-motion-popup-exit: 140ms`, `--ui-ease-enter`; popover enter animation `:63`; reduced-motion rules. | Reused. |
| `packages/ui-shell/Toast.tsx` | `toast(message, {tone: 'info' \| 'success' \| 'error'})`. | Reused. |
| `packages/desktop-contract/index.ts` | `DesktopBridge` interface (`:25`), `DESKTOP_CHANNELS` (`:51`). | T03: `projectPath` channel and bridge method; T01: `desktopOpenBlocked`. |
| `apps/desktop/preload.ts` | Builds the bridge from `ipcRenderer.invoke`. | T03: `projectPath`. |
| `apps/desktop/main.ts` | `registerIpc()` with `handle(channel, action)` that runs `authorize(event)` and the plug-in guards; `backendRequest(type, extra)` (`:202` in the file) over the launch-token parent IPC with a 15 s timeout; imports `shell`. | T03: new handler, new backendRequest type. |
| `apps/desktop/window-policy.ts:31` | `pluginChannels` allowlist. | Not changed (the new channel must stay out). |
| `apps/server/desktop-controls.ts` | `handleDesktopControl(value, token, host, send)`: token-checked private IPC; one branch per `harness.*` type. | T02: `harness.project.path` branch. |
| `apps/server/main.ts:39`, `apps/server/host.ts:27,121` | Calls `handleDesktopControl` with the running host; `RunningHost` declares optional control methods (`attentionRead` etc.). | T02: `projectPath` host method. |
| `apps/server/workspace-host.ts:8`, `apps/server/hermes-service.ts:24` | `WorkspaceHost.projects: ProjectTools` instance. | T02 reads it (DISCOVERY: confirm how `host.ts` reaches the `ProjectTools` instance). |
| `packages/workspace/tools.ts` | `pathName` (`:26`), `gitSegment` (`:28`), `ProjectTools.binding`, `files()` (`:200`, skips symlinks and `.harness-directory-guard`), `file()` (`:204`, realpath + `inside` check). | T01: `desktopPath()` method. |
| `apps/server/workspace-routes.ts:152` | `open-editor` spawns `explorer.exe <root>` on Windows. | Not changed. |
| `tests/desktop-preload-accounts.test.ts` | Pattern for mocking `electron` and testing the preload bridge. | T03 copies the pattern. |
| `tests/e2e/files-reading.spec.ts`, `files-reading-fixture.tsx`, `files-reading.playwright.config.ts` | Files browser tests with a fixture. | T05 adds tests. |
| `scripts/lint-ui.ts`, `scripts/ui-overlay-legacy.json`, `tests/ui-guard.test.ts` | Overlay policy and UI guard. | Must pass unchanged. |
| Electron | `electron` 45.2.0 (`package.json:75`). `shell.showItemInFolder(fullPath)` returns void; `shell.openPath(path)` resolves to `''` on success or an error message. | Used by T03. |

## DESIGN

### Contract

```ts
// packages/desktop-contract/index.ts
export type DesktopProjectPathAction = 'reveal' | 'open';
export interface DesktopProjectPathRequest { projectId: string; threadId?: string; path: string; action: DesktopProjectPathAction }
export interface DesktopProjectPathResult { action: DesktopProjectPathAction }
// DesktopBridge gains:
projectPath?(request: DesktopProjectPathRequest): Promise<DesktopProjectPathResult>;
// DESKTOP_CHANNELS gains:
projectPath: 'harness-desktop:project-path'
export function desktopOpenBlocked(name: string): boolean; // R05 list, last extension, case-insensitive
export function parseDesktopProjectPathRequest(value: unknown): DesktopProjectPathRequest; // strict: exactly these keys; ids are non-empty strings up to 200 chars; path string 1..1024; action enum
```

Host method (T01):

```ts
// packages/workspace/tools.ts, class ProjectTools
async desktopPath(projectId: string, threadId: string | undefined, relativePath: string):
  Promise<{ path: string; kind: 'file' | 'directory'; openable: boolean }>
```

Parent IPC message (T02), same token custody as the other branches:
- request `{type:'harness.project.path', token, requestId, projectId, threadId|null, path, action}` (7 keys exactly)
- reply `{type:'harness.project.path.result', token, requestId, path, kind, openable}` or `{..., error}` where `error` is the HarnessError message (max 500 chars), never a stack.

### Control flow

1. User picks an item. `FilesView` calls `fileActions.run(entry, action)`.
2. `ProjectFiles` calls `window.harnessDesktop.projectPath({projectId, threadId?, path: entry.path, action})`.
3. Preload invokes `channels.projectPath`.
4. Main `handle(channels.projectPath, ...)`: `authorize(event)` (existing); refuse unless `record.surface.kind` is `main` or `workspace`; `parseDesktopProjectPathRequest(value)`; `backendRequest('harness.project.path', {projectId, threadId: threadId ?? null, path, action})`.
5. Server branch validates keys and types, calls `host.projectPath(projectId, threadId, path)`, which calls `projects.desktopPath(...)`.
6. Main checks the reply: `path` is a string, `isAbsolute(path)`, `kind` in the enum. For `reveal`: `shell.showItemInFolder(path)`. For `open`: refuse with `Open is turned off for programs and scripts.` if `!openable || (kind === 'file' && desktopOpenBlocked(basename(path)))`; else `const error = await shell.openPath(path)`; non-empty `error` throws `Windows could not open this file. ${error.slice(0,200)}`.
7. Returns `{action}`. The renderer shows nothing on success and an error toast on rejection (R08).

### Error handling and security

- The renderer cannot name an absolute path; the host decides the root from the thread binding, as for every Files read.
- TOCTOU: the resolved path is checked and then launched within one request; a swap between check and launch could only point at another path the user could already see in the root, because `realpath` is passed, not the input. Accepted risk for v1, recorded here.
- `backendRequest` keeps its 15 s timeout; its message maps to the R08 timeout text in the renderer when the error text starts with `The local backend`.
- No new logs contain the absolute path.

## VISUAL_DESIGN_AND_MOTION

All values use existing tokens and classes; no new colours.

1. **Row context menu (`.files-context-menu`).** A `Popover` with `className="ui-control-popup files-context-menu"`, `role="menu"`, `aria-label` = `Actions for <display name>`, `width={248}`, `height={2*36+26}`, `preferredSide="below"`, `align="start"`. Right-click anchors at the pointer through `getAnchorRect` returning a 0×0 rect at `clientX/clientY`; keyboard opens anchor to the row's bottom-left (`getAnchorRect` omitted, `anchor` = row button). Items use `ui-control-option` exactly like ActionMenu (same height, padding, focus ring and hover).
2. **Items.** Order: `Show in File Explorer` (lucide `FolderSearch`, size 14, `aria-hidden`) then `Open with default app` (lucide `ExternalLink`, size 14). DISCOVERY in T04: confirm both icons exist in the installed `lucide-react`; fall back to `FolderOpen` and `SquareArrowOutUpRight`. For a folder, the second label is `Open folder` with `FolderOpen`. Disabled Open: native `disabled`, the standard disabled option style, `title="Open is turned off for programs and scripts. Use Show in File Explorer."`. No shortcut hints.
3. **Row state while open.** The row gets `data-menu-open="true"` styled `background: var(--hover)` (same as hover) so the user sees which row the menu belongs to; selected rows keep their accent style.
4. **Header button.** In `.files-preview header`, after the Download link: `ActionMenu iconOnly label="File actions" icon={<MoreHorizontal size={15} aria-hidden="true"/>}` (pattern from `SavedLayoutChooser.tsx:47`), aligned right, 28×28 hit area via the existing `ui-action-trigger` style.
5. **Motion.** Opening uses the Popover's existing enter animation (`ui-popover-in var(--ui-motion-popup-enter) var(--ui-ease-enter)`, 180 ms); closing uses its exit (`--ui-motion-popup-exit`, 140 ms). Reduced-motion and motion-off use the existing token overrides; no new keyframes. Nothing animates on success.
6. **Light, dark, high contrast and 390 px.** Only shared tokens, so both themes work. At 390 px the Popover's collision handling keeps the menu inside the viewport; verify in T06.

## EXECUTION_DAG

| ID | Depends on | Owner boundary |
|---|---|---|
| T01 | none | `packages/workspace/tools.ts`, `packages/desktop-contract/index.ts` (only `desktopOpenBlocked`, types and parser), new `tests/project-desktop-path.test.ts` |
| T02 | T01 | `apps/server/desktop-controls.ts`, `apps/server/host.ts`, `apps/server/main.ts` (if needed), new `tests/desktop-controls-project-path.test.ts` |
| T03 | T01 | `packages/desktop-contract/index.ts` (channel + bridge), `apps/desktop/preload.ts`, `apps/desktop/main.ts`, new `tests/desktop-project-path.test.ts` |
| T04 | T01, T03 (contract only) | `apps/web/src/files/*` |
| T05 | T04 | `tests/e2e/files-reading*` |
| T06 | T02–T05 | Windows manual check + screenshots |
| T07 | T06 | front end team review handoff |

### T01 — Host resolver and shared Open rule
- **Goal:** `ProjectTools.desktopPath()` per R04 and `desktopOpenBlocked()` per R05.
- **Steps:** (1) In `tools.ts` add the method: `const {path: root} = await this.binding(projectId, threadId)`; `const relativePath = pathName.parse(input)` (map Zod errors to `CAPABILITY_DENIED` with the R04 message); reject if any segment is `.harness-directory-guard` or `gitSegment(relativePath)`; `const target = join(root, relativePath)`; `realpath(target)` (ENOENT → `NOT_FOUND`); `if (!inside(root, resolved) || gitSegment(relative(root, resolved))) throw CAPABILITY_DENIED`; `const info = await stat(resolved)`; return `{path: resolved, kind: info.isDirectory() ? 'directory' : 'file', openable: info.isDirectory() || !desktopOpenBlocked(basename(resolved))}`. Wrap the filesystem calls with the same `withPathGuard` call shape `file()` uses (`leaf: true, readOnly: true`). (2) In `desktop-contract/index.ts` add `desktopOpenBlocked` and the types/parser from DESIGN.
- **Tests:** positive and negative R04 inputs on a temp project; symlink to outside root rejected; symlink inside root resolves to the real path; every R05 extension blocked in upper and lower case; `report.pdf`, `Makefile`, `a.tar.gz` allowed.
- **Done when:** `pnpm exec vitest run tests/project-desktop-path.test.ts` passes. **Handoff:** T02, T03.

### T02 — Parent IPC branch
- **Goal:** `harness.project.path` per DESIGN.
- **Steps:** add `projectPath?(projectId, threadId, path)` to `DesktopHostControls` and `RunningHost`; implement in `host.ts` with the `ProjectTools` instance (DISCOVERY: follow how `host.ts` builds or receives `projects`); add the branch in `handleDesktopControl` with an exact 7-key check, id checks matching the existing branches, `threadId` `null` or id, `action` enum, then send the result or `{error: message}` (HarnessError message only).
- **Tests:** wrong token, extra key, bad action and missing host method each reply `error` or return false like existing branches; a valid request replies with the path.
- **Done when:** the new test file passes. **Handoff:** T03.

### T03 — Desktop bridge and main handler
- **Goal:** bridge method and main flow steps 3–6.
- **Steps:** add channel and bridge method (contract); preload `projectPath: request => ipcRenderer.invoke(channels.projectPath, parseDesktopProjectPathRequest(request))`; main: extend the `backendRequest` type union with `'harness.project.path'` (reply type `+'.result'` already works), add `handle(channels.projectPath, ...)` per DESIGN step 4 and 6. DISCOVERY: list the surface kinds that render project Files (`main`, `workspace`, maybe `thread`); allow exactly those and record the list on the issue.
- **Tests:** mock `electron` as in `tests/desktop-preload-accounts.test.ts`; preload forwards only the parsed request; `pluginDesktopChannelAllowed(DESKTOP_CHANNELS.projectPath)` is false; main-handler logic extracted to a pure function `runProjectPath({request, resolve, shell})` in a new `apps/desktop/project-path.ts` so it is unit-testable: reveal calls `showItemInFolder` once; open calls `openPath` once; open of `x.ps1` refused without calling `openPath` even when `openable: true`; non-absolute host path refused; `openPath` error string becomes the R08 message.
- **Done when:** tests pass and `pnpm typecheck` (`tsc --noEmit`) passes. **Handoff:** T04.

### T04 — Files UI
- **Goal:** R01, R06, R08, R09, VISUAL_DESIGN_AND_MOTION.
- **Steps:** (1) New `apps/web/src/files/FileContextMenu.tsx` (Popover + `useListNavigation` + `ui-control-option` buttons) exporting `FileContextMenu({anchor, point, entry, items, open, onClose})`. (2) `FilesView` prop `fileActions?: {run(entry, action): Promise<void>}`; when present and `source === 'project'`, rows get `onContextMenu` (preventDefault, open at pointer), `onKeyDown` for `ContextMenu` and Shift+F10, `aria-haspopup="menu"`, `data-menu-open`; header gets the ActionMenu for `selected`. Without `fileActions`, nothing changes (no preventDefault). (3) `ProjectFiles` passes `fileActions` only when `window.harnessDesktop?.projectPath` exists; `run` sets a single in-flight guard and shows R08 toasts. (4) CSS per VISUAL_DESIGN_AND_MOTION.
- **Tests:** T05. **Done when:** `pnpm lint` and `pnpm test:ui-guard` pass. **Handoff:** T05.

### T05 — Browser tests
- **Goal:** cover R01, R05, R06, R08, R09 in `files-reading.spec.ts`.
- **Steps:** fixture option to install a stub `window.harnessDesktop.projectPath` that records calls and can reject; tests: right-click a file shows both items; Shift+F10 and the Menu key open it; Escape returns focus to the row; choosing Show sends `{action:'reveal'}` with the exact relative path and owner; Open disabled for `run.ps1` with the title text; folder shows `Open folder`; stub rejection shows one error toast; header File actions works; no bridge: right-click shows no menu and `defaultPrevented` is false; granted source shows no menu.
- **Done when:** the files-reading Playwright config passes (DISCOVERY: exact command, e.g. `pnpm exec playwright test -c tests/e2e/files-reading.playwright.config.ts`). **Handoff:** T06.

### T06 — Windows check and screenshots
- **Goal:** A04 and A10 evidence on an installed Windows build.
- **Steps:** in a real project: reveal a nested file, reveal a folder, open a `.pdf`/`.png`, try `.bat`, rename the file outside Gen and try again (NOT_FOUND toast); screenshots of the menu in light and dark at 1280 px and 390 px, and with reduced motion.
- **Done when:** screenshots and a short result table are posted on this issue. **Handoff:** T07.

### T07 — Front end team review
- **Goal:** R11. Send the finished work (PR link, screenshots, T06 table) to the front end team for review; post the request and the review outcome on this issue; apply requested changes or open follow-ups.
- **Done when:** the review is recorded on this issue.

## VALIDATION

Planned (none executed; planning only):

| Level | Command | Covers |
|---|---|---|
| Unit | `pnpm exec vitest run tests/project-desktop-path.test.ts tests/desktop-controls-project-path.test.ts tests/desktop-project-path.test.ts` | R04, R05, R06, R07, R08 |
| Regression unit | `pnpm exec vitest run tests/desktop-preload-accounts.test.ts tests/desktop-native.test.ts tests/public-source.test.ts` | bridge, main, manifest |
| UI policy | `pnpm lint`, `pnpm test:ui-guard` | overlay inventory unchanged |
| Browser | files-reading Playwright config (T05) | R01, R06, R08, R09 |
| Manual | T06 on Windows | R02, R03, R10 |

### Acceptance matrix

| ID | Criterion | Evidence / task |
|---|---|---|
| A01 | Right-click, Shift+F10 and Menu key open the row menu on files and folders | T05 |
| A02 | Header File actions opens the same items; Escape restores focus | T05 |
| A03 | Show in File Explorer selects the item in Explorer | T03 unit, T06 |
| A04 | Open launches the default app; `openPath` errors show the R08 toast | T03 unit, T06 |
| A05 | R04 negatives rejected by the host; no HTTP route added | T01, T02 |
| A06 | R05 extensions never opened (web disabled + main refusal) | T01, T03, T05 |
| A07 | Hidden in browser build and Granted Files; refused in plug-in windows | T03, T05 |
| A08 | One error toast per failure; no success toast; no double run | T05 |
| A09 | Menu keyboard navigation and roles | T05 |
| A10 | Visual design and motion as specified, light/dark/390 px/reduced motion | T06 screenshots |
| A11 | Front end team review recorded | T07 |

**Release gate:** A01–A11 met, CI green, front end review recorded.

## STATE

- Researched and decided: everything above. Implemented: nothing. Verified: nothing.
- Owners and branches: none. Next step: T01 by any implementing agent after claiming this issue per AGENTS.md.
- Risks: surface kinds that render Files (T03 discovery); `lucide-react` icon names (T04 discovery); Windows `openPath` error text varies by app association.

## REFERENCES

- [openai/codex#62732](https://github.com/openai/codex/issues/62732), [openai/codex#56637](https://github.com/openai/codex/issues/56637) (Open in Finder request), [anthropics/claude-code#111540](https://github.com/anthropics/claude-code/issues/111540), [anthropics/claude-code#105228](https://github.com/anthropics/claude-code/issues/105228): users asking to reveal or open workspace files in the OS.
- Electron `shell` API: https://www.electronjs.org/docs/latest/api/shell (`showItemInFolder`, `openPath`).
- Related Gen plans: [#1286](https://github.com/skytuhua-org/Gen-V1/issues/1286), [#1539](https://github.com/skytuhua-org/Gen-V1/issues/1539).
