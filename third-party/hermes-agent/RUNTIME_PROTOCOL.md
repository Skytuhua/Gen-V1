# Original Hermes worker

`packages/runtime-hermes/worker.py` runs the unmodified sources in `upstream/`
at commit `c627ec84664d43e0b18b95d9d86d8963747d56c7`. It registers the public
`ProviderProfile.create_client` extension returning an original `ACPClient`
subclass. The subclass serializes transport calls, denies ACP filesystem/terminal
requests, emits request ownership metadata and attaches measured host usage. It
does not replace the original parser, agent loop, learning/review/curator policy
or skill implementation.

Launch CPython 3.14 with `-I -S -B`. `hello.dependencyRoot` identifies an isolated
target installed from `runtime-requirements.txt`; global and user site packages
are unnecessary. Resource layout is `<root>/packages/runtime-hermes/worker.py`
and `<root>/third-party/hermes-agent/upstream`. No source is downloaded at runtime.

## Frames

The private UTF-8 JSONL pipe accepts `{id,method,params}` and returns either
`{id,result}` or `{id,error:{code,message}}`. Frames are bounded at 32MiB.
Notifications are `{event,ctx,data}`. A reverse host call is
`{hostCall:{id,name,args,ctx}}`; answer with
`{hostResult:{id,result}}` or `{hostResult:{id,error:{message}}}`. Reply identifiers
are opaque and owned by one pending call. Source console output goes to stderr.

`ctx` is the host's run/thread/account/epoch ownership metadata. Event and reverse
call contexts additionally contain `phase: foreground | background_review`,
derived from the original source's provenance context.

## Bootstrap and agent methods

- `hello {home,acpCommand,acpArgs?,dependencyRoot?,config?}` binds one app-owned,
  absolute `HERMES_HOME` and returns protocol version 1, pinned source commit,
  Python version, engine class and method names. Config is frozen before source
  runtime imports. Lazy installs, inline shell/template preprocessing, external
  skill directories and original memory are disabled. Only original skills and
  explicitly registered host tools are advertised. Restart the worker to change
  frozen source settings such as `skills.disabled`.
- `learn.prompt {request?}` returns `{prompt}` from the original builder.
- `agent.start {ctx,modelId,accountId?,prompt,inputIds?,sessionId?,sessionPath?,
  history?,thinkingLevel?,systemPrompt?,hostTools?,skillPolicy?,brokerURL?,jobKey?,
  maxIterations?}` acknowledges `{accepted:true}` before starting owned work.
  Host tools use `{name,description,parameters}` or `{type:'function',function:{…}}`.
  The host's opaque broker URL/key are inherited by original ACP subprocesses
  through `HARNESS_HERMES_BROKER_URL`, `HARNESS_HERMES_JOB_KEY` and selected
  `HARNESS_HERMES_MODEL_ID`; credentials remain in the native runtime.
- `skillPolicy {enabled?,allowWrites?,disabledNames?,protectedNames?}` gates model
  dispatch around original registry handlers. Writes require explicit
  `allowWrites:true`; protected/disabled names are also checked within batches.
- Consecutive turns with the same session/model/account/tool/policy/prompt binding
  reuse the real `AIAgent`, retaining its iteration counter and frozen prefix.
  Changing bindings closes that actual parent only after its owned work settles.
- `agent.followUp {prompt,inputId?}` calls original `steer` with a ticket and
  returns `{accepted,inputId?}`. Accepted means buffered, never model entry.
- `agent.cancel {}` interrupts actual foreground and review work and closes the
  original active request client. Its acknowledgement is not settlement.
- `agent.cancelBackground {}` uses original cancellation and waits for actual
  `_BackgroundReviewRun.request_done`. Failure retains ownership; a timeout does
  not authorize releasing the account/process lease.
- `agent.history {}` returns `{messages}` containing actual source messages.
- `agent.compact {}` calls original compaction while idle and returns
  `{messages,compacted}`; an unchanged result is not reported as compaction.
- `agent.dispose {}` cancels and joins owned work, then closes the actual agent.
  A still-live owner returns an error rather than claiming disposal.

`sessionPath` must be `HERMES_HOME/sessions/<sha256(threadId)>.json`. Source messages are
persisted atomically as `{format:'hermes-source-session-v1',sourceCommit,
identity,ownership,sessionId,messages}`. Stable `ownership` binds thread/account/path/source;
`identity` is the separate parent-reuse fingerprint. Model/thinking/policy changes
may reopen the same owned history, while account changes cannot adopt it.
This is a transport/history document; canonical
skill packages, usage, pending approvals and ledgers stay in `HERMES_HOME`.

## Events and measured entry

`started` reports the actual parent instance, advertised tools and source
`itersSinceSkill`. `model_request {sequence,inputIds}` is emitted when the real
source prepares an ACP completion. It is not an input-entry receipt. The host
must wait for its original native SDK's real input-entry callback before
acknowledging those inputs. Source-drained steering tickets are added to the
request's ownership metadata. `$transport.usage {jobKey,sequence}` asks the host
for that serialized native completion's usage; missing usage remains unknown.

`tool_start`, `tool_complete`, `assistant`, `source`, `library` and `review`
forward actual source callbacks or completed source skill mutations.
`foreground_settled` contains `{engineClass,agentInstance,itersSinceSkill,text,
sessionPath,result,usage}`. `result` is the original conversation result and may
itself report failure/partial/interruption. `usage` contains
`{sequence,phase,usage|null}` entries, not ACP's compatibility zeros.

`review_started` and `review_settled` expose the actual owned review barrier.
Final `settled` follows foreground and owned review request settlement, includes
all measured transport usage, and adds `unconsumedInputIds` from original
`withdraw_steer`. It is the cleanup barrier, not a second UI assistant settlement.

## Library methods

Direct library RPCs are explicit user actions. Model operations reach only the
guarded original registry and cannot call these methods themselves.

- `skills.list {}` returns `{skills,usage,archived}` from original discovery,
  sidecar and archive helpers. The UI list includes source-disabled rows.
- `skills.snapshot {}` returns `{catalog,inspections,proposals}`: one namespace
  check around a locked metadata snapshot. Inspection rows omit full documents,
  bodies and frontmatter, retaining file SHA256 values, usage and ledger metadata.
  The host fetches full content only for changed packages and explicit inspection.
- `skills.view {name,file_path?}` returns the unchanged original view result with
  preprocessing disabled. Model view calls retain original dedup/read marks and
  usage updates, with preprocessing disabled by source config.
- `skills.inspect {name,file_path?,revisionId?}` returns `{name,description,
  category,document,content,frontmatter,files,usage,versions}`. `document` is full
  original SKILL.md; `content` is body parsed by original `parse_frontmatter`.
  Optional supporting-file fields are `filePath`/`fileContent`. Revision IDs select
  original ledger after-state blobs. Missing after-state/body is explicit.
- `skills.compose` uses the original frontmatter parser, YAML writer and fuzzy
  matcher to translate UI body edits into complete native SKILL.md documents.
  Body-only changes keep the raw frontmatter prefix. Model schemas are unchanged.
- `skills.manage` accepts original `skill_manage` keyword arguments,
  including the original operations array (maximum 20), full-frontmatter content
  and original patch behavior. This explicit user Save uses original approved
  replay. Model dispatch retains the original write-approval gate.
- `skills.import {payload}` uses the same approved replay for existing committed
  legacy bytes. `skills.stage {payload,summary,origin}` preserves pending legacy
  proposals through the actual original pending store; no proposal is auto-approved.
- `skills.flags {name,pinned?,archived?,enabled?,protected?,managed?,legacyUsage?,legacyFresh?}` delegates to
  original pin/archive/restore/adopt/usage functions. Host controls are canonical
  `harness_enabled`/`harness_protected` usage metadata and effective original pinning;
  `harness_pin_baseline` preserves prior source/user pin ownership.
  Migration-only `legacyUsage` carries verified legacy counters/timestamps and an
  import identity. The original usage writer applies it once, atomically with the
  controls and `harness_legacy_usage` marker. A fresh import replaces generated
  import metrics; a matching pre-existing source preserves newer canonical activity.
  Catalog refresh does not reapply the migration snapshot.
- User writes can include `expected` canonical document/file SHA256 and
  flags/state/ledger-tip snapshots. The worker compares them under the same
  `skill_lock` as actual model skill handlers before invoking original writes.
  A mismatch returns `STALE_SKILL`. No revision is added to model-facing schemas.
- `skills.versions {name?,limit?}` returns original ledger entries.
- `skills.rollback {id}` invokes original rollback and returns `{success,message}`.
- `skills.proposals {}` returns original pending write records.
- `skills.decide {id,approve}` replays the original pending payload on approval,
  or discards it on rejection. Failed replay retains the pending record.
- `skills.curate {dryRun?,consolidate?}` runs original synchronous curation. The
  optional LLM pass needs a live captured native broker owner and frozen
  `model.provider/default` (or original auxiliary curator configuration) matching
  that selected runtime. Deterministic curation needs no inference.

The Node library persists intent before source mutation and a command receipt only
after verified refresh. Ambiguous results retain intent and never blindly replay.
Confirmed refusal clears the intent. Legacy packages that exceed native limits
or conflict with source remain readable, with intact SQLite history/proposals and
`migrationError`; activation/mutation is gated rather than silently changing bytes
or preventing host startup.

## Local proof scope

`tests/hermes_source_contract.py` verifies every vendored byte against Git blob
and SHA256 custody and executes original prompt/fuzzy/batch modules.
`tests/hermes_source_worker.py` uses scripted ACP text, with no credentials or
inference: real AIAgent tool execution, retained parent/cadence/history, actual
ten-iteration automatic review with agent creation provenance, original atomic
20-operation/fuzzy/rollback behavior, and pending approval replay. This does not
establish signed-in native inference quality or universal upstream product parity.
