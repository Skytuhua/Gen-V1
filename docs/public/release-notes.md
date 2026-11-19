# Preview release notes

Gen is a Windows x64 preview. Source features, published downloads and acceptance results have different scopes.

[Get started](getting-started.md) · [Feature tour](features.md) · [Changelog](../../CHANGELOG.md)

## What you can download

The [v0.6.1 prerelease](https://github.com/skytuhua-org/Gen-V1/releases/tag/v0.6.1) is the current published preview. It includes an unsigned Windows x64 installer and a SHA-256 checksum file. It is not a stable release.

The 0.6.4 and 0.6.5 source previews are not published stable installers. Use the source setup instructions to try changes made after the v0.6.1 prerelease. Release availability can change; check the [release list](https://github.com/skytuhua-org/Gen-V1/releases) before choosing an installer.

## Unreleased 0.6.5 source

For the latest source changes, see the [unreleased changelog](../../CHANGELOG.md#unreleased--065-visual-workspace-preview) and [visual workspace guide](../visual-workspace.md).

Current source adds durable split layouts and named layouts, Inbox attention and optional plug-in workspaces. Workspace and All Agents remain the built-in choices; Code Review, Research and Custom are retired choices with saved records retained for recovery. Settings has 12 active sections; the older 21-section inventory is not the current navigation.

Generated apps are **preview**, with `GENERATED_APPS_ENABLED = true` gating discovery, creation and artifact mounting. The preview label is the PM default pending owner confirmation. The 0.6.0 changelog records the earlier actual-host checks, not acceptance of every later source revision or the broader quality pilot. Source availability is not installed-Windows upgrade acceptance.

### Merged source work since 2026-11-17

Local git history records the following foundations; merging does not establish acceptance or enable a feature. All additive v6 features remain **off** by default in `packages/core/capability-flags.ts` or `packages/core/host-flags.ts`. See the [Built / Verified / Turned on matrix](../progress.md#m01m17-implementation-acceptance-and-activation) for acceptance receipts and holds.

- **Context inspector / Next inference budget:** the M04 integration (`4aef753e`, 2026-11-18; includes #617, `ecd278c0`) adds request/source/compaction views and a budget display in `apps/web/src/ContextInspector.tsx`. The existing context popover can render, but v6 request and budget observations are **off**, gated by `context.compilerV1` (`packages/core/service.ts`); deferred tools, loss-aware compaction and precompute also default off. The display does not prove live model acceptance.
- **Session history — Inspect point / Fork / Import ArchiveV1:** #343 (`75196a24`, 2026-11-18) adds `apps/web/src/SessionBranchMenu.tsx`, `packages/core/session-branches.ts` and `packages/core/history-import.ts`. New inspect captures and inert ArchiveV1 imports are **off** behind `sessions.branchV1` / `sessions.inertImportV1`. Existing captured/imported history can still be read. Native Fork is **unavailable**: every listed adapter reports UNSUPPORTED; arbitrary external archive formats are not supported.
- **Source workbench:** #820 (`60aeaf31`, 2026-11-18) adds source-bound Windows custody evidence and plug-in-workspace placement fixes to the existing source workbench (`apps/web/src/SourceWorkbench.tsx`, `packages/core/source-workbench.ts`). `ui.sourceWorkbenchV1` remains **off**. The [installed evidence](../implementation/v6/M15/handoff-postmerge.md) proves named cases at its recorded older cut, not current installed-Windows/provider acceptance; real provider dispatch was NOT_RUN.
- **Control consent UI:** #559 (`bdcd12bb`, 2026-11-17; subsequent `0db317d5`) adds contracts, deny tests and the disabled UI in `apps/web/src/ControlConsentPanel.tsx`. `control.consentedBrowserV1` and `control.selectedDesktopV1` are **off**. There is no approved live driver, so browser/desktop control is **not available** (`HOLD_DRIVER_SPECIFICATION`, `HOLD_PLATFORM_PROOF` in the [M16 evidence](../implementation/v6/M16/handoff.md)).
- **Isolated extension lane:** #838 (`6185a1fa`) and its flag-off guard follow-up #900 (`a2c278ce`), both 2026-11-19, add `packages/plugins/isolated-host.ts` and fail-closed catalog/migration handling. `plugins.isolatedV1` is **off**; without an installed approved backend/platform proof, isolated activation is **not available**. Existing trusted V1 plug-ins are a separate lane, not proof of isolated-extension support ([M13 holds](../implementation/v6/M13/handoff.md)).

Paired clients / remote read synchronization (M17, #836) are **not available**. `remote.readSyncV1` and `remote.submitInputV1` remain false; owned-test TLS does not authorize a production remote endpoint or remote input ([M17 evidence](../implementation/v6/M17/handoff.md)). No L-series automatic skill drafting/updates, work orders, model qualification or demonstration capture is claimed as shipped.

### Provider acceptance

These labels describe repository evidence, not the current user's sign-in or a guarantee for every later revision. `packages/contracts/connections.ts` lists nine implemented connection routes plus two unavailable/pending entries. Only the owned OpenAI subscription has genuine inference evidence in [the 2026-11-01 acceptance report](../2026-11-01-product-completion.md#remaining-acceptance); an implemented adapter or a configured credential is not live-provider verification.

| Provider / connection ID | Acceptance label | Evidence / boundary |
| --- | --- | --- |
| OpenAI — `openai` | **Verified** | Historical owned subscription + Hermes live inference only; [acceptance report](../2026-11-01-product-completion.md#remaining-acceptance). Not current installed-Windows acceptance |
| OpenAI Codex — `openai-codex` | **Preview-unverified** | Report records signed out; independent live sign-in/entitlement/task acceptance open |
| GitHub Copilot — `github-copilot` | **Preview-unverified** | Report records signed out; independent live acceptance open |
| xAI / Grok — `xai` | **Preview-unverified** | Report records signed out; independent live acceptance open |
| Claude Code — `claude-code` | **Preview-unverified** | Report records unavailable runtime; independent live acceptance open |
| Gemini CLI — `gemini-cli` | **Preview-unverified** | Report records unknown state; independent live acceptance open |
| Cursor — `cursor-sdk` | **Preview-unverified** | Report records signed out; independent live acceptance open |
| Kimi Code — `kimi-coding` | **Preview-unverified** | Report records signed out; independent live acceptance open |
| OpenCode Go — `opencode-go` | **Preview-unverified** | Report records signed out; independent live acceptance open |
| Separate OpenCode runtime — `opencode` | **Preview-unverified** | Registry says runtime-pending, not an available runtime |
| Meta / Muse — `meta` | **Preview-unverified** | Registry says unavailable; entitlement/integration unverified |

## 0.6.4 source preview

The 0.6.4 preview kept the original conversation workspace, project/thread navigation, compact composer, neutral dark/light themes and interactive task catalog. Changes include:

- A public plug-in API with independent package versions, compatibility checks, file inventories and durable data outside application updates.
- A main workspace that works without an optional plug-in installed.
- A searchable combined model/reasoning picker, project selection and Build/Plan controls in the composer.
- Compact project context and usage tools with minimize controls; validated plans open automatically.
- Sidebar collapse and narrow-window navigation, with a compact composer.
- Native startup feedback and close/reopen recovery checks for the current candidate.

The [screenshots and videos](media/README.md) show the actual public browser interface from source commit `cb504d0e392fde9e70883b7b7c2e808e13488b7c`, using authored sample data. They do not demonstrate live inference or a packaged installation.

## Verified scope and remaining work

The 0.6.4 source preview passed its Windows CI run. Focused native candidate checks covered workspace cleanup and normal close/reopen recovery. For later revisions, check [GitHub Actions](https://github.com/skytuhua-org/Gen-V1/actions) for the exact commit; source CI does not verify an installed upgrade. Earlier genuine OpenAI/Hermes task verification is documented in [the acceptance report](../2026-11-01-product-completion.md); it does not prove every later build or connection.

The following remain open:

- Installed stable upgrade/updater acceptance on a suitable isolated Windows target.
- Independent live sign-in, model entitlement and task acceptance for providers beyond the evidenced OpenAI route.
- The broader generated-application quality pilot.
- Physical multi-monitor and mixed-DPI acceptance.

A bounded review of 28 captured alerts from the older default branch found none applicable to the evaluated 0.6.4 source. It did not cover newly disclosed advisories outside that set or every opaque bundled binary, and is not a vulnerability-free claim.

In the current source preview, the conversation pane's **Detach conversation** action floats it inside Gen; use **Return to main** or drag it to a split edge. On Windows desktop, the sidebar's **Detach thread** instead opens a pinned native window. See the [visual workspace guide](../visual-workspace.md) for both paths. Neither action enables new native detachment for canvas panels. Native compaction is adapter-dependent: Cursor rejects it; Gemini requires an advertised `/compress` command. The separate OpenCode agent runtime and Meta/Muse access remain unavailable. Historical design and desktop documents retain older proposals and evidence; the current UI and these limits take precedence.

## Data, licensing and attribution

Existing profiles keep the `GenerativeHarness` and `GenerativeHarnessDesktop` namespaces. Close the app before backups and retain saved drafts, receipts and blocked-operation records during troubleshooting. A source build or candidate check does not establish that an installed upgrade preserved a real profile.

First-party source remains proprietary and unlicensed for redistribution under [LICENSE](../../LICENSE). Retained third-party components keep their original terms; see [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). This presentation does not change those terms.
