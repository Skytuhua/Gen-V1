# Architecture

Last updated: 2026-10-30.

## Ownership

One thread = one durable task = one exact primary Pi session. Runs have independent IDs and revocable epochs. One primary run can await up to three auxiliary read-only Pi sessions with separate identities; these readers do not become independent primary tasks. The host is the only SQLite writer. Pi's native session files own finalized model history; application projections own the conversation UI, artifacts, data, drafts, requests and operation ledger.

All updates commit projections and events atomically. Only externally identified retryable commands also store deduplication receipts. Internal events and UI tool calls without a supplied command ID do not create unused receipts. Effects follow committed intent. Identical command retries return the prior receipt; changed bodies under the same ID are rejected. Snapshot recovery includes referenced immutable data versions; SSE replays events after its cursor.

## Generation

The trusted path admits a bounded json-render graph against 48 strict catalog schemas. ChoiceList, Steps, RelationshipGraph, Status, DocumentPreview, SignaturePad and MapView provide reusable mechanics rather than a category-to-screen router. Diagnostics, ChangeSet, ApiExplorer and Pipeline add source-bound software inspectors; ImageCompare adds a granted-image reveal/split view. Optional software actions use the existing broker and grant no execution authority. Artifact presentation selects compact/standard/wide width and card/canvas frame; revisions preserve artifact identity and user state. Form/Button payloadFromState maps saved field names into submitted action payloads. Discovery returns schemas/examples, software workflow guidance and the host-owned generated-app style guide. The agent chooses when these mechanics help; no trigger phrase or production scenario router is required.

The generated-app path stores immutable HTML/CSS/JS and input/event/state schemas, but creation and mounting remain gated off by GENERATED_APPS_ENABLED=false until final acceptance. Its fixed iframe document is served from a separate loopback origin using a one-use mount ticket. The host controller fetches only the installed import-free worker IIFE, omitting credentials and refusing redirects, then relays those bytes to the sandboxed receiver. That receiver creates an opaque-origin data Web Worker which inherits the receiver's CSP. The worker asset's HTTP CSP is defense in depth, not the opaque-origin boundary. Generated JavaScript executes only in that worker; validated, bounded DOM snapshots reach the receiver. Host-owned base CSS lives in packages/widgets/theme.ts. No per-worker hard memory quota is claimed. A mount-specific bridge validates WindowProxy, token, artifact, mount identity and schemas. Only acknowledged checkpoints are durable.

Components with resourceId must reference a grant owned by the artifact's thread. Both ImageCompare resource IDs and planning-option image examples have the same ownership check. ImageCompare clears its prior pair when grant/source identity changes and does not accept arbitrary URLs. DocumentPreview can read a file below a directory grant through the authenticated content endpoint's relative path query; it cannot accept an arbitrary URL.

## Trusted document preview

DocumentPreview uses locally bundled legacy PDF.js and its local worker to render PDF pages to canvas. Form values and SignaturePad state derive a disposable preview; the original bytes remain unchanged. Typed marks, multiple drawn strokes and bounded resource-backed PNG marks are visual annotations, not certificate signatures. Legacy typed/single-stroke records remain compatible. Export is a separate native-approved broker operation; preview controls do not export a draft.

The apps/web/src/pdf-draft*.ts worker performs pdf-lib parse/edit/save with a deadline, cancellation and bounded inputs/outputs. It rejects repeated/cyclic or malformed page-tree references before recursive page expansion. This trusted preview worker is distinct from the generated-app opaque worker. Its regressions pass; the coherent milestone review is recorded in [acceptance](acceptance.md).

The committed frame stays visible at full opacity while one candidate draft loads and renders. A generation identity prevents stale work from committing. Field navigation retargets one viewport controller while preserving velocity; manual wheel, pointer and keyboard input retain viewport ownership until a fresh explicit navigation intent. Same-page focus changes do not reparse the document. A verified export handoff retains continuity only when the same-thread successful approved receipt, source/destination grants and byte hashes match; unrelated source changes or denied access clear the old pixels.

## Motion and workspace

The browser frontend remains independent of desktop packaging through HTTP commands and resumable SSE. Shared DOM spring values and existing CSS/Web Animations reshape affected regions without a new animation framework. Graph geometry drives nodes and paths together; table motion is confined to the grid. Restored selections and unchanged snapshots do not replay entrances. The user's current direction favors expressive, interruptible subtle springs over exact reference timing. Reduced motion removes travel, bounce, drawing, shimmer and stagger. See [motion-refinement.md](motion-refinement.md).

The right workspace's Plan view reads the current thread's validated plan DataRecord. The live usage footer reads RuntimeUsage and is controlled by the persisted showUsageFooter preference. Tokens, context, cost and subscription allowances remain separate nullable measurements; no time-based progress, synthetic cost or account quota is inferred.

## Plans and auxiliary readers

[packages/contracts/planning.ts](../packages/contracts/planning.ts) defines versioned PlanRecord data, steps, requirements, agent jobs and progress. [packages/core/planning.ts](../packages/core/planning.ts) is a plain coordinator used by Service. It reuses the existing event/projection transaction path: the stable plan:<threadId> DataRecord has provenance harness:plan and immutable data versions. No new SQLite migration, transport or second event log is added.

plan_update changes concise task steps and requirement IDs; job identities and execution status are host-owned. task_delegate accepts an explicit retry ID and one to three bounded reader assignments, then awaits their terminal outcomes within the parent tool call. Each reader inherits the selected subscription model and a read-only copy of current grants. Tool callbacks and source publications revalidate the original parent run/epoch and captured abort signal. Readers may inspect repository/text sources and publish evidence, but cannot write files, prepare or execute operations, publish UI, ask the user or delegate again.

agent_progress reports completed declared requirement IDs or an explicit estimate when no checklist exists. Checklist percentage takes precedence; missing progress remains null. The coordinator retains up to eight actual executor-published evidence references per job and flags truncation. A child's task_finish is local to that child; settlement without a valid final completion claim or completed checklist becomes needs_review, never parent completion. At most 24 jobs are retained per thread.

Identical completed delegation retries return the recorded result. A pending retry shares its batch. Restart marks unfinished batches/jobs interrupted and does not restart or bill them automatically; new work needs a new explicit command ID. Parent Stop/failure/disposal cancels original child contexts, including startup races. This is read-only application authority, not an OS sandbox or permission for concurrent mutating agents.

## Planning decisions and modes

Thread.mode defaults to Build for older records. Plan mode is enforced by host operation admission, not only a prompt: preparing or approving mutations is denied until the idle thread switches to Build. Native approval remains required there.

[packages/contracts/planning-question.ts](../packages/contracts/planning-question.ts) defines optional InputRequest presentation with stable option IDs, concise descriptions, explanations, text/granted-image examples and custom responses. Existing detail is local. request.detail durably queues an explanation, example or additional-option request while the original decision stays pending. Pi updates that same request with requestId/baseRevision, preserving its response schema, options, evidence basis and selected draft. Unanswered terminal deliveries become failed/retryable rather than leaving an indefinite spinner. Request content is not execution approval.

## Actions

Local manipulation updates owned UI state without inference. Agent actions atomically persist an immutable accepted-action envelope containing the submitted values, evidence versions and control identity, together with an input outbox item. Active edit leases require the submitting client identity. Requests are single-use and gate new domain mutations. Operation actions open native review of the exact prepared resources/preconditions. Both agent and UI execution use the same broker.

Draft writes synchronously stage a write-ahead record in localStorage before awaiting IndexedDB, closing the immediate-reload gap when that storage is available. IndexedDB remains the primary journal; staging failures fall back to its awaited write. Generation-based compare-and-swap prevents an old acknowledgment from clearing a newer edit. Autosave is versioned, edit leases protect incompatible updates, and conflicts preserve the local draft. Expansion retains the same mounted artifact. The generated-app lifecycle retains dirty mounts across thread navigation until checkpoint or explicit discard.

## Recovery

Stop revokes the epoch before invoking cancellation. Late executor evidence can settle an existing operation without reviving a task. Interrupted or cancel-raced effects remain unknown until read-only reconciliation establishes their postcondition; they are never automatically replayed.

Runtime tool/publication authority is tied to the active run and epoch. Repository reads use guarded resources, a frozen Git manifest/private snapshot and fixed configuration. These controls cover brokered reads and mutations; approved project test code still executes with local-user privileges. Scoped review is not OS sandboxing or final production acceptance.

Persisted input IDs are application envelope metadata, not strings extracted from arbitrary user content. History proves delivery, not completed handling. Restart restores the interface with zero model calls and requires explicit resume after reconciliation.

## Adding a category

Register resource-scoped tools/operations and metadata in the capability pack, then expose relevant catalog definitions/examples. Existing primitives or a generated app provide the presentation. Do not introduce a fixed tool-name-to-whole-screen router. See packages/capabilities/README.md and packages/ui-catalog/README.md.
