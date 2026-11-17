# Final local host and journal-caller gate

## State

The command is reviewed and NOT_RUN. Execution was paused before it began because the parent is preserving and adopting new remote branch/main work. The reviewed source cut is `c4-validation-final-01/source-cut.json`, SHA-256 `b9bd09a6e6c59378939d2b454511da489569bf50a939317dd4dc7399dbe47820`. A new post-adoption cut and release must replace this execution boundary. The old cut must not be presented as the source of a future run.

`argv.json` contains the exact recorder and child argv. The proposed new receipt ID is `c4-final-host-regression-01`, with JSON output at `docs/implementation/v3/m15-artifacts/c4-final-host-regression-01/results.json`. The command retains `--maxWorkers=1`, both default and JSON reporters, and all original per-test deadlines and platform guards. It uses `node node_modules/vitest/vitest.mjs run`, without `pnpm test`, build/generate steps, browser suites, filters, retries or live model workers.

The parent-supplied source cut must pass the existing outside `source-cut-v2.py verify` immediately before and after execution. Any failure must retain its own receipt, log, JSON and exact identity. No source, timeout, skip or fixture mutation is authorized by this plan.

## Selection

The first 20 paths exactly preserve the order and scope of `c4-host-regression-01`. That earlier gate observed 291 passes and two Windows-only skips. Every one of those 20 current test files still matches its earlier reviewed source cut. The test result is historical evidence, not a result for the current journal policy.

Eight files are appended, giving 28 files. Static declarations and retained prior counts indicate 406 cases: 404 eligible on Linux and two existing Windows-only exclusions. These are planning counts, not an executed pass claim.

| Added file | Concrete risk | Boundary |
| --- | --- | --- |
| `tests/journal.test.ts` | Async observation must preserve failed-open retry, shared opening, atomic CAS, committed notifications and durable-generation refusal. | Actual journal with controlled IndexedDB. |
| `tests/source-handoff-v3.test.ts` | Cold recovery, pending reads/CAS, failed source intent, explicit retry, preprocessing, staging/broadcast acquisition, owner transitions and concurrent same-owner guards. | Actual journal, recovery, importer and registry; controlled storage. |
| `tests/editor-handoff.test.ts` | Duplicate registrations and every pending guard must settle before a failure is reported. | Actual registry; scripted guard promises. |
| `tests/draft-transfer.test.ts` | The new source-specific CAS option must preserve legacy skill backup semantics and three-argument non-source CAS calls. | Actual importer/exporter; mocked journal. |
| `tests/compact-draft-transfer.test.ts` | Key-only references, cancellation, signature refusal and non-source text/decision/state/skill import behavior remain compatible. | Actual importer/exporter; mocked journal/signature boundary. |
| `tests/saved-drafts.test.ts` | Source-aware changes must preserve owner-isolated saved libraries, current text, atomic restore/expiry/quota and competing generations. | Actual saved-draft logic; mocked journal. |
| `tests/agents-workspace-composer.test.ts` | Shared recovery, subscription ownership, prepared request identity, ambiguous send retry, Stop ordering and later draft/excerpt generations remain intact. | Actual composer; mocked journal and transport. |
| `tests/agents-workspace-dispatch.test.ts` | Bootstrap/session renewal cannot dispatch from a stale owner or replace pending command identity. | Actual personal composer/API; mocked journal and HTTP. |

The mocked caller suites are not evidence for IndexedDB ordering. The actual-journal suites provide that narrower evidence. The included HTTP host tests replace PTY admission explicitly and do not launch a browser or runtime worker. The selection has no build/generate/browser subprocess and no shared `dist/web` consumer such as the plugin-frame custody suite.

## Deliberate boundaries

The two existing Windows-only cases in `source-workbench-host-v3.test.ts` remain selected as part of that mixed host file. Linux must report them as skipped: retained-file reauthorization and first-file account binding under the native file guard. The Linux unsupported-file case remains eligible. No platform gate is changed.

The active Windows workflow declares 37 native-job test files. All eight added caller files are already in that command. `native-coverage.json` retains the measured workflow hash, exact 37-file list, overlap, and the 16 files omitted from this local selection.

Actual Windows file/runtime evidence remains in `source-workbench-hermes-v3.test.ts`, `memory-native-file-capture-v3.test.ts`, and the platform-gated host cases. The Hermes file includes both the original M15 first-file continuity case and the new M05-memory/M15-file integration case. Other declared native-job files cover runtime/worker checkpoints, extraction, source reuse, startup, packages, desktop host, and unchanged output/performance concerns. Those files are not all Windows-only; their omission here is a scope decision, not a claim that they cannot run elsewhere. The workflow declaration does not establish successful execution.

Seven retained host files are not in the bounded Windows native37 command: context compiler, core project-memory contracts, project-memory HTTP, enrollment recovery, Forget, storage boundary and retrieval. They remain in this local plan. The full unfiltered CI shards are a separate gate.

I read the additional follow-up, settings-operation and terminal-excerpt suites and left them out. Follow-up mocks both journal and HTTP and tests unchanged child-ticket polling. Settings operations owns a separate unchanged queue. The excerpt tests cover pure serialization/bounds rather than the journal mutation functions; the included composer suite already tests excerpt generation retention. Actual App/Settings/DraftTransfer/desktop close behavior remains browser coverage. Document-export handoff is a distinct contract. Plugin-frame custody starts a built/browser path and is unsuitable for this source-only command.

## Review artifacts

`plan.json` binds the exact argv, current hold, predecessor receipt and execution constraints. `source-files.json` records all 28 hashes and whether the review used unchanged predecessor bytes or a full current caller read. `native-coverage.json` compares the local and Windows selections. `self-review.json` records the bounded static checks and omissions. No test collection, test execution, browser, build, repository edit, staging or publication was performed for this plan.
