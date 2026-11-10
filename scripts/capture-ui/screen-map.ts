export const keyStates = ['default', 'hover', 'focus', 'open', 'empty', 'error', 'loading'] as const;
export type State = typeof keyStates[number];
export type Action = { selector: string; action: 'hover' | 'focus' | 'click' | 'press'; key?: string; optional?: boolean };
export type Recipe = { query?: string; selector?: string; action?: Action['action']; key?: string; steps?: Action[]; api?: 'empty' | 'error' | 'loading'; hold?: string; ready?: string; waitFor?: string; waitMs?: number; skip?: string; optional?: boolean };
export type Screen = { id: string; fixture: string; entry?: string; readyTimeout?: number; retryReadyTimeout?: boolean; page?: string; ready: string; states: Partial<Record<State, Recipe>> };
const interactive = (selector: string): Screen['states'] => ({ default: {}, hover: { selector, action: 'hover' }, focus: { selector, action: 'focus' }, open: { selector, action: 'click' } });
export const screens: Screen[] = [
  { id: 'app-shell', fixture: '', page: '/', ready: '.composer', states: {
    default: {},
    hover: { steps: [{ selector: '[aria-label="Open navigation"]', action: 'click', optional: true }, { selector: '.thread-item', action: 'hover' }], waitMs: 450 },
    focus: { steps: [{ selector: '[aria-label="Open navigation"]', action: 'click', optional: true }, { selector: '.thread-item', action: 'focus' }] },
    open: { steps: [{ selector: '[aria-label="Open navigation"]', action: 'click', optional: true }, { selector: 'button[aria-label="Settings"]', action: 'click' }], waitFor: 'dialog .settings-main, dialog h1' },
    empty: { api: 'empty' }, error: { api: 'error', ready: '[role="alert"]' },
    loading: { api: 'loading', hold: '^/api/bootstrap$', ready: '.workspace-host-bootstrap [role="status"]' },
  } },
  { id: 'workspace', fixture: 'workspace-artifact-shell-fixture.tsx', ready: '[aria-label="Artifact edit"]', states: { default: {}, focus: { selector: '[aria-label="Artifact edit"]', action: 'focus' } } },
  { id: 'agents', fixture: 'agents-workspace-fixture.tsx', ready: 'main', states: { default: {}, empty: { skip: 'Default is already the empty agent inventory' }, error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/agents$', ready: 'main', waitMs: 250 } } },
  { id: 'research', fixture: 'research-workspace-fixture.tsx', ready: 'main', states: { default: {}, empty: { skip: 'Default is already the empty research library' }, error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/research$', waitMs: 250 }, open: { selector: 'button:has-text("Add source")', action: 'click' } } },
  { id: 'code-review', fixture: 'code-review-workspace-fixture.tsx', ready: '[aria-label="Comparison"]', states: { ...interactive('[aria-label="Comparison"]'), error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/projects/', waitMs: 250 } } },
  { id: 'plan', fixture: 'plan-timeline-renderer.tsx', ready: '#root > *', states: { default: {} } },
  { id: 'settings', fixture: 'compact-settings-fixture.tsx', ready: 'dialog, [role="dialog"]', states: { default: {}, open: { skip: 'Fixture starts with Settings open' }, error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/shell/settings$', waitFor: '[role="status"]' } } },
  { id: 'projects', fixture: 'project-picker-fixture.tsx', ready: 'button', states: { ...interactive('button:has-text("Open project picker")'), hover: { selector: '[aria-label="New thread"]', action: 'hover' }, open: { selector: 'button:has-text("Open project picker")', action: 'press', key: 'Enter' } } },
  { id: 'composer', fixture: 'model-composer-refinement-fixture.tsx', ready: 'textarea', states: { default: {}, focus: { selector: 'textarea', action: 'focus' } } },
  { id: 'files', fixture: 'files-reading-fixture.tsx', ready: '#root > *', states: { ...interactive('button:has-text("capture.txt")'), empty: { query: 'no-grants=1', api: 'empty' }, error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/projects/.*/files$', waitMs: 250 } } },
  { id: 'controls', fixture: 'ui-shell-controls-fixture.tsx', ready: 'button', states: { ...interactive('[aria-label="Choice"]'), default: { query: 'primitives=1' }, hover: { query: 'primitives=1', selector: '[aria-label="Choice"]', action: 'hover' }, focus: { query: 'primitives=1', selector: '[aria-label="Choice"]', action: 'focus' }, open: { query: 'primitives=1', selector: '[aria-label="Choice"]', action: 'click' }, error: { query: 'primitives=1&required=1', selector: 'button:has-text("Submit choice")', action: 'click', waitFor: 'text=Choose an option.' } } },
  { id: 'inbox', fixture: 'fixtures/inbox-controls.tsx', page: '/tests/e2e/fixtures/inbox-controls.html', ready: '.ui-list-row', states: interactive('[aria-label="Inbox filter"]') },
  { id: 'graph', fixture: 'fixtures/graph-popovers.tsx', page: '/tests/e2e/fixtures/graph-popovers.html', ready: 'button:has-text("Map modules")', states: { default: {}, hover: { selector: 'button:has-text("Map modules")', action: 'hover', waitFor: '[role="tooltip"]' }, focus: { selector: 'button:has-text("Map modules")', action: 'focus', waitFor: '[role="tooltip"]' }, open: { selector: 'button:has-text("Open diagram")', action: 'click', waitFor: 'dialog' } } },
  { id: 'sidebar-menu', fixture: 'sidebar-shared-menu-fixture.tsx', ready: 'aside', states: { default: {}, hover: { selector: '.thread-item', action: 'hover' }, focus: { selector: '.thread-item', action: 'focus' }, open: { steps: [{ selector: '.thread-item', action: 'hover' }, { selector: 'button[aria-label="Options for Other conversation"]', action: 'click' }] }, empty: { selector: 'button:has-text("Remove threads")', action: 'press', key: 'Enter' }, loading: { api: 'loading', hold: '^/api/projects/', selector: '.thread-item', action: 'focus', waitFor: '.thread-hover-card [role="status"]' } } },
  { id: 'generated-selects', fixture: 'generated-selects-fixture.tsx', ready: '[aria-label="Catalog choice"]', states: interactive('[aria-label="Catalog choice"]') },
  { id: 'saved-layouts', fixture: 'saved-layout-chooser-fixture.tsx', ready: 'button:has-text("Layouts")', states: { ...interactive('button:has-text("Layouts")'), empty: { query: 'empty=1', selector: 'button:has-text("Layouts")', action: 'click' }, error: { query: 'error=1', selector: 'button:has-text("Layouts")', action: 'click' }, loading: { query: 'loading=1', selector: 'button:has-text("Layouts")', action: 'click' } } },
  { id: 'side-chat', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '[aria-label="Side question"]:not([disabled])', states: { default: { query: 'surface=side-chat' } } },
  { id: 'scoped-conversation', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.scoped-owner-composer textarea:not([disabled])', states: { default: { query: 'surface=scoped' } } },
  { id: 'skill-library', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.skill-row', states: { default: { query: 'surface=skills' } } },
  { id: 'task-memory', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.memory-note textarea:not([disabled])', states: { default: { query: 'surface=memory' } } },
  { id: 'connections', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.credential-entry input:not([disabled])', states: { default: { query: 'surface=connections' } } },
  { id: 'draft-transfer', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.draft-transfer', states: { default: { query: 'surface=drafts' } } },
  { id: 'terminal', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.terminal-read:has-text("Ended")', states: { default: { query: 'surface=terminal' } } },
  { id: 'project-context', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.project-context-card:has-text("Audit project")', states: { default: { query: 'surface=project' } } },
  { id: 'workspace-split', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.split-workspace', states: { default: { query: 'surface=split' } } },
  { id: 'delegated-transcript', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '[aria-label="Delegated agent messages"]', states: { default: { query: 'surface=delegated' } } },
  { id: 'plugin-frame', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: 'html[data-plugin-ready="true"]', states: { default: { query: 'surface=plugin' } } },
  { id: 'usage-dialog', fixture: 'usage-context-fixture.tsx', ready: 'button', states: { default: { selector: 'button:has-text("Open Usage")', action: 'click', waitFor: 'dialog' } } },
  { id: 'context-inspector', fixture: 'context-compact-fixture.tsx', ready: 'button', states: { default: { selector: '[aria-label="Inspect context usage"]', action: 'click', waitFor: '.context-inspector' } } },
  { id: 'task-interactions', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.review-item-detail', states: { default: { query: 'surface=interactions' } } },
  { id: 'task-work-objects', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.trace-waterfall [role="treeitem"]', states: { default: { query: 'surface=work-objects' } } },
  { id: 'task-everyday', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.everyday-comparison-table', states: { default: { query: 'surface=everyday' } } },
  { id: 'task-exploration', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.image-annotator img', states: { default: { query: 'surface=exploration' } } },
  { id: 'task-software', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.software-pipeline', states: { default: { query: 'surface=software' } } },
  { id: 'task-media', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.image-compare-stage[data-ready="true"]', states: { default: { query: 'surface=media' } } },
  { id: 'task-document', readyTimeout: 30000, retryReadyTimeout: true, fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.document-preview[data-preview-state="ready"] canvas[width]:not([width="0"])', states: { default: { query: 'surface=document', waitFor: '.signature-pad img' } } },
  { id: 'task-document-window', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.document-text-window textarea:not([readonly])', states: { default: { query: 'surface=document-window' } } },
  { id: 'task-table-disclosure', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.task-table table', states: { default: { query: 'surface=table-disclosure' } } },
];
// Single source for scope rules and the documentation mapping table. All matches accumulate.
export const mapping = [
  { pattern: '^apps/web/src/(App|DesktopEntry|desktop\\.css|main|WorkspaceHost|ShellSidebar|Composer|ModelPicker|LoadingState|ChatScrollIndicator|SentenceReveal|workspace-context|workspace-host|shell-|shell\\.|styles\\.|frontend-fidelity|appearance\\.|loading-state|composer-|model-picker|sentence-reveal|chat-scroll)', screens: ['app-shell'] },
  { pattern: '^apps/web/src/(WorkspaceCanvas|WorkspacePanel|WorkspaceControls|workspace-canvas|workspace-tools)', screens: ['workspace', 'app-shell'] },
  { pattern: '(agents-workspace|agent-inventory)', screens: ['agents'] },
  { pattern: '(ResearchHost|research-host|research-workspace)', screens: ['research'] },
  { pattern: '(code-review|CodeReview|GitPanel)', screens: ['code-review'] },
  { pattern: '(plan-|Plan|SummaryDock)', screens: ['plan'] },
  { pattern: '(Settings|settings|preferences)', screens: ['settings'] },
  { pattern: '(ProjectPicker|project-picker)', screens: ['projects'] },
  { pattern: '(Composer|ModelPicker|composer|model-picker)', screens: ['composer', 'app-shell'] },
  { pattern: '(Files|files-reading|WorkspaceSurfaceBody|^apps/web/src/files/)', screens: ['files'] },
  { pattern: '(InboxView|AgentInbox|agent-inbox)', screens: ['inbox'] },
  { pattern: '(RelationshipGraph|relationship-graph)', screens: ['graph'] },
  { pattern: '(SavedLayoutChooser|saved-layout-chooser)', screens: ['saved-layouts'] },
  { pattern: '(thread-hover|sidebar-shared-menu|sidebar-context)', screens: ['sidebar-menu'] },
  { pattern: '^packages/ui-shell/', screens: screens.map(s => s.id) },
  { pattern: '(ui-shell-controls)', screens: ['controls'] },
  { pattern: '^apps/web/src/registry\\.tsx$', screens: ['generated-selects'] },
  { pattern: '^apps/web/src/(SideChat|FloatingWindow|side-chat|floating-window)', screens: ['side-chat'] },
  { pattern: '(ScopedConversationComposer|conversation-workspace)', screens: ['scoped-conversation'] },
  { pattern: '(InteractionTools|interaction-tools)', screens: ['task-interactions'] },
  { pattern: '(WorkObjects|work-objects)', screens: ['task-work-objects'] },
  { pattern: '(EverydayData|everyday-data)', screens: ['task-everyday'] },
  { pattern: '(ExplorationTools|exploration-tools)', screens: ['task-exploration'] },
  { pattern: '(SoftwareDevelopment|software-development)', screens: ['task-software'] },
  { pattern: '(ImageCompare|MapView|image-compare|map-view)', screens: ['task-media'] },
  { pattern: '(Artifact|artifact-presentation|artifact-frame)', screens: ['task-document', 'task-table-disclosure'] },
  { pattern: '(DocumentPreview|SignaturePad|signature-assets|document-preview|signature-pad)', screens: ['task-document'] },
  { pattern: '(DocumentWindow|document-window)', screens: ['task-document-window'] },
  { pattern: '(TaskTable|TaskDisclosure|task-table|task-disclosure)', screens: ['task-table-disclosure'] },
  { pattern: '(PluginFrame|PluginFloatingWindow|plugin-runtime|plugins\\.css)|^plugins/.*\\.(tsx|css)$', screens: ['plugin-frame'] },
  { pattern: '(Connections|CredentialEntry|GitHubSignIn|UpdateControl|connections\\.|credential-entry|github-sign-in)', screens: ['connections'] },
  { pattern: '(ContextInspector|ContextMeter|context-inspector|context-meter)', screens: ['context-inspector'] },
  { pattern: '(UsageDialog|UsageFooter|usage-dialog)', screens: ['usage-dialog'] },
  { pattern: '(SkillLibrary|skill-library)', screens: ['skill-library'] },
  { pattern: '(TaskMemory|task-memory)', screens: ['task-memory'] },
  { pattern: '(DraftTransfer|draft-transfer)', screens: ['draft-transfer'] },
  { pattern: '(DelegatedAgentTranscript)', screens: ['delegated-transcript'] },
  { pattern: '(ProjectContext|project-context)', screens: ['project-context'] },
  { pattern: '(TerminalBody|terminal-read)', screens: ['terminal'] },
  { pattern: '(WorkspaceSplitLayout|workspace-split|workspace-integration)', screens: ['workspace-split'] },
];
// Every actual browser renderer maps to a demonstrated consumer. Pure helpers
// are nonUi; only native integrations retain per-surface justified exclusions.
export const exclusions = [
  { pattern: '^apps/web/src/DesktopBrowser\\.tsx$', reason: 'Electron WebContents supplies native page pixels; a browser has no harnessDesktop native-view owner', attemptedRoute: 'tests/e2e/native-browser-bounds fixture: browser bridge geometry can be mocked, WebContents pixels cannot' },
  { pattern: '^apps/web/src/(native-chrome)\\.css$', reason: 'Native caption/display CSS belongs to the Electron owner, which is absent from the browser harness', attemptedRoute: 'Real app / and native-browser-bounds fixture; no native titlebar/caption owner exists' },
];
export type FileClassification = { path: string; desktopOnly: boolean; screens: string[]; category: 'screen' | 'excludedWebUi' | 'desktopOnly' | 'nonUi' | 'unmappedWebUi'; reason?: string; attemptedRoute?: string };
export function isRendererFile(path: string) {
  return path.startsWith('apps/web/src/') || /^packages\/(ui-[^/]+|widgets|renderer[^/]*)\//.test(path) || /^plugins\/.*\.(tsx|jsx|css|html)$/.test(path);
}
export function mapFile(path: string): FileClassification {
  path = path.replaceAll('\\', '/');
  if (path.startsWith('apps/desktop/')) return { path, desktopOnly: true, screens: [], category: 'desktopOnly', reason: 'Native Electron owner' };
  if (/\.(md|json|test\.ts|spec\.ts)$/.test(path) || /^(tests|docs|scripts|apps\/server|evals)\//.test(path)) {
    const fixtureScreens = screens.filter(s => s.fixture && path === `tests/e2e/${s.fixture}`).map(s => s.id);
    return { path, desktopOnly: false, screens: fixtureScreens, category: fixtureScreens.length ? 'screen' : 'nonUi' };
  }
  const exclusion = exclusions.find(rule => new RegExp(rule.pattern).test(path));
  if (exclusion) return { path, desktopOnly: false, screens: [], category: 'excludedWebUi', reason: exclusion.reason, attemptedRoute: exclusion.attemptedRoute };
  const matched = [...new Set(mapping.filter(rule => new RegExp(rule.pattern).test(path)).flatMap(rule => rule.screens))];
  if (matched.length && isRendererFile(path)) return { path, desktopOnly: false, screens: matched, category: 'screen' };
  if (/^apps\/web\/src\/.*\.ts$|^apps\/web\/src\/(desktop-context|task-motion)\.tsx$|^packages\/(ui-catalog|widgets)\//.test(path)) return { path, desktopOnly: false, screens: [], category: 'nonUi', reason: 'Non-visual protocol/state/catalog helper' };
  if (isRendererFile(path)) return { path, desktopOnly: false, screens: [], category: 'unmappedWebUi', reason: 'Register a browser capture; a missing recipe is not a justified exclusion' };
  return { path, desktopOnly: false, screens: [], category: 'nonUi' };
}
