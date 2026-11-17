# M15 additional changed-path browser regression results

## Scope and execution

These runs cover usage/context, the agents workspace, and scoped conversation because M15 changes App, ContextInspector, and the shared composer. The source base remains `399cde39ff4ee82272c7a7700944325c44b36070`.

Each registered suite was first run through `node --import tsx scripts/test-browser.ts --suite NAME`, preserving the suite's declared configuration and environment. All three configurations declare `channel: 'msedge'`. Every declared case failed during browser launch because `/opt/microsoft/msedge/msedge` is unavailable. Those are actual exit-1 attempts; no behavioral assertion pass is claimed for them.

The explicit equivalent configurations are retained under `m15-artifacts/browser-adapters/`. Each imports its original configuration and changes only the channel to the installed default Chromium and the relative `testDir` to the original `tests/e2e` directory. Distinct output and JSON-result paths are supplied by the recorded commands. Original worker counts, assertions, timeouts, viewports, web servers, and suite environments remain intact. The agents workspace run retains the registered `AGENTSUI_APP_CANDIDATE=1` value.

No product code, original test configuration, or test assertion was edited for these three suites. The machine-readable summary verifies that all six original configuration/spec files retain their pre-run SHA-256 digests.

## Observed results

| Suite | Declared Edge attempt | Explicit Chromium equivalent | Remaining result |
| --- | --- | --- | --- |
| Usage/context | 21 launch failures, exit 1 | 21 passed, exit 0 | Chromium coverage passed; Edge unavailable. |
| Agents workspace | 15 launch failures, exit 1 | 13 passed, 2 failed, exit 1 | Loading deadline and command-receipt fixture mismatch described below. |
| Scoped conversation | 15 launch failures, exit 1 | 15 passed, exit 0 | Chromium coverage passed; Edge unavailable. |

The usage/context run covers ownership across compaction requests, keyboard and IME focus, honest unknown metrics, nested dialogs, narrow layouts, and reduced motion. The scoped-conversation run covers preserved message/scroll anchors, supplied-composer focus, hidden panes, invalidation, exact epochs, bounded Unicode continuation, 200% zoom, and real API error states.

Chromium results do not establish Edge, Windows, or installed-desktop coverage.

## Agents workspace failures

The first 1440-pixel loading case did not observe the `Loading agents` status within its unchanged five-second assertion deadline. Its failure trace and snapshot are retained. This is an observed readiness failure; no baseline attribution is made from that single run.

The child follow-up case sent the expected `agent.followUp` command with the parent thread, job, parent run, child run, and content. The intercepted response was `{id, status, result}`, but the existing command client requires `{commandId, result, eventSeq}` or its supported `seq` alias. It therefore rejected the response before reading the current ticket. The UI retained the input and exposed a retry/error state.

The command parser, child-input API, follow-up controller, and test fixture are all byte-identical to their accepted-base blobs. The summary records those four exact blob pairs. This establishes a fixture/schema mismatch in unchanged files; it does not substitute for executing the baseline suite. The two failures remain in the recorded result.

## Evidence

`m15-artifacts/changed-path-browser-regressions-summary.json` contains original configuration/spec digests, adapter digests, environment values, exact result statistics, receipt/log references, retained screenshots, both agents failure traces, and the failure diagnosis. Each original Playwright JSON result is preserved unchanged.

| Receipt ID | Exit | Bounded log SHA-256 |
| --- | --- | --- |
| `usage-context-declared-01` | 1 | `9b61742966201144aeba91663992e6175352975378202dda3c87d8335cf6e87e` |
| `agents-workspace-declared-01` | 1 | `e8bf32b8e92150e354bac40a4d1e39908d4c80e5438ba339e2f734f0edc81a27` |
| `scoped-conversation-declared-01` | 1 | `d07722aa24d21fb21e4511597f2b603d8cc0376309a36857d5478500d7c36701` |
| `usage-context-chromium-01` | 0 | `8170c21c8ca1419e9920eb3ec6ae6f0938d053f2d151d7036d5a9ac42162b330` |
| `agents-workspace-chromium-01` | 1 | `26c197a5458ca52c8cc00b4685c560a680d1c6b93eeb9ebb25d41cf9563304d5` |
| `scoped-conversation-chromium-01` | 0 | `020ee22a2d89b0803f7d765f9ac3577b4abcca6984d63b65fb29d1e617898695` |
