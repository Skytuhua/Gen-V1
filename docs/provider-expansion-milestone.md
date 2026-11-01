# Provider-expansion milestone

Current Windows delivery: [v0.5.1 installer and verification](evidence/runtime-clarity-20261031/report.md). Earlier versioned evidence below retains its original scope.

Last updated: 2026-10-31.

At this historical v0.4 checkpoint, source and the [verified v0.4 Windows installer](evidence/provider-package-20261031/report.md) implement eight connection IDs: four Pi OAuth connections, two dedicated plan-key connections and two published official runtimes. Actual setup, complete payload/provider custody, eight controls, two clean installed launches with draft recovery and owned uninstall pass. This does not establish every account's sign-in, entitlement or inference. The historical v0.3 executable contains the earlier four-provider inventory; its [delivery report](evidence/t3-centered-workspace-20261031/report.md), hashes and media retain their original scope.

The final instrumented hidden-parent serial run passed **532/532**, exit 0, in 189.21 seconds; its [observed receipt](../.harness-native-auth-diagnostic/README.md) preserves the printed summary and fixture timing, not raw Vitest JSON. An earlier [serial attempt](../.harness-providers-serial-unit.json) passed 529/532 and a [parallel attempt](../.harness-providers-shipping-unit.json) passed 521/532. A historical console fixture eventually started after 26.34 seconds; that delay remains unexplained. All nine launcher cases passed alone, in their preceding native cohort, and in the final full hidden-parent run. No production launcher change, timeout increase, skip or test delay was introduced.

## Connections and execution routes

| Connection IDs | Current source route | Authentication and limits |
| --- | --- | --- |
| openai, openai-codex, github-copilot, xai | Pi 1.4.0 | Stored subscription OAuth; no ambient/generic API-key fallback. |
| kimi-coding | Pi with a dedicated plan connector | Explicitly marked literal membership key, personal interactive coding, fixed coding endpoint and bounded authenticated model validation. |
| opencode-go | Pi with a dedicated plan connector | Explicitly marked literal Go workspace key, fixed Go endpoints and stable session identity. Installed model definitions do not prove account entitlement. |
| claude-code | Published Claude Code 2.1.316 through pinned Claude Agent SDK 0.3.316 | Direct native sign-in in an isolated app home; subscription metadata checked before task input. |
| gemini-cli | Published Gemini CLI 0.66.0 | Direct Google-account sign-in in an isolated app home; ACP v1 startup/model preflight and native headless continuation. Compaction is unavailable. |

The [connection inventory and login guide](subscription-connections.md) records all IDs, current primary provider sources and exact endpoint constraints. The broader OpenCode agent runtime remains pending; Meta/Muse remains unavailable. Eight implemented IDs are not eight live-accepted accounts or a claim of every subscription service.

## Architecture and boundaries

| Source entry point | Responsibility |
| --- | --- |
| [Composite runtime](../packages/runtime/index.ts) | Routes primary work and read-only planning readers; retains runtime/session ownership and thread/run/epoch authority. The [host](../apps/server/host.ts) and [planning coordinator](../packages/core/planning.ts) use this factory. |
| [Unified login](../packages/runtime-login/index.ts) | Dispatches allowlisted connection setup. Secrets stay in the native connection console rather than executable arguments or ordinary renderer commands. |
| [Literal Pi credential store](../packages/runtime-pi/credentials.ts) | Parses credential data without SDK !command execution or environment expansion; retains native SDK locking for writes and OAuth refresh. |
| [Plan-key connector](../packages/runtime-pi/plan-keys.ts) | Admits explicitly marked keys, pins endpoints and request identity, rejects redirects and isolates provider failures. |
| [Official adapter](../packages/runtime-official/index.ts) and [host MCP](../packages/runtime-official/mcp.ts) | Give each run an authenticated loopback tool endpoint with parent callbacks and cancellation, not independent native task-execution authority. MCP SDK is pinned to 1.32.2. |
| [Official environment](../packages/runtime-official/environment.ts) | Resolves the installed published distributions and isolates dataDir/official/<provider>/home; does not reuse Pi OAuth, the user's normal CLI home, inherited provider keys or custom endpoints. |
| [Claude driver](../packages/runtime-official/claude.ts) | Checks subscription account metadata, advertised models and effort, native session identity and confirmed compaction boundaries. |
| [Gemini ACP startup](../packages/runtime-official/gemini.ts), [headless continuation](../packages/runtime-official/gemini-headless.ts) and [native history](../packages/runtime-official/gemini-native-history.ts) | Validate current models, canonical task/project/session identity and durable input markers while avoiding prior-output replay. |

The official binaries retain their native authentication methods. The harness subscription connection checks the resulting context before task input; it does not alter the Claude binary to remove an authentication method. Task-grant checks and the native guarded I/O path deny harness-owned official, pi and artifacts storage. These resource boundaries are not an OS sandbox.

Official model discovery is cached and concurrent requests share a lookup; explicit refresh reopens it. Startup still validates the selected native model and authentication context. Each connection uses unique owned settings/prompt paths. Stream failure, cancellation and disposal close owned MCP connections, native processes and pending resources. A failing Kimi validation does not hide a healthy configured provider's models.

Claude effort uses the SDK flag API, with explicit null retaining native default semantics. Its compaction path requires both advertisement and an actual compact boundary plus successful terminal result; live compaction has not been verified here.

Gemini starts new sessions using the pinned ACP v1 advertisement. Continued sessions first validate fresh advertised models, then run native --resume with --output-format stream-json. Canonical projects.json mapping, .project_root, project hash, exact native session ID and leading application markers bind history to the task. A headless user echo alone is not a consumed-input receipt. Current-turn work/terminal evidence or matching native history is required; process close drains stdout before success is finalized.

**Gemini compaction remains unavailable.** The actual pinned ACP runtime does not advertise /compress, and the native headless path has no verifiable compression result. A positive gating regression uses a synthetic future capability; it is not proof of support in Gemini CLI 0.66.0.

## Billing and model-access limits

Literal plan keys require an explicit connection-kind marker; a marker records the chosen setup, not entitlement. Environment keys, unmarked legacy credentials, custom endpoints and generic PAYG fallback are rejected. Kimi uses https://api.kimi.com/coding/v1 and intersects its authenticated bounded model response with installed definitions. Go uses fixed /inference/go OpenAI Chat Completions/Responses or Anthropic Messages endpoints. The Go Google SDK transport is excluded because its redirect policy cannot be enforced by this adapter.

These controls prevent application-side endpoint/billing fallback. They do not prevent a provider from charging an enabled Extra Usage balance at a fixed plan endpoint. OpenCode explicitly documents that [Extra Usage can consume the Console balance](https://opencode.ai/v2/docs/console/go/#usage-beyond-limits). An installed Go model catalog is not an account-specific entitlement check. Kimi setup is offered for personal interactive coding, not scheduled/batch or resale use. Live account policy, quota and inference acceptance remain unverified.

## Confirmed evidence

| Evidence | Result | Exact scope |
| --- | --- | --- |
| [Retained full unit run](../.harness-providers-unit.json) | 532/532 passed, zero failed/pending, success:true | Source/contracts and synthetic provider protocols. Does not establish account authentication or inference. |
| [Post-cleanup full diagnostic run](../.harness-native-auth-diagnostic/observed-wrapper-summary.json) | 532/532 passed, exit 0; nine launcher cases passed | Actual printed wrapper summary from the hidden-parent serial run. Raw Vitest JSON was discarded by that completed wrapper and has not been reconstructed. Earlier failures remain retained above. |
| Context/connections browser command, with [last-run status](../.harness-provider-browser/.last-run.json) | Five passed in 11.1 seconds, reported in the command console; last-run status passed with no failed IDs | Current browser source checks. The last-run file does not contain a five-test count and is not presented as a complete JSON runner report. |
| [Published-distribution version receipt](../.harness-official-distributions/run-1793445647702/verification.json) | Two passed: Claude Code 2.1.316 and Gemini CLI 0.66.0 | Actual published CLI --version execution in isolated empty homes; auth:false and inference:false. |
| [Real host/official SDK preflight](../.harness-provider-smoke/run-1793447063368/verification.json) | Passed; authRequired:true, zero models, threads, messages and operations; owned host closed | Actual isolated empty-profile host and published runtime auth preflight. No task prompt, sign-in or inference. |
| [Physical-display receipt](evidence/t3-centered-workspace-20261031/physical-displays/run-2026-10-31T11-34-48-103Z/verification.json) | 15 passed checks on one actual display at 150% scale; multi-display item unverified | Existing v0.3 package's display behavior only. Current source authentication/runtime changes are explicitly outside that package receipt. |

The browser command was `pnpm exec playwright test --config tests/e2e/context-connections.playwright.config.ts --reporter=line --output .harness-provider-browser`. TypeScript and frontend build checks passed in the source-validation session. The production audit reported zero advisories across 328 dependencies. The independent final provider-expansion review reported scoped APPROVE across 131/131 focused checks with no findings. These session-reported outcomes are distinct from the linked machine receipts; they do not create live account or fresh-package acceptance. Counts from different runs are not additive.

The exact ApiExplorer, Pipeline, ReviewQueue and EditableTable discovery regressions also verify that details:true returns the matching dataSchemas, while the concise index omits them. The [integration contract](integration-contract.md) documents this correction and the composite runtime API.

An actual SDK startup warning identified redundant bare `allowedTools` entries that shadowed `canUseTool`. Those entries were removed; built-ins remain disabled and the exact-name current-run checks in `canUseTool`, `PreToolUse` and the authenticated MCP broker remain. The regression was observed failing before the cleanup; 22 targeted Claude/Service/router checks passed afterward, final TypeScript passed, and a separate independent review gave qualified GO for this cleanup and the physical-display verifier.

## Remaining gates

- The [v0.4 installer](evidence/provider-package-20261031/report.md) closes the packaging gate; its separate portable candidate failed startup and is not accepted. The existing v0.3 binary, recordings and display receipt retain their earlier scope.
- Complete provider-specific sign-in, model entitlement and real inference checks in the native v0.4 application, including resume/history and cancellation under live service behavior. Those new native account paths were not used for live inference in this milestone; the existing-host Pi check below is separate.
- Fresh GPT-6.1 Sol generation on the existing authenticated host created and updated the same artifact, with reload-safe local state. It selected Disclosure/Markdown rather than a richer task object, so creative interaction acceptance remains open. This is separate from native v0.4 account acceptance.
- Keep Gemini compaction unavailable unless a supported pinned native implementation actually advertises and confirms the operation. Synthetic capability tests do not close this gate.
- Exercise multiple physical displays, negative-coordinate transitions, mixed-DPI transitions and hotplug. One actual 150% display does not establish physical multi-monitor acceptance.
- Implement and review the separate OpenCode runtime and any future Meta/Muse connection before advertising them as available.
- Keep generated-code applications disabled and the full 36-run pilot deferred. Existing host approval, source evidence and durable action boundaries still apply to every runtime.
