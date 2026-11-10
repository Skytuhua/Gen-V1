# Gen V1 as the Company Manager
## Source-grounded feature requirements and acceptance catalog

**Scope:** Leo's personal Maritime software company, using Gen V1 as the main owner-facing manager while permanent specialist employees keep their own computers. This is a requirements specification, not implementation or deployment.

**Reviewed repository snapshot:** `Skytuhua/Gen-V1` at `9f23537334f2a1dc6c3bbe00d0444f8e86b57e28`. Reads were pinned to that commit rather than mixing changing main-branch files. This review does not claim that the pinned commit remains the newest commit.

**Reviewed company baseline:** `maritime-company-plan-hybrid-agency-agents.md`, all 1,371 lines and 22 sections. SHA-256: `ac6cd7f283ac0eb433e06d7ca14c37f92c661c0109991b8f6e64908f82eb29ac`.

**Evidence boundary:** the company plan was read fully; the repository tree, relevant architecture/product/security documents and targeted source/test paths were inspected. This is not a line-by-line audit of every repository file. Repository tests, the Windows build, model authentication, cloud isolation and the distributed workflow were not rerun or deployed. Source-reported passes are not independent verification. No GitHub files, machines, permissions, accounts or social posts were changed.

**Catalog:** 221 individually testable requirements across 27 areas. These are not 221 missing tools or 221 separate projects. Some preserve existing behavior, many extend local mechanisms to a distributed setting, and others are company-level guarantees not established by this inspection. The catalog covers the stated company-manager job, not every possible general-purpose assistant feature.

## 1. Recommended direction

Build **Gen V1 as the company's management application and owner interface**, with its manager running on E01's dedicated Maritime computer. Keep the existing embedded Hermes engine initially if it remains the best supported engine. Make it replaceable, but do not rewrite it merely to remove the Hermes name.

The inspected production composition actually calls `createHermesRuntime` and integrates the original source library. Gen therefore already builds on Hermes rather than starting from an unrelated engine. Its useful existing foundations include durable artifacts, action validation, local event/receipt ownership and generative interfaces. [G02, G03, G07, G13]

The target employee composition changes only E01: **one Gen V1 manager, 17 standalone Hermes employees, and 14 native Codex employees**, still 32 permanent employees across 16 departments. The separate company control-plane computer remains infrastructure, not employee 33. A local owner desktop/browser is a client, not another employee machine. Preserve the stable E01 identity and existing resource binding where a controlled migration permits it; a legacy machine name need not be renamed.

The cloud layout is a design proposal, not current capability:

```text
Owner's Gen interface
  -> authenticated remote owner gateway
  -> E01: Gen V1 manager service on its dedicated machine
       -> narrow company tool/API requests
       -> separate deterministic company control plane
            -> permanent Hermes and Codex employee machines
            -> scoped artifacts and independent review
            -> restricted GitHub/social publisher
  <- authoritative events, exact evidence, reviewable artifacts
```

The model decides what to propose. The company service decides what is permitted and owns the authoritative scheduling, limits, receipts and publication. The UI decides how to present authorized records. None may impersonate the others.

**Do not create two competing company databases or schedulers.** Gen's local SQLite event/projection mechanisms can support its UI and manager state. The company service owns remote attempts, staffing, budgets, approvals and publication. A client cache/projection must not become a second writer to those authoritative entities. Retain the existing control-service implementation direction unless separately revised; use a versioned protocol rather than silently duplicating its logic in TypeScript and Python.

## 2. What the inspected code already supplies

| Observed foundation | Source evidence | Company implication |
|---|---|---|
| Original Hermes is the production primary engine | `apps/server/hermes-service.ts`; architecture [G02, G03] | Treat Gen as an application/harness built around that engine. Engine replacement is not a prerequisite for better company coordination. |
| Atomic local commands, event sequence and hash-checked receipts | `packages/storage/store.ts` [G07] | Reuse the concepts; network dispatch still needs its own inbox/outbox and reconciliation contract. |
| Local run ID/epoch and durable operation/artifact records | `packages/contracts/index.ts`; architecture [G04, G02] | Extend identity with project, employee, machine generation and remote attempt, instead of treating a thread ID as all of them. |
| Local planning helper support | `packages/core/planning.ts`; planning schemas [G05, G06] | Existing delegation is bounded to up to three local read-only helpers, with a bounded job history. Raising a constant does not turn these into permanent remote staff. |
| Project label in Thread | `packages/contracts/index.ts` [G04] | A label is not the first-class project charter, access boundary and staffing registry required by the company plan. |
| Bounded per-thread notes | `packages/core/task-memory.ts` [G08] | Keep short notes, but add company/project knowledge with provenance and retrieval authorization rather than a giant global memory file. |
| Explicit app memory and skill composition | `packages/runtime-hermes/settings.ts` [G10] | The inspected configuration disables native Hermes memory and uses host context; analyze the actual paths, not assumed upstream defaults. |
| Whole-store session-search helper | `packages/core/learning-context.ts` [G09] | Appropriate scope assumptions for a local personal app must not be inherited as cross-project authorization. Audit all exposed retrieval/curation paths. This is not a demonstrated exploit. |
| Validated resource/data/action binding and progress binding | `packages/core/ui-admission.ts` [G13] | Extend to authenticated company read models and trusted approval chrome. Binding a number does not alone prove the number is truthful. |
| Paged discovery and source-recovery tests | `tests/context-efficiency.test.ts` [G11] | Preserve context efficiency and provenance rather than loading every employee, skill and schema on every turn. |
| Separate Node host but loopback-only accepted deployment | `apps/server/host.ts`; `SECURITY.md` [G17, G15] | Add and verify an explicit headless/cloud mode and remote access boundary, not a simple public bind-address change. |
| Temporary credential-entry slots | `packages/core/credential-slots.ts` [G14] | They are not the cloud fleet's durable credential custody and refresh solution. |

The earlier completion report records 1,040 passing application checks for an earlier milestone and lists important remaining acceptance work. The workflow inspected for commit `9f23537` instead reports a failure in application regression tests; later checks were skipped in that run. This review did not diagnose the root cause or rerun the suite. Establish a known-green candidate before deployment rather than using either old counts or a single failing run to claim universal readiness or failure. [G18, G19]

## 3. Fair comparison with Hermes

Hermes already documents persistent memory, profiles, skills, scheduled/event-triggered work, durable multi-project boards and PR-completion controls. It is not merely a chat loop without planning or recovery. Its Kanban reference explicitly describes the dispatcher as single-host and says a shared board across hosts is unsupported; separate hosts need a bridge. That is a specific architectural boundary, not a claim that Hermes cannot participate in a distributed system built around it. [H01, H02, H03, H04, H06]

The improvement target is therefore **a better integrated application for this exact company**, especially remote permanent-employee control, cross-project evidence, usable approvals, and task-generated interfaces. Do not label memory, retries, or a board alone as a unique invention. Security superiority and productivity superiority require evidence; both are currently unproven. [H07]

Use two comparisons, not one misleading ranking. First compare documented fit against the unextended Hermes application. Then compare a Hermes manager and a Gen manager using the **same company control service, worker APIs, model/reasoning, staff machines, permissions and fixtures**. The second comparison isolates manager/UI value. Giving only Gen the remote employee API would not establish a better model/harness.

## 4. Reading the catalog

**Priority:** P0 is a required gate before enabling the affected autonomous/live path; it is not an instruction to finish every company feature before offering a read-only prototype. P1 is required for the corresponding full-company capability or established product quality. P2 is a measured improvement to develop after the safe vertical slice. The counts are 102 P0, 100 P1 and 19 P2 requirements. Many P0 entries are invariants and tests for shared services, not separate applications.

**Owner:** G = Gen manager/backend; C = deterministic company control service; W = employee supervisor/runtime adapter on the assigned machine; U = owner interface and trusted renderer. Multiple owners indicate an integration boundary, not duplicated authority. Gen should support or integrate these features; it should not implement all of them inside the language model.

**Baseline:** preserve = an inspected existing primitive to retain and regression-test; extend = a relevant primitive exists but does not establish the complete company guarantee; not_established = this company capability was not demonstrated by the inspected paths. That label is not a claim that every uninspected file was searched or that the feature is impossible.

**Acceptance proof:** every row defines a future observable test, not a test run that has already passed. Company operation remains disabled for capabilities whose required gates fail. Metadata, filenames and a model's completion message do not replace evidence.

## 5. Full feature catalog

### 5.1. Manager identity, boundaries, and operating modes (MGR)

**Observed baseline:** Gen already composes its primary agent from pinned Hermes source. The proposed change is to make Gen V1 the owner-facing company harness, not to pretend that its embedded engine is unrelated to Hermes. The company plan currently assigns E01 to standalone Hermes. References: [G01], [G02], [G03], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **MGR-01 Gen V1 as E01, not another employee** | P0 / G+C / extend | Bind E01 to Gen V1 on its own persistent manager machine; retain the other employee IDs and their machines. Target composition becomes one Gen manager, 17 Hermes employees, and 14 native Codex employees. | The registry contains exactly 32 employees; replacing the manager does not create a 33rd employee or a second dispatcher. |
| **MGR-02 Outer harness versus inner engine identity** | P0 / G+C+U / extend | Record Gen version, embedded engine version, model adapter, model identity, account reference, and effective reasoning separately. Keeping the embedded Hermes engine is allowed and is the initial recommendation. | An inspection distinguishes Gen V1 with Hermes source from standalone Hermes and from a native Codex employee without relying on model self-description. |
| **MGR-03 Manager is not the control plane** | P0 / G+C / not established | The model proposes plans and assignments through narrow company commands; the deterministic service grants authority, dispatches work, and verifies results. The manager has no universal infrastructure or publisher credential. | A fabricated model tool request cannot bypass a denied policy, increase a limit, or directly mutate the authoritative database. |
| **MGR-04 Explicit company mode** | P0 / G+U / extend | Add an isolated company operating mode/profile, distinct from personal local work. It selects the company API, policy snapshot, role, and supported tools without exposing personal plugins or account sessions. | Personal-mode resources do not appear in a company task; leaving company mode cannot accidentally resume a remote assignment as a local unrestricted task. |
| **MGR-05 Plan-only, execute-within-scope, and draft-only** | P0 / G+C+U / extend | Preserve planning mode, and add explicit execution intent and campaign draft-only intent. Treat these as server-validated policy, not words in a prompt. | A plan-only request creates no employee execution or paid inference worker; a draft-only campaign performs no external upload or send. |
| **MGR-06 Versioned mandate and decision precedence** | P0 / G+C / not established | Persist owner goals, non-goals, prohibited actions, authorized project scopes, and configuration revisions. A later explicit instruction supersedes the relevant earlier instruction without erasing history. | A generic launch request cannot override a later channel deferral, and every task references the controlling mandate revision. |
| **MGR-07 Read-only portfolio answers without model polling** | P1 / C+U / extend | Serve status, queue length, approvals, and machine state directly from authoritative records. Summarization is optional; reading status must not wake every employee. | Repeated status reads create zero worker turns and show observation timestamps and unknown states accurately. |
| **MGR-08 Replaceable manager engine without a rewrite** | P2 / G / extend | Keep the manager-loop interface modular so a future custom engine can be evaluated while preserving company APIs, identities, policy, and UI artifacts. Do not remove working Hermes features solely to claim independence. | A replay/evaluation harness can compare engines against identical company contracts without changing employee machines or permissions. |

### 5.2. Projects, departments, and company records (ORG)

**Observed baseline:** Current Thread records contain a projectName label, not the company plan’s complete project charter, staffing graph, and repository-authority model. References: [G04], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **ORG-01 First-class Project records** | P0 / C+G / extend | Introduce immutable project IDs, goals, owners, state, repository bindings, permitted paths, privacy classification, acceptance policy, and budget allocation. Link multiple conversations to one project. | Two similarly named projects cannot resolve to the same authority; renaming a project does not change its permissions. |
| **ORG-02 Permanent department registry** | P1 / C+U / not established | Represent all 16 departments, their responsibilities, heads, reporting relationships, and eligible artifact types as validated records rather than prompt prose. | Every employee has one valid home department; invalid heads and reporting cycles are rejected. |
| **ORG-03 Project staffing distinct from department membership** | P0 / C+G / not established | Assign existing employees to scoped project responsibilities without changing their identities or granting all project access to an entire department. | One specialist can belong to two project teams but can execute only the currently admitted assignment. |
| **ORG-04 Explicit company-operations scope** | P1 / C+G / not established | Give staffing, finance, and company administration a typed company-ops scope with aggregate-only access. It is not a null project or a wildcard. | A budget-report task consumes a staff slot but cannot read arbitrary private repositories or create a fourth delivery project. |
| **ORG-05 Project lifecycle and archive semantics** | P1 / C+U / extend | Separate proposed, approved, active, waiting-owner, paused, completed, and archived projects from conversation status and task completion. | Completing one PR does not close a project; archiving a chat does not silently delete employee disks or abandon remote tasks. |
| **ORG-06 Repository enrollment authorization** | P0 / C+U / not established | Enroll each repository and path boundary explicitly; a name or link in a conversation does not authorize cloning, publishing, deploying, or copying data. | An unregistered repository request remains a proposal, and the permitted smoke repositories are not expanded by a model suggestion. |
| **ORG-07 Shared repositories and libraries** | P1 / C+G / not established | Support disjoint projects within one repository and approved shared-library dependencies with explicit path ownership, access rules, and pinned versions. | Identical filenames in two projects remain isolated; sharing a dependency requires both scopes and a recorded artifact contract. |
| **ORG-08 Portfolio roadmap and milestone ownership** | P1 / G+C+U / not established | Maintain outcomes, milestones, dependencies, decision owners, and deferrals across projects without forcing every project into a single chat. | An owner can identify the next required decision and actual blocker for each active project from stored evidence. |
| **ORG-09 Portfolio what-if planning** | P2 / G+C+U / not established | Simulate priority or staffing changes using current capacity and dependency facts, distinguishing estimates from committed execution. | A simulation makes no assignments and labels uncertain duration/cost assumptions rather than promising completion dates. |

### 5.3. Permanent employees and dedicated-machine lifecycle (EMP)

**Observed baseline:** The uploaded company plan already requires one permanent machine per employee. Gen’s current local planning helpers are not this employee registry. References: [G05], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **EMP-01 Employee-machine one-to-one registry** | P0 / C+W / not established | Bind each employee ID to one active Maritime resource ID and generation, with immutable ownership per attempt. Display names are not resource identity. | Duplicate employee or machine bindings are rejected; a free frontend machine cannot become a second backend employee. |
| **EMP-02 Lifecycle truthfulness** | P0 / C+U / not established | Track planned, provisioning, auth-required, idle, assigned, working, blocked, quarantined, and retired employee states separately from power state. | A roster row without authenticated live evidence is never shown as a working employee. |
| **EMP-03 Persistent identity and approved state** | P0 / W+C / not established | Preserve employee identity, reviewed skills, and authorized project state across task completion, sleep, runtime restart, and manager reconnection. | The same employee performs two tasks before and after sleep on the same machine, with correct scoped state retained. |
| **EMP-04 Capability and resource inventory** | P1 / W+C+U / not established | Record actual installed runtime, supported tools, OS, memory, CPU observations, free disk, browser availability, and approved capabilities per employee. | A browser or rendering task is refused before dispatch when the assigned machine lacks a required verified capability. |
| **EMP-05 Measured resource profiles** | P1 / C+W / not established | Maintain administrative, coding, browser, and media resource profiles from measured needs. Resizing requires budget and configured authority, not a role’s title. | A large media task reserves measured disk and runtime exposure; no GPU or extra desktop is silently acquired. |
| **EMP-06 Controlled onboarding and retirement** | P1 / C+W+U / not established | Onboard in bounded batches; retire by revoking authority and preserving approved records. Do not auto-delete storage or provision the whole roster awake at once. | Retrying onboarding reconciles existing resources, and retirement cannot destroy the only approved deliverable. |
| **EMP-07 Quarantine and exceptional replacement** | P0 / C+W / not established | Quarantine a machine with uncertain process or credential state. Replacement preserves employee identity but changes generation and fences the old machine. | The old machine cannot submit accepted results after replacement; no two active bindings exist for the employee. |
| **EMP-08 Capability-based assignment and staff development** | P2 / G+C / not established | Base assignments on demonstrated role capabilities and permission scope; record verified reusable lessons and capability gaps rather than fictional employee ratings. | A routing explanation identifies task-relevant evidence; it cannot use a marketing persona’s claimed expertise as proof. |

### 5.4. Intent intake and management judgment (INT)

**Observed baseline:** Gen already has conversation, planning, and structured input-request primitives. These need a persistent management interpretation layer tied to company state. References: [G04], [G05], [G06], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **INT-01 Persistent owner request and scope interpretation** | P0 / G+C / extend | Record the original owner instruction, intended project, success criteria, constraints, and the manager’s interpretation as a versioned work-order proposal. | Every dispatched task traces back to an authorized request; ambiguous project references do not default to the last repository. |
| **INT-02 Inspect before planning** | P0 / G+C / extend | Read authorized project facts, relevant repository metadata, existing work, and known failures before decomposing a request. Avoid planning from stale chat alone. | A request involving existing code references inspected commit/artifact IDs or explicitly reports the inspection blocker. |
| **INT-03 Smallest useful workflow** | P1 / G / not established | Choose the fewest roles needed for the outcome; routine fixes should not traverse all 16 departments or trigger ceremonial meetings. | A small scoped bug fix produces implementation and appropriate independent review without unrelated finance/marketing tasks. |
| **INT-04 Assumptions and uncertainty register** | P1 / G+C+U / not established | Distinguish verified facts, assumptions, unresolved questions, and decisions. Escalate only uncertainty that materially affects scope, safety, or cost. | The owner can see why a task is blocked and what evidence would resolve it; an assumption never becomes a permission. |
| **INT-05 Evidence-backed prioritization** | P1 / G+C / not established | Propose priorities from owner goals, dependencies, impact, risk, and available evidence. Do not invent customer demand, ROI, or deadlines. | Priority changes include a recorded rationale and leave hard policy and budget limits unchanged. |
| **INT-06 Bounded decomposition and task granularity** | P0 / G+C / extend | Decompose into independently testable tasks with required handoffs while respecting work-order limits and task/repair budgets. | A plan exceeding the approved cap remains a proposal instead of recursively spawning unlimited follow-on work. |
| **INT-07 Plan revisions and impact analysis** | P1 / G+C+U / not established | Diff revised plans against the approved version; identify affected running tasks, reviews, dependencies, assets, and approvals before applying the change. | A changed API contract invalidates affected downstream work rather than leaving green stale tasks in the board. |
| **INT-08 Blocker classification and recovery proposals** | P1 / G+C / not established | Separate missing information, provider quota, auth, infrastructure, dependency, policy, and quality blockers; propose the narrowest permitted response. | An expired credential is not retried as a code bug and does not cause a switch to a paid provider. |
| **INT-09 Concise management decisions with source links** | P2 / G+U / extend | Explain assignments, tradeoffs, and scope changes using short decision records linked to evidence, not exposed hidden chain-of-thought or long agent-chat dumps. | A reader can reconstruct the chosen action and evidence without needing the entire conversation transcript. |

### 5.5. Task contracts, dependencies, and deliverables (DAG)

**Observed baseline:** Gen’s current PlanRecord has bounded steps and local AgentJob records. A real company needs typed work orders, durable attempts, remote ownership, and enforceable acceptance contracts. References: [G04], [G05], [G06], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **DAG-01 Versioned work-order and task schemas** | P0 / C+G / extend | Separate project, work order, logical task, execution attempt, result, and review. Include scope, owner mandate, exact inputs, expected artifact types, limits, and responsible employee eligibility. | Unknown fields, missing scope, invalid references, and conflicting authority are rejected before any side effect. |
| **DAG-02 Dependency graph with cycle detection** | P0 / C+G / not established | Model prerequisite tasks and cross-project dependencies explicitly; reject cycles and never infer dependency satisfaction from prose. | A task remains queued until its exact required predecessor versions have verified completion evidence. |
| **DAG-03 Pinned code and artifact inputs** | P0 / C+W / not established | Attach repository/base SHA, interface version, predecessor commit or artifact digest, fixture version, and skill/configuration version to every attempt. | A worker using a stale base or changed input manifest cannot satisfy the current task. |
| **DAG-04 Declared file and resource ownership** | P0 / C+W / not established | Define allowed paths and known conflict hotspots such as schemas, migrations, manifests, and lockfiles. Combine planning with enforcement. | Two tasks cannot concurrently hold incompatible write scopes even when the manager says they are independent. |
| **DAG-05 Artifact-specific acceptance contracts** | P0 / C+G / extend | Define different evidence for code, research, design, video, budget analysis, and social drafts; do not force non-code work into fake code PRs. | A video task requires actual inspected media, while a report requires supported sources and recorded limitations. |
| **DAG-06 Explicit checkpoint and handoff packages** | P1 / G+C+W / not established | Persist completed work, remaining work, exact outputs, known failures, and next required actions before deadlines or reassignment. | A resumed task uses stored artifacts and observations rather than a bare statement that work was mostly finished. |
| **DAG-07 Readiness distinct from completion** | P0 / C+U / extend | Keep execution-ended, artifact-ready, checks-passed, review-passed, ready-for-owner, externally-merged, and deployed states separate. | A worker exiting zero or a merged PR alone never causes an unsupported deployment or overall-completion claim. |
| **DAG-08 Scoped change orders** | P1 / G+C+U / not established | Handle new requirements as explicit work-order revisions or separately authorized follow-on scopes, preserving prior acceptance and audit records. | Added features cannot silently consume the original task’s repair allowance or bypass the twelve-task default. |

### 5.6. Fair scheduling and simultaneous projects (SCH)

**Observed baseline:** Current local delegation has a three-reader limit. Simply raising that number does not implement cross-machine staffing, quota ownership, or the company plan’s fairness policy. References: [G05], [G06], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **SCH-01 Single authoritative company scheduler** | P0 / C / not established | All remote work goes through one deterministic scheduling authority, including department, marketing, review, company-ops, trigger, and recovery tasks. | Independent manager messages cannot create parallel hidden dispatchers or each claim the same capacity. |
| **SCH-02 Preserve current concurrency policy** | P0 / C+W / not established | Enforce three active delivery projects, eight staff tasks total, three per project, one foreground task per employee, and a separate single manager slot as initial configurable caps. | Concurrent admissions from multiple clients cannot exceed any cap; waiting for owner approval consumes no staff execution slot. |
| **SCH-03 Fair project opportunities** | P1 / C / not established | Use eligible-task fairness, weighted priorities, and aging so a busy project cannot permanently starve another ready project. | Under continuous Alpha arrivals, an eligible Beta task receives capacity at the next policy-compatible opportunity. |
| **SCH-04 Review and repair capacity reserve** | P1 / C / not established | Reserve two of the eight slots for eligible review/integration/repair; lend idle reserved capacity and reclaim it at task boundaries. | A full implementation queue cannot indefinitely prevent review; borrowed work is not killed without policy authority. |
| **SCH-05 Atomic employee, machine, budget and lock admission** | P0 / C / not established | Claim employee, project/global slot, resource conflicts, wake headroom, budget, and immutable attempt together or roll back the whole admission. | A simulated failure during admission leaves neither a double booking nor a stranded cost reservation. |
| **SCH-06 Dedicated marketing and render limits** | P1 / C+W / not established | Keep at most two marketing tasks and one render within the existing eight staff slots, with campaigns attached to their product projects. | Alpha rendering and Beta coding can overlap without creating extra uncounted processes or a second editor employee. |
| **SCH-07 Quota-aware queueing and safe boundary preemption** | P1 / C+G / not established | Stop admission on shared provider exhaustion, respect retry windows, and re-prioritize at checkpoints without discarding active ownership. | A quota-limited account pauses eligible work without moving credentials, using another account, or enabling paid fallback. |
| **SCH-08 Explainable scheduling and queue estimates** | P2 / C+U / not established | Show why an item is waiting, which constraint blocks it, and estimates derived from observed runtime history with uncertainty. | The board distinguishes missing reviewer, free-machine shortage, quota wait, and project cap; estimates are not promises. |

### 5.7. Mixed-harness employee integration (RUN)

**Observed baseline:** Gen’s RuntimeAdapter currently drives local conversation runtimes, and its selected provider adapters supply model text to the embedded Hermes loop. That is not the planned remote employee protocol. References: [G02], [G03], [G04], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **RUN-01 Separate manager and worker runtime interfaces** | P0 / G+C+W / extend | Keep Gen’s local model/conversation adapter separate from a company worker adapter with inspect, start, observe, stop, reconcile, and collect operations. | A model-provider adapter cannot be mistaken for an employee machine or independently grant infrastructure access. |
| **RUN-02 Explicit Hermes and native Codex worker adapters** | P0 / C+W / not established | Support the 17 standalone Hermes and 14 native Codex employee targets under the same task/result contract, while E01 uses Gen. | Both employee runtime families complete a bounded authorized task on their own assigned machines with normalized evidence. |
| **RUN-03 Versioned capabilities and pinned bindings** | P0 / C+W / extend | Record native mode, runtime/adapter version, tool set, effective configuration, and capability digest before each attempt. | A binding change after admission is rejected; unknown required features yield an explicit blocker. |
| **RUN-04 No implicit fallback or wrapper substitution** | P0 / C+W / extend | Runtime failure must not silently activate another harness, model, account, or paid route. Label any separately approved wrapper mode truthfully. | A failed Codex start cannot be reported as Codex success after an unrecorded Hermes retry. |
| **RUN-05 Native event and error normalization** | P1 / C+W / extend | Preserve safe vendor events while mapping explicit states for auth, quota, policy, approval, capability, timeout, invalid result, and uncertain execution. | Truncated streams or missing completion events remain unknown rather than being translated to successful task completion. |
| **RUN-06 Runtime-specific execution limits** | P0 / W+C / extend | Enforce wall-clock and process ownership outside the model; record native iterations, turns, and tool calls without pretending their units match. | A runtime lacking a native turn cap is still stopped by the supervisor deadline, with accurate reported limit coverage. |
| **RUN-07 Block hidden delegation and native side channels** | P0 / W+C / extend | In company mode disable unregistered native subagents, inherited plugins, independent cron and unrestricted worker chats. Existing local readers are not company employees. | A malicious or accidental delegation call cannot create another worker, model turn, or unaccounted background job. |
| **RUN-08 Protocol upgrade and compatibility negotiation** | P2 / C+W / not established | Version the company envelope and negotiate supported features during controlled upgrades; reject unsupported new fields or semantics safely. | A one-version-old employee is either explicitly compatible or unavailable, never silently fed an incompatible task. |

### 5.8. Distributed task execution and durable recovery (DIST)

**Observed baseline:** Gen already has local run IDs, epochs, atomic receipts, an input outbox, and restart behavior. Extend those principles to networked machines instead of treating an HTTP response as proof of execution. References: [G02], [G04], [G07], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **DIST-01 Durable dispatch outbox and worker inbox** | P0 / C+W / extend | Persist intent before sending, and persist employee admission before acknowledging it. Separate command received, admitted, started, and finished receipts. | Crashing on either side of a send/ack boundary does not lose accepted work or create a second logical attempt. |
| **DIST-02 Idempotency with argument identity** | P0 / C+W / extend | Reused operation IDs return the same result only for the same immutable request. Reject IDs reused with different content. | Redelivering the same task creates one execution; changing its input under the same ID produces a conflict. |
| **DIST-03 Lease generations and stale-result fencing** | P0 / C+W / extend | Use machine/attempt generations to reject old events after pause, cancellation, replacement, or restart. A timeout does not prove termination. | A late success callback from an old generation cannot publish artifacts, free another task’s slot, or mark the replacement complete. |
| **DIST-04 Progress heartbeats and liveness evidence** | P1 / C+W / not established | Distinguish process alive, model busy, tool running, checkpoint written, and no observation. Heartbeats are bounded service traffic, not LLM polling. | A slow model is not automatically duplicated; stale heartbeats trigger reconciliation or quarantine with recorded uncertainty. |
| **DIST-05 Whole-process cancellation** | P0 / C+W / extend | Revoke capabilities first, interrupt the native runtime, terminate owned descendants, reconcile external operations, and release capacity only after confirmation. | Cancelling during a browser, test, or render leaves no old process able to act; uncertain termination blocks reassignment. |
| **DIST-06 Restart and network-partition reconciliation** | P0 / C+W / extend | On reconnect, inspect durable attempts and machine state before retrying. Preserve outputs already created and classify unknown external outcomes explicitly. | A lost dispatch response, coordinator restart, and disconnected employee do not duplicate tasks or falsely report failure/success. |
| **DIST-07 Task resumption from verified checkpoints** | P1 / G+C+W / extend | Resume using exact input/output/checkpoint versions and newly valid authority. Never replay an unknown external side effect merely to continue conversation. | A resumed task can continue incomplete local work while leaving an uncertain PR/post operation quarantined for reconciliation. |
| **DIST-08 Backpressure and bounded event transport** | P1 / C+W+U / not established | Apply event size limits, durable cursors, bounded logs, retry ceilings, and queue pressure signals across transport and UI. | A flood of tool output cannot exhaust the coordinator or silently drop terminal evidence; reconnect resumes from a validated cursor. |

### 5.9. Coordination, communications, and notifications (COM)

**Observed baseline:** Gen’s current auxiliary-reader jobs are parent-owned local sessions. The company needs durable addressed messages between existing employee identities, not a shared all-to-all chat. References: [G06], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **COM-01 Authenticated company mailbox** | P0 / C+W / not established | Store sender, receiver, project/scope, task, correlation ID, expiry, and message type. Derive sender identity from credentials rather than payload text. | A worker cannot impersonate the owner, another employee, or a system approval by editing a message field. |
| **COM-02 Structured handoff messages** | P1 / G+C+W / not established | Support assignment, clarification, decision, artifact-ready, review-request, blocked, and result messages referencing stored tasks and immutable artifacts. | A backend-to-frontend handoff includes the actual agreed interface and commit, not only a natural-language summary. |
| **COM-03 Help requests are not spawning permission** | P0 / G+C+W / not established | Route requests for help to existing eligible employees through the scheduler; asking another role a question never creates a new agent. | A source playbook naming five collaborators cannot wake five unregistered helpers. |
| **COM-04 Bounded chains and loop detection** | P1 / C / not established | Deduplicate replies, bound handoff depth, detect repeated unresolved clarification/block cycles, and stop runaway manager-worker chatter. | Repeated identical blocker messages create one incident/escalation, not unlimited new work orders. |
| **COM-05 Owner interrupt and scope changes** | P0 / G+C+U / extend | Accept owner pause, cancel, priority, and clarification requests while other work continues. Bind the change to the intended project/task. | Cancelling Beta does not interrupt Alpha; urgent stop works even when the manager model is waiting on a tool. |
| **COM-06 Useful notification policy** | P1 / C+U / not established | Notify for decisions, blockers, verified completion, budget risk and incidents; support quiet periods and deduplication without hiding urgent failures. | Ten repeated retries generate one changing exception record, while a new unsafe-publication incident is immediately visible. |
| **COM-07 Decision journal and unresolved obligations** | P1 / G+C+U / not established | Record who decided what, evidence, alternatives, affected scope, and unresolved obligations; provide concise handoffs when the owner returns. | The owner can recover outstanding decisions after a week without rereading every employee transcript. |
| **COM-08 Optional approved communication channel** | P2 / C+U / not established | Keep the Gen interface primary; add at most a separately authorized notification/reply channel through the same identity and approval path. | A messaging-channel response cannot approve an action without authenticated identity and exact action binding. |

### 5.10. Company memory and durable knowledge (MEM)

**Observed baseline:** Current task notes are bounded to 12 entries and 4 KiB total. Native Hermes memory is disabled in the inspected settings; the host exposes its own notes and session search. One inspected search helper queries all stored conversations, which needs new scope enforcement in company mode. References: [G08], [G09], [G10], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **MEM-01 Typed company, department, project and task memory** | P0 / C+G / extend | Separate policy, approved procedures, project facts/decisions, and task working notes. Keep private employee notes scope-tagged. Do not enlarge one global prompt as the solution. | Retrieving a company summary cannot reveal an unrelated project’s raw code, credentials, or conversations. |
| **MEM-02 Server-enforced retrieval authorization** | P0 / C+G+W / extend | Apply scope filters before search, indexing, reranking, snippets, and source loading, including every native and host session-search path. | Alpha/Beta canaries cannot leak through search matches, counts, snippets, cached summaries, or direct file access. |
| **MEM-03 Fact provenance and authority classification** | P1 / C+G / not established | Store source artifact/version, author, timestamp, confidence, and whether an item is observation, assumption, instruction or decision. | An employee’s uncertain statement cannot become an owner requirement or verified product fact through repeated summarization. |
| **MEM-04 Conflict and supersession handling** | P1 / C+G+U / not established | Detect contradictory notes and source changes, retain history, and mark which decision or observation supersedes an older one. | A revised API requirement is retrieved as current while old versions remain available only as historical evidence. |
| **MEM-05 Verified reusable lessons** | P1 / C+G / extend | Promote lessons only from supported outcomes after sanitizing project/private details and independent review. Preserve failed experiments as failures. | A failed deployment cannot generate a reusable success procedure; company learning does not copy private fixtures across projects. |
| **MEM-06 Owner inspect, edit, forget and export** | P1 / C+U / extend | Allow revision-safe corrections, scoped deletion/retention, export, and visibility into what is loaded. Revoke derived indexes according to the same retention policy. | Deleting a scoped note removes it from future retrieval and invalidates retained summaries without silently deleting required audit records. |
| **MEM-07 Compact handover dossier** | P1 / G+C / extend | Maintain a bounded project dossier of current goals, decisions, active tasks, exact evidence links, blockers, and next permitted action. | A new manager session continues from authoritative state rather than needing an entire chat transcript or inventing progress. |
| **MEM-08 Knowledge portability and optional search quality upgrades** | P2 / C+G / extend | Keep canonical structured/text records independent of the harness. Add hybrid semantic search only when measured useful and through an explicitly authorized inference route. | Replacing an engine preserves approved knowledge; unavailable embeddings never trigger a paid service or become a deployment prerequisite. |

### 5.11. Context efficiency and information quality (CTX)

**Observed baseline:** Gen already has paged capability discovery, metadata-first inspection, revision-pinned reads, and tests for source recovery after compaction. Preserve them rather than replacing them with a giant company prompt. References: [G11], [G12], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **CTX-01 Task-specific context packet** | P0 / G+C / extend | Build each task context from its charter, relevant requirements, exact source inputs, allowed tools, known blockers and output contract. Exclude unrelated project history. | An employee can execute its assignment from the packet and authorized reads without receiving company-wide secrets or every conversation. |
| **CTX-02 Lazy capability and schema discovery** | P1 / G+C / preserve | Retain compact indexes and paginated schema/details; add company APIs to that mechanism instead of dumping all tools and profiles every turn. | A normal status or small task keeps a bounded context packet while detailed schemas remain discoverable on demand. |
| **CTX-03 Evidence-first retrieval and freshness** | P1 / G+C / extend | Prefer current repository/artifact records over model recollection; attach observation time and revision and revalidate before consequential action. | A stale report cannot authorize publication or satisfy checks against a newer commit. |
| **CTX-04 Context compaction with recoverable decisions** | P1 / G+C / extend | Preserve mandate, task IDs, approvals, unresolved effects, and exact source pointers across compaction without turning summaries into authority. | A post-compaction continuation resolves the same open actions and cannot replay an already-completed side effect. |
| **CTX-05 Tool-result and log budgets** | P1 / C+W+G / extend | Cap inline tool output, page large results, retain full authenticated evidence as artifacts, and expose truncation explicitly. | A long build log remains inspectable without overflowing prompts or hiding the failing tail as a passing result. |
| **CTX-06 Reusable prefix and safe caching** | P2 / G+C / not established | Cache immutable policy/schema prefixes and authorized source summaries by content/version; never reuse project-sensitive data under an incorrect scope. | Cache hits retain provenance and invalidation rules, and a project switch cannot reuse another project’s private prefix. |
| **CTX-07 Evidence contradiction and incompleteness checks** | P1 / G+C / not established | Flag unsupported conclusions, missing pages/files, conflicting sources, and evidence that covers only part of a claimed result. | A partial file read is described as partial, and missing logs cannot be translated to a clean test run. |
| **CTX-08 Context and reasoning-effort observability** | P2 / G+U / extend | Show actual reported context use, loaded sources and reasoning setting, with unavailable fields explicit. Propose efficiency changes separately instead of silently lowering settings. | A user can identify expensive context sources, while manager max and staff xhigh remain unchanged unless explicitly authorized. |

### 5.12. Skills, procedures, and controlled learning (LRN)

**Observed baseline:** Gen already imports original Hermes learning/curation and exposes versioned skill handling. Company mode needs stricter scope and activation discipline for those existing capabilities. References: [G02], [G09], [G10], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **LRN-01 Protected company policy separate from skills** | P0 / G+C / extend | The company charter, permission rules and runtime routing are immutable to agent-written skills or learning procedures. | A skill update cannot change publication authority, model configuration, safety boundaries or machine ownership. |
| **LRN-02 Reviewed, versioned skill registry** | P1 / C+G+W / extend | Pin source, content digest, owner, scope, runtime compatibility, review and activation state for each procedure. | An in-flight task keeps its recorded skill version; an upstream update does not change execution mid-task. |
| **LRN-03 Project versus reusable skill scope** | P0 / C+G / extend | Store project-specific knowledge separately from portable departmental procedures; enforce scope on source review, loading and automatic learning. | A global curator cannot read or promote a private project’s conversation merely because it is idle. |
| **LRN-04 Proposal, review, activation and rollback** | P1 / C+U / extend | Treat learned procedures as proposals; validate them, test representative examples, approve activation and retain an earlier approved version for rollback. | A failed or pending proposal is not used by new tasks; rollback preserves provenance and does not change harnesses. |
| **LRN-05 No executable side effects from loading** | P0 / C+W / extend | Loading Markdown, frontmatter or code examples never installs packages, registers plugins, creates agents, executes scripts or grants new tools. | An imported profile containing install/delegate instructions remains inert reference content and fails policy tests if it attempts authority changes. |
| **LRN-06 Learning cadence within resource limits** | P1 / C+G / extend | Account for background review and curation as authorized work with quotas, cancellation and source scope. Avoid invisible learning loops or startup work. | A company at capacity or quota exhaustion does not run unmetered automatic reviews from every employee. |
| **LRN-07 Outcome-linked procedure evaluation** | P2 / G+C / not established | Track whether a skill improves accepted artifacts, reduces correction effort, or repeats failures; record evaluation limits and regressions. | A skill with more confident prose but more false claims is rejected despite a higher self-score. |
| **LRN-08 Upstream engine/source maintenance** | P1 / G+C / extend | Preserve third-party notices and pinned-source custody, track upstream security/compatibility changes, and stage upgrades through regression tests. | A vendored-source update changes its manifest deliberately and cannot be labeled byte-identical to an older source pin. |

### 5.13. Owner control and exact approvals (APR)

**Observed baseline:** Gen already has immutable action envelopes, operation preconditions, revision checks and input requests. Extend these to cross-machine company actions while preserving the separation between a UI click and actual authority. References: [G04], [G13], [G02], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **APR-01 Stable trusted approval surface** | P0 / U+C / extend | Show consequential actions in non-generated trusted UI with exact repository/account, action, scope, content or artifact hashes, preconditions, expiry and consequences. | A generated app cannot draw a look-alike control that receives privileged approval or hide the true destination. |
| **APR-02 Server-validated owner identity** | P0 / C+U / extend | Authenticate the owner independently of the manager, employees and event payloads; bind approvals to a verified session and action. | A forged employee message or webhook cannot become an owner approval. |
| **APR-03 Preauthorized bounded routine work** | P0 / C+G+U / not established | Allow work within an explicit charter/budget without requiring approval for every harmless step, while preserving exact public-action and sensitive-operation gates. | An authorized test runs without repetitive prompts; a new repository, public upload or increased budget still stops for authorization. |
| **APR-04 Approval invalidation on change** | P0 / C+U / extend | Invalidate or recheck approval when content, media, commit, destination, account, scope, schedule or policy revision changes. | Approving one PR revision or post cannot authorize a later modified version under the old receipt. |
| **APR-05 Batch approval of exact items** | P1 / C+U / extend | Support a finite enumerated batch with individually bound actions and clear partial outcomes, not blanket permission for future content. | One changed item is blocked without falsely reporting every item approved or already published. |
| **APR-06 Direct emergency stop** | P0 / C+W+U / extend | Provide an authenticated deterministic stop control independent of model inference and generated layouts, with exact scope and termination reconciliation. | Stop remains available during a model/provider outage and prevents future dispatch/publication before reporting outstanding uncertain effects. |
| **APR-07 Distinct pause, cancel, revoke and undo** | P0 / C+U / extend | Explain and implement each separately: pause scheduling, cancel active work, revoke future authority, and apply only a safe explicitly authorized compensating action. | Cancelling a campaign does not pretend to delete an already-live post or revert a merged PR. |
| **APR-08 Owner feedback as revisioned input** | P1 / G+C+U / extend | Capture edits, review comments and rejected outputs without losing drafts; trace feedback to affected tasks and invalidate stale acceptance. | A correction to an API or script reaches only its intended project and is not overwritten by a late assistant update. |
| **APR-09 Approval expiry, delegation limits and absence** | P1 / C+U / not established | Define behavior when the owner is offline, an approval expires, or an approver role is not authorized. Initial system remains owner-only; no invented delegated executives. | Unattended work waits safely at a required approval boundary without auto-approving because a deadline arrived. |

### 5.14. Model, account, and credential policy (AUTH)

**Observed baseline:** Gen already pins accounts to tasks and distinguishes configured credentials from actual verified provider access. The company needs the same discipline across the manager and remote employee machines. References: [G02], [G03], [G14], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **AUTH-01 Preserve exact model and reasoning requirements** | P0 / G+C+W / extend | Discover and record the authorized Sol model ID and effective manager max/staff xhigh settings for each runtime. No silent renaming, clamping or substitution. | Unsupported settings block the relevant attempt, and executed request metadata rather than model prose records the selected configuration. |
| **AUTH-02 Permitted subscription route proof** | P0 / G+C+W / extend | Establish supported authentication, intended unattended use and concurrent operation for the actual adapters/accounts. A local broker implementation or successful interactive login alone is insufficient proof. | The manager and two remote workers complete the authorized concurrent auth/restart gate without a new provider or copied rotating-token shortcut. |
| **AUTH-03 No paid or auxiliary fallback** | P0 / G+C+W / extend | Inspect all template, runtime, summarization, search, vision, embedding, review and prediction routes before execution; disable unapproved ones. | Injecting a metered proxy/API credential into a test configuration causes preflight rejection rather than an invisible billable call. |
| **AUTH-04 Safe credential lifecycle** | P0 / C+W+G / extend | Protect tokens from prompts and project code, serialize supported refresh ownership, persist safe state atomically, and quarantine uncertain/revoked grants. | A restart cannot restore a stale rotating grant over a newer one; no credential appears in UI, logs, artifacts or task memory. |
| **AUTH-05 Account-pinned execution and identity uncertainty** | P0 / G+C+W / extend | Preserve account bindings across resume and configuration changes; distinguish verified subject identity from local labels when adapters cannot prove identity. | Reconnecting another account cannot silently hijack an existing project, and unknown identity is visible rather than guessed. |
| **AUTH-06 Fleet-wide quota and background accounting** | P1 / C+G+W / not established | Track shared inference allowance separately from machine billing, including manager, workers, retries, learning and optional predictions. Do not manufacture per-employee allowances. | Account exhaustion blocks both runtime families; absent usage telemetry remains unavailable instead of zero. |
| **AUTH-07 Scoped sign-in and recovery UX** | P1 / G+U+C / extend | Provide token-free readiness states and safe per-employee sign-in/reconnect instructions with verified teardown before replacing credentials. | A lost login console does not falsely prove cleanup, and no UI asks the owner to paste raw authentication files into a task chat. |

### 5.15. Typed tools and external-system integrations (TLS)

**Observed baseline:** Gen already has admitted host tools and structured operations. Company capabilities must use that host boundary and must not become arbitrary remote shell instructions. References: [G03], [G04], [G13], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **TLS-01 Typed company tool surface** | P0 / G+C / extend | Expose narrow project, task, staffing, status, evidence, approval-request and control commands with strict schemas and authenticated scope. Keep the initial tool set small and discoverable. | Unknown operations, additional fields and employee-chosen administrative endpoints are rejected before execution. |
| **TLS-02 Resource references instead of raw credentials** | P0 / C+W / extend | Pass scoped resource IDs and expiring capabilities rather than account-wide keys, raw paths, provider cookies or write tokens. | Reading a task manifest cannot reveal credentials or grant access to another repository or account. |
| **TLS-03 Tool side-effect and risk classification** | P0 / C+G / extend | Mark each tool as read-only, local mutation, private disclosure, external publication, spend, or administrative operation, with deterministic approval and budget requirements. | A tool mislabeled by a model cannot bypass the actual server operation’s policy class. |
| **TLS-04 Integration capability discovery** | P1 / C+U / not established | Record connected, authenticated, permitted, technically supported, live-tested and currently healthy states separately for each integration. | A discovered connector or a copied plugin definition cannot appear as a verified Maritime-side connection. |
| **TLS-05 Timeouts, result limits and retry policy** | P0 / C+W / extend | Set per-tool bounds, safe retry categories, argument identity, output truncation markers, and reconciliation for non-idempotent effects. | Retrying a read is permitted under policy; retrying an unknown post or PR creation is not automatic. |
| **TLS-06 Pinned plugin/MCP configurations** | P1 / C+W / extend | Review versioned external tool servers, credentials, network permissions and schema changes; do not inherit broad personal integrations into company mode. | A new plugin or expanded tool schema stays inactive until reviewed and cannot alter another employee’s permissions. |
| **TLS-07 Recorded dry runs and test adapters** | P1 / C+W / not established | Provide explicit fake adapters and dry-run outputs for authorization, task routing, GitHub and social actions; label them as simulated. | A mock receipt is impossible to present as a real PR/post, and a dry run makes no external mutation. |

### 5.16. Isolation, adversarial inputs, and data protection (SEC)

**Observed baseline:** Gen’s security policy explicitly describes a local application, and approved native runtimes/tests use local-user privileges rather than an OS sandbox. Company/cloud operation therefore needs a new verified deployment boundary. References: [G15], [G13], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **SEC-01 Manager cannot run arbitrary project code** | P0 / G+C / not established | Keep repository execution on the assigned employee machines. The manager receives scoped facts and artifacts and cannot use its host shell as a fallback worker with company credentials. | An assigned coding task never executes untrusted build hooks or repository scripts in the manager/control-plane credential context. |
| **SEC-02 Whole employee process-tree containment** | P0 / W+C / not established | Enforce current-project mounts, identities, homes, process ownership and tool boundaries for file tools, subprocesses, browsers, plugins and runtimes, not only shell commands. | An inactive project canary is inaccessible through every supported tool/process path; a profile name alone cannot satisfy the test. |
| **SEC-03 Protected credential custody** | P0 / G+C+W / extend | Use supported secret storage and restricted native-auth processes inaccessible to project tools. Do not repurpose Gen’s temporary UI credential-entry slots as the fleet’s durable secret vault. | Tokens cannot be exported through files, logs, environment dumps, artifacts, screenshots or generated interfaces; supported auth still works. |
| **SEC-04 Network and privileged-endpoint restrictions** | P0 / C+W / not established | Restrict egress by role/project and block metadata, administrative sockets, internal publisher endpoints and unrelated systems; verify actual platform enforcement. | SSRF, local proxy and arbitrary URL tests cannot reach protected services or bypass the company API. |
| **SEC-05 Prompt-injection resistance by authority separation** | P0 / G+C+W / extend | Treat repository files, web pages, comments, employee messages and skill text as data. They cannot supply owner identity, credentials, approvals or policy changes. | A malicious README or Reddit comment requesting secret upload cannot expand a tool’s effective authorization. |
| **SEC-06 Untrusted artifact and archive handling** | P0 / C+U / extend | Validate paths, symlinks, actual media type, archive expansion limits, script-bearing formats, remote fetches and parser behavior. Render active content inert or in isolated contexts. | Hostile SVG/HTML, filenames, compressed payloads and fake callback bodies cannot execute code or access internal resources. |
| **SEC-07 Scoped retention, deletion and backups** | P1 / C+U / not established | Define what is retained for drafts, raw footage, final assets, logs, audit records and secrets, with deletion propagation and backup policy. | Expired raw media can be removed without deleting an employee disk, authoritative audit evidence or the only approved final artifact. |
| **SEC-08 Supply-chain and self-modification boundaries** | P1 / G+C+W / extend | Pin images, runtimes and dependencies; review imported scripts and generated configuration. Company code or policy changes remain proposed PRs, never self-deployed runtime mutations. | A worker cannot approve, merge or deploy a change that relaxes the very controls reviewing its output. |
| **SEC-09 Security incident containment** | P1 / C+W+U / not established | Provide scope-specific quarantine, credential revocation, dispatch/publisher freeze, evidence preservation and recovery procedures with known residual effects. | A compromised employee can be isolated without deleting other projects or pretending already-exfiltrated data can be recalled. |

### 5.17. Repository-to-PR engineering delivery (GIT)

**Observed baseline:** The company plan specifies restricted PR publication. Gen’s local repository/file capabilities and generic operation model do not by themselves establish a tested remote PR workflow. References: [G04], [G06], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **GIT-01 Repository automation safety preflight** | P0 / C+W / not established | Inspect existing CI events, deployment triggers, hooks, runner exposure and required policy access before publishing a branch or PR. Do not change repository settings as a workaround. | An existing privileged workflow that could deploy or expose secrets blocks the affected publication until explicitly resolved. |
| **GIT-02 Pinned workspace preparation** | P0 / W+C / not established | Check out the authorized exact base and dependency commits in a scoped task workspace on the assigned employee’s machine. | The worker cannot replace the requested remote/base or reuse another project’s working tree. |
| **GIT-03 Bounded branch and patch ownership** | P0 / C+W / not established | Allocate task branches from trusted company state, validate changed paths and metadata, and reject default-branch writes, force pushes and unauthorized workflow changes. | A patch touching a forbidden workflow or secret path fails validation before any GitHub push. |
| **GIT-04 Restricted central PR publisher** | P0 / C / not established | Keep write credentials out of coding workers; validate artifacts and create/update one draft PR per logical task without executing repository hooks or code. | A retry after a lost response finds the existing branch/PR; it cannot create a duplicate or push to another repository. |
| **GIT-05 Evidence-rich PR packages** | P0 / G+C+U / not established | Include requirement mapping, tested SHAs, commands/exits, known failures, originating employee, dependencies and independent review status. | The PR description and Gen view agree with actual recorded evidence and do not upgrade unrun checks to passed. |
| **GIT-06 Stacked/dependent changes and integration checks** | P1 / C+W / not established | Track merge order and test assembled pinned branches on an eligible employee machine. Revalidate when base or dependency commits change. | Individually green branches that fail together cannot be marked feature-ready. |
| **GIT-07 PR comments and CI events as scoped inputs** | P1 / G+C / not established | Ingest authenticated webhooks or verified polling results with deduplication; treat comments as untrusted feedback, not new permissions. | A fork comment cannot trigger paid execution, reveal secrets or approve a merge; an existing authorized review can create a bounded repair proposal. |
| **GIT-08 Human merge boundary and observed post-merge state** | P0 / C+U / not established | Never expose automatic merge/release/deploy authority under current scope. Record externally performed merges only from verified provider state. | Ready-for-owner remains separate from merged, released and deployed even when a generated UI suggests a completion label. |

### 5.18. Independent review and evidence quality (QA)

**Observed baseline:** Gen already records operations and provenance. A company acceptance gate must inspect external evidence and independence rather than accepting structured model output as success. References: [G04], [G07], [G13], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **QA-01 Deterministic evidence receipts** | P0 / C+W / extend | Capture trusted execution identity, exact commands, exit status, tool versions, output hashes and tested input versions. Model summaries remain claims linked to these receipts. | A fabricated JSON result or a stale log cannot mark a required check passed. |
| **QA-02 Independent reviewer eligibility** | P0 / C / not established | Assign a different eligible employee on another machine; enforce prior-author and acceptance-test conflicts and preserve a reviewed substitution matrix. | The implementation author cannot become its own independent reviewer through another prompt or runtime switch. |
| **QA-03 Requirement-derived acceptance tests** | P0 / W+C / not established | Evaluate the requested behavior independently of implementation-authored tests; detect weakened tests, skipped checks, and zero-test success. | A seeded defect with passing trivial unit tests is rejected by independent acceptance evidence. |
| **QA-04 Exact-version review invalidation** | P0 / C / extend | Bind review to exact code, artifact, base, dependencies and configuration; invalidate only affected evidence after change. | A code or media edit after review cannot retain a ready state without rechecking the changed version. |
| **QA-05 Risk-based specialist review** | P1 / G+C / not established | Invoke security, data, design or legal-risk review when the task crosses those boundaries rather than requiring every specialist for every change. | A database migration triggers its required checks; an ordinary typo fix does not create an unnecessary compliance meeting. |
| **QA-06 Bounded repair loops and escalation** | P0 / C+G / not established | Respect the two-attempt/two-review-round defaults, classify recurring failures and present unresolved cases instead of endlessly asking agents to try again. | A repeatedly failing task stops with its last reproducible failure and preserved artifacts without exhausting unlimited quota. |
| **QA-07 Media, research and design review** | P1 / C+W+U / not established | Verify real playback, captions, sources, claims, usability and project brand as appropriate. Human quality acceptance remains separate from deterministic media validity. | File existence, a thumbnail, or an agent’s aesthetic score cannot prove a complete usable demo video. |
| **QA-08 Completion confidence and explicit limitations** | P1 / G+U / extend | Report passed, failed, skipped, unverified and unavailable requirements separately, with the most consequential unresolved risk visible. | A partial project cannot be summarized as complete merely because some tasks reached terminal states. |

### 5.19. Generative UI as a trustworthy interaction layer (GUI)

**Observed baseline:** Gen already has a trusted catalog, durable artifacts, validated bindings/actions, opaque generated workers and watchdogs. Its inspected admission code requires numerical progress to reference data. Extend those strengths rather than replacing the product with a fixed dashboard. References: [G01], [G02], [G04], [G13], [G16], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **GUI-01 Task-appropriate UI composition** | P1 / G+U / preserve | Let the manager choose a graph, review queue, comparison, document, timeline or board according to the task while using trusted schemas and real data bindings. | A blocked integration surfaces dependency evidence; a simple question does not generate an unnecessary miniature application. |
| **GUI-02 Authoritative operational data bindings** | P0 / C+U / extend | Bind task status, employees, budgets and approvals to company-owned read models with provenance, revision and freshness. The model can choose presentation, not invent operational state. | A generated status card cannot display a manufactured completed count or substitute self-reported percent for verified acceptance. |
| **GUI-03 Trusted controls outside generated layouts** | P0 / U+C / extend | Keep identity, environment, connection state, approval summary and emergency stop in stable application chrome that model-generated content cannot replace. | A malicious widget cannot hide the stop button, spoof owner identity or present a generated approval as a trusted one. |
| **GUI-04 Scoped query and action broker** | P0 / C+U / extend | Generated surfaces request allowlisted reads/actions using resource IDs; forbid arbitrary SQL, privileged fetches, token access or direct infrastructure SDK calls. | A view cannot query another project or execute a write beyond the server-validated action envelope. |
| **GUI-05 Revision-safe interactive actions** | P0 / C+U / preserve | Retain immutable input/action receipts, expected revision checks and idempotency, extending them to remote company entities. | Double-clicking or accepting a stale action cannot duplicate a work order or approve changed content. |
| **GUI-06 User-owned UI state preservation** | P1 / U / preserve | Preserve drafts, selections, expanded views, edits, pinned artifacts and scroll/focus across streaming updates, detach/reattach and reconnect. | An agent rerender does not erase an owner’s edited launch copy or move approval controls under an active click. |
| **GUI-07 Progressive disclosure and fallback views** | P1 / U+G / extend | Start from a compact summary, expose details/evidence on demand, and retain a plain trusted fallback when generation or custom views fail. | The owner can inspect tasks and stop work even if the model cannot compose a valid interface. |
| **GUI-08 Live events with stale/partial-state indicators** | P0 / C+U / extend | Reconnect from event cursors, resynchronize projections, and visibly mark stale snapshots, partial results and disconnected employees. | A dropped event stream cannot leave a stale green state looking current or cause already-applied edits to repeat. |
| **GUI-09 Generated-app isolation and limits** | P0 / U+C / preserve | Preserve opaque origin/worker, schema, message and watchdog protections; separate UI sandbox guarantees from actual OS isolation and company tool grants. | Generated code cannot read local credentials or internal APIs; tests do not claim a hard OS memory quota without real enforcement. |
| **GUI-10 Accessibility, mobile review and interruption safety** | P1 / U / extend | Support keyboard navigation, screen-reader labels, reduced motion, readable narrow screens and safe focus during dynamic updates. | An owner can review and reject an exact action without mouse-only affordances or layout shifts, including through the selected remote client. |

### 5.20. Company-specific operational views (VIEW)

**Observed baseline:** Gen has generic workflow and evidence components, but company-specific data contracts and permissions need to be added. These views should be composable task interfaces, not a second competing source of company state. References: [G01], [G04], [G13], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **VIEW-01 Portfolio overview** | P1 / C+U / extend | Show active projects, verified milestones, current blockers, staffing constraints and required owner decisions in one authorized aggregate view. | The owner distinguishes backlog, execution and waiting-owner work without opening every chat. |
| **VIEW-02 Employee and machine roster** | P1 / C+U / not established | Show actual employee identity, department, machine binding, sleep/health/auth state, current task, runtime and verified capabilities. | Planned machines and unauthenticated profiles never look like available staff. |
| **VIEW-03 Dependency and critical-path view** | P1 / C+U / extend | Visualize requirement/task/PR dependencies with exact versions, blocked reasons and estimated critical paths where measurements support them. | Selecting a blocked task identifies the concrete prerequisite and evidence that will unblock it. |
| **VIEW-04 Cross-project work timeline** | P2 / C+U / not established | Show actual overlap, queue wait, model/tool time, review time and owner wait across employees without implying unsupported exact forecasts. | The owner can see whether parallelism happened on distinct machines and where time was spent. |
| **VIEW-05 Evidence and PR review desk** | P0 / C+U / extend | Present diff or artifact, requirement checks, exact SHAs, logs, independent review and unresolved issues together, with safe previews. | A reviewer can trace each passed claim to an immutable receipt and spot version mismatch before taking action. |
| **VIEW-06 Campaign studio** | P1 / C+U / extend | Combine the real demo, edit notes, captions, brand kit, X/Reddit drafts and website assets with per-item revisions and disclosure status. | Changing a caption invalidates only its affected approval; a private prototype is clearly labeled before previewing publication. |
| **VIEW-07 Budget and quota panel** | P1 / C+U / extend | Separate infrastructure forecast, observed usage, reserved work, remaining inference quota and unavailable telemetry. | A low model allowance is not mislabeled insufficient Maritime credit, and missing usage does not display as zero. |
| **VIEW-08 Exception and incident inbox** | P1 / C+U / not established | Prioritize unresolved failures, unknown external outcomes, auth blocks, unsafe workflows and policy denials with concrete next permitted actions. | Repeated identical errors collapse into one incident while separate affected projects remain visible. |
| **VIEW-09 Decision and approval inbox** | P0 / C+U / extend | Show exact pending decisions, scope, expiry, content changes and the effect of approve/reject without requiring transcript archaeology. | An owner can approve a bounded plan while refusing publication, and both choices survive restart. |
| **VIEW-10 Explain-this-state inspector** | P2 / C+G+U / not established | Provide source-backed explanations of why an employee is idle, a task is blocked, a PR is unready or a budget reservation remains held. | Explanations cite actual constraints and receipts rather than attributing motives or inventing internal agent reasoning. |

### 5.21. Marketing and real product-demo production (MKT)

**Observed baseline:** The plan already specifies E25 and E28-E32, actual Playwright capture, FFmpeg editing, and owner review. Gen’s role is to manage and present that workflow, not become a video generator or another marketing employee. References: [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **MKT-01 Project-specific campaign briefs** | P1 / G+C / not established | Capture audience, goal, approved product facts/build, brand, embargo, channels, deliverables, budget and success measurement before production. | A campaign cannot claim a feature is released merely because a private branch implements it. |
| **MKT-02 Script and shot-list workflow** | P1 / G+C+W / not established | Assign writing and demo production to existing employees with each shot linked to a real user action and observed result. | A script’s claimed result is either demonstrated in the pinned build or labeled hypothetical/prototype. |
| **MKT-03 Real build and fixture provenance** | P1 / C+W / not established | Record build SHA, sanitized demo data, capture script, tool versions, browser context and source-footage digests. | Footage from the wrong project/build is rejected, and genuine failed behavior is not replaced by fabricated animation. |
| **MKT-04 Bounded editing on E29’s machine** | P1 / C+W / not established | Run editing, captions, thumbnails and in-scope formats as supervised media tasks with resource reservations and retained edit recipes. | The renderer runs on the correct dedicated machine, respects the one-render limit and stops on timeout/disk failure. |
| **MKT-05 Privacy and rights checks** | P1 / C+W+U / not established | Review recordings for tokens, notifications, private tabs and customer data; track permissions for fonts, music, logos, footage and optional narration. | A sensitive frame or unapproved licensed asset blocks the affected export; no private footage is uploaded to an external editor automatically. |
| **MKT-06 Honest demo claims and playback review** | P1 / G+C+U / not established | Label synthetic data, removed waiting, accelerated footage and prototype status; inspect real playback, caption timing, legibility and opening/closing frames. | A thumbnail-only check cannot mark the video verified, and edited timing cannot support a false real-time performance claim. |
| **MKT-07 Engineering-to-marketing handoff** | P1 / G+C / not established | Generate marketing proposals from approved release facts; pass broken demos and unsupported claims back into scoped engineering/product tasks. | Marketing cannot silently modify production code to make a demo work or publish before the required approval. |
| **MKT-08 Human editing and reusable creative templates** | P2 / U+C+G / extend | Let the owner revise scripts, captions and shot notes in persistent artifacts; promote proven templates through reviewed versioning. | Owner edits survive regeneration and are not overwritten by the next model turn; improved templates retain their evaluation history. |

### 5.22. Distribution, community work, and Agency-Agents references (PUB)

**Observed baseline:** The existing plan adopts eight pinned and adapted Agency-Agents references, not its executable router. X, Reddit and website remain the initial focus; YouTube, Instagram and TikTok are explicitly deferred. References: [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **PUB-01 Current channel scope enforced throughout** | P1 / C+G+U / not established | Keep X, Reddit and website focus; optional channels require selection and authorization. Enforce YouTube/Instagram/TikTok deferral in planning, asset tasks, adapters, publishing and analytics. | A generic launch brief, old credential or imported profile cannot reactivate a deferred destination. |
| **PUB-02 Eight curated playbooks on existing employees** | P1 / C+G+W / not established | Retain the eight source profiles and their current mappings to E25/E28-E32, with reviewed adaptations rather than replacement personas. | Loading references does not change the 32-person roster, harness, model, machine identity or project access. |
| **PUB-03 Pinned source and bounded read-only loader** | P1 / C+W / not established | Verify source commit, actual byte hashes, license and adapted versions; load at most two and 12,000 adapted characters per task, without upstream installers or delegation. | Altered files, unreviewed updates, source tool grants and agency_agents_delegate remain denied; attribution survives distribution. |
| **PUB-04 Channel-specific useful content** | P1 / G+W / not established | Produce distinct X explanations and community-appropriate Reddit packages with current sourced community rules and clear affiliation; no fake personas, testimonials or personal anecdotes. | The Reddit draft is not a mass-copied launch ad, and unavailable rule access is disclosed rather than invented. |
| **PUB-05 Protected exact-content publisher** | P1 / C+U / not established | Publish only through a verified permitted integration with exact owner authorization, immutable content/media/account/destination and current feature/embargo checks. | A draft-ready item cannot send directly from an employee machine, and changing any approved public content requires renewed approval. |
| **PUB-06 Scheduling, cancellation and uncertain outcomes** | P1 / C+U / not established | Store schedule identity, timezone, provider receipt and individual item outcomes; reconcile timeouts and cancel queued actions where supported without claiming live posts disappeared. | A lost send response cannot cause an automatic duplicate, and scheduled is not displayed as published. |
| **PUB-07 Manual export and honest unavailable capabilities** | P1 / C+U / not established | Provide reviewed files/copy for owner posting when access is unsupported, while clearly reporting export-ready, scheduled and verified-live separately. | An unconnected platform does not block useful internal content work, and exported content is never assigned a fabricated post URL. |
| **PUB-08 Outcome measurement and reference evaluation** | P2 / G+C+U / not established | Measure authorized visits, signups, installs and feedback using real definitions, windows and sources; compare baseline/adapted playbook output rather than importing growth promises. | Missing analytics remain unavailable; small samples and attributed clicks are not presented as causal customer acquisition proof. |

### 5.23. Other departments and feedback loops (BUS)

**Observed baseline:** The department coverage is already specified by the company plan. The manager needs meaningful task contracts for these functions, not artificial payroll, autonomous legal decisions, or mandatory meetings. References: [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **BUS-01 Product and research evidence contracts** | P1 / G+C / not established | Route feasibility research, product requirements and architecture decisions to the right existing employees with cited evidence, alternatives and open assumptions. | Unsupported market or technical claims remain hypotheses, and research completion does not automatically authorize development scope. |
| **BUS-02 Design and accessibility handoff** | P1 / G+C+U / not established | Preserve versioned design/interaction requirements and testable accessibility criteria linked to implementation and marketing brand assets. | A changed design identifies affected tasks and assets rather than leaving contradictory screenshots and acceptance criteria. |
| **BUS-03 Support-to-reproduction-to-fix loop** | P1 / G+C / not established | Turn authorized feedback into deduplicated issues, reproducible steps, scoped engineering work and later reviewed documentation; replies stay permission-gated. | An untrusted support message cannot trigger credential use or a refund, and duplicate bug reports do not spawn duplicate fixes. |
| **BUS-04 Finance and procurement analysis only** | P1 / G+C+U / not established | Let E23 explain verified budgets and compare proposed tools using approved aggregates, without access to personal banking or purchasing authority. | A proposed subscription remains a proposal; price uncertainty is labeled and no purchase is executed. |
| **BUS-05 Legal/risk and partnership boundaries** | P1 / G+C / not established | Produce sourced risk flags and separately requested partnership research/drafts with explicit human/professional review limits; no legal certification or autonomous outreach. | A department title cannot authorize a contract, public claim, cold message or financial action. |
| **BUS-06 People/knowledge operations and documentation** | P1 / G+C / not established | Maintain job descriptions, verified capabilities, reviewed procedures, onboarding and runbooks for agent employees without inventing human salaries, employment or performance history. | Updated role guidance goes through review and cannot create new machines or override an existing employee’s scope. |

### 5.24. Economics, quota efficiency, and resource accounting (COST)

**Observed baseline:** The company plan’s budget and concurrency figures are design defaults, not verified entitlements. Gen’s current per-thread usage primitives are a useful display base but not fleet-wide reservations. References: [G04], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **COST-01 Separate infrastructure, inference and external-tool ledgers** | P0 / C+U / extend | Distinguish verified Maritime usage, subscription allowance, approved third-party charges and unknown data. Do not present token counts as a fabricated dollar cost. | A quota shortage cannot be mistaken for unused infrastructure credit or permission to buy API usage. |
| **COST-02 Fresh account-wide budget evidence** | P0 / C / not established | Use authorized current billing periods/rates, existing workloads and timestamps; stale or missing evidence blocks new cost exposure under the approved policy. | Separate projects cannot each spend the same account allowance, and unavailable billing remains a blocker rather than an estimate labeled current. |
| **COST-03 Full-period fixed-cost projection** | P0 / C / not established | Forecast retained machines, disks, backup/footage retention and replacement overlap, even when employees sleep. Preserve the existing target/reserve unless changed. | Sleeping all employees does not reduce the forecast to zero or silently authorize more machines. |
| **COST-04 Task and work-order reservations** | P0 / C+W / not established | Reserve conservative maximum incremental exposure before dispatch and reconcile actual completion, cancellation and uncertain provider outcomes. | Concurrent dispatch cannot overspend a shared reservation balance; unknown work retains exposure until resolved. |
| **COST-05 Quota-efficient management** | P1 / G+C / not established | Prefer event-driven decisions, deterministic status and reusable verified context over all-employee polling, repeated planning or automatic meetings. | Idle company operation generates no recurring model calls except explicitly authorized bounded work. |
| **COST-06 Background helper budget policy** | P1 / G+C / extend | Keep composer predictions off by default in company mode and meter/authorize learning, review and other optional model calls alongside primary work. | A background feature cannot consume capacity while required delivery is quota-blocked or cause an unapproved provider call. |
| **COST-07 Bounded log, artifact and media storage** | P1 / C+W / not established | Reserve storage for builds, browser binaries, caches, raw footage and artifacts; use compression, retention and export policies without deleting permanent identities. | A task pauses before disk exhaustion and preserves already-produced evidence rather than corrupting the worker state. |
| **COST-08 Measured optimization proposals** | P2 / G+C+U / not established | Report accepted-output cost, owner correction effort, queue delay and avoidable retries; propose role/tool/resource tuning without silently changing model or reasoning requirements. | An optimization is adopted only from comparable evidence and explicit configuration authority, not a smaller token count alone. |

### 5.25. Cloud deployment, wake-up, and operational resilience (OPS)

**Observed baseline:** Gen has a separate Node host, but binds it to loopback and documents remote/multi-user exposure as unsupported. Its verified packaged target is Windows. A headless company deployment is new acceptance work, not just changing the bind address. References: [G01], [G02], [G17], [G15], [H05], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **OPS-01 Headless Linux company-manager deployment** | P0 / G+W / extend | Package Gen’s manager/server without an Electron desktop requirement, pin Node/Python/runtime dependencies and validate actual Maritime startup, storage and shutdown behavior. | A clean approved Linux image starts and resumes the manager with no desktop session or owner laptop required. |
| **OPS-02 Authenticated remote owner gateway** | P0 / G+C+U / not established | Add a separate remote-access boundary with TLS, owner authentication, origin/session protection, authorization and rate limits; do not expose the existing loopback host unchanged. | Unauthenticated external clients cannot read company state or issue commands, and generated widgets remain isolated from privileged origins. |
| **OPS-03 Client lifetime independent from execution** | P0 / G+C+U / extend | Closing the desktop/browser disconnects presentation only. Accepted remote work continues within its existing authority; reopening reconciles stored state. | Closing the owner’s laptop during two tasks does not cancel them or cause duplicate starts after reconnect. |
| **OPS-04 Single active manager and control ownership** | P0 / G+C / extend | Prevent split-brain during restart/failover; only one active authoritative coordinator and one admitted manager decision turn own their generation. | An old manager returning from a partition cannot dispatch alongside its replacement or regain a revoked epoch. |
| **OPS-05 Platform wake and durable schedules** | P1 / C+G / not established | Use a verified platform-managed wake or explicitly approved always-on service, then reconcile due work; local timers cannot be treated as a wake mechanism. | A sleeping system resumes due authorized work without the laptop and does not create duplicate tasks after missed ticks. |
| **OPS-06 Untrusted trigger admission** | P0 / C+G / not established | Authenticate and replay-protect the company action envelope independently of provider wake delivery. A public wake or source label does not grant task authority. | Unsigned, replayed or wrong-scope webhooks may cause no authorized company action even when a platform delivers or wakes on them. |
| **OPS-07 Backups, restore and schema migrations** | P0 / C+G+W / extend | Back up authoritative records and approved state with tested restoration, safe credential handling, schema compatibility and owner-controlled retention. | A restore preserves task/approval/outbox identity and prevents replay of completed external actions or duplicate live machine bindings. |
| **OPS-08 Pinned releases, rollback and safe maintenance** | P1 / G+C+W / extend | Use versioned artifacts, staged updates, migration backups and rollback at safe boundaries. Never auto-deploy self-authored changes or silently downgrade security requirements. | An unsuccessful update returns to a compatible approved version without losing owner drafts, task evidence or employee identities. |

### 5.26. Observability, diagnostics, and operational honesty (OBS)

**Observed baseline:** Gen has local events, receipts and usage views. Company observability must join real events across machines without exposing secrets or presenting model activity as completed work. References: [G04], [G07], [G02], [P01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **OBS-01 End-to-end correlation identifiers** | P0 / G+C+W / extend | Carry project, work order, task, attempt, employee, machine generation and runtime binding through logs, events, artifacts and external receipts. | A PR can be traced back to its exact attempt and owner request without guessing from timestamps or branch names. |
| **OBS-02 Separate execution, inference and UI events** | P1 / C+U / extend | Distinguish model streaming, tool execution, remote process liveness, verified checks, publication and UI rendering so progress is not conflated. | A streaming assistant message cannot increase the accepted-requirement count or mark a remote process finished. |
| **OBS-03 Structured redacted logs and bounded traces** | P0 / G+C+W / extend | Retain safe diagnostics and error categories with size limits, access controls and retention; redact credentials and sensitive data before sharing evidence. | A diagnostic export includes needed correlation and failure detail but no tokens, private source outside scope or raw personal profile. |
| **OBS-04 Capability and health diagnostics** | P1 / G+C+W+U / not established | Provide token-free checks for model route, runtime version, employee supervisor, artifact reachability, disk, billing freshness and publisher readiness. | A blocked task identifies the actual failing prerequisite without suggesting unrelated account reconnection or reinstallation. |
| **OBS-05 Queue, latency and useful-output measurements** | P2 / C+U / not established | Measure planning, queueing, model/tool execution, review and owner wait separately, plus accepted outputs and correction effort. | More awakened agents or tokens cannot be presented as productivity; unavailable timing spans remain labeled. |
| **OBS-06 Reconciliation and incident history** | P1 / C+U / not established | Show uncertain external effects, retries, quarantines, generation changes and recovery decisions with a durable resolution trail. | The owner can see why an employee remains unavailable after a timeout and what evidence releases it. |
| **OBS-07 Read-only audit replay and reproducibility** | P1 / C+G / extend | Reconstruct prior decisions and views from immutable inputs/events without re-executing mutations; retain policy, configuration and source versions. | Replaying an incident never posts again, creates a second PR or launches workers. |
| **OBS-08 Failure feedback into reviewed improvement** | P2 / G+C / extend | Turn recurring verified failures into bounded bug/procedure proposals with supporting evidence and a regression case, not unrestricted self-repair. | A repeated stale-session issue produces a reviewable change proposal and test rather than auto-modifying the live manager. |

### 5.27. Evaluation, adoption, and migration from the Hermes manager (EVAL)

**Observed baseline:** The inspected repository’s earlier completion report records local passes, but the inspected commit’s CI run failed at application regression tests. Neither the earlier count nor this design establishes current cloud-company readiness. No tests were rerun in this review. References: [G18], [G19], [P01], [H01].

| ID and feature | Priority / owner / baseline | Required behavior | Acceptance proof |
|---|---|---|---|
| **EVAL-01 Known-green candidate baseline** | P0 / G+C / extend | Establish a pinned candidate with passing required regression/build checks and preserve remaining failures/unsupported environments explicitly before company activation. | The inspected CI failure is resolved or a later candidate is verified; old README counts are not used as proof for a new commit. |
| **EVAL-02 Threat-model and safety contract suite** | P0 / C+W+G+U / not established | Test owner identity, scopes, credentials, native process boundaries, UI actions, stale events, exact approvals, channel deferrals and no-paid-fallback before autonomous work. | Every live-enabled path has its required negative tests and recorded implementation evidence; a failed gate blocks that path. |
| **EVAL-03 Representative manager task suite** | P1 / G+C / not established | Evaluate actual planning, staffing, clarification, blocked-work recovery, PR review and campaign handoffs using realistic bounded fixtures and repeat runs. | Plans produce accepted outcomes with recorded interventions and limitations, not just well-written task lists. |
| **EVAL-04 Fair Hermes-versus-Gen comparison** | P2 / G+C+U / not established | Give both managers the same model/reasoning, employee fleet, company API, permissions, fixtures and resource budget. Attribute UI benefits and control-service benefits separately. | A Gen win cannot be claimed merely because Hermes was denied the remote tools or the Gen run used a stronger model. |
| **EVAL-05 Chaos and uncertain-outcome testing** | P0 / C+W / not established | Inject lost acknowledgments, network partitions, restarts, orphan processes, quota/auth failures, stale approvals and uncertain PR/post results. | The system preserves one authoritative task/effect record, fences old work and does not invent a successful result. |
| **EVAL-06 Quality, efficiency and owner-effort gates** | P1 / G+C+U / not established | Predefine acceptance by task type, severe-policy-failure criteria and practical comparison measures; report sample sizes and variance. Safety is not averaged away by speed. | A faster manager with an unauthorized action or more false completion claims cannot pass adoption. |
| **EVAL-07 Shadow mode then bounded live pilot** | P0 / G+C / not established | Let Gen first inspect/propose without dispatch, then manage a small approved fleet and two projects under strict limits before activating all departments. | A shadow run performs no side effects; the live pilot proves independent machines, reviewed PRs and an actual marketing package before full rollout. |
| **EVAL-08 Controlled manager cutover and rollback** | P0 / G+C / not established | Transfer the E01 interface/authority only after draining or fencing the old manager, reconciling tasks and approvals, and preserving identities and history. Rollback is explicit, not automatic harness fallback. | Only one manager can dispatch during cutover, and rollback does not duplicate accepted work or rebind employee machines. |
| **EVAL-09 Manager self-development and acceptance ownership** | P1 / G+C+W / not established | Gen may propose changes to itself through the normal separate-worker PR path, but cannot approve, merge or deploy its own control changes. Maintain owner-facing evidence of what is actually activated. | A manager-authored policy relaxation remains an unmerged proposal; release readiness is decided outside that model’s own report. |

## 6. Build boundaries in the existing repository

These are proposed locations, not claims that these modules already exist. Keep Gen's present frontend/backend and useful local primitives. Avoid expanding the already-large core service into a second monolithic fleet scheduler.

| Existing area or proposed module | Intended responsibility | Boundary |
|---|---|---|
| `packages/contracts/index.ts` | Preserve thread/run/action/artifact contracts; link threads to authorized company entities | A thread remains a user work surface, not a substitute for Employee, Machine or Attempt. |
| Proposed `packages/company-contracts/` | Versioned transport schemas and company entity references | Generate/validate both client and service schemas; avoid divergent Python/TypeScript definitions. |
| Proposed `packages/company-client/` | Authenticated company API client, cursor reconciliation and typed read models | No direct SQLite sharing or independent scheduling. |
| Proposed `packages/core/company-tools.ts` | Narrow manager-facing plan/status/task/approval-request tools | Model requests never bypass service authorization. |
| `packages/core/planning.ts` | Keep local planning-reader semantics explicit | Add a distinct company dispatch capability; do not silently turn existing read-only helper calls into remote mutation. |
| `packages/core/learning-context.ts`, `task-memory.ts`, and native source integration | Scope-aware retrieval and knowledge loading | Company-mode search and curation use authenticated scope before returning data. |
| `packages/runtime-hermes/` | Existing embedded manager engine and documented model-text bridge | Retain pinned-source custody; add company policy without inventing an unsupported authentication relay. |
| Proposed `apps/server/company-mode.ts` and deployment entrypoint | Headless manager lifecycle, isolated profile, remote owner gateway integration | Do not expose the current local server unchanged or require Electron on the server. |
| `packages/ui-catalog/` and proposed company read-model components | Trusted data-backed operational surfaces and interactive task composition | Generated layout is flexible; authority, identity, approval and emergency controls are fixed and trusted. |
| `apps/web/src/` company client views | Portfolio, evidence, staffing, campaign and exception interaction | Preserve draft/edit/mount identity, accessibility and event-reconnect behavior. |
| Planned company control service and worker supervisor from the existing plan | Scheduling, permits, budgets, lifecycle, evidence and protected publishers | Remains a separately protected service on its own infrastructure machine. |
| Proposed `tests/company/` and `evals/company-manager/` | Transport contracts, negative authorization cases, realistic manager and UI evaluations | Fake infrastructure is labeled simulated; actual machines/model routes and PRs require live evidence. |

**Important integration distinction:** Gen's existing authenticated local model broker is an internal implementation component. It must not be assumed to establish provider permission for every account or unattended workflow. Conversely, its existence is not by itself evidence of an authentication bypass. Verify the actual supported underlying login/transport and its allowed use before company deployment. [G02, G03]

## 7. Acceptance scenarios that matter more than feature count

All scenarios are proposed. Unsafe/destructive conditions should use controlled fixtures where possible and be labeled simulated. Actual separate computers, authentication routes, sleep/wake, media generation and permitted PR creation need live evidence.

| Scenario | Required observation | Main requirements |
|---|---|---|
| One scoped feature | Manager plans, correct employee implements, independent reviewer validates, one draft PR is returned with evidence | INT, DAG, RUN, GIT, QA |
| Two projects at once | Alpha and Beta overlap on different employee machines; no double booking or scope leakage | ORG, EMP, SCH, MEM |
| Third project plus company administration | Three delivery projects remain legal; company-ops uses staff capacity but no phantom fourth project or wildcard reads | ORG-04, SCH-02, BUS-04 |
| Repeated owner message and lost acknowledgment | One logical work order/attempt and one external PR; reused IDs with changed arguments fail | DIST-01, DIST-02, GIT-04 |
| Owner closes the laptop | Already-authorized work continues; opening Gen reconnects to real state rather than restarting it | OPS-01, OPS-02, OPS-03 |
| Manager or coordinator crashes | New authority reconciles accepted work; old generations cannot act | DIST-03, DIST-06, OPS-04 |
| Employee disappears | No premature reuse of its machine or employee slot; quarantine and evidence of termination are visible | EMP-07, DIST-04, DIST-05 |
| Cancel during browser/test/render | Entire owned process tree stops or stays quarantined; no late artifact or publication escapes | DIST-05, RUN-06, APR-06 |
| Alpha-to-Beta project switch | Private canaries do not leak through filesystem, history, session search, skills, browser, cache or tools | MEM-02, SEC-02, LRN-03 |
| Malicious repository/skill/comment | Attempts to change policy or exfiltrate secrets are rejected outside the model | SEC-05, LRN-01, TLS-03 |
| Changed code after review | Exact-version evidence becomes stale and ready-for-owner is withdrawn | QA-04, GIT-06 |
| Weak tests hide a defect | Independent requirement-based checks find the seeded bug; self-review does not count | QA-02, QA-03 |
| Provider quota or revoked login | Work stops within scope; no paid provider, account rotation or lowered reasoning appears | AUTH-01 through AUTH-06 |
| Stale billing or full disk | Admission/capture blocks before new exposure or corrupt output; unknown amounts stay unknown | COST-02, COST-04, COST-07 |
| Real marketing package | E28 captures the true build, E29 edits on its own machine, drafts and media are independently reviewed without a public send | MKT, PUB-01 through PUB-04 |
| Deferred channel mentioned by a playbook | No YouTube/Instagram/TikTok onboarding, production, publishing or analytics job is created | PUB-01 through PUB-03 |
| Lost social-post response | Outcome stays uncertain until reconciled; no duplicate blind retry and no fake URL | PUB-05, PUB-06 |
| Generated UI is broken or adversarial | Trusted approvals/stop remain usable, private reads stay denied, owner edits survive | GUI-03 through GUI-10 |
| Unsigned provider wake | Waking is not authorization; no company operation runs from an unauthenticated envelope | OPS-06 |
| Restore from backup and cut over manager | Accepted effects are not replayed, employee identities survive, and only one active authority dispatches | OPS-07, EVAL-08 |

### A concrete end-to-end request

“Work on Alpha's approved feature and Beta's approved bug fix in parallel. Prepare Alpha's demo and X/Reddit drafts when the approved build is ready. Publish nothing.”

The desired outcome is bounded tasks on existing employee machines, independent reviews and draft PRs, a verified real demo package, and an owner interface showing the evidence and pending decisions. The system must not invent a release, wake all departments, enable deferred channels, silently choose a paid model, or treat the request as approval to publish. This test exercises both engineering and marketing without changing the owner's boundaries.

## 8. Implementation and adoption order

**Stage 0: stabilize and freeze.** Establish a known-green source candidate, lock the authoritative company scope and role mapping, and retain the original app's local mode. Record target Gen manager versus actual activated manager. Readiness is not implied by renaming E01.

**Stage 1: read-only company mode.** Add typed project/employee/task references, an authenticated company API client, scope-aware reads and evidence-backed generated views. Use fake fixtures first, then authorized read-only state. Shadow planning is useful here and must not dispatch.

**Stage 2: smallest safe remote delivery path.** Prove Linux manager hosting, owner identity, exact model routing, two employee-machine bindings, task admission, whole-process stop, evidence export, independent review and a restricted draft PR. Only enable capabilities whose P0 contract is proved; leave other interfaces visibly unavailable.

**Stage 3: concurrent-project reliability.** Add real project switching, durable mailbox, fair scheduling, account-wide quota/budget reservations, cancellation, restart/wake and partition recovery. Prove that no owner laptop is required and that one project can stop independently.

**Stage 4: marketing and departmental completeness.** Exercise the existing six-person marketing function, real media evidence, curated playbooks and draft review; then bring the remaining department capabilities online by measured demand and budget. Public distribution is a separate optional live gate. The three deferred channels stay deferred.

**Stage 5: fair comparison and full activation.** Run Hermes-versus-Gen management tests under the same company infrastructure and compare accepted outcomes, false completion claims, manual interventions, latency, observed usage and owner editing effort. Expand toward all 32 employees only after useful delivery and resource proof. Keep headcount targets distinct from actual readiness.

**Stage 6: optional differentiation.** Improve cross-project what-if planning, retrieval quality, context caching, UI adaptation and procedure evaluation based on measured bottlenecks. A future independent manager engine belongs here only if it adds value without losing the proven contracts.

These stages are dependencies and activation gates, not time estimates. The 221 requirements can share a small number of modules and test suites; they are not 221 sequential implementation phases.

## 9. What would establish “better than Hermes at this job”

Use a frozen scenario suite with repeated runs, identical authorized models/settings and the same staff/control-service capabilities. Record exact versions and unavoidable differences. Compare two levels separately: standalone application fit, and management performance with equal infrastructure.

| Dimension | Measurement | Adoption rule |
|---|---|---|
| Useful delivery | Requirements accepted by independent checks; rejected or incomplete artifacts | Gen must not gain speed by relaxing acceptance. |
| Factual operational reporting | Unsupported completion, invented tests, wrong PR links or stale status | Severe false claims block adoption for that path. |
| Owner workload | Corrections, repeated prompts, time needed to inspect evidence and approve/reject | Demonstrate a practical reduction or clearly better usability. |
| Reliability | Duplicate work/effects, failed resumes, orphan processes and unresolved uncertainties | Required recovery scenarios pass; uncertainty remains explicit. |
| Safety | Scope escapes, wrong-account actions, secret exposure and forbidden spending/publication | Any severe violation fails the candidate regardless of average speed. |
| Efficiency | Actual reported usage, elapsed time, queue/review delay and startup overhead | Use observed values; unavailable telemetry is not fabricated. |
| UI usefulness | Correct surface choice, data fidelity, successful user actions and preserved drafts | More cards, animation or generated code is not a success metric. |
| Multi-project fairness | Actual overlap on separate machines and starvation under bounded stress | All eligible active projects receive their policy-defined opportunities. |
| Maintainability | Runtime adapters, version drift, reproducible diagnosis and upgrade effort | Document a genuine simplification rather than merely adding another dependency. |

Predefine practical acceptable regressions and thresholds for the chosen fixtures before comparing; do not choose them after observing results. A small pilot supports a local deployment decision, not a universal ranking or a security proof. The first goal is a safe working vertical slice; the “better” claim comes after evidence.

## 10. Explicit non-goals

Do not replace all employee harnesses with Gen. Do not turn employees into shared-machine role prompts. Do not install a second swarm/Agency-Agents workforce. Do not make the manager itself the scheduler, secret vault or GitHub publisher. Do not add automatic merges, production deployments, purchases, unsolicited outreach, paid inference fallback or dormant social channels. Do not add nine-provider parity, a voice/avatar system, a public agent marketplace, arbitrary generated admin code, or enterprise multi-user billing just to enlarge the feature list. These are outside this personal-company request.

Do not remove existing useful Hermes behavior to claim a fresh engine. Do not promise perfect prompt-injection resistance, exactly-once external effects, infinite context, unlimited subscription concurrency or guaranteed business outcomes. Build bounded guarantees with observed evidence instead.

## 11. Preservation checklist for the prior company plan

The new manager design preserves 16 departments and 32 employees; one persistent dedicated computer per employee; a separate deterministic control service; three active delivery projects; up to eight staff tasks, three per project and one per employee; two reserved review slots; at most two marketing tasks and one render; the unchanged proposed work-order/attempt limits; exact user-required model/reasoning discovery; subscription-only inference with no unapproved fallback; the existing account/budget scope; separate draft PRs and independent review; no automatic merge/deployment; project and company-ops isolation; real media provenance; exact public-action approvals; eight curated Agency-Agents references without its router/delegate installer; and YouTube/Instagram/TikTok deferral.

The targeted change is **E01's outer harness and owner interface**, plus the company-mode capabilities needed for it to do the job. The prior company plan remains unchanged on disk by this review. This feature specification does not claim that the company has been implemented.

## 12. Glossary

A **control plane** is the ordinary software that stores company state and enforces rules. An **attempt** is one execution of a logical task. **Admission** means reserving the authority and capacity needed before work starts. A **fencing generation** is a version token that makes old workers' later messages invalid. A **read model** is a view of authoritative records prepared for display, not a second source of truth. An **outbox** is a durable record of something that must be sent and later reconciled. A **capability** is a narrowly scoped permission to do a specific operation, not a claim in an agent prompt. **Provenance** records where information came from and which exact version supports it.

## 13. Sources and review scope

Repository paths below refer to the single pinned commit above. Source inspection establishes what was visible in those paths, not live compatibility. Public documentation was checked during this review and can change. Account entitlements, provider permission, resource rates and platform integration behavior require their own current implementation-time checks. Agency-Agents mapping is inherited from the fully read company plan; its repository was not reinstalled or independently re-audited in this turn.

**[G01] Gen V1 README**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/README.md`

Product summary, beta status and verified platform claims; source report, not rerun verification.

**[G02] Gen V1 architecture**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/docs/architecture.md`

Embedded Hermes engine, local host, native text adapters, receipts, UI and recovery boundaries.

**[G03] Production Hermes composition**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/apps/server/hermes-service.ts`

Actual createHermesService composition of Service, Hermes runtime and source library.

**[G04] Core contracts**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/contracts/index.ts`

Thread, run/epoch, operations, resources, artifacts, usage and local runtime adapter.

**[G05] Planning contracts**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/contracts/planning.ts`

Plan/AgentJob schemas, local delegation batches and history bounds.

**[G06] Planning coordinator, inspected initial implementation and dispatch path**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/core/planning.ts`

Parent-owned read-only auxiliary runtimes and the three-reader guard. Targeted inspection, not every line.

**[G07] SQLite store**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/storage/store.ts`

Local command transactions, event sequences, argument-hashed receipts and snapshots.

**[G08] Task memory**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/core/task-memory.ts`

12 entries, 768 bytes per entry and 4096-byte total guard; revisioned notes.

**[G09] Learning context and session search**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/core/learning-context.ts`

The inspected searchSessions helper queries messages across the local store; learning guidance and provenance.

**[G10] Hermes settings in Gen**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/runtime-hermes/settings.ts`

Original memory disabled, app memory/tool composition and learning settings captured for the run.

**[G11] Context-efficiency tests**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/tests/context-efficiency.test.ts`

Tests for paged discovery, metadata-first reads and revision-pinned recovery; tests were read, not executed.

**[G12] Core service, inspected portions**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/core/service.ts`

Composition, run lifecycle and background coordination. The large file was not audited line by line.

**[G13] Artifact admission**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/core/ui-admission.ts`

Thread-scoped data/resources, action routes, request revisions and progress-data binding.

**[G14] Temporary credential-entry slots**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/packages/core/credential-slots.ts`

Memory-only local credential slots; not a durable fleet credential vault.

**[G15] Gen V1 security policy**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/SECURITY.md`

Local-only accepted deployment and explicit local-user/OS-sandbox limitations.

**[G16] Gen V1 product direction**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/PRODUCT.md`

Task-generated interfaces, durable state, compact discovery and single-local-user focus.

**[G17] Host startup and loopback ownership**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/apps/server/host.ts`

Separate Node host, profile ownership, loopback listeners and recovery before admission.

**[G18] Earlier product-completion report**

`https://github.com/Skytuhua/Gen-V1/blob/9f23537334f2a1dc6c3bbe00d0444f8e86b57e28/docs/2026-11-01-product-completion.md`

Maintainer-reported verification and remaining acceptance for the earlier milestone; not proof for every later commit.

**[G19] CI run for the inspected commit**

`https://github.com/Skytuhua/Gen-V1/actions/runs/41401035182`

Observed completed/failure; job metadata identifies application regression-test failure, with later checks skipped. Logs were not used to diagnose a root cause.

**[P01] Latest consolidated company plan supplied in this conversation**

Conversation attachment: `maritime-company-plan-hybrid-agency-agents.md`; SHA-256 `ac6cd7f283ac0eb433e06d7ca14c37f92c661c0109991b8f6e64908f82eb29ac`.

All 1371 lines, all 22 sections, including 32 employees, hybrid runtimes, distributed control, marketing and Agency-Agents constraints.

**[H01] Hermes Kanban reference**

`https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban`

Current public documentation checked for durable boards, PR acceptance and explicit single-host dispatcher boundary.

**[H02] Hermes persistent memory**

`https://hermes-agent.nousresearch.com/docs/user-guide/features/memory`

Current public documentation checked for memory/session concepts; no broad claim that Hermes lacks memory.

**[H03] Hermes profiles**

`https://hermes-agent.nousresearch.com/docs/user-guide/profiles`

Current public documentation checked for separate profile state and its distinction from sandbox isolation.

**[H04] Hermes scheduled tasks**

`https://hermes-agent.nousresearch.com/docs/user-guide/features/cron`

Current public documentation checked for scheduling, event-triggered and no-agent workflows.

**[H05] Maritime triggers and schedules**

`https://maritime.sh/docs/triggers`

Current public documentation checked for wake-only/platform triggers and provider webhook-delivery authentication caveat. Actual account behavior remains unverified.

**[H06] Hermes skills**

`https://hermes-agent.nousresearch.com/docs/user-guide/features/skills`

Current public documentation checked for on-demand skills and learning. Company curation rules are proposed policy, not a claim Hermes has no controls.

**[H07] Hermes security guidance**

`https://hermes-agent.nousresearch.com/docs/user-guide/security`

Current public documentation checked for existing defenses; no claim Gen is presently more secure.

