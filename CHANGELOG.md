# Changelog

Changes are grouped by release. Verification scopes are recorded separately from feature availability.

## 0.6.5 — YYYY-MM-DD

Source preview covering changes since v0.6.1, including the 0.6.4 source preview.
Source availability does not establish installed-release acceptance. Advanced
host capabilities below remain separately gated; a source implementation does
not enable them by default.

Interim scope: see [Pending 0.6.5 freeze gates (not yet merged)](#pending-065-freeze-gates-not-yet-merged)
for unmerged scope, not shipped changes. #584 is deferred.

Providers: OpenAI — **Verified** (recorded live acceptance); Claude, Gemini,
Cursor, Pi, OpenAI-Codex, GitHub Copilot, xAI, Kimi, OpenCode and Meta/Muse —
**Preview-unverified**. These labels describe live acceptance evidence, not
availability or verification of every 0.6.5 build. See the
[verification record](docs/verification/README.md).

Generated apps are **Preview**. 0.6.5 ships as an **unsigned prerelease (preview)**,
not a stable-channel promotion.

**Upgrading from v0.6.1:** download and run the 0.6.5 installer over the existing
install; the in-app updater is not available in v0.6.1. There is no rollback to
v0.6.1. Close the app fully and back up your profile/data first: the default
backend data is in `%LOCALAPPDATA%\GenerativeHarness` and the desktop window/session
profile is in `%APPDATA%\GenerativeHarnessDesktop`
([documented locations](docs/public/getting-started.md#keep-your-data-recoverable)).
In-app stable-update checks apply only to later upgrades from 0.6.5.
Expect Windows SmartScreen to show a
"Windows protected your PC" warning when installing it.

### Workspace and UI

- Add a durable split workspace with existing-thread dragging, retained editors,
  in-app floating conversations, parked-view recovery, undo/redo and named layouts;
  preserve legacy canvases and exact saved-layout ownership.
- Unify the project overview and canonical plan summary, with a separate full
  plan timeline, stable live progress and narrow-screen focus preservation.
- Add scoped project selection, meaningful project colors, compact project-row
  agent chats and recoverable sidebar navigation down to narrow window sizes.
- Refine shared menus, dialogs, model/reasoning selection with favorites, loading
  states, motion, keyboard navigation, touch controls and polite live regions.
- Retire the built-in Code Review, Research, Custom and Visuals presets without
  discarding saved canvas records; keep optional visual tools separate.

### Conversations and agents

- Add phrase search within loaded messages, named local prompts, command/skill
  selection and terminal excerpts attached to composer drafts.
- Add paged Personal conversation and agent reads, inspectable skill metadata,
  durable delegated follow-up tickets and owner-bound workspace action outcomes.
- Add gated typed multi-agent work with role checks, per-task slots, budget
  reservations, ordered inputs and verified outputs.
- Add gated durable background jobs, recurring scheduling, human handoffs and
  read-only GitHub polling intake that proposes work rather than approving it.
- Add gated fixed-cut session inspection, explicitly labelled quoted-context new
  tasks and validated inert ArchiveV1 history imports, not native session forks.

### Context, memory and Hermes runtime

- Separate reported usage from conversation context; expose measured next-request
  byte budgets, request timing, usage and retained compaction costs for inspection.
- Add gated owner-bound request preparation, approved project instructions,
  bounded repository maps, retained tool results and loss-aware native compaction
  with exact source-cut checks and guarded summary precomputation.
- Add opt-in source-linked project memory with review, exclusions, conflict
  recovery, native checkpoints, study/recall controls and scheduled purge.
- Route Hermes model traffic through shared request scheduling and accounting;
  enforce call/token budgets and isolate warm-transport reuse experiments.
- Preserve provider telemetry and improve UTF-8 history decoding.

### Integrations, MCP and plug-ins

- Add public plug-in API v1 with independent package versions, integrity and
  compatibility checks, declared capabilities and durable data outside updates.
- Add generic optional plug-in workspaces and the independent Personal Visuals
  plug-in; the main workspace works without an installed plug-in.
- Add approved host integration operations and Context7 reference delivery with
  inspectable provenance and protected MCP output.
- Add a separately gated isolated-extension worker lane with leased lifecycle and
  declared-tool registration; activation requires a proven confined backend.
- Verify saved Kimi Code keys with a bounded authenticated account check;
  refused keys show **Not accepted**. Other saved credentials stay
  **Saved, not verified**.

### Git, worktrees and developer tools

- Add managed working copies, selective commits, paged checkpoint history,
  read-only diff review and gated restores with preimage/integrity checks.
- Add gated revision-aware code intelligence, precise edit/rename previews with
  recovery journals and a restricted debugger using approved recipes.
- Add gated build/browser verification, bounded repair and completion evidence;
  declared compatibility checks run against a verified current source cut.
- Add a default-off source-aware workbench with owner-bound source selections,
  read-only memory inspection and retained recovery state.

### Settings and attention

- Consolidate supported settings with visible search targets, reversible
  appearance previews, protected environment values and a shortcut reference
  backed by the shared binding registry.
- Add durable Inbox/custom attention, bounded notification popups and recovery.
- Improve profile-scoped, cancellable GitHub sign-in and exact device-page links;
  preserve provider/account ownership across reactivation and saved work.

### Desktop app, packaging and updater

- Add controlled stable-update checks with idle, save and clean-shutdown gates,
  truthful deferred status and retries after installer dispatch failures.
- Restore desktop conversation detachment and return to the original thread on
  docking; retain closed native-window history and stable intended bounds.
- Add compact native startup feedback and improve renderer-close resilience,
  installed frame admission, packaging/export integrity and provider payload custody.
- Add current public guides, screenshots and captioned demos using sample data;
  keep profile/storage namespaces compatible with existing installations.

### Security

- Add separately gated project trust review, opaque secret references and
  single-use approvals with a recoverable tool-effect ledger; recheck authority
  and revocation at execution rather than trusting a prior UI decision.
- Strengthen platform confinement/custody checks, plug-in document permissions,
  opaque-frame replacement handling and protected resource boundaries.
- Redact injected integration credentials across MCP output.

### Performance and fixes

- Page transcript reads, bound memory/review queries, lazily mount optional panels
  and yield during long event replays; reduce repeated sidebar, canvas and Inbox
  scans, renderer notices, search work and formatting allocations.
- Preserve composer focus, drafts, IME Escape behavior, disabled-control semantics,
  editor identity and conversation ownership through switches, reloads and docking.
- Fix checkpoint diff/apply, Git status parsing and split UTF-8 diff previews.

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
- Keep Inbox notifications beyond a 30-item delivery batch pending for the next
  delivery instead of marking them delivered unseen. (#915)
- Resolve project environment overrides before decrypting, so a shadowed device
  secret is never unprotected. (#917)
- Skip null or malformed entries in external issue intake without dropping the
  valid issues in the same batch. (#920)
- Bound optional composer prediction context by its serialized size, including
  escaped characters, so JSON-heavy chats stay within the limit. (#933)

### Pending 0.6.5 freeze gates (not yet merged)

These items are in 0.6.5 scope but not merged and ship only if they pass freeze gates.

- Keyboard-created source selections so Ask/Attach/Open do not require a pointer
  (#788), control boundaries meeting 3:1 non-text contrast in both themes (#789),
  and layout-resilience verification at UI zoom and OS text scaling (#589).
- UI acceptance repairs (#896): preserve main selection when detaching a non-main
  conversation, improve dock previews and keyboard float resizing, and refine
  compact composer, plan and workspace-surface behavior.
- Retain a known-bad integration denial when advisory refresh fails (#936),
  rather than losing the prior denial during a failed refresh.
- Independent installed-Windows memory retention and opt-in qualification (#782):
  draft CI-only work, not completed acceptance or a user-facing feature.

### Known issues

- Acceptance of installing 0.6.5 over an existing v0.6.1 install with profile/data
  preserved is still open/unverified; source or candidate checks do not prove it.
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

See [usage](docs/visual-workspace.md), [visual verification boundaries](docs/visual-workspace-verification.md)
and [preview acceptance limits](docs/public/release-notes.md#known-issues).

## 0.6.4 source preview

- Add a public plug-in API with separate package versions, integrity and compatibility checks, and data retained outside application updates.
- Add controlled stable-update checks with idle, save and clean-shutdown gates. Installed-version update acceptance remains open.
- Refine the sidebar, project selection, composer mode/model controls, canvas and protected context/usage tools.
- Preserve closed native-window history and stable intended bounds; add compact startup feedback using supported native controls.
- Retire new native detachment while retaining existing child recovery and saved layouts.
- Add current public guides, screenshots and captioned demo videos using authored sample data.

This source preview is not a published stable download. See the [current preview notes](docs/public/release-notes.md) for available downloads and exact verification scopes.

## 0.6.1 beta — Gen V1 publication

- Introduce the Gen V1 project name and professional repository documentation.
- Add application screenshots using curated sample data, contributor guidance and issue templates.
- Preserve existing profile/storage identifiers for compatibility.

See [the prerelease notes](https://github.com/skytuhua-org/Gen-V1/releases/tag/v0.6.1) for the publication build's assets and verification results.

## 0.6.0 — 2026-11-01

- Add optional next-message composer predictions with Tab acceptance, durable accepted drafts, bounded native execution and cancellation.
- Add per-account readiness, owned native sign-in progress/cancel/retry and supported local signout.
- Stage Cursor reconnect and verify its authenticated user identity; bind Claude metadata at native initialization.
- Enable generated-app **Preview** discovery and execution after actual-host checkpoint, recovery, startup-failure and responsiveness checks.
- Preserve the original Hermes conversation/skill-learning implementation and pinned source custody.

Verification included 1,040 passing application checks, 14 packaged native checks and genuine packaged OpenAI/Hermes task/restart acceptance. Other provider sign-ins, installer upgrade acceptance and physical multi-monitor checks remain open. See [the acceptance report](docs/2026-11-01-product-completion.md).

Earlier development milestones retain their original evidence in the historical documentation. They should not be treated as validation of later changes.
