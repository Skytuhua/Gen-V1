# Gen V1 repair and desktop acceptance handoff

**Decision at handoff — keep the repair open.** The November 18 click-through found that detaching a secondary chat could clear the main chat, floating chats still exposed the full toolbar, saved layouts were still available, and the desktop app could stall before opening the workspace. Four cards already fit across the tested agent board. The remaining board change is how much of each card the transcript occupies.

**Goal.** Deliver all eighteen user-facing outcomes below and repair reproducible defects of the same kinds in the retained harness. Use this document as the execution specification. Start with the checkout and test data described below. Work through the numbered implementation tasks in order using `superpowers:executing-plans`. Finish a task by recording its observed result. A prior merged PR, screenshot or checked box does not establish a result on the delivery build.

**Architecture and tools.** React, TypeScript, Vite, Electron on Windows, Node, pnpm, SQLite, Vitest and Playwright. Use the existing split-layout command model, view IDs, composer controller, artifact journal, settings registry and provider adapters. Secondary chats are **in-app panes**. They float inside the workspace and dock into its split tree. There is one transcript, draft and Send/Stop owner per thread. Rich main chat and compact secondary chat are presentations of that same owner.

**Sources of evidence.** The last user-style audit exercised commit `7ac80d870ff7ff7dc021b0632ef07d631d489afc`. Its browser ran the production frontend against an actual HTTP service and SQLite with five synthetic threads. The host supplied the core service directly. Stock Electron startup failed twice. Upstream main fetched while preparing this plan was `89142de980df86c4236dc49c28f280d78fe79e0d`. The original working directory held separate work on `6b9d1b0b`. Start from freshly fetched main in an owned checkout. Reproduce before editing. A behavior already fixed on that checkout gets a passing regression and a receipt. Do not reimplement it.

## Design specification for the implementing agent

Read this section before T00. Apply the relevant example before implementing its T task. Measurements below are **CSS pixels at 100% zoom, default font and stated density**. Use scalable type and minimum row heights. At larger text or Touch density, reflow the controls and apply the pane fallback in T03. The sizes and layouts below are Gen V1 product decisions. Accessibility criteria are sourced separately.

### Shared design decisions

| Element | Implement this |
|---|---|
| Canvas and surfaces | Use the existing theme roles in `apps/web/src/styles.css`. Dark canvas `#000`, sidebar `#080808`, raised surface `#0f0f0f`, selection `#1f1f1f`. Light canvas/surface `#fff`, sidebar `#fafafa`, selection `#ededed`. Use a single 1 px divider at adjacent pane edges. Floats use the existing elevation and an opaque surface. Docked panes sit flush to their divider. |
| Type | Keep the user's font and text-size preferences. Default to the existing Inter/system stack. At the default size, use 14/21 px regular for working text, 14/20 medium for row titles, 16/24 semibold for section headings, and 12/16 for secondary metadata. Agent history starts at 14/21. Use tabular numerals for comparable counts. Keep the full name of an ellipsized thread accessible on focus and hover. Wrap instructions, error messages and settings descriptions. |
| Spacing and alignment | Use `packages/ui-shell/tokens.css`: 4 px icon-to-label gap for tight metadata, 8 px between related controls, 12 px panel inset, 16 px content inset, 24 px dialog content inset. Align headings, first text baselines and input edges within a section. Keep the main transcript, artifact and composer on the same left/right measure: 680 px Comfortable, 760 px Wide, available width Full. |
| Controls | Use the existing Lucide family and shared Button, ActionMenu, Popover, Select/Combobox and Modal primitives as applicable. Use 16 px toolbar icons, 6 px default control radius and the saved radius preference. Compact, Comfortable and Touch rows have 32/36/44 px minimum heights. The painted glyph can stay small inside its hit area. Put a visible action label on recovery and connection buttons. Give every icon button an accessible name and a focus-triggered tooltip. |
| Status and selection | Active navigation uses neutral selection fill. Keyboard focus adds a 2 px visible outline with 2 px clearance where space permits, including on an already-selected item. Use the existing fixed `--accent-fg/bg`, `--warning-fg/bg`, `--success-fg/bg` and `--danger-fg/bg` pairs per T14. Use a single status icon plus label for each fact. Reserve filled semantic backgrounds for the small status or alert that owns the meaning. |
| Interaction feedback | Keep hover, selected, focus, disabled and pending visually distinguishable. Press immediately acknowledges input without moving adjacent content. Use the project's hover (120 ms), popup (180/140 ms enter/exit), and panel (220/180 ms) tokens for their existing transitions. Typing, scrolling, keyboard navigation, held drag and resize track immediately. Restore/reload preserves the reader's position. Reduced motion removes travel and permits at most 80 ms opacity feedback. Off uses zero duration. |
| Layering | A float is nonmodal and leaves main chat and sidebar actionable. A docked split reserves space in normal layout. Settings alone in this flow uses modal focus containment and the existing scrim. Anchor menus to their triggering control, with 8 px gap/viewport clearance; flip, then clamp the list with internal scrolling. Escape closes the innermost menu first. Keep native caption buttons, the active composer and recovery actions reachable. |

### Reference layouts and exact composition

The diagrams name interface regions. Only the user-facing labels specified in the tasks belong in the product.

**Workspace and secondary chat — R01–R05, R07–R09, R15.** Open main A, detach it and select B. When A is floating, B gets the full main canvas. For a right drop, arrange the windows as below. For a left drop exchange A and B **inside the canvas**. For a bottom drop stack B above A and keep the sidebar unchanged. The independent tool drawer, when open, occupies its own region outside this pair.

```text
Thread list | B · Main conversation     | A · Secondary chat        [Move]
            |                           |                            ↑
selected B  | B history                 | A history, scrolls here    |
            |                           |                            ↓
            | B main composer           | [Message A…           ] [Send]
```

- Give A one persistent title and one six-dot grip at the trailing edge. In a docked chat use the active tab/title line as that header. A floating chat uses the same line inside the floating frame. Do not stack a tab, title bar and project header for the same thread. The named grip opens the placement menu with a single click. Keep secondary Send/Stop at the end of the entry row in the same location as its state changes.
- **Shallow-pane budget:** measure the outer slot including borders, tab/header and composer. At 158 px, compact density and a one-line draft, allocate 32 px header, 36 px full composer row, up to 10 px total for other vertical gaps/borders, and at least 80 px for the transcript viewport. The scroll area must contain actual readable lines. If a larger font/density or growing draft makes the minimum unattainable, use T03's focused-pane view and selector. Do not cover the last message with a fixed composer.
- Preserve the grab point during drag; align the preview boundary with the eventual divider. The prospective pane gets a 1 px neutral outline and a subtle neutral fill (8% foreground over the canvas). Draw the outline only during an eligible drag. When docked, replace it with the ordinary divider. Dragging a float around the center moves it without momentum. Adjacent panes remain selectable immediately after release.
- Keep ticks on the **leading** edge outside the text measure. Use the existing 1 px rail, 3 px thumb and 6 px tick cadence. Allocate a 24 px pointer strip at desktop density, kept clear of message links, code select/copy and the pane divider. Test one link near that edge, wheel/page navigation, thumb drag and a click on the track above/below the thumb. A screen with no scrolling omits the indicator. Desired rail (`../specs/gen-v1-harness-repair-reference/67e3e833-e01a-47da-be2e-6c19365ccf9f.png`) · Placement grip (`../specs/gen-v1-harness-repair-reference/049246bb-2079-4bb8-987b-f5a4256cdceb.png`)

**Right drawer — R05–R08, R12.** Fresh state uses the whole body for one vertically centered list with a maximum width of 320 px and 16 px side clearance. On short views where the list cannot fit, top-align it with 16 px inset and scroll the list. Each launcher row has one leading icon, left-aligned label and trailing shortcut. Show a capability reason alongside an unavailable item on focus/activation through its accessible description. Keep the list in T04 order. Open state uses a single compact header: opened tabs first, then the Add surface button. The body is the active surface. With many tabs, keep Add reachable, scroll the tab strip locally and bring the active tab into view. Use the global drawer toggle to dismiss/restore it. Keep the Windows window controls in the native caption region. Empty launcher (`../specs/gen-v1-harness-repair-reference/8824ccc7-e447-47c8-8895-010eca7e07f2.png`) · Tabs and add menu (`../specs/gen-v1-harness-repair-reference/e30fea8a-1635-4863-9124-0cebb37362f7.png`)

**Settings and provider connection — R10, R18.** Use a two-region dialog with independent rail and content scrolling. At 1440 × 900 target a 1280 × 820 px maximum dialog, centered, capped at viewport minus 32 px horizontally and 48 px vertically. Give desktop navigation 232 px, the header 48 px, and center the settings content in a column up to 848 px wide. The breadcrumb reads “Settings / [category]”. Consolidate repeated headings. Set the first group 24 px below the header, with 24 px between groups. Use one boundary around each group and fine dividers between rows. A row with a description starts at 56 px high, grows with text, and aligns its control at the trailing edge. Keep control widths within 224 px for selects. A long setting value remains readable when the control opens.

```text
Search settings         | Settings / Models & Accounts                        [Close]
General                 |
Appearance              | Providers
…                       | [ChatGPT · selected] | ChatGPT (Codex)
Models & Accounts       | [Claude            ] | Status        Signed out
                        |                      |               [Connect ChatGPT]
                        |                      | Runtime       [Show details]
```

- Keep Gen V1's canonical category names. “Providers” is the section in **Models & Accounts**; searching Providers, ChatGPT, Codex or Claude lands on the actual provider target. Place the status and primary connection action above runtime details. Use the same pattern for Claude. A connection error includes a short cause and one applicable recovery, for example “Claude Code wasn’t found” with “Show setup instructions” when the binary check establishes that cause.
- For a dialog narrower than 760 px show category navigation as its own view and detail with a named Back control. Within the content area stack a setting's label/description above its control below 480 px. A provider list/detail pair needs at least 640 px of **content width**; below that, select provider → detail → Back to providers. Returning retains the prior selection, scroll and focus. At 390 px only the current level occupies width. Scope and machine information appear only when the product can identify them.
- Default, waiting, confirmed and failed provider states must each have one visually primary next action: Connect, Cancel sign-in, Select model when the catalog confirms access, or Retry after a recoverable failure. If signed in but no model has been verified, show Check access as the primary action. During a pending operation retain the active provider's name and stable account facts. Keep the advanced command-copy route secondary and display the official account flow appropriate to the host. General reference (`../specs/gen-v1-harness-repair-reference/cd93383a-2dc4-4471-b592-1f76adde3677.png`) · Provider reference (`../specs/gen-v1-harness-repair-reference/fdebd0cd-abb4-402f-9b83-154276cfebe7.png`)

**All Agents — R11, R17.** The project group heading, filters and connection state belong above the grid, once each. Use a 12 px gutter. Measure T10's breakpoint on the grid's inner content box after any outer padding. At 1,150 px, four equal columns with three gutters leave **278.5 px per card**. Measure the border box, including the card's own padding. At the 1,080 px threshold they leave **261 px per card**. Card five starts the next row at the first column.

```text
[Thread title                  ↗]   title opens the full conversation
[✓ Completed]                       one compact status
 Latest messages …                  largest region, independent scroll
 …
[Message…                  Send]    one row at rest
```

Use one card outline and 8 px inner insets. Keep status next to the title when it fits, otherwise on one metadata line below it. Use the existing open-thread action in the title row with one focus stop for that action. Render a flat transcript within the card. Never frame the title, transcript and entry each as separate cards. At 420 px card height the actual history viewport is at least 280 px. The entire idle form, including Send and its padding, is 36 px at Comfortable density. At Touch density use a 44 px form and preserve the 2/3 history target at normal card height. An agent's last readable message, thread identity and source status should all be visible without hovering.

**Plans, topics and artifacts — R13, R14, R16, R17.** At 280 px pane width use 12 px outside insets and one content column. The plan summary reads completion count first, then agent count and revision. Reserve the trailing slot for its menu; secondary facts may wrap. A step header contains status icon, wrapping title and disclosure chevron. Step number and status sit below the title if they cannot share the line. In expanded detail order content as checks, assigned agents, then dependency/rejoin links. Agent cards display name and status first, with results and long receipt IDs inside disclosure. Cap cumulative nested visual indentation at 16 px in this narrow case. Put long results and identifiers in normal text flow. Code and tabular evidence can scroll locally. For a closed topic the bottom boundary follows the last visible row at the normal inset. Focus outlines contribute no layout height. T11 measures the following sibling's displacement; T12 protects authored evidence. Collapsed gap to reproduce (`../specs/gen-v1-harness-repair-reference/24163d74-1f6e-4baf-9fad-92346ad7ca5b.png`) · Dense plan to reproduce (`../specs/gen-v1-harness-repair-reference/b094769c-a86c-4d32-821c-b00f127f012d.png`)

### Keyboard, pointer and assistive technology acceptance

Use WCAG 2.2 Level AA as the accessibility target for changed renderer surfaces. The numerical layout budgets elsewhere in this plan are product requirements. Record findings by success criterion and control; a passing screenshot or automated scan alone cannot establish conformance. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

| User action | Required result |
|---|---|
| Place a chat without dragging | Click Move, click a destination, then verify the same result as the edge drop. Repeat using Enter, arrow keys and Escape with focus restored. The menu works for a mouse user who cannot hold a button while moving it. |
| Resize without holding a pointer | Keep the divider focusable, named for the controlled pane, with separator role, orientation, value, minimum and maximum. Arrow keys along its axis adjust the size. Expose “Size” within the existing Move menu for the secondary pane with Smaller/Larger actions for applicable axes. Reuse the same clamping as the drag and keyboard path. These commands add no persistent toolbar button. Verify both keyboard and single clicks reach a usable size. [WAI-ARIA splitter guidance](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) |
| Navigate an agent card | Tab follows title/open action → interactive message content → entry → Send/Stop. Static status and decorative icons do not add tab stops. An update in another card leaves focus and reading position in place. Announce a meaningful state change once. Avoid reading every streaming token as a live alert. |
| Open settings and return | Move focus inside the named dialog. Tab/Shift+Tab stay inside, inert background cannot activate, Escape closes an open popup before the dialog, closing returns focus to its opener. After a failed save, focus the actionable error or invalid field with its error associated. [WAI-ARIA modal guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) |
| Read or click at high zoom | Test 200% text resize, 320 CSS px viewport reflow and a keyboard pass with each sticky header/composer present. No clipped labels, obscured focused controls, or page-wide horizontal scrolling for ordinary text. Keep scrolling localized for genuinely two-dimensional data. Verify actual desktop zoom/DPI separately in T17. |
| Use reduced motion, forced colors or a coarse pointer | Verify visible selection, focus, disclosure chevrons and statuses in Windows forced colors. Pair status with text/icon. Keep minimum 24 × 24 px hit boxes for authored small buttons at desktop density and 44 × 44 for touch. Separate adjacent hit areas. For long narrow rails/dividers reserve a clear hit strip or use the equivalent adjacent menu action; never cover an interactive link with an invisible target. |

### Before a task earns a visual pass

Use this review sheet for T15–T17. Collect the reference-state screenshots below on the same build with synthetic data, hide the pointer for resting-state captures, and keep the pointer/focus indicator visible in gesture/keyboard captures. Use real-size crops for typography and actual client rectangles for measurements. A full-window thumbnail helps compare composition but cannot prove readability.

| Capture | Pass test |
|---|---|
| Main B with floating A, then docked A, 1440 × 900 dark | Count one header and grip in A. Read distinct last messages in both panes. Verify the composer edges align with each pane and B's title, draft and history stay together after A detaches again. |
| 158 px secondary slot, during resize and after release | Record outer slot, header, composer, transcript and divider bounds. At compact density the transcript is ≥80 px and the last visible line clears the composer. No stretched letters or input covered by the rail. |
| 1,150 px board and 390 px fallback | Record column bounds, form height and history/card height for each card in the first row. Four cards share top Y within 1 px at desktop; card five wraps. One column at 390 px. Use long titles, running and completed agents. |
| Blank drawer and Files tab with Add open | On clean open the launcher is the only body. With Files open, the tab, Add control and every reachable menu item fit. At 1280 × 600 scroll the launcher to its last item and activate it. |
| Settings at 1440 px and 390 px; provider waiting and failed | Confirm a single category heading, aligned row controls, readable status and one primary next action; reach the same exact provider through search and keyboard. Capture an error long enough to wrap. |
| Completed plan, failed child, collapsed nested topic in a 280 px pane | Include the next sibling below the collapsed topic. Require natural height, visible full status labels and reachable disclosure. Opening a long receipt must never push the chevron outside the viewport. |
| Light, dark, forced colors and keyboard focus | Check computed text contrast ≥4.5:1 for normal-sized text and meaningful nontext affordances ≥3:1 where required. Inspect focus on selected tabs, rail, field, grip and divider. Repeat with a custom accent. Log foreground, adjacent background and the measured ratio. |

For each row record `build SHA | application host | theme/density/zoom | test data | before image | after image | measured result | PASS/FAIL/BLOCKED`. Correct a failure at its owning component and repeat the same capture. An automated image diff may flag an unexpected change; inspect it before updating a baseline. Changed copy, lost reading space and displaced controls require explanation. A human visual review and live provider acceptance each have their own result in T17.

## What the user will test

The numbers in this table are the original reports. The T numbers later in the document identify engineering tasks. Keep both in the evidence ledger.

| Report | Required result in the actual application | Last observed result | Owner |
|---|---|---|---|
| R01 | Slim tick-marked chat scroll indicator. Wheel, drag and keyboard reach the oldest and newest message. It stays usable in a shallow pane. | Normal chat had 1 px rail, 3 px thumb, 20 px hit area. Stacked chat lost its scroll area. | T03, T04 |
| R02 | Detach A, select B in the left sidebar, then dock and detach A again. Main keeps B's title, history and draft. A keeps A's. | Initial detach/select worked. Repeat-detach emptied main and persisted that error. | T01, T02 |
| R03 | One six-dot placement grip. Drop at the left, right, top or bottom of the main chat to create a real vertical or horizontal split. | Four directions worked in separate browser runs. Float lacked visible dots and carried extra controls. | T02, T03 |
| R04 | Resizing a float reflows text and controls. Type, icons and line height retain their size. Small docked panes still show readable history and input. | Float bounds changed from 480 × 680 to 818 × 356. One 158 px stacked pane had zero transcript-frame height. | T02, T03 |
| R05 | Remove the saved-layout feature from the interface. Replace the old Panels menu with one panel-toggle icon. | Layouts still opened Save current layout. | T04 |
| R06 | Fresh drawer shows Open a surface. After a selection it shows opened tabs and a plus menu. Browser and Side chat are reachable from both entry points. | Fresh drawer started on Artifact with its picker. Both launcher lists omitted Browser and Side chat. | T04 |
| R07 | Remove the drawer-level X. The same global panel toggle hides and restores the drawer. | Passed on the tested browser path. | T04 |
| R08 | Remove Switch layout from chat chrome. Use the six-dot Move grip in main, float and docked placement controls. | Full floating toolbar and inconsistent grip remained. | T02, T04 |
| R09 | Show a restrained preview only during an eligible edge drag, aligned to the bounds the drop will create. | Edge drops worked. Verify preview fit, disappearance and absence of the persistent blue target. | T03 |
| R10 | Searchable, organized T3-style settings. Every enabled row changes its named feature and persists at its displayed scope. | Twelve categories, composer font search and Light theme exercised. Full effect inventory remains open. | T06, T07 |
| R11 | Four independent agent threads per row at desktop board width. History takes at least two-thirds of each normal card at rest. Fifth card wraps. | Four fit at 1,150 px of board width. A 420 px card had 195 px of history and a 78 px composer. | T10 |
| R12 | Remove dedicated Code Review, Research, Custom and Visuals workspaces from all entry points. Keep existing user data and shared capabilities. | Clean-profile toolbar passed. Restored profiles and installed contributions need proof. | T05 |
| R13 | Collapsing a topic shrinks its outer artifact and moves following content up. Reopening preserves prior edits. | One populated artifact shrank from 330 to 111 px. Original saved examples and nested variants remain open. | T11 |
| R14 | Remove the automatic trailing topic box. Avoid dropping authored evidence, editable fields or pending inputs. | Generation change present. Original saved Source/evidence example was unavailable. | T12 |
| R15 | Left sidebar expands on the first click and from the keyboard after collapsing, including in Electron. | Desktop-width browser passed. Original Windows case remains open. | T04, T17 |
| R16 | Plan status, checks, parallel branches, results and expansion fit both a normal pane and a 280–320 px pane. | Two-step plan passed at 465 px. Dense branch case remains open. | T13 |
| R17 | A consistent text, icon and color combination explains running, attention, completed and failed states in both themes. | Some cues worked. Light plan status lacked convincing distinction and full coverage. | T14 |
| R18 | Users can connect ChatGPT through Codex and Claude through Claude Code, recover a pending sign-in, and tell which account and model can be used. | Detail pages and two simulated provider cases worked. Native sign-in and subscription-backed inference remain open. | T08, T09, T17 |

## T00 — Reproduce and prepare the acceptance build

- [ ] Run the following from the existing repository in a fresh PowerShell. The worktree command is for the first execution. On resume, enter the previously recorded worktree and verify its recorded branch and HEAD. If the named destination is already occupied by someone else, append the first available positive integer to **both** the directory and branch names. Never reset the user's checkout or share its node_modules.

```powershell
git status --short --branch
git fetch origin main
git rev-parse origin/main
git worktree add -b repair/ui-acceptance-20261118 ../gen-v1-ui-acceptance-20261118 origin/main
Set-Location ../gen-v1-ui-acceptance-20261118
git rev-parse HEAD
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm build:credential-lease
pnpm build
pnpm desktop:build
```

- [ ] Stop the command sequence at its first failed prerequisite. Use the versions in package.json (at handoff Node ≥24.10.0 and pnpm 10.30.3). Put local receipts under `.harness-repair-evidence/ui-completion/<short-SHA>/`. Record HEAD, OS/build, Edge/Electron versions, viewport, CSS scale, theme, test data, exact command, exit code and elapsed time. Capture only synthetic content in shared screenshots.
- [ ] Create a test profile using the existing Store, repository, task fixtures and desktop verifier's temporary-profile pattern. Seed A–E with unique titles and unique visible last messages. Give A and B different unsent drafts. Give A a long paragraph, code, table, resource and enough messages to scroll. Create five same-project agent threads, then a separate 25+ thread fixture. Include completed, running, waiting, interrupted and failed work. Seed a nested artifact, a dense plan and a legacy workspace profile as specified below. Start new disposable profiles for independent four-direction runs. Use actual mouse/keyboard input through normal navigation. Supply synthetic runtime responses for sends and errors. Never start a second service against a user's active store.
- [ ] Maintain three local ledgers. In `requirements.md` use one row per R01–R18 and T00–T17. In `surfaces.md` give each retained surface and control an entry path, action, observed effect and test. In `consumers.md` list each caller of a changed shared owner and the sibling-path result. For each defect record initial SHA, reproduction steps, expected/actual, evidence path, owner, patch SHA, repeat steps and result. Use PASS, FAIL or BLOCKED per evidence layer. An unrun case stays OPEN.
- [ ] Rebuild and run `pnpm exec tsx scripts/verify-desktop.ts` with its own profile. Capture its output directory, startup.log, diagnostics.json, verification.json and failure screenshots. Compare the shipped window with the audit symptom “Opening your workspace.” If it opens, complete an actual cold restart on the same owned data and proceed. If startup stalls, perform the diagnosis below before accepting any native UI row.

### Native startup diagnosis and completion rule

1. Use the verifier's process tree, ports and data root. Record timestamps for process spawn, host bind, first HTTP response, ready response, renderer navigation and first usable sidebar. Record HTTP status and sanitized error class. Check the first step that did not finish. A 503 from a listening host and a refused connection require different investigations.
2. For spawn/exit or no bind, trace the child executable, working directory and packaged resource resolution in `apps/desktop/main.ts` and the server entry in `apps/server/main.ts`. For a listening but unready host, trace `apps/server/host.ts`, `apps/server/hermes-service.ts`, core Service recovery and Hermes library/client initialization. Record bounded start/end timing around database recovery, file-access/lease preparation, child handshake and initial skills listing. Never print tokens, environment dumps or account file contents. For ready HTTP with a stuck window, inspect Electron navigation, preload context and the first failing bootstrap request.
3. Recheck runtime prerequisites using the repository's credential-helper build and the pinned Hermes requirements. On this Windows setup, the prior prepared retry used `py -3.14 -m pip install --no-cache-dir --no-compile --target .harness-hermes-python-deps -r third-party/hermes-agent/runtime-requirements.txt`. Verify the tested host actually resolves its dependencies. This retry previously still timed out. Do not diagnose the cause from that timeout alone.
4. Write a regression at the **first demonstrated failing boundary**, exercise its failure/recovery contract, repair that owner, then rerun the unmodified stock readiness path twice from cold start. On a permanent startup failure show a concrete error and a retry that cleans up owned resources. On success open a real thread, reload and restart. Preserve credential lease and recovery ordering. Extending a timeout, bypassing Hermes, or returning “ready” before initialization finishes does not satisfy the gate.
5. If the failure depends on an unavailable machine prerequisite, record its exact missing dependency and evidence. Continue independent browser tasks. Leave native acceptance open until the normal production host and Electron pass. The old installed app and a fixture host are separate evidence layers.

## T01 — Fix which conversation detach removes from main

**Files.** Start with `apps/web/src/App.tsx` (`detachConversation`), `apps/web/src/conversation-placement.ts`, `apps/web/src/WorkspaceSplitLayout.tsx`, `tests/conversation-placement.test.ts` and `tests/split-app-browser.test.ts`.

- [ ] First reproduce the exact failure. Open A in main → detach A → click B in the sidebar → drag A to the right edge of B → use A's Move menu to detach A. Wait for the acknowledged park command. Assert B's last message and draft are visible in main, A's message is visible in the float and main selection still resolves to B after reload. Before the fix, B's tab survived but its body disappeared. Asserting the tab title alone would pass incorrectly.
- [ ] Before dispatch capture the workspace ID, layout revision, main pane ID, active main view ID, detached view ID and current main selection. Use the resolved occupant of **main** to determine whether the operation removes it. Focus, highlighted sidebar thread and most recently clicked tab are insufficient. For a detached active main occupant set selection to empty. For a secondary occupant preserve the exact current selection, including an existing empty/new-thread state.
- [ ] Use that same transition for optimistic presentation and acknowledgment. Persist through the existing placement record. Fence the result against a newer main selection, profile/workspace switch, stale revision or replacement view. Roll back only the failed operation's optimistic change. When acknowledgment is uncertain, reconcile using the existing command ID and current layout. Never retry as a second unconditional park. Reuse canonical layout/placement helpers and keep one mounting plane.
- [ ] On the planning revision the two writes are `PendingPlacementIntent.desiredMainSelection` and the acknowledged record's `mainSelection`. Both hard-code empty in `detachConversation`. Its success path then calls `focusedSplitThread(next)`, updates `setSelectedId` and removes `harness:selected-thread`. Fix all three effects together. On a secondary detach, keep the main owner's selected ID and its restoration state. On an actual main detach, clear its selection once. Reconcile the newest placement record before publishing an acknowledgment so a later user action keeps priority.
- [ ] Repeat with keyboard placement, B streaming, B holding an unsent draft, A returned to main, A already parked, server rejection, delayed acknowledgment after selecting C and restart. Assert actual transcript owners, unique active composers, retained scroll and draft, current selection and persisted layout. A later choice of C wins. Persisted pre-fix layouts with an intentionally empty main must still open empty.

## T02 — Give secondary conversations the compact interface

**Files.** `WorkspaceHost.tsx`, `WorkspaceSplitLayout.tsx`, `conversation-workspace/ConversationPane.tsx`, `ScopedConversationComposer.tsx`, `ComposerView.tsx`, their existing CSS and full-App split tests under `apps/web/src` and `tests`.

- [ ] Extend the existing conversation presentation prop with an explicit secondary mode. Select it for the floating and docked secondary view. Keep the ordinary main presentation on main. Render one header with thread title and one visible six-dot button named “Move chat”. The secondary body contains the existing rich history and a compact multiline entry with inline Send, replaced by Stop when the owner is running. Keep failure/retry and approval content inside the transcript where applicable.
- [ ] Suppress the duplicate project/header bar and search, layout switch, maximize, toolbar project/runtime/model pickers, Changes, Create PR, drafts, attachments menu and voice chrome in the secondary presentation. Keep real message attachments and interactive artifact content in history. Make the compact input use the existing draft, pending send, stop and retry controller. A visual mode switch must never start a second subscription or remount/reset a bound artifact.
- [ ] Use the Move button as the visible placement affordance. Click/Enter/Space opens the placement menu. Expose Float, Dock left/right/above/below and Return to main where applicable. Escape dismisses and restores grip focus. Drag starts only after the incumbent drag threshold. Disable ineligible placements with an accessible reason and keep pointer and keyboard decisions identical.
- [ ] Use scoped role queries against each pane. Count one placement button, one textbox and one header per secondary. Exercise Enter to send one synthetic message to A, Shift+Enter for newline, IME composition without premature submit, Stop once on A and independent B draft/reply. Repeat with the agent board observing A. Assert exactly one command and the correct thread ID. Verify rich main controls still work when B is selected.

## T03 — Dock, resize and keep every pane readable

**Files.** `WorkspaceSplitLayout.tsx`, `FloatingWindow.tsx`, `WorkspacePanel.tsx`, `split-thread-placement.ts`, `panel-geometry.ts`, `workspace-split.css`, `conversation-workspace/conversation-pane.css` and shared ui-shell layout helpers. Extend split renderer, full-App split, drag-detach and geometry tests.

- [ ] Drag the grip from a float to the **chat canvas** left/right/top/bottom in four fresh profiles. Left is immediately beside the sidebar, inside the canvas. Use the resolved target pane bounds for edge detection and the current fit helper for eligibility. On an eligible edge show a thin neutral boundary and low-opacity fill within the future pane bounds. Remove the persistent blue dock strip, dashed target and repeated “Dock chat” label. No overlay when idle or hovering the center. Dropping in the center keeps the float.
- [ ] Commit one canonical placement command on release. Measure both pane rectangles and the divider. Left/right shares available width, top/bottom shares height. The divider separates siblings with overlapping cross-axis extent and no body overlap. Allow 2 CSS px for rounding. Drag the divider and show one sibling gains what the other loses. Verify all four directions after reload. Record release-to-first-feedback and release-to-ack separately with a monotonic clock and no screenshots in the measured interval. Prior 5–11 s observations included test polling and capture. During a delayed acknowledgment show pending state, preserve both chats and prevent a duplicate command.
- [ ] Change the float's CSS bounds during resize. Use actual width/height and reflow; no content scale transform. For the 480 × 680 → 818 × 356 case assert stable computed transcript font size/line height, changed line wrapping, reachable input, and no horizontal body scrollbar. Code and table overflow stays in the content block. Clamp on viewport changes and after restoring legacy geometry. Keyboard resize uses the existing accessible resize control. Keep resize independent of the grip.
- [ ] At 1440 × 900 recreate the four-pane layout and a 158 CSS px **total secondary pane, including its chrome**, at compact density. Use flex/grid with a shrinkable middle track (e.g. `minmax(0,1fr)`), bounded composer and scrollable history. Treat all pane chrome, including tab strip, as part of the measurement. In a 158 px total slot with one-line input require at least **80 px visible transcript**, an accessible grip and visible input/send. Collapse redundant chrome before reducing transcript font. For a newly requested split, reject a direction if either resulting chat cannot meet its minimum with the current text scale. The preview uses the same rule. When a restored valid tree no longer fits, present its focused pane at usable size with a keyboard-accessible pane selector until the tree fits again. Preserve the stored tree, drafts and views.
- [ ] Cancel tests must cover Escape, pointercancel, lostpointercapture, blur, unmount, rapid drag/release, a second pointer and non-primary mouse button. Assert zero placement commands after cancel, preview removed, owned pointer/listeners released and next drag succeeds. Repeat on split divider, float resize, sidebar/drawer resizer and generic plugin float.

## T04 — Simplify shell, panel, scrolling and sidebar

**Files.** `WorkspaceControls.tsx`, `WorkspacePanel.tsx`, `WorkspacePanelBodies.tsx`, `ShellSidebar.tsx`, `sidebar-collapse.ts`, `ChatScrollIndicator.tsx`, `chat-scroll-indicator.css`, App and WorkspaceHost. Extend shared-panels, sidebar-collapse, sidebar-shared-menu and conversation-scroll browser suites.

- [ ] Delete launchers, menus, keyboard bindings and palette actions for saved-layout selection/save and Switch layout. Remove their exclusive UI imports and dead handlers after checking all callers. Preserve automatic split restoration and the existing readers for saved records. At shell level render one icon button named “Open panel”/“Hide panel” with expanded state. Click twice restores the previously active surface. Remove the drawer's separate X. Keep the app's Windows window controls and the ability to dismiss dialogs.
- [ ] Use one shared list to render both the empty drawer and plus menu. On a clean profile with no surface, open the centered “Open a surface” launcher with **no selected Artifact tab or picker**. Selecting a row creates/selects exactly its tab. Opening an already-open surface activates its existing tab under the supported identity. Restoring a saved tab or following an explicit action opens that precise surface. Show opened tabs and one plus button in the compact header. Hide/reopen preserves active tab, tool state and focus return.
- [ ] Include Browser (B), Terminal (T), Files (F), Diff (D), Pull request (P), Linked pull requests (L), Device (M) and Side chat (S) in that order. Follow with supported Gen surfaces Artifact, Plan, Notes, Output and Usage. Use the existing host capability/permission flags. Render an unavailable row disabled with the specific reason. Browser opens its actual browser adapter; Side chat opens the actual side-chat view without sending a message. Scope letter shortcuts to the focused launcher, never an active text field. Test both lists including disabled states, selection, Escape, menu focus and short-window reachability.
- [ ] Chat rail is a slim repeating tick track, 1 px rail and 3 px thumb at default scale, with a 24 px transparent desktop pointer strip. Drag endpoints map to real scrollTop range. Short/empty content gets no deceptive active thumb. Long content, streamed changes, reduced motion, jump-to-latest and tab/float switches preserve reader location. Keep native system scrollbars on unrelated widgets unless a shared broken consumer is demonstrated.
- [ ] Collapse and reopen the left sidebar with mouse, Tab+Enter and configured shortcut. Verify actual sidebar bounds and hit-test the reopen control's center. Repeat with right panel open, split chat, Settings just closed, 1024 px width and native zoom 100/125/150%. Check Electron title-bar drag regions and overlapped layers if browser passes but native clicks fail. The toggle must be focusable and outside the draggable title area. Restore focus to a visible control after either transition.

## T05 — Retire four dedicated workspaces safely

- [ ] Enumerate workspace registration, routes/aliases, keyboard/command palette, sidebar links (including Personal Visuals), default/install contributions, restoration fallback and shell hosts. Use `WorkspaceControls.tsx`, `WorkspaceHost.tsx`, `packages/contracts/workspace.ts`, `packages/core/workspace-layout.ts` and `packages/plugins/installation.ts`. Classify legacy-reader, exclusive active feature and shared dependency separately.
- [ ] Remove active routes, controls and exclusive contributions for Code Review, Research, Custom and Visuals. Preserve Workspace, All Agents, Company, generic plugins, shared Diff/PR tools and previously stored conversations, layouts, configs and artifacts. A retired active destination falls back to Workspace and presents its valid thread. Do not mass-delete saved records, unrelated plugins or their files.
- [ ] Compare stored legacy fixture record hashes before/after opening. Exercise direct navigation, old shortcut, restored active surface, previously enabled Visuals contribution, ordinary unrelated plugin and Company. Assert the retired workspace cannot open and the retained surfaces still function. Search labels and aliases across all active launchers a second time.

## T06 — Match T3's settings navigation and search behavior

- [ ] Read the T3 source provenance in `third-party/t3code/README.md`. The retained TypeScript reference was pinned to `8760d063e903406c8e8f695b0852c0a15fc1e00f`; the earlier inspection also examined the installed T3 Code 0.1.9 settings, search and provider-detail modules. Record the source version examined. Inspect category navigation, how search opens a specific row, grouping of related controls, provider selection and details. Use the pinned material for repeatability; record any newer installed version separately.
- [ ] Use `apps/web/src/settings-registry.ts` as the single source for category, stable row ID, label, keywords, scope and target/focus. Reuse it from Settings and CompactSettings. Build the left rail with search and grouped categories, a breadcrumb/header for the active category, and labeled sections of rows with description and aligned control. Keep one selection highlight. Stack controls below labels on narrow panes; the content scrolls and the dismiss/back action stays reachable. Restore category scroll and focus after returning.
- [ ] Search “composer font”, “ChatGPT”, “Claude”, “project color” and a nonexistent value. Click a result and assert the actual control has focus/highlight in the right category. Subsection filters must never hide that target or validation feedback. Verify keyboard search, Escape and clear, navigation with a left/right panel open, dark/light and large text.
- [ ] For Providers, use a list and the selected provider's detail. Put account identity, enabled state, connection status and primary action first. Put binary/runtime setup and advanced controls below. On a narrow pane transition list → detail → back. Selecting Claude must not start discovery or changes for every provider.

## T07 — Prove every visible setting works

- [ ] Enumerate all rows from `Settings.tsx`, `CompactSettings.tsx`, `AppearanceSettings.tsx`, their category children, registry and conditionally rendered provider/project controls. Record one row per **distinct setting or action** with ID, label, scope, initial value, supported platform, write/read command, runtime consumer, failure effect and test. Expand dropdowns and advanced sections to find hidden branches. Reconcile rendered controls against the inventory in both directions.
- [ ] For every editable preference set a different value through UI → inspect actual affected surface → close/reopen Settings → reload/restart at its stated scope → confirm both effect and value → reset → confirm restored effect. For one-shot actions, verify target, accepted command and outcome. A saved settings JSON field is insufficient. Prove the actual font in conversation, project order in sidebar, archive/delete confirmation in the relevant synthetic action, time format in a timestamp, shortcut on the focused handler, and notification policy on the intended device surface wherever those rows are exposed.
- [ ] Update only edited fields through the existing preference patch/merge mechanism. Gate held request A, update a different field through B, then release A. Both edits survive, including unknown legacy fields. Failure leaves the last acknowledged value truthful, local input available to retry, and inline error visible beside its field even during search. A rejected validation sends no write. Test faulty persisted values with existing fallback, pending Apply/close and restoring category defaults.
- [ ] An enabled control with no consumer is a defect. Wire the promised behavior to its existing owning subsystem. Where a platform genuinely lacks capability, show the unavailable reason on that platform and verify the supported path separately. Do not mark a setting unsupported just to pass the inventory.

## T08 — Keep sign-in alive across Settings lifetime

- [ ] Trace `apps/desktop/account-login.ts`, desktop contract/preload/main, `apps/web/src/desktop-context.tsx`, `Connections.tsx`, full and compact Settings. Use one native flow per existing provider/account target and retrieve its flow ID/status on mount. Persist only supported nonsecret identity/flow metadata. The native adapter owns launch, cancel, expiry and cleanup.
- [ ] Through Settings start one synthetic Codex flow, close Settings, reopen it, assert the same pending flow and Cancel. Complete while closed and verify correct status on reopen. Repeat for Claude. Double click Connect, cancel then retry, expire the first flow, switch accounts during pending response, delay the old success and repeat with delayed error. Only the correct operation can change its target. Verify child/lease cleanup before authorizing another use. Surface blocked cleanup and a defined recovery action.
- [ ] Tests at `tests/account-login.test.ts`, `tests/desktop-account-login.test.ts`, `tests/desktop-preload-accounts.test.ts` and `tests/e2e/subscription-accounts.spec.ts` must cover the host and renderer. Use a stub provider/browser for deterministic CI. Never read a real user's auth stores to manufacture a pass.

## T09 — Make subscription readiness understandable and accurate

- [ ] Open Settings → Models & Accounts → Providers → ChatGPT (Codex), then Claude (Claude Code). Use the native provider-supported login via the existing adapter, including the official user-completed account approval. On web-only hosts show scoped instructions for the actual host: `pnpm agent:login --provider openai` or `pnpm agent:login --provider claude-code`. Make the correct terminal command copyable and show what to do after completion. Keep API-key credentials as a separately named route. Do not ask users to paste subscription cookies or browser tokens.
- [ ] Show signed out, waiting, cancelled/failed, authenticated, and model-ready distinctly. Gate Disconnect on an existing connection. Show last **actual** check, sanitized reason, Retry and a scoped model refresh. Authenticated without known entitlement remains authenticated with model access unverified. Sign-out invalidates only that account's cached models. Selecting or refreshing B must not change A's catalog. Use the existing target-specific account and model discovery APIs; trace `apps/server/account-auth.ts`, `packages/runtime/account-auth.ts` and model-picker consumers.
- [ ] Run the real desktop flow for each provider on an authorized account. Capture redacted native launch, successful return, selected identity/entitlement as reported, and model selection. For live inference require express permission for that provider/account and any usage cost. Send a single short synthetic prompt on that subscription, confirm the selected provider/account delivered a reply, and record only sanitized success metadata. Without those prerequisites mark that specific live step BLOCKED. Never use an API key or another provider to stand in for subscription proof. Continue all simulated/cancel/failure coverage.

## T10 — Fit four agent threads and give history the space

- [ ] Reproduce All Agents at 1440 × 900 with left sidebar open and five threads in the same project. Record **available board width**, every card's rectangle, transcript height, composer **form** height, number of status labels and document scrollWidth. Relevant files are `apps/web/src/agents-workspace/AgentsWorkspace.tsx`, `AgentWorkPanel.tsx`, `agents-workspace.css`, controller, composer and follow-up. Use existing history/draft/virtualization owners.
- [ ] Set board container responsive columns to four at ≥1080 CSS px, two at 768–1079 and one below 768. Use equal shrinkable grid columns. No horizontal carousel. Keep one compact title/status row, one accessible open-thread action, transcript filling available space and one inline message input with Send/Stop. Put additional model details in accessible details when needed; remove duplicate ready/status labels and a separate Send row. At default scale use ≥14 px agent transcript text. Honor larger text/zoom.
- [ ] At the desktop fixture's normal 420 px card height require transcript ≥280 px. At 360 px require ≥240 px. The idle composer uses one row. Its total height including borders and padding is 32 px at Compact density, 36 px at Comfortable and 44 px at Touch. Growing multiline input caps at 3 lines/72 px before it scrolls. Test measured heights with one-line draft and multiple long posts. Fifth card wraps with no horizontal scroll. Verify 1079/1080 and 767/768 using **container** width. At 390 px, opening a card, reading its latest message and sending remain usable.
- [ ] For 25+ threads, scroll away and back; preserve per-thread draft, scroll intent, pending sends and selected child follow-up. Respect the existing 24 active history lease cap. Stale follow-up/page/stop results from thread A cannot apply to B after slot reuse. Confirm removed projects leave the filter options when no retained thread references them. Verify empty/error/retry, filters and live updates preserve reading position.

## T11 — Collapse the outer artifact, including nested evidence

- [ ] Use the existing task disclosure, artifact and MotionRegion owners. Render long answer, nested source disclosure, editable child and following sibling. After restoration has settled measure outer artifact height, hidden region height and sibling Y. Click collapse, wait for motion to settle and measure again. Require the outer height decrease and the following sibling displacement to match the removed in-flow height within 2 CSS px, accounting for borders/spacing retained in both states. Verify reopen restores original value, focus behavior and sibling position.
- [ ] Remove the expanded-space reservation at the first ancestor that keeps the blank area. Keep bound children and journal identity intact. Collapsed descendants become inert/hidden to assistive tech. Return focus to the disclosure if its focused child becomes hidden. Keep readiness-controlled restoration geometry. On held journal restoration allow zero premature entrances; on release permit one intended body entrance. Test rapid reversal, streaming, nested collapse, Steps, reduced/off motion and restore failure.
- [ ] Run artifact-settle and task-interface against text and interactive children. Capture normal, restored and nested outer rectangles. When available repeat both original examples through a supported read-only profile path. Keep uncertainty about any unavailable original explicit.

## T12 — Remove the unwanted topic box without losing user content

- [ ] The supplied example labeled “Source / evidence” shows read-only prose (“Sole authority…”). It does **not** establish that the offending node was an HTML input. Inspect the generated topic schema, renderer, action bindings and accessibility role to identify the actual footer. Check `packages/ui-catalog/index.ts`, `packages/runtime-pi/presentation-policy.ts`, review fixtures and task-composition tests. Generation policy changed in `80b5d6ff`; first verify the current shape.
- [ ] For new topics remove automatic trailing follow-up Form/Input and gratuitous automatic footer panels. Continue the conversation through its existing composer. Preserve evidence accessible inside the topic and user-authored sources, real forms, notes, signing, planning controls and inputs with saved or pending state. Use paired positive and protected-negative fixtures.
- [ ] For the saved example, open the exact affected thread/artifact through the supported read-only application path when available. Identify its revision, node type, provenance/structural binding and relevant state. Create a redacted structural fixture. Only suppress an explicitly identifiable automatic redundant box at presentation time; keep underlying text/evidence accessible and original record bytes and journal intact. Never match by English label, position, appearance alone or an empty textarea. If the saved example cannot be identified or distinguished from authored content, leave it intact, record what is missing, verify new topics and mark the legacy case BLOCKED. Archive no real thread and rewrite no user's artifact.

## T13 — Make the dense plan usable in the narrow drawer

- [ ] Build a three-step plan matching the reported case. Step 1 has two parallel agents, long result paragraphs, long unbroken revision IDs, input/output counts and a rejoin dependency. Include completed, waiting, interrupted and active data in the fixture. Open it through the Plan surface and main summary. Resize the **pane** to 465, 320 and 280 CSS px and run the same interactions on each.
- [ ] Use `PlanStatus.tsx`, `plan-timeline/TimelineRows.tsx`, `plan-timeline/timeline.css` and the current plan presentation tests. Keep step number, title, status and disclosure together. Put long evidence, results, revisions and token details inside the step/agent details. At widths <560 CSS px stack branch cards and check/status text vertically; at ≥560 use two branch columns only when each has ≥260 px usable width. Wrap long IDs within their row. Keep counts readable and plan header/recovery controls reachable.
- [ ] Default completed details closed and working/waiting details open. Preserve explicit expansion/closure by scoped plan, step and agent identity through updates, reorder, switch/reopen and reload. Reject obsolete revisions. Parent collapse hides all nested lanes, shrinks total height and returns focus if necessary. Rejoin/dependency links target the correct step and expand it when activated. Historic results remain readable.
- [ ] Assert no plan-wide horizontal overflow (`scrollWidth <= clientWidth + 1`), nested text/check/status fully reachable, focus visible, same child history after refresh and no duplicate rows. Test 45-character unbroken ID, multiline results, two parallel branches, failed child and reduced motion. A two-step 465 px screenshot alone leaves this task open.

## T14 — Use color to communicate state

- [ ] Bind roles to the existing semantic foreground/background tokens in both themes. Running/working uses blue with activity icon; waiting/blocked/needs input uses amber with attention icon; completed/success uses green with check; failed uses red with error icon; ready, stopped, interrupted and cancelled use neutral with their respective text/icon. Preserve distinct labels and the original source label for unknown values. Project identity and user-selected accents do not override status meanings. A reported percentage cannot mark work complete.
- [ ] Apply the mapping to sidebar, main/secondary chat, All Agents, plan steps and agent branches, tool/operation results, notifications, providers and generated task status. Inspect the actual indicator, label/icon and computed foreground/background in dark, light and system theme. Use ≥4.5:1 for normal text and ≥3:1 for meaningful nontext controls/indicators. In forced colors preserve native focus and readable labels. Visually distinguish idle/working, completed/interrupted and warning/failure even without color.
- [ ] Use known fixture states simultaneously. Check with custom project accent and keyboard focus. Add a regression that reads the completed and interrupted status **indicator** in the light plan and asserts different roles plus correct text. Test cancelled operations as neutral. Reserve red for failure/destructive intent and amber for attention.

## T15 — Sweep the retained interface beyond the reported screens

Start from the live route, workspace, surface, settings and catalog registrations and `scripts/browser-suites.ts`. Inventory every rendered primary action and every caller of a changed control. The families below are the minimum. Follow any additional registration into the same ledger. Cover new and restored profiles. Use the ordinary application's navigation for at least one test of every altered integration.

| Visit | Actions and proof required |
|---|---|
| Workspace, All Agents, Company, generic plugins | Switch away/back, restore old profile, test unavailable adapter, scoped thread history, resize and retained draft. Confirm removed workspaces cannot reappear. |
| Sidebar, project context, inbox, notifications | Search/filter/order, select thread during an update, toggle both sides, follow a notification, test permission denied and restore focus. |
| Floating/split chats, tool panes and dialogs | Send/Stop, dock, park, return, reload, resize, switch tabs, keyboard and pointer cancellation. Verify focus, bounds and correct owner after each operation. |
| Files/search, browser, terminal | Open selected file, change selection with read pending, retry denial, hide/restore browser, resume the same terminal and resize it. Confirm late responses do not overwrite a newer target. |
| Diff/checkpoints, PRs, linked PRs, GitHub setup | Switch working copy or revision, inspect a diff, repair stale selection, cancel/expire/retry simulated sign-in. Intercept external writes and assert exact synthetic command target. |
| Notes, thread memory, output, usage, context | Save/reload a note, hold one write while switching, force conflict, read long structured output and unknown usage. Check retained content and truthful units/status. |
| Plans, topic artifacts, component catalog | Enumerate every registered family and alias. Exercise tables, forms, Steps, disclosures, documents, graphs, images and signing inputs. Ensure intentional edits submit once and survive collapse. |
| Settings, provider/model pickers, attention/toasts | Open/search/choose, fail a write, reject validation, retry, restore focus and select the correct account/model. Verify every exposed setting against T07. |
| Desktop launch, update, restart/recovery | Exercise cold launch, dependency/host failure, bounded retry, restart with pending local state and diagnostics using an owned profile. Keep recovery usable on a short screen. |

- [ ] For each family exercise normal, empty, pending/refresh, recoverable failure and genuinely unavailable states where reachable. Capture the effect of each distinct handler, not just render coverage. For a disabled item record the capability reason and demonstrate the enabled case on the supported platform.
- [ ] Use 1920 × 1080, 1440 × 900, 1024 × 768, a short 1280 × 600, and 390 × 844. Also test real 280/320 px containers. Cross these with sidebar open/closed, long names/paths, large text, dark/light, reduced motion and native zoom. Cover each dimension in at least one relevant family and every explicit task case. Keep long code/table scrolling local and document width within viewport +1 CSS px.
- [ ] Add each reproduced related issue to requirements.md with sequential AUD ID, reproduction, owner and failing regression. Fix it at its owner and rerun all affected callers plus its original click sequence. Keep unrelated requests outside the patch. Every retained row must have an observed outcome, a specific external blocker, or documented and tested compatibility behavior.

## T16 — Test shared failures that happy-path clicking misses

- [ ] Enumerate actual callers with `rg -l` over `apps/web/src`, `packages/ui-shell`, desktop adapters and generated controls. Search for pointer capture, resize/scale, fixed/min-height, scroll/overflow, disclosure, Send/Stop, selection/focus fallback, preference patches, account/model refresh, retry and stale revisions. Classify every hit in consumers.md. Keep intentional canvas zoom, signature calibration and bounded code/table scroll.
- [ ] For each asynchronous owner use explicit promise gates: start A → select/edit B → release late A success; repeat with late A failure. Assert B's content, error, spinner, draft and selected identity remain B's. Repeat for close/reopen and for an uncertain write acknowledgment. Retry uses the same operation identity or reconciles first. For user actions verify one event produces one accepted command.
- [ ] Exercise every previously identified candidate below. These are investigation targets. Preserve a passing path and record its test when current code disproves a candidate.

| ID | Required test outcome |
|---|---|
| AUD-01 | Shared panel resize ignores wrong pointer/button and stops on blur. |
| AUD-02 | Split drag releases capture and preview on Escape/blur. |
| AUD-03 | Floating move/resize stops on lost capture. |
| AUD-04 | Impossible split produces neither valid preview nor commit. |
| AUD-05 | Embedded Stop uses the one controller for its own thread. |
| AUD-06 | A configured shortcut affects the focused hosted chat once. |
| AUD-07 | Disconnecting the selected provider invalidates only its catalog. |
| AUD-08 | Applying a font change preserves a concurrent density update. |
| AUD-09 | Invalid project color during search shows its error next to the field and sends no write. |
| AUD-10 | Artifact journal readiness gates one body entrance. |
| AUD-11 | Collapsing a plan parent hides descendant lanes and shrinks the real layout. |
| AUD-12 | Removing a project removes the stale filter option when no thread references it. |
| AUD-13 | Replacing the controller or externally changing its scope keeps displayed and applied agent filters aligned. Trace actual callers and document reachability. |
| AUD-14 | Cancelled/stopped operations use neutral semantics. Failures remain visibly distinct. |

## T17 — Run the release checks and perform final user-style acceptance

- [ ] Run the command groups below serially in the owned checkout. Each command must exit 0 before recording a passing receipt. Inspect the number of executed tests and unexpected skips. Record failed attempts and fix the first evidenced cause. Execute the registered browser workloads, not just discovery. A fixture with a mocked host may validate UI state transitions but cannot satisfy the native bootstrap or live-account gates.
- [ ] Repeat the following as one session on the same integrated Windows Electron build with an owned profile. Open A → type a draft → detach A → select B → dock A right → detach A again → verify B's actual last message → resize A → dock A left/top/bottom → reopen sidebar → toggle drawer → launch Files, Browser and Side chat → type in each chat → open Settings, change a visible preference, close/reopen → inspect both provider details → open All Agents with five threads → expand/collapse nested artifact and dense plan → restart and recheck B and A. Also test each direction independently from a clean two-thread layout. Verify the compact presentation persists on docking, single ownership on Send/Stop, and no duplicate native chat window appeared.
- [ ] Record images with before/after bounds for main/float/dock, 158 px pane, agent grid, nested artifact, 280 px plan, clean/active drawer and light/dark statuses. Record actual Windows display scale separately from Electron zoom. For the original sidebar defect include pointer click after collapse at 100/125/150% app zoom. Do not change the user's physical display settings during unattended work. If a required real DPI configuration is unavailable, report which configuration was exercised.
- [ ] Review the production patch, tests and public-source/browser manifests against the final SHA. Run the repository's required review/CI for each coherent change and security review for account/IPC changes. Keep original screenshots/private profiles/raw auth logs outside public changes. When a fix lands after a pass, rerun its affected receipts on the integrated build.
- [ ] Deliver a summary with R01–R18 and T00–T17, links to the strongest current evidence, and every additional AUD finding with its resolution. Report observed browser, native, live ChatGPT, live Claude and user visual acceptance separately. If native startup, original artifact identity or a live provider blocks a required check, give its precise reproduction and the missing input. Do not declare all eighteen complete with an unresolved required check.

### Commands for the executor

Use fresh process-scoped PowerShell for the opt-in split tests, so closing it restores prior environment. The browser runner registrations, test paths and package scripts are the authority on the executing SHA. If upstream renames one, locate its registered successor, record the mapping and run that equivalent test.

```powershell
pnpm exec vitest run tests/conversation-placement.test.ts tests/split-workspace-layout.test.ts tests/split-thread-placement.test.ts tests/split-tool-placement.test.ts tests/panel-geometry.test.ts --maxWorkers=1
pnpm exec vitest run tests/settings-registry.test.ts tests/settings-search-filter.test.ts tests/settings-supported.test.ts tests/settings-operations.test.ts tests/preferences-appearance.test.ts tests/sidebar-project-order.test.ts --maxWorkers=1
pnpm exec vitest run tests/account-auth.test.ts tests/account-auth-http.test.ts tests/account-login.test.ts tests/desktop-account-login.test.ts tests/desktop-preload-accounts.test.ts tests/model-discovery.test.ts --maxWorkers=1
pnpm exec vitest run tests/agents-workspace.test.ts tests/agents-workspace-composer.test.ts tests/agents-workspace-follow-up.test.ts tests/artifact-settle.test.ts tests/task-composition.test.ts tests/plan-timeline-ui.test.ts tests/plugin-workspace-navigation.test.ts --maxWorkers=1
pnpm exec vitest run tests/browser-runner.test.ts tests/public-source.test.ts tests/wo8-color-pairing.test.ts --maxWorkers=1
```

```powershell
$env:GEN_E2E='1'
$env:GEN_TEST_BROWSER_CHANNEL='msedge'
$env:GEN_SPLIT_RENDERER_BROWSER='1'
pnpm exec vitest run tests/split-workspace-renderer.test.ts --maxWorkers=1
if ($LASTEXITCODE -ne 0) { throw 'Split renderer failed' }
Remove-Item -LiteralPath Env:GEN_SPLIT_RENDERER_BROWSER
$env:GEN_SPLIT_APP_BROWSER='1'
pnpm exec vitest run tests/split-app-browser.test.ts --maxWorkers=1
if ($LASTEXITCODE -ne 0) { throw 'Full App split failed' }
```

In a fresh shell for the normal browser runner:

```powershell
$repairSuites = 'chat-view-modes','shared-panels','conversation-scroll','sidebar-collapse','sidebar-shared-menu','compact-settings','settings-leaf-selects','compact-model-picker','side-chat','agents-workspace','artifact-settle','task-interface','plan-presentation','frontend-refinement'
foreach ($repairSuite in $repairSuites) {
  pnpm test:browser -- --suite $repairSuite
  if ($LASTEXITCODE -ne 0) { throw "Failed browser suite $repairSuite" }
}
pnpm typecheck
pnpm lint
pnpm test:ui-guard
pnpm test
pnpm test:e2e
pnpm desktop:build
pnpm exec tsx scripts/verify-desktop.ts
```

Run the final commands individually and retain their exit codes. If a suite fails because its port is occupied, identify the owner, leave unrelated processes running and rerun in a clean test environment. Never count an empty, skipped or list-only run as coverage.

### Closure packet

The first paragraph of the final report must state how many original reports passed, how many failed and how many remain blocked/open. The counts must add to 18. For every nonpassing item state the failing action or missing evidence in one sentence. Then provide the same count for engineering tasks. Include the exact build SHA, native executable tested, normal host readiness result, and whether each subscription completed a live round trip. Keep private evidence local and supply sanitized paths. An executor can certify the paths actually exercised. User visual approval requires the user's own review.

**Optional local references.** The plan above can be executed on its own. On the original machine, the previous user-style audit (`../../../.harness-repair-evidence/user-click-audit-7ac80d87/audit.md`) has the screenshots and measurements, and the original design handoff (`../specs/2026-11-14-gen-v1-harness-repair-design.md#screenshot-authority-manifest`) indexes the user-supplied screenshots.
