# UI and motion capture

After `pnpm install` and `pnpm exec playwright install chromium`, run from the repository root:

```sh
pnpm capture:ui -- --scope=diff
pnpm capture:ui -- --scope=baseline
pnpm capture:ui -- --scope=all --since-days=14 --max-strips=30
pnpm capture:ui -- --screens=app-shell,inbox,graph --out=artifacts/ui-capture/review
```

Flags accept equals or separate values. Defaults: `--scope=diff`, `--since-days=30`, `--max-strips=60`. `--screens` overrides selection; `--out` names the exact output directory (use a fresh directory). Otherwise outputs go to the gitignored `artifacts/ui-capture/<UTC timestamp>/`. Baseline captures the entire registry without querying git/gh. All unions baseline with diff and includes PR provenance.

Local capture owns two Vite servers on available loopback ports: the **unchanged `tests/e2e/vite.config.ts` serves the real app shell at `/`**, and the capture-specific Vite config serves existing standalone fixtures. Both shut down in `finally`. No app, CSS, existing test, or existing fixture is modified. `shell-api.ts` independently adapts the snapshot/host/EventSource mock pattern from `tests/e2e/frontend.spec.ts`; it never imports that spec. Browser API traffic is intercepted with synthetic, read-only data and all external origins are blocked.

`BASE_URL=https://preview.example pnpm capture:ui -- --scope=baseline` uses a pre-existing server. It must serve the real app at `/`, the registered fixture HTML paths and `/capture/<screen-id>` entries with their module imports and `#root`. A production app alone does not supply the standalone fixture routes. APIs remain mocked even in preview mode.

## Registry and state recipes

The registry in `scripts/capture-ui/screen-map.ts` includes app-shell, workspace (artifact canvas), agents, research, code-review, plan, settings, projects, composer, files, controls, inbox, graph, sidebar-menu, generated-selects and saved-layouts. These are fixture captures, not live-provider or packaged-desktop acceptance.

Each entry declares a readiness selector, existing fixture module or HTML path, and recipes for default, hover, focus, open, empty, error and loading. Captures use 375/768/1440px widths and 1000px height, with fresh contexts for each recipe and a separate reduced-motion pass.

Recipes can use query parameters, hover/focus/click/keyboard steps, optional mobile navigation steps, a final visible selector, and an API mode. App-shell covers all seven states: sidebar hover/focus opens mobile navigation first, Settings opens from the shell, empty has no threads/projects, error returns 503, and loading holds bootstrap unresolved. API-backed agents, research, code-review, settings and files also hold their corresponding data response for loading. Sidebar-menu holds the project-facts requests after focusing a thread. The pending request is released only after sampling; loading entries include `heldRequests` as evidence. Saved layouts uses its existing loading query parameter.

An empty non-default recipe is skipped (`E`), never counted as a distinct state. Agents/research already default to empty and Settings already defaults to open, so those duplicate recipes are explicitly skipped. Controls error submits the existing required form to expose real validation feedback. After each non-default PNG is written, its SHA-256 is compared to default at the same width. Equal bytes yield `identical-to-default` (`I`), retain their diagnostic image, and do **not** count as captured. This also reports visually inert hover/focus states honestly.

To add a screen, reuse an existing fixture, add a readiness selector and only real state recipes. For async loading, set `api: 'loading'`, a `hold` pathname regex, and a readiness selector for its loading UI (never wait for networkidle on held requests). Use a query recipe for synchronous fixture-provided loading. Missing states are skipped with reasons; synchronous fixtures explicitly report no asynchronous loading boundary. State action failures continue with reasons; navigation, HTTP, mount and readiness failures make the final exit status nonzero.

## Scope and file classification

Diff queries `gh pr list --state merged --base main --search "merged:>=<UTC date>" --json number,title,mergedAt,files` (limit 1000, saturation warning). Without gh it uses first-parent merges on the existing `origin/main`, then first-parent commits for squash repositories. Unknown PR numbers are null and commit metadata substitutes for PR merge metadata in the fallback. No fetch is performed. If neither source is available, an empty scope records warnings.

Every changed file is classified once: `screen`, `excludedWebUi` with a reason, `desktopOnly`, or `nonUi`. All `apps/web/src/**`, `packages/ui-*/**`, widget protocol modules, and plugin renderer assets are screened for classification. Documentation/tests/scripts/server/core/Python are non-UI. UI exclusions take priority over mappings: importing an optional renderer in App does not establish visual coverage. Spec-only SideChat, InteractionTools and WorkObjects datasets, native browser/window surfaces, optional media/document tools and isolated plugins are explicitly excluded until they have registered capture recipes. Unregistered future renderers also get an explicit exclusion reason, not an unexplained unmapped entry.

`scope.json` retains per-PR file classifications and aggregate paths. `scope.md` contains **PRs → screens**, **web UI files excluded with reasons**, **non-UI files count**, and desktop-only sections. The mapping and exclusion rules have one executable source, `screen-map.ts`; the following tables are generated documentation snapshots. Every registered fixture module also maps to its own screen.

| File path regex | Screen ids |
| --- | --- |
| `^apps/web/src/(App\|DesktopEntry\|main\|WorkspaceHost\|ShellSidebar\|Composer\|ModelPicker\|LoadingState\|ChatScrollIndicator\|SentenceReveal\|workspace-context\|workspace-host\|shell-\|shell\.\|styles\.\|frontend-fidelity\|appearance\.\|loading-state\|composer-\|model-picker\|sentence-reveal\|chat-scroll)` | app-shell |
| `^apps/web/src/(WorkspaceCanvas\|WorkspacePanel\|WorkspaceControls\|workspace-canvas\|workspace-tools)` | workspace, app-shell |
| `(agents-workspace\|agent-inventory)` | agents |
| `(ResearchHost\|research-host\|research-workspace)` | research |
| `(code-review\|CodeReview\|GitPanel)` | code-review |
| `(plan-\|Plan\|SummaryDock)` | plan |
| `(Settings\|settings\|preferences)` | settings |
| `(ProjectPicker\|project-picker)` | projects |
| `(Composer\|ModelPicker\|composer\|model-picker)` | composer, app-shell |
| `(Files\|files-reading\|WorkspaceSurfaceBody\|^apps/web/src/files/)` | files |
| `(InboxView\|AgentInbox\|agent-inbox)` | inbox |
| `(RelationshipGraph\|relationship-graph)` | graph |
| `(SavedLayoutChooser\|saved-layout-chooser)` | saved-layouts |
| `(thread-hover\|sidebar-shared-menu\|sidebar-context)` | sidebar-menu |
| `^packages/ui-shell/` | app-shell, workspace, agents, research, code-review, plan, settings, projects, composer, files, controls, inbox, graph, sidebar-menu, generated-selects, saved-layouts |
| `(ui-shell-controls)` | controls |
| `^apps/web/src/registry\.tsx$` | generated-selects |

| Exclusion regex | Reason |
| --- | --- |
| `^apps/web/src/(DesktopBrowser\|FloatingWindow\|PluginFloatingWindow\|UpdateControl\|native-chrome\|floating-window\|desktop\.css)` | desktop-only: native WebContents/window/update surface requires Electron |
| `^apps/web/src/(SideChat\|side-chat\|ScopedConversationComposer\|conversation-workspace/)` | No standalone registered fixture: scoped/side conversations require a separate conversation protocol dataset |
| `^apps/web/src/(InteractionTools\|WorkObjects\|interaction-tools)` | No standalone registered fixture: spec-built task components require typed task datasets and actions |
| `^apps/web/src/(Artifact\|Document\|document-preview\|Signature\|signature-assets\|TaskDisclosure\|TaskTable\|task-table\|ImageCompare\|MapView\|map-view\|EverydayData\|ExplorationTools\|exploration-tools\|SoftwareDevelopment)` | No registered document/media/task fixture: requires supplied artifact data, assets or export bindings |
| `^apps/web/src/(PluginFrame\|plugin-runtime\|plugins\.css)\|^plugins/.*\.(tsx\|jsx\|css\|html)$` | No registered isolated plugin fixture; installed plugin renderer is not mounted by shell baseline |
| `^apps/web/src/(CredentialEntry\|GitHubSignIn\|Connections\|github-sign-in\|connections\.)` | No authenticated account/native credential fixture; shell capture uses synthetic model metadata only |
| `^apps/web/src/(ContextInspector\|ContextMeter\|TaskMemory\|task-memory\|context-inspector\|UsageDialog\|UsageFooter\|usage-dialog\|ProjectContext\|project-context\|TerminalBody\|terminal-read\|DraftTransfer\|draft-transfer\|SkillLibrary\|DelegatedAgentTranscript\|WorkspaceSplitLayout\|workspace-split\|workspace-integration)` | Optional tool/dialog renderer is not mounted by a registered capture recipe |
| `^apps/web/src/.*\.ts$\|^apps/web/src/(desktop-context\|focus\|task-motion\|useAppearance)\.tsx$` | Non-visual API/state/layout/motion helper; no standalone visual surface |
| `^packages/ui-catalog/\|^packages/widgets/` | Non-visual catalog/protocol module; requires a separate rendered artifact fixture |

## Output layout and coverage

```text
scope.json / scope.md
screenshots/<screen>/<state>-<width>.png
motion.json / motion.md
strips/<number>-<screen>.png
reduced-motion.json / reduced-motion.md
manifest.json / index.md
```

Index includes a screen × seven-state coverage matrix: captured widths, or width-qualified codes `U` unsupported/excluded, `E` empty recipe, `I` identical, `F` state action failure, `L` load failure. Full skip reasons and diagnostic PNG paths are listed below it. Totals include screens, captured screenshots, identical images, motion rows, unique animations, strips, reduced-motion offender unique count and total count, plus elapsed seconds. Manifest contains the same matrix, totals, hashes, outcomes and strip failures.

Motion uses `document.getAnimations()` for CSS animations, transitions and WAAPI. A requestAnimationFrame sampler retains short entrances during load. Rows include target CSS path, type, name/property, animated properties, duration, delay, easing, iterations and fill. `:load` identifies pre-trigger sampling; normal state names identify post-trigger sampling. Reduced-motion offenders use >1ms per iteration and positive iterations. Unique animation/offender counts use screen, target, timing and keyframes, deduplicating across state and viewport.

Frame strips remain paused 0/50/100% samples of active duration (one iteration for infinite animations), with 8px viewport-clipped padding. Other animations are frozen. Playwright tiles PNG frames into a labeled HTML strip without image dependencies. Offscreen/zero-size targets and the global max-strips cap are recorded as skips. No-motion screens produce no fabricated strips. Runtime depends on scope and strip count; the fixture registry is intended to finish within about eight minutes per mode.

Validation: `pnpm exec vitest run tests/capture-ui`, `pnpm typecheck`, `pnpm lint:ui`. Tests are browser-free and cover mapping/classification, PR aggregation, motion normalization, reduced-motion filtering, CLI parsing, distinct recipe validation, image identity and coverage matrices.
