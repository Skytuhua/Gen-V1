# Original Hermes source integration

The later [0.6.0 completion report](2026-11-01-product-completion.md) records the
reduced payload in a built installer, 1,040 passing checks, packaged native
verification and a genuine packaged OpenAI/Hermes task with restart. Earlier
milestones below retain their original verification scope.

Last updated: 2026-11-01. The original-source integration now uses a reduced, byte-identical upstream subset. Current reduction checks and historical integration/live-model evidence are separated below; each result establishes its stated scope only.

The production host now composes the original Hermes Python agent with the existing application. This replaces the earlier custom TypeScript approximation as the production learning and skill authority. The original conversation loop, `/learn` prompt, review fork, skill schemas, fuzzy patching, batch validation, curator, usage sidecar and filesystem ledger execute from copied upstream source.

## Source custody

Hermes is pinned to [`c627ec84664d43e0b18b95d9d86d8963747d56c7`](https://github.com/NousResearch/hermes-agent/tree/c627ec84664d43e0b18b95d9d86d8963747d56c7), with the [MIT license and copyright notice](../third-party/hermes-agent/LICENSE) retained. The [upstream manifest](../third-party/hermes-agent/UPSTREAM_MANIFEST.json) now records 735 files / 17,356,220 bytes, including 724 Python files / 329,528 Python lines. The previous full-source copy contained 2,832 files / 51,002,995 bytes and 961,672 Python lines. The reduction removes 2,097 files and 632,144 Python lines (65.7%).

Every retained file keeps its original Git blob and SHA-256; the manifest filters the prior inventory without changing retained source bytes or the pin. Standalone CLI/TUI entrypoints, unused tools/plugins, upstream tests and development files are removed. Original agent, skills, review and curator implementations remain with their shared core/helper dependencies. The eleven key learning files listed in the [runtime README](../third-party/hermes-agent/README.md) total 7,493 lines before dependencies; this is not a standalone runtime size or a proven minimum. Host compatibility code lives outside the retained [upstream tree](../third-party/hermes-agent/upstream/).

The earlier [seventeen-file research inventory](../third-party/hermes-agent/SOURCE_MANIFEST.json) remains historical evidence. It is not the runtime inventory.

## Execution and ownership

```text
Chat UI → Service → original Python AIAgent
                         ↓ original ACPClient
                    Node ACP text server
                         ↓ private model broker
                    selected account's native adapter (modelOnly)

Original skill tools → app-owned SKILL.md packages, usage and ledger
                                      ↓
                              SQLite UI projection
```

[Production composition](../apps/server/hermes-service.ts) selects the source runtime. The [Python worker](../packages/runtime-hermes/worker.py) registers Hermes's public provider/ACP extension; it does not replace the source agent or tool algorithms. The [runtime adapter](../packages/runtime-hermes/index.ts), [ACP server](../packages/runtime-hermes/acp-server.ts) and [model broker](../packages/runtime-hermes/broker.ts) bridge the app's existing runtime interface.

The nine connection routes remain `openai`, `openai-codex`, `github-copilot`, `xai`, `kimi-coding`, `opencode-go`, `claude-code`, `gemini-cli` and `cursor-sdk`. Each model completion captures its model, account and owner. Native adapters supply text with their own tools disabled; Hermes executes admitted host capabilities through the existing grants, operation approvals and receipts. Raw model tool-call text remains available to the original ACP parser.

A worker's acknowledgement means it accepted input. The host records model entry only after the native adapter reports actual entry. Foreground reply settlement and the background review's cleanup barrier remain separate. Cancellation and startup admission retain ownership until confirmed teardown; a timeout alone cannot authorize releasing an account or process owner. Unknown usage remains unknown.

The app supplies explicit source configuration: no lazy installation, inline shell/template preprocessing, external skill directories, ambient plugins or original global memory. Plan mode prevents skill writes and automatic review. These are application authority boundaries, not an operating-system sandbox or a claim that every optional Hermes product feature is enabled. The [worker protocol](../third-party/hermes-agent/RUNTIME_PROTOCOL.md) describes the transport and source extension points.

Worker initialization now matches the client's app-owned `APPDATA`/`LOCALAPPDATA` paths and disables Python automatic installation before source bootstrap. The original upstream home guard remains unchanged.

## Skills, compatibility and controls

Original skill files, usage records, pending writes and ledger are canonical. The [library adapter](../packages/runtime-hermes/library.ts) translates existing UI commands once, projects metadata into SQLite, preserves legacy history and retains uncertain write intents. It does not create another learning algorithm or independently writable skill library. Legacy compatibility modules and injected runtime tests remain in the repository.

Migration carries legacy usage counts, patch counts and timestamps through one original usage mutation with an import marker. Refresh never reapplies that snapshot or resets later source activity. Exact source skill names, including dots and underscores, remain readable in the planning path; history queries match the complete skill identity.

The source counts model iterations for its review cadence, including responses without tool calls. The settings label now reflects that behavior. Agent writes use the source approval gate; explicit user saves retain their separate authority. Disabled and protected controls apply to resolved skill identities and source curation eligibility.

The original source permits at most 20 operations in one atomic batch and a 60-character index description. Valid legacy data can exceed those limits. Such records remain readable with their original bodies, supporting files, history and drafts while activation/mutation waits for migration. A conflicting canonical copy is preserved. One pending legacy record does not prevent chat or the host from starting.

## Development and packaging

Use Windows x64 CPython 3.14 alongside Node 24.10+ and pnpm 10.30.3. Install dependencies into the isolated project target:

```powershell
py -3.14 -m pip install --no-cache-dir --no-compile --target .harness-hermes-python-deps -r third-party/hermes-agent/runtime-requirements.txt
```

The [requirements](../third-party/hermes-agent/runtime-requirements.txt) and [resolved inventory](../third-party/hermes-agent/RUNTIME_DEPENDENCIES.json) pin the dependency closure. Startup uses `-I -S -B`, excludes global/user site packages and does not download Python, dependencies, skills or models. Development may select an already installed interpreter with `HARNESS_HERMES_PYTHON`.

[Desktop preflight](../scripts/hermes-assets.ts) verifies the selected interpreter, distribution versions, source hashes and bounded payload before staging. The earlier full-source relocated payload contained 6,226 files / 112,637,301 bytes (107.4 MiB), including Python, isolated dependencies and source. It passed isolated native dependency imports and ran the original AIAgent through ACP with scripted native model responses. The temporary tree was removed after verification. That receipt is historical and does not measure or validate the reduced payload. The CPython/source exclusions do not remove every pinned dependency package asset or test. No new installer was built; packaged Electron execution and signed-in inference from that packaged payload remain unverified. Published installers are unchanged.

## Current verification scope

Workspace receipts are ignored local artifacts. These counts are snapshots of the named checks, not an aggregate quality score or final branch acceptance. The table below preserves pre-reduction integration evidence; those receipts alone do not validate the reduced payload.

Current reduced-source checks passed all 14 Python worker tests (`py -3.14 -I -S -B tests/hermes_source_worker.py -v`), 5 custody/parser tests, 4 atomic-control tests, TypeScript and the widgets/web build. Execution exercised original skill creation, a curator read then patch across three scripted model requests, and automatic review after ten model iterations. The complete application regression passed 982/982 tests across 110 files (`.harness-hermes-pruned-full-unit.json`), including original-source/default-host integrations. These establish their stated behavior; they do not measure autonomous learning quality.

The reduced relocated payload passed with 4,129 files / 78,512,756 bytes (74.9 MiB), including Python and isolated dependencies (`.harness-hermes-relocated-pruned.json`). It verified native dependency imports and executed the original AIAgent through ACP/scripted native transport with the exact expected reply. The temporary payload was removed. This does not establish a full Electron installer or signed-in inference from that package.

A fresh signed-in `/learn` check also passed on the reduced source with `openai/gpt-6.1-sol` (`.harness-hermes-live-learning-pruned.json`). Actual model entry produced an original pending approval; original approval replay saved the canonical skill with `created_by=learn`. The disposable library was removed and cleanup confirmed. This is one live learning trial, not a benchmark of autonomous learning quality.

| Check | Recorded result | Scope |
| --- | --- | --- |
| Original source and default host integrations | 2/2 passed; `.harness-hermes-host-final.json` | Real Service/Python/AIAgent/ACP/broker with scripted native responses, including the granted `text_import` host boundary; actual local host/session authentication, source CRUD, supporting files, explicit UI saves with approval enabled, rollback, archive/restore, restart and readable pending legacy migration. |
| Authenticated source text | Passed; `.harness-hermes-live-source.json` | Selected `openai/gpt-6.1-sol`, actual native input entry, original source startup, exact expected response and confirmed cleanup. This is one live text trial. |
| Authenticated explicit `/learn` | Passed; `.harness-hermes-live-learning.json` | Actual selected model tool calls produced a persisted original approval; original approval replay created the canonical skill with `created_by=learn`. Cleanup was confirmed and the disposable library removed. Autonomous review quality remains a separate gate. |
| Authenticated fresh-session reuse | Passed; `.harness-hermes-live-reuse.json` | Restored that approved model-authored document into a fresh disposable source library. The selected model in a new original session called original `skill_view`; its source use count became 1. Cleanup and library removal were confirmed. This is one reuse trial, not a measured task-quality improvement. |
| Original source and model-format checks | Prior 13 worker checks, subsequent 4/4 atomic-control checks and 5/5 custody/parser checks passed; model-format receipt 18/18 | Focused source behavior and transport-format regression scopes, not the full upstream test suite or an additive branch total. `.harness-hermes-model-format.json` records the 18 focused checks. |
| Desktop asset tests | 18/18 passed; `.harness-hermes-desktop-final.json` | Fixture selection, custody and packaging gates. No full installer build. |
| Historical full-source relocated Python/dependency/source payload | Passed; `.harness-hermes-relocated-source.json` | All 6,226 files before source reduction, isolated native imports and original AIAgent execution through ACP/scripted native transport. The temporary tree was removed. This does not validate the reduced payload or establish packaged Electron or all-provider signed-in inference. |
| Functional browser controls | 9/9 passed; `.harness-hermes-ui-accepted.json` | Review settings, pending migration, editing, supporting files, drafts/conflicts, approval/rejection, history, archive/restore and cleanup controls using browser protocol fixtures. Tracing was off; the screenshot/layout case was excluded. |
| Historical TypeScript and builds | Passed | Before source reduction: `pnpm typecheck`, `pnpm build` (widgets/web) and `pnpm desktop:build` (shell). This is not an installer build. |
| Historical complete source-integration regression | 982/982 passed across 110 files; `.harness-hermes-full-unit-accepted.json` | Before source reduction, including actual source/default-host integrations, account/lifecycle/model-only boundaries, migration, storage and desktop readiness. No skipped tests. The sidecar fixture uses the existing production 25-second readiness deadline. |

Before reduction, independent reviews covered source execution, native transport, cleanup/account ownership, packaging and the final migration/read fixes. Confirmed blockers were fixed; the final narrow review reported no remaining findings. Review is scoped evidence, not a guarantee of defect-free software.

The first live learning attempt timed out after malformed JSON in the model's XML tool-call output. Transport guidance was refined to require object-form `function.arguments` and commentary outside the tool-call block; the original parser source remains unchanged. The subsequent live `/learn` trial and focused parser/format checks passed. This records the observed failure and recovery, not a general model-reliability guarantee.

Completed native helper results remain visible: T3 `task_status` returned `task_not_found`, without the child-thread metadata required for recoverable archiving. No helper thread was archived or deleted.

The earlier [864-unit/548-browser report](2026-11-01-hermes-learning-verification.md) describes the superseded TypeScript implementation. Its package/native evidence does not establish acceptance of this Python source replacement. Source hashes, mocked routing and scripted model replies do not establish autonomous learning quality, reduced future mistakes or equal quality with all open-source harnesses.

## Comparison and remaining product gates

The [pinned comparison](2026-11-01-harness-learning-comparison.md) remains the primary-source research record. It inspected selected architectures and tests; it did not run competing applications or rank their performance.

| Source | Practical consequence for this integration |
| --- | --- |
| [Hermes](https://github.com/NousResearch/hermes-agent/tree/c627ec84664d43e0b18b95d9d86d8963747d56c7) | Execute the original engine and skill lifecycle; keep host transport and app permissions outside the copied tree. |
| [Codex](https://github.com/openai/codex/tree/67f0994b532b8740f14b5b738af7b7b2a915b1d6) | Retain bounded discovery, explicit body reads and durable receipts; no additional Rust memory-job/consolidation service was imported. |
| [OpenCode](https://github.com/anomalyco/opencode/tree/5e066ac922ba016dd4a225cd5dea16af829c5b8f) | Keep catalog refresh and permission ownership explicit; no parallel framework was added for those rules. |
| [Pi](https://github.com/earendil-works/pi/tree/b556cfe5b0300a91f39c7bc5369a65a25fb7fcd5) | Reuse existing account-aware adapters and durable native history boundaries while preventing ambient SDK tool execution in the model transport. |
| [Goose](https://github.com/aaif-goose/goose/tree/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc) | Keep skill access under live session/permission ownership and verify discover/load/reuse as an integration flow. |
| [Aider](https://github.com/Aider-AI/aider/tree/5dc9490bb35f9729ef2c95d00a19ccd30c26339c) | Preserve bounded context selection; no separate whole-repository index was introduced for procedural skills. |

Remaining acceptance work includes measured autonomous review quality, repeated cross-task learning outcomes and packaged Electron/all-provider model verification. Live text, explicit `/learn` and one fresh-session reuse are established for the selected OpenAI model above. Full T3 managed-account parity, physical multi-monitor transitions and generated-code enablement keep their separate gates. [Composer predictions](superpowers/specs/2026-11-01-composer-predictions-design.md) remain a design/preview; the production suggestion service and Tab-to-accept integration are not implemented.
