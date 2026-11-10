# Maritime Company Visual Workspace — Implementation Plan

> **For the UI implementation thread:** This is a planning handoff, not an instruction to interrupt the current repository separation. Start product changes after the public harness and private company plug-in have accepted separate baselines. Use `superpowers:executing-plans` task by task, with the existing owners and one writer per shared file. No new thread is required.

**Goal:** Add a private **Company** workspace to Gen where the owner can understand the company at a glance: its structure, who is working, which machines are awake, real agent screens, conversations, and company-wide tools and settings.

**Architecture:** Gen supplies reusable workspace tabs, split panes, view selectors, shared presentation and the protected plug-in bridge. The private Gen-Company plug-in supplies every company-specific visual, data adapter and management view. The existing Maritime control service remains the single authority for company records, scheduling, budgets, approvals, machines and employee execution.

**Tech stack:** Existing React/TypeScript, Gen plug-in API and pane/layout system, existing graph and generative UI components, private company clients/contracts, existing Python control service/Store, and supported Maritime desktop APIs. Reuse current libraries; do not introduce another dashboard framework, database or scheduler.

**Specification:** The owner's workspace-bar screenshot and two requests in this conversation are the product direction. Preserve `DESIGN.md`, the approved public/private separation plan, `docs/company/requirements.md`, and the owner's communication design in `2026-11-02-gen-company-communications.md`, especially sections 11, 13 and 17. The visual design below specifies this requested workspace; it does not redesign the company's communication protocol.

**Workspace-bar reference:** [Owner screenshot](</C:/Users/user/.t3/userdata/attachments/fac1a551-3566-425b-9f48-4d28f5784bfe-a15bcbfa-e762-48d5-9265-9a4f22c0ed67.png>). The UI thread should open this original image when implementing the entry point.

**Document status:** Future implementation plan only. No company code, live configuration, installed package, machine, credential, or budget has been changed for this document. Keep this company-specific plan private during public export; its permanent home is the private Gen-Company repository.

## 1. Product direction

The owner should answer these questions mostly by looking:

- Who runs the company, and how are departments and employees connected?
- Who is actually working, waiting, asleep, unavailable, or asking for help?
- What project and task is each employee working on?
- What is happening on an employee's real desktop?
- Which tools and skills are installed across the company?
- Where did a rollout succeed, fail, or remain pending?

Use a visual company map, recognizable agent portraits, meaningful color, real screen content, task flow, and compact progress indicators. Text supports the visuals with short names, one-line explanations, and optional details. Avoid a page of paragraphs, raw receipts, protocol terminology, or a dashboard made primarily of metric cards.

This is a **multi-pane workspace**. The company map is its main view; screens, threads, settings and tools can occupy other panes at the same time.

## 2. Entry point and default layout

### Workspace bar

Add **Company** beside the existing choices in the supplied screenshot:

```text
Workspace   All Agents   Code Review   Research   Company   Custom
```

- Register the entry through the installed private plug-in. An installation without that plug-in has no Company entry.
- Selecting it opens the company workspace inside the normal Gen application. Preserve the original sidebar, conversations, themes and settings.
- The existing All Agents view keeps its existing meaning. Company is the private business-wide view.
- The personal default Workspace does not become a company map or canvas.

### Initial arrangement

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

## 3. Pane inventory

| Pane | Main visual | Useful actions |
|---|---|---|
| **Company map** | Manager, department groups, employee portraits and reporting lines; optional task/project overlays | Select, zoom, fit, filter, expand a department, focus a project |
| **Agent screen** | Real desktop image or authorized watch view; clear connection/freshness badge | Choose employee, pin selection, fit screen, open another screen pane |
| **Agent activity** | Actual current task stage, recent verified actions and resulting artifacts | Open the canonical task, evidence or result; used for Agent Boxes without a desktop |
| **Conversation** | Existing Gen conversation presentation for a company manager or permitted task/project thread | Read and draft; send only through currently authorized company capabilities |
| **Project work** | Existing task/dependency graph or workflow board with assigned employees | Inspect a task, handoff, blocker or result |
| **Company inbox** | The shared inbox presentation from the UI follow-up plan, showing actual questions, reviews and owner decisions | Open the exact item; reading does not approve it |
| **Company settings** | Compact grouped controls, diagrams/previews where helpful, desired/applied state | Review and change allowed company settings through existing authority |
| **Global skills** | Skill cards and an employee coverage matrix | Inspect versions, choose targets, prepare a controlled install/update/remove rollout |
| **Agent plug-ins** | Extension cards, compatibility indicators and employee coverage | Inspect and manage supported employee-runtime extensions |
| **MCP tools** | Server/tool cards, permission summaries, connection indicators and coverage | Configure supported servers, provide protected secret references, test explicitly, prepare rollout |

Settings, Global skills, Agent plug-ins and MCP are real management views, not decorative screens. Deliver inspect-only states first when the corresponding execution adapter is unavailable; enable changes only when their actual control path exists.

Company agent plug-ins are distinct from plug-ins installed into the owner's Gen app. The company workspace does not silently install Gen extensions or change personal accounts.

## 4. Main company map

### Structure and first-glance readability

- Read the canonical employee and department registry; render the manager at the top and department groups below.
- Use real reporting relationships. Project assignments are a separate overlay, not fabricated reporting lines.
- Show an employee's portrait/icon, short name, role and one small activity label. Keep machine/account IDs and runtime details in the inspector.
- At overview scale, show compact employee nodes and department headings. On zoom or selection, reveal task titles and useful detail. Do not put full logs or paragraphs into every node.
- Keep a stable layout as statuses change. An update must not randomly reposition the company or steal the owner's selection.
- Permit visual rearrangement without changing the actual organization. Reassignment is a separate authorized management action.
- Include Fit, zoom and a compact legend. Use the existing graph/canvas interaction primitives where appropriate.
- Filter by project, department, working, waiting, needs attention, screen available and setup incomplete. Filtering must not discard positions or pane state.

Use the existing graph/catalog mechanisms where practical: `RelationshipGraph`, `ArchitectureCanvas`, `WorkflowBoard`, and `TraceWaterfall` already exist. Extend/export reusable presentation only if needed; company-specific schemas and renderers stay private.

### Color and icons

- Project color communicates identity and stays stable across the map, pane tabs, task cards and conversations. Consume the shared project-color preference from the UI follow-up work rather than inventing a second global color store.
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

### Relationships and work flow

Reporting lines are quiet by default. Selecting an employee or project highlights its real collaborators, current tasks and dependencies.

Communication overlays link existing canonical messages/tasks. Show a short direction/status label on selection, rather than drawing a permanent line for every message. A delivered message is not automatically read, admitted or completed. No animation may imply an employee understood a message merely because a transport accepted it.

## 5. Screens and employee workspaces

### Preserve the actual machine assignments

Each employee has one assigned workspace containing its agent, tools and files.

- Linux desktop workspaces: **E08, E10, E12, E13, E16, E17, E27, E28 and E29**.
- Other employees, including **E01**, use Agent Boxes unless the canonical approved registry changes.
- Desktop employees can have a real screen pane when their machine and viewing capability are available.
- Headless Agent Boxes show the activity/task view. Do not fabricate a desktop, allocate a second machine, or use `get_computer` to create one merely because a screen pane was opened.
- Planned, sleeping, missing, denied and unavailable screens each have an honest visual state.

### Screen interaction

- Clicking an employee updates unpinned companion panes. A pin keeps a pane watching that exact employee/project, allowing several different screens or conversations side by side.
- Pane headers show the employee portrait/name and source/freshness. Fit the image without distorting it; allow deliberate zoom for small UI details.
- Screens are watch-only in the initial release. Remote keyboard/mouse takeover is a separate future capability, not implied by opening a screen.
- Start with at most four active screen viewers. Reuse a shared subscription/session per resource instead of creating another connection for each copy of a pane.
- Closing/hiding a pane releases its observer resources. Stop viewer renewals when hidden or backgrounded. Do not create a permanent all-employee screenshot wall.

### Provider integration and important limitations

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

## 6. Conversations, selection and pane behavior

- Keep Gen's normal conversation/composer/artifact presentation. Company messages use the company adapter, never personal `message.send` or a personal model fallback.
- Reuse canonical task threads, project rooms, addressed inboxes and decision records from the approved communication design. Do not create another company chat database.
- A pane's stable reference includes plug-in, company/project scope, employee or task identity, and view kind. Titles are display labels, not authority.
- By default, selecting a node follows into the unpinned Screen/Activity and Conversation panes. Pinned panes keep their own reference.
- Preserve unsent drafts when selection, layout or connectivity changes. A failed save blocks a destructive transition and offers retry.
- Split/join/resize through Gen's generic pane system. Joining retains the displaced view for recovery. Switching editor types does not delete the associated conversation or notes.
- Persist layout and visual preferences separately from business state. A layout record cannot assign an employee, grant access, approve work, or mark a task finished.
- On narrow screens, use the map as the primary view and an explicitly selected companion pane. Keep all information reachable without squeezing a desktop-width grid into a phone.

## 7. Company-wide skills, plug-ins and MCP management

### Shared visual management pattern

Use the same pattern in Global skills, Agent plug-ins and MCP:

1. A compact catalog of capabilities with icons and useful descriptions.
2. A coverage matrix: departments/employees by capability, with installed version and observed state.
3. A focused detail view showing source, pinned version, supported runtimes, required access and actual health.
4. A target selector: one employee, department, approved project cohort, or all eligible employees.
5. A change preview and rollout progress view.

Show **Installed**, **Pending**, **Incompatible**, **Not set up**, **Failed**, **Unknown**, or **Needs access** per employee. An install request returning accepted is not proof that the tool is installed or usable.

### Global skills

- Maintain a reviewed company skill catalog with versioned instructions and supporting assets.
- Distinguish company-wide skills from project-only skills and employee-learned/private skills.
- Do not automatically promote employee-learned material to the whole company or leak project-specific information across employees.
- Allow inspect, propose, install/update, disable/remove and rollback where the runtime actually supports them.
- Show the skill version actually loaded by each employee, independently of the desired version.

### Agent plug-ins

- List supported runtime extensions and their compatible employee runtimes/workspace types.
- Preserve required runtime/model/authentication/security pins. Installing an extension cannot replace the mandated runtime, change billing route or grant administrative access.
- Do not present unsupported extension formats as universally installable. Show compatibility before applying a rollout.

### MCP tools

- Show server identity, pinned package/version or approved endpoint, available tools, purpose and requested permissions.
- Configuration uses protected secret references. Secrets never appear in chat, generated diagrams, source bundles, layouts or per-agent status payloads.
- Test a connection only on explicit request and only within the chosen employee/company scope.
- A company-wide MCP definition is desired configuration. Each employee still needs a supported adapter, actual permission and verified installation.
- Remote MCP servers and tool results are untrusted content; they do not gain authority over budgets, approvals, unrelated projects or personal Gen resources.

### Safe, real rollout behavior

- Use existing company approvals, WorkOrders/task execution, reservations, supervisor adapters and recovery records. Do not implement a new rollout scheduler.
- Preview exact source/version, scope, eligible target list, permission changes and expected operational effects before applying.
- Begin with one explicitly selected eligible employee. After its real installation and health check pass, advance through bounded batches of the remaining targets.
- Preserve current work. Wait for a safe checkpoint where required; do not force-restart employees or terminate tasks merely to apply a tool change.
- Sleeping employees wait for the next permitted maintenance opportunity. Do not wake the whole company automatically. Unprovisioned employees retain desired onboarding configuration and are not counted as installed.
- Preserve existing budgets, access and provider restrictions. A global configuration choice does not create machines, subscriptions, paid fallbacks or new credentials.
- Record desired, attempted, applied and independently verified versions separately. Partial failure remains visible and recoverable with the same operation identity; do not blindly replay uncertain installs.
- Removing a capability must not erase its historical outputs or orphan an active task.

“Apply to all” means all explicitly scoped eligible targets, with honest per-target results. It never means bypassing compatibility or access checks.

## 8. Company settings

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

## 9. Data, freshness and authority

### Reuse actual sources

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

### Keep independent states independent

An employee node must separately represent:

- Planned/provisioned/ready setup state.
- Observed machine power state.
- Actual task execution state.
- Connection/freshness state.
- Screen capability/availability.

Awake does not mean working. Connected does not mean authenticated. Installed does not mean permitted or healthy. A model statement is not supervisor or provider evidence.

Use source timestamps, expiry and current resource generation. Reject out-of-order or wrong-scope updates. Missing expiry/provenance must produce Unknown, not a freshly green node.

Use existing trusted event/SSE infrastructure when available. Otherwise, permit one bounded, batched metadata refresh every 15 seconds while the workspace is visible, backing off on failures and stopping while hidden. Do not poll every employee with a model, command or screenshot. Never refresh a timestamp merely because a cached record was received again.

### Transport and privacy

All company requests pass through the installed plug-in's protected host operations and scoped company service. Validate exact company/project/employee/resource references on each request. The browser does not receive control keys or query the company database directly.

No new service, shared database or authority layer is introduced. Screen/session transport is a narrow capability of the existing host/control integration, not an OAuth relay or unrestricted browser bridge.

## 10. Public API and private source ownership

### Public harness owns generic presentation only

Extend `PluginRegistration` additively with an optional generic workspace contribution list. Each contribution identifies a workspace id, title, icon, entry view and default layout reference. Gen's workspace picker consumes registered contributions; do not hardcode Maritime or Company into the public workspace array.

Register reusable pane/view contributions and opaque plug-in context references through the existing API. Keep the optional extension backward compatible and capability-detected; use the compatible Gen version containing this extension.

The public harness may own generic split panes, editor selectors, graph primitives, protected viewer hosts and presentation components. Company structure, schemas, status interpretation, management commands and rollout logic stay private.

### Private company implementation

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

## 11. Implementation tasks and handoffs

### Task 1 — Workspace contribution and pane shell

**Owners:** Gen UI owner for the generic workspace/pane API; private plug-in owner for registration and layout.

- [ ] First add a failing registration test: Company appears exactly once with the plug-in installed, disappears on removal, and never changes the built-in personal presets.
- [ ] Implement the optional generic workspace contribution and private default layout.
- [ ] Register company-map, agent-screen/activity, conversation, settings, skills, plug-ins and MCP view kinds. Reuse the shared inbox/project views instead of creating their own data systems.
- [ ] Verify narrow layout, pane switching and layout restore. Current profiles and personal chats must remain intact.

**Deliverable:** selectable Company workspace and reusable pane arrangement, without real-world side effects.

### Task 2 — Visual map with truthful read models

**Owners:** private plug-in UI and existing company backend owner; agree exact files first.

- [ ] Write projection tests for planned-only employees, awake-but-idle, actual working, blocked, stale, missing, mixed-project and out-of-order observations.
- [ ] Implement the scoped control read projection and private graph adapter using existing identities and records.
- [ ] Build the company map, department groups, portraits, project colors, filters and selection/pin behavior.
- [ ] Validate it against a labeled mixed-state fixture and then authorized real records. Opening the overview must cause zero model calls, zero machine creation/wake/exec and zero screenshots.

**Deliverable:** a useful visual company overview, honest even while much of the company is not set up.

### Task 3 — Real screen and activity panes

**Owners:** Maritime adapter owner for authorized viewing; Gen UI owner for any generic protected viewer support; private plug-in owner for company UI.

- [ ] Write tests for a headless employee, sleeping/missing desktop, denied scope, expired viewer, stale image, revoked access, hidden pane and multiple panes bound to the same resource.
- [ ] Verify one actual supported viewer/snapshot integration without exposing a provider credential or weakening plug-in isolation.
- [ ] Implement watch-only screens, snapshot labeling, fit/zoom, safe selection, pinning and observer cleanup.
- [ ] Test on one permitted real Linux desktop when available; do not provision or fund one just for this plan. If absent, keep that live acceptance gate explicit rather than pretending fixture pixels are an employee screen.

**Deliverable:** real authorized employee screens where supported, useful activity views elsewhere.

### Task 4 — Conversation, context and multi-pane recovery

**Owner:** private UI owner through existing conversation and pane contracts.

- [ ] Add failing tests for selecting another employee with an unsaved draft, pinned versus following panes, reconnect, denied access and close/reopen recovery.
- [ ] Connect canonical company threads and task/evidence views; preserve current messaging availability and authority.
- [ ] Verify at least two different employee panes plus a manager conversation can coexist without identity, draft or screen-session crossover.

**Deliverable:** the map, screens and conversations work together without becoming another chat application.

### Task 5 — Skills, plug-ins, MCP and settings management

**Owners:** private UI for management views; company control/runtime owners for adapters and authorized changes.

- [ ] Begin with read-only catalog, compatibility and installed-versus-desired coverage tests.
- [ ] Add change preview, target selection and existing approval/execution integration.
- [ ] Test one real supported canary change before enabling a broader rollout. Verify the actual loaded version/tool response, not just a successful upload or accepted request.
- [ ] Test partial failure, incompatible runtimes, sleeping targets, unavailable secret references, uncertain results, safe rollback and restart during a rollout.
- [ ] Preserve active tasks and current budgets. Send exact ready contracts and adapter prerequisites directly between owners.

**Deliverable:** useful administration panes followed by demonstrated per-employee management; unavailable execution remains visibly unavailable until its producer is ready.

### Task 6 — Combined visual/native acceptance

- [ ] Run focused UI/projection/runtime tests for changed behavior; retain failed attempts and fixes.
- [ ] Build public Gen without the private package and verify no company implementation/data is included.
- [ ] Build/install the private plug-in against that public API and coordinate one combined native check with the existing app owner.
- [ ] Verify current data, pane/draft recovery, privacy, observer cleanup and a real authorized screen.
- [ ] Demonstrate one real management change and accurate per-target results before claiming global management works.

**Deliverable:** an owner-usable Company workspace, with separately stated map, screen and management acceptance.

## 12. Review focus and acceptance checklist

### Highest-risk cases

1. **Stale/out-of-order observations:** a dead connection or old task must not leave an employee visibly working.
2. **Passive observation side effects:** opening, restoring or hiding the workspace must not create/wake machines or keep the whole fleet awake.
3. **Wrong-scope or private screen content:** changing employee/project, revoking access or entering a private session clears inappropriate content and session handles.
4. **Pane identity and recovery:** split/join, selection and reload must not move a draft or screen into another employee's context.
5. **Partial global rollout:** preserve actual per-employee versions and uncertain results; accepted or partially applied changes must never become “installed everywhere.”

### Visual acceptance

- A first-time viewer can find the manager, departments, working employees, sleeping machines and attention items within a few seconds.
- The main surface is predominantly diagram, portraits, state markers and real screens. Text remains concise and contextual.
- Colors consistently identify projects and state; icons/labels preserve meaning without color.
- Company map, multiple screens, conversations, Settings, Global skills, Agent plug-ins and MCP can use separate panes.
- Dark/light themes, keyboard selection, visible focus, reduced motion and small screens remain usable.
- Existing personal Gen workflows and the owner's original design remain intact.

### Live and management acceptance

- A planned roster is visibly distinguished from provisioned/admitted employees.
- Actual power and actual task execution are separately supported by trusted current observations.
- Screen/session access is read-only, resource-bound, time-limited and cleaned up on access loss.
- Headless employees never receive an invented desktop or second workspace.
- The overview makes no model or machine-action calls.
- A real skill/plug-in/MCP canary operation reaches a verifiable applied state through existing controls before Apply all becomes operational.
- No private company code/data or credential enters the public harness package or history.

## 13. Dependencies, defaults and completion reporting

- **Start after repository separation:** consume accepted public/private baselines; do not hold up the current separation with this new feature.
- **Shared pane foundation:** coordinate with the existing Blender-style split-pane plan. Build a Company workspace contribution; do not implement a second competing layout engine.
- **First operational delivery:** visual map plus authorized records. Screens and global management advance as real viewing/runtime adapters become available.
- **Default privacy:** watch-only screens, no recordings, no silent wake/create, no remote control, protected secret references.
- **Default rollout:** one explicitly selected eligible canary, then bounded approved batches; keep per-target truth.
- **No automatic provisioning:** this document grants no new machine allocation, subscriptions, spend, permission expansion or employee login attempt.
- **No repeated gate inspections:** blocked live tasks wait for their actual producer; do not substitute endless fixture reruns for screen or employee execution proof.

Report completion separately as **map/UI working**, **live observations working**, **real screens working**, and **real management rollout working**. A completed UI checkpoint is not proof the entire company is operational.

## 14. Message to paste into the UI thread

> Please read this complete plan and add it to the post-separation UI roadmap. Add a private Company workspace in the workspace bar. Its main pane is a visual company structure; other panes show employee screens/activity, canonical conversations, project work, company settings, global skills, agent plug-ins, and MCP management. Reuse Gen's original shell, generic split panes and presentation primitives. Keep company visuals/logic private and all business/machine authority in Maritime's existing control system. Start implementation only after the separation baselines are accepted and exact UI/backend ownership is agreed. Prioritize a useful visual overview, then real watch-only screens, then controlled global management with honest per-agent results. Preserve the existing one-workspace-per-employee assignments and current budgets. Keep native detachment deferred. Do not start from another separate dashboard shell or invent live employees, screens, execution, costs or installation success.
