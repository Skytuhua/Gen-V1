export const keyStates = ['default', 'hover', 'focus', 'open', 'empty', 'error', 'loading'] as const;
export type State = typeof keyStates[number];
export type Action = { selector: string; action: 'hover' | 'focus' | 'click' | 'press'; key?: string; optional?: boolean };
export type Recipe = { query?: string; selector?: string; action?: Action['action']; key?: string; steps?: Action[]; api?: 'empty' | 'error' | 'loading'; hold?: string; ready?: string; waitFor?: string; waitMs?: number; skip?: string };
export type Screen = { id: string; fixture: string; page?: string; ready: string; states: Partial<Record<State, Recipe>> };
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
];
// Single source for scope rules and the documentation mapping table. All matches accumulate.
export const mapping = [
  { pattern: '^apps/web/src/(App|DesktopEntry|main|WorkspaceHost|ShellSidebar|Composer|ModelPicker|LoadingState|ChatScrollIndicator|SentenceReveal|workspace-context|workspace-host|shell-|shell\\.|styles\\.|frontend-fidelity|appearance\\.|loading-state|composer-|model-picker|sentence-reveal|chat-scroll)', screens: ['app-shell'] },
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
];
// Exclusions take priority over mapping rules, including CSS named after excluded renderers.
// Optional surfaces must not be claimed as covered simply because App imports them.
export const exclusions = [
  { pattern: '^apps/web/src/(DesktopBrowser|FloatingWindow|PluginFloatingWindow|UpdateControl|native-chrome|floating-window|desktop\\.css)', reason: 'desktop-only: native WebContents/window/update surface requires Electron' },
  { pattern: '^apps/web/src/(SideChat|side-chat|ScopedConversationComposer|conversation-workspace/)', reason: 'No standalone registered fixture: scoped/side conversations require a separate conversation protocol dataset' },
  { pattern: '^apps/web/src/(InteractionTools|WorkObjects|interaction-tools)', reason: 'No standalone registered fixture: spec-built task components require typed task datasets and actions' },
  { pattern: '^apps/web/src/(Artifact|Document|document-preview|Signature|signature-assets|TaskDisclosure|TaskTable|task-table|ImageCompare|MapView|map-view|EverydayData|ExplorationTools|exploration-tools|SoftwareDevelopment)', reason: 'No registered document/media/task fixture: requires supplied artifact data, assets or export bindings' },
  { pattern: '^apps/web/src/(PluginFrame|plugin-runtime|plugins\\.css)|^plugins/.*\\.(tsx|jsx|css|html)$', reason: 'No registered isolated plugin fixture; installed plugin renderer is not mounted by shell baseline' },
  { pattern: '^apps/web/src/(CredentialEntry|GitHubSignIn|Connections|github-sign-in|connections\\.)', reason: 'No authenticated account/native credential fixture; shell capture uses synthetic model metadata only' },
  { pattern: '^apps/web/src/(ContextInspector|ContextMeter|TaskMemory|task-memory|context-inspector|UsageDialog|UsageFooter|usage-dialog|ProjectContext|project-context|TerminalBody|terminal-read|DraftTransfer|draft-transfer|SkillLibrary|DelegatedAgentTranscript|WorkspaceSplitLayout|workspace-split|workspace-integration)', reason: 'Optional tool/dialog renderer is not mounted by a registered capture recipe' },
  { pattern: '^apps/web/src/.*\\.ts$|^apps/web/src/(desktop-context|focus|task-motion|useAppearance)\\.tsx$', reason: 'Non-visual API/state/layout/motion helper; no standalone visual surface' },
  { pattern: '^packages/ui-catalog/|^packages/widgets/', reason: 'Non-visual catalog/protocol module; requires a separate rendered artifact fixture' },
];
export type FileClassification = { path: string; desktopOnly: boolean; screens: string[]; category: 'screen' | 'excludedWebUi' | 'desktopOnly' | 'nonUi'; reason?: string };
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
  if (exclusion && isRendererFile(path)) return { path, desktopOnly: false, screens: [], category: 'excludedWebUi', reason: exclusion.reason };
  const matched = [...new Set(mapping.filter(rule => new RegExp(rule.pattern).test(path)).flatMap(rule => rule.screens))];
  if (matched.length && isRendererFile(path)) return { path, desktopOnly: false, screens: matched, category: 'screen' };
  if (isRendererFile(path)) return { path, desktopOnly: false, screens: [], category: 'excludedWebUi', reason: 'Unregistered renderer: no reachable registered web fixture/recipe; requires explicit capture work' };
  return { path, desktopOnly: false, screens: [], category: 'nonUi' };
}
