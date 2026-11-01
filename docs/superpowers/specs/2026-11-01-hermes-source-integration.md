# Original Hermes engine integration

The user explicitly requests copied upstream source, not a reimplementation, and has opted out of questions while asleep. Deferred trace/staging cleanup stays untouched.

Use NousResearch/hermes-agent commit `c627ec84664d43e0b18b95d9d86d8963747d56c7`, preserve its MIT notice and verify vendored bytes. A newer HEAD was observed during research; this reviewed integration remains pinned rather than changing underneath verification.

## Decision

Run the real Python `run_agent.AIAgent`, learning reviewer, skills manager, usage/ledger, curator and `/learn` builder. Use Hermes's supported provider extension returning its original `ACPClient`. A narrow Node ACP text server connects that client to the existing selected-account runtime. Native SDK tools are disabled/denied; actual Hermes executes its tools once. Foreground and review use the real Hermes loop so cadence, snapshots and review limits are not approximated by host tool counts.

Hermes filesystem packages and ledger become the canonical skill library. SQLite remains the host UI projection and legacy compatibility history. Preserve existing skills/proposals/history during migration. Keep model-facing upstream schemas, full frontmatter and original patch behavior; UI revisions are host concurrency checks, not mandatory fields in upstream tools.

Keep existing resource grants, exact effect approvals, epochs, account claims, process settlement and draft ownership. Advertise only source skill tools and registered host capabilities. Bind an app-owned HERMES_HOME; prohibit global-profile discovery, lazy installs (`HERMES_DISABLE_LAZY_INSTALLS=1`, `security.allow_lazy_installs=false`) and inline skill preprocessing. Native credentials stay with the existing runtime. Unknown ACP usage must not be reported as measured zero.

## Compatibility work

- A Python worker hosts upstream agents/tools and emits owned lifecycle/tool/library events over a private framed protocol.
- A Node ACP text server implements initialize/session/model/prompt/cancel and owns the actual native runtime until settlement. It exposes no filesystem/terminal/MCP authority.
- The runtime adapter retains the existing start/follow-up/stop/history/compaction contract and input-entry receipt semantics. Source capabilities that cannot be supported honestly remain explicit acceptance gates.
- Existing Settings/library/approval/archive/rollback controls use a thin upstream adapter; no second writable skill engine or fake AIAgent.
- Python/runtime dependencies and required source data must be pinned and covered by source-custody and packaging checks.

## Acceptance

Prove actual upstream function/class execution, not merely copied files. Run upstream behavioral fixtures through the bridge for frontmatter, fuzzy patching, 20-operation batches, foreground ownership, fresh patch/view curation, iteration cadence, real review forks, budgets, index replay and rollback. Retain host authority/account/cancellation regressions and all-nine synthetic routing. Review code/security independently. Distinguish local/scripted/native evidence from signed-in model quality and universal OSS parity.

Separately fix the four confirmed audit defects: canonical-profile lease before recovery, truthful side cleanup failure, archived-body snapshot filtering, and exclusive explicit packaging output. These are targeted reliability changes; do not import another framework or broaden user flows.
