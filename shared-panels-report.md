# Shared panel bodies and editor handoff

Delivered 2026-11-02. Assigned source is frozen for the parent's integrated verification and fresh review. No commits or pushes were made, and no child agents were started. No task-owned process remains running.

## Changes and ownership

- `apps/web/src/WorkspacePanelBodies.tsx`: extracted existing recorded/read-only bodies from WorkspacePanel without retaining duplicate implementations. Exports `UsageSummary`, `WorkspaceLauncher`, `GrantedFiles`, `RecordedDiffPanel`, `snapshotDiffs`, and `OutputPanel`.
- `apps/web/src/WorkspacePanel.tsx`: retains ResizeHandle and the default panel shell. All non-artifact tabs use the parent's WorkspaceSurfaceBody, passing preferences, resource binding, and optional refresh. Reexports `UsageSummary` and `snapshotDiffs` for compatibility. Adds Terminal, Pull request, and Linked pull requests tabs.
- `apps/web/src/workspace-context.tsx` and `shell-layout.ts`: permit and restore those three additional tabs.
- `apps/web/src/WorkspacePanelBodies.tsx`: launcher enables actual Terminal/PR actions. Optional `onOpenTool(kind)` goes to the owning canvas; otherwise the action selects the matching workspace tab. Browser remains the existing isolated native action and Device remains deferred. Output describes recorded receipts and points to Terminal for interactive input.
- `apps/web/src/editor-handoff.ts`: exports `registerEditorHandoff(key, guard)` and `prepareEditorHandoff()`. One module-level Map keyed by unique symbols retains duplicate artifact registrations. Cleanup removes only the individual registration. Preparation waits for all mounted guards before returning or throwing the first failure.
- `apps/web/src/desktop-context.tsx`: useDesktopCloseGuard always registers in the shared registry, including without DesktopProvider. DesktopProvider's registerClose and prepareHandoff use that same registry rather than maintaining another map. Existing native controls were preserved.
- `apps/web/src/Artifact.tsx`: optional embedded prop uses standalone editor placement, avoids conversation workspace/expanded placement, and hides its redundant expand/workspace buttons. Existing autosave, guard, widget body, and action behavior are retained.
- `apps/web/src/App.tsx`: only the editor-handoff import, prepareWorkspace's shared guard call, WorkspaceSurfaceBody preferences/onSelectThread/onOpenTool props, and WorkspacePanel refresh prop were changed by this task. Existing canvas/context/browser/other UI work belongs to the parent and was retained.
- `apps/web/src/DesktopEntry.tsx`: only restoration of the three tool tabs and WorkspacePanel refresh prop were changed by this task. Existing custom panel dispatch belongs to the parent and was retained.

WorkspaceSurfaceBody.tsx, workspace-tools.css, manifests/locks, nativeMain, server/backend code, company code, and original upstream trees were not edited by this task.

## Verification

1. RED: `pnpm exec vitest run tests/editor-handoff.test.ts --maxWorkers=1` failed because editor-handoff did not yet exist.
2. GREEN: the same command passed all 3 tests. Checks duplicate-key retention and independent cleanup, waiting for all editors after a refusal, and removing unmounted editors.
3. `pnpm exec playwright test --config tests/e2e/shared-panels.playwright.config.ts` passed all 4 tests with one worker. A private Vite host at port 5371 exited cleanly. Checks default tool tabs/launcher, native-browser and Device boundaries, owning-canvas callback routing, browser guard registration without DesktopProvider, refusal retention, and saved tool-tab restoration.
4. `git diff --check` completed without whitespace errors; existing repository line-ending warnings were printed.

The new browser fixture/config/spec are `tests/e2e/shared-panels-fixture.tsx`, `shared-panels.playwright.config.ts`, and `shared-panels.spec.ts`. Fixture API interception prevents requests reaching the user's running host.

These checks prove component wiring and guard behavior with fixtures. They do not prove a live PTY, authenticated GitHub actions, company authority behavior, native window acceptance, visual acceptance, or the complete build. The parent owns the integrated typecheck/build, connected-tool checks, and fresh code review.
