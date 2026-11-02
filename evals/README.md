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
