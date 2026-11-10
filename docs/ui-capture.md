# UI and motion capture

After `pnpm install` and `pnpm exec playwright install chromium`, run from the repository root:

```sh
pnpm capture:ui                         # default: all = diff ∪ full baseline
pnpm capture:ui -- --scope=diff --out artifacts/ui-capture/review
pnpm capture:ui -- --scope=baseline
pnpm capture:ui -- --screens=graph --max-strips=30
```

Flags accept equals or separate values. Defaults: `--scope=all`, `--since-days=30`, `--max-strips=60`. `--screens` overrides selection. `--out` supplies an exact directory; otherwise output goes to gitignored `artifacts/ui-capture/<UTC timestamp>/`. Use a fresh output directory to avoid stale artifacts.

Local capture owns two Vite servers on available loopback ports: the unchanged `tests/e2e/vite.config.ts` serves the real app shell at `/`, and the capture config mounts existing fixtures and tooling-owned consumers of production components. Each invocation gives these servers separate temporary optimizer caches: their different roots otherwise resolve to the same `node_modules/.vite`, allowing one optimizer to replace the other server's chunks. The caches also stay separate across concurrent captures and are deleted after server cleanup. All contexts, Chromium and servers are closed with independent closers and a 10-second deadline per closer, so rejection or a stalled closer cannot prevent other cleanup attempts. Cleanup failures are fatal. No app, CSS, existing test or existing fixture is modified.

`BASE_URL=https://preview.example pnpm capture:ui` uses a pre-existing origin instead. That origin must serve `/`, the registered fixture paths and capture entries with their imports. A production app alone does not supply fixture routes. API data remains synthetic. External HTTP(S) and WebSocket origins are blocked; same-origin Vite HMR is allowed. Service workers are blocked, including in the opaque plugin fixture (with a guarded registration blocker because Playwright's built-in blocker throws on opaque frames). No account/token is read, entered or authenticated.

## Registry and real renderer coverage

`screen-map.ts` is the executable registry, mapping table and native-exclusion source. It includes the real app shell; original workspace/agents/research/review/plan/settings/project/composer/files/control fixtures; inbox/graph/sidebar/generated-select/layout fixtures; SideChat and scoped conversation with the real composer/reader; usage/context/skills/memory/connections/credential/GitHub sign-in consumers; project context, draft transfer, terminal, delegated transcript and split layout; and nine task/document/media galleries using the real Artifact, trusted registry and synthetic source data.

The task galleries render InteractionTools, WorkObjects, EverydayData, ExplorationTools, SoftwareDevelopment, TaskTable/TaskDisclosure, ImageCompare/MapView, a real PDF with SignaturePad, and an editable DocumentWindow. Synthetic PDF/PNG/SVG bytes are generated locally using installed libraries. Personal Visuals renders inside the actual PluginFrame sandbox through the real public runtime, production frontend and PluginFloatingWindow. A script response remains pending until RPC proves the parent accepted the frame's port, matching the installed package's runtime-before-UI ordering without racing iframe load. These are browser fixture captures, not provider or packaged desktop acceptance.

Every registry screen declares all seven key states, each with a real recipe or an explicit, surface-specific `skip` reason. Every recipe runs at 375/768/1440px width and 1000px height, then repeats motion collection under reduced motion. Up to six viewport jobs run concurrently across the registry; states remain ordered within each job so default-image comparisons stay valid. Each job has a separate strip tiler, all jobs settle even after a failure, and a shared reservation count enforces `max-strips`. App-shell has all seven key states. API loading recipes hold their data response unresolved through screenshot and motion capture; `heldRequests` in manifest is evidence. Synchronous fixtures use existing query/props recipes or declare a loading skip. The newer consumers expose real button, input, disclosure and menu interactions; empty variants retain schema-valid source data. Command-based loading recipes hold `/api/commands`; document windows read a synthetic granted text resource. Usage/context variants dispatch the existing fixture event to change production component props. Draft-reference and split-command consumers supply host promises that can fail or await a held local route. Empty non-default recipes are rejected. Agents/research already default to empty, and the Settings fixture already starts open, so those duplicate recipes are declared skips.

Motion is collected from **every `page.frames()` document**, including sandboxed plugin iframes. A context init script installs the tracked-animation sampler in every newly attached or navigated frame. Each motion row has a `frame` column (`main` or a stable frame-tree index and URL pathname, excluding volatile ports/query parameters); it appears in motion.md and reduced-motion.md and participates in motion/strip deduplication. Frame-local animation handles are sought at 0/50/100%; Playwright translates their bounds through containing iframes into the main viewport for padded strip clips. Detached targets or strip sampling errors remain fatal, with explicit reasons. The pure `verifyCaptureOutputs` check runs against the output payloads before exit status is decided. An in-scope plugin-frame must have non-main rows in motion.json, at least one captured iframe strip, and non-main rows in reduced-motion.json records. It also retains strip-to-motion correspondence checks. One strip slot is reserved for the plugin within the existing cap; `--max-strips=0` with plugin-frame in scope therefore fails the required evidence check.

For the 22 WO-1.1b additions (the explicit `requiredOutputScreenIds` list in screen-map.ts), output verification checks every selected screen × seven states × 375/768/1440. Each cell needs a normal-pass captured/identical outcome or a skipped outcome with a non-empty reason; missing cells cannot be covered by reduced-only or duplicate entries. Verification failures become fatal F errors in manifest/index, alongside the existing action/load/cleanup failures. `manifest.outputCheck` and the index “Output checks” section expose the result.

PNG SHA-256 is compared against default at the same width. Equal bytes receive `identical-to-default`, retain the diagnostic PNG, and do not count as captured. Hover/focus actions that do not change visible pixels therefore cannot inflate coverage.

Navigation waits for `load` (or DOM content for held loading responses), then the declared ready selector. A navigation timeout retries once using DOM content. The PDF screen alone has a 30-second rendered-canvas readiness budget and one reload after a readiness timeout; a second timeout or any non-timeout error still fails. Other readiness/action failures do not retry. The actual `data-preview-state="ready"` canvas condition is unchanged. Recovery attempts are listed in `manifest.readinessRetries` and counted in index. Fixture navigation never relies on `networkidle`.

Before capture, the fixture server pre-bundles `pdf-lib` and the PDF.js display module, scans registered middleware entries plus the draft worker, and transforms DocumentPreview, the draft worker, and the PDF.js worker. This avoids discovering worker dependencies late and reloading a PDF page midway through rendering. Warmup has a 60-second deadline; a transform failure or timeout is fatal. The post-action animation-frame wait and each frame motion evaluation have a 5-second deadline; timeout is recorded as an F failure.

To add a screen, reuse a fixture or add a consumer under `scripts/capture-ui/`, provide an actual component readiness selector and a default recipe. Declare every key state with a real query/API/action/fixture-event recipe or `skip: 'specific reason'`. The registry type and unit test require all seven declarations. `steps` may use hover/focus/click/press/fill and an optional iframe CSS selector in `frame`; supported variants must target actual production controls. Shared setup (for example opening Usage) is repeated before each state action. `entry` selects a tooling-owned TSX consumer. Set `optional: true` only for a deliberately optional whole state; it is distinct from an optional mobile-navigation action. Add renderer mapping rules and test classification. A missing browser recipe is an unmapped renderer failure, not a justification for exclusion.

## Scope discovery and classification

All and diff query `gh pr list --state merged --base main --search "merged:>=<UTC date>" --json number,title,mergedAt,files` (limit 1000 with a saturation warning). Baseline and explicit `--screens` skip history discovery and work without git or gh. Without gh, **all first-parent commits** on existing `origin/main` since UTC midnight are walked together, including merge and squash commits. Subjects `Merge pull request #123` and `... (#123)` supply PR numbers; ordinary commits have null numbers. Each commit is diffed explicitly against its first parent. No fetch is performed.

All and diff also always append **`current branch <name>`**, number null, with the observation timestamp. Its files union `git diff --name-only origin/main...HEAD`, unstaged, staged and untracked files. A gh failure is a warning only when git fallback succeeds. Failed git history/commit-file discovery or any current-branch source (including `origin/main...HEAD`) throws before capture starts; incomplete scope never succeeds silently. Use baseline or an explicit screen override for a git-independent capture. The injectable command runner and pure parsers have browser-free unit tests.

Changed files become `screen`, `nonUi`, `desktopOnly`, `excludedWebUi` (justified native surfaces only), or `unmappedWebUi` (fatal missing coverage). Protocol/state/API/catalog helpers, tests, docs, scripts, server, core and Python are non-UI. `scope.json` retains per-PR classifications and unique aggregate paths. `scope.md` has PRs → screens, **Justified exclusions** (file, reason, attempted route), non-UI count and desktop-only files. DesktopBrowser requires Electron WebContents; the updater renders its real browser fallback in the connections consumer; native caption/display pixels have no browser owner. Browser-reachable dialogs and task renderers are captured rather than excluded.

| File path regex | Screens |
| --- | --- |
| `^apps/web/src/(App\|DesktopEntry\|desktop\.css\|main\|WorkspaceHost\|ShellSidebar\|Composer\|ModelPicker\|LoadingState\|ChatScrollIndicator\|SentenceReveal\|workspace-context\|workspace-host\|shell-\|shell\.\|styles\.\|frontend-fidelity\|appearance\.\|loading-state\|composer-\|model-picker\|sentence-reveal\|chat-scroll)` | app-shell |
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
| `^packages/ui-shell/` | All registered screens |
| `(ui-shell-controls)` | controls |
| `^apps/web/src/registry\.tsx$` | generated-selects |
| `^apps/web/src/(SideChat\|FloatingWindow\|side-chat\|floating-window)` | side-chat |
| `(ScopedConversationComposer\|conversation-workspace)` | scoped-conversation |
| `(InteractionTools\|interaction-tools)` | task-interactions |
| `(WorkObjects\|work-objects)` | task-work-objects |
| `(EverydayData\|everyday-data)` | task-everyday |
| `(ExplorationTools\|exploration-tools)` | task-exploration |
| `(SoftwareDevelopment\|software-development)` | task-software |
| `(ImageCompare\|MapView\|image-compare\|map-view)` | task-media |
| `(Artifact\|artifact-presentation\|artifact-frame)` | task-document, task-table-disclosure |
| `(DocumentPreview\|SignaturePad\|signature-assets\|document-preview\|signature-pad)` | task-document |
| `(DocumentWindow\|document-window)` | task-document-window |
| `(TaskTable\|TaskDisclosure\|task-table\|task-disclosure)` | task-table-disclosure |
| `(PluginFrame\|PluginFloatingWindow\|plugin-runtime\|plugins\.css)\|^plugins/.*\.(tsx\|css)$` | plugin-frame |
| `(Connections\|CredentialEntry\|GitHubSignIn\|UpdateControl\|connections\.\|credential-entry\|github-sign-in)` | connections |
| `(ContextInspector\|ContextMeter\|context-inspector\|context-meter)` | context-inspector |
| `(UsageDialog\|UsageFooter\|usage-dialog)` | usage-dialog |
| `(SkillLibrary\|skill-library)` | skill-library |
| `(TaskMemory\|task-memory)` | task-memory |
| `(DraftTransfer\|draft-transfer)` | draft-transfer |
| `(DelegatedAgentTranscript)` | delegated-transcript |
| `(ProjectContext\|project-context)` | project-context |
| `(TerminalBody\|terminal-read)` | terminal |
| `(WorkspaceSplitLayout\|workspace-split\|workspace-integration)` | workspace-split |

| Native exclusion regex | Reason | Attempted route |
| --- | --- | --- |
| `^apps/web/src/DesktopBrowser\.tsx$` | Electron WebContents supplies native page pixels; a browser has no harnessDesktop native-view owner | tests/e2e/native-browser-bounds fixture: browser bridge geometry can be mocked, WebContents pixels cannot |
| `^apps/web/src/(native-chrome)\.css$` | Native caption/display CSS belongs to the Electron owner, which is absent from the browser harness | Real app / and native-browser-bounds fixture; no native titlebar/caption owner exists |

## Outputs and exit status

```text
scope.json / scope.md
screenshots/<screen>/<state>-<width>.png
motion.json / motion.md
strips/<number>-<screen>.png
reduced-motion.json / reduced-motion.md
manifest.json / index.md
```

Index contains the screen × seven-state matrix, detailed outcomes/reasons and an explicit failures section. Cells show captured widths or `U` declared unsupported/skip, `E` empty recipe, `I` identical, `F` post-load failure, `L` load failure. Totals include screens, captured/identical screenshots, motion rows/unique signatures, strips, reduced-motion offenders unique/total and elapsed seconds.

**Exit nonzero:** any load/readiness error, post-load action or screenshot error, reduced-motion pass failure/timeout, strip capture error, missing strip-to-motion correspondence, unmapped renderer, or context/browser/server cleanup rejection. Errors remain in `manifest.failures`, with `failed: true`, and index. Declared skips, explicitly optional state failures, identical images and the max-strips cap do not fail the run. A final strip self-check verifies that every captured strip's `motionKey` exists in motion.json with matching screen/state/width/selector.

## Motion and frames

A requestAnimationFrame sampler retains document animations from before actions through after them. Load, triggered and pre-strip observations are normalized and merged by state/width/signature, so short completed action animations are retained in the table as well as strips. Detached/cancelled effects no longer represent document motion and are omitted. Rows include target path, type/name/property, animated properties, duration, delay, easing, iterations, fill and keyframes. Reduced-motion offenders have duration >1ms and positive iterations; findings are reported rather than treated as capture errors. Output verification requires each such record in the offenders payload with the same frame, state, width and animation signature. reduced-motion.md now shows both “Offenders” and “All recorded animations” tables with the frame column, so effectively instant iframe motion remains visible even when it is not an offender.

Strips dedupe signatures across state/viewport. Targets are scrolled into view, all captured animations (including finished no-fill effects) are paused, then sought to 0/50/100% of active duration (one iteration for infinite animation). A padded clip is captured and the three labeled frames are tiled by Playwright. No image dependency is added. A cap skip is explicit; any other strip error is fatal.

Verify with `pnpm exec vitest run tests/capture-ui`, `pnpm typecheck`, `pnpm lint:ui`, and a diff capture. Helper tests cover mixed git history/current branch, exit rules, motion merge/correspondence, resilient cleanup, timeout-only retries, isolated optimizer caches, PDF warmup/readiness recovery, operation/cleanup deadlines, bounded job scheduling, frame tags/dedupe/clips/coverage, output-level iframe/strip/reduced-motion evidence and all 22 screens’ state/width completeness, complete state declarations, strict git discovery, WebSocket origins, UI mapping, state identity and synthetic datasets.
