# Gen V1 visual-first workspace and plug-in implementation plan

Date: 2026-11-04

Status: Integrated planning document only. Updating this document does not authorize implementation, repository changes beyond this document, installation, publication, or native promotion.

**Private planning material:** This combined roadmap now contains the supplied company-specific design, assignment baseline, and private source responsibilities. Keep the complete document out of public source allowlists, exports, packages, and public Git history. Its permanent home after separation is the accepted private Gen-Company repository. A public roadmap may contain only generic harness requirements with all company-specific detail removed. This document update does not change export tooling or prove that exclusion is enforced.

> For agentic workers: after the repository-separation handoff is accepted and implementation is authorized, use the subagent-driven-development or executing-plans workflow task by task. Reconfirm the final repository roots, source revisions, file ownership, and plug-in API before editing.

**Goal:** Make Gen V1 and its visual plug-ins easier to understand through purposeful color, spatial workspaces, useful diagrams, a shared agent inbox, clear settings, and reliable notifications.

**Architecture:** The harness owns generic pane layout, navigation, appearance, settings, event delivery, and validated plug-in APIs. Personal and company-specific generative interfaces run in their respective plug-in packages. Preserve existing identities, drafts, journals, account bindings, and authority checks.

**Tech stack:** Existing React, TypeScript, Vite, Electron, Node, host persistence, journal, and plug-in SDK. Dependency additions require a demonstrated need and a scoped review.

**Specification basis:** The user's screenshots, supplied recording, planning conversation, original detailed plan, and the attached `2026-11-04-company-visual-workspace.md`, integrated into this document on 2026-11-04. Numeric limits and defaults identified as proposals below are starting implementation targets rather than existing product behavior.

**Merge provenance:** The supplied company plan has SHA-256 `BD2BDD1C8EF53CE8DB373649526A79075CF70B97810C976911384E8D3177D540`. The original roadmap before this merge had SHA-256 `3BBEF3BFFDB4BB6BC80F69D56E43B0D79883725B1032224150177B415FB109B4`. This document is the consolidated roadmap; the original attachment remains unchanged.

## 1. Confirmed direction and execution gate

Implementation must wait until the following work finishes and the harness and private plug-in repositories are separated:

[Restore Gen and extract the private Company plug-in](t3-thread://v2/17662262-856e-45f7-98fb-56c92cacfa8f/b3b90f0c-3d3c-4ddd-9354-1083db236553).

Confirmed user decisions:

- The default workspace uses split panes and is not a canvas.
- Detaching and floating windows are deferred.
- New panes are created through Blender-style edge/corner interactions, with accessible equivalents, rather than an extra Add Window button.
- Existing threads are placed by dragging them from the left sidebar.
- Notifications use custom bottom-right popups above other applications, with sound and no unsolicited focus stealing.
- Project colors must be meaningful, saturated, and readable rather than washed out.
- Custom generative interfaces belong in plug-ins.
- Personal architecture/system visuals belong in a personal visuals plug-in package.
- Company organization, agent screens, communications, avatars, and company-specific generative interfaces belong in the private Maritime plug-in.
- The installed private plug-in contributes an optional Company workspace in the workspace bar. Its map-first layout does not replace personal Workspace, All Agents, or the approved company communication design.
- Company settings, global skills, employee-runtime plug-ins, and MCP management are scoped private views. Changes use the existing Maritime approvals, execution, budgets, reservations, and recovery paths; visual controls do not create those capabilities.
- The inbox selectively reuses Vespin's existing design and necessary code. Do not redesign it or copy the entire application.
- Settings should follow the supplied organized navigation, compact grouped rows, right-aligned controls, and visual theme previews.
- Environment-variable and API-key configuration must be functional host capabilities, not presentation-only inputs.

Before execution, record the accepted repository roots, commits, plug-in API version, compatibility range, and file owners. Rebase the proposed paths in this document onto that handoff. The referenced thread's completion and separation acceptance have not been established by this planning document.

### Integrated scope and precedence

| Topic | Consolidated decision |
|---|---|
| Personal workspace versus Company map | Personal Workspace uses generic split panes. The optional private Company workspace uses the same engine with a map and companion panes. |
| Pane creation | Use the shared split/join/editor-selector interactions; no second company layout engine or competing Add Window control. |
| Detach and floating | Remain deferred for both workspaces. The narrowly scoped notification surface is not a workspace-detach API. |
| Public versus private | Public Gen owns generic contributions, layout, presentation primitives, and protected host integrations. Company schemas, projections, management logic, assets, and this detailed company plan remain private. |
| Communication | Reuse canonical manager/task/project conversations and decision records; preserve unavailable-send states and the owner's approved communication protocol. |
| Shared infrastructure | Reuse project-color preferences, credentials, Inbox/event delivery, and notifications. Do not introduce parallel stores, schedulers, or company chat databases. |
| Evidence and acceptance | Map/UI, live observations, real screens, and real management rollout have separate gates. Fixture success does not establish a working company. |

The company attachment supplies the detailed private workstream in section 13. Its assignments and provider notes are planning inputs that must be checked against accepted canonical records and supported APIs before execution, not newly verified live state.

## 2. Frame-by-frame recording analysis

Source: `C:\Users\user\Downloads\ScreenRecording_11-04-2026 00-07-34_1.mov`

Original SHA-256: `3C15D5B507D12888A56885E347663753D895AF38E620A3A456AD8A51C97BBC37`

The recording lasts 36.87 seconds and contains 2,211 video frames. Its encoded 960 x 2080 stream rotates to a 2080 x 960 landscape desktop view. Analysis decoded every frame, reviewed all frames at thumbnail scale across 28 chronological contact sheets, computed 2,210 adjacent-frame changes, and enlarged 26 transition frames.

| Frames / time | Observed interaction |
|---|---|
| 0-359 / 0-5.98 seconds | One conversation fills the workspace; the pointer approaches a different sidebar thread. |
| 360-420 / 5.995-6.997 seconds | An existing sidebar thread is dragged with a thread-card ghost. The lower half becomes an outlined/shaded target labeled **Below**. |
| By 429 / 7.147 seconds | The drop creates two vertically stacked, distinct conversations. Each retains its own header, transcript, and composer. |
| 519-540 / 8.647-8.998 seconds | Another sidebar thread is placed in a full-height left pane. The existing two conversations remain stacked on the right. |
| 541-880 / 9.015-14.652 seconds | Divider dragging changes proportions continuously. Frame 620 shows an active divider and a **36% width** tooltip. |
| 895-905 / 14.918-15.085 seconds | A browser New tab is dragged from a tab strip to a **Side by side** target, producing a full-height browser pane on the far right. |
| 1037-1100 / 17.287-18.338 seconds | Navigation loads a page inside the existing browser pane. The white loading change is not a new operating-system window. |
| 1118-1325 / 18.638-22.092 seconds | Browser/main dividers are resized repeatedly, including near-collapse and restoration. |
| 1480-1500 / 24.677-25.010 seconds | The sidebar is widened substantially, compressing the content panes. This does not prove a join operation. |
| 1734-1760 / 28.913-29.347 seconds | The browser is widened again while retaining its page. |
| By 2015 / 33.600 seconds | A horizontal divider compresses the lower conversation into a thin header strip rather than visibly deleting it. |
| 2155-2210 / 35.935-36.853 seconds | Final resizing changes proportions while preserving multiple conversation identities. |

Copy these interaction qualities:

- Spatial placement directly from the sidebar.
- A thread ghost, bounded target preview, and clear placement word before committing.
- Nested horizontal/vertical splits and tab movement between areas.
- Visible association between each pane's title, transcript, composer, and model controls.
- Active-divider highlighting and live percentage feedback.
- Content reflow as pane proportions change.

The footage does not demonstrate operating-system detachment, free-floating windows, a clear join gesture, browser-to-PR editor switching, restart persistence, or authority/draft recovery. Those require separate design and verification. Avoid reproducing unusable slivers; use minimum sizes and deliberate collapsed strips.

Temporary analysis evidence:

`C:\Users\user\AppData\Local\Temp\gen-layout-video-analysis-bb97f68af4ca4ce2aec4c1e02e3faa17`

The directory contains `coverage-receipt.json`, `frame-times.csv`, `adjacent-frame-deltas.csv`, 28 contact sheets, and `focus-index.json`. Temporary evidence may not be available on another machine or after operating-system cleanup. The original recording remains unchanged.

## 3. Most important additions and fixes

| Priority | Addition or correction | Why it belongs in the first release |
|---|---|---|
| Essential | Stable editor mounts during pane movement | Stable React keys alone do not preserve an editor moved between different tree parents. |
| Essential | Exact pane ownership | Sidebar selection or pending actions must not redirect Send, Stop, model changes, or project actions. |
| Essential | Layout undo and recovery | Split/join mistakes and failed persistence must not cost drafts or force workspace reconstruction. |
| Essential | Browser-instance handling | The current controller manages one docked browser; apparent independent panes must not navigate the wrong native view. |
| Essential | Protected Context/Usage behavior | Joining or changing a pane must not delete the protected tools. |
| Essential | Discoverable and accessible pane gestures | Hidden corner controls require a first-use hint, keyboard alternatives, and usable focus states. |
| Essential | Durable shared inbox events | Reconnects and multiple views must not duplicate notifications or lose requests. |
| Essential | Notification privacy and focus | Custom popups above other applications need preview controls, quiet hours, and deliberate navigation. |
| Essential | Real observation states | A message or screenshot cannot by itself prove that an employee is working now. |

## 4. Milestone A: Repository boundaries and compatibility

| Location | Responsibility |
|---|---|
| Main harness | Generic layout, workspace/pane contributions, navigation, settings, themes, inbox infrastructure, notification delivery, protected viewer support, validated plug-in APIs |
| Personal visuals plug-in | Architecture diagrams, system maps, dependencies, timelines, visual explanations |
| Private Maritime plug-in | Company organization, agents, communications, screen observations, avatars, company-specific generative interfaces |

Tasks:

- [ ] Record the final repository and API handoff before implementation.
- [ ] Inventory existing generative components and classify generic rendering primitives versus task-specific visual behavior.
- [ ] Package task-specific visual providers in plug-ins while retaining saved artifact identities, answers, and rendering compatibility.
- [ ] Preserve existing account, project, journal, native-sender, and plug-in-scope checks.
- [ ] Keep public/private integration generic; do not add Company-specific branches or private schemas to the main shell.
- [ ] Add an optional, capability-detected generic workspace contribution to the plug-in registration contract; consume installed contributions in the workspace bar rather than hardcoding Company.
- [ ] Validate workspace/view references against the installed plug-in and its exact scope. Public presentation reuse must not inject personal providers, account clients, or message commands into opaque private frames.
- [ ] Test contribution installation, removal, missing/incompatible API support, and unchanged personal presets.
- [ ] Keep the combined private roadmap, company templates, employee assignments, and implementation out of public exports and history; verify the actual export manifest before release.

Acceptance: the harness works without the private plug-in installed; unavailable plug-in views retain recoverable identities rather than falling through to personal runtime behavior.

## 5. Milestone B: Durable split-pane foundation

Build a new split-layout model for the default Workspace. Do not rename or restrict the current canvas and treat it as the new model.

Keep three identities separate:

| Identity | Responsibility |
|---|---|
| `paneId` | Rectangular area and its tab strip |
| `viewId` | Persistent presentation instance, such as an open thread or PR editor |
| Existing surface/binding | Actual thread, project, artifact, browser, terminal, or plug-in authority |

Proposed model:

- A split tree with split nodes containing an ID, axis, ratio, and two children.
- Leaf nodes referencing pane IDs.
- A pane registry containing ordered view IDs, the active view, and collapse state.
- A view registry containing the existing typed surface binding and view kind.
- Parked views for displaced content that remains recoverable.
- Focused-pane identity and an exact layout revision.

Drafts, credentials, message history, terminal processes, and browser state do not belong in the layout tree.

Proposed starting limits: 16 active leaf panes, tree depth eight, unique IDs, no cycles or dangling references, and no single view assigned to two panes simultaneously.

Tasks:

- [ ] Implement validated split records and semantic layout commands.
- [ ] Reuse existing pane bodies and typed bindings.
- [ ] Add a surface registry with stable per-view mount containers.
- [ ] Preserve actual composer, PDF, document, terminal, and plug-in-frame state during movement.
- [ ] Persist local drag previews once on release rather than sending every pointer movement to the host.
- [ ] Use this same pane model for installed plug-in workspaces, including their scoped entry view and default-layout reference. A Company layout reset affects only that workspace's UI arrangement.

Acceptance: moving a pane does not restart an agent, duplicate a conversation, change its account, lose entered values/cursor state, or create a new resource grant.

## 6. Milestone C: Pane interactions, accessibility, and recovery

| Action | Planned behavior |
|---|---|
| Sidebar click | Activate an already-open thread; otherwise open it in the last focused conversation area while retaining the previous view as a recoverable tab. |
| Sidebar thread drag to lower/upper half | Show Below/Above preview, then create a horizontal split. |
| Drag to a pane's left/right edge | Create a local side-by-side split. |
| Drag to a workspace outer edge | Create a full-height or full-width split. |
| Drop at the center | Open the existing thread as a tab. |
| Drop an already-open thread | Move its existing view rather than duplicating its composer or starting another agent. |
| Drag a pane tab | Move that view between panes. |
| Drag a shared divider | Resize continuously with an active divider and percentage feedback. |
| Drag a corner inward | Preview a new split and an empty editor area. |
| Drag across a neighboring area | Preview a join and clearly identify the retained area. |
| Change editor type | Park the prior view and activate a compatible view without mutating its authority. |
| Escape, right-click cancellation, pointer cancellation, or lost capture | Restore the original arrangement without persisting a partial change. |

A Thread editor displays **Drag a thread here**. Do not add a thread-selection dropdown or an extra Add Window button.

### Recovery and transactions

- Capture workspace/layout ID, base revision, source/target IDs, and expected ownership in each semantic command.
- Flush affected journals and run editor guards before joining, parking, or replacing views.
- Leave the original arrangement intact if preparation fails.
- Refresh safely on a stale revision; never retry against whichever pane is now selected.
- Add bounded layout-only undo/redo, initially 20 changes per workspace.
- Provide Restore last working layout.
- Keep task actions, messages, approvals, and Git operations outside layout undo.
- Preserve original v1 canvas/profile/native records during migration.
- Convert the default Workspace deterministically; leave optional All Agents, Research, and custom canvases unchanged.
- Retain hidden or unmappable views in a recoverable parked list.
- Preview and explicitly apply conversion of saved legacy profiles.
- Preserve the established recovery path for existing native children without creating new detached windows.

Project context and Usage remain protected. Joining or changing their area may minimize or park them as accessible tabs, but cannot delete them. A ready plan activates its existing view without creating duplicate splits or stealing composer focus.

### Minimum sizes and narrow windows

Proposed starting minimums:

| Editor | Minimum CSS size |
|---|---|
| Conversation | 320 x 220 |
| Browser | 320 x 180 |
| Files, Notes, Inbox | 240 x 180 |
| Diff or PR | 360 x 220 |

Refuse a split that cannot fit its subtree minimums. An intentional collapse becomes a labeled 36-pixel strip. On narrow windows, temporarily show a selected pane and a compact pane switcher while retaining the desktop split tree for restoration.

Add a dismissible first-use hint, keyboard thread placement, focusable separators, arrow-key resizing, and accessible names/current sizes. See the [W3C window-splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/).

## 7. Milestone D: Active-pane ownership and browser lifecycle

The active pane must be visually clear. Send, Stop, model changes, project actions, and inbox responses target that pane's captured owner even if sidebar selection changes during a pending action.

The current browser controller manages one docked browser. Initially support one genuine embedded browser view that moves between panes. Multiple independent browsers require a later scoped registry and commands carrying an authorized browser ID.

Tasks:

- [ ] Preserve URL, history, and browser identity when moving its tab.
- [ ] Hide or occlude native browser content while interaction, menus, or dialogs block it.
- [ ] Report new bounds after final layout settles.
- [ ] Hide native content for inactive or parked tabs.
- [ ] Retain strict occlusion checks.
- [ ] Test window resizing, display scaling, tab changes, and covering interfaces.

Acceptance: commands never navigate or manipulate a different browser instance, and native web content never leaks above covering application UI.

## 8. Milestone E: Meaningful color and agent identity

Project colors are persistent, editable, and keyed by project identity plus authority rather than mutable project names.

Use saturated accents against the existing neutral shell in project icons, sidebar markers, pane tabs, inbox labels, and diagram boundaries. Keep project ownership separate from activity state through distinct symbols and labels.

Tasks:

- [ ] Define a coherent saturated palette and contrast-tested theme tokens.
- [ ] Preserve colors through renaming, reordering, and reload.
- [ ] Support user overrides without changing project identity or permissions.
- [ ] Add curated agent avatars in the Maritime plug-in, including the requested Grok robot, ChatGPT dot, and Muse options.
- [ ] Keep individual agent identity separate from an optional actual-provider badge.
- [ ] Verify that avatar changes do not change models, accounts, or agent configuration.
- [ ] Check dark, light, high-contrast, color-blind, and monochrome understanding.

## 9. Milestone F: Functional Settings and customization

Follow the supplied reference organization: searchable left navigation, compact grouped rows, concise labels, right-aligned controls, and visual previews.

| Group | Main controls |
|---|---|
| General | Startup behavior, time format, confirmations |
| Appearance | Theme previews, backgrounds, accents, contrast, typography, opacity |
| Workspace | Pane behavior, saved layouts, sizing, recovery |
| Chat | Width, wrapping, send shortcut, composer preferences |
| Providers | Connected accounts, real availability, runtime configuration |
| Environments | Scoped variables and secret configuration |
| Notifications | Sound, volume, privacy, quiet hours, event categories |
| Keybindings | Searchable shortcuts and conflict detection |
| Plug-ins | Installed packages, compatibility, available contributions |
| Advanced/About | Diagnostics, versions, maintenance information |

Tasks:

- [ ] Show whether a setting applies to the device, project, provider, or account.
- [ ] Distinguish inherited values from overrides and show the effective value.
- [ ] Add Preview, Apply, Cancel, and Reset for backgrounds/themes.
- [ ] Preserve readable content surfaces over bright and dark imported images.
- [ ] Fall back safely when a background asset is missing or invalid.
- [ ] Keep detailed explanations in disclosures rather than long default descriptions.
- [ ] Make section resets affect only that section.
- [ ] Call workspace profiles Layouts to avoid confusion with agent profiles.
- [ ] Show functional controls and move detailed unavailable-capability diagnostics out of the main task flow.

Acceptance: every displayed control has a real supported effect, persists correctly, and can be reset without affecting unrelated accounts, credentials, drafts, or layouts.

## 10. Milestone G: Environment values and API keys

Implement host capability and Settings form together.

Support a variable name/value, explicit scope, secret/ordinary classification, masked editing, replacement/removal, configured-state indicators, explicit connection testing, and clear application timing.

Tasks:

- [ ] Add a host-owned credential/environment service and validated configuration contracts.
- [ ] Use a dedicated protected secret-write path excluded from normal command journals, logs, layout exports, and plug-in messages.
- [ ] Return configured-state metadata after saving rather than stored secret values.
- [ ] Preserve pinned runtime homes, account identity, and supported environment restrictions.
- [ ] Apply changes to subsequent sessions without silently changing running tasks or billing routes.
- [ ] Make connection testing an explicit action rather than a side effect of typing.
- [ ] Cover save, replacement, removal, restart, unavailable storage, and failed-save behavior.

Acceptance: values can be configured through the UI; secret bytes do not appear in persisted frontend state or diagnostic output; running account bindings remain intact.

Company MCP/tool configuration consumes only scoped protected secret references through the existing private host/control service. It does not receive personal secret bytes or create a second credential store. Installing or testing a tool cannot silently change account, billing, runtime, or company permissions.

## 11. Milestone H: Shared inbox events and selective Vespin integration

Build one durable event model before either the inbox or popup UI.

Each event needs a stable ID, owning authority/project/thread/agent, category, occurrence time, read state, validated destination, and permitted response actions.

Required behavior:

- Reconnects do not replay old sounds.
- Multiple views do not generate duplicate notifications.
- Reading an item does not approve its underlying request.
- Dismissing a popup does not delete the durable inbox item.
- Personal aggregation does not expose unauthorized private Company content.
- Stale or already-resolved requests retain clear states and cannot be acted on as current requests.
- The private Company inbox consumes this presentation/event infrastructure through a scoped adapter to canonical company questions, reviews, decisions, and task records. It does not mirror them into a new authoritative business database.

### Vespin extraction boundary

Inspected revision: `7f0bfe954a958858235b91d82293043ab5541433`.

Preserve its list-and-reading-pane design, visual states, keyboard behavior, unread treatment, responsive handling, and answer placement. Adapt data and authorized callbacks to Gen's existing requests, operations, and real updates.

Starting candidates, subject to a bounded dependency inventory:

- `packages/panel/src/tasks/inbox-list.tsx`
- `packages/panel/src/tasks/inbox-pane.tsx`
- `packages/panel/src/tasks/inbox-item-parts.tsx`
- `packages/panel/src/tasks/inbox-columns.ts`
- Necessary answer controls and pure model helpers.
- Required UI primitives and scoped styles.

These are not a proven minimal dependency closure. Do not copy the whole application or its cloud, authentication, agent-launching, billing, telemetry, or backend stores.

Tasks:

- [ ] Record copied paths, pinned hashes, modifications, and required licenses/notices.
- [ ] Scope styles so the extracted inbox cannot restyle the surrounding harness.
- [ ] Supply a Gen-owned event/action adapter.
- [ ] Prioritize Needs you while retaining search, filtering, unread state, and completed items.
- [ ] Keep private Company content/actions behind the private plug-in scope.
- [ ] Compare against the pinned upstream view to verify design fidelity.
- [ ] Port relevant navigation, answer, draft, and read-state checks.

References: [pinned inbox source](https://github.com/ReviewStage/vespin/blob/7f0bfe954a958858235b91d82293043ab5541433/packages/panel/src/tasks/inbox-list.tsx), [LICENSE](https://github.com/ReviewStage/vespin/blob/7f0bfe954a958858235b91d82293043ab5541433/LICENSE), [NOTICE](https://github.com/ReviewStage/vespin/blob/7f0bfe954a958858235b91d82293043ab5541433/NOTICE).

## 12. Milestone I: Custom notification popups above other applications

Use a dedicated host-owned notification surface with fixed bundled content, bounded event data, and validated navigation actions. This service does not re-enable workspace detachment.

Proposed starting behavior:

- Bottom-right placement on the selected display.
- Above ordinary application windows without taking keyboard focus.
- Agent avatar, project identity, short headline, and concise preview.
- Open, dismiss, and hover-to-pause.
- Short sound, volume preview, and mute.
- At most three visible cards with grouping for bursts.
- Approximately six seconds for an ordinary popup.
- Quiet hours and manual presentation/privacy mode.
- Suppression of sensitive previews when privacy rules require it.

Tasks:

- [ ] Route popups and sounds through the shared durable event model.
- [ ] Deduplicate replay/reconnect and multi-view events.
- [ ] Make Open deliberately activate the exact validated destination.
- [ ] Keep equivalent actions in the inbox.
- [ ] Handle taskbar work areas, scaling, monitor changes, and removed displays.
- [ ] Verify focus preservation and sound on the actual Windows candidate.
- [ ] Accept only validated, privacy-filtered event envelopes from private plug-ins. Host notification delivery must not expose private payloads to other plug-ins or bypass company authorization when Open is used.

Reference: [Electron window APIs](https://www.electronjs.org/docs/latest/api/browser-window).

## 13. Milestone J: Plug-in-owned visual interfaces and Company workspace

### 13.1. Personal visuals and private workstream boundaries

Begin personal visuals with architecture diagrams, dependency maps, system flows, and timelines in the personal visuals plug-in. Select the visual form to match the task's structure. Retain concise text for exact details and decisions.

The following private Company workstream integrates the supplied company plan. Gen supplies reusable workspace tabs, split panes, editor selectors, shared presentation and the protected plug-in bridge. The private Gen-Company plug-in supplies every company-specific visual, data adapter and management view. Maritime's existing control service/Store remains the single authority for company records, scheduling, budgets, approvals, machines and employee execution.

Use existing React/TypeScript, graph/generative UI primitives, private company clients/contracts, Python control service/Store, and supported desktop APIs. Do not add another dashboard framework, database, scheduler, or conversation store.

Preserve `DESIGN.md`, the accepted public/private separation plan, `docs/company/requirements.md`, and the owner's communication design in `2026-11-02-gen-company-communications.md`, especially sections 11, 13 and 17. These are supplied specification dependencies: resolve and read their accepted private paths before execution; this merge has not revalidated their contents. This visual workspace does not redesign the company communication protocol.

Workspace-bar implementation reference supplied by the company plan: [owner screenshot](</C:/Users/user/.t3/userdata/attachments/fac1a551-3566-425b-9f48-4d28f5784bfe-a15bcbfa-e762-48d5-9265-9a4f22c0ed67.png>). Open the original image at implementation time; the merge does not claim new visual acceptance.

The company map's pan/zoom is local to its pane. It does not turn the personal default workspace into a canvas. Reuse existing `RelationshipGraph`, `ArchitectureCanvas`, `WorkflowBoard`, and `TraceWaterfall` presentation where practical, while keeping company schema interpretation private. Generic primitive reuse is subject to the accepted API/export inventory.

### 13.2. Product direction

The owner should answer these questions mostly by looking:

- Who runs the company, and how are departments and employees connected?
- Who is actually working, waiting, asleep, unavailable, or asking for help?
- What project and task is each employee working on?
- What is happening on an employee's real desktop?
- Which tools and skills are installed across the company?
- Where did a rollout succeed, fail, or remain pending?

Use a visual company map, recognizable agent portraits, meaningful color, real screen content, task flow, and compact progress indicators. Text supports the visuals with short names, one-line explanations, and optional details. Avoid a page of paragraphs, raw receipts, protocol terminology, or a dashboard made primarily of metric cards.

This is a **multi-pane workspace**. The company map is its main view; screens, threads, settings and tools can occupy other panes at the same time.

### 13.3. Entry point and default layout

#### Workspace bar

Add **Company** beside the existing choices in the supplied screenshot:

```text
Workspace   All Agents   Code Review   Research   Company   Custom
```

- Register the entry through the installed private plug-in. An installation without that plug-in has no Company entry.
- Selecting it opens the company workspace inside the normal Gen application. Preserve the original sidebar, conversations, themes and settings.
- The existing All Agents view keeps its existing meaning. Company is the private business-wide view.
- The personal default Workspace does not become a company map or canvas.

#### Initial arrangement

The default Company layout uses three panes: a large company map, a selected-agent screen/activity pane, and a conversation/task pane. The map takes roughly two thirds of the available width; the two companion panes stack on the right. Respect usable minimum sizes instead of forcing these proportions on narrow screens.

```text
┌──────────────────────────────────────┬─────────────────────────┐
│ COMPANY MAP                          │ SELECTED AGENT           │
│                                      │ Real screen, or activity │
│              Manager                 │ for a headless workspace │
│                 │                    │                         │
│     Departments and agent groups     ├─────────────────────────┤
│                                      │ CONVERSATION / TASK      │
│     Who works where; live state      │ Manager, agent task,     │
│     Project and handoff overlays     │ or project discussion   │
└──────────────────────────────────────┴─────────────────────────┘
```

This wireframe describes placement, not live company state. Actual names, relationships, tasks and availability come from authorized records.

Other panes open through the same generic pane editor selector and split/join interactions being planned for Gen. Do not add a competing Add Window system. Keep a small Restore Company Layout action for recovering the default arrangement.

**Native detaching and OS-level floating windows remain deferred.** “Window” in this document means a pane inside Gen. Do not reintroduce removed detach controls.

### 13.4. Pane inventory

| Pane | Main visual | Useful actions |
|---|---|---|
| **Company map** | Manager, department groups, employee portraits and reporting lines; optional task/project overlays | Select, zoom, fit, filter, expand a department, focus a project |
| **Agent screen** | Real desktop image or authorized watch view; clear connection/freshness badge | Choose employee, pin selection, fit screen, open another screen pane |
| **Agent activity** | Actual current task stage, recent verified actions and resulting artifacts | Open the canonical task, evidence or result; used for Agent Boxes without a desktop |
| **Conversation** | Existing Gen conversation presentation for a company manager or permitted task/project thread | Read and draft; send only through currently authorized company capabilities |
| **Project work** | Existing task/dependency graph or workflow board with assigned employees | Inspect a task, handoff, blocker or result |
| **Company inbox** | The shared inbox presentation from section 11 of this roadmap, showing actual questions, reviews and owner decisions | Open the exact item; reading does not approve it |
| **Company settings** | Compact grouped controls, diagrams/previews where helpful, desired/applied state | Review and change allowed company settings through existing authority |
| **Global skills** | Skill cards and an employee coverage matrix | Inspect versions, choose targets, prepare a controlled install/update/remove rollout |
| **Agent plug-ins** | Extension cards, compatibility indicators and employee coverage | Inspect and manage supported employee-runtime extensions |
| **MCP tools** | Server/tool cards, permission summaries, connection indicators and coverage | Configure supported servers, provide protected secret references, test explicitly, prepare rollout |

Settings, Global skills, Agent plug-ins and MCP are real management views, not decorative screens. Deliver inspect-only states first when the corresponding execution adapter is unavailable; enable changes only when their actual control path exists.

Company agent plug-ins are distinct from plug-ins installed into the owner's Gen app. The company workspace does not silently install Gen extensions or change personal accounts.

### 13.5. Main company map

#### Structure and first-glance readability

- Read the canonical employee and department registry; render the manager at the top and department groups below.
- Use real reporting relationships. Project assignments are a separate overlay, not fabricated reporting lines.
- Show an employee's portrait/icon, short name, role and one small activity label. Keep machine/account IDs and runtime details in the inspector.
- At overview scale, show compact employee nodes and department headings. On zoom or selection, reveal task titles and useful detail. Do not put full logs or paragraphs into every node.
- Keep a stable layout as statuses change. An update must not randomly reposition the company or steal the owner's selection.
- Permit visual rearrangement without changing the actual organization. Reassignment is a separate authorized management action.
- Include Fit, zoom and a compact legend. Use the existing graph/canvas interaction primitives where appropriate.
- Filter by project, department, working, waiting, needs attention, screen available and setup incomplete. Filtering must not discard positions or pane state.

Use the existing graph/catalog mechanisms where practical: `RelationshipGraph`, `ArchitectureCanvas`, `WorkflowBoard`, and `TraceWaterfall` already exist. Extend/export reusable presentation only if needed; company-specific schemas and renderers stay private.

#### Color and icons

- Project color communicates identity and stays stable across the map, pane tabs, task cards and conversations. Consume the shared project-color preference from milestone E rather than inventing a second global color store.
- Use saturated, legible accents: blue, violet, cyan, orange, rose and green. Keep the main shell neutral and dark; avoid washed-out color panels.
- Use node badges and icons for state. Project color must never be the only indication of working/error state.
- Give employees distinct, stable portraits or role/provider icons. Use approved local/licensed assets. A model logo identifies a configured runtime/provider; it does not prove which model actually ran.
- A planned but unprovisioned employee has an outlined/hatched node and **Not set up**, not a green online avatar.

| Meaning | Visual treatment |
|---|---|
| Verified active task | Small green activity badge with a play/work icon |
| Waiting for a dependency or decision | Amber badge with the appropriate wait icon |
| Needs attention / failed step | Rose/red badge and an alert icon |
| Machine awake | Separate small power indicator |
| Machine asleep | Moon icon, muted treatment |
| Missing, stale or disconnected observation | Gray/hatching and an unknown/stale icon |

Color must have a matching icon/short label and sufficient contrast in both themes. Keep reduced-motion support. Brief handoff highlights may follow verified events; do not animate permanent “work” or model-thinking effects without evidence.

#### Relationships and work flow

Reporting lines are quiet by default. Selecting an employee or project highlights its real collaborators, current tasks and dependencies.

Communication overlays link existing canonical messages/tasks. Show a short direction/status label on selection, rather than drawing a permanent line for every message. A delivered message is not automatically read, admitted or completed. No animation may imply an employee understood a message merely because a transport accepted it.

### 13.6. Screens and employee workspaces

#### Preserve the actual machine assignments

Each employee has one assigned workspace containing its agent, tools and files.

- Linux desktop workspaces: **E08, E10, E12, E13, E16, E17, E27, E28 and E29**.
- Other employees, including **E01**, use Agent Boxes unless the canonical approved registry changes.
- Desktop employees can have a real screen pane when their machine and viewing capability are available.
- Headless Agent Boxes show the activity/task view. Do not fabricate a desktop, allocate a second machine, or use `get_computer` to create one merely because a screen pane was opened.
- Planned, sleeping, missing, denied and unavailable screens each have an honest visual state.

#### Screen interaction

- Clicking an employee updates unpinned companion panes. A pin keeps a pane watching that exact employee/project, allowing several different screens or conversations side by side.
- Pane headers show the employee portrait/name and source/freshness. Fit the image without distorting it; allow deliberate zoom for small UI details.
- Screens are watch-only in the initial release. Remote keyboard/mouse takeover is a separate future capability, not implied by opening a screen.
- Start with at most four active screen viewers. Reuse a shared subscription/session per resource instead of creating another connection for each copy of a pane.
- Closing/hiding a pane releases its observer resources. Stop viewer renewals when hidden or backgrounded. Do not create a permanent all-employee screenshot wall.

#### Provider integration and important limitations

Maritime documents a screenshot endpoint and short-lived, view-only signed watch links. Screenshots count as actions and keep a desktop session alive. Viewer links expire and can be revoked when a computer sleeps. Keep the API key on the trusted host. Source: [Maritime Linux desktop documentation](https://maritime.sh/docs/computers).

Accordingly:

1. The company map uses already-collected metadata; opening it makes no screenshot, exec, wake, create or model call.
2. Opening a screen is explicit. Verify its employee-to-resource binding and current viewing permission on the host.
3. Verify the provider's actual watch behavior and embedding restrictions before enabling an embedded live view. Do not assume a watch request is power-neutral.
4. Prefer an authorized watch-only session for an already-awake desktop. Do not silently wake a sleeping machine or extend paid activity.
5. If live embedding is unsupported, provide an explicitly requested current screenshot in the pane. Label it **Snapshot**, with its capture time; never call a snapshot a live stream.
6. The private plug-in's opaque frame currently cannot make arbitrary external network requests. Use a narrowly authorized host/viewer integration; do not relax its CSP or grant personal browser/account access to make a stream work.
7. Watch links are bearer capabilities. Keep them out of persisted layouts, conversations, exports, logs and telemetry. Only the protected viewer component may receive what is necessary to display the authorized session.
8. When access is revoked or a private-authentication state is reported, clear old image buffers and revoke the display session. Do not leave sensitive pixels visible beneath an overlay.

The initial product does not record screens. Credentials and private sign-in sessions do not enter ordinary screenshot history. If the runtime cannot reliably signal private/sensitive sessions, leave unattended capture disabled and explain the limitation.

### 13.7. Conversations, selection and pane behavior

- Keep Gen's normal conversation/composer/artifact presentation. Company messages use the company adapter, never personal `message.send` or a personal model fallback.
- Reuse canonical task threads, project rooms, addressed inboxes and decision records from the approved communication design. Do not create another company chat database.
- A pane's stable reference includes plug-in, company/project scope, employee or task identity, and view kind. Titles are display labels, not authority.
- By default, selecting a node follows into the unpinned Screen/Activity and Conversation panes. Pinned panes keep their own reference.
- Preserve unsent drafts when selection, layout or connectivity changes. A failed save blocks a destructive transition and offers retry.
- Split/join/resize through Gen's generic pane system. Joining retains the displaced view for recovery. Switching editor types does not delete the associated conversation or notes.
- Persist layout and visual preferences separately from business state. A layout record cannot assign an employee, grant access, approve work, or mark a task finished.
- On narrow screens, use the map as the primary view and an explicitly selected companion pane. Keep all information reachable without squeezing a desktop-width grid into a phone.

### 13.8. Company-wide skills, plug-ins and MCP management

#### Shared visual management pattern

Use the same pattern in Global skills, Agent plug-ins and MCP:

1. A compact catalog of capabilities with icons and useful descriptions.
2. A coverage matrix: departments/employees by capability, with installed version and observed state.
3. A focused detail view showing source, pinned version, supported runtimes, required access and actual health.
4. A target selector: one employee, department, approved project cohort, or all eligible employees.
5. A change preview and rollout progress view.

Show **Installed**, **Pending**, **Incompatible**, **Not set up**, **Failed**, **Unknown**, or **Needs access** per employee. An install request returning accepted is not proof that the tool is installed or usable.

#### Global skills

- Maintain a reviewed company skill catalog with versioned instructions and supporting assets.
- Distinguish company-wide skills from project-only skills and employee-learned/private skills.
- Do not automatically promote employee-learned material to the whole company or leak project-specific information across employees.
- Allow inspect, propose, install/update, disable/remove and rollback where the runtime actually supports them.
- Show the skill version actually loaded by each employee, independently of the desired version.

#### Agent plug-ins

- List supported runtime extensions and their compatible employee runtimes/workspace types.
- Preserve required runtime/model/authentication/security pins. Installing an extension cannot replace the mandated runtime, change billing route or grant administrative access.
- Do not present unsupported extension formats as universally installable. Show compatibility before applying a rollout.

#### MCP tools

- Show server identity, pinned package/version or approved endpoint, available tools, purpose and requested permissions.
- Configuration uses protected secret references. Secrets never appear in chat, generated diagrams, source bundles, layouts or per-agent status payloads.
- Test a connection only on explicit request and only within the chosen employee/company scope.
- A company-wide MCP definition is desired configuration. Each employee still needs a supported adapter, actual permission and verified installation.
- Remote MCP servers and tool results are untrusted content; they do not gain authority over budgets, approvals, unrelated projects or personal Gen resources.

#### Safe, real rollout behavior

- Use existing company approvals, WorkOrders/task execution, reservations, supervisor adapters and recovery records. Do not implement a new rollout scheduler.
- Preview exact source/version, scope, eligible target list, permission changes and expected operational effects before applying.
- Begin with one explicitly selected eligible employee. After its real installation and health check pass, advance through bounded batches of the remaining targets.
- Preserve current work. Wait for a safe checkpoint where required; do not force-restart employees or terminate tasks merely to apply a tool change.
- Sleeping employees wait for the next permitted maintenance opportunity. Do not wake the whole company automatically. Unprovisioned employees retain desired onboarding configuration and are not counted as installed.
- Preserve existing budgets, access and provider restrictions. A global configuration choice does not create machines, subscriptions, paid fallbacks or new credentials.
- Record desired, attempted, applied and independently verified versions separately. Partial failure remains visible and recoverable with the same operation identity; do not blindly replay uncertain installs.
- Removing a capability must not erase its historical outputs or orphan an active task.

“Apply to all” means all explicitly scoped eligible targets, with honest per-target results. It never means bypassing compatibility or access checks.

### 13.9. Company settings

Use compact, grouped settings with short labels, right-aligned controls and preview states. Default sections:

- Company identity and organization.
- Employee profiles and assigned workspace.
- Approved runtime/model configuration.
- Tools and shared skills.
- Project access and permissions.
- Observability/privacy and screen viewing.
- Notifications and owner attention.
- Budgets and rollout limits.

Show current versus proposed values where a change is pending. Apply through existing trusted company controls. General Gen appearance settings stay in Gen; company configuration stays in the private company system.

Keep technical commands, raw configurations, provider identifiers and evidence behind Details. Information required to understand an approval, charge or access change remains visible before the action.

### 13.10. Data, freshness and authority

#### Reuse actual sources

| Information | Authority / required producer |
|---|---|
| Organization and planned workspace assignments | Canonical company employee/department configuration |
| Provisioned machine and observed power state | Owned-resource binding and trusted provider observation |
| Actual working/waiting/task state | Current scheduler/task/attempt records and trusted supervisor observations |
| Conversations and owner decisions | Existing scoped communication and decision records |
| Screens and viewer availability | Authorized provider desktop adapter for the exact assigned resource |
| Tool/skill desired configuration and rollout | Existing company settings and scoped change records |
| Applied tool state | Employee supervisor/runtime observation, with version and freshness |
| Layout, colors, selected nodes and pins | UI preferences only; no business authority |

The existing company views include deliberately non-live/synthetic observations. They cannot by themselves establish an employee's current machine or execution state. Add the smallest typed observation/read projection needed through the existing control service; do not change an evidence label to pretend a live producer exists.

#### Keep independent states independent

An employee node must separately represent:

- Planned/provisioned/ready setup state.
- Observed machine power state.
- Actual task execution state.
- Connection/freshness state.
- Screen capability/availability.

Awake does not mean working. Connected does not mean authenticated. Installed does not mean permitted or healthy. A model statement is not supervisor or provider evidence.

Use source timestamps, expiry and current resource generation. Reject out-of-order or wrong-scope updates. Missing expiry/provenance must produce Unknown, not a freshly green node.

Use existing trusted event/SSE infrastructure when available. Otherwise, permit one bounded, batched metadata refresh every 15 seconds while the workspace is visible, backing off on failures and stopping while hidden. Do not poll every employee with a model, command or screenshot. Never refresh a timestamp merely because a cached record was received again.

#### Transport and privacy

All company requests pass through the installed plug-in's protected host operations and scoped company service. Validate exact company/project/employee/resource references on each request. The browser does not receive control keys or query the company database directly.

No new service, shared database or authority layer is introduced. Screen/session transport is a narrow capability of the existing host/control integration, not an OAuth relay or unrestricted browser bridge.

### 13.11. Public API and private source ownership

#### Public harness owns generic presentation only

Extend `PluginRegistration` additively with an optional generic workspace contribution list. Each contribution identifies a workspace id, title, icon, entry view and default layout reference. Gen's workspace picker consumes registered contributions; do not hardcode Maritime or Company into the public workspace array.

Register reusable pane/view contributions and opaque plug-in context references through the existing API. Keep the optional extension backward compatible and capability-detected; use the compatible Gen version containing this extension.

The public harness may own generic split panes, editor selectors, graph primitives, protected viewer hosts and presentation components. Company structure, schemas, status interpretation, management commands and rollout logic stay private.

#### Private company implementation

Use a focused feature directory rather than expanding the old rejected Company shell:

```text
Gen-Company/
  plugin/src/workspaces/company/
    registration.ts
    CompanyWorkspace.tsx
    CompanyMap.tsx
    AgentScreenPane.tsx
    AgentThreadPane.tsx
    CompanySettingsPane.tsx
    GlobalSkillsPane.tsx
    AgentPluginsPane.tsx
    McpToolsPane.tsx
    RolloutPreview.tsx
    contracts.ts
    projection.ts
    workspace.css
  control/src/company/
    visual_workspace.py       # scoped read projection, existing Store
    configuration_rollout.py  # existing execution/approval path adaptation
```

The proposed new paths are ownership boundaries. Reuse an existing module instead where it already implements that responsibility; do not duplicate an equivalent service or store.

Company-specific generative renderers register in the private plug-in. Generic `ArchitectureCanvas` or `WorkflowBoard` primitives may be shared, but do not ship a company's employee data, management instructions or private templates in public Gen.

### 13.12. Implementation tasks and handoffs

#### Task 1 — Workspace contribution and pane shell

**Owners:** Gen UI owner for the generic workspace/pane API; private plug-in owner for registration and layout.

- [ ] First add a failing registration test: Company appears exactly once with the plug-in installed, disappears on removal, and never changes the built-in personal presets.
- [ ] Implement the optional generic workspace contribution and private default layout.
- [ ] Register company-map, agent-screen/activity, conversation, settings, skills, plug-ins and MCP view kinds. Reuse the shared inbox/project views instead of creating their own data systems.
- [ ] Verify narrow layout, pane switching and layout restore. Current profiles and personal chats must remain intact.

**Deliverable:** selectable Company workspace and reusable pane arrangement, without real-world side effects.

#### Task 2 — Visual map with truthful read models

**Owners:** private plug-in UI and existing company backend owner; agree exact files first.

- [ ] Write projection tests for planned-only employees, awake-but-idle, actual working, blocked, stale, missing, mixed-project and out-of-order observations.
- [ ] Implement the scoped control read projection and private graph adapter using existing identities and records.
- [ ] Build the company map, department groups, portraits, project colors, filters and selection/pin behavior.
- [ ] Validate it against a labeled mixed-state fixture and then authorized real records. Opening the overview must cause zero model calls, zero machine creation/wake/exec and zero screenshots.

**Deliverable:** a useful visual company overview, honest even while much of the company is not set up.

#### Task 3 — Real screen and activity panes

**Owners:** Maritime adapter owner for authorized viewing; Gen UI owner for any generic protected viewer support; private plug-in owner for company UI.

- [ ] Write tests for a headless employee, sleeping/missing desktop, denied scope, expired viewer, stale image, revoked access, hidden pane and multiple panes bound to the same resource.
- [ ] Verify one actual supported viewer/snapshot integration without exposing a provider credential or weakening plug-in isolation.
- [ ] Implement watch-only screens, snapshot labeling, fit/zoom, safe selection, pinning and observer cleanup.
- [ ] Test on one permitted real Linux desktop when available; do not provision or fund one just for this plan. If absent, keep that live acceptance gate explicit rather than pretending fixture pixels are an employee screen.

**Deliverable:** real authorized employee screens where supported, useful activity views elsewhere.

#### Task 4 — Conversation, context and multi-pane recovery

**Owner:** private UI owner through existing conversation and pane contracts.

- [ ] Add failing tests for selecting another employee with an unsaved draft, pinned versus following panes, reconnect, denied access and close/reopen recovery.
- [ ] Connect canonical company threads and task/evidence views; preserve current messaging availability and authority.
- [ ] Verify at least two different employee panes plus a manager conversation can coexist without identity, draft or screen-session crossover.

**Deliverable:** the map, screens and conversations work together without becoming another chat application.

#### Task 5 — Skills, plug-ins, MCP and settings management

**Owners:** private UI for management views; company control/runtime owners for adapters and authorized changes.

- [ ] Begin with read-only catalog, compatibility and installed-versus-desired coverage tests.
- [ ] Add change preview, target selection and existing approval/execution integration.
- [ ] Test one real supported canary change before enabling a broader rollout. Verify the actual loaded version/tool response, not just a successful upload or accepted request.
- [ ] Test partial failure, incompatible runtimes, sleeping targets, unavailable secret references, uncertain results, safe rollback and restart during a rollout.
- [ ] Preserve active tasks and current budgets. Send exact ready contracts and adapter prerequisites directly between owners.

**Deliverable:** useful administration panes followed by demonstrated per-employee management; unavailable execution remains visibly unavailable until its producer is ready.

#### Task 6 — Combined visual/native acceptance

- [ ] Run focused UI/projection/runtime tests for changed behavior; retain failed attempts and fixes.
- [ ] Build public Gen without the private package and verify no company implementation/data is included.
- [ ] Build/install the private plug-in against that public API and coordinate one combined native check with the existing app owner.
- [ ] Verify current data, pane/draft recovery, privacy, observer cleanup and a real authorized screen.
- [ ] Demonstrate one real management change and accurate per-target results before claiming global management works.

**Deliverable:** an owner-usable Company workspace, with separately stated map, screen and management acceptance.

### 13.13. Review focus and acceptance checklist

#### Highest-risk cases

1. **Stale/out-of-order observations:** a dead connection or old task must not leave an employee visibly working.
2. **Passive observation side effects:** opening, restoring or hiding the workspace must not create/wake machines or keep the whole fleet awake.
3. **Wrong-scope or private screen content:** changing employee/project, revoking access or entering a private session clears inappropriate content and session handles.
4. **Pane identity and recovery:** split/join, selection and reload must not move a draft or screen into another employee's context.
5. **Partial global rollout:** preserve actual per-employee versions and uncertain results; accepted or partially applied changes must never become “installed everywhere.”

#### Visual acceptance

- A first-time viewer can find the manager, departments, working employees, sleeping machines and attention items within a few seconds.
- The main surface is predominantly diagram, portraits, state markers and real screens. Text remains concise and contextual.
- Colors consistently identify projects and state; icons/labels preserve meaning without color.
- Company map, multiple screens, conversations, Settings, Global skills, Agent plug-ins and MCP can use separate panes.
- Dark/light themes, keyboard selection, visible focus, reduced motion and small screens remain usable.
- Existing personal Gen workflows and the owner's original design remain intact.

#### Live and management acceptance

- A planned roster is visibly distinguished from provisioned/admitted employees.
- Actual power and actual task execution are separately supported by trusted current observations.
- Screen/session access is read-only, resource-bound, time-limited and cleaned up on access loss.
- Headless employees never receive an invented desktop or second workspace.
- The overview makes no model or machine-action calls.
- A real skill/plug-in/MCP canary operation reaches a verifiable applied state through existing controls before Apply all becomes operational.
- No private company code/data or credential enters the public harness package or history.

### 13.14. Dependencies, defaults and completion reporting

- **Start after repository separation:** consume accepted public/private baselines; do not hold up the current separation with this new feature.
- **Shared pane foundation:** coordinate with the shared Blender-style split-pane foundation in milestones B-D. Build a Company workspace contribution; do not implement a second competing layout engine.
- **First operational delivery:** visual map plus authorized records. Screens and global management advance as real viewing/runtime adapters become available.
- **Default privacy:** watch-only screens, no recordings, no silent wake/create, no remote control, protected secret references.
- **Default rollout:** one explicitly selected eligible canary, then bounded approved batches; keep per-target truth.
- **No automatic provisioning:** this document grants no new machine allocation, subscriptions, spend, permission expansion or employee login attempt.
- **No repeated gate inspections:** blocked live tasks wait for their actual producer; do not substitute endless fixture reruns for screen or employee execution proof.

Report completion separately as **map/UI working**, **live observations working**, **real screens working**, and **real management rollout working**. A completed UI checkpoint is not proof the entire company is operational.

## 14. Proposed file ownership

All paths must be reconfirmed after the repository handoff. New module names below are proposed responsibilities, not existing implementation claims.

| Workstream | Main source areas |
|---|---|
| Layout contracts/persistence | `packages/contracts/workspace.ts` or a focused sibling; new `packages/core/split-workspace.ts`; workspace host/routes |
| Split renderer | New `WorkspaceSplitLayout.tsx`, `WorkspacePane.tsx`, `WorkspaceSurfaceRegistry.tsx`, and `workspace-drag.ts` |
| Existing thread placement | `ShellSidebar.tsx` |
| Pane body reuse | `WorkspaceSurfaceBody.tsx`; narrow `App.tsx` integration |
| Browser lifecycle | `DesktopBrowser.tsx`, desktop contracts, trusted desktop owner |
| Appearance/Settings | Preferences contracts, focused Settings components, theme/background handling |
| Credentials/environment | New protected host service, validated contracts, runtime environment adapters |
| Inbox/notifications | Shared event projection/store, scoped vendored presentation, desktop notification controller |
| Personal visuals | Personal visuals package; architecture/system/dependency/timeline renderers |
| Private Company workspace | Accepted private repository's `plugin/src/workspaces/company/` registration, map, employee panes, company settings, catalogs, coverage and rollout previews; exact proposed tree in section 13 |
| Private observations and management | Existing company control owner; focused `visual_workspace.py` read projection and `configuration_rollout.py` adaptation only where equivalent modules do not already exist |
| Generic contribution/viewer support | Public plug-in contract, workspace selector and narrow protected viewer host; no private schemas or business commands |

One owner should control shared contracts and narrow App integration at each coherent boundary. Parallel workers should have explicit, nonoverlapping file ownership. The public UI owner applies generic API/viewer seams; the private UI owner owns Company registration and presentation; the existing company backend/runtime owner owns projections and authorized rollout/viewing adapters. Agree exact changed files and interfaces before writes, and hand back shared App ownership explicitly. Proposed private paths are not permission to revive the removed public Company shell.

## 15. Delivery order and verification

Recommended order:

1. Accepted repository separation and compatibility handoff.
2. Layout identities, surface registry, transactions, migration, and recovery.
3. Split/join/drag interactions, active ownership, and browser lifecycle.
4. Appearance, Settings, and credential/environment capability.
5. Durable shared events.
6. Vespin inbox and custom notification popups.
7. Personal visual interfaces and private Company registration/map backed by truthful canonical read projections.
8. Canonical company conversations, pin/follow behavior, and multi-pane recovery.
9. Authorized watch-only screen/activity integration when real viewing adapters are available.
10. Inspect-only company settings/skills/employee plug-ins/MCP catalogs and coverage, followed by one real permitted canary and bounded management rollout through existing controls.
11. Combined source, browser, native, and visual acceptance, with separate company capability receipts.

After shared contracts settle, layout, appearance/Settings, and event infrastructure can proceed in parallel under separate file owners. Inbox/popups depend on events. Private map projections, catalog inspection, and presentation may proceed independently of a blocked live-screen or management adapter after the shared pane/contribution contract is ready. Live company screens depend on real authorized observations; management depends on actual approvals/runtime adapters and a verified canary. Do not delay separation or substitute repeated fixture runs for a missing producer.

Acceptance checklist:

- [ ] Reproduce the recording's below, side-by-side, and full-height-left arrangements with distinct existing threads.
- [ ] Retain editor/iframe identity and drafts during pane rearrangement.
- [ ] Join a pane with unsaved input without losing it.
- [ ] Reject failed flushes and stale layout operations without partial mutations or retargeting.
- [ ] Cancel gestures without persistent layout changes.
- [ ] Undo layout changes without undoing task work.
- [ ] Restore pane structure, tabs, parked views, bindings, and drafts after restart.
- [ ] Restore desktop layout after narrow-window mode.
- [ ] Keep browser identity correct and preserve occlusion protection.
- [ ] Keep protected Context/Usage tools recoverable and ready-plan opening focus-safe.
- [ ] Preserve secret confidentiality and account/runtime binding.
- [ ] Match pinned Vespin composition and interactions.
- [ ] Verify inbox read state, stale requests, deduplication, and private scope.
- [ ] Verify popup focus, sound, privacy, scaling, and monitor placement on Windows.
- [ ] Demonstrate visual-first comprehension with sourced data and explicit stale/unknown states.
- [ ] Exercise bounded fixtures such as 100 agents and 1,000 inbox items, then measure performance on the accepted target machine.
- [ ] Separate source/unit/browser evidence from actual native, live-runtime, screen-feed, and user visual acceptance.
- [ ] Show Company exactly once only while the private plug-in is installed, preserving all built-in personal presets.
- [ ] Verify planned/provisioned/setup, machine power, task execution, observation freshness, and screen availability remain independent and scope-correct.
- [ ] Open the Company overview with zero model calls, screenshots, machine creation, wake, or exec.
- [ ] Test pinned/following employee panes plus a manager conversation without draft, screen-session, or account crossover.
- [ ] Verify real screen permission, expiry, revocation, hidden/background cleanup, headless activity fallback, and clearing of sensitive pixels/capabilities.
- [ ] Prove the one supported management canary and per-target applied/verified versions before enabling a wider rollout; retain partial/uncertain states and existing budgets.
- [ ] Build public Gen without private company implementation, templates, assignments, credentials, or this combined private roadmap.
- [ ] Report Company acceptance separately as map/UI working, live observations working, real screens working, and real management rollout working.

Each milestone should deliver its changed paths, focused checks, review results, migration/recovery behavior, and remaining acceptance limits. Keep layout rollout reversible until migration, recovery, and native-browser checks pass.

## 16. Later additions and deferred scope

Useful later additions:

- Visual history/replay that is clearly distinguished from current activity.
- Multiple independent browsers after scoped browser routing exists.
- Richer layout/theme import/export that excludes credentials and preserves missing-resource placeholders.
- Larger-map clustering and measured screen-preview performance improvements.
- Additional company management adapters only after each runtime's real compatibility, authorization, health check, and recovery behavior is demonstrated.

Remain deferred or outside this plan:

- Detaching and floating workspace windows.
- Screen remote control/input injection.
- New autonomous business or publication authority.
- Arbitrary plug-in access to personal accounts or data.
- Unrelated cloud/collaboration expansion.
- Automatic employee provisioning, company-wide wake/restart, new subscriptions/spend, or new employee login attempts merely to complete this UI plan.
- Remote screen control or unattended screen capture/recording when private-session handling is unavailable.
- A replacement company chat protocol, business database, rollout scheduler, or personal-model fallback.

## 17. Research and implementation limits

This document consolidates the read-only plan, recording analysis, detailed architecture review, product gap review, and the supplied private Company visual-workspace plan. The merge edits only this Markdown document. It does not implement features, revisit the integration owner's source, prove native behavior, or assert that repository separation is accepted.

The company attachment's provider notes, roster assignments, proposed APIs and module inventory are retained as supplied planning constraints. No live provider call, machine inspection, screenshot capture, credential change, management rollout, or current private-source audit was performed for this merge. Revalidate supported viewer behavior, embedding restrictions, action/power effects, canonical assignments, and accepted source paths at the corresponding implementation gate.

The custom popup, secret provider, durable inbox events, split layout, and live screen/activity projections are planned capabilities. Existing generic pane bodies, journal recovery, revision checks, scoped bindings, and plug-in isolation should be reused.

Primary references:

- [Blender area splitting, joining, and editor areas](https://docs.blender.org/manual/en/5.2/interface/window_system/areas.html)
- [W3C window-splitter interaction and accessibility](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
- [Pinned Vespin source](https://github.com/ReviewStage/vespin/tree/7f0bfe954a958858235b91d82293043ab5541433)
- [Vespin license](https://github.com/ReviewStage/vespin/blob/7f0bfe954a958858235b91d82293043ab5541433/LICENSE)
- [Vespin notices](https://github.com/ReviewStage/vespin/blob/7f0bfe954a958858235b91d82293043ab5541433/NOTICE)
- [Electron window controls](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron display/work-area APIs](https://www.electronjs.org/docs/latest/api/screen)
- [Electron protected local storage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Maritime Linux desktop documentation supplied by the company plan](https://maritime.sh/docs/computers) — provider constraints to verify at implementation, not new live evidence from this merge.
