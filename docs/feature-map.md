# Web feature map and verification

The web entry is `apps/web/src/main.tsx`. The local application route is `/`;
workspace presets and settings are application state, not separate URL routes.

| Screen or flow | Owning files | Browser verification |
| --- | --- | --- |
| Conversation and composer | `App.tsx` (composer state), `ComposerView.tsx` (view) | `shell`, `composer-commands` suites |
| Workspace presets | `WorkspaceHost.tsx`, `WorkspaceCanvas.tsx` | `workspace-host` suite |
| Thread navigation and menus | `ShellSidebar.tsx`, `packages/ui-shell/ActionMenu.tsx` | `sidebar-shared-menu` suite |
| Manual thread moves | `ShellSidebar.tsx`, `sidebar-thread-move.ts` | `thread-move` suite |
| Thread previews | `thread-hover/ThreadHoverCard.tsx` | `thread-hover` suite |
| Settings | `Settings.tsx` | `settings-leaf-selects` suite |
| Local table controls | `TaskTable.tsx`, `TaskTableControls.tsx`, `task-table-model.ts` | `table-controls` suite |
| Files and review | `files/FilesView.tsx`, `CodeReviewHost.tsx` | `files-reading`, `code-review-host` suites |

UI owning files above are under `apps/web/src/` unless a package path is given.
The complete fixture/state registry is [screen-map.ts](../scripts/capture-ui/screen-map.ts).
The exact suite-to-config mapping is [browser-suites.ts](../scripts/browser-suites.ts).

## Run the UI verify script

The existing [test-browser.ts](../scripts/test-browser.ts) is the reusable UI
verify script. Each selected Playwright configuration boots its own isolated
host and drives the production components. For WO-3.4:

```sh
COREPACK_HOME=$HOME/.cache/corepack pnpm exec tsx scripts/test-browser.ts --suite thread-move
```

That flow checks pointer Move to top/bottom with a closed mobile drawer on
desktop, affected rows and timing, interruption, focus, keyboard and reduced
motion, no-ops, background updates and restoration. It uses port 5504 and a
writable temporary Vite cache. The fixture intercepts data and uses synthetic
threads; this does not establish live-host or physical-device acceptance.

Choose another named suite with `--suite NAME`; omit that option to run all
registered browser suites. A scoped run verifies only the selected flow.
Use [UI capture](ui-capture.md) for screenshot/state and motion evidence, and
retain audit failures separately from functional test results.
