# Subscription connections

Last updated: 2026-11-01.

## Multiple subscription accounts

The source build supports named accounts per available provider, using T3 Code's separate-provider-instance model. In **Settings → Providers**, add a local label, connect that account explicitly, then choose **Use** for new tasks. Desktop opens the fixed native sign-in console; browser users receive `pnpm agent:login --provider PROVIDER --account-id SAVED_ID`. The command without an account ID still targets the existing legacy profile. Adding or selecting an account does not start sign-in or a task.

Each named account has a private, hashed profile namespace. Existing credentials are not copied or moved. The first accepted message binds a task to its account; changing defaults cannot move an existing chat, history, compaction, side conversation or planning reader to another account. Older tasks keep the existing legacy profile. Account labels and opaque IDs are public local metadata; provider credentials never enter the settings snapshot.

**Remove** disables future selection and preserves profiles and established task bindings. **Restore** makes the saved connection available again. Credential changes are refused while that account still owns native work or teardown. Login ownership is retained while its process remains alive, including a cancellation that has not finished; another account is never substituted.

An abandoned login reservation survives console exit, lease expiry and host restart until confirmed cleanup; a dead console alone cannot prove that its native children stopped. A reported unconfirmed shutdown also prevents ordinary lease cleanup. These cases require investigation and confirmed native shutdown before metadata recovery; retrying or restoring the account does not clear them. Windows account directories retain pinned ordinary `.harness-directory-guard` files while in use, allowing native atomic file updates while keeping their directory namespaces nonempty and protected. These guards apply within the chosen harness data directory and do not turn native runtimes into an OS sandbox.

The account namespace and picker mechanics are copied/adapted from pinned T3 Code commit `8760d063e903406c8e8f695b0852c0a15fc1e00f`. Exact sources, changes and hashes are recorded in the [third-party attribution](../third-party/t3code/README.md), with the complete MIT license retained for distribution. Existing Pi and official runtimes handle authentication; T3's managed ChatGPT broker, arbitrary environment overrides, automatic account rotation and API-key billing fallback are not introduced.

This feature is a source-build change. Previously published installers and account-specific live sign-in/inference acceptance retain their separate verification status.

Current v0.5.1 source implements nine connection IDs through Pi OAuth, dedicated plan keys and official runtimes, including the reviewed Cursor preview connection. The [verified v0.5.1 installer](evidence/runtime-clarity-20261031/report.md) includes all nine and repairs unsupported-compaction presentation and Cursor bootstrap Git context. The preserved [v0.5.0 package](evidence/cursor-subscription-20261031/report.md) also contains nine; v0.4.1 contains the earlier eight. Provider-specific live sign-in/inference acceptance remains separate. Availability in Settings means an integration exists; it does not establish local authentication, account entitlement or successful inference. See the [Cursor contract and verification limits](plans/cursor-subscription-adapter-20261031.md).

| Connection | Current source status | Authentication |
| --- | --- | --- |
| ChatGPT / Codex | Implemented | `openai` Pi subscription OAuth; recommended for new connections |
| ChatGPT / Codex legacy | Implemented | `openai-codex` Pi OAuth, retained for existing sessions |
| GitHub Copilot | Implemented | `github-copilot` Pi device OAuth on GitHub.com; Enterprise domains are not configured |
| xAI / Grok | Implemented | `xai` Pi device OAuth for eligible subscription accounts |
| Kimi Code | Implemented, source verified | `kimi-coding` dedicated literal membership key; personal interactive coding |
| OpenCode Go | Implemented, source verified | `opencode-go` dedicated literal key from a Go workspace |
| Claude | Implemented, source verified | `claude-code` published official Claude Code runtime; direct user sign-in in an isolated app profile |
| Gemini | Implemented, source verified | `gemini-cli` published official Gemini CLI; direct Google-account sign-in in an isolated app profile |
| Cursor | Preview, source reviewed | `cursor-sdk` published official SDK; private official browser sign-in, with a first-party user key billed to the Cursor user's plan |
| OpenCode runtime | Runtime integration pending | The agent application is distinct from its Go subscription |
| Meta / Muse | Unavailable | SDK support exists, but entitlement/integration requirements have not been verified here |

## Sign in

In the current source checkout, use the unified connection console:

```powershell
pnpm agent:login
pnpm agent:login --provider kimi-coding
pnpm agent:login --provider opencode-go
pnpm agent:login --provider claude-code
pnpm agent:login --provider gemini-cli
pnpm agent:login --provider cursor-sdk
```

`--provider` defaults to `openai`; the other Pi OAuth IDs in the table are also accepted. `--data-dir PATH` must select the host's storage directory. `--no-open` suppresses opening Pi OAuth links; official-runtime connections reject it because they own their native sign-in flow. The current native source launches this same fixed [runtime-login entry point](../packages/runtime-login/index.ts) with an allowlisted provider ID. Secrets are entered in the connection console, never as command arguments or ordinary renderer commands.

Pi OAuth uses validated provider browser/device flows. Dedicated plan setup asks for explicit connection-kind confirmation, then reads a hidden literal key. Pi credentials remain under `dataDir/pi/auth.json`. Plan keys must contain 1–4096 visible ASCII characters, with no whitespace, leading `!` or `$` environment syntax. Unmarked legacy keys are not silently admitted as plan credentials.

Claude and Gemini sign in directly through their unmodified published runtimes in `dataDir/official/<provider>/home`. The harness does not copy Pi OAuth credentials into those homes or reuse the user's existing CLI profile. The native Claude binary retains its built-in authentication methods; before sending task input, the harness connection accepts only supported first-party subscription metadata and rejects API-key, third-party or unknown contexts. Gemini selects its advertised Google-account authentication method. After sign-in, refresh models in Settings and choose an available model explicitly.

The Pi OAuth helper admits only the configured HTTPS authorization/device-verification paths. GitHub Enterprise host overrides, unexpected URLs and malformed device codes fail closed. The official environment omits inherited provider credentials and custom endpoints. Task grants and the native file guard deny access to harness-owned `official`, `pi` and `artifacts` storage. These are resource boundaries, not an OS sandbox.

## Credentials, endpoints and billing

The app-owned [literal credential store](../packages/runtime-pi/credentials.ts) reads credential data without Pi `!command` execution or environment expansion. Writes and OAuth refresh retain the pinned SDK's native file locks. Only the four admitted OAuth credential kinds and explicitly marked plan credentials are exposed to their matching providers; ambient keys, custom endpoints and unmarked legacy keys cannot provide app-side billing fallback. A failed Kimi validation does not suppress models from another healthy configured provider.

The [plan connector](../packages/runtime-pi/plan-keys.ts) pins inference requests and rejects redirects:

| Connection | Admitted inference base | Selection boundary |
| --- | --- | --- |
| Kimi Code | `https://api.kimi.com/coding/v1` | OpenAI Chat Completions only. Authenticated `/models` discovery has a ten-second deadline, 256 KiB body limit and bounded IDs; results must intersect the installed catalog. No Moonshot endpoint is substituted. |
| OpenCode Go | `https://opencode.ai/inference/go/openai/v1` or `https://opencode.ai/inference/go/anthropic` | OpenAI Chat Completions/Responses and Anthropic Messages only. A stable conversation ID is required. The Google SDK transport is excluded because the adapter cannot enforce its redirect policy. No Zen/pay-as-you-go endpoint is substituted. |

The saved connection-kind marker records the user's chosen setup; it is not proof of subscription entitlement. Go's installed model catalog is not an account-specific entitlement check. Requests can still fail for account policy, quota or model access. Kimi setup is offered for personal interactive coding; scheduled/batch, resale and generic noncoding use are unsupported by this connection.

**No app-side fallback is not a zero-charge guarantee.** Fixed Go endpoints can still use a Console balance when provider-side Extra Usage is enabled, including after included usage is exhausted. The harness does not change that setting. Other providers can also control overages or credits in their accounts. Unknown cost/quota telemetry remains unavailable. [OpenCode Go's usage policy](https://opencode.ai/v2/docs/console/go/#usage-beyond-limits) describes that provider-side behavior.

## Official runtime behavior

The pinned dependencies are Claude Agent SDK **0.3.316**, its published native Claude Code **2.1.316**, Gemini CLI **0.66.0**, Cursor SDK **1.0.38** and MCP SDK **1.32.2**. The composite [createRuntime](../packages/runtime/index.ts) routes both primary work and read-only planning readers to Pi or the selected official runtime. Existing host approval, cancellation and durable input ownership remain authoritative. Official built-in task execution is not granted: the connection exposes the current run's authenticated host MCP tools.

- **Claude:** Account metadata is checked before task input. Models and supported effort levels come from the native runtime; effort changes use the SDK flag API, and an explicit default preserves native default semantics. Compaction requires an advertised `/compact`, a native compaction boundary and a successful terminal result. No live subscription session has been accepted for this milestone. Anthropic's [published-binary conditions](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products) remain applicable.
- **Gemini:** New sessions negotiate the pinned ACP v1 protocol and current model advertisement. Continued sessions use native `--resume` with `--output-format stream-json`, preceded by fresh ACP model validation. Native history must match the task's canonical project, exact session identity and leading input-envelope markers. A headless user echo alone is not a delivery receipt; current-turn work/terminal evidence or matching native history establishes consumption. Success waits for stdout/process close so trailing output is drained.
- **Gemini compaction is unavailable:** the pinned actual ACP implementation does not advertise `/compress`, and native headless continuation has no verifiable compression result. The positive capability-gating test uses a synthetic future advertisement; it does not prove native support.
- **Cursor preview:** Only its private official browser-login store establishes authentication provenance. New and resumed agents use MCP-only tools, no native subagents, no project/user settings and a task-owned JSONL store. Native user-entry evidence and durable host acknowledgment gate concurrent MCP tool execution. Discovery hides unsupported parameter/max-only selections; startup and every send revalidate authentication and the current account catalog. Paid tier, cost/allowance and native compaction are unavailable. Actual SDK metadata-only create/resume and disk history are tested; full local-executor/account inference remains unverified.

Model discovery is cached, concurrent requests share the lookup, and explicit refresh reopens discovery. Task startup still validates the selected native model and authentication context. Per-connection configuration files avoid concurrent discovery overwrites. Failed streams, cancellation and disposal close the run's MCP endpoint, native children and owned resources. These source/protocol checks do not establish live account acceptance.

## Sources and verification scope

The retained [full unit receipt](../.harness-providers-unit.json) records **532/532 passed**, `success:true`. The [published-distribution receipt](../.harness-official-distributions/run-1793445647702/verification.json) records two actual `--version` passes in isolated empty homes: Claude Code 2.1.316 and Gemini CLI 0.66.0. Those invocations performed no authentication or inference. Focused adapter tests use synthetic protocols and credentials. The [milestone](provider-expansion-milestone.md) separates these checks from pending live account and fresh-package acceptance.

- [Pinned Pi OpenAI provider](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/openai.ts)
- [Pinned legacy Codex provider](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/openai-codex.ts)
- [Pinned GitHub Copilot provider](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/github-copilot.ts)
- [Pinned xAI provider](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/providers/xai.ts)
- [Pinned xAI device-flow tests](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/test/xai-oauth.test.ts)
- [Claude published runtime and authentication conditions](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products)
- [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/)
- [Kimi Code membership overview](https://www.kimi.com/en/help/kimi-code/membership-guide)
- [Kimi Code model endpoints and entitlement limits](https://www.kimi.com/en/help/kimi-code/models)
- [OpenCode Go, Extra Usage and model inventory](https://opencode.ai/v2/docs/console/go/)
- [OpenCode coding-harness endpoints](https://opencode.ai/v2/docs/console/harnesses)
- [GitHub budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets)
