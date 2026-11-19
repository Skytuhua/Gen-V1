# Curated summary — test-browser-full.log

Original raw output removed per CONTRIBUTING shared-evidence rules; preserved byte-for-byte out of source.

- Command: `pnpm test:browser`
- Observed result: **FAIL 1 (68/78 suites, env classes: 545x msedge channel absent, fixture port collisions)**
- Log stats: 58 passed, 113 failed; 29711 lines, 2646719 bytes
- Original sha256: `76ebaaf06e147072a66df6437e6c0d4d2388ddec5cfdf145aef11c84df3f2552`
- What: full browser run on the captured post-merge cut (see receipts for exact SHA/argv).

## Terminal tail (bounded excerpt, paths redacted)

```
  3 failed
    tests/e2e/wo8.spec.ts:27:3 › usage and context light 1440 ──────────────────────────────────────
    tests/e2e/wo8.spec.ts:27:3 › usage and context light 1024 ──────────────────────────────────────
    tests/e2e/wo8.spec.ts:112:46 › inline numeric table preserves full numbers light ───────────────
  21 passed (2.1m)

Failed browser suites: root (exit 1), workbench-app (exit 1), agents-workspace (exit 1), artifact-settle (exit 1), browser-action (exit 1), background-work (exit 1), compact-model-picker (exit 1), ui-shell-overlays (exit 1), file-checkpoints (exit 1), files-reading (exit 1), generated-selects (exit 1), graph-popovers (exit 1), memory-recovery (exit 1), redundant-ui (exit 1), saved-drafts (exit 1), saved-layout-chooser (exit 1), scoped-conversation (exit 1), settings-leaf-selects (exit 1), sidebar-collapse (exit 1), sidebar-shared-menu (exit 1), terminal-excerpts (exit 1), terminal-read (exit 1), thread-hover (exit 1), thread-move (exit 1), usage-app-integration (exit 1), workspace-host (exit 1), memory-recovery-app (exit 1), memory-recovery-journal (exit 1), frontend-refinement (exit 1), conversation-find (exit 1), conversation-scroll (exit 1), micro-motion (exit 1), motion-tokens (exit 1), clarity-software (exit 1), clarity-review-parameters (exit 1), clarity-schedule-logs (exit 1), fidelity (exit 1), model-picker (exit 1), workspace (exit 1), compact-settings (exit 1), compact-tools-cleanup (exit 1), composer-commands (exit 1), composer-prediction (exit 1), composer-press (exit 1), context-connections (exit 1), desktop-surfaces (exit 1), everyday (exit 1), floating (exit 1), inline-surfaces (exit 1), native-browser-bounds (exit 1), pdf (exit 1), plan-presentation (exit 1), project-app-integration (exit 1), project-picker (exit 1), project-search (exit 1), wo5-app-integration (exit 1), shell (exit 1), short-tool-overflow (exit 1), side-chat (exit 1), chat-view-modes (exit 1), smooth-operational (exit 1), smooth-pdf (exit 1), snapshot-performance (exit 1), summary-dock (exit 1), t3-centered (exit 1), tabs-identity (exit 1), table-controls (exit 1), task-design (exit 1), task-interface (exit 1), ui-shell-controls (exit 1), usage-context (exit 1), wo8 (exit 1)
 ELIFECYCLE  Command failed with exit code 1.
```
