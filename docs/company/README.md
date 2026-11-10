# Gen company integration

This workspace contains an isolated **read-only client** for Maritime Company Control
and a retained-Hermes manager composition for local, unsubmitted proposals. The ordinary
CLI enables only the existing status connection; manager inference and the new context
candidate require trusted host composition and remain unavailable by default. None of
this activates E01, provisions employees or establishes company acceptance.

The owner's [authoritative communication design](../superpowers/plans/2026-11-02-gen-company-communications.md)
now controls communication implementation. The [C00 baseline](../company-communications-baseline.md)
records current dependencies and the combined candidate's HOLD verdict. Existing views
and evaluation source are preserved; they are not the final communication design.
The [partial C01 consumer](../company-communications-contracts.md) pins the shared
strict codec and discussion fixtures; every validated command remains non-executable.
The additive [read-record consumer](../company-communications-reads.md) validates
scoped output data only. The [evidence custody incident](../company-evidence-custody-2026-11-02.md)
identifies which historical receipts survived and which are missing.
The [owner-note producer conformance](../company-owner-note-conformance.md) tests
actual temporary-Store records against Gen's existing decoder without adding a route.
The additive [history consumer](../company-owner-note-history.md) validates bounded
head/historical-pair projections and independently retained query limits; it exposes
no history service call or communication view. Fresh local producer conformance and an
independent rerun now pass against CONTROL `530ec7a0`; unique03's bundled unconfigured
host/bootstrap/history closure also passes. Their exact scope and separate receipts are
recorded in that history document; they do not establish live communication authority.
The separate [trusted owner-host HTTPS history client](../company-owner-history-read.md)
now consumes one implemented same-host read at CONTROL `7a960022`. It is explicitly
constructed with operator CA trust and an owner service credential, and is not
registered in the CLI, browser host, tools or engine. Remote owner authentication,
streams and room UI remain unavailable.

The existing personal Gen application still uses its original Hermes engine. Company mode
does not load that personal runtime, account library, plugins, filesystem tools or session
search. The proposed E01 outer application is Gen V1 with Hermes retained. The service's
current target remains 18 Hermes engines and 14 native Codex employees, all unverified.
All employees require `gpt-6.1-sol`: E01 `max`, staff `xhigh`. No setting is translated or
silently replaced by a paid route.

## Run locally

From this repository, run:

```powershell
pnpm build
pnpm exec tsx apps/server/company-main.ts
```

Open `http://127.0.0.1:4319/company`. Without an explicitly configured service connection,
the interface reports unavailable records. It never substitutes sample company activity.
The separate [Stage 1 communication workspace](../company-communications-stage1.md)
has an explicitly selected, labeled fixture mode for the approved read-only journey;
it never substitutes fixtures after an authorized read fails.
The host uses a separate `GenerativeHarnessCompany` profile for its listener lease;
it never opens a company business database or the personal harness database.

Trusted operator configuration consists of:

| Variable | Meaning |
| --- | --- |
| `GEN_COMPANY_SERVICE_ORIGIN` | Exact `http://127.0.0.1:<port>` service origin, without a trailing slash. |
| `GEN_COMPANY_SERVICE_TOKEN` | A separate owner service credential provided to this host through trusted secret delivery. |
| `HARNESS_COMPANY_PORT` | Local interface port; defaults to `4319`. |
| `HARNESS_COMPANY_DATA_DIR` | Separate listener profile; never a path to the service database. |

Both connection variables must be supplied together. No real service instance or credential
was supplied for this checkpoint. Do not use Maritime, GitHub, model API or native login
credentials in the service-token slot. The bearer remains in the Node host and is absent
from browser responses and model tools. This client does not issue or register credentials.

Both current listeners are loopback-only. E01 runs on a different computer from Company
Control; that future deployment needs a separately reviewed private authenticated transport.
Changing a bind address or pointing this client at an arbitrary URL is unsupported.

## Interface and authority

The company workspace presents authorized projects, planned employees, service blockers,
campaign draft records when returned, and authentication/budget observation metadata.
It preserves local owner notes, selection and filters. Those notes are client state, not
company memory or an owner mandate. A failed refresh marks the retained snapshot stale.
Refreshes read status explicitly; there is no invented event stream or worker polling.

The default connection exposes status and conditional inert artifact-preview requests. The
standard service CLI lacks artifact injection, so preview capability remains unavailable
until a trusted host supplies it. The review-package route can update synthetic review state
and is deliberately absent from the read-only host. Pause, cancel, emergency stop, company planning,
dispatch, approval and publication controls remain disabled. Their unavailable state must
not be mistaken for working cancellation or whole-process termination.

The low-level server-only client describes all eight existing service routes for conformance.
Only its narrow employee-role adapter can supply E01's three read tools; it rejects an owner
client before network access. The owner interface never exposes those employee tools or
lends its bearer to an agent. No adapter is installed into the active E01 runtime here.

Company Control alone owns projects, staffing, tasks, scheduling, budgets, approvals,
mailbox, evidence, independent review and publication. Gen has no company SQLite access,
operational scheduler, competing queue, synthetic completion receipts or publisher.

## Manager proposals

The Plan panel stores the owner's instruction, notes and saved request identity locally.
It can show typed task proposals with dependencies and evidence requirements. A draft is
explicitly unsubmitted: its `companyReceipt` is null and `dispatchAuthorized` is false.
Interrupted requests are recovered by their existing ID; uncertain execution blocks a new
inference. An authenticated missing journal record permits an explicit retry of the same
saved input. Editing the next instruction never silently changes that original request.

`packages/company-manager/runtime.ts` uses the isolated `createHermesEngine` export with
its own home and data directory. It disables personal integrations, skills, memory,
learning helpers and compaction. It accepts only the separate employee's three scoped
read tools. Trusted admission must supply and continually revalidate an E01 machine,
account, exact Sol/max route and finite request/tool/time limits. No supplied company
admission authority currently exists, so the CLI cannot turn inference on. The local
interaction journal is not a company mandate, intake, WorkOrder, approval or memory store.

## Project and task context candidate

The separate owner-host candidate is `maritime-company-manager` `1.0.0-candidate.1`,
pinned to backend source checkpoint `aca8ec09de5cda73b014a348a05a8f05b43f465b`.
Its [manifest](../../packages/company-contracts/company-manager.v1.json) SHA-256 is
`fb4e7d2eba19275c5d4013576a01d90984c9f716ce9f0d6e1d1b31a15d46a033`;
the [samples](../../packages/company-contracts/company-manager.v1.samples.json) hash is
`9402e4279e3f0772d5c3eee22e9dddc4f495d4fb30e2506bf90a738070fff9bd`.
Both files preserve raw LF bytes. These are file pins, not running-server negotiation.

Two fixed POST reads provide exact-project context and a single task section:
dependencies, attempts, artifact metadata or stored review receipts. Owner credentials
stay in the host. These DTOs are never passed to E01's employee context source. Responses
are bounded to 256 KiB, strict schema-checked, and matched to the requested scope, task,
section and page size. A changed snapshot returns an explicit restart requirement;
pages from different snapshots are never combined. Controller-origin artifact metadata
keeps its null employee/task/attempt associations. No download or readiness mutation is
provided. Mandate, knowledge and canonical dossiers remain unavailable.

The optional `contextReader` constructor dependency is absent from ordinary CLI
configuration. Candidate conformance and synthetic transport tests do not establish
backend authorization, cursor binding, snapshot consistency or unchanged-Store reads.
The pinned ingress checkpoint `99df4862dabe556fa83ee201b8e4c31a3a78d5dc` now passes
an opt-in authenticated consumer test using the backend-owned temporary fixture. It
checks three-page continuity, both-route scope isolation, the optional Gen owner proxy
and unchanged/removed synthetic Store receipts. An independent reviewer reran it.
No production registry, private deployment, real artifact/review capability or native
admission follows from this fixture. Ordinary CLI composition remains unavailable.

Run that fixture test only against the clean, exact reviewed backend checkout:

```powershell
$env:GEN_COMPANY_TEST_SERVICE_ROOT = 'C:/Users/user/Documents/Maritime/hermes-swarm-control'
pnpm exec vitest run tests/company-manager-service-integration.test.ts --maxWorkers=1
Remove-Item Env:GEN_COMPANY_TEST_SERVICE_ROOT
```

The test verifies checkpoint and raw file hashes before launching the bounded child.
It never receives a database path, reads an operator registry or copies native auth.

The dossier shows direct prerequisites from the selected task page, with source state,
digest availability and explicit incomplete-page labels. Inspecting a prerequisite
performs another exact scoped read; returning cancels and fences stale responses.
The service currently supplies no measured critical path, and the UI says so.

## Proposal evaluation

The [offline evaluation suite](manager-evaluation.md) freezes six representative
requests and a separate scoring policy before actual model runs. It requires 18 recorded
repetitions, keeps missing measurements and reviews pending, and treats reviewed policy
or false-completion failures as fatal. Its assertions cannot establish company acceptance.
The current unexecuted report has zero supplied runs; no model-quality win is claimed.

## Fixed planning command checkpoint

The separate `maritime-company-manager-commands` `1.0.0-candidate.1` candidate is pinned
to issue-time commit `b4317f308ca84a26de5cd647706b3f9997cddfd3`. Its raw manifest digest is
`8ae1a4821077c457173c1231c739df595ffdacc27a75c06e73de66afe0f52bfc`; samples digest is
`de3a037d21211d19802d6c852f984b654029204801a3eb630944397630248efd`. Both preserve LF bytes.
The documentation clarification at `f2f2ffbcd31c8d83b7180d107dbf54c7b43e5959`
does not change those candidate bytes or enable ingress.

The server-only client and optional owner proxy expose exactly five operations:

| Gen host POST path | Client method | Purpose |
| --- | --- | --- |
| `/api/company/planning/mandate` | `setMandate` | Store a versioned project planning mandate. |
| `/api/company/planning/intake` | `recordIntake` | Store original owner input against its exact mandate. |
| `/api/company/planning/proposal` | `submitProposal` | Forward an immutable, unverified local draft. |
| `/api/company/planning/review` | `reviewProposal` | Record an exact planning-only owner decision. |
| `/api/company/planning/context` | `planningContext` | Read one exact record or the current mandate. |

**Backend command ingress and persistence are not implemented.** Ordinary CLI
composition never installs `planningClient`, including when its status connection is
configured. The proxy reports unavailable. Trusted test composition has a distinct
`planning_records` connection mode; the existing read-only UI does not consume it.
No owner credential enters the engine. Storage receipts and positive planning reviews
cannot authorize a WorkOrder, task, budget reservation, merge, deployment or publication.

Only these five routes have 131,072-byte request/response limits; old request bounds
remain 32 KiB. Inner mandate/intake/proposal-content limits are 65,536 strict UTF-8 bytes
including JSON escaping. Fixed schema keys make compact JSON byte length independent
of key order; isolated surrogates are rejected rather than normalized. The local draft
digest stays an opaque client claim; the service alone computes canonical record IDs.
Server timestamps use Unix seconds; the preserved local `createdAt` uses milliseconds.

Each distinct mutation needs its own `message_id`, separate from the intake's
`client_request_id`. The caller must durably retain the exact request envelope before
sending. The client/proxy never supplies a replacement ID or retries automatically.
After a timeout, recover with the original ID and exact arguments; do not infer absence
or silently rebase. Message/revision/stale-basis/reference conflicts remain distinct
fixed errors. Actual durable replay, storage and authenticated mutation proof await
backend implementation and a reviewed fixture.

The owner has supplied the authoritative communication design linked above. New
communication work follows its C00-C19 dependencies and staged rollout; prior proposals
do not override it. Existing source remains preserved. Unrelated views/evaluation work,
live ingress, fleet activation and external effects remain gated. This fixed planning
client does not activate native feasibility or original E01/E10/E11 pilot prerequisites.

## Contract and limits

The client pins the exact candidate [manifest](../../packages/company-contracts/company-service.v1.json)
and its SHA-256, together with the service's request/auth baseline. The candidate is
`maritime-company-service` `1.0.0-candidate.1`. The service advertises no runtime contract
version; the displayed baseline identifies the **pinned client contract**, not a remotely
verified running build. The reviewed backend checkpoint is
`bcb9ee7c6196243b2647e917a1ccb7b1d0793770`; the unchanged request/auth baseline remains
`770b56620a6a8587a8c9e8e321e8c731cbb35807`. The exact manifest digest is
`80fcc2f4cddafaeb7811eb3d195f908ff974f06e79e3ca79d680188e4b1aad4c`.
Its accepted CRLF bytes are preserved with an exact-path Git attribute.

Requests use exact JSON bodies, fixed POST paths, one Content-Length, a server-held bearer
and a direct IPv4 loopback connection. Redirects, ambient proxies, content encodings and
arbitrary endpoints are rejected. A single deadline includes credential retrieval and HTTP
reading. The local response limit is 8 MiB. The service promises no pagination or response
size: overflow, malformed/non-JSON responses, identity mismatches and incompatible semantics
fail the entire read. No partial response is presented as a complete snapshot. Upstream
error HTML and raw exception text are never rendered.
Response bodies use strict UTF-8 decoding: malformed bytes fail the read instead
of silently changing source text to replacement characters. Valid Unicode,
including an intentional replacement character, remains accepted.

## Verification and remaining work

The [feature backlog](feature-backlog.json) preserves every requirement, its owners, priority,
source line, required behavior and acceptance check. Implementation/activation assessments
are separate from those source descriptions; a test fixture cannot clear a live gate.
The current assessment is 199 partial and 22 not implemented; zero unassessed, fully
implemented or activated. All 221 rows retain their required acceptance proofs.
The [manager/context verification receipt](verification-manager-2026-11-02.md) records
the local passes and personal regression/typecheck failures observed at each frozen
window. Those historical failures remain unchanged. A later frozen candidate2 passed
typecheck, web/desktop builds, 1,710 unit cases (three explicit opt-in skips), 33 workspace
and 16 shared-panel browser cases, and nine prepared checks in the actual unique03
unpacked application. Its source and compiled hashes remained unchanged through that
window. This technical checkpoint does not clear installed-release, company activation
or full221 acceptance gates; no broad rerun is inferred after these documentation edits.

```powershell
pnpm exec tsx scripts/company-requirements.ts --check
pnpm exec vitest run tests/company-*.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test tests/e2e/company-mode.spec.ts
```

The staged [implementation plan](../superpowers/plans/2026-11-02-company-manager-integration.md)
covers the remaining areas. Native account renewal/concurrency, exact effective reasoning,
whole-process/project isolation, private ingress, trusted observations, selected-repository
publishing, the dedicated three-machine pilot, real demo production and E01 cutover remain
separate live gates. No cloud, provider, publication or full-company acceptance follows from
local TypeScript, HTTP, Python-fixture or browser checks.
