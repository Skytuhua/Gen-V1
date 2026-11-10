# Gen V1 Company Communication System Implementation Plan

> **For implementing agents:** Use `superpowers:executing-plans`, test-driven development, and verification-before-completion when available. An implementation helper is not a company employee and does not authorize changing the dedicated-machine architecture. Checkboxes below describe future work, not completed tests.

**Goal:** Give Leo's AI software company reliable, low-noise communication across permanent employee computers, with Gen V1 as the owner-facing manager and interface, project/task conversations, targeted employee inboxes, and selective GitHub integration.

**Architecture:** Extend the existing deterministic company control service with a durable communication module. Store authoritative tasks, messages, deliveries, decisions, and outgoing effects transactionally on that service. Use authenticated HTTPS for commands and receipts, server-sent events (SSE) for notifications, and GitHub Issues/PRs as linked engineering records rather than the internal message transport.

**Tech stack:** Existing Python company service, local SQLite, HTTPS/JSON and SSE, trusted employee supervisors, Gen V1's TypeScript/Fastify/React integration, pytest, Vitest, and Playwright. No separate message broker in the initial release. No shared database file across machines.

**Spec:** Sections 1-20 of this file are the self-contained communication specification. Sections 21-27 provide component ownership, implementation tasks, acceptance, rollout, operations, and traceability. Section 28 records sources and limitations. This plan specializes the communication requirements in `gen-v1-company-manager-requirements.md`; it does not replace the entire company specification.

**Prepared:** November 2, 2026.  
**Status:** Implementation plan only. No repository, employee computer, account, integration, or production configuration was changed while preparing it. No runtime, load, or cloud acceptance tests were executed.  
**Suggested repository location:** `docs/superpowers/plans/2026-11-02-gen-company-communications.md`.

## Global constraints

- Retain **32 permanent employees across 16 departments**, each with its own persistent Maritime computer, plus one separate control-plane computer. Target composition: **one Gen V1 manager, 17 standalone Hermes employees, 14 native Codex employees**. Gen may retain its embedded Hermes engine.
- Retain **three active delivery projects**, **eight simultaneous staff tasks**, **three tasks per project**, **one foreground task per employee**, and the manager's separate single execution slot. Reserve two of the eight staff slots for eligible review/integration/repair, with existing idle-capacity borrowing rules.
- Retain **two simultaneous marketing tasks and one render**, both within the eight staff slots. Keep the existing two-attempt, two-review-round, twelve-task work-order, eight-handoff-depth, and 1,800-second attempt deadline defaults.
- No Maritime Swarms, disposable employee fleet, hidden local subagents, shared-machine role switching, extra subscriptions, or automatic harness/model fallback.
- Preserve the requested subscription-only Sol route and exact manager `max` / staff `xhigh` reasoning requirements as account-verification gates. This plan neither establishes entitlement nor changes those requirements.
- The existing $100 Maritime account, $80 proposed usage target, $20 reserve, and no-overage application policy remain unchanged. Account facts and supported rates must be verified before live cost exposure.
- No automatic merge, production deployment, default-branch update, repository deletion, force push, permission expansion, purchase, or unapproved external message.
- Marketing remains focused on X, Reddit, and the product website. YouTube, Instagram, and TikTok remain `deferred_by_owner`. Agency-Agents stays a pinned, curated reference library, not a router or second workforce.
- This request authorizes a plan artifact, not deployment, new repositories, GitHub writes, credential enrollment, or live test posts. Existing setup repository permissions must be rechecked before implementation.

## Review focus

| High-risk condition | Required behavior | Main tasks |
|---|---|---|
| A lost response, repeated message, or restored backup repeats work | Durable identity, argument-aware idempotency, fencing, reconciliation; no blind external retry | C02, C04, C11, C17 |
| All workers wait for one another, or a question starts hidden work | Scheduler-owned response tasks; checkpoint and confirmed release; wait-cycle detection; existing caps apply | C05, C06 |
| A revoked member reconnects or reads a department summary | Authorization before delivery, search, summaries, counts, and replay; stale cursors cannot preserve access | C03, C07, C14 |
| Chat text, an issue comment, or a generated button impersonates authority | Separate discussion, commands, observed events, and approvals; authenticated policy gates outside models | C01, C08-C11 |
| A slow stream, noisy worker, or sleeping service loses important work | Bounded queues, durable inbox recovery, independent stop path, verified platform wake, explicit unknown state | C07, C12, C13, C16 |

## Contents

1. Decision and alternatives
2. Source basis and implementation boundaries
3. Deployment and authority
4. Company communication model
5. Message classes and responsibility
6. Data contracts
7. Database and transactional guarantees
8. Delivery protocol
9. Task discussion, help, and deadlock prevention
10. Attention, notifications, and escalation
11. HTTPS, SSE, and reconnect behavior
12. API and tool surface
13. Gen V1 integration and user experience
14. GitHub integration
15. Sleep, cancellation, and failure behavior
16. Decisions, knowledge, and context efficiency
17. Security and trust boundaries
18. Performance and evaluation
19. Configuration defaults
20. Worked scenarios
21. Files and component ownership
22. Implementation tasks C00-C19
23. Integrated acceptance matrix
24. Activation and rollout
25. Operator runbook
26. Deferred upgrades and non-goals
27. Requirement coverage and completion report
28. Sources and evidence status

---

## 1. Decision and alternatives

### 1.1 Selected design

Build an internal communication workspace in Gen with **project rooms, task threads, addressed employee inboxes, decision records, and an incident queue**. These are views over a single authoritative company service, not disconnected chat products.

Employees may ask one another questions directly through that service. The manager does not forward every question. A question that requires model reasoning still uses the recipient's existing machine, a valid assignment, and normal scheduling capacity.

Use GitHub Issues for owner-visible feature/bug records when a repository binding permits it. Use PRs for code, review, and actual provider state. Keep internal acknowledgments, task dispatch, routine questions, heartbeats, and retry traffic out of GitHub comments.

### 1.2 Alternatives considered

| Approach | Benefit | Reason not selected as the primary channel |
|---|---|---|
| GitHub Issues for all communication | Familiar, durable, close to code | Does not itself supply machine admission, inbox receipts, cancellation, or company-scope permissions; creates unnecessary API writes and mixes private operations with engineering records. |
| Slack/Discord as the system of record | Familiar rooms and notifications | Adds another external dependency and credential surface while still requiring a durable task/authorization service. Human notification can be added separately later. |
| A dedicated broker from day one | Explicit durable delivery infrastructure | Adds an operational component before a bottleneck has been measured; does not remove the need for company records, policy, and idempotent effects. |
| **Company service + SQLite mailbox + HTTPS/SSE + selective GitHub** | Reuses the planned control service; clear authority; directly integrated with Gen | Requires implementing and testing delivery/recovery. Selected for the initial scale, subject to measured acceptance. |

This choice is an engineering decision for the stated workload, not a universal claim that SQLite or SSE is fastest. If storage, availability, or fan-out requirements change, evaluate the specific bottleneck before adding infrastructure.

## 2. Source basis and implementation boundaries

### 2.1 Controlling inputs

The latest user direction makes Gen V1 E01's outer harness. It supersedes older wording that assigns standalone Hermes to E01, but preserves the remaining organization and safety boundaries. The approved communication direction is the immediately preceding conversation: project/task views, addressed inboxes, a deterministic service, HTTPS/SSE, and selective GitHub integration. [P1, P2, P3]

The following are **new proposed implementation defaults**, not independently supplied owner requirements: message sizes, delivery retry intervals, request-response deadlines, stream buffering limits, performance targets, and retention candidates. They are explicit below so an implementer does not invent them silently.

### 2.2 Repository inspection boundary

The earlier requirements inspected Gen at `9f23537334f2a1dc6c3bbe00d0444f8e86b57e28`. During this plan preparation, `main` resolved to **`6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c`**. Its direct parent is the earlier snapshot; the retrieved commit diff changes `tests/hermes-client.test.ts`. Current reads of `apps/server/event-stream.ts`, part of `apps/server/server.ts`, and `package.json` inform the integration points below. This is targeted inspection, not a new whole-repository audit. [G1-G4]

The existing event stream reads from the local durable ledger, yields on response backpressure, and emits a 15-second heartbeat. Reuse these design principles, not its unrestricted local workspace feed as a remote employee feed. Current local bootstrap/session and host/origin controls are designed for the loopback app; do not expose that bootstrap endpoint as remote owner authentication. [G2, G3]

No current CI result or runtime readiness is inferred from the new commit. C00 establishes a known-green implementation candidate. Older reported pass counts and earlier CI failures are historical evidence only.

### 2.3 Prerequisites versus this deliverable

This plan implements communication and its integration contracts. It does **not** independently rebuild the entire company scheduler, model authentication system, GitHub publisher, artifact store, or employee sandbox.

Required dependencies are: organization/project registry; authenticated owner and machine principals; task admission and budgets; immutable artifacts; runtime supervisors; restricted publishers; verified cloud manager hosting. If a dependency does not exist, implement it through its owning company-plan task before the affected live gate. Use explicit fake adapters for independent offline work; never label a fake dependency as deployed.

## 3. Deployment and authority

### 3.1 Physical and logical layout

```text
Owner's Gen interface
  | authenticated owner requests and read models
  v
Protected owner gateway / Company service on the control-plane computer
  |-- company database: tasks, messages, receipts, decisions, outboxes
  |-- scheduler, authorization, budget and evidence gates
  |-- communication routing and notification projections
  |-- restricted GitHub and social publishers
  |
  +--> E01: Gen manager on its dedicated computer
  |      receives owner instructions and selected escalations
  |      proposes work using scoped company tools
  |
  +--> Employee supervisor on each dedicated computer
         durable local inbox and attempt ledger
         one admitted Hermes or Codex foreground task
         scoped tools, project data, and output evidence

GitHub webhook --> authenticated ingress --> durable inbox --> reconciler
GitHub writes  <-- restricted publisher <-- authorized effect outbox
```

In company-client mode, the owner desktop/browser does not run a second E01 model loop. E01 remains the sole admitted cloud manager; personal local mode stays separate.

The protected owner gateway is a service boundary, not a new employee or automatic extra machine. It may share the existing protected control-plane deployment. Gen's frontend and manager connection must use the approved remote-owner access design; a raw forwarded loopback host is not sufficient.

Owner stop/approval commands go directly to deterministic control endpoints. They never wait for E01's next model response. The manager receives the resulting authoritative state afterward.

### 3.2 Who owns each truth

| Information | Authoritative owner | Other systems' role |
|---|---|---|
| Authorized project scope, staffing, task state, attempts | Company service | Gen displays/proposes; workers report evidence. |
| Message body, audience, delivery history | Company communication records | Project rooms and inboxes are authorized views. |
| Owner approval and current policy | Protected owner/policy service | Chat may request approval but cannot manufacture it. |
| Observed process state | Bound supervisor plus reconciliation | Worker prose is a claim, not process evidence. |
| Verified check results | Evidence/review service | A test report links exact inputs, commands, and artifacts. |
| GitHub issue/PR content and provider state | GitHub, as last observed and timestamped | Internal projections may be stale and must say so. |
| Accepted work-order requirements | Versioned company record | Issue edits propose a revision, not an invisible overwrite. |
| Display state and local drafts | Gen's UI store | Not a second writer for company tasks or approvals. |

Extend the **same company database** for transactional messaging. Do not create a separate mailbox database that must dual-write task transitions. Each worker's local inbox is a delivery journal, not a competing source of task authority. Gen's own SQLite remains an application projection/cache for company entities.

### 3.3 What is not an AI employee action

Authentication, storing a message, replaying a cursor, delivering a notification, checking a deadline, and observing a heartbeat are ordinary software operations. They do not require model calls or staff inference slots. They still use infrastructure and may keep machines awake, so awake-capacity and cost accounting remain necessary.

Reasoning about a question, writing an answer, revising a plan, or reviewing an artifact is employee work. It requires an existing valid foreground attempt or a separately admitted response task.

## 4. Company communication model

### 4.1 Five surfaces, one record system

| Surface | Purpose | Scope and behavior |
|---|---|---|
| Owner decision inbox | Approvals, scope choices, important blockers | Owner-visible; exact trusted action cards, not generated permissions. |
| Project room | Important changes in one project | Timeline of linked task events, decisions, and discussions; not a global broadcast prompt. |
| Task thread | Actual problem-solving and handoffs | Primary discussion location; binds one logical task/work order and relevant versions. |
| Department knowledge area | Reviewed standards and reusable procedures | Only reviewed, sanitized content may be company-wide; private project discussion remains project-scoped. |
| Incident queue | Exceptions needing investigation | Deduplicated, scoped incident records with owner, evidence, and recovery state. |

Every employee has an inbox view of actionable items addressed to it. A single backend handoff can appear in a task thread, project room, frontend inbox, and QA inbox using **one canonical message ID** and per-recipient delivery records. It is not copied into four unrelated histories.

### 4.2 Direct collaboration

Frontend may ask Backend about a contract, QA may request reproduction details, and Marketing may request approved feature facts. All exchanges go through the authenticated service. Employee computers do not need unrestricted peer-to-peer network access.

The sender cannot grant the recipient project membership. A cross-department question is ordinary collaboration within an authorized project. A cross-project transfer requires a separately approved sharing boundary and, where appropriate, a sanitized artifact. Tagging another project or adding a recipient never widens access.

### 4.3 Organizational roles

The department registry continues to cover Executive/Strategy, Operations/Project Management, Product, Research/Architecture, Design/UX, Engineering, QA/Independent Review, Platform/DevOps/IT, Security/Compliance, Data/Analytics, People/Knowledge Operations, Finance/Administration, Legal/Risk, Marketing/Communications, Sales/Partnerships, and Support/Documentation. Each can have a reviewed knowledge view; none automatically subscribes every member to all project discussions.

| Decision class | Responsible role | Boundary |
|---|---|---|
| Clarification within an approved implementation | Assigned employee(s) | Cannot change product scope, permissions, acceptance, or budget. |
| Project dependency/ordinary sequencing decision | E03/E04 or assigned PM | Scheduler still controls admission and actual capacity. |
| Discipline standard or interface interpretation | Relevant department lead | Must be within the project charter; affected artifacts receive explicit new versions. |
| Cross-project staffing conflict | E02 | May propose assignments; cannot clone employees or override caps. |
| Portfolio priority or unresolved conflict | E01, Gen manager | Escalates owner-reserved choices. |
| Merge, deployment, new budget/access, exact public action | Leo | Remains owner-only under existing policy. |

No default daily meetings, stand-ups, chatroom attendance, or all-employee status calls. A short asynchronous decision record replaces a simulated meeting. Department participation is driven by a real task, not by the number of departments.

## 5. Message classes and responsibility

### 5.1 Separate four concepts

| Class | Example | What it can change |
|---|---|---|
| **Command** | Owner cancels work order; scheduler dispatches an admitted attempt | Only the named action after deterministic authorization and revision checks. |
| **Observed event** | Supervisor reports process exit; review service records a passed gate | Only the state authorized for that trusted producer and exact attempt/version. |
| **Discussion** | Employee suggests a cause; asks about an interface | Conversation state, not execution authority or verified completion. |
| **Decision/approval record** | Authorized PM resolves an in-scope choice; owner approves an exact post | Only its explicitly delegated or owner-approved scope. |

Workers may send discussion types `question`, `answer`, `handoff`, `review_request`, `blocker`, `proposal`, and `note`. `assignment`, `attempt_started`, `checks_verified`, `approval_granted`, and `publication_observed` are produced by their respective trusted services, not accepted as employee-selected message types.

### 5.2 Standard employee message

Use this small template, with fields omitted when irrelevant:

```text
Summary: What changed or what is needed.
Required action: One concrete action, or "information only".
Evidence: Exact task, commit, document revision, or artifact reference.
Unresolved: What remains unknown or blocked.
Reply requested from: One accountable employee, with optional authorized observers.
```

Natural language stays useful. Structured metadata makes it routable and verifiable. Do not force every message into a large machine transcript.

### 5.3 Message authorship

The service derives the actor from authentication. A body saying “From Leo” does not establish owner identity. Employee identity includes its registered machine generation and current task/attempt authority. GitHub-origin text has external origin metadata and remains untrusted feedback even if the webhook signature is valid.

An employee can propose priority or urgency. The service computes effective urgency under policy. It cannot label a routine question `emergency` to bypass quotas.

## 6. Data contracts

### 6.1 Versioning and identity

Use opaque UUIDs for new identifiers; do not encode permissions in names. All wire documents have `schema_version: 1`. Store the immutable company, project/scope, conversation, work-order/task, employee, machine generation, attempt, and correlation references separately where applicable.

Use UTC timestamps for records and an authoritative per-conversation revision for ordering. UUID order and client clocks do not determine causality. Use monotonic clocks for local duration measurements. Cross-machine timestamps are diagnostic unless clock uncertainty is known.

Canonical request hashing uses schema-normalized JSON: sorted object keys, preserved array order and string content, UTF-8, finite safe integers, and no duplicate keys or unpaired surrogates. Do not normalize natural-language text silently. Python and TypeScript implementations must pass shared golden fixtures. Agent-supplied hash values are never trusted over computed ones.

### 6.2 Required records

| Record | Required fields and invariant |
|---|---|
| `Conversation` | ID, company ID, typed scope, kind, task/work-order link, title, revision, lifecycle, visibility revision. `company_ops` is explicit, never a wildcard. |
| `Message` | ID, conversation ID, server-derived actor/origin, type, body, summary, required-action/response-request reference, immutable artifact refs, reply/correlation IDs, effective priority, server sequence, timestamp, content hash. |
| `MessageAudience` | Message ID and authorized recipient/observer IDs. Membership never grants access missing from project policy. |
| `MessageRevision` | Original message ID, new body/digest, editor, reason, revision. Preserve corrections; notified decisions/approvals are not overwritten in place. |
| `Delivery` | Message ID, recipient, delivery ID, state, retries, next retry, expiry, receive/consume receipts, access revision. Unique per message and recipient. |
| `ResponseRequest` | Question message, requester, accountable respondent, owning work order, dependencies, deadline, state, response-task/attempt link, escalation counter. |
| `DecisionDraft` | Proposed choice, alternatives, evidence, affected references, required decision class and revision. No authority by itself. |
| `DecisionRecord` | Draft/version, verified decider and delegation, accepted choice, evidence, affected task/interface versions, superseded decision ID. |
| `CommunicationEvent` | Immutable event ID, producer, aggregate ID/revision, typed scope, attempt/generation where needed, bounded payload/reference, commit sequence. |
| `CommandReceipt` | Principal, command ID, normalized argument hash, action, resulting entity/event IDs, outcome, timestamps. Unique principal + command ID. |
| `TransportOutbox` | Delivery/effect type, destination binding, immutable payload reference/hash, state, retry count, not-before, receipt or uncertainty reason. |
| `WorkerInboxEntry` | Locally persisted delivery/command ID, argument hash, assigned employee/machine/attempt, received/admitted/start state, native execution refs. |
| `AttentionItem` | Recipient, related request/task/incident, reason, safe-point behavior, admitted attempt if any. Not independent permission to run a model. |
| `StreamCursor` | Opaque reference to principal, stream/filter, visibility revision, replay position, and service incarnation. Not an access credential. |
| `ExternalLink` | Project, work order/task, repository ID, GitHub issue/PR ID, permitted integration mode, last verified revision/time. |
| `WebhookReceipt` | Integration binding, delivery ID, raw body digest, event/action, receipt time, processing state. Never stores the webhook secret. |
| `Incident` | Typed scope, fingerprint, severity, current evidence, first/last occurrence, accountable owner, resolution. Repeated failures update the same incident. |

Reuse existing company `TaskSpec`, `Attempt`, `ArtifactRef`, `OwnerApproval`, `RuntimeBinding`, and publication records. Extend them by reference; do not create a second task or approval schema with different semantics.

### 6.3 Example discussion command

This is a company-defined example, not a Maritime API request. IDs are illustrative.

```json
{
  "schema_version": 1,
  "command_id": "8a4e6c1d-8a2d-4ad4-9fe3-693bea9ec1ad",
  "action": "message.send",
  "scope": {"kind": "project", "id": "alpha"},
  "payload": {
    "conversation_id": "login-task-thread",
    "kind": "question",
    "task_id": "login-ui",
    "attempt_id": "frontend-attempt-1",
    "summary": "Confirm the login response contract",
    "body": "Does the current response include display_name? Refer to the agreed interface before I bind the UI.",
    "required_action": "Answer with the current interface reference or explain the missing decision.",
    "response_required": true,
    "recipient_employee_ids": ["E11"],
    "observer_employee_ids": [],
    "artifact_refs": [{"id": "auth-interface", "revision": 3}],
    "reply_to_message_id": null
  }
}
```

The server attaches the authenticated E10 identity, approved runtime binding, machine generation, permitted audience, timestamps, and digest. A payload field attempting to supply `sender_role: owner`, a capability, or an approval is rejected.

### 6.4 Size and content rules

Initial proposed limits: 1 KiB summary, 8 KiB discussion body, 32 KiB total message command, eight recipients/observers combined, eight artifact references, 50 messages per read page, and 256 KiB per page. Count UTF-8 bytes, not characters. Return explicit truncation/pagination metadata; never silently discard a required qualification.

Large source files, traces, screenshots, video, and full logs live in the existing authenticated artifact service. Messages carry immutable IDs/revisions/digests. No base64 media in an inbox, no raw credentials, and no automatically fetched arbitrary URL supplied by an employee.

Requests with unknown fields, ambiguous scopes, mixed-project refs, missing task authority, duplicate recipients, invalid hashes, or incompatible schema versions fail before mutation.

### 6.5 Supporting interface types

Use the following typed results in implementation tasks. They are small validated records, not unconstrained dictionaries. Fields that reference existing company objects reuse their canonical types.

| Type | Required shape / meaning |
|---|---|
| `ValidatedCommand` | Protocol version, command ID, action enum, typed scope, schema-validated payload, and server-computed argument digest. |
| `AuthorizationResult` | Authenticated principal reference, controlling policy revision, permitted action/scope, and current generation checks; never model-authored. |
| `ControlScope` | Exactly one of company, project, work order, or attempt, with its canonical ID and expected controlling revision. Not a wildcard read scope. |
| `ViewFilter` / `InboxQuery` | Allowlisted view/filter fields, permitted canonical scope, bounded limit and opaque cursor. No SQL, raw paths, arbitrary URLs or caller-chosen principal. |
| `InboxPage` / `MessagePage` | Authorized item list, opaque `next_cursor` or null, `has_more`, `observed_at`, and explicit byte/pagination limits. |
| `EventPage` | Authorized events/references, next cursor, service incarnation, visibility revision and observation time. |
| `SnapshotPage` | Fixed snapshot ID, immutable entity/version manifest page, watermark cursor, visibility revision, service incarnation, next page cursor and expiry. |
| `DeliveryEnvelope` | Delivery/message IDs, recipient, delivery generation, message hash/reference, scoped task/attempt refs when present, schema version and validity interval. |
| `DeliveryReceipt` / `LocalReceipt` | Delivery ID, argument hash, stage, authenticated recipient/generation, durable receipt time, and actual model-turn/handler reference for a consumed receipt. |
| `AttentionDisposition` | One of queued, current-attempt safe point, new-task proposal, blocked, or information-only, plus relevant request/task/attempt and reason. |
| `WaitState` | Waiting task, exact dependency/request, current state, checkpoint/termination evidence, and cycle/incident references if any. |
| `ExecutionPermit` | Opaque protected permit reference plus employee/machine/attempt/generation, runtime/input/policy digests, expiry and service incarnation. Secret material never enters a model-visible result. |
| `ResumeResult` | Verified current generation, allowed/blocked state, unresolved observations, and valid pending delivery references. No implicit dispatch. |
| `ContextPacket` | Controlling scope/task/attempt, accepted decisions, source/version refs, bounded message supplements, digest, actual byte count and explicit omissions. |
| `IngressReceipt` | Binding/delivery ID, raw-body digest, committed processing state and observation time, without the secret or full raw payload in logs. |
| `SummaryIntent` | Existing protected publication-intent subtype with linked repository/object, exact body digest, authority reference, provider target ID when known, and logical effect key. |
| `SyncResult` / `EffectObservation` | Provider observations and timestamps, coverage gaps, linked intent/object IDs, explicit queued/observed/uncertain/blocked outcomes, and next permitted reconciliation step. |
| `NotificationRef` | Canonical request/task/decision/incident reference, authorized audience, computed priority, state and deduplication identity. |
| `CommunicationObservation` | Correlation IDs, observed stage, source host/clock class, timing/size values or unavailable states, and redacted failure category. |
| `PrerequisiteReport` / `RecoveryReport` | Candidate/incarnation references, verified dependencies or current-state observations, specific blockers, uncertain effects, and permission to proceed only when independently validated. |
| `OutboxItem` | Alias of the Section 6.2 `TransportOutbox` record, not another effect store. |

`StopReceipt` and `ReconcileReport` reuse the owning supervisor/control-plane contracts. `Actor/Principal`, task capabilities, approvals, and actual scheduling leases remain outside model-writable message payloads.

## 7. Database and transactional guarantees

### 7.1 Storage ownership

Use the control service's local SQLite database with WAL, foreign keys enabled, bounded busy timeout, and `synchronous=FULL` for accepted commands/effect intent. Pin and verify a supported SQLite build, including applicable upstream correctness fixes. WAL allows concurrent readers but only one writer and requires same-host database access; no employee mounts the database over a network. [D1]

Use short transactions. No network request, model call, filesystem upload, or wait for a subscriber inside a write transaction. Keep SSE reads paged and release read transactions promptly so checkpointing is not held open indefinitely.

### 7.2 Atomic send transaction

For `message.send`, the service:

1. Authenticates the caller, checks current scope/machine/attempt authority, validates the command, and resolves all artifact/audience permissions.
2. Looks up `(principal_id, command_id)`. Same normalized payload returns the existing receipt; different payload returns `409 IDEMPOTENCY_CONFLICT`.
3. In one transaction, appends the message, increments conversation revision, creates recipient deliveries and any bounded response request, appends the authoritative event and transport-outbox entries, and stores the command receipt.
4. Commits before returning `accepted`. Subscriber notification happens after commit and is recoverable from the database.

A notification failure cannot roll back an accepted message. A database failure cannot return an accepted receipt. Authorization is rechecked before redelivery and effect execution, not just at creation.

### 7.3 Essential constraints and indexes

Require database constraints for unique command IDs per principal, unique delivery per `(message_id, recipient_id)`, unique webhook delivery per integration binding, unique provider-effect key, and unique active employee-machine/attempt ownership in the existing registry.

Index conversations by `(scope_kind, scope_id, updated_at)`; messages by `(conversation_id, sequence)`; deliveries by `(recipient_id, state, next_retry_at)`; requests by `(respondent_id, state, deadline_at)`; outboxes by `(state, not_before)`; events by scope and sequence; and external links by repository/object identity. Index actual queries and verify plans during performance tests; avoid querying a giant serialized workspace snapshot for every inbox refresh.

### 7.4 Retention and replay safety

Proposed retention candidates: seven days of hot stream replay, thirty days of transport diagnostics, ninety days of ordinary closed-thread messages, and project-lifetime decisions, approvals, accepted-effect identities, and essential evidence. These are not deletion authorization. Automatic retention deletion stays disabled until the owner approves a policy and backup behavior is tested.

Keep compact idempotency/fencing tombstones for the lifetime of the affected work/effect even if prose or diagnostic payloads are removed. An old accepted command must not become “new” because its full receipt aged out. A request outside the retained replay window requires a fresh snapshot, not silent cursor reset.

Do not delete employee disks, source repositories, the sole approved artifact, unresolved-effect records, or required audit evidence to satisfy a mailbox size target. Stop new ordinary intake before disk exhaustion while preserving reserved capacity for stop/recovery metadata.

## 8. Delivery protocol

### 8.1 Guarantees and limits

The design provides durable accepted records and retryable, at-least-once delivery within expiry/retry policy. Consumers must tolerate duplicates. It does not promise global exactly-once execution, delivery through a permanent outage, or exactly-once external GitHub/social effects.

Distinguish these states explicitly:

| Stage | Meaning |
|---|---|
| `accepted` | The company service committed the request and its receipt. |
| `received` | The intended supervisor durably stored the matching payload/hash. |
| `admitted` | The scheduler granted the correct employee/task/budget/capacity and current generation. |
| `started` | The supervisor observed the owned execution process start. |
| `consumed` | A specific model turn or deterministic handler was given the message. Not proof it understood or completed it. |
| `result_submitted` | Output references arrived. They are not yet verified. |
| `verified` | The responsible evidence/review gates accepted the exact result. |

Discussion delivery uses accepted/received/consumed/expired/revoked/stalled states. Task execution uses the existing Attempt lifecycle. Do not create one enum that incorrectly requires every informational message to start a model or every task to wait for a chat reply.

### 8.2 Awake employee delivery

1. A supervisor connects with its machine principal and current generation, then reads its durable inbox.
2. It validates the addressed employee, schema, digest, expiration, and generation. It writes its local journal before sending `received`.
3. Informational discussion is staged in protected scope-tagged storage. It is not injected into an unrelated project or automatically run through an LLM.
4. A real execution instruction requires the existing scheduler's admission. Immediately before starting, the supervisor obtains a current start permit bound to the attempt, runtime, input manifest, and machine generation.
5. The supervisor records execution ownership and reports state transitions using stable event IDs. The service deduplicates them and rejects stale transitions.

A durable `received` ACK does not reserve a staff slot. Only scheduler admission does. Delivery retry counters are separate from the task's two-execution-attempt budget.

### 8.3 Crash windows

The local journal contains `received`, `admitted`, `launching`, `started`, and terminal/uncertain execution states. Starting a child process and storing its PID cannot be assumed atomic. Use an attempt-owned OS execution identity and process containment that the supervisor can reconcile after a crash. If it cannot prove whether an earlier process started or stopped, quarantine the attempt rather than launch it again.

Duplicate deliveries with the same hash return the stored receipt. A duplicate with different content fails closed. Do not use a new message ID to conceal a retry of the same unknown logical operation.

### 8.4 Retry and failure policy

For retryable internal network failures, use exponential backoff starting at one second, capped at sixty seconds, with jitter and at most eight automatic transport retries per episode. Then mark `stalled`, keep the durable item, and create/update an incident. A known sleeping employee is handled through lifecycle wake policy, not eight failed chat attempts.

Permission denial, wrong generation, expired task, schema mismatch, cancelled work, and incompatible runtime are not transient failures. Deliver an explicit blocked/revoked outcome. A message lacking a response can remain an open request without repeated delivery after the supervisor already acknowledged it.

A later authorized reconciliation can start a new delivery episode using the **same logical ID**, provided scope and expiry still permit it. It cannot repeat an unknown external side effect.

## 9. Task discussion, help, and deadlock prevention

### 9.1 Answering a question

A question gets one accountable respondent and an explicit request record. Observers do not all owe an answer. First check whether a current approved decision/interface reference already answers it; deterministic lookup can return that reference without waking another model.

If reasoning is required, choose one of two paths:

- **Same authorized task context:** an employee already working in that project may handle a bounded relevant question at its next safe turn boundary. Record the consumed message IDs and supplemental context version. It remains one foreground task on one machine.
- **Separate response task:** schedule a bounded task for the existing employee. It consumes a normal staff slot, project allocation, and work-order task budget. It is not a free “chat helper.”

If the employee is working on another project, keep the question queued. Do not inject foreign project content or start a second process. The scheduler may propose a qualified substitute with the required access; it may not clone the original employee.

### 9.2 Immutable task inputs versus new discussion

Keep the admitted base/input manifest immutable. New advisory messages are recorded as append-only context supplements with source message revisions and hashes, visible in the attempt trace. They do not change allowed files, acceptance criteria, model settings, or permission grants.

A message that changes the task contract requires a work-order/task revision, invalidation of affected evidence, and safe stop/re-admission. Calling a scope change “clarification” must not bypass that process.

### 9.3 Releasing capacity while blocked

A task waiting for another employee should not occupy a model slot indefinitely. The supervisor checkpoints verifiable outputs, stops the owned runtime/tool tree, confirms termination, and only then releases execution capacity. Keep its durable dependency/request state.

The 1,800-second attempt deadline remains an absolute deadline established at admission; waiting does not silently extend it. Resuming within that deadline uses a new fenced execution segment under the same logical attempt, the same cumulative constraints, and a verified checkpoint. Limit automatic resume segments to two initially. After expiry, the existing next-attempt policy applies; no new IDs may reset deadlines or bypass the two-attempt limit.

If the runtime cannot safely resume, report that capability missing. Do not fabricate continuity by launching a fresh session with broader context and calling it the old execution.

### 9.4 Wait graph and cycle detection

Track `task waits for request/task`, not just `employee waits for employee`. Employees may have unrelated queued assignments. Detect cycles before accepting a new blocking edge and during reconciliation.

For a cycle, create one incident with the involved task/decision references. E02 resolves staffing/sequence conflicts; the project owner or technical lead resolves requirement/interface conflicts; E01 escalates owner-reserved choices. Never let all eight slots remain held by stopped work that has not been reconciled, and never break a cycle by silently bypassing independent review.

### 9.5 Conversation limits

Keep at most three open response requests per task, two automatic question/answer rounds for the same unresolved issue, and the inherited eight-hop handoff bound. Duplicate questions with the same request and input version refer to the existing request. A changed artifact can justify a new question, but must carry the new version and stay within work-order limits.

If a response task would exceed the twelve-task work-order budget, record `needs_scope_decision`. Do not automatically invent another work order to get more capacity.

## 10. Attention, notifications, and escalation

### 10.1 Visibility is not interruption

A project participant may be allowed to read a message without being instructed to act. A department membership is neither a subscription to every project nor permission to load all history.

| Item | Default handling | Model wake? |
|---|---|---|
| Routine process heartbeat or unchanged retry | Supervisor/control telemetry only | No |
| Informational handoff | Store, link, notify assigned recipients | Only when an admitted task needs it |
| Question requiring reasoning | Recipient attention queue | Yes, within an existing eligible attempt or new scheduled task |
| Verified prerequisite ready | Scheduler evaluates dependencies | Only if a new task is admitted |
| Scope ambiguity or decision needed | Appropriate PM/lead queue | Bounded role task; E01 only when needed |
| Owner cancellation or emergency stop | Dedicated deterministic control path | No model required |
| Public-action approval | Owner's trusted decision inbox | No automatic approval or send |

### 10.2 Priorities

Use `control`, `urgent`, `normal`, and `digest` classes. Only authenticated owner controls and trusted incident logic can select `control`. `urgent` must reference a real blocker, expiring approved action, or verified incident; sender preference alone is insufficient.

Control traffic bypasses ordinary-message backlog processing, not authentication or policy. Maintain reserved handler capacity so a noisy project cannot prevent an authenticated stop from being committed.

### 10.3 Proposed timing

For a new unanswered reasoning request, review eligibility after sixty seconds, mark overdue after five minutes, and escalate once after fifteen minutes unless an earlier valid deadline applies. These are operational defaults, not promises of response speed. Queue/capability/quota explanations must remain visible. Paused projects do not generate escalating nuisance reminders.

During authorized quiet hours, collect nonurgent owner notifications. Keep the state visible in Gen immediately. Quiet hours never hide a stop failure, unauthorized-effect risk, or unresolved external publication. No email, SMS, Telegram, Slack, or Discord delivery is enabled by this plan.

### 10.4 Noise controls

Coalesce routine progress into an updated task record rather than a new chat message on every token/tool step. An incident fingerprint includes scope, failure class, affected task/resource, and controlling version. Repeated failures update its occurrence count and latest evidence; they do not create repeated manager turns.

A digest is produced from authorized records only when requested or explicitly scheduled. Prefer a deterministic list with evidence links. Any narrative summary uses the admitted manager/employee model path and quota, not an unaccounted summarizer.

## 11. HTTPS, SSE, and reconnect behavior

### 11.1 HTTPS is the command path

All mutations use authenticated HTTPS with schema validation, argument-aware command IDs, current permission checks, and expected revisions where state is editable. Browser requests also require the approved owner-session/CSRF protections. Model tools cannot supply owner session credentials.

Use per-machine credentials held by the supervisor, not by project code. The company auth contract must bind employee ID, machine ID, generation, allowed API classes, and current access status. Existing provider/model credentials are not reused as company communication credentials.

### 11.2 SSE is a notification and read-model path

SSE streams event notifications and authorized state changes. The standard supports event IDs and reconnect behavior; durable storage/replay remains this application's responsibility. [D2]

Use a same-origin authenticated owner gateway for browser streams. Do not put bearer tokens in query strings. A supervisor may use a streaming HTTP client with its normal authentication header. Generated widgets do not directly receive privileged streams or credentials.

Maintain one stream per authenticated UI client or employee supervisor, not one connection per visible card. Multiplex only authorized views. Reuse Gen's backpressure-aware ledger-reading pattern, but add remote scope, permission-revision, and cursor checks. [G2]

### 11.3 Cursor security and resynchronization

Do not expose a raw global sequence to scoped employees. Use an opaque cursor bound to principal, filter/stream, visibility revision, service incarnation, and internal replay position. A cursor never grants access.

Recheck authorization when opening, replaying, paging, and periodically during a stream. Permission revocation closes affected streams and invalidates cached projections/cursors. Historical access does not authorize future replay. A cursor from another employee, project, or pre-restore incarnation is rejected.

When a cursor is too old or visibility changed, return `RESYNC_REQUIRED`. Fetch a bounded authorized snapshot with a committed watermark, apply it atomically to the client projection, and then consume events after that watermark. Multi-page snapshots must refer to one fixed snapshot manifest/revision, not drifting live pages. No long-lived database transaction should wait for a browser to finish paging.

### 11.4 Flow control

Initial limits: 64 KiB per emitted event, 256 KiB outstanding buffered bytes per connection, and 100 events per replay page. Send event IDs/references rather than large artifact bodies. If the client cannot drain, disconnect it with a resync/reconnect path; the durable ledger remains intact.

Use 15-second SSE keepalive comments only for active connections. Comments are not domain events, receipts, progress, or model triggers. A disconnected awake client may use a bounded incremental read every thirty seconds with backoff. A sleeping employee does not poll and does not keep a connection alive merely to avoid sleep.

Delivery ACKs and stream cursors are separate. Receiving an SSE event does not acknowledge the employee's durable inbox, consume a question, or finish work.

## 12. API and tool surface

### 12.1 Proposed company API

These routes are proposed application endpoints, not vendor APIs. Mount them behind the company authorization boundary. Keep commands separate from queries; pagination and maximum response sizes are enforced centrally.

| Method and route | Purpose | Principal |
|---|---|---|
| `POST /company/v1/commands` | Validated owner/employee commands from an enumerated action set | Owner or scoped employee; action-specific policy |
| `GET /company/v1/me/inbox` | Current principal's authorized deliveries, up to 32 items per page | Owner/employee |
| `POST /company/v1/deliveries/{id}/ack` | Durable `received` or referenced `consumed` receipt | Bound recipient/supervisor |
| `GET /company/v1/conversations/{id}/messages` | Revisioned task/project discussion | Authorized participant |
| `GET /company/v1/projects/{id}/activity` | High-signal project read model | Authorized participant |
| `GET /company/v1/requests` | Scoped unanswered/blocked response requests | Authorized participant |
| `GET /company/v1/decisions/{id}` | Accepted decision and supersession evidence | Authorized participant |
| `GET /company/v1/snapshot` | Fixed authorized read-model manifest and watermark | Owner/scoped employee |
| `GET /company/v1/events` | Cursor-based authorized SSE updates | Owner/scoped supervisor |
| `GET /company/v1/changes` | Bounded replay page when streaming is unavailable | Owner/scoped supervisor |
| `POST /company/v1/attempts/{id}/authorize-start` | Current start permit after scheduler admission | Bound supervisor only |
| `POST /company/v1/attempts/{id}/heartbeat` | Trusted liveness and bounded permit renewal | Bound supervisor only |
| `POST /company/v1/attempts/{id}/result` | Result/evidence submission under existing acceptance contract | Bound supervisor only |
| `POST /integrations/github/webhooks/{binding_id}` | Raw-byte signature verification and durable external receipt | Verified external integration, not owner |
| `GET /company/v1/capabilities` | Safe protocol/access readiness information | Authenticated principal |

Commands include `message.send`, `message.correct`, `request.respond`, `decision.propose`, `decision.accept`, `attention.defer`, and the existing authorized project/work-order control operations. Public publication remains a separate existing publisher action; it is not `message.send`.

### 12.2 Response and error semantics

Return the stored receipt for an accepted duplicate. Use `202` for durable acceptance that is not completed work; `200` for reads/known receipts; `400` for invalid schemas; `401/403` for authentication/permission failure; `404` where revealing resource existence would leak scope; `409` for stale revisions or argument conflicts; `410` for expired cursor/operation; `413` for size caps; `429` with retry guidance for rate limits; and `503` for an unavailable prerequisite or failed durable commit.

Normalized application errors include `SCOPE_DENIED`, `STALE_REVISION`, `STALE_GENERATION`, `IDEMPOTENCY_CONFLICT`, `REQUEST_EXPIRED`, `RESYNC_REQUIRED`, `CAPACITY_WAIT`, `QUOTA_WAIT`, `APPROVAL_REQUIRED`, `POLICY_BLOCKED`, `DELIVERY_STALLED`, and `UNCERTAIN_EFFECT`. Preserve safe diagnostics and correlation IDs. Do not convert exceptions into a successful empty response.

### 12.3 Manager-facing tools

Expose a small tool set: `company_context`, `company_message`, `company_requests`, `company_decision_propose`, `company_work_plan`, and existing bounded task/status/control tools. The manager can request appropriate action, not call arbitrary endpoints or SQL.

Expose smaller employee-specific subsets. A marketing employee can ask for approved build facts; it cannot use communication tools to retrieve repository secrets, provision another machine, or access social-write credentials. Reading a tool schema does not grant that tool.

## 13. Gen V1 integration and user experience

### 13.1 Preserve the product's working model

Keep Gen's conversations, persistent artifacts, user drafts, trusted component catalog, and generative task views. Add company entity references and read models rather than turning the app into a separate fixed Slack clone or a second scheduler. The underlying Gen model-provider adapter remains distinct from a remote employee adapter. [P2]

A project room is a composable view containing a compact activity timeline and linked task threads. A task thread presents discussion, current decision, evidence, and pending actions. The owner inbox presents only decisions and exceptions that require attention. Existing generic components may be reused after their data/action contracts are extended; component existence alone is not operational readiness.

### 13.2 Required views

| View | Required content |
|---|---|
| Company overview | Active projects, unresolved owner decisions, major incidents, and observation freshness. No all-agent prose polling. |
| Employee inbox | Assigned tasks, questions, reviews, effective priority, wait reason, and delivery/consumption state. |
| Task thread | Single canonical discussion history, current scope/versions, referenced artifacts, and accountable respondent. |
| Decision panel | Current accepted decision, decider/delegation, superseded history, and affected tasks. |
| Delivery inspector | Accepted, received, consumed, admitted, started, result, verification, and uncertainty as applicable. |
| GitHub link panel | Actual issue/PR link, last observed provider state, sync mode, pending summary or conflict. |
| Incident view | Deduplicated problem, affected scope, actual evidence, responsible role, and allowed recovery actions. |

Show “received by supervisor” rather than pretending the model read or understood a message. Show “waiting for an eligible task slot” rather than “employee is thinking” when no inference is running.

### 13.3 Trusted actions

Keep owner identity, active environment, connection health, exact approval summary, and emergency stop outside generated content. A generated card may propose or navigate to an action; only trusted UI and the server can authorize it. Do not expose an active “merge” or “deploy” capability under the current scope.

Preserve owner drafts, selections, scroll, open evidence, and edits while live updates arrive. A new message must not move an approval button under the pointer. Stale actions require refresh and re-evaluation instead of silently operating on the newest revision.

### 13.4 Offline and reconnect behavior

The owner can read a clearly labeled cached view when disconnected. No new consequential command is represented as sent or accepted until the server confirms it. Local drafts may be saved, but reconnect must not blindly submit previously prepared approvals, cancels, or changed-scope commands.

Reconnect from the last accepted event cursor, or replace the projection with an authorized snapshot. Preserve local unsent edits as drafts with conflict handling. Closing the owner's client disconnects presentation only; accepted remote work remains governed by the service, not the browser lifetime.

## 14. GitHub integration

### 14.1 Initial modes

Per repository/project, support:

- `disabled`: no integration operations.
- `read_link_only`: read explicitly authorized issue/PR objects and link them to work orders. **Default when enrolled.**
- `summaries_authorized`: add narrowly scoped, sanitized summaries to selected issue/PR locations after explicit project authorization.

New issue creation, public-repository writes, arbitrary comments, automatic issue closure, branch setting changes, and merge/deploy remain disabled unless separately authorized under the owning policy. The existing draft-PR publisher remains a separate capability. No communication setup silently grants Issues-write access.

### 14.2 What belongs in GitHub

One issue may represent a major feature or bug with acceptance requirements. Internal tasks, response requests, and operational discussion remain in the company service. Link task branches and PRs to their work order and issue; do not create an issue for every clarification or heartbeat.

Sync high-signal content only: agreed scope when appropriate, material blockers, reviewable PR links, and final evidence summaries. Use “Refs #...” relationships by default rather than adding automatic closure instructions. A human edit to an issue is external feedback that may require a new accepted requirements revision.

### 14.3 Inbound webhook handling

Subscribe only to required issue/comment, pull-request/review, and relevant check/status events. Exact event names and needed permissions must be validated against the chosen GitHub App/repository configuration during implementation. [D3]

For each inbound delivery:

1. Resolve the server-owned binding and apply size/content-type limits before expensive work.
2. Verify `X-Hub-Signature-256` against the **raw request bytes** using the stored secret and constant-time comparison. Validate event/action and bound repository/installation IDs. [D4]
3. Deduplicate by binding plus `X-GitHub-Delivery`; same ID with different digest becomes a security incident.
4. Persist the verified receipt and processing intent, then return a 2xx response. Do not run a model, fetch a repository, or wait for a publisher before acknowledging.
5. Asynchronously reconcile the linked provider object and create a scoped observation/feedback record.

GitHub documents a ten-second response requirement for this environment. The proposed application target is under two seconds for a durable ACK on an awake healthy service. A failed durable commit returns non-2xx; it must not falsely acknowledge an event that will be lost. [D3]

Proposed webhook body cap is 2 MiB, an application limit rather than a GitHub guarantee. If a legitimate larger payload is refused, record a bounded reconciliation signal for that known binding and fetch permitted linked objects through the API. Do not parse oversized unauthenticated bodies or claim full event-history recovery from a latest-state fetch.

### 14.4 Missed or out-of-order events

Webhooks are signals, not an ordering guarantee. Fetch current object state before changing a provider projection when events conflict or arrive late. Keep historical event provenance without allowing an old event to roll state backward.

GitHub does not automatically redeliver failed deliveries. Use a bounded periodic reconciliation of enrolled open objects and, where the available permission permits, failed-delivery inspection/redelivery. Missing webhook-administration access must not trigger privilege escalation; use permitted object reads and disclose that event-history coverage is incomplete. [D5]

Initial reconciliation interval is five minutes while linked work is active, using cursors/conditional requests where supported and a bounded overlap window for updated timestamps. This is not a promise of five-minute freshness during outage, rate limiting, sleep, or denied access. Store last successful observations separately from last attempted checks.

### 14.5 Outbound summaries and echo prevention

Use the existing restricted GitHub publisher and shared rate-budget service. Do not put write credentials on employees or create another independent publisher. Store an exact authorized summary intent before calling GitHub.

Maintain one company-owned summary comment per linked work order when the integration supports updates. Track its provider ID and last content hash. Do not overwrite human-authored comments. Coalesce routine summary changes to at most once per thirty minutes per work order; material changes can request an earlier update within the shared policy. No automatic LLM turn is needed to format verified task counts and links.

Use a shared local write ceiling of forty writes per hour initially for company GitHub automation, subject to lower actual provider limits and other company publisher demand. This is a conservative design default, not a GitHub entitlement. Read rate-limit headers, honor `Retry-After`, and coordinate all company writes using the same identity. GitHub documents both primary and secondary limits; do not assume a single hourly budget covers every restriction. [D6]

Identify company-origin updates using stored provider object IDs, actor identity, and content digests. A copied marker in an external comment is not trusted. The webhook caused by a company summary updates observation state but does not spawn another summary or agent response.

For a timeout after sending, mark the effect `uncertain`, reconcile the known object and permitted recent history, and stop for owner review if ambiguity remains. Do not blindly repeat a comment or PR creation. No local uniqueness constraint can make an external non-idempotent API exactly-once.

### 14.6 External text is never a command channel by default

Do not execute `/run`, `@agent`, shell commands, new repository links, or apparent approval words from issue comments. Even text authored by a familiar GitHub username is not the authenticated Gen owner session. Convert it into scoped feedback or a draft work-order revision. Enabling a future GitHub command interface is a separate security/authorization change.

A private issue remains external to the company service's access boundary. Only send material approved for that repository, with explicit handling of private source, credentials, cross-project data, and publication classification.

## 15. Sleep, cancellation, and failure behavior

### 15.1 Sleeping computers

Persist pending messages before any wake request. Wake only an employee that has eligible admitted work, reserved awake capacity, and budget authority. Informational messages and unread counts alone do not wake a machine or model.

On wake, the supervisor reconnects, revalidates machine generation and permits, reconciles old process state, then reads its inbox. A stored assignment from before sleep is not automatically still valid. Gen/control scheduled work needs a verified platform-managed wake/reconcile route; in-process timers cannot wake a sleeping machine. Maritime documents platform-held triggers and custom-agent schedules, but actual no-LLM wake behavior and account access require a live gate. [D7]

Do not treat an invoke URL, provider `source` label, or wake event as authenticated company authority. Public webhook-style wake mechanisms must never carry secrets or bypass the company's command admission.

### 15.2 Bounded authority during network loss

For active attempts, propose thirty-second supervisor heartbeats and ninety-second maximum execution-permit leases, bounded by the original attempt deadline. Only the authenticated service renews a permit. Use conservative local deadline handling; clock discontinuity or resumed VM state requires fresh validation before another consequential action.

When a permit expires without renewal, stop initiating model/tool work and begin safe owned-process shutdown. The service marks liveness unknown and does not dispatch a replacement merely because heartbeats stopped. A controlled local computation may already be in progress; report termination uncertainty instead of promising instantaneous stop.

An urgent owner stop commits the publication/dispatch revocation immediately at the control service. In-flight remote work or accepted third-party requests may not stop instantly. Expose that residual state until reconciled.

### 15.3 Required failure behavior

| Failure | Required response |
|---|---|
| POST succeeded but response was lost | Repeat the same command ID/hash; return the stored receipt. |
| Duplicate inbox delivery | Return local durable receipt; do not start another execution. |
| Supervisor crashes after process launch | Reconcile attempt-owned process identity; quarantine unknown start state. |
| Control service restarts | Recover journal/outboxes before dispatch; stale generations remain fenced. |
| Employee is unreachable | Keep request queued/unknown; verify stop or quarantine before reassignment. |
| All staff slots are held by blocked tasks | Checkpoint, stop, and release confirmed slots; evaluate wait cycles and scoped response tasks. |
| Wrong-scope reply arrives | Reject it; do not copy it into another project's context. |
| Attempt reports success after cancellation | Retain forensic evidence as allowed; reject authoritative result/publication. |
| A decision changes after work began | Version the decision; identify affected tasks/reviews; perform authorized replan. |
| GitHub is unavailable | Continue internal authorized work; mark external observations stale; queue permitted intents without blind retries. |
| Provider quota is exhausted | Queue reasoning work; allow deterministic status/stop; do not switch accounts/models. |
| Billing or storage evidence is unsafe | Stop new exposure; preserve existing records and expose the blocker. |
| SSE is disconnected or slow | Recover through durable cursor/snapshot; no task restart caused by UI reconnection. |
| Owner's client closes | Accepted remote work persists; local connection closure is not company cancellation. |
| Artifact upload is incomplete | Message references remain unavailable; do not mark handoff evidence ready. |
| Access is revoked during replay | Stop further delivery and invalidate caches/cursors. Already disclosed data cannot be recalled. |
| A backup is restored | Enter recovery-locked mode, issue a new service incarnation, reconcile effects and principals before resuming. |

### 15.4 Stop controls

Provide company, project, work-order, and attempt scope. `pause` stops new admission; `cancel` revokes affected execution/effect authority and requests termination; `quarantine` isolates an employee; emergency stop freezes all company dispatch/publication but leaves unrelated Maritime resources alone.

Cancel delivery of obsolete actionable requests without deleting discussion or audit evidence. Mark replies after cancellation as late/informational and prevent them from resuming work. Neither an employee nor the manager may free a still-running slot by changing a status label.

## 16. Decisions, knowledge, and context efficiency

### 16.1 Current decision versus discussion history

Every accepted decision records who was authorized to decide it, the choice, its supporting references, affected versions, and what it supersedes. Later corrections create new versions. The manager retrieves the current accepted record first, then relevant discussion only when needed.

A decision is not automatically an owner instruction. Store its authority class. A technical agreement can clarify an interface within scope, but cannot grant a new repository, spend allowance, publishing permission, or altered model route.

### 16.2 Bounded context packet

For a task or response turn, assemble: relevant charter constraints; exact task/input versions; current accepted decisions; unresolved requests; recent directly relevant messages; and immutable evidence references. Load at most sixteen relevant messages and a 16 KiB discussion excerpt initially, within the attempt's existing overall input budget. Return pointers for the rest.

A new turn receives changes since its last consumed-message/context version, not every department transcript. Pinned policy/schema text can be reused if its digest and authorization still match. Cache keys include company, scope, principal/role, source versions, and policy version.

Do not paste source code or video into a question merely because the recipient can access it. Transfer references and let the recipient retrieve the required bounded excerpt through authorized tools.

### 16.3 Search and department learning

Filter authorization before retrieval, ranking, counts, snippets, and summaries. Project knowledge does not become company-wide because a department head reads it. Promote only reviewed, sanitized procedures through the existing knowledge/skill approval path.

Gen's previously inspected whole-store session helper is not reused unchanged for company mode. A company-scoped search must query the company service under an explicit principal and scope, not silently search local personal conversations. [P2]

Agency-Agents references do not create communication permissions, extra employees, automated replies, or new channels. Preserve the eight-source pin, employee allowlist, two-reference/12,000-character load cap, and exclusion of upstream delegation. Their optional guidance is part of the task input provenance, never the routing authority. [P1]

## 17. Security and trust boundaries

### 17.1 Principal separation

The owner, E01, each employee supervisor, GitHub ingress, publisher, and scheduler have separate principals and API allowlists. Employee message fields never select a principal. A model's service token can request allowed planning actions but cannot impersonate a human approval.

Do not invent a new account/provider login mechanism in the communication module. Depend on the company auth service for an established owner session and machine enrollment, and test its scoped contracts. If remote owner authentication does not yet exist, keep remote mutation disabled; local Gen bootstrap is not a substitute. [G3]

Internal machine credentials are unique, revocable, high-entropy service credentials stored by the supervisor. Task capabilities are shorter-lived and restricted to the attempt. They are not model-provider tokens, are never exposed to prompts, and must be rotated/revalidated during controlled replacement or recovery.

### 17.2 Enforcement points

Check scope at command intake, recipient expansion, artifact lookup, inbox read, local context loading, decision acceptance, replay/search, effect publication, and recovery. Sender and recipient must each be entitled to the referenced information. Forwarding is a new checked action, not a permission loophole.

Keep worker code separate from the supervisor's credentials/journal. The worker may invoke admitted message tools; it cannot write a fake receipt directly, alter its machine generation, or connect to the control database. Existing whole-process, filesystem, egress, and browser isolation requirements remain prerequisites.

### 17.3 Untrusted content

Messages, repository text, issue comments, profiles, HTML, SVG, Markdown, URLs, and artifact names are untrusted input. Render inert previews or use established isolated surfaces. No active HTML, arbitrary SQL, automatic tool installation, raw internal URL fetching, or secrets in source previews.

Validate callback signatures and provider IDs separately from visible copy. Redact credentials before logs/diagnostics are shared. Preserve enough redacted correlation and hashes to investigate failures without copying private data across projects.

### 17.4 Revocation and recovery

On membership revocation, invalidate scoped delivery eligibility, stream cursors, cached reads, task capabilities, and queued effects. Stop or quarantine affected active work as policy requires. Revocation prevents future access; it does not retroactively erase data already observed by an employee or external system.

Only one control-service incarnation may dispatch. A restore or replacement that cannot rule out an old active authority stays recovery-locked. Reconcile actual resources and effect receipts, not just the restored database's earlier assumptions.

## 18. Performance and evaluation

### 18.1 What efficiency means here

Optimize for accepted deliverables and low owner effort. Separate transport latency, inbox queue wait, scheduler wait, cold wake, model time, tool time, review time, and owner wait. Do not present faster message delivery as faster software completion when model execution dominates.

Default principles: zero recurring idle LLM calls; no all-to-all model notifications; deterministic status; one authoritative record with multiple views; bounded context supplements; batching of ordinary progress; and early escalation of genuinely blocking loops.

### 18.2 Proposed measurable targets

All numbers below are **initial test targets**, not benchmark results or promises about Maritime.

| Measure | Initial target and measurement condition |
|---|---|
| Internal durable command ACK | p95 <= 250 ms on the control service's measured test environment, excluding cold wake and external network latency. |
| Warm end-to-end inbox notification | p95 <= 1 second from committed message to an awake connected recipient; record network conditions. |
| GitHub durable webhook ACK | p95 <= 2 seconds on an awake healthy service, always below the provider timeout when accepted. |
| Basic status/inbox queries | No model calls; bounded database reads rather than complete transcript loads. |
| Idle model activity | Zero model turns attributable to heartbeat, stream reconnect, or unchanged status. |
| Duplicate logical starts/effects | Zero in the specified fault suite; uncertain external outcomes remain unresolved, not falsely counted as success. |
| Cross-project unauthorized disclosure | Zero in the canary/scope suite; any violation blocks activation. |
| Stream memory | Within configured per-connection buffer; slow readers disconnect/replay rather than grow without bound. |
| Queue fairness | An eligible task receives the existing scheduler's next policy-compatible opportunity; message priority cannot override hard caps. |
| Owner interruption | Stop command can commit without waiting for any model turn or ordinary message backlog. Remote termination time is separately observed. |

### 18.3 Load fixture

Use fake model/runtime providers, 32 machine identities, eight active attempt fixtures, three projects, and up to forty active stream clients. Exercise 10 accepted small messages/events per second for ten minutes, a 100-per-second burst for thirty seconds, reconnects, delayed ACKs, and a slow reader. These are benchmark workloads, not execution estimates or expected normal conversation volume.

Measure CPU, RSS, database write wait, WAL growth, disk latency, event backlog age, ACK percentiles, and lost/duplicate logical outcomes. Record actual machine resources. Failure to meet targets leads to query, transaction, buffering, or resource investigation before adding a broker.

Separately run a small real scenario with normal model settings to measure coordination turns, questions per work order, context bytes, repeated reads, accepted outputs, and owner interventions. Keep model usage unavailable when telemetry cannot establish it. Compare against the same work with the current manager/tools, not a weaker artificial baseline.

## 19. Configuration defaults

The preserved company caps are authoritative defaults from the prior plan. The communication values below are new proposed tuning defaults. Store configuration with a version/digest; changes do not mutate an admitted attempt silently.

```yaml
communication:
  protocol_version: 1
  storage_owner: company_control_service
  transport: https_plus_sse
  message_broker: none
  automatic_llm_polling: false
  peer_to_peer_network_commands: false
  native_subagent_dispatch: false
  max_summary_bytes: 1024
  max_message_body_bytes: 8192
  max_message_command_bytes: 32768
  max_message_recipients: 8
  max_artifact_references: 8
  inbox_page_items: 32
  message_page_items: 50
  max_read_page_bytes: 262144
  max_open_requests_per_task: 3
  max_question_rounds_per_issue: 2
  max_handoff_depth: 8
  max_resume_segments_per_attempt: 2
  response_eligibility_check_seconds: 60
  response_overdue_seconds: 300
  response_escalation_seconds: 900
  retry_initial_seconds: 1
  retry_max_seconds: 60
  retry_max_automatic_attempts: 8
  supervisor_heartbeat_seconds: 30
  execution_permit_max_seconds: 90
  sse_keepalive_seconds: 15
  max_sse_event_bytes: 65536
  max_sse_buffer_bytes: 262144
  event_replay_page_items: 100
  awake_fallback_read_seconds: 30
  hot_replay_days: 7
  automatic_retention_deletion: false
  context_max_recent_messages: 16
  context_max_discussion_bytes: 16384
  email_slack_discord_notifications: false

github_communication:
  default_mode: read_link_only
  new_issue_creation: false
  automatic_issue_closure: false
  comment_command_execution: false
  webhook_body_limit_bytes: 2097152
  active_reconcile_seconds: 300
  routine_summary_min_interval_seconds: 1800
  shared_company_write_ceiling_per_hour: 40
  unknown_effect_retry: reconcile_only

preserved_company_limits:
  total_employees: 32
  department_count: 16
  active_delivery_projects: 3
  simultaneous_staff_tasks: 8
  simultaneous_tasks_per_project: 3
  simultaneous_tasks_per_employee: 1
  independent_manager_slots: 1
  review_slots_within_staff_limit: 2
  simultaneous_marketing_tasks: 2
  simultaneous_media_renders: 1
  tasks_per_work_order: 12
  execution_attempts_per_task: 2
  review_rounds_per_work_order: 2
  attempt_deadline_seconds: 1800
  automatic_merges: false
  production_deployments: false
  paid_inference_fallback: false
  deferred_marketing_channels: [youtube, instagram, tiktok]
```

Validate relationships: permit duration cannot exceed remaining attempt time; context and message budgets must fit the overall attempt manifest limits; review/marketing slots are subsets of the eight staff tasks; and an API quota setting never overrides actual provider limits or account-wide policy.

## 20. Worked scenarios

### 20.1 Frontend asks Backend about Alpha

E10 is implementing Alpha's login UI. It sends a scoped question in the login task thread, referencing interface revision 3. The service stores the message once and addresses a response request to E11. Alpha's project room shows a link to the same record.

If E11 is working in an eligible Alpha task, it receives the question at a safe boundary. If E11 is working on Beta, it remains queued with that reason; no Alpha text enters the Beta model context. If E10 cannot continue, it checkpoints and stops before releasing capacity. The scheduler admits an appropriate E11 response task within the work-order budget.

E11 returns the actual interface reference and an explanation. A clarification within scope is recorded; a changed interface becomes a versioned decision and invalidates affected inputs/reviews. E10 resumes only through the current task/attempt policy. E01 is involved only if scope or priority needs escalation.

### 20.2 QA rejects a code change

E18 reviews an exact commit and finds a seeded defect. The evidence service records failed acceptance; the conversation shows the finding and reproduction reference. The manager cannot turn it green with a reassuring summary.

An eligible repair stays within the two-attempt/two-review-round limits and uses the original logical task branch/PR. If those limits are exhausted, the task stops with evidence and an owner-visible decision. One failed test does not generate messages to every department.

### 20.3 Engineering hands approved facts to Marketing

An approved build/artifact exists for Alpha. E25 requests only the permitted product facts and build references. E28/E29 use their dedicated computers for real capture and editing under the separate marketing workflow. Communication views show the actual artifact versions and outstanding review.

Marketing messages never claim that “build passed” means “released,” and no handoff is permission to post. X/Reddit/website drafts remain draft-only until the existing exact-action approval path is used. A source playbook mentioning TikTok creates no task or channel activation.

### 20.4 GitHub and the network fail mid-work

A linked PR receives a new comment while the company webhook endpoint is unreachable. Internal work continues within already granted authority. The next authorized reconciliation observes the current PR/comment state and records its coverage limits. No employee is instructed to replay the entire repository's issue history.

Separately, a company summary comment is accepted by GitHub but the response is lost. The local intent becomes uncertain. The publisher checks the provider object/history before any retry; it does not create another comment simply because the request timed out. Gen distinguishes “prepared,” “queued,” “uncertain,” and “observed on GitHub.”

### 20.5 A general standard is announced

E22 proposes a sanitized department procedure update. After required review, the department knowledge view points to the accepted version. That bulletin can be visible to all authorized members without creating 32 addressed action messages or model wake-ups. Tasks pin the relevant procedure version when admitted. A company-wide stop, by contrast, is a control operation and is not constrained by the ordinary eight-recipient discussion limit.

## 21. Files and component ownership

### 21.1 Workspace aliases

`CONTROL/` means the existing authorized company control-service repository/workspace. `GEN/` means the inspected Gen-V1 repository/workspace. Resolve both in C00. Paths below are proposed additions or explicit integration points, not claims that the files already exist.

Do not create a new repository to make these aliases convenient. If no control service exists, use the already-authorized setup repository after inspection and implement its prerequisite company-plan components. Do not silently move the whole Python control plane into Gen's TypeScript service.

### 21.2 Proposed layout

```text
CONTROL/
  contracts/communications/v1/*.schema.json    Canonical wire contracts
  contracts/communications/v1/golden/*.json    Cross-language valid/invalid fixtures
  contracts/communications/manifest.json       Schema/version hashes
  src/company/comms/contracts.py              Typed validated records
  src/company/comms/policy.py                 Actor, scope, message-class authorization
  src/company/comms/store.py                  Same-company-DB transactional persistence
  src/company/comms/messages.py               Send/correct/audience operations
  src/company/comms/queries.py                Scoped inbox/thread/decision read models
  src/company/comms/delivery.py               Receipts, retries, expiry, dead letters
  src/company/comms/attention.py              Scheduler-integrated question handling
  src/company/comms/requests.py               Obligations, rounds, deadlines, escalation
  src/company/comms/decisions.py              Versioned decisions and authority
  src/company/comms/streams.py                Opaque cursors, snapshots, bounded replay
  src/company/comms/context.py                Scoped, versioned context packets
  src/company/comms/notifications.py          Deduplicated owner/employee notifications
  src/company/comms/lifecycle.py              Wake/resume/permit integration
  src/company/comms/recovery.py               Recovery-locked reconciliation
  src/company/comms/metrics.py                Queue/delivery/coordination measurements
  src/company/comms/api.py                    Proposed /company/v1 routes
  src/company/integrations/github_ingress.py  Verified webhook receipt only
  src/company/integrations/github_sync.py     Linked-object reconciliation and summary intents
  src/company/worker/comms_client.py          Trusted supervisor inbox/reconnect client
  src/company/worker/inbox_store.py           Local durable delivery/launch journal
  migrations/*_communications.sql            Relational constraints and indexes
  tests/communications/                      Offline, negative, and fault tests
  tests/fixtures/communications/              Synthetic projects, messages, GitHub objects
  tools/communications_benchmark.py           Model-free performance fixture
  tools/communications_acceptance.py          Explicit offline/live acceptance runner
  docs/communications/                       Runbooks, limits, benchmark evidence

GEN/
  packages/company-contracts/communications/  Validated copy/generated types from the pinned bundle
  packages/company-client/communications.ts  Company API client, no task authority
  packages/company-client/streams.ts         Scoped replay and projection synchronization
  packages/core/company-tools.ts             Manager tool bridge
  packages/core/company-context.ts           Scoped company retrieval, not whole local history
  apps/server/company-mode.ts                Isolated company mode and approved gateway integration
  apps/web/src/company/                      Inbox, project/thread, decision and incident views
  tests/company/communications-*.test.ts      Contract/client/tool/projection checks
  tests/e2e/company-communications.spec.ts    Trusted UI and draft/reconnect behavior
  evals/company-communications/               Bounded useful-work comparisons
```

Integrate with existing `scheduler.py`, `policy.py`, `auth.py`, `artifacts.py`, `publisher.py`, `marketing/publisher.py`, and recovery rather than duplicating their authority. Gen's `apps/server/event-stream.ts`, `packages/storage/store.ts`, and artifact/action mechanisms remain useful local primitives; preserve local mode and avoid automatically replacing its protocol with the company protocol.

### 21.3 Contract ownership

The canonical versioned JSON schema bundle lives in CONTROL. GEN receives a pinned reviewed copy/generated representation with its manifest digest. Both use the same golden fixtures and reject unsupported versions. A schema update cannot be deployed by an employee editing a local definition mid-attempt.

`Principal`, `TaskScope`, `Attempt`, `ArtifactRef`, `OwnerApproval`, and scheduler/publication interfaces come from the owning company modules. C01 defines the communication-specific types in Section 6. Interface names in the implementation tasks below are company-defined, not upstream methods.

### 21.4 Test execution convention

Python commands run from CONTROL; pnpm commands run from GEN. All fixtures default to fake infrastructure and no model calls. Live tests require an explicit server-validated owner approval ID, repository/resource scope, budget checks, and disabled production/public effects. A command shown below is a future verification instruction, not a claim it was run while writing this document.

## 22. Implementation tasks C00-C19

Implement in the dependency order shown. Each task ends with a reviewed branch commit only after its checks pass. Do not edit protected/default branches or deploy the result from within an employee task. Where a live prerequisite is unavailable, complete independent offline work and label the gate blocked.

### C00. Freeze scope, candidate, and prerequisite contracts

**Dependencies:** None.

**Files:** CONTROL/docs/communications/preflight.md; GEN/docs/company-communications-baseline.md; tests/communications/test_prerequisites.py.

**Interfaces:** Produce a sanitized `PrerequisiteReport` containing inspected repository commits, schema owners, employee/role targets, current dependency availability, and blocked live gates. Resolve CONTROL and GEN without creating new repositories.

- [ ] **Write the failing tests:** `test_target_roster_and_caps` requires 1 Gen + 17 Hermes + 14 Codex = 32, 16 departments, and the preserved limits. `test_missing_auth_or_scheduler_blocks_live_mode` rejects live operation when an owning dependency is absent. `test_plan_does_not_enable_external_writes` retains draft/read-link-only defaults.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_prerequisites.py -q
```

- [ ] **Implement:** Inspect actual workspaces and current CI/build evidence. Record, rather than guess, which company services exist. Freeze the communication scope and read-only/offline baseline; a newer commit is not automatically a passing candidate.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** The prerequisite report has concrete version references and truthful unavailable states. Existing company requirements are not silently overwritten.

### C01. Versioned contracts and actor policy

**Dependencies:** C00.

**Files:** CONTROL/contracts/communications/v1/; src/company/comms/contracts.py and policy.py; tests/communications/test_contracts.py and test_actor_policy.py; GEN/packages/company-contracts/communications/; tests/company/communications-contracts.test.ts.

**Interfaces:** `validate_command(raw: bytes) -> ValidatedCommand`; `Policy.authorize(principal: Principal, command: ValidatedCommand) -> AuthorizationResult`. Define all Section 6 types. Page types include items, an opaque next cursor, observation time, and coverage/truncation state; event/snapshot pages also carry service incarnation and visibility revision.

- [ ] **Write the failing tests:** `test_utf8_byte_limits` rejects a body over 8192 bytes even when its character count is smaller. `test_actor_is_not_payload` rejects sender/owner/approval injection. `test_golden_hash_parity` gives both languages identical normalized hashes. `test_scope_and_class_boundaries` rejects wildcards, mixed-project refs, unknown fields, more than eight recipients, duplicate JSON keys, and employee-authored trusted events.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_contracts.py tests/communications/test_actor_policy.py -q
# GEN, separately:
pnpm test tests/company/communications-contracts.test.ts --maxWorkers=1
```

- [ ] **Implement:** Implement one canonical schema/fixture bundle and strict validation. Bind authority to the authenticated principal and current task generation, never to descriptive metadata. Pin the bundle digest in each client.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** Valid and invalid golden fixtures agree across Python/TypeScript. No live API or inference is required.

### C02. Atomic communication persistence and command receipts

**Dependencies:** C01.

**Files:** CONTROL/src/company/comms/store.py; migrations/*_communications.sql; tests/communications/test_store.py and test_idempotency.py.

**Interfaces:** `CommsStore.transact(command: ValidatedCommand, principal: Principal) -> CommandReceipt`; `CommsStore.pending_outbox(limit: int) -> list[OutboxItem]`. Extend the same company database and existing transaction ownership.

- [ ] **Write the failing tests:** `test_send_commit_is_atomic` injects failure between message, delivery, event, outbox, and receipt writes and observes all-or-none persistence. `test_same_id_same_args_returns_receipt` stores one logical message after 100 repeats. `test_same_id_changed_args_conflicts` returns 409. `test_no_network_in_transaction` fails on awaited external effects. `test_tombstone_prevents_old_command_recreation` survives payload retention.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_store.py tests/communications/test_idempotency.py -q
```

- [ ] **Implement:** Add relational uniqueness, indexes, migrations, short transactions, post-commit notification, and durable retry state. Recheck current access before returning an old receipt that contains protected references.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** Crash/restart fixtures preserve accepted commands without duplicate logical records. Database durability is not mislabeled external exactly-once behavior.

### C03. Scoped conversations, inbox views, and audience rules

**Dependencies:** C01, C02.

**Files:** CONTROL/src/company/comms/messages.py and queries.py; tests/communications/test_messages.py and test_scope.py.

**Interfaces:** `Messages.send(principal: Principal, command: ValidatedCommand) -> CommandReceipt`; `Queries.inbox(principal: Principal, cursor: str | None, limit: int) -> InboxPage`; `Queries.thread(principal: Principal, conversation_id: str, cursor: str | None) -> MessagePage`.

- [ ] **Write the failing tests:** `test_one_message_multiple_views` observes one stored body/ID in project, task, and recipient views. `test_department_membership_is_not_project_access` blocks unassigned department staff. `test_recipient_cannot_expand_scope` denies a cross-project forward. `test_revoked_access_hides_history_counts_and_refs` blocks replay, snippets, counts, and downloads. `test_company_ops_not_wildcard` preserves finance aggregate limits.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_messages.py tests/communications/test_scope.py -q
```

- [ ] **Implement:** Implement canonical threads, explicit audience references, append-only corrections, and permission-filtered queries. Ordinary append messages do not require every concurrent reader to hold the latest conversation revision; consequential edits and decisions do.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** Alpha/Beta canary facts never cross scopes through any returned view. No message implies employee enrollment or machine wake.

### C04. Durable worker inbox and delivery acknowledgment

**Dependencies:** C02, C03; existing machine authentication/supervisor contract.

**Files:** CONTROL/src/company/comms/delivery.py; src/company/worker/comms_client.py and inbox_store.py; tests/communications/test_delivery.py and test_worker_inbox.py.

**Interfaces:** `Delivery.ack(principal: Principal, delivery_id: str, digest: str, stage: str) -> DeliveryReceipt`; `WorkerInbox.receive(envelope: DeliveryEnvelope) -> LocalReceipt`; `WorkerInbox.reconcile() -> list[LocalObservation]`.

- [ ] **Write the failing tests:** `test_ack_only_after_local_commit` crashes before and after journal persistence. `test_duplicate_delivery_does_not_spawn` returns the same receipt. `test_received_not_consumed_or_complete` preserves distinct states. `test_unknown_launch_is_quarantined` does not start again after ambiguous process creation. `test_replacement_delivery_fences_old_generation` redelivers still-valid messages to the same employee with a new delivery generation while rejecting old ACKs.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_delivery.py tests/communications/test_worker_inbox.py -q
```

- [ ] **Implement:** Implement bounded internal retries, protected per-scope local storage, current start-permit checks, and reconciliation of attempt-owned process identity. Receipt handlers do not run the agent model.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** Only the addressed employee can consume the command. Lost ACKs and duplicated hints cannot create additional logical execution.

### C05. Scheduler-integrated attention and deadlock handling

**Dependencies:** C03, C04; existing scheduler, budgets, checkpoints.

**Files:** CONTROL/src/company/comms/attention.py; scheduler integration; tests/communications/test_attention.py and test_wait_graph.py.

**Interfaces:** `Attention.route(request_id: str) -> AttentionDisposition`; `Attention.block(task_id: str, dependency_id: str) -> WaitState`; the owning scheduler remains the only admission authority.

- [ ] **Write the failing tests:** `test_question_is_not_free_inference` queues a response under normal staff/project caps. `test_busy_other_project_receives_no_context` keeps Alpha out of a Beta turn. `test_all_slots_waiting_release_only_after_stop` makes capacity available after confirmed checkpoint/termination. `test_wait_cycle_escalates_once` records one incident. `test_help_respects_twelve_task_cap` returns needs_scope_decision. `test_resume_keeps_deadline_and_attempt_budget` rejects hidden timeout resets.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_attention.py tests/communications/test_wait_graph.py -q
```

- [ ] **Implement:** Route same-task questions at safe boundaries, otherwise propose a bounded response task. Track task/request dependencies, limited execution segments, immutable base inputs, supplemental context versions, and qualified existing substitutes.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** No extra employee, parallel hidden process, fourth delivery project, or ninth staff task is created to answer a question.

### C06. Response obligations, decisions, and bounded escalation

**Dependencies:** C03, C05.

**Files:** CONTROL/src/company/comms/requests.py and decisions.py; tests/communications/test_requests.py and test_decisions.py.

**Interfaces:** `Requests.respond(principal: Principal, command: ValidatedCommand) -> CommandReceipt`; `Decisions.accept(principal: Principal, command: ValidatedCommand) -> CommandReceipt`. Accepted decisions reference delegated authority, expected revision, and affected versions.

- [ ] **Write the failing tests:** `test_one_accountable_respondent` avoids multi-agent reply storms. `test_two_rounds_then_escalation` and `test_eight_hop_limit` bound chatter. `test_pm_cannot_approve_publication` rejects authority expansion. `test_superseded_answer_not_current_decision` preserves history. `test_decision_change_invalidates_affected_evidence` updates only the dependency scope. `test_paused_project_has_no_reminder_storm` suppresses repeated escalation.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_requests.py tests/communications/test_decisions.py -q
```

- [ ] **Implement:** Implement request state/deadlines, resolved/withdrawn/superseded distinctions, exact decision versions, and a single escalation path to the proper role. Never mark a question resolved merely because its delivery was acknowledged.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** A reader can determine who owes the next response and which accepted decision controls current work.

### C07. Authorized snapshots, replay, and SSE backpressure

**Dependencies:** C02, C03.

**Files:** CONTROL/src/company/comms/streams.py; tests/communications/test_streams.py; GEN/packages/company-client/streams.ts; tests/company/communications-streams.test.ts.

**Interfaces:** `Streams.snapshot(principal: Principal, view: ViewFilter) -> SnapshotPage`; `Streams.page(principal: Principal, cursor: str, limit: int) -> EventPage`. A fixed snapshot manifest carries a watermark; cursors bind principal/filter/access revision/incarnation.

- [ ] **Write the failing tests:** `test_snapshot_then_event_no_gap` races a commit with snapshot construction. `test_cursor_cannot_change_scope` denies foreign/forged cursors. `test_revocation_closes_stream` removes future access. `test_old_cursor_requires_snapshot` does not skip history silently. `test_slow_reader_bounded_memory` disconnects at the buffer bound. `test_keepalive_no_domain_event_or_llm` distinguishes transport activity.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_streams.py -q
# GEN, separately:
pnpm test tests/company/communications-streams.test.ts --maxWorkers=1
```

- [ ] **Implement:** Adapt the existing ledger/drain pattern through the new company client and scoped service. Keep inbox ACKs independent from replay cursors; add bounded fallback reads only for awake clients.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** A reconnect updates the UI projection without reissuing tasks, approvals, or model turns.

### C08. Gen company tools and trusted owner gateway integration

**Dependencies:** C01, C03, C06, C07; approved owner authentication.

**Files:** GEN/packages/company-client/communications.ts; packages/core/company-tools.ts and company-context.ts; apps/server/company-mode.ts; tests/company/communications-tools.test.ts. CONTROL/src/company/comms/api.py.

**Interfaces:** `CompanyClient.command(command: CompanyCommand) -> Promise<CommandReceipt>`; `CompanyClient.inbox(query: InboxQuery) -> Promise<InboxPage>`. Tool calls use the manager principal; trusted owner controls use the separate authenticated owner path.

- [ ] **Write the failing tests:** `test_manager_tool_not_owner_identity` rejects an approval-shaped payload. `test_company_mode_blocks_local_delegate` preserves the dedicated-machine rule. `test_status_requires_zero_model_calls` uses service reads. `test_owner_stop_during_model_outage` bypasses E01. `test_remote_bootstrap_not_local_auth` rejects unauthenticated public access. `test_personal_mode_unchanged` guards existing local behavior.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
pnpm test tests/company/communications-tools.test.ts --maxWorkers=1
pnpm typecheck
```

- [ ] **Implement:** Add a small typed tool bridge and isolated company configuration. Do not add direct database, unrestricted HTTP, model-provider-token, or arbitrary remote-shell access. Block live remote commands when the owner gateway prerequisite is absent.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** Gen can inspect and propose company work through the scoped service while direct human controls retain independent authority.

### C09. Project rooms, employee inboxes, and trusted action views

**Dependencies:** C07, C08.

**Files:** GEN/apps/web/src/company/; existing catalog/action integration; tests/company/communications-views.test.ts; tests/e2e/company-communications.spec.ts.

**Interfaces:** Consume only authorized company read models and immutable action envelopes. Produce view state and normal API commands; never write company task records locally.

- [ ] **Write the failing tests:** `test_shared_message_identity_across_views` shows one conversation record. `test_delivery_badges_are_honest` distinguishes received/consumed/verified. `test_draft_survives_stream_reconnect` retains edits. `test_generated_card_cannot_approve` routes to trusted controls. `test_stale_action_rejected` checks revision changes. `test_keyboard_stop_and_review` verifies accessible interaction without layout-shift misclicks.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
pnpm test tests/company/communications-views.test.ts --maxWorkers=1
pnpm build
pnpm exec playwright test tests/e2e/company-communications.spec.ts
```

- [ ] **Implement:** Implement compact project/task views, decision and incident panels, evidence links, and a plain trusted fallback. Reuse components where suitable; do not build a second general chat application.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** The owner can identify blockers, inspect evidence, and stop work even when generated presentation fails.

### C10. Verified GitHub ingress and missed-event recovery

**Dependencies:** C01, C02, C03; enrolled read-only repository binding.

**Files:** CONTROL/src/company/integrations/github_ingress.py; tests/communications/test_github_ingress.py and test_github_reconciliation.py.

**Interfaces:** `GithubIngress.receive(binding_id: str, headers: Mapping[str, str], raw_body: bytes) -> IngressReceipt`; `GithubSync.reconcile(link_id: str) -> SyncResult`, reporting observed versions and coverage gaps.

- [ ] **Write the failing tests:** `test_signature_uses_raw_utf8_bytes` rejects tampering and reserialization errors. `test_delivery_id_reuse_with_changed_hash` creates an incident. `test_ack_after_commit_before_model` has no model call. `test_repo_binding_mismatch` rejects foreign events. `test_out_of_order_webhook_reconciles_current_state` avoids rollback. `test_no_webhook_admin_permission_uses_scoped_reads` does not elevate access. `test_oversize_payload_flags_bounded_reconciliation` handles the application cap.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_github_ingress.py tests/communications/test_github_reconciliation.py -q
```

- [ ] **Implement:** Verify signatures, persist receipts, and process asynchronously. Add a bounded periodic check of enrolled linked objects; latest-state recovery is not represented as complete historical delivery.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** No webhook/comment automatically authorizes work, spending, public content, or a new repository.

### C11. Selective GitHub summaries and external-effect reconciliation

**Dependencies:** C10; existing restricted publisher and shared rate budget.

**Files:** CONTROL/src/company/integrations/github_sync.py; publisher integration; tests/communications/test_github_summary.py and test_github_uncertainty.py.

**Interfaces:** `GithubSync.propose_summary(link_id: str, evidence: list[ArtifactRef]) -> SummaryIntent`; `GithubSync.reconcile_effect(intent_id: str) -> EffectObservation`. The publisher, not the integration worker, owns writes.

- [ ] **Write the failing tests:** `test_read_link_only_never_writes` preserves the default. `test_one_summary_comment_per_work_order` updates the stored provider ID. `test_company_echo_does_not_spawn_work` prevents loops. `test_copied_marker_not_trusted` treats it as external input. `test_timeout_does_not_duplicate_comment` stays uncertain until evidence. `test_shared_rate_budget_and_retry_after` limits all company writes together. `test_human_comment_not_overwritten` protects external edits.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_github_summary.py tests/communications/test_github_uncertainty.py -q
```

- [ ] **Implement:** Use exact authorized summary intents, coalescing, immutable hashes, the shared effect outbox, and provider observation. Keep issue creation/closure and public writes disabled without separate authority.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** An internal conversation remains useful during a GitHub outage; no guessed receipt or duplicate public effect is used to make the UI look complete.

### C12. Sleep-aware delivery, permits, and liveness

**Dependencies:** C04, C05; existing Maritime lifecycle and auth/budget gates.

**Files:** CONTROL/src/company/comms/lifecycle.py; worker supervisor integration; tests/communications/test_wake.py and test_permits.py.

**Interfaces:** `Lifecycle.on_resume(employee_id: str, generation: int) -> ResumeResult`; `Lifecycle.renew(attempt_id: str, principal: Principal) -> ExecutionPermit`. Actual platform operations use the verified existing adapter.

- [ ] **Write the failing tests:** `test_information_does_not_wake_model` keeps ordinary messages pending. `test_wake_requires_reserved_capacity` respects actual awake limits. `test_expired_assignment_after_sleep_cannot_start` revalidates on resume. `test_permit_expiry_stops_new_work` uses thirty/ninety-second policy. `test_clock_discontinuity_requires_revalidation` handles snapshots. `test_no_laptop_platform_wake` is separate live evidence, not a mocked success.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_wake.py tests/communications/test_permits.py -q
```

- [ ] **Implement:** Add durable wake intent and resume reconciliation. Verify a permitted non-LLM platform wake path before enabling unattended schedules. Disconnect idle streams rather than using them to defeat sleep.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** Dormant employees retain messages and identity without periodic inference. Unsupported wake/auth behavior remains a named blocker.

### C13. Priority stop, cancellation, and late-result fencing

**Dependencies:** C04, C05, C12; existing process supervisor and publishers.

**Files:** CONTROL/src/company/comms/lifecycle.py and recovery.py; tests/communications/test_cancel.py and test_partition.py.

**Interfaces:** `Company.cancel(scope: TaskScope | ControlScope) -> ReconcileReport` integrates with existing authority; `Supervisor.terminate(attempt_id: str, generation: int) -> StopReceipt` confirms or quarantines owned work.

- [ ] **Write the failing tests:** `test_cancel_commits_during_message_flood` preserves control priority. `test_cancel_alpha_leaves_beta_running` preserves scope. `test_late_success_cannot_publish_or_release_new_slot` fences old state. `test_partition_not_proof_of_termination` refuses duplicate replacement. `test_cancel_during_render_browser_test` covers descendants. `test_already_accepted_external_effect_reported_uncertain` does not pretend cancellation recalled it.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_cancel.py tests/communications/test_partition.py -q
```

- [ ] **Implement:** Revoke task/effect capability before interruption, keep cancellation state durable, and reconcile termination before freeing ownership. Use no machine deletion or silent employee rebinding.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** The owner sees committed stop authority separately from confirmed remote termination and residual external effects.

### C14. Scoped context, decision retrieval, and knowledge handoff

**Dependencies:** C03, C06, C08.

**Files:** CONTROL/src/company/comms/context.py; GEN/packages/core/company-context.ts; tests/communications/test_context.py; tests/company/communications-context.test.ts.

**Interfaces:** `Context.build(principal: Principal, task_id: str, attempt_id: str, after_version: str | None) -> ContextPacket`, containing current decisions, relevant message revisions, evidence refs, bounds, and provenance digest.

- [ ] **Write the failing tests:** `test_context_has_only_authorized_changes` omits unrelated history. `test_sixteen_messages_and_byte_budget` respects configured caps without truncating policy. `test_old_decision_not_current_fact` retains supersession. `test_search_counts_and_cache_do_not_leak` uses canaries. `test_company_search_never_falls_back_to_personal_store` protects local history. `test_playbook_does_not_expand_channels_or_staff` preserves prior marketing limits.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_context.py -q
# GEN, separately:
pnpm test tests/company/communications-context.test.ts --maxWorkers=1
```

- [ ] **Implement:** Prefer accepted facts and exact source references; load bounded discussion deltas at safe boundaries. Route any summarization through normal authorized inference rather than a hidden helper.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** New sessions can continue useful work without a whole-company transcript or cross-project memory leakage.

### C15. Notification policy and incident aggregation

**Dependencies:** C06, C07, C13.

**Files:** CONTROL/src/company/comms/notifications.py; tests/communications/test_notifications.py; owner/employee notification projections.

**Interfaces:** `Notifications.evaluate(event_id: str) -> list[NotificationRef]`; incident identity includes typed scope, failure class, controlling version, and affected resource.

- [ ] **Write the failing tests:** `test_ten_identical_retries_one_incident` updates evidence instead of creating ten alerts. `test_quiet_hours_preserve_urgent_failure` keeps severe issues visible. `test_no_external_notification_channel_enabled` sends no email/chat. `test_informational_visibility_no_model_wake` separates reading from action. `test_paused_scope_no_escalation_storm` and `test_control_priority_not_sender_chosen` enforce policy.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_notifications.py -q
```

- [ ] **Implement:** Produce deterministic notices for decisions, verified completion, genuine blockers, unsafe budgets, and incidents. No periodic managerial meeting or mandatory narrative status update.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** The owner inbox remains useful under retry noise without suppressing distinct serious failures.

### C16. Observability and model-free performance validation

**Dependencies:** C02, C07, C12, C15.

**Files:** CONTROL/src/company/comms/metrics.py; tools/communications_benchmark.py; tests/communications/test_metrics.py and test_backpressure.py; docs/communications/performance.md.

**Interfaces:** `Metrics.observe(observation: CommunicationObservation) -> None`; benchmark CLI supports `--profile baseline --fake-workers 32 --no-model` and uses the Section 18 workload. No real infrastructure endpoint is selected by default.

- [ ] **Write the failing tests:** `test_timing_categories_separate` distinguishes delivery, queue, wake, inference, tools, and review. `test_unknown_telemetry_not_zero` retains unavailable values. `test_stream_and_log_buffers_bounded` exercises slow consumers. `test_health_updates_no_llm_or_chat_spam` coalesces unchanged observations. `test_benchmark_cannot_call_live_provider` fails on attempted external inference.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_metrics.py tests/communications/test_backpressure.py -q
python tools/communications_benchmark.py --profile baseline --fake-workers 32 --no-model
```

- [ ] **Implement:** Capture redacted correlation IDs, percentiles, queue age, write contention, memory, disk/WAL growth, and failures. Report actual hardware and any missed target; do not tune away safety to improve latency.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** A repeatable report distinguishes proposed targets from observed results and identifies the real bottleneck before any broker proposal.

### C17. Backup, restore, retention, and controlled upgrades

**Dependencies:** C02, C07, C11, C13; existing company backup policy.

**Files:** CONTROL/src/company/comms/recovery.py; tests/communications/test_restore.py and test_upgrade.py; docs/communications/recovery.md.

**Interfaces:** `Recovery.restore(backup_ref: ArtifactRef, approval: OwnerApproval) -> RecoveryReport`; `Recovery.reconcile() -> RecoveryReport`. Restore starts locked and changes service incarnation before new dispatch.

- [ ] **Write the failing tests:** `test_restore_does_not_replay_external_effect` holds unresolved intents for provider reconciliation. `test_old_cursor_and_capability_rejected` invalidates prior incarnation authority. `test_stale_credentials_not_restored_over_newer_state` preserves safe provider auth lifecycle. `test_retention_preserves_effect_tombstones` prevents old command recreation. `test_schema_mismatch_blocks_old_client` rejects incompatible semantics. `test_no_second_active_control_authority` protects split-brain.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications/test_restore.py tests/communications/test_upgrade.py -q
```

- [ ] **Implement:** Use a consistent SQLite backup mechanism, preserve receipts/approved evidence, and integrate company-principal revalidation. Keep automatic deletion disabled until separately authorized. Record backup recovery-point limits honestly.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** Recovery can resume only after current machines, permissions, uncertain effects, and scheduler ownership are reconciled.

### C18. Integrated offline acceptance and security regression

**Dependencies:** C00-C17.

**Files:** CONTROL/tests/communications/test_acceptance.py; GEN/tests/company/communications-integration.test.ts; shared fixtures and docs/communications/verification.md.

**Interfaces:** Implement every applicable acceptance case in Section 23 using typed fake adapters with explicitly simulated receipts. Consume the same contracts as live clients.

- [ ] **Write the failing tests:** `test_two_projects_and_question_handoff` proves scoped parallel scheduling in fixtures. `test_all_wait_and_recovery` releases confirmed slots without clones. `test_owner_laptop_disconnect` does not cancel accepted work. `test_github_malicious_comment_inert` prevents authority escalation. `test_marketing_draft_handoff_no_publication` preserves deferred channels. Add the remaining Section 23 negative/fault cases with IDs in results.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python -m pytest tests/communications -q -m "not live"
# GEN, separately:
pnpm test tests/company --maxWorkers=1
pnpm typecheck
pnpm build
```

- [ ] **Implement:** Resolve contract, security, and recovery regressions without weakening assertions. Run required existing Gen/company regression checks, not only the new focused suite. Keep skipped/unavailable checks explicit.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** A report maps each acceptance ID to passed, failed, simulated, or blocked. Passing fakes is not reported as real separate-machine proof.

### C19. Bounded live proof, measured adoption, and final handoff

**Dependencies:** C18; explicit live authorization and all relevant company prerequisites.

**Files:** CONTROL/tools/communications_acceptance.py; docs/communications/live-proof.md and operations.md; GEN/evals/company-communications/.

**Interfaces:** Acceptance CLI requires `--mode live --approval-id OWNER_APPROVAL_ID`; the service validates that ID, exact resources, scope and budget. The string/file itself is not an authorization token. Offline mode is the default.

- [ ] **Write the failing tests:** Prove manager-to-employee communication on actual dedicated machines, a received ACK surviving supervisor restart, same-project handoff, two-project isolation, scoped cancel, owner-client reconnect, and actual sleep/wake. A separate permitted GitHub write/PR test is optional and must not be invented when only read access is authorized.
- [ ] **Run the focused verification before implementation** and confirm the failure is missing behavior, not an invalid fixture:

```text
python tools/communications_acceptance.py --mode offline
# Only after separate authorization, not while preparing this plan:
python tools/communications_acceptance.py --mode live --approval-id OWNER_APPROVAL_ID
```

- [ ] **Implement:** Use a small existing authorized fleet, not all 32 machines. Compare useful outcomes and owner effort under equal models/tools. Preserve unknown provider behavior and blocked live paths. Produce actual IDs, evidence hashes, observations, config digests, rollback controls, and continuing-cost disclosure.
- [ ] **Rerun the focused checks** and relevant existing regressions. Record exact command, candidate revision, exit status, test count, skips, and limits.
- [ ] **Review and commit only passing work** on the authorized implementation branch, with no credentials, live tokens, or sensitive raw logs.

**Done when:** Report the achieved activation stage, not generic completion. No implementation, deployment, account access, or performance superiority is implied until matching evidence exists.

## 23. Integrated acceptance matrix

Every result must identify candidate code/config/schema versions, real versus simulated infrastructure, and its evidence. The expected observations are future tests, not statements of current capability.

| ID | Scenario | Required observation | Owning tasks |
|---|---|---|---|
| A01 | One handoff appears in four views | One canonical message/body, appropriate per-recipient delivery records, no copied divergent history | C03, C09 |
| A02 | Same send repeated 100 times | One logical message and identical accepted receipt | C02, C04 |
| A03 | Same command ID with changed body | Conflict; no second mutation | C01, C02 |
| A04 | Crash between task/message/outbox writes | All committed together or none accepted | C02 |
| A05 | Worker crashes before/after receive ACK | Durable local inbox determines recovery; delivery is not mistaken for completion | C04 |
| A06 | Crash after native process launch before PID receipt | Reconciliation or quarantine; no blind duplicate execution | C04, C13 |
| A07 | Reply cites an obsolete interface | Historical reply preserved; current decision and affected evidence remain correct | C06, C14 |
| A08 | Respondent is working on another project | Request queues; no foreign context enters its active turn | C05, C14 |
| A09 | Eight workers are waiting for answers | Confirmed checkpoints/stops release capacity; cycles become one incident | C05 |
| A10 | Response would be task 13 | Needs-scope state, no automatic follow-on work order | C05, C06 |
| A11 | Circular question/reply loop | Two-round/eight-hop defaults stop repeated chatter and identify the decision owner | C06 |
| A12 | Old generation submits late success | No accepted completion, publication, or release of a new attempt's slot | C04, C13 |
| A13 | Informational message to sleeping employee | Persisted inbox only; no unnecessary machine/model wake | C12 |
| A14 | Three projects plus company operations and marketing | All existing company/project/employee/review/marketing/render limits remain enforced | C05, C18 |
| A15 | Slow SSE reader and event burst | Bounded buffering, disconnect/replay; terminal evidence remains durable | C07, C16 |
| A16 | Membership revoked during replay/search | No further payloads, counts, snippets, or artifact access from the revoked scope | C03, C07, C14 |
| A17 | State changes during snapshot/reconnect | One fixed snapshot watermark followed by complete permitted deltas; no repeated actions | C07, C09 |
| A18 | Generated UI imitates an approval | No authority; trusted exact-action view remains required | C08, C09 |
| A19 | Unauthenticated caller reaches old bootstrap pattern | No company session, read, or mutation is authorized | C08 |
| A20 | Message contains script, tool instructions, or secret-upload request | Inert content; action policy is unchanged | C01, C03, C09 |
| A21 | GitHub signature, body, binding, or delivery ID is tampered | Rejected or quarantined before action; no model call | C10 |
| A22 | Webhook was missed or arrived out of order | Bounded provider reconciliation, explicit historical-coverage limitation | C10 |
| A23 | Company summary creates its own webhook | Observation updated, no recursive model/summary loop | C11 |
| A24 | GitHub accepted a comment but response was lost | Uncertain intent reconciled; no blind duplicate write | C11 |
| A25 | GitHub secondary limit or shared budget exhausted | Respect provider guidance and shared company ceiling; retain queued permitted work | C11 |
| A26 | Cancel Alpha during Beta work | Alpha authority revoked and termination reconciled; Beta remains permitted | C13, C19 |
| A27 | Network partition/expired execution permit | No new authorized work after expiry; uncertain processes are not silently reassigned | C12, C13 |
| A28 | Repeated status reads and idle heartbeats | Zero model turns; no chat-message flood | C08, C15, C16 |
| A29 | Finance or a department summary requests raw unrelated code | Denied before retrieval and summarization | C03, C14 |
| A30 | Marketing handoff or playbook mentions deferred channels | No YouTube/Instagram/TikTok task, account, publishing, or analytics activation | C14, C18 |
| A31 | Owner edits draft while updates/reconnect occur | Local edits survive; stale publication approval does not apply | C09 |
| A32 | Restore an older backup | New incarnation, revalidated principals, fenced old workers, no external-effect replay | C17 |
| A33 | Provider quota/auth or billing prerequisite fails | Reasoning/new exposure blocks; deterministic stop/status still work; no paid fallback | C00, C12, C18 |
| A34 | Worker claims tests passed without matching evidence | Result remains unverified; GitHub/Gen summaries do not promote the claim | C11, C18, C19 |
| A35 | Storage pressure or retention request | Preserve essential receipts/identities; no automatic destructive cleanup | C02, C17 |
| A36 | Cold wake versus warm delivery measurement | Separate latency categories and actual resources; no unsupported performance claim | C12, C16, C19 |

## 24. Activation and rollout

### Stage 0: Candidate and dependency proof

Freeze source/schema/configuration versions. Establish required existing regressions and identify absent dependencies. Approve no new cloud spending or integrations merely because a test fixture exists. Record the Gen manager target separately from the actual deployed manager.

### Stage 1: Read-only communication workspace

Use synthetic fixtures to show project rooms, task threads, inboxes, decisions, and delivery states. Then use authorized company read data if available. No worker dispatch, GitHub write, model wake, or external notification is required to validate the views.

### Stage 2: Small durable transport proof

After explicit live authorization, use existing approved dedicated machines to prove authenticated delivery, local ACK persistence, duplicate handling, reconnect, and current generation checks. Do not provision the full roster. Report separately whether actual model reasoning was exercised or only supervisor delivery.

### Stage 3: Useful collaboration and concurrent projects

Prove a same-project question and handoff on different employee machines, then overlap Alpha/Beta work without context leakage. Pause/cancel one project while the other continues. Use the authorized smoke repository's separate packages if only one work repository is enrolled; that is not a multi-repository proof.

Include independent review and a real draft PR only when the existing publisher/repository/live authorization permits it. Otherwise state that communication is verified but code publication is not live-tested.

### Stage 4: Marketing and departmental handoffs

Prove an approved engineering-to-marketing facts/artifact handoff, draft discussion, and owner preview while another project's permitted work continues. Existing media-production gates still own the actual video proof; a message containing a filename is not evidence of a real recording.

Activate additional department workflows only as their own capabilities and budgets pass. This communication plan does not redefine full-company readiness as merely registering 32 inboxes.

### Stage 5: Optional GitHub summary writes

Enable one selected private-repository summary route after explicit content/scope authority, actual credentials, webhook validation, rate handling, and uncertain-effect reconciliation pass. Read-link mode remains useful without write permission. No social-platform publication is part of this stage.

### Stage 6: Operational adoption

Run the declared load/fault fixtures, controlled live recovery, and useful-work comparisons. Assess correctness, owner intervention, repeated questions, queue fairness, and actual resource use. A lower latency number cannot compensate for scope leakage or duplicate effects. Expand only the demonstrated capabilities; retain a manual/trusted fallback.

## 25. Operator runbook

These are required future product controls and procedures, not tools already deployed by this plan.

### 25.1 Message appears stuck

Inspect its canonical ID, current access, delivery stage, recipient machine state, response request, and scheduler reason. Distinguish delivery failure from a successfully received question waiting for model capacity. Reconcile before retry; use the same logical ID. Do not wake every employee or create a second copy to “unstick” it.

### 25.2 Employee is offline or has uncertain work

Freeze new assignments for that employee, inspect the last permit and owned process evidence, and use the existing scoped lifecycle recovery. Quarantine unknown termination. A replacement is a controlled machine-generation change preserving employee identity, not another employee created by a chat request.

### 25.3 GitHub synchronization is stale

Show the last successful provider observation and queued/uncertain intent. Check binding permission and rate status, then perform bounded linked-object reconciliation. Do not request broader administration access merely to inspect failed webhook logs. Preserve useful internal work during the outage.

### 25.4 Emergency stop

Commit the authenticated scoped stop first. Freeze future dispatch/publication; revoke affected capabilities; request native/child-process termination; reconcile known external effects; and report any uncertain remainder. Do not delete machines, reset billing, or touch unrelated account resources.

### 25.5 Backup and restore

Use SQLite's consistent backup facilities, not a blind copy of an actively changing main database file that ignores WAL state. Verify checksums and a restoration test. Backup frequency, off-machine storage, retention and costs need approved policy; no backup means no claimed disaster-recovery guarantee. [D8]

Restore into recovery-locked mode. Create a new service incarnation, invalidate pre-restore owner sessions/task capabilities, and revalidate or rotate company machine principals so previously revoked access cannot resurrect from stale records. Do not restore provider refresh files over newer active credential state. Reconcile actual machines, GitHub/social effects, approvals and outboxes before dispatch.

A backup can omit accepted work created after its snapshot. Report the actual recovery point and any gap; do not promise zero data loss. Imported or replayed history is read-only until explicit reconciliation establishes current authority.

### 25.6 Protocol and schema upgrades

Drain or fence affected attempts at safe boundaries. Pin schema/runtime/config versions, back up before migration, and test old-client behavior. An additive field is not silently compatible with a strict old validator: negotiate a supported version or emit the agreed older subset. Unsupported clients stay blocked, not partially functional with altered semantics.

Roll back only to a schema-compatible approved release. Restoring an old executable alone must not overwrite newer messages, approve stale actions, or start another coordinator. Keep actual activation records and dependency version digests.

### 25.7 Configuration and retention changes

Treat timing/rate/retention changes as reviewed administrative configuration, not model-written suggestions applied immediately. Apply between affected attempts. Any retention deletion requires owner-approved scope and preservation of audit/effect identities. An incident replay reconstructs views only; it never reexecutes commands.

## 26. Deferred upgrades and non-goals

### 26.1 When to reconsider the transport

Evaluate a broker only if measured throughput, fan-out, replay demand, or operational availability requires it after query/transaction/buffering improvements. NATS JetStream is a candidate because it provides persistent streams and acknowledgment/redelivery mechanisms; at-least-once delivery still requires application deduplication and external-effect reconciliation. [D9]

A later broker sits behind the communication delivery interface. It must not become a second scheduler, give arbitrary free workers another employee's work, or broaden network permissions. Durable broker delivery does not independently solve high availability for the company database or publishers. Persistent write contention may require reconsidering storage rather than adding a queue alone.

### 26.2 Explicitly out of scope

No Slack/Discord migration, company-wide group chat, shared folder as message bus, global chat-history injection, every-message GitHub comment, automatic meeting agents, end-to-end encrypted peer mesh, public agent marketplace, new provider login relay, new model subscription, extra autonomous workforce, or automatic deployment.

No mandatory vector database or paid embeddings for simple task/decision lookup. No GitHub-comment command language in the first release. No artificial business metrics, promises of human-like employees, guaranteed message throughput, or claims of perfect security.

## 27. Requirement coverage and completion report

### 27.1 Traceability to the existing feature catalog

| Existing requirements | Communication coverage | Owning tasks |
|---|---|---|
| COM-01 authenticated mailbox | Derived identity, audience, current scope, durable inbox | C01-C04 |
| COM-02 structured handoffs | Message classes, evidence refs, canonical task discussions | C01, C03, C06 |
| COM-03 help is not spawning permission | Scheduler-owned response work and no local hidden delegation | C05, C08 |
| COM-04 bounded loops | Deduplication, wait graph, two-round/eight-hop limits | C05, C06, C15 |
| COM-05 owner interrupt | Model-independent scoped stop/control path | C08, C13 |
| COM-06 useful notifications | Priority policy, incident aggregation, visibility versus interruption | C15, C16 |
| COM-07 decisions and obligations | Versioned decision authority and outstanding response requests | C06, C14 |
| COM-08 optional external channel | Deliberately deferred; Gen remains the sole primary interface | C00, C15 |
| DIST-01 through DIST-08 | Durable receipt boundaries, fencing, liveness, cancel, reconciliation, checkpoints, backpressure | C02, C04, C05, C07, C12, C13, C17 |
| SCH and EMP integration | One scheduler, permanent identity, normal task/awake/budget accounting | C00, C05, C12, C19 |
| MEM-02, CTX-01/03/05, LRN-03 | Authorization before search/context/knowledge; bounded evidence-first packets | C03, C14 |
| APR-01/02/04/06/07 | Trusted exact controls, authenticated owner, stale rejection, stop semantics | C01, C06, C08, C09, C13 |
| GIT-01/04/05/07/08 | Restricted existing publisher, webhook/summary link, honest provider/evidence state | C10, C11, C19; owning engineering prerequisites |
| GUI-02/03/05/06/07/08 | Authoritative bindings, protected actions, draft preservation, reconnect | C07-C09 |
| PUB-01/02/03/05/06 | Preserve deferred channels, curated sources, and publisher boundary during handoffs | C14, C18; existing marketing capability gates |
| OPS-01 through OPS-08 | Remote deployment prerequisites, single authority, verified wake, backup/cutover | C00, C08, C12, C13, C17, C19 |
| OBS and EVAL integration | Correlation, measurements, fault tests, exact offline/live status | C16, C18, C19 |

This table covers the communication slice. It does not claim to implement all 221 company-manager requirements or replace the engineering/media/authentication plans.

### 27.2 Required implementation handoff

The eventual completion report must include actual repository commits and schema/config digests; deployment/component locations; employee-to-machine bindings used in testing; authenticated API/owner-gateway capability states; model-route verification references; passed/failed/skipped tests; simulated versus live evidence; message/attempt/PR identifiers where real; load conditions and measured results; unresolved incidents/uncertain effects; retained awake resources and continuing cost; and the exact operator controls available.

Report these capabilities separately: internal message persistence, supervisor delivery, actual model consumption, concurrent-project execution, Gen UI/reconnect, GitHub reads, GitHub summary writes, real draft-PR publication, actual platform wake, and disaster recovery. One passing area does not imply the others.

A valid first delivery may be a read-only/offline slice with explicit blocked live prerequisites. A full acceptance claim requires the matching real evidence. No source-tree change, test pass, installation, or deployment is claimed by this planning document.

## 28. Sources and evidence status

### 28.1 Local source inputs

The latest company plan and Gen requirements are controlling source material. Earlier plans/audit files were available as provenance; their older Hermes-only or Swarm choices do not override later instructions. File bytes were opened for source inventory and hashes. No source input was modified.

| ID | Input | SHA-256 |
|---|---|---|
| P1 | `maritime-company-plan-hybrid-agency-agents.md`, 1,371 lines | `ac6cd7f283ac0eb433e06d7ca14c37f92c661c0109991b8f6e64908f82eb29ac` |
| P2 | `gen-v1-company-manager-requirements.md`, 760 lines | `7ee0b8ee083ce9e91963e3ec5272f266a44802c7b64626f911b1771b379640bf` |
| P3 | `gen-v1-company-manager-feature-backlog.json`, structured 221-feature catalog | `384e446c05868d0f9cefa1f055898efc24165fdd007fc47ed701e5ada03bce39` |

The preceding approved communication discussion is the basis for the initial channel/transport selection. The detailed schemas, timing values, API names, code layout, tests, and activation sequence in this document are proposed implementation decisions, not claims that those interfaces already exist.

### 28.2 Current targeted repository reads

All current source reads below are pinned to `6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c`, observed during preparation. This is not a promise it remains the newest commit. The prior requirements supply the broader targeted source analysis; no full application test suite was executed here.

- **[G1] Commit and direct-parent diff:** https://github.com/Skytuhua/Gen-V1/commit/6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c . Retrieved diff changes `tests/hermes-client.test.ts`; it does not establish passing CI.
- **[G2] Existing local event stream:** https://github.com/Skytuhua/Gen-V1/blob/6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c/apps/server/event-stream.ts . Read in full; durable ledger, response drain, and heartbeat pattern.
- **[G3] Local server access and stream routes:** https://github.com/Skytuhua/Gen-V1/blob/6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c/apps/server/server.ts . Inspected lines 1-150; loopback-oriented bootstrap/session, origin/host controls, event route. Not a complete new security audit.
- **[G4] Package scripts and pinned dependencies:** https://github.com/Skytuhua/Gen-V1/blob/6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c/package.json . Read in full to ground Gen verification commands and existing tool choices.

### 28.3 Primary public documentation checked

External facts below were checked during this plan preparation. Documentation, account availability and limits can change; implementation-time discovery remains required. These references support specific platform semantics, not the proposed system's measured performance.

- **[D1] SQLite WAL:** https://sqlite.org/wal.html . Same-host access, single writer, transaction/checkpoint considerations.
- **[D2] WHATWG server-sent events:** https://html.spec.whatwg.org/multipage/server-sent-events.html . Event framing, IDs and reconnect processing; durable company replay is our design.
- **[D3] GitHub webhook best practices:** https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks . Minimal subscriptions, prompt acknowledgment, delivery identifiers and verified transport.
- **[D4] GitHub webhook validation:** https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries . Raw-payload HMAC signature verification and constant-time comparison.
- **[D5] GitHub failed webhook handling:** https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries . Failed deliveries are not automatically redelivered; recovery must be provided.
- **[D6] GitHub REST rate limits:** https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api . Primary/secondary limits depend on operation and authentication; local ceilings do not guarantee available quota.
- **[D7] Maritime triggers and sleep:** https://maritime.sh/docs/triggers and https://maritime.sh/docs/how-it-works . Platform-held wake schedules and sleeping-process limitations. Trigger text was available through current search-indexed official content after a direct page fetch failed; actual account wake behavior was not tested.
- **[D8] SQLite backup facilities:** https://sqlite.org/backup.html . Consistent online snapshots and alternatives; actual recovery-point guarantees depend on the implemented backup policy.
- **[D9] NATS JetStream concepts:** https://docs.nats.io/concepts/jetstream . Persistence, consumers and acknowledgment/redelivery as a later transport candidate, not an initial dependency.

### 28.4 Final evidence boundary

This artifact is a detailed plan grounded in the supplied company specifications, targeted current Gen source reads, and the primary documentation above. No communication code, model workflow, private account permission, Maritime deployment, GitHub integration, security boundary, or latency target was exercised live during preparation. Proposed performance targets and acceptance cases remain unmeasured until implementation.


<!-- Shorthand source references used in the specification. -->
[G1]: https://github.com/Skytuhua/Gen-V1/commit/6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c
[G2]: https://github.com/Skytuhua/Gen-V1/blob/6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c/apps/server/event-stream.ts
[G3]: https://github.com/Skytuhua/Gen-V1/blob/6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c/apps/server/server.ts
[G4]: https://github.com/Skytuhua/Gen-V1/blob/6d32290f4d0e4c820e6ed0c3eb56a4bd14f7891c/package.json
[D1]: https://sqlite.org/wal.html
[D2]: https://html.spec.whatwg.org/multipage/server-sent-events.html
[D3]: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
[D4]: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
[D5]: https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
[D6]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[D7]: https://maritime.sh/docs/triggers
[D8]: https://sqlite.org/backup.html
[D9]: https://docs.nats.io/concepts/jetstream
