# Preview release notes

Gen is a Windows x64 preview. Source features, published downloads and acceptance results have different scopes.

[Get started](getting-started.md) · [Feature tour](features.md) · [Changelog](../../CHANGELOG.md)

## What you can download

The [v0.6.1 prerelease](https://github.com/skytuhua-org/Gen-V1/releases/tag/v0.6.1) is the current published preview. It includes an unsigned Windows x64 installer and a SHA-256 checksum file. It is not a stable release.

The 0.6.4 and 0.6.5 source previews are not published stable installers. Use the source setup instructions to try changes made after the v0.6.1 prerelease. Release availability can change; check the [release list](https://github.com/skytuhua-org/Gen-V1/releases) before choosing an installer.

<a id="unreleased-065-source"></a>

## 0.6.5 — YYYY-MM-DD

This source preview covers all changes since v0.6.1, including the 0.6.4 source
preview. See the [grouped changelog](../../CHANGELOG.md#065--yyyy-mm-dd) and
[visual workspace guide](../visual-workspace.md). Highlights include:

Interim scope: items explicitly numbered below are unmerged and pending 0.6.5
freeze gates, not shipped changes. #584 is deferred.

Providers: OpenAI — **Verified** (recorded live acceptance); Claude, Gemini,
Cursor, Pi, OpenAI-Codex, GitHub Copilot, xAI, Kimi, OpenCode and Meta/Muse —
**Preview-unverified**. These labels describe live acceptance evidence, not
availability or verification of every 0.6.5 build. See the
[verification record](../verification/README.md).

Generated apps are **Preview**. 0.6.5 ships as an **unsigned prerelease (preview)**,
not a stable-channel promotion. Expect Windows SmartScreen to show a
"Windows protected your PC" warning when installing it.

- **Workspace and UI:** durable split layouts, retained editors, in-app floating
  conversations, parked-view recovery, undo/redo, named layouts, project colors
  and a unified overview/plan timeline. Legacy canvas records survive retirement
  of the built-in Code Review, Research, Custom and Visuals presets.
- **Pending workspace accessibility and acceptance:** keyboard-created source
  selections for pointer-free Ask/Attach/Open (#788), control boundaries meeting
  3:1 non-text contrast in both themes (#789), and layout-resilience verification
  at UI zoom and OS text scaling (#589). UI acceptance repairs (#896) preserve
  main selection when detaching a non-main conversation, improve dock previews
  and keyboard float resizing, and refine compact composer, plan and
  workspace-surface behavior.
- **Conversations and agents:** loaded-message search, saved local prompts,
  command/skill selection, terminal excerpts and paged Personal/agent reads.
  Separately gated work adds typed delegation, budgeted multi-agent tasks,
  background scheduling, human handoffs, proposed GitHub intake, fixed-cut
  inspection, quoted-context new tasks and inert history imports.
- **Context, memory and Hermes:** inspectable request budgets, usage/timing and
  compaction costs; gated source-bound context preparation, repository maps,
  loss-aware compaction and opt-in source-linked project memory with review,
  exclusions and recovery. Shared model scheduling improves runtime accounting;
  warm reuse remains experimental.
- **Integrations and MCP:** public plug-in API v1, independently versioned and
  integrity-checked packages, durable plug-in data and optional Personal Visuals.
  Approved Context7 operations expose reference/advisory provenance. Isolated
  extension workers have separate activation holds.
- **Git and developer tools:** managed worktrees, selective commits, checkpoint
  history and diff review; gated restore, code intelligence, rename recovery,
  restricted debugging, build/browser verification and a source-aware workbench.
- **Settings and attention:** searchable supported settings, reversible appearance
  previews, protected environment values, a shared shortcut reference, durable
  Inbox/custom attention and improved profile-scoped GitHub sign-in.
- **Desktop and updater:** guarded stable-update checks, deferred/retry handling,
  restored conversation detachment/docking, closed-window recovery, stable bounds,
  compact startup feedback and stronger packaging/export checks.
- **Security:** separately gated project trust, secret
  references, single-use approvals and recoverable effect receipts; stronger MCP
  credential redaction at MCP output, document permissions and custody checks.
- **Pending security repair:** retain a known-bad integration denial when
  advisory refresh fails (#936), rather than losing the prior denial.

### Performance and fixes

- Paged reads, lazy panels and reduced rescanning accompany fixes to drafts/focus
  and checkpoints.

### Runtime reliability and safety

- Preserve schedule pauses, cancellations, newer leases and blocked states during recovery and late delivery reconciliation.
- Reject plan progress and report writes based on stale revisions; advance report cursors only through the events actually consumed.
- Bound package advisory cache reuse to 24 hours, require fresh snapshot provenance for clean results, and block inconsistent screening decisions.
- Validate initial terminal commands before spawning; retain complete characters when trimming scrollback and keep transcript cursors in bounds.
- Measure thread-note budgets against the stored text, keeping memory bounded for continuity rather than treating it as source evidence or approval.
- Redact integration error metadata and reject causes, property names or formatter accessors that cannot be safely scrubbed of credentials.
- Avoid host restart hangs when event-stream clients disconnect during shutdown, without waiting for duplicate close events.
- Keep the isolated extension lifecycle off by default and its catalog hidden while disabled; keep migration updates blocked and prevent worker replacement until prior shutdown is confirmed.
- Bound provider history and session-header reads, reject malformed history, and tighten startup deadlines, cancellation cleanup and optional usage waits.

Advanced host capabilities are separately gated and generally default off;
listing source work here does not grant execution authority, prove provider
entitlement or establish installed-release acceptance.

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

### Known issues

- Installed stable-upgrade acceptance (upgrading an installed stable build to
  0.6.5 via the updater) is still open/unverified. Source or candidate checks do
  not prove preservation of a real installed profile.
- Independent live sign-in, model entitlement and task acceptance beyond the
  evidenced OpenAI route, and the broader generated-application **Preview** quality pilot,
  remain open.
- Physical multi-monitor/mixed-DPI placement, native popup focus/sound/privacy,
  DPAPI round-trip and browser occlusion still require target acceptance.
  Desktop acceptance across mixed-DPI and multi-monitor setups (#584) is deferred
  from 0.6.5.
- New native canvas-panel detachment/free-floating desktop views are unavailable.
  Gemini/Cursor native compaction, the separate OpenCode agent runtime and
  Meta/Muse access remain unavailable; tested native session forks are unsupported.
- Isolated-extension activation still has a backend-launch-binding hold.
  Browser/desktop control and paired-client remote access are unavailable.
- Advanced capabilities retain default-off and per-platform acceptance gates.
  Historical full-suite failures, skipped/opt-in checks and partial milestone
  evidence are not whole-product 0.6.5 acceptance; existing large-chunk build
  warnings and visual-fidelity/user acceptance remain unresolved.
- Independent installed-Windows memory retention and opt-in qualification (#782)
  is included pending 0.6.5 freeze gates; this draft CI-only work is not completed
  acceptance or a user-facing feature.

The [visual-workspace verification report](../visual-workspace-verification.md),
[extension handoff](../implementation/v6/M13/handoff.md) and
[session capability evidence](../implementation/v6/M14/handoff.md) record scoped checks
and holds, not blanket release approval.

A bounded review of 28 captured alerts from the older default branch found none applicable to the evaluated 0.6.4 source. It did not cover newly disclosed advisories outside that set or every opaque bundled binary, and is not a vulnerability-free claim.

In the current source preview, the conversation pane's **Detach conversation** action floats it inside Gen; use **Return to main** or drag it to a split edge. On Windows desktop, the sidebar's **Detach thread** instead opens a pinned native window. See the [visual workspace guide](../visual-workspace.md) for both paths. Neither action enables new native detachment for canvas panels. Gemini/Cursor native compaction, the separate OpenCode agent runtime and Meta/Muse access are also unavailable. Historical design and desktop documents retain older proposals and evidence; the current UI and these limits take precedence.

## Data, licensing and attribution

Existing profiles keep the `GenerativeHarness` and `GenerativeHarnessDesktop` namespaces. Close the app before backups and retain saved drafts, receipts and blocked-operation records during troubleshooting. A source build or candidate check does not establish that an installed upgrade preserved a real profile.

First-party source remains proprietary and unlicensed for redistribution under [LICENSE](../../LICENSE). Retained third-party components keep their original terms; see [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). This presentation does not change those terms.
