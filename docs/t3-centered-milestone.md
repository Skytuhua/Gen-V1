# T3-centered workspace milestone

Current Windows delivery: **[v0.5.2 installer and verification](evidence/snapshot-performance-20261031/release.md)**. Two frontend work reductions pass source, production-host, custody and unpacked native checks. Clean installation remains unverified because the safety preflight preserved an existing installation. The [v0.5.1 release](evidence/runtime-clarity-20261031/report.md) retains its separate clean-install/restart/uninstall proof; earlier versioned evidence retains its original scope.

Last updated: 2026-10-31.

This record tracks the requested centered T3 shell, detachable multi-monitor workspace, varied task interfaces, lower context overhead, durable memory and broad subscription support. Current source and the v0.5.2 package include **nine connection IDs across eight brands**, including the Cursor preview. Version v0.5.2 preserves that interface and reduces unnecessary input/cell work; it adds no capabilities. The earlier v0.5.1 runtime/settings, focus and Git-boundary repairs remain. Its guarded Cursor pre-authentication `Agent.send`/parser compatibility proof does not establish a successful authenticated turn. Live provider acceptance, successful continuation of the latest genuine UI task, physical multi-monitor coverage and user visual assessment remain unfinished. Other subscription sign-ins are deferred. The Windows preview remains unsigned.

## Current behavior

| Area | Implemented source behavior | Evidence boundary |
| --- | --- | --- |
| Centered shell | Conversation and composer use the available workspace. The right workspace panel is closed by default. A validated plan opens automatically without taking composer focus, fits its content and reopens from Thread options → Show plan. Usage opens from its launcher; closed tools reserve no rail width. Narrow windows allocate a bounded tool area only while open. | Earlier browser checks cover the prior shell. Current Plan behavior has a separate verification gate; the private review contains synthetic fixture captures and user visual acceptance remains separate. |
| Detached windows | New windows open on the source display; saved surfaces restore display and bounds. Native menus and Ctrl+Alt+Left/Right move windows between displays. DIP coordinates support monitors left of or above the primary display. Disconnect rescue preserves preferred placement for reconnect restoration. | The v0.5.1 unpacked application passed 14 native window/browser/recovery checks. A separate [actual-display run](native-multi-monitor.md) passed 15 checks on v0.5.1 using one display. Multiple physical displays, mixed-DPI transitions and hotplug remain unverified. |
| Varied working objects | WorkflowBoard, ArchitectureCanvas and TraceWaterfall bring the trusted catalog to 48 components. They preserve source revisions and durable local interaction. Board moves submit proposals; node/span actions ask questions. | Fixtures cover the supplied contracts. In the [genuine current-catalog Pi run](evidence/current-pi-working-object-20261031/report.md), the agent independently chose TraceWaterfall and Comparison without UI instructions. Local selection survived reload; continuation was quota-blocked. External execution and successful semantic-action continuation are not inferred. |
| Frontend loading | Software-development, image comparison, everyday, interaction, exploration and work-object families load lazily. PDF/signature components also load on demand. | The [v0.5.1 entry measurement](evidence/runtime-clarity-20261031/measurement/efficiency.json) records 794,212 raw / 245,877 gzip bytes, 145 raw / 187 gzip bytes more than v0.5.0 and 7.44% raw / 6.03% gzip less than v0.2. Cursor's SDK stays in the backend. Asset bytes do not prove an end-to-end speedup. |
| Context overhead | Model discovery caches/coalesces and supports explicit refresh, while task sends retain authoritative validation. UI discovery starts with a compact index and pages requested schemas. Inspection projects metadata before exact objects or revision-pinned source pages. Bounded ui_present patches remain available. | The [same-query discovery comparison](evidence/ui-working-object-package-20261031/discovery-measurement.json) records Comparison responses decreasing from 14,377 to 3,163 bytes and TraceWaterfall from 6,176 to 3,281. These are response bytes, not billed-token savings or a hard memory quota. |
| Thread continuity | User-visible notes persist across sessions and compaction: at most 12 notes, 768 UTF-8 bytes each and 4 KiB total. Revision checks and delete tombstones reject stale editors. | [Six recovery checks](evidence/current-goal-audit-20261031/memory/verification.json) cover Service/SQLite reopening, installed Pi disk-session restoration and prevention of repeated approved effects. Notes remain untrusted reminders, not authority or proof of model memory quality. |
| Subscription inventory | Current source and the verified v0.5.1 installer admit nine IDs: four Pi OAuth paths, dedicated Kimi Code/OpenCode Go plan keys, and published official Claude Code/Gemini CLI/Cursor SDK runtimes. Legacy Codex shares the ChatGPT brand, giving eight brands. | The v0.5.1 installed distribution/startup checks pass. Cursor preview checks cover empty-store import, metadata-only create/resume and guarded pre-authentication compatibility evidence. These do not prove a successful native account turn. OpenCode's separate agent runtime remains pending and Meta/Muse unavailable. |

## Contracts and entry points

The [public integration contract](integration-contract.md) documents progressive ui_discover pages, metadata-first ui_inspect, explicit dataId/revision/JSON Pointer source paging, ui_present patches and task_memory. The relevant source entry points are:

- [Shell layout defaults](../apps/web/src/shell-layout.ts), [on-demand task-tool layout](../apps/web/src/FloatingRail.tsx) and [live Usage](../apps/web/src/UsageFooter.tsx).
- [Native display geometry](../apps/desktop/display-layout.ts) and [multi-monitor behavior](native-multi-monitor.md).
- [Trusted work-object schemas](../packages/ui-catalog/work-objects.ts) and [lazy renderer registry](../apps/web/src/registry.tsx).
- [Progressive discovery](../packages/core/discovery.ts), [bounded task/source inspection](../packages/core/task-inspection.ts) and [Pi tool schemas](../packages/runtime-pi/tool-definitions.ts).
- [Thread note limits and revisions](../packages/core/task-memory.ts) and [user note controls](../apps/web/src/TaskMemory.tsx), available under workspace **Usage → Thread memory**.
- [Public connection manifest](../packages/contracts/connections.ts) and [provider-specific connection status](subscription-connections.md).

Default ui_inspect returns metadata and counts rather than full specs, tables or raw execution output. Explicit artifact/request/operation detail retains the complete contract needed for safe updates. Source pages retain their data revision and return nextOffset or a narrower-pointer hint when necessary. The stored source remains intact. Saved notes hold short decisions, constraints and unfinished work; artifacts and operation receipts hold authoritative state and execution evidence.

## Confirmed verification

The [verified v0.5.1 delivery](evidence/runtime-clarity-20261031/report.md) records 618/618 unit tests in 66 files, 86 browser passes with two opt-in capture skips, TypeScript/build and independent code/security scoped GOs. Its unpacked application passes 14 native window/browser/recovery scenarios. Clean setup, all 29,940 installed payload files, provider custody, two installed launches with draft recovery and owned uninstall pass. These isolated-profile checks do not establish account entitlement or inference. The [v0.5.0 delivery](evidence/cursor-subscription-20261031/report.md) retains its own 609-unit, ten-browser and 29,928-file evidence.

The [goal audit](evidence/current-goal-audit-20261031/report.md) separately records static T3 settings coverage, actual single-display verification and memory recovery. Coverage of all 136 upstream literal settings IDs is an inventory check, not complete upstream behavior parity.

### Historical verification

The [v0.3.0 delivery report](evidence/t3-centered-workspace-20261031/report.md) retains 412/412 unit tests; 125 broad browser passes with two opt-in capture skips; five source-final context/connection checks; 12 work-object behavior checks; 14/14 native checks on that unpacked application; and four actual portable-wrapper checks. Its package custody covered 66 backend files, 46 web assets and desktop bundles. These historical counts are not added to later release totals.

That checkpoint's entry snapshot decreased from 858,054 to 789,680 raw bytes (7.97%), and a controlled discovery response-shape comparison decreased from 41,222 to 9,582 bytes (76.76%). Those measurements retain their original method and source scope; they are not current v0.5.1 bytes, measured token savings or an end-to-end speedup.

Native Dock/save starvation was traced to Chromium's shared six HTTP/1 connections being occupied by per-window SSE streams. One authenticated main-process Node stream now relays connection state and sequence only; each renderer still fetches its own authenticated snapshot. Focused regressions and the six-window native run verify the repair. The current defect is no longer classified as unexplained.

The historical [private online review](https://generative-harness-video-review.skytuhua.chatgpt.site/reviews/t3-centered-20261031/index.html) includes two actual-application fixture videos, a before/after shell comparison and themed/narrow work-object frames from that delivery. They use synthetic data and a scripted runtime, not fresh Pi inference or OAuth. They do not verify the v0.5.1 changes. Historical genuine Pi recordings retain their original labels. [efficiency.json](evidence/t3-centered-workspace-20261031/efficiency.json) records the older byte-comparison snapshots and their limits.

## Current subscription implementation

| Provider or runtime | Current status |
| --- | --- |
| ChatGPT / Codex, legacy Codex, GitHub Copilot, xAI / Grok | OAuth integrations enabled. The genuine current-catalog ChatGPT run established initial composition and local reload recovery; its continuation hit the subscription usage limit. Other account/entitlement/inference acceptance remains separate. |
| Claude | The verified installer includes published official Claude Code through the pinned Agent SDK, with direct native sign-in in an isolated app profile. Live-account acceptance remains pending; the harness does not offer direct Claude.ai OAuth. |
| Gemini | The verified installer includes published official Gemini CLI with direct Google-account sign-in in an isolated app profile, ACP v1 startup and native session continuation. Live-account acceptance remains pending. Compaction is unavailable in the pinned runtime. |
| Cursor | The verified v0.5.1 installer contains the preview connection with official SDK/private browser sign-in. Metadata-only create/resume, native history, guarded pre-authentication Agent.send/parser compatibility and the corrected production Git boundary have scoped evidence. These checks do not establish a successful authenticated turn, billing behavior or active native-task cancellation. Compaction is unavailable. |
| Kimi Code | Current source has a dedicated membership plan-key connector with a fixed coding endpoint. Live account validation and inference remain unverified. |
| OpenCode Go | Current source has a dedicated Go workspace plan-key connector with fixed Go endpoints. Installed model definitions do not establish account entitlement. |
| OpenCode runtime | Separate official-runtime integration pending. |
| Meta / Muse | Unavailable; entitlement and integration requirements remain unverified. |

Application-side API-key billing fallback remains disabled. Dedicated plan keys require explicit connection markers and fixed plan endpoints; they are not generic pay-as-you-go credentials. Provider-side Extra Usage settings may still consume a balance, and the harness does not infer absent billing or quota data. The [connection inventory](subscription-connections.md), [v0.5.0 verification](evidence/cursor-subscription-20261031/report.md) and historical [provider-expansion evidence](provider-expansion-milestone.md) retain their separate implementation and acceptance scope.

## Open acceptance gates

- Exercise real detached windows on multiple physical displays and mixed-DPI configurations, including unplug/reconnect and deliberate placement after rescue. The 15-check actual-display run covers one 150% display only.
- Complete remaining live sign-in, account-entitlement and inference checks in explicitly authorized profiles. Empty-home startup, SDK metadata and guarded pre-authentication failure checks are not successful native account turns. Nine admitted IDs across eight brands are not almost-all-subscription account acceptance.
- Complete the latest genuine UI task's same-artifact continuation after its subscription limit is resolved. The recorded initial composition remains valid; the failed continuation is not promoted to success. No automatic retry, model switch or billing fallback is authorized by the quota error.
- The separate OpenCode agent runtime remains pending and Meta/Muse remains unavailable; their source/authentication admission gaps remain distinct from the already available Go endpoint.
- Obtain user visual acceptance separately from the published synthetic fixture review and genuine initial-composition evidence.
- Deferred and unchanged: keep GENERATED_APPS_ENABLED=false. Generated-code enablement and the full 36-run pilot remain outside this milestone.

## Previous deliveries

The [v0.2.0 comprehensive review](evidence/comprehensive-review-20261030/report.md), [reserved-rail review](evidence/frontend-review/reserved-rail-20261030/index.html), [Windows desktop preview](evidence/windows-desktop-20261030/README.md), [v0.4 provider milestone](provider-expansion-milestone.md) and [v0.4.1 delivery](evidence/ui-working-object-package-20261031/report.md) retain their original evidence scope. The current centered shell supersedes the reserved-rail layout; historical component counts and test totals describe those deliveries only.

The historical [v0.3.0 portable preview](../dist/desktop-release-0.3.0/Generative-Harness-0.3.0-win-x64.exe) retains its [manifest](evidence/t3-centered-workspace-20261031/build-manifest.json) and [wrapper receipt](evidence/t3-centered-workspace-20261031/portable-verification.json). It is unsigned and 747 MB; its observed first extraction/launch took 68.5 seconds. Those results do not describe v0.5.0 or v0.5.1 startup or package size.
