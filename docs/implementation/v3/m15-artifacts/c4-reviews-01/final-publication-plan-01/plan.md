# C4 publication and exact-head CI collection plan

## Disposition and source boundary

This is a static preparation record. It starts no tests, workflow runs, uploads or GitHub writes. The future published C4 commit, final tree, run ID and attempt remain unset. The current incoming branch parent is `eeda4a89879aa1f3baaa04e60dd4a2d9c520761c`, tree `12678a8f6c7db2718b02c99846bcdb02a1dee631`. Root applied the reviewed 082-to-eeda preservation helper under `c4-incoming-ux-adoption-01`; the independent immediate readback verified all 6,484 other worktree paths and 6,060 other index entries, the four exact candidate files, and the clean original checkout. That adoption is not a passing UX test. The incoming asynchronous selection cleanup is under a separate recorded investigation.

The accepted comparison base remains `b4aa2caa5a3cedb29a0fddb510e49b5abd802a73`, tree `cdc9e7ad31a45e9c8ec69fbf1592f0605b033c6f`. Main109 and its later child5fa are unaccepted. At 05:19:36 UTC on 2026-11-16, the branch still pointed to eeda, while main pointed to `5fa29135068f98a1a1045ae33fefc8a34f565e43`. PR390 remained open, draft and unmerged; its API base still reported b4aa, with mergeability unknown. These snapshots do not establish compatibility with current main.

The full main109 Research host audit found no dependency that requires accepting main109 for current M15/M05 authority. Its future integration requirements are conditional: preserve retired-command rejection before receipt replay while retaining the current source readers, first-account witness, M04 rollback and queued lifecycle. The separate main109 frontend review is pending. This plan does not grant whole-main approval.

Main5fa changes only `tests/e2e/desktop-surfaces.spec.ts`, but it has a concrete future merge boundary. Three incoming assertions require `status` for second-artifact rejection, pending-signature export denial and failed native reattachment. Current C4 intentionally renders those errors as `alert`, through `DesktopEntry.tsx` and `DraftTransfer.tsx`, consistent with the accepted tests. Combining those source and test cuts requires an explicit contract reconciliation. The incoming no-download assertion for pending signatures is stronger coverage to retain. All three exact hunks and current source hashes are preserved in `main5fa-desktop.patch` and `main5fa-boundary.json`; no merge or test result is inferred.

The current PR body was read in full. It says C3 is published but still describes the C3 Windows jobs as executing and actual artifact ingestion as pending. Its future replacement must report actual published C4 identity and observed results, retain C3 terminal failures and external failed attempts, and preserve draft, partial-acceptance and default-off limits.

## Exact workflow contract

The active workflow equals the sealed v4 bytes, SHA-256 `2503858a5fa3cae35d4123e90001abe9d324ad11c9cf9a8d6d45a47c0537ac44`. The ingester is `c4/workflow-v4-proposal-01/ingest-ci-artifact.py`, SHA-256 `47171717386ab1fdfd662207f05f9a1802bf5ecb33b06f99c854faf6b223c9c2`. `workflow-contract.json` records complete selected argv scripts, artifact globs, all 37 native files, all 18 browser receipt labels and the reviewed source hashes. Its counts are declarations, not executed tests.

| Runtime job | Budget | Required command receipts | Artifact cohort |
|---|---:|---:|---|
| M15 native contracts (Windows, exact branch head) | 45 min | 1 | native |
| M15 browser contracts (Windows and installed Edge, exact branch head) | 45 min | 18 | browser |
| M15 root browser comparison (Windows, accepted base and exact branch head) | 45 min | 2 | root-browser |
| M15 full repository (Windows, exact branch head, shard 1/4) | 30 min | 1 | full-shard-1-of-4 |
| M15 full repository (Windows, exact branch head, shard 2/4) | 30 min | 1 | full-shard-2-of-4 |
| M15 full repository (Windows, exact branch head, shard 3/4) | 30 min | 1 | full-shard-3-of-4 |
| M15 full repository (Windows, exact branch head, shard 4/4) | 30 min | 1 | full-shard-4-of-4 |

Total: seven jobs, seven archives and 25 required receipts. Each artifact name is `m15-COHORT-HEAD-RUN-ATTEMPT`. Each command receipt is `c4-windows-LABEL-RUN-ATTEMPT.json`, with its exact log. The root baseline receipt lives under the archive's `baseline/` prefix.

The workflow is push-only for `agent/m15-v3`, checks out `github.sha`, and records event/ref/head/tree/run/attempt before toolchain setup. It does not require a clean PR merge tree to start. Its concurrency key includes the exact head and does not cancel earlier heads. Ordinary `ci.yml`, shared setup and lock bytes are unchanged from eeda. Ordinary PR CI can test a different merge tree and remains a separate gate.

Shared setup pins pnpm 10.30.3 and Node 24.22.2, installs frozen dependencies, and optionally installs Python 3.14 with the pinned Hermes/integration dependencies and Playwright Chromium. Native and full jobs enable both optional setups; browser enables Chromium setup and independently requires an observed installed Edge executable/version. Setup failure is retained as missing test execution, not a pass.

Native selects 37 files with two workers, JSON and console reporters. The ordered workflow list equals the ingester list. It selects the Hermes/source/memory boundary suites and `source-handoff-v3`, plus all selected custody, journal, import, composer and runtime callers. The job first builds the application and the credential lease. The recorder child is absolute Node, avoiding a `.cmd` child under `shell:false`.

Each full shard uses the ordinary `pnpm test --maxWorkers=2 --shard=N/4` selection with added JSON reporting and an explicit PowerShell exit code. The package script is exactly `pnpm build:credential-lease && pnpm build:widgets && vitest run`. There are no test-file or test-name filters. The recorder launches absolute PowerShell, which resolves pnpm inside its script.

## Browser declarations and limits

| Receipt label | Declared Windows browser | Configured test bound |
|---|---|---:|
| workbench | Bundled Chromium | 30 s |
| workbench-app | Bundled Chromium | 30 s |
| project-memory | Bundled Chromium | 25 s |
| frontend-refinement | Installed Edge | 45 s |
| saved-drafts | Bundled Chromium | 30 s |
| chat-view-modes | Bundled Chromium | 30 s |
| artifact-acknowledgment | Bundled Chromium, root config | Config default |
| scoped-conversation | Installed Edge | 20 s |
| ui-shell-overlays | Installed Edge | 20 s |
| ui-shell-controls | Installed Edge | 15 s |
| usage-context | Installed Edge | 15 s |
| agents-workspace | Installed Edge, candidate fixture | 20 s |
| agents-actual-app | Installed Edge, actual App fixture | 20 s |
| workspace-host | Installed Edge | 20 s |
| saved-layout-chooser | Installed Edge | 15 s |
| usage-app-integration | Installed Edge | 15 s |
| desktop-surfaces | Bundled Chromium, scripted desktop bridge | 30 s |
| split-browser | Installed Edge, explicit supported override | Existing Vitest and per-case bounds |

Existing per-case overrides remain effective. No deadline or retry setting is changed by this plan. Fifteen commands use the named browser runner. It selects each suite's declared specs and preserves its config, recording JSON and artifacts under `test-results/browser/run-*/SUITE/`. Frontend refinement's runner declaration selects 12 spec files; other overlapping config specs belong to their separately registered suites. Usage App includes usage integration, shell-error ownership and mobile navigation. Artifact acknowledgment and actual-App agents use the exact direct Playwright commands retained in `workflow-contract.json` and output beneath `test-results/m15/`.

Split execution sets `GEN_SPLIT_RENDERER_BROWSER=1`, `GEN_SPLIT_APP_BROWSER=1` and `GEN_TEST_BROWSER_CHANNEL=msedge` inside the recorded PowerShell argv. It runs both complete split Vitest files with one worker, records the flags/Edge/source in `split-browser-source.json`, and writes `split-browser-results.json`. This explicit Edge override is not the ordinary CI default. The wrapper equals the ingester's command constant exactly.

The paired root job runs the complete root suite at accepted b4aa and the future exact C4 head, with separate source records and receipts. Its baseline-build step can be skipped if candidate setup/build fails. Both test commands are independently retained when their builds succeed. The comparison does not cover main109/5fa.

The 45-minute aggregate browser budget is an incomplete-evidence cutoff, not a guaranteed runtime. A timed-out or interrupted job can omit later receipts. Missing execution remains explicit. Synthetic browser bridges do not establish installed-desktop behavior; Edge discovery alone does not prove every suite used Edge.

## Publication handoff

Root first finishes source-bound local gates, final reviewed manifest, custody and evidence assembly, then supplies the final staged tree. The source index must contain no unmerged or unreviewed paths; the expected tree comes from `git write-tree`. Keep the final index, tree, modes, raw bytes and source-lock identity fixed through payload construction.

Use root's independently reviewed C4 payload helper, not an altered historical C2/C3 helper. The actual parent/tree and accepted base are explicit inputs. Reuse existing Git blob SHAs, including retained archives and upstream files; preserve CRLF, modes and deletions; inline bounded small UTF-8 text and upload only required new binary/large blobs. Verify every returned blob SHA and intermediate tree SHA, then the final tree against the reviewed expected tree. The ordered parent list must describe the actual C4 reconciliation, never copied C3 parents.

Available publication connector signatures are preserved in `connector-signatures.json`: `github_create_blob`, `github_create_tree`, `github_create_commit`, `github_update_ref`. Immediately before ref advancement, read the actual branch again. Use the expected-old eeda lease, with a fast-forward update unless root's reviewed reconciliation requires otherwise. A rejected lease requires inspecting the new head before retrying. Read back commit parents, tree and remote ref. This plan performs none of these mutations.

## Actual run discovery and byte-preserving collection

Use general `github_fetch({url})` GET endpoints, not the PR-only commit-workflow wrapper. Discover push runs for the actual published head through the workflow runs collection, paginate, and verify repository, workflow path, branch, event and head. Bind a single observed attempt before collecting its jobs:

```text
/repos/skytuhua-org/Gen-V1/actions/workflows/m15-evidence.yml/runs?event=push&head_sha=HEAD&per_page=100&page=N
/repos/skytuhua-org/Gen-V1/actions/runs/RUN/attempts/ATTEMPT
/repos/skytuhua-org/Gen-V1/actions/runs/RUN/attempts/ATTEMPT/jobs?per_page=100&page=N
/repos/skytuhua-org/Gen-V1/actions/runs/RUN/artifacts?per_page=100&page=N
```

Preserve unwrapped JSON bytes with unique timestamps outside the repository. Monitor at two-to-three-minute intervals while doing useful read-only work. Preserve actual cancellation, failure, timeout, missing-artifact and rerun states. Match each archive by exact head/run/attempt name and artifact ID; do not reuse latest-attempt jobs or another source cohort. The current ingester requires terminal run and job metadata, so early downloads can be retained pending the final metadata snapshot.

Download only selected artifacts with `github_download_workflow_artifact({artifact_id, file_name, repo_full_name})`. It returns a reusable file reference. Read the current Library skill before transfer, pass the real returned file ID/name and Library ID when supplied to `library_prepare_materialize`, and choose a new outside-repo destination. Resolve the current transfer helpers once immediately before use. Pass the complete returned transfer object unchanged to the documented materialize or apply-xattrs helper. Do not reconstruct a signed URL or bypass returned attributes. `transfer-signatures.json` records the available metadata, not an executed transfer.

For each of seven archives, run the unchanged v4 ingester with the expected published C4 identity and a new output directory:

```text
python3 /workspace/scratch/1b47eb428672/m15-publication/c4/workflow-v4-proposal-01/ingest-ci-artifact.py
  --zip ARCHIVE --run-json TERMINAL_ATTEMPT_JSON --artifact-json EXACT_ARTIFACT_JSON
  --jobs-json ALL_ATTEMPT_JOBS_JSON --head PUBLISHED_C4_HEAD --tree REVIEWED_C4_TREE
  --run-id RUN --attempt ATTEMPT --kind native|browser|root-browser|full-shard
  --out NEW_OUTSIDE_DIRECTORY
```

Add `--shard N` only for the four full-shard archives. Supply actual CLI arguments on one command line or using ordinary shell continuation. No future ID is preselected by this plan.

The verifier requires exact run/job/artifact identity, Windows runner and checkout/runtime source records, the accepted baseline identity, command receipts and exact bounded-log headers/digests. It validates all ZIP paths/types/collisions and expansion bounds before extraction, preserves the original ZIP, and seals member SHA-256/Git-blob identity. Native JSON must name all 37 files; both explicitly enabled split files must be present and executed. Missing source/receipt/result evidence remains incomplete. `BYTES_VERIFIED` does not grant test PASS.

Manual review remains necessary for direct artifact-acknowledgment, actual-App agents and root argv, plus Playwright result membership, attempts, failures, flaky/skipped cases and traces. The ingester generically validates those receipts but does not enforce all of their special argv. Compare all commands to the frozen workflow contract. Aggregate full results only after all four same-head/tree/run/attempt shards are present and duplicate or missing identities, failures, skips and unhandled errors are accounted for. Preserve the original job conclusions even where a comparison suggests a shared failure.

Decoded job logs are available through `github_fetch_workflow_job_logs({job_id, repo_full_name})` for diagnosis. They do not replace original archive log bytes. For repository admission, retain original receipts in the artifact tree, copy logs byte-for-byte, normalize only a controller-required boundedLogRef, and record every raw-to-admitted receipt hash. Keep all identities, argv, times, outcomes and log bytes unchanged.

Unique original archives need durable retention before 14-day GitHub expiry. Follow the current prepared-upload batch flow and verify per-file results, attributes and pinned readback bytes. Keep private IDs and transfer URLs outside Git; admit a small public seal supplement and full member hash map. Avoid duplicating large ZIPs and extracted traces into the source manifest by default.

## Acceptance limits and historical custody

The historical C3 run43797606300/attempt1 remains bound to commit3f68a8f1 and its accepted49 base. Its seven archives, 23 receipts and 602 member hashes are already admitted, and its exact original ZIPs are durably retained. C3 native and four full shards passed; browser and paired root jobs failed. Those outcomes, C2 failures and external 0f/364/082 failures remain historical records, not C4 results. Static workflow review, synthetic ingestion fixtures and successful byte transfer do not replace actual target execution.

The final C4 handoff must continue to report `ui.sourceWorkbenchV1=false`, `reviewerApproval=false`, draft/unmerged status and any incomplete actual-target or current-main gates. This plan supplies collection mechanics and source boundaries, not independent full approval, activation, release or merge authorization.
