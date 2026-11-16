The frozen `heldout-v1` set has 12 cases: 3 coding, 3 research/data, 2 documents, 2 planning, and 2 mandatory novel apps. `cases.ts` freezes case prompts/checks before execution; `CASESET_SHA256` travels in each report. Do not change held-out prompts/checks while tuning against results; version a new set instead. The tool catalog never imports these cases into the model's system context.

Create a pending report without any model call:

```powershell
pnpm eval --out C:\scratch\NEW-pending-eval
```

Run the actual local host/Pi adapter after user-owned model authentication is available:

```powershell
pnpm eval --out C:\scratch\NEW-live-eval --host http://localhost:4317 --model <actual-model-id> --repetitions 3
```

Use the host's actual configured origin/model ID; those are example CLI arguments. The runner bootstraps the host's cookie/CSRF interface, verifies the selected model exists, creates a new durable thread for each case/repetition, grants exclusively new disposable fixtures and sends the frozen task through `message.send`. It reads actual snapshots and saves them alongside `results.json`. Each of the default 36 runs has its own repository, sources, SQLite database, editable PDF and exports directory. An existing output directory is refused. There is no canned assistant response, mock runtime or auto-approval in this runner.

Prepared operations and explicit user decisions can legitimately leave a run awaiting input. The runner does not approve or invent those decisions. Review the case thread in the host, approve only the concrete fixture operation you intend, and inspect resulting evidence. A run timed out while still working is stopped through the host. Ctrl-C stops current model work best-effort; already completed effects are not rolled back. Reports retain `pending` when a real session, evidence or required interaction is unavailable. No live evaluation was performed by the implementation tests.

Scores need actual `host-pi` identity (model ID, thread, Pi session path and snapshot sequence) and every frozen check. Automatic observations only admit observable sourced data, binding/artifact presence and prepared operation evidence. Persistent edits across expand/remount, purpose-built novelty and task correctness need real interaction review; presence alone does not prove correctness.

Supply reviewed judgments as an array:

```json
[{"caseId":"novel-custody","repetition":1,"checkId":"novel-interaction-review","status":"pass","reviewer":"User name","evidence":"Observed receiver edit retained through expand and remount in thread <id>; action produced host event <seq>."}]
```

Merge judgments without overwriting the execution receipt:

```powershell
pnpm exec tsx evals/review.ts C:\scratch\run\results.json C:\scratch\judgments.json C:\scratch\NEW-reviewed-report.json
```

Review changes assertions only; it cannot create a real-model identity. A fabricated/unexecuted report stays pending. Duplicate/unknown case checks are rejected. The replacement-plan-v1 pilot policy requires at least 30 fully successful runs out of 36, at least 10 scenarios succeeding twice, at least one scenario in each category succeeding twice, and the designated novel-custody scenario succeeding twice. A successful run has every frozen check passing and a completed task outcome; partially passing checks never count as a successful run. The prompts and checks remain frozen under the original caseset SHA; the scoring policy is separately versioned. Incomplete runs or interactions keep the aggregate and corresponding gates pending. Exit code 2 means pending/unmet gates, 1 means runner error, and 0 means all acceptance gates passed with recorded evidence. The default pilot is 36 runs. Smaller --repetitions reports set pilotEligible:false and remain pending for pilot acceptance, even when every requested check passes. UI usefulness within two validation repairs, integrity tests, recorded interaction/recovery evidence, accessibility and reference-browser performance are additional release gates; a statistical score alone cannot establish first-usable acceptance.

## M05 project memory comparison

`project-memory-study.ts` is a separate repeated-task study. It freezes three inline report-formatting tasks and compares a thread-note-only arm with an explicitly opted-in project-memory arm. Each arm starts a fresh main conversation. The runner uses the source conversation's actual provider, model, account and thinking level, and alternates which arm runs first. It submits an identical `READY` warmup in each conversation before the scored task. A captured warmup containing memory, or a missing warmup capture, stops the comparison.

Create an unexecuted manifest without contacting any host:

```powershell
pnpm exec tsx evals/project-memory-study.ts --out C:\scratch\NEW-m05-manifest
```

Live execution requires an operator-supplied actual loopback HTTP origin, available model ID, disposable project ID and settled source conversation ID. The source conversation must already be pinned to that model/account, and the selected account must match it. Its project must already be opted in with only that source conversation selected and exactly one accepted project policy equal to `MEMORY_STUDY_POLICY` in the runner. The runner does not create those approvals, enable host flags, change accounts or alter an existing policy to make setup pass.

```powershell
pnpm exec tsx evals/project-memory-study.ts --out C:\scratch\NEW-m05-live --host ACTUAL_LOOPBACK_ORIGIN --model ACTUAL_MODEL_ID --project DISPOSABLE_PROJECT_ID --source-thread SOURCE_THREAD_ID
```

Those names are placeholders, not configured endpoints. The live run attempts twelve foreground submissions: six warmups and six scored tasks. Additional extraction or consolidation work can incur provider charges. Every new thread is observable in the host. Control receives the exact policy as a thread note, excludes project memory from its host-prepared request, and sends that same request token. Treatment must select exactly the pinned policy. The runner rechecks the source cut between arms, rejects a changed request/account/model/session, and never approves a proposed effect. Abort or task failure triggers a best-effort stop for the active study thread and preserves the partial report.

The report includes the pinned source cut, per-arm native session metadata, raw warmup/task usage snapshots, selected revisions, injected bytes, output correctness and aggregate project retrieval latency. PREPARING exclusions must preserve the full scope and request identity. CAPTURED recall is available only after native input acceptance: its current epoch/run binding may advance, while the project, account, thread, request ID, generation, selected revisions, injected bytes and numeric scores remain pinned. Plaintext matched terms are removed before receipt persistence. Correctness checks actual JSON timestamps and decimal formatting. The recall-usefulness score is an operational proxy based on correct treatment output plus selection of the pinned policy. This small alternating study does not establish a causal effect or independently measure source-file preservation; its inputs are inline JSON, and any recorded operation or writable grant rejects a run.

Auxiliary reporting includes all extraction and consolidation spend for the dedicated project, including setup. The runner waits for registered pending auxiliary work before beginning and after the final task, with a maximum 30-second wait bounded further by the per-task deadline. It preserves unknown costs as `null`, and pending cleanup or missing charges produces `INCOMPLETE_COST`. The host must register pending extraction before exposing task settlement, so the final usage cut cannot silently precede scheduled work. Runtime foreground snapshots do not declare whether counters are per-run or cumulative. The runner retains them without subtraction; attributed foreground cost/tokens and total provider-call count remain unknown.

`MANIFEST_ONLY` performs no model call. `SETUP_FAILED` and `PARTIAL` preserve failed attempts. `EXECUTED` means all six task outcomes and complete auxiliary measurements were collected; output correctness remains the reported score, and host flags remain unchanged. Exit 0 denotes that execution status, exit 2 denotes a remaining study gate, and exit 1 denotes a runner error. Mocked protocol tests verify admission and reporting rules only. They are not live evaluation evidence.
