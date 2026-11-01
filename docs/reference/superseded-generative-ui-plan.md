# Generative UI Harness Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking. This document plans the product; product implementation has not begun.

**Goal:** Build a personal AI workspace in which the task agent chooses, creates, arranges, and updates interactive interfaces while it performs real work, and user interactions become durable input to that work.

**Architecture:** A custom React workspace talks to a local Node application server over HTTP commands and a resumable SSE event stream. A separate worker embeds Pi; application services own UI transactions, authoritative task data, actions, persistence, and memory. The same task agent uses both domain tools and discoverable UI tools.

**Tech stack:** TypeScript, React, Vite, Node >=22.19.0, Pi coding-agent SDK 1.4.0 as the verified integration baseline, json-render, Zod, SQLite, Vitest, and Playwright. Resolve and lock the other dependency versions during Task 1; record them in the lockfile before feature work.

**Spec:** Part I of this document is the design specification implemented by Part II.

**Date:** 2026-10-29.

**Status and scope:** New project plan. All repository paths and application APIs below are proposed, not claims about files or APIs that already exist. Platform, stack, limits, and sequencing are engineering choices made in this plan. The user's explicit requirement is agent-directed generative UI and careful study of Phil Pitus's videos.

**Planning review:** Completed a focused independent review of authorization, edit races, decision gates, snapshot/live bindings, task/input lifecycle, cancellation receipts, and widget persistence. The seven material findings were resolved and the final consistency check found no remaining material planning blockers. Implementation and runtime validation remain future work.

## Global constraints

- Target a local, single-user web application on Windows first. Do not require WSL, Docker, a paid hosted UI service, or a native desktop application for the first working version.
- Use Pi SDK 1.4.0 as the initial verified baseline; Node must satisfy >=22.19.0. Pin dependencies and preserve the lockfile.
- The task agent can discover every installed UI capability. Full component schemas load on demand.
- The agent chooses whether UI is useful, its composition, bindings, arrangement, and updates. Do not implement a fixed mapping from a tool name to a whole screen.
- Host-owned navigation, connection state, cancellation, permission decisions, and recovery remain reachable independently of generated surfaces.
- Factual tool progress and operation success come from the executor. Model-authored descriptions cannot overwrite those fields.
- Separate authoritative data, user drafts, presentation structure, runtime state, and long-term memory.
- Every committed surface has a stable ID, catalog version, task owner, and monotonic presentation revision.
- Persist actions before scheduling work; deduplicate their delivery. Do not promise exactly-once execution for arbitrary external systems.
- Preserve user input, focus, selection, scroll, pins, and dismissals across ordinary agent updates.
- Initial configurable limits: 200 nodes per surface, tree depth 12, 128 KiB serialized surface transaction, three concurrently visible surfaces, and progress publication at most 10 Hz per surface.
- Initial animation duration is 180 ms for simple insertions and state changes; reduced-motion mode removes nonessential motion.
- UI interactions with local semantics must not invoke the model.
- Access to task data and operations is checked by the host, including requests from generated widgets. Agent tools and UI actions use the same operation broker; implicit unrestricted Pi tools are disabled.
- Pending decisions block task mutations by default. Closing a surface does not remove its decision gate.
- A browser disconnect does not cancel a run. Cancellation revokes model/command authority and invokes runtime cancellation; trusted terminal evidence for an already recorded operation can still be recorded.
- The first pilot has one task agent; multi-agent presentation and native desktop packaging are later work.

## Review focus

1. A user edits a form while a model-generated patch arrives: preserve the draft and reject incompatible structure changes.
2. A browser retries an action during reconnect: one accepted action and one operation intent, with ambiguity reconciled before external retry.
3. Cancellation or process loss occurs after a tool started: reject late UI writes, preserve completed evidence, and report interrupted or unknown outcomes honestly.
4. A model submits invalid, oversized, stale, or cross-task UI/data references: keep the last valid interface and return a specific repairable error.
5. A component or widget crashes: keep navigation/cancellation available and render a readable fallback without reporting task success.

# Part I: Design specification

## 1. Product definition

The agent operates a changing workspace. It can decide that a graph, table, map, form, document, diff, timeline, simple text explanation, or combination is the most useful view at a particular moment. It can update that view as tool results arrive and continue the task from a user's interaction.

The implementation supplies reusable rendering and interaction mechanics. The model supplies task-specific composition and decisions. A set of fixed cards selected solely by tool names does not meet the requirement.

A successful run must demonstrate all of the following:

1. A natural-language request starts a real task.
2. The agent discovers relevant UI capabilities and creates a useful composition without a hard-coded task screen.
3. Real tool progress changes the existing interface.
4. A user can inspect or manipulate the view without a model call for every click.
5. A meaningful user decision returns to the same task agent.
6. The agent uses that decision and changes the interface or work.
7. Browser reload restores the same task, selected values, pending input, and committed result.
8. At least one held-out task uses a new combination of available components.
9. A novel sandboxed widget can be created when catalog composition is insufficient, once that capability passes its dedicated gate.

The initial product is general enough for research and coding. It is not a full IDE, a multi-user collaboration service, an operating-system agent, or a native mobile app. Those are separate expansions.

## 2. What the actual Phil Pitus videos show

### Inspection method and limits

Original public CDN MP4s were retrieved from metadata associated with the author's posts. Recorded frames were sampled throughout the accessible clips, with exact timestamp frames extracted around transitions. Map, merge-conflict, and context-window files decode fully. The FAQ file declares 33.2167 seconds but only the first 24 seconds decode; no claims are made about its remainder. Migration and signing video retrieval returned HTTP 403, so neither was visually inspected.

The recordings demonstrate interface behavior. They do not reveal model calls, source code, a renderer protocol, or independently verify real backend execution.

| Clip and source | Observed sequence | Requirement derived for this project |
| --- | --- | --- |
| [Merge conflicts](https://x.com/pitus_/status/2111519352503873866), 30 s | A Create PR action leads to one card with a changing commit graph. It reveals conflicts, offers resolution, displays tests and checks, then enters a merged state after another action. | Preserve surface identity through a workflow; derive action availability and current status from task state. |
| [Map](https://x.com/pitus_/status/2110421626873643338), 21.5667 s | Carousel and map selections update the route, highlighted place, and detail card together. Theme changes retain selection. A send action passes through working and success states. | Shared selected-entity state, independent view preferences, and separate operation lifecycle. |
| [FAQ](https://x.com/pitus_/status/2113344534021124231), first 24 s | Expanding an answer adds related child questions. A submitted custom question becomes a new accordion node and begins showing an answer. | Incremental structural growth, stable tree identities, pending answer state, and preserved expansion/input. |
| [Context window](https://x.com/pitus_/status/2112905095197167649), 16 s | A compact meter opens a breakdown with contextual details. Compact now enters a working state and then displays reduced usage and completion. | Inspectable runtime telemetry, a real command binding, honest unknown values, and concise completion evidence. |

More precise review anchors: merge approximately 3–7 s for progress, 8–12 s for conflict details, 13–18 s for resolution/testing, and 19–29 s for readiness/merge. Map approximately 5–9 s for linked selection, 10–17 s for themes, and 18–21 s for sending. FAQ approximately 5–18 s for branching and 20–23.8 s for custom input. Context approximately 3–10 s for inspection and 10–14 s for compaction.

A useful detail in the merge recording is that earlier prose remains while the live card changes to merged. This product will label immutable narration as history and keep a distinct current-state summary. Video zooms may be recording effects; automatic workspace zoom is not a requirement.

These observations support persistent, evolving task surfaces. They do not establish that Phil's implementation generates its layout with an LLM at runtime. Our product must demonstrate that separately.

## 3. Foundation decision

### Chosen: custom React shell plus Pi SDK worker

The clarification that the AI controls the task workspace changes the earlier T3-first recommendation. A small owned shell gives the agent workspace-level layout and lifecycle control without adapting a thread-centered product.

The Pi SDK supplies a usable model/tool/session loop. The application supplies the generative workspace contract. The [v1.4.0 SDK](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md) exposes custom tools, subscriptions, prompt/steering/follow-up, cancellation, and persistent sessions. Its [tagged package](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/package.json) specifies the baseline version and Node floor above.

### Alternatives considered

- **T3 fork:** Strong when T3's existing threads, repository tooling, terminals, and clients are the desired product. Its [documented visual replies](https://github.com/pingdotgg/t3code/blob/main/docs/user/html-renders.md) are useful, but a whole generative workspace still needs custom integration. Borrow its durable-intent and recovery patterns; do not make it a runtime dependency.
- **DeepSeek Harness:** Strong typed UI/plugin seams and event-backed views. Its [web-client architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md) is a useful reference. Adopting it would also adopt its application/plugin architecture and preview API churn. Keep an adapter boundary for future evaluation.
- **Arbitrary generated application for every response:** Broad expressive freedom, with repeated generation cost and difficult continuity, validation, and recovery. Provide it as an isolated widget capability after the core surface system works.

Use one runtime and one rendering format initially. AG-UI, A2UI, ACP, and MCP Apps are later interoperability choices, not required layers in the first application.

## 4. Workspace experience and control boundaries

The host shell contains a compact task switcher, command input, stop control, connection/runtime status, settings, and recovery access. Task history can open as a drawer. A permanent conversation sidebar is not required.

The generated work area supports focus, split, stack, grid, and tabbed arrangements. The model can create surfaces, change emphasis, add a secondary view, and archive completed work. Three surfaces are visible by default; additional surfaces remain accessible as tabs or in the task drawer.

User actions take priority over presentation changes. An agent cannot steal keyboard focus, remove a dirty form, move the active editor, unpin a surface, or repeatedly reopen a dismissed surface. It can propose a change; the host can defer it until the edit ends.

The agent sees a compact semantic workspace description: surfaces, purposes, state versions, pending decisions, current selections, viewport limits, and explicit preferences. It can inspect details on demand. Screenshots are optional diagnostics for layout repair, not a default input on every model turn.

Show observable work, results, concise plans, and decisions. Raw internal model reasoning is not required to explain what the system is doing.

### Three implementation levels

1. **Trusted primitives:** layout, text, evidence, tables, forms, charts, trees, media, progress, and actions.
2. **Composed task interfaces:** the agent combines primitives and complex viewers such as diff or document editors into a new task-specific layout.
3. **Sandboxed generated widgets:** the agent authors a novel visualization or interaction with declared data and event contracts.

Initial broad catalog: Stack, Grid, Split, Tabs, Panel, Text, Markdown, EvidenceList, Metric, Progress, Timeline, Table, Chart, Tree, Form, Input, Select, Toggle, Button, Code, Diff, Document, Image, and Map. Complex components may be introduced across milestones; discovery reports only capabilities that are actually available. Arbitrary style strings and executable expressions are not accepted in trusted specs; use design tokens and named deterministic transformations.

## 5. Agent-facing UI contract

All names in this section are proposed application tools. They are not claimed Pi or json-render APIs.

| Tool | Required behavior |
| --- | --- |
| ui_discover | Enumerate or search installed UI capabilities. Return concise descriptions, component/schema versions, examples, and complete schemas on request. |
| ui_inspect | Return a compact semantic view of the workspace or a specified surface, including revisions, bindings, selections, pending input, and validation errors. |
| ui_present | Create or modify a surface with a complete spec or patches against a known presentation revision. Validate and commit atomically. |
| ui_arrange | Change the arrangement of permitted surfaces against a workspace-layout revision, subject to focus, pinning, and viewport constraints. |
| ui_request_input | Commit a durable pending request bound to a surface and expected response schema; return its identifier immediately. |
| ui_close | Archive or close an owned surface while preserving history and respecting pins/dirty input. |
| ui_create_widget | Create a versioned isolated artifact with input/output schemas and requested capabilities; expose it only after the widget milestone is complete. |

The initial system context contains the full capability category index and these tool descriptions. ui_discover makes every installed capability reachable. This avoids loading every detailed component schema into every prompt.

### Core identifiers and signatures

Define these application types in packages/contracts/src:

- Id: opaque string generated by the host.
- DataRef: { id: Id; revision: number; pointer?: string }, always an immutable snapshot reference.
- DataBinding: { mode: "snapshot"; ref: DataRef } | { mode: "live"; id: Id; pointer?: string; selector?: string }.
- OperationRef: { id: Id; revision: number }.
- UserStateRecord: { stateId; taskId; schemaVersion; revision; values }, with stable field IDs independent of component position.
- SurfaceSpec: a versioned json-render-compatible component graph.
- SurfaceRecord: { id; taskId; ownerAgentId; catalogVersion; presentationRevision; spec; bindings; stateIds; lifecycle }.
- RunContext: { workspaceId; taskId; runId; agentId; epoch; capabilities } supplied by the host, never trusted from model arguments.
- WorkspaceEvent: { seq; eventId; workspaceId; taskId?; runId?; type; payload; occurredAt }.
- UiAction: { eventId; taskId; surfaceId; presentationRevision; componentId; actionId; requestId?; requestRevision?; payload; stateId?; baseUserStateRevision?; submittedState?; dataRevisions; clientSequence }. dataRevisions records resolved versions actually displayed to the user, not versions inferred later by the server.
- InputRequestRecord: { id; taskId; revision; surfaceId?; status; responseSchema; basis: DataRef[]; gate: "task_mutations"; acceptedActionId? }.
- WidgetInstanceRef: { instanceId; artifactHash; stateSchemaVersion; stateRevision; mountGeneration }.
- UiCommit: { surfaceId; presentationRevision; eventSeq }.
- UiError: { code; message; currentRevision?; paths?; recovery }.

Function boundaries:

- discoverCapabilities(query: CapabilityQuery, ctx: RunContext): Promise<CapabilityPage>.
- inspectWorkspace(query: InspectQuery, ctx: RunContext): Promise<WorkspaceSummary>.
- presentSurface(command: PresentCommand, ctx: RunContext): Promise<UiCommit>.
- arrangeWorkspace(command: ArrangeCommand, ctx: RunContext): Promise<LayoutCommit>.
- requestInput(command: InputRequestCommand, ctx: RunContext): Promise<PendingInputReceipt>.
- acceptUserAction(action: UiAction, auth: ClientIdentity): Promise<ActionReceipt>.
- dispatchOperation(ref: OperationRef, origin: ActionReceipt | AgentCommandReceipt, ctx: ExecutionContext): Promise<OperationReceipt>.

A PresentCommand contains commandId, optional surfaceId for creation, baseRevision (0 for creation), catalogVersion, purpose, placement, bindings, stateIds, and exactly one of spec or patches. The host fills ownership and task identity from RunContext. Repeated commandId with the same body returns the original result; the same ID with a different body is rejected.

ArrangeCommand has commandId, baseLayoutRevision, layoutMode, and ordered surface IDs. It cannot reference another task's surfaces without an explicit host grant.

UiError codes initially include INVALID_SPEC, UNKNOWN_CAPABILITY, INVALID_DATA_REF, STALE_REVISION, STALE_USER_STATE, USER_EDIT_CONFLICT, REQUEST_GATED, PINNED_SURFACE, LAYOUT_CAPACITY, CANCELLED_RUN, and CAPABILITY_DENIED. Return the failing paths and a concise correction opportunity.

## 6. Data, state, transactions, and interaction

### State ownership

| Namespace | Writer | Examples |
| --- | --- | --- |
| taskData | Tool executor and verified import service | Search results, file hashes, test results, operation status |
| userState | User, with explicit acceptance for agent proposals | Draft field values, selected IDs, filters, editor changes |
| presentation | Task agent through UI service | Component graph, labels, composition, explanatory annotations |
| runtime | Host/runtime adapter | Running, retrying, compacting, interrupted, settled |
| preferences | Explicit user setting or accepted memory | Density, theme, default diff layout |
| derived | Registered deterministic functions | Filtered rows, chart series, counts |

Use json-render's [external StateProvider store](https://json-render.dev/docs/api/react) to project these namespaces. The library's store and patch compiler do not supply the transaction, ownership, or authorization guarantees; those are application responsibilities.

A view uses DataBinding rather than making the model retype a dataset, diff, or document. Snapshot bindings pin evidence, decision options, and prepared-operation inputs to immutable DataRefs. Live bindings subscribe to executor progress or evolving datasets and expose the resolved data revision independently of the presentation revision. The host persists these resolutions for recovery and audit. The UI data service can page rows and resolve registered selectors.

An action records the versions actually rendered when it was invoked. Validate only its declared decision read-set and operation preconditions; an unrelated progress tick must not invalidate a form submission. A pending decision freezes its relevant basis as snapshot refs instead of silently changing the question's evidence underneath the user. Separate model-authored claims from sourced facts. For numerical progress, display a real count/total when available; otherwise show an indeterminate state.

### Durable drafts and edit guards

Each editable object has a stable stateId and stable field IDs that survive layout changes. The browser journals drafts in IndexedDB and autosaves versioned changes to the host. Show separate local-saved, host-saved, and unsynced states. Durability begins at the acknowledged write boundary; do not promise that an unacknowledged keystroke survives a machine failure.

Starting an edit immediately activates a client guard and sends begin_edit with the presentation and user-state revisions. The host grants a renewable edit lease for the affected state/fields. Protected fields cannot be removed, rebound, or given an incompatible schema, and their active editing region cannot be moved. Version one allows one editing client per state object, with explicit handover rather than a general collaboration CRDT.

The client guard applies before the host acknowledges the lease. If a conflicting presentation patch has already won that race, or the browser was disconnected, retain the local draft and defer applying that patch to the editing region. Reconcile against stable field IDs; incompatible drafts remain recoverable with their original schema and a visible conflict. Never overwrite them with server defaults. Lease expiry permits server progress but does not authorize discarding a disconnected client's draft.

On reconnect, restore the local journal before reconciling the server snapshot. Autosave uses baseUserStateRevision and clientSequence; conflicts retain both versions. Form submission carries the submitted state, its base revision, and request version. Commit state acceptance, request consumption, action receipt, and input outbox entry in one host transaction. Duplicate submissions return the original receipt. Host authorization and data-version checks still apply.

### Surface transaction

1. Receive a command for an active run epoch and permitted surface.
2. Build its draft from the last committed spec.
3. Apply patches in memory.
4. Validate structure, catalog props, action bindings, data references, limits, and ownership.
5. Compare baseRevision and user-edit guards.
6. Commit the event, projection, command receipt, and any outbox work in one SQLite transaction.
7. Publish the resulting event only after commit.

Incomplete model tool arguments may produce a noninteractive draft placeholder or validated partial preview. The previous committed interface stays usable. Only complete validated arguments commit; aborted or invalid drafts disappear without replacing it.

Use separate presentation and data revisions. Ordinary tool progress does not invalidate an unrelated layout edit. A domain-changing action validates the relevant DataRef/OperationRef version. A form submit validates its pending request, schema, and user-state version. Start with conservative stale-write rejection; do not build a general CRDT in version one.

### Interaction routes

- Pan, sort, expand, tabs, theme choice, and unsent editing: immediate local state, with appropriate durable preference/draft replication and no model call.
- Open an authorized artifact or export visible data: registered host action.
- Explain a selection, refine a plan, submit a decision: persisted agent input.
- Apply a file change or another prepared operation: host executor using an immutable versioned OperationRef and the explicit policy below.

A visible action's actual operation is host-defined. The model cannot turn a destructive operation into an innocuous one by changing its label. Permission prompts apply to meaningful operations under the application's policy, not to ordinary presentation updates.

### Execution and authorization boundary

Register an explicit Pi tool set. Disable its implicit unrestricted read/bash/edit/write tools and automatically discovered executable extensions unless deliberately configured through the adapter. Initial domain capabilities are scoped directory/file inspection, repository status/diff, supplied-source retrieval, and named test recipes. Until the operation broker exists, runtime smoke tests use disposable fixtures and expose no mutating project tools.

Choosing a project grants scoped reads of that project. The host validates canonical paths and symlink resolution before reads. A test recipe is an exact executable/argument/workspace definition authorized for that project; it can have side effects and is handled as an operation. Arbitrary shell commands, package installation, network mutations, and writes outside the chosen project are not initial capabilities.

Both agent-originated operations and UI-originated operations must create an intent and pass the same broker. Authorization binds to operation ID/version, affected resources, expected file/data versions, and any required decision receipts. An explicit project/task grant can authorize a bounded class of operations; otherwise a host-owned confirmation shows the exact prepared change. A label or a generated widget cannot grant permission. Recheck authority, pending-decision gates, and preconditions immediately before execution. Changed preconditions require re-preparation, not reuse of an old approval.

The worker and project commands run with ordinary local OS privileges. Path checks and scoped tools are application policy, not an OS sandbox for repository code. A named test command can execute project code with those privileges. A stronger process/container sandbox is a separate future capability; do not imply it exists in version one.

### Pending input and Pi lifecycle

ui_request_input creates pending application state and returns { requestId, status: "pending" }. It does not leave an HTTP request or tool promise open indefinitely and does not claim a native durable pause in Pi.

The default pending request gates every task mutation at the broker while permitting reads and presentation work. Exceptions require a host-issued grant for a demonstrably independent operation; the model cannot exempt itself by calling an operation independent. This makes dependency handling executable rather than inferred from prose. Requests are single-use and can be pending, accepted, superseded, or withdrawn. Superseding carries the gate forward. Accepted input releases its decision gate; explicit user withdrawal cancels dependent prepared intents instead of authorizing them. Hiding or archiving the surface never clears the gate. Every pending decision remains accessible in a host-owned decision drawer.

After a valid response, commit the action and an input-outbox entry. Deliver it with session.prompt when idle; if active, use the configured steering/follow-up policy. Serialize delivery per session. Retain input while compaction temporarily prevents delivery.

Include the application's event ID in the durable model-input envelope. Track input states persisted, delivered, processing, and handled, with a needs_reconciliation flag for ambiguous transitions. A matching entry in Pi history proves delivery only. Mark handled after the corresponding finalized response/continuation checkpoint and its normalized outcomes are durably recorded. Accepted-but-unfinished input resumes from its checkpoint after operation reconciliation; it must not disappear merely because its delivery marker exists. If acceptance is ambiguous, report/reconcile that ambiguity before redelivery; do not assume the two stores form one atomic transaction.

Use agent_settled as the final idle signal. agent_end can precede retries, compaction recovery, or queued work. Tool events correlate by toolCallId and may interleave. Source: [Pi event reference](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/json.md).

### Task, run, and completion state

Workflow state and runtime activity are separate. Runtime activity is running, retrying, compacting, or settled. One durable task and Pi session can contain multiple runs; every start/resume from idle creates a new runId and epoch. Steering an active run stays in that run. Never equate settled with task completion.

| Task state | Transition rule |
| --- | --- |
| ready | No active run and no blocking decision; task is available to start or continue. |
| working | Host has started a run. A pending decision may transition the task while allowed read/presentation work finishes. |
| awaiting_input | At least one pending decision gates task mutation, whether runtime is active or settled. Accepted input can start a new run once idle. |
| stopped | Explicit user Stop revokes the active epoch and parks queued input. Pending requests remain visible; submitting a decision records it without restarting work. |
| interrupted | Process loss or unreconciled execution prevents safe continuation. Recover evidence before an explicit resume. |
| completed | A proposed task_finish tool submits an outcome/evidence record; host accepts it only with no unresolved requests, unhandled inputs, or active/unknown operations. |
| failed | A terminal failure record explains what could not be completed and preserves partial results. A retry creates a new run. |

When runtime settles without task_finish, the task becomes ready or remains awaiting_input, unless it is stopped/interrupted/failed. Only the host Resume control or an explicitly labeled Send and resume action restarts a stopped task. An ordinary UI action cannot do so. After interruption, reconcile operation outcomes and input checkpoints before exposing Resume. Finalizing the current input and accepting task_finish occur in the same host transaction to avoid a circular completion gate.

Completion records separate the agent's assessment from verified tool evidence. Closing every operation does not prove subjective task quality; display which checks actually ran and which conclusions remain the agent's judgment.

### Cancellation and external effects

Revoke the run epoch, invoke session.abort, and reject new model/UI commands, operation dispatches, and continuation from that epoch. Cancel owned subprocesses through their tool adapters; runtime cancellation alone is not an operating-system sandbox or proof that every external system stopped.

Trusted executors may still append terminal evidence for an already recorded intent/attempt after cancellation, authenticated through the executor channel. That exception can correct an operation from running/unknown to succeeded, failed, or cancelled, and update its live status binding. It cannot create another operation, revive the run, or change the stopped task to completed. This preserves the truth when an effect finishes just before Stop and its receipt arrives afterward.

Write operation intent before execution. A repeated action event does not create another intent. Use external idempotency keys where supported. If a crash happens between an external side effect and recording its result, mark the operation unknown and query/reconcile the target before retrying. Never infer exactly-once external execution from a local database transaction.

### Reconnect

The server exposes POST command/action routes and GET /events?after=<seq> for SSE. Every event has a sequence. On reconnect, provide a consistent snapshot and its sequence, then later events. Test the snapshot/subscription boundary so no updates disappear.

Persist surface snapshots, catalog versions, input requests, actions, operation receipts, and UI preferences. Restore the workspace before invoking a model. If an older catalog/widget is unavailable, render a readable fallback with source references and mark its unavailable capability. Do not silently regenerate a different task state.

## 7. Novel widgets and extensibility

A widget artifact contains HTML/CSS/JavaScript, its input schema, emitted-event schema, durable-state schema/version, and requested capabilities. It is stored by content hash and mounted as a component in a normal surface. Each logical instance has its own stable instanceId and state record; two instances of the same artifact never share state implicitly. Each mount receives a fresh mountGeneration.

Run it in an isolated origin and sandboxed iframe with a restrictive CSP, no host credentials, and no direct host filesystem access. The default network capability is none. Approved data arrives through a scoped bridge; emitted events enter the same action pipeline as catalog components. Validate message source/channel, instance identity, mount generation, schema, and capability on every bridge operation. Reject messages from an earlier mount even if the artifact hash matches.

The bridge exposes dirty/focus reporting and versioned state checkpoints with acknowledgment. The host journals checkpoints through the same draft/state persistence mechanism as trusted components; only acknowledged checkpoints are promised recoverable. Widget edit reports activate the same ownership guards. Pin code and state-schema versions while protected state exists. Upgrades require a compatible explicit state migration or a user-chosen reset; preserve the old checkpoint until migration commits.

The host owns widget size bounds, loading/error states, reset, teardown, and persistence. A widget cannot modify the top-level shell or register privileged React code into it. Save artifact version, instance identity, and durable state so reload does not trigger regeneration. Arbitrary internal widget state that was never reported to the bridge is not claimed durable.

Iframe isolation constrains DOM and capabilities; it does not by itself guarantee hard CPU or memory limits. Heartbeats and timeouts are best-effort recovery. Keep generated-code widgets experimental until responsiveness and isolation tests pass; if a browser cannot keep host controls responsive, the widget capability remains disabled there.

[MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html) can later package portable tool apps. It is not required for the initial owned widget bridge.

## 8. Memory and efficiency

Use SQLite for structured state and a local artifact store for large data. Pi's session store remains the authority for model conversation history; the application database remains the authority for workspace/task state.

Memory records include id, scope (user/project/task), kind, content, source references, explicit-or-inferred origin, createdAt, verifiedAt, expiresAt when applicable, and supersedes. The UI exposes inspect/edit/delete. Draft forms and every click are not automatically promoted into long-term memory.

Begin with explicit preferences and verified project facts. Record useful workflow procedures after successful verification. Add semantic retrieval only when evaluation demonstrates missing relevant recall.

Send the agent small semantic summaries and references. Initial inspect response budget: 8 KiB, with pagination/detail queries. Do not include hidden fields or unrelated task data. Load relevant component definitions and skill procedures only when needed.

Progress counters update from executor events, coalesced to at most 10 Hz; the model is used for meaningful presentation decisions. Initial planning goals, not measured results: local interactions p95 under 50 ms, accepted backend event to visible update p95 under 200 ms, and committed-spec render p95 under 150 ms for the reference fixture. Report hardware, browser, fixture size, and cold/warm conditions when measuring. Model inference is measured separately.

Start with one task agent. A future presenter agent would read task evidence and own a leased surface namespace, without independent domain-operation authority. Introduce it only if evaluation demonstrates a benefit over the single-agent design.

## 9. Acceptance and sequence

### First end-to-end proof

A user asks for an analysis of a local repository. The agent discovers a table/tree/diff combination, creates a workspace, binds real file/test results, requests a structured choice, and uses the answer. Refresh preserves the choice and pending task. No fixed repository-analysis screen supplies the layout.

### Two additional pilot demonstrations

- A research/comparison task creates a linked table/chart or table/map, supports local filtering/selection, and changes the analysis after a submitted choice.
- A dynamic FAQ creates parent/child questions from provided source material, preserves expanded nodes, and inserts a custom question into the existing tree.

For the initial map demo, use an explicitly labeled bundled dataset and known coordinates. Add live places/routing only after choosing a data provider and its credentials/licensing. Do not present fixture locations or travel times as live results.

### Evaluation suite

Use 12 held-out task descriptions: four coding, four research/data, two document/form, and two custom visualization tasks. Record model/provider configuration. Run each scenario three times for model-dependent evaluation, separately from deterministic regression tests.

Score task success, valid UI after repair, correctness of displayed source data, action completion, user-input preservation, recovery, total model/tool cost, and time to first usable control. Require all deterministic integrity tests to pass. Target at least 30 successful runs out of 36, with at least 10 of the 12 scenarios succeeding in two or more runs. A successful run completes with useful UI after no more than two validation-repair attempts. These are pilot gates, not claimed current results. Review failures by task category rather than averaging away a broken workflow.

A local pilot is an estimated four to six engineering weeks for an experienced TypeScript developer using existing component libraries. This is a planning range, not a delivery promise. The scope of external integrations and novel widgets can extend it.

# Part II: Implementation tasks

## Proposed repository structure

| Path | Responsibility |
| --- | --- |
| apps/web/src | Stable shell, renderer, local state, event connection, interaction feedback |
| apps/host/src | Local authenticated HTTP/SSE server, session supervisor, command routing |
| packages/contracts/src | Versioned task, surface, event, action, data-reference, and runtime schemas |
| packages/storage/src | SQLite schema, transactions, projections, outbox, artifacts |
| packages/runtime-pi/src | Pi worker, normalized lifecycle events, input delivery and cancellation |
| packages/ui-catalog/src | Component definitions, schemas, capability index, design tokens |
| packages/ui-engine/src | Surface admission, transactions, ownership, data bindings, layout policy |
| packages/widgets/src | Widget artifacts, isolated renderer host, message bridge |
| packages/memory/src | Scoped memories, provenance, retrieval, inspect/edit/delete |
| tests/integration | Event/recovery/action/runtime integration tests |
| tests/e2e | Browser interaction, accessibility, layout and recovery tests |
| evals | Held-out prompts, fixtures, scorer, run metadata and results |

All following paths are relative to this proposed repository.

### Task 1: Contracts, storage, and local host foundation

**Files:** Create package.json, pnpm-workspace.yaml, tsconfig.json; packages/contracts/src/{ids,task,surface,event,action,data,runtime}.ts; packages/storage/src/{db,event-store,projection-store,artifact-store}.ts; packages/storage/migrations/001_initial.sql; apps/host/src/{main,auth,routes,events}.ts; tests/integration/event-store.test.ts.

**Consumes:** Design specification.
**Produces:** appendCommand(command: HostCommand, ctx: ClientIdentity): Promise<CommandReceipt>; readSnapshot(workspaceId: Id): Promise<WorkspaceSnapshot>; subscribeAfter(workspaceId: Id, seq: number): AsyncIterable<WorkspaceEvent>; putArtifact(input: ArtifactInput): Promise<DataRef>.

- [ ] Write event-store tests asserting one receipt/event for a repeated command ID, rejection for changed content under that ID, monotonic sequences, and atomic event/projection commit.
- [ ] Run pnpm exec vitest run tests/integration/event-store.test.ts and verify missing interfaces make it fail.
- [ ] Implement contracts and migrations for tasks, runs/epochs, events, surfaces, stable user-state IDs/revisions, edit leases, input requests/gates, actions, operation intents/attempts, outbox checkpoints, memories, and artifacts. Distinguish snapshot refs from live bindings. Enforce unique command/event identifiers.
- [ ] Implement loopback-only server startup with session authentication and origin/host checks; a foreign origin cannot issue commands. No provider secrets enter browser responses.
- [ ] Implement the snapshot-plus-events reconnect boundary and artifact references.
- [ ] Run the tests and typecheck. Commit the independently usable host/store foundation.

### Task 2: Pi worker and truthful runtime lifecycle

**Files:** Create packages/runtime-pi/src/{adapter,worker,normalize-events,input-delivery,session-registry,tool-policy,task-tools}.ts; apps/host/src/runtime/supervisor.ts; tests/integration/pi-runtime.test.ts.

**Consumes:** Task/run/event contracts and event store.
**Produces:** AgentRuntime.start(input: StartRun): Promise<RunReceipt>; deliver(input: AgentInput): Promise<InputReceipt>; cancel(input: CancelRun): Promise<void>; restore(input: RestoreSession): Promise<SessionHandle>; dispose(): Promise<void>.

- [ ] Write tests with scripted runtime events: interleaved tool calls remain correctly associated; agent_end followed by retry does not settle the host run; agent_settled does.
- [ ] Add tests for a rejected prompt during compaction, input retained in outbox, cancel followed by a late event, and worker crash while a tool is active. Verify implicit built-in tools/extensions are absent from the active tool set.
- [ ] Run pnpm exec vitest run tests/integration/pi-runtime.test.ts to establish failures.
- [ ] Embed createAgentSession in a long-lived worker, register subscriptions before prompting, provide explicit workspace/session/resource configuration, and normalize tool/lifecycle events. Register only the explicit allowed tools; use disposable fixtures and no project mutations until Task 5's broker is available.
- [ ] Implement SDK-shape argument preview extraction separately from JSON/RPC wire types. Do not persist partial previews as committed state.
- [ ] Serialize input delivery, restore Pi sessions through SessionManager, and rebind subscriptions after replacement. Persist delivery separately from handling/checkpoints. Implement task/run state transitions and the proposed task_finish contract. Register MCP extensions explicitly only when that milestone needs them.
- [ ] Run the tests and one real-model smoke task in a disposable fixture workspace. Record provider/model/version and observed events. Commit.

### Task 3: Renderer, external state, and broad capability catalog

**Files:** Create packages/ui-catalog/src/{catalog,capabilities,tokens,registry}.ts; packages/ui-catalog/src/components/; apps/web/src/{main,Shell,Workspace}.tsx; apps/web/src/state/{store,user-state,draft-journal,edit-lease}.ts; apps/web/src/render/{Surface,ErrorBoundary}.tsx; tests/e2e/catalog.spec.ts.

**Consumes:** Surface/data/action contracts.
**Produces:** renderSurface(record: SurfaceRecord, store: UiStateStore); capability index and versioned catalog; local action dispatcher.

- [ ] Write browser tests rendering two different compositions from specs, preserving focused input across data updates, maintaining local selection, and keeping stop/navigation available after renderer failure.
- [ ] Run pnpm exec playwright test tests/e2e/catalog.spec.ts and establish failures.
- [ ] Implement trusted layout/text/table/form/progress/tree/evidence components and token-based styling. Add complex components incrementally in later tasks.
- [ ] Connect json-render to the owned external store and register named local/host/agent action routes. Add stable state/field IDs, IndexedDB draft journaling, host autosave revisions, and visible saved/unsynced state.
- [ ] Implement keyboard behavior, labels, reduced motion, and readable fallback output.
- [ ] Run browser tests at desktop and narrow viewport sizes. Commit the renderer and catalog.

### Task 4: Agent-controlled surface generation and repair

**Files:** Create packages/ui-engine/src/{discovery,inspection,admission,transactions,errors}.ts; packages/runtime-pi/src/ui-tools.ts; tests/integration/ui-tools.test.ts; evals/fixtures/first-workspace.json.

**Consumes:** Runtime, catalog, renderer, event store.
**Produces:** discoverCapabilities, inspectWorkspace, presentSurface and their ui_discover/ui_inspect/ui_present tool wrappers.

- [ ] Write tests for invalid props, unknown components, dangling references, over-depth/size specs, stale revisions, cross-task DataRefs, and duplicate command IDs. Verify live data updates preserve presentation revision while snapshot evidence remains pinned.
- [ ] Run pnpm exec vitest run tests/integration/ui-tools.test.ts to verify failures.
- [ ] Implement staged validation and atomic presentation commits. Preserve the previous committed surface on every rejected draft.
- [ ] Provide concise repair errors with failing paths/current revisions. Add compact capability index and current-workspace context to the agent.
- [ ] Implement snapshot/live bindings and registered selectors; the model must not retype fixture datasets. Record resolved revisions and validate action read-sets against what the client rendered.
- [ ] Run a real-model task that produces a composition not hard-coded in the app, then modifies it after new evidence. Record the actual UI tool calls.
- [ ] Run regression tests and commit. This is the first proof of genuine runtime UI generation.

### Task 5: Durable human input and operation actions

**Files:** Create packages/ui-engine/src/{input-requests,action-router,operation-broker,authorization}.ts; apps/web/src/actions/{dispatch,pending}.ts; apps/web/src/workspace/DecisionDrawer.tsx; apps/host/src/actions/routes.ts; tests/integration/action-loop.test.ts; tests/e2e/input-loop.spec.ts.

**Consumes:** Surfaces, runtime delivery, event/outbox store.
**Produces:** requestInput, acceptUserAction, dispatchOperation; ui_request_input tool.

- [ ] Write tests for local sort with zero model calls, form submission continuing the owning task, refresh during pending input, duplicated submission, consumed/superseded request, user-state conflict, and operation revision mismatch.
- [ ] Verify that pending input blocks agent and UI mutation paths, archived surfaces retain reachable decisions, and direct write/shell tools cannot bypass the broker. Check operation/version/precondition changes invalidate authorization.
- [ ] Run pnpm exec vitest run tests/integration/action-loop.test.ts and pnpm exec playwright test tests/e2e/input-loop.spec.ts.
- [ ] Persist pending requests, snapshot their decision basis, return receipts immediately, and expose them in the host drawer. Track awaiting_input separately from runtime activity.
- [ ] Atomically commit submitted state, request consumption, action receipt, and input outbox. Commit operation intent before execution. Apply one authorization/gating path to agent and UI origins, with exact prepared-operation checks.
- [ ] Add input-history reconciliation for delivery ambiguity and unknown-result handling for external side-effect ambiguity.
- [ ] Run a real-model form-response round trip, including a browser reload. Commit.

### Task 6: Workspace layout and user ownership

**Files:** Create packages/ui-engine/src/{layout,ownership,close}.ts; apps/web/src/workspace/{LayoutHost,PinnedSurfaces,HistoryDrawer}.tsx; tests/e2e/layout-ownership.spec.ts.

**Consumes:** Surface service, user state, workspace layout revision.
**Produces:** arrangeWorkspace, closeSurface; ui_arrange and ui_close tools.

- [ ] Write tests that agent rearrangement retains focus/scroll, pinning prevents relocation/closure, dirty input prevents incompatible replacement, and dismissal suppresses repeated reopening.
- [ ] Cover edit-start versus patch races, disconnected editing, expired leases, two editing clients, reload with an unsynced draft, and a schema change that leaves the old draft recoverable. Stable IDs must preserve field identity through permitted rearrangement.
- [ ] Run pnpm exec playwright test tests/e2e/layout-ownership.spec.ts.
- [ ] Implement focus/split/stack/grid/tab layouts and viewport constraints, including the three-visible-surface default.
- [ ] Implement client-first guards and versioned host edit leases. Add semantic inspection of pins, pending edits, current arrangements, and deferred layout requests.
- [ ] Demonstrate the agent adding a second surface and changing emphasis as task evidence changes.
- [ ] Run tests and commit.

### Task 7: Real task tools, shared state, and progress bindings

**Files:** Create apps/host/src/tools/{workspace,git,tests,source-data}.ts; packages/ui-catalog/src/components/{Diff,CommitGraph,LinkedTable,Map,TaskStatus}.tsx; packages/ui-engine/src/data/{resolve,selectors,progress}.ts; tests/integration/grounded-task.test.ts; tests/e2e/linked-views.spec.ts.

**Consumes:** DataRef/OperationRef contracts, action broker, renderer.
**Produces:** Grounded tool result adapters and linked views; versioned prepared file operations.

- [ ] Write tests ensuring displayed diffs and counts equal source artifacts, map/table selection stays synchronized, theme changes retain selection, and task success cannot be authored through presentation props.
- [ ] Add a stale file-hash test and a subprocess cancellation/late-progress test. Verify an effect completed before Stop can record its delayed result afterward without reviving the task or dispatching new work.
- [ ] Run pnpm exec vitest run tests/integration/grounded-task.test.ts and pnpm exec playwright test tests/e2e/linked-views.spec.ts.
- [ ] Implement repository read/diff with canonical-path checks and named test recipes within a chosen workspace, with explicit result/update contracts. Test execution uses the broker and project grant; document ordinary OS privileges rather than implying a process sandbox.
- [ ] Implement prepared patch/apply operations with version checks. Do not require public PR creation or external deployment for this milestone.
- [ ] Add labeled bundled map/research fixtures; clearly distinguish fixture data from live integrations.
- [ ] Demonstrate a live task surface through working, input-needed, verification, and completion states. Commit.

### Task 8: Recovery, replay, and context independence

**Files:** Create packages/storage/src/{recovery,outbox-reconcile,catalog-versions}.ts; apps/host/src/recovery.ts; apps/web/src/connection/reconnect.ts; tests/integration/recovery.test.ts; tests/e2e/reconnect.spec.ts.

**Consumes:** All persisted task/surface/input/runtime records.
**Produces:** recoverWorkspace(workspaceId: Id): Promise<RecoveryReport> and resumable browser state.

- [ ] Write tests for snapshot/subscription races, browser disconnection while work continues, crash after intent but before result, old catalog versions, and reload after a completed operation.
- [ ] Cover a delivered-but-unfinished input, a finalized response before host checkpoint loss, a stopped task with queued input, and a resumed task receiving a fresh runId/epoch. Stop must never auto-resume, and settled must never imply completed.
- [ ] Assert recovery reconstructs UI without model calls and never replays a completed side effect.
- [ ] Run pnpm exec vitest run tests/integration/recovery.test.ts and pnpm exec playwright test tests/e2e/reconnect.spec.ts.
- [ ] Implement interrupted/unknown status reconciliation, versioned fallback rendering, outbox recovery, and explicit resume through a new run.
- [ ] Compact model context during a demonstration and verify UI state survives independently.
- [ ] Run tests and commit.

### Task 9: Sandboxed novel widgets

**Files:** Create packages/widgets/src/{artifact,schema,bridge,policy,host}.ts; apps/web/src/widgets/WidgetFrame.tsx; apps/host/src/widgets/routes.ts; packages/runtime-pi/src/widget-tool.ts; tests/e2e/widget-isolation.spec.ts.

**Consumes:** Artifact store, scoped data service, action pipeline, surface engine.
**Produces:** createWidget(command: WidgetCommand, ctx: RunContext): Promise<WidgetRef>; ui_create_widget tool after capability tests pass.

- [ ] Write tests for unauthorized data/operation requests, malformed messages, spoofed instance/source, undeclared network use, navigation attempts, crash recovery, and state restoration.
- [ ] Cover two instances of one artifact with separate state, stale mount-generation messages, dirty/focused widget replacement, checkpoint acknowledgment, compatible migration, and preservation after an incompatible upgrade.
- [ ] Add a responsiveness test with a deliberately problematic widget. Keep capability disabled if host controls cannot remain usable.
- [ ] Run pnpm exec playwright test tests/e2e/widget-isolation.spec.ts.
- [ ] Implement immutable widget artifacts, isolated origin/iframe, restrictive CSP, a scoped bridge, and teardown/reset.
- [ ] Add input/output/durable-state schemas, stable instance IDs, fresh mount generations, checkpoint acknowledgments, edit reporting, migration rules, and size bounds. Never execute model-generated build scripts on the host.
- [ ] Demonstrate a new visualization absent from the trusted catalog, a validated user event, and reload without regeneration.
- [ ] Run tests and commit. This gate completes the open-ended generation path.

### Task 10: Inspectable memory and learned presentation preferences

**Files:** Create packages/memory/src/{types,repository,retrieve,consolidate}.ts; apps/web/src/memory/MemoryInspector.tsx; packages/runtime-pi/src/memory-tools.ts; tests/integration/memory.test.ts.

**Consumes:** Scoped task evidence, source references, explicit user settings.
**Produces:** remember(input: MemoryInput, ctx: MemoryContext): Promise<MemoryRecord>; recall(query: MemoryQuery): Promise<MemoryPage>; update/delete operations.

- [ ] Write tests for cross-project isolation, deleted-memory exclusion, superseded/conflicting facts, expiry, and a click/draft not becoming a durable preference.
- [ ] Run pnpm exec vitest run tests/integration/memory.test.ts.
- [ ] Implement inspect/edit/delete and source-aware retrieval. Start with explicit preferences and verified project facts.
- [ ] Add successful workflow records with prerequisites and verification evidence. Keep automatic consolidation conservative.
- [ ] Measure recall on the small evaluation set before adding embeddings.
- [ ] Run tests and commit.

### Task 11: Evaluation, accessibility, and pilot gate

**Files:** Create evals/{cases.json,runner.ts,score.ts,README.md}; tests/e2e/{keyboard,performance,renderer-failure}.spec.ts; docs/pilot-results.md.

**Consumes:** Complete core application and widget capability if enabled.
**Produces:** A reproducible pilot report and a release candidate with documented limitations.

- [ ] Write deterministic tests for all five Review Focus classes and ensure every required invariant has an owning test.
- [ ] Run keyboard/reduced-motion and narrow-layout checks; test readable output after a component crash.
- [ ] Run the 12 held-out tasks three times each, recording model/version, configuration, tool usage, repairs, costs, timing, and outcome.
- [ ] Measure local interaction and render targets separately from inference, reporting the machine/browser/fixture.
- [ ] Fix failures that block actual workflows; rerun affected cases and required regression gates.
- [ ] Publish the pilot report locally with remaining limitations and a known-good dependency lockfile. Commit.

## Later work after the pilot

Add a provider-neutral runtime adapter for DSH or another harness only after the application contract is stable. Add multi-agent work with a coordinator owning overall arrangement and children owning assigned surface namespaces; enforce ownership in code.

Evaluate a dedicated presenter only if the task agent's UI work measurably harms completion or latency. It should receive verified evidence and have UI authority without independent domain-operation authority.

Consider desktop packaging, remote access, portable MCP Apps, live map providers, rich document integrations, and multi-user collaboration as separately scoped milestones.

## Completion evidence required

The pilot report must contain an actual trace showing: agent-selected composition; real data bindings; a meaningful UI change during work; a user event returned to the agent; verified execution outcome; a reload/resume; an invalid/stale update handled without losing the interface; and a held-out composition. Include a novel generated widget trace when that capability is enabled.

A gallery of attractive generated screens is insufficient evidence of this product.

## Sources and research record

Primary implementation sources:

- [Pi v1.4.0 package metadata](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/package.json)
- [Pi v1.4.0 SDK](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md)
- [Pi v1.4.0 event reference](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/json.md)
- [Pi RPC extension UI boundaries](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-extension-ui.md)
- [json-render catalog](https://json-render.dev/docs/catalog)
- [json-render registry](https://json-render.dev/docs/registry)
- [json-render streaming](https://json-render.dev/docs/streaming)
- [json-render generation modes](https://json-render.dev/docs/generation-modes)
- [json-render external store API](https://json-render.dev/docs/api/react)
- [T3 architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md)
- [T3 visual replies](https://github.com/pingdotgg/t3code/blob/main/docs/user/html-renders.md)
- [T3 Pi provider](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-pi.md)
- [DSH browser architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md)
- [DSH typed slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-slots/README.md)
- [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)

The video links and inspected coverage are recorded in Section 2. Interface observations, upstream capabilities, and proposed product behavior are intentionally distinguished.
