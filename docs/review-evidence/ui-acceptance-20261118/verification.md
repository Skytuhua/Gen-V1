# Verification ledger

## Scope and provenance

- Source: PR #896, `repair/ui-acceptance-20261118`.
- `824ca2aa`: restore saved layouts, profile hooks, browser-suite registration and Windows Edge evidence steps removed during T04.
- `57de90ab`: retain the model-picker controller and compact anchor in secondary conversations.
- `5eed5bbd`: normalize a detached workspace's initial tab and preserve it when adding another surface.
- Verification uses synthetic browser fixtures on Linux/aarch64. It does not certify native Edge, a production account or owner visual acceptance.
- Both new regressions were reproduced with failing browser tests before their fixes. The model-picker searchbox did not open in either secondary presentation; detached Files disappeared after adding Diff when saved tabs were empty.

## Prior focused checks (before owner updates)

```text
saved-layout-chooser: 15 passed (19.1s)
chat-view-modes: 8 passed (19.3s)
composer-commands: 12 passed (28.8s)
desktop-surfaces: 38 passed (1.1m)

pnpm lint:
UI guard: 630 sources; 0 violations; 39 inventoried legacy/geometry occurrences (not primitive approvals); 0 retired entries.

pnpm typecheck:
> tsc --noEmit

pnpm test:ui-guard:
 Test Files  2 passed (2)
      Tests  31 passed (31)
```

The supplemental visual-matrix run on the repaired source passed all 468 cells, with 1,032 ignored captures. Its docked, short-height, 125% cell reproduces bottom-edge clipping with the old narrow condition (`Expected: <= 481`, `Received: 490.5`), and passes after restoring the height-aware condition. The temporary reversal was not committed. The matrix and its minimal geometry fix belong to PR #967, not PR #896.

## Full browser suite

The first full run against `824ca2aa` completed with exit 1: 1,938 passed, 12 failed and 5 skipped across 80 suites. A subsequent run against `5eed5bbd` was stopped when newer owner commits arrived. These are historical results, not validation of the owner's new head. The final full run is scheduled after rebasing these fixes and evidence onto owner commit `d7cb7c7a`; its completion and baseline comparisons will be recorded in a follow-up ledger update.

## Baseline and environment checks

Focused comparisons used `origin/main` at `5cde22a7` in an independent worktree. They are intentionally narrow comparisons, not a passing full-main run.

| Area | Evidence and limitation |
| --- | --- |
| Linux host file operations | The two host-operation cases fail with `HarnessError: File access check failed — the folder could not be opened safely for this action`, in the unchanged Linux path guard. This machine has `NoNewPrivs: 0` and zero effective capabilities; it does not satisfy the required Linux custody-broker environment. A direct acquisition probe against the same guard on main fails before its action runs. The main E2E host UI itself stopped at its earlier Message-textbox assertion, so that probe, not a passing main host scenario, is the environment comparison. |
| Graph short-window CSS zoom | Main's six-cell short-window probe reports three failures, including the same 125/150% containment assertions (`Expected: <= 383`; overflowing right edge). No shared popover changes were made in this repair. |
| Sidebar motion | Main's reduced/off-motion probe reports one failure and three passes. The failure is the same retained `.sidebar-collapse-overlay` (`Expected: 0`, `Received: 1`). |
| Live usage in memory-recovery App | Main reproduces the same split-conversation test timeout while clicking Minimize live usage; the target repeatedly detaches. |
| Conversation find motion | Main reproduces the same reduced/off-motion search-animation count assertion. |
| Project picker at 320 x 280 | Main reproduces the same timeout opening the picker, with the sidebar Search input intercepting pointer events. |
| Task-design image proportions | Main reproduces the same aspect-ratio assertion (`Expected: 1.6`, `Received: 0.4380111393119007`). |
| PDF preview and native resize | The first full run had one PDF-preview readiness timeout and one native top-resize rollback mismatch. Isolated main probes pass for both; the earlier focused repaired-source desktop suite also passed. Their causes are unclassified/intermittent, not proven fixed or proven change-related. An initial concurrent PDF comparison also failed, but its artifact output collided with another probe; isolated, uniquely named outputs were then used instead. |

The final full-suite result is not treated as green when baseline/environment failures remain. No test expectations, security guards or unrelated motion/preview code were weakened to hide them.
