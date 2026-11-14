export const keyStates = ['default', 'hover', 'focus', 'open', 'empty', 'error', 'loading'] as const;
export const captureWidths = [375, 768, 1024, 1440] as const;
// WO-1.1b renderer additions: these require output-level state coverage, not
// merely a registry mapping. Keep this explicit so reordering cannot hide one.
export const requiredOutputScreenIds = [
  'side-chat', 'scoped-conversation', 'skill-library', 'task-memory', 'connections',
  'draft-transfer', 'terminal', 'project-context', 'workspace-split', 'delegated-transcript',
  'plugin-frame', 'usage-dialog', 'context-inspector', 'task-interactions', 'task-work-objects',
  'task-everyday', 'task-exploration', 'task-software', 'task-media', 'task-document',
  'task-document-window', 'task-table-disclosure',
  'project-search', 'saved-drafts', 'terminal-excerpts', 'conversation-find', 'file-checkpoints', 'redundant-ui',
] as const;
export type State = typeof keyStates[number];
export type Action = { selector: string; action: 'hover' | 'focus' | 'click' | 'press' | 'fill'; key?: string; value?: string; frame?: string; optional?: boolean };
export type Recipe = { query?: string; selector?: string; action?: Action['action']; key?: string; value?: string; frame?: string; steps?: Action[]; event?: {name: string; detail: string}; api?: 'empty' | 'error' | 'loading'; hold?: string; ready?: string; waitFor?: string; waitMs?: number; skip?: string; optional?: boolean };
export type Screen = { id: string; fixture: string; entry?: string; readyTimeout?: number; retryReadyTimeout?: boolean; page?: string; ready: string; states: Record<State, Recipe> };
const interactive = (selector: string): Pick<Screen['states'], 'default' | 'hover' | 'focus' | 'open'> => ({ default: {}, hover: { selector, action: 'hover' }, focus: { selector, action: 'focus' }, open: { selector, action: 'click' } });
const skip = (reason: string): Recipe => ({skip: reason});
// Recipes inherit the actual default setup (including opening a dialog), then
// act on its production controls. Every data-state decision is explicit below.
function surfaceStates(base: Recipe, target: string, open: Recipe, data: Record<'empty' | 'error' | 'loading', Recipe>, frame?: string): Screen['states'] {
  const extend = (extra: Recipe): Recipe => ({...base, ...extra,
    query: [base.query, extra.query].filter(Boolean).join('&') || undefined,
    steps: extra.steps?.length===0?[]:[...(base.steps ?? []), ...(extra.steps ?? (extra.selector && extra.action ? [{selector: extra.selector, action: extra.action, key: extra.key, frame: extra.frame}] : []))],
  });
  const action = (kind: Action['action']): Recipe => extend({steps: [{selector: target, action: kind, frame}]});
  return {default: base, hover: action('hover'), focus: action('focus'), open: extend(open), empty: extend(data.empty), error: extend(data.error), loading: extend(data.loading)};
}
export const screens: Screen[] = [
  { id: 'app-shell', readyTimeout:30000,retryReadyTimeout:true, fixture: '', page: '/', ready: '.composer', states: {
    default: {},
    hover: { steps: [{ selector: '[aria-label="Open navigation"]', action: 'click', optional: true }, { selector: '.thread-item', action: 'hover' }], waitMs: 450 },
    focus: { steps: [{ selector: '[aria-label="Open navigation"]', action: 'click', optional: true }, { selector: '.thread-item', action: 'focus' }] },
    open: { steps: [{ selector: '[aria-label="Open navigation"]', action: 'click', optional: true }, { selector: 'button[aria-label="Settings"]', action: 'click' }], waitFor: 'dialog .settings-main, dialog h1' },
    empty: { api: 'empty' }, error: { api: 'error', ready: '[role="alert"]' },
    loading: { api: 'loading', hold: '^/api/bootstrap$', ready: '.workspace-host-bootstrap [role="status"]' },
  } },
  { id: 'workspace', fixture: 'workspace-artifact-shell-fixture.tsx', ready: '[aria-label="Artifact edit"]', states: {hover: {selector: '[aria-label="Artifact edit"]', action: 'hover'}, open: skip('The artifact panel is already expanded in default; its consumer has no separate artifact dialog.'), empty: skip('Artifact custody fixture always supplies one canvas panel and has no empty query or data setter.'), error: skip('Artifact custody updates are local callbacks without a request or rejection variant.'), loading: skip('Artifact custody fixture mounts synchronous local state without a pending data boundary.'),  default: {}, focus: { selector: '[aria-label="Artifact edit"]', action: 'focus' } } },
  { id: 'agents', fixture: 'agents-workspace-fixture.tsx', ready: 'main', states: {hover: {selector: '[aria-label="Project filter"]', action: 'hover'}, focus: {selector: '[aria-label="Project filter"]', action: 'focus'}, open: {selector: '[aria-label="Status filter"]', action: 'click', waitFor: '[role="listbox"]'},  default: {}, empty: { skip: 'Default is already the empty agent inventory' }, error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/agents$', ready: 'main', waitMs: 250 } } },
  { id: 'research', fixture: 'research-workspace-fixture.tsx', ready: 'main', states: {hover: {selector: 'button:has-text("Add source")', action: 'hover'}, focus: {selector: 'button:has-text("Add source")', action: 'focus'},  default: {}, empty: { skip: 'Default is already the empty research library' }, error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/research$', waitMs: 250 }, open: { selector: 'button:has-text("Add source")', action: 'click' } } },
  { id: 'code-review', fixture: 'code-review-workspace-fixture.tsx', ready: '[aria-label="Comparison"]', states: {empty: skip('The comparison fixture always supplies a project and fixed comparison; there is no empty-source query.'),  ...interactive('[aria-label="Comparison"]'), error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/projects/', waitMs: 250 } } },
  { id: 'plan', fixture: 'plan-timeline-renderer.tsx', ready: '#root > *', states: {hover: {selector: '.plan-step-summary', action: 'hover'}, focus: {selector: '.plan-step-summary', action: 'focus'}, open: skip('All plan steps and agent lanes are expanded in default; this fixture has no separate plan-action menu.'), empty: skip('Timeline fixture supplies a fixed non-empty plan and no empty-plan query.'), error: skip('Timeline fixture passes synchronous plan props with no error prop variant or data request.'), loading: skip('Timeline fixture passes a ready snapshot; it does not expose PlanStatus loading prop.'),  default: {} } },
  { id: 'settings', fixture: 'compact-settings-fixture.tsx', ready: 'dialog, [role="dialog"]', states: {hover: {selector: 'dialog button:not([disabled])', action: 'hover'}, focus: {selector: 'dialog button:not([disabled])', action: 'focus'}, empty: skip('Settings has fixed preference sections; empty collections are covered by their own registry screens.'),  default: {}, open: { skip: 'Fixture starts with Settings open' }, error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/shell/settings$', waitFor: '[role="status"]' } } },
  { id: 'projects', fixture: 'project-picker-fixture.tsx', ready: 'button', states: {empty: {steps: [{selector: 'button:has-text("Open project picker")', action: 'press', key: 'Enter'}, {selector: '[aria-label="Search projects"]', action: 'fill', value: 'no-project-matches-capture'}], waitFor: '.project-picker-empty'}, error: {query: 'fail=1', steps: [{selector: 'button:has-text("Open project picker")', action: 'press', key: 'Enter'}, {selector: '[role="option"]', action: 'click'}], waitFor: '[role="alert"]'}, loading: skip('Picker selection uses a fixed 100ms fixture callback with no holdable fetch or loading query.'),  ...interactive('button:has-text("Open project picker")'), hover: { selector: '[aria-label="New thread"]', action: 'hover' }, open: { selector: 'button:has-text("Open project picker")', action: 'press', key: 'Enter' } } },
  { id: 'composer', fixture: 'model-composer-refinement-fixture.tsx', ready: 'textarea', states: {hover: {selector: '[aria-label="Model"]', action: 'hover'}, open: {selector: '[aria-label="Model"]', action: 'click', waitFor: '[aria-label="Search models"]'}, empty: skip('Default composer already has an empty draft; the fixture model inventory is fixed.'), error: skip('Composer refinement fixture has synchronous local submit callbacks and no rejection variant.'), loading: skip('Composer refinement fixture mounts supplied models synchronously with no pending request.'),  default: {}, focus: { selector: 'textarea', action: 'focus' } } },
  { id: 'files', fixture: 'files-reading-fixture.tsx', ready: '#root > *', states: { ...interactive('button:has-text("capture.txt")'), empty: { query: 'no-grants=1', api: 'empty' }, error: { api: 'error' }, loading: { api: 'loading', hold: '^/api/projects/.*/files$', waitMs: 250 } } },
  { id: 'controls', fixture: 'ui-shell-controls-fixture.tsx', ready: 'button', states: {empty: skip('Primitive controls have fixed options and an initially empty selection; there is no separate empty inventory.'), loading: skip('Primitive controls fixture is synchronous and has no data-fetch boundary.'),  ...interactive('[aria-label="Choice"]'), default: { query: 'primitives=1' }, hover: { query: 'primitives=1', selector: '[aria-label="Choice"]', action: 'hover' }, focus: { query: 'primitives=1', selector: '[aria-label="Choice"]', action: 'focus' }, open: { query: 'primitives=1', selector: '[aria-label="Choice"]', action: 'click' }, error: { query: 'primitives=1&required=1', selector: 'button:has-text("Submit choice")', action: 'click', waitFor: 'text=Choose an option.' } } },
  { id: 'inbox', fixture: 'fixtures/inbox-controls.tsx', page: '/tests/e2e/fixtures/inbox-controls.html', ready: '.ui-list-row', states: {empty: skip('Inbox controls fixture has fixed row props; it exposes no empty inventory query.'), error: skip('Inbox controls fixture has local filter callbacks and no API/error prop variant.'), loading: skip('Inbox controls fixture supplies all rows synchronously; no loading request exists.'), ...interactive('[aria-label="Inbox filter"]')} },
  { id: 'graph', fixture: 'fixtures/graph-popovers.tsx', page: '/tests/e2e/fixtures/graph-popovers.html', ready: 'button:has-text("Map modules")', states: {empty: skip('Graph popover fixture supplies a fixed graph and no empty graph query.'), error: skip('Graph popover fixture has no asynchronous graph request or error prop variant.'), loading: skip('Graph popover fixture mounts synchronous graph props without a pending boundary.'),  default: {}, hover: { selector: 'button:has-text("Map modules")', action: 'hover', waitFor: '[role="tooltip"]' }, focus: { selector: 'button:has-text("Map modules")', action: 'focus', waitFor: '[role="tooltip"]' }, open: { selector: 'button:has-text("Open diagram")', action: 'click', waitFor: 'dialog' } } },
  { id: 'sidebar-menu', fixture: 'sidebar-shared-menu-fixture.tsx', ready: 'aside', states: {error: {api: 'error', steps: [{selector: '.thread-item', action: 'focus'}], waitFor: '.thread-hover-error'},  default: {}, hover: { selector: '.thread-item', action: 'hover' }, focus: { selector: '.thread-item', action: 'focus' }, open: { steps: [{ selector: 'button[aria-label="Options for Other conversation"]', action: 'focus' }, { selector: 'button[aria-label="Options for Other conversation"]', action: 'press', key: 'ArrowDown' }], waitFor: '[role="menu"]' }, empty: { selector: 'button:has-text("Remove threads")', action: 'press', key: 'Enter' }, loading: { api: 'loading', hold: '^/api/projects/', selector: '.thread-item', action: 'focus', waitFor: '.thread-hover-card [role="status"]' } } },
  { id: 'generated-selects', fixture: 'generated-selects-fixture.tsx', ready: '[aria-label="Catalog choice"]', states: {empty: skip('Generated controls fixture has fixed option lists and an empty default selection.'), error: skip('Generated controls fixture does not submit commands or expose an error-data variant.'), loading: skip('Generated controls fixture loads no asynchronous inventory.'), ...interactive('[aria-label="Catalog choice"]')} },
  { id: 'saved-layouts', fixture: 'saved-layout-chooser-fixture.tsx', ready: 'button:has-text("Layouts")', states: { ...interactive('button:has-text("Layouts")'), empty: { query: 'empty=1', selector: 'button:has-text("Layouts")', action: 'click' }, error: { query: 'error=1', selector: 'button:has-text("Layouts")', action: 'click' }, loading: { query: 'loading=1', selector: 'button:has-text("Layouts")', action: 'click' } } },
  { id: 'side-chat', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '[aria-label="Side question"]:not([disabled])', states: surfaceStates({query: 'surface=side-chat'}, '[aria-label="New side conversation"]', {selector: '[aria-label="Side conversation history"]', action: 'click', waitFor: '[role="listbox"]'}, {
    empty: {query: 'variant=empty', api: 'empty', waitFor: '.side-chat-empty'},
    error: {api: 'error', steps: [{selector: '[aria-label="Side question"]', action: 'fill', value: 'Synthetic side question'}, {selector: '[aria-label="Side question"]', action: 'press', key: 'Enter'}], waitFor: '.side-chat [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/commands$', steps: [{selector: '[aria-label="Side question"]', action: 'fill', value: 'Synthetic side question'}, {selector: '[aria-label="Side question"]', action: 'press', key: 'Enter'}], waitFor: '.side-chat-composer .spinning'},
  }) },
  { id: 'scoped-conversation', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.scoped-owner-composer textarea:not([disabled])', states: surfaceStates({query: 'surface=scoped'}, '[aria-label="Model"]', {selector: '[aria-label="Model"]', action: 'click', waitFor: '[aria-label="Search models"]'}, {
    empty: {api: 'empty', waitFor: 'text=No messages yet.'},
    error: {api: 'error', ready: '.scoped-conversation [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/conversations/', ready: '.scoped-conversation [role="status"]'},
  }) },
  { id: 'skill-library', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.skill-row', states: surfaceStates({query: 'surface=skills'}, '[aria-label="Inspect capture-review"]', {selector: '[aria-label="Inspect capture-review"]', action: 'click', waitFor: '[aria-label="Instructions for capture-review"]'}, {
    empty: {query: 'variant=empty', api: 'empty', ready: '.skill-library', waitFor: '.skill-empty'},
    error: {api: 'error', steps: [{selector: '[aria-label="Inspect capture-review"]', action: 'click'}], waitFor: '.skill-editor [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/skills/capture-review$', steps: [{selector: '[aria-label="Inspect capture-review"]', action: 'click'}], waitFor: '.skill-editor [role="status"]'},
  }) },
  { id: 'task-memory', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.memory-note textarea:not([disabled])', states: surfaceStates({query: 'surface=memory'}, '[aria-label="Add memory note"]', {selector: '[aria-label="Add memory note"]', action: 'click', waitFor: 'input[placeholder="e.g. date-format"]'}, {
    empty: {query: 'variant=empty', api: 'empty', ready: '.task-memory', waitFor: 'text=No saved notes.'},
    error: {api: 'error', steps: [{selector: 'button:has-text("Save note")', action: 'click'}], waitFor: '.memory-note [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/commands$', steps: [{selector: 'button:has-text("Save note")', action: 'click'}], waitFor: 'button:has-text("Saving")'},
  }) },
  { id: 'connections', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.credential-entry input:not([disabled])', states: surfaceStates({query: 'surface=connections'}, '[aria-label="Show token"]', {selector: 'button:has-text("Add account")', action: 'click', waitFor: '[aria-label="Account label"]'}, {
    empty: skip('Default already has no provider accounts and no saved credential; there is no distinct empty inventory.'),
    error: {api: 'error', ready: '.credential-entry [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/artifacts/.*/credentials/', ready: '.credential-entry input:disabled'},
  }) },
  { id: 'draft-transfer', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.draft-transfer', states: surfaceStates({query: 'surface=drafts'}, 'button:has-text("Export local drafts")', {selector: 'button:has-text("Export local drafts")', action: 'click', waitFor: '.draft-transfer [role="status"]'}, {
    empty: skip('A fresh browser context already has no local drafts; exporting that inventory is the open recipe.'),
    error: {query: 'variant=error', steps: [{selector: 'button:has-text("Export local drafts")', action: 'click'}], waitFor: '.draft-transfer [role="alert"]'},
    loading: {query: 'variant=loading', api: 'loading', hold: '^/api/capture/draft-references$', steps: [{selector: 'button:has-text("Export local drafts")', action: 'click'}], waitFor: '.draft-transfer button:disabled'},
  }) },
  { id: 'terminal', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.terminal-read:has-text("Ended")', states: surfaceStates({query: 'surface=terminal'}, 'button:has-text("New terminal")', {selector: 'button:has-text("New terminal")', action: 'click', waitFor: '[data-terminal-id="capture-terminal-second"] .terminal-read:has-text("Ended")'}, {
    empty: {query: 'variant=empty', api: 'empty'},
    error: {api: 'error', ready: '.terminal-read [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/terminals(?:/|$)', ready: '.terminal-read [role="status"]'},
  }) },
  { id: 'project-context', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.project-context-card:has-text("Audit project")', states: surfaceStates({query: 'surface=project'}, '.project-context-tools > summary', {selector: '.project-context-tools > summary', action: 'click', waitFor: '.project-context-tools[open]'}, {
    empty: {query: 'variant=empty', api: 'empty', ready: 'text=No project connected.'},
    error: {api: 'error', ready: '.project-context-card [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/projects/.*/context$', ready: '.project-context-card [role="status"]'},
  }) },
  { id: 'workspace-split', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '.split-workspace', states: surfaceStates({query: 'surface=split'}, '[aria-label="Area actions"]', {selector: '[aria-label="Area actions"]', action: 'click', waitFor: '[role="menu"]'}, {
    empty: skip('The default split layout is already an empty area with no view tabs; no distinct empty state exists.'),
    error: {query: 'variant=error', steps: [{selector: '[aria-label="Minimize area"]', action: 'click'}], waitFor: '.split-layout-error'},
    loading: {query: 'variant=loading', api: 'loading', hold: '^/api/capture/split$', steps: [{selector: '[aria-label="Minimize area"]', action: 'click'}], waitFor: '[aria-label="Area actions"]:disabled'},
  }) },
  { id: 'delegated-transcript', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: '[aria-label="Delegated agent messages"]', states: surfaceStates({query: 'surface=delegated'}, '.plan-agent-summary', {selector: '[aria-label^="Open transcript for"]', action: 'click', waitFor: '.plan-agent-transcript'}, {
    empty: {query: 'variant=empty', ready: '.plan-agent-summary'}, error: {query: 'variant=error', ready: '[role="alert"]'},
    loading: skip('DelegatedAgentTranscript reads supplied plan/messages synchronously; it has no pending prop or fetch boundary.'),
  }) },
  { id: 'plugin-frame', fixture: '', entry: '/scripts/capture-ui/browser-surfaces.tsx', ready: 'html[data-plugin-ready="true"]', states: surfaceStates({query: 'surface=plugin'}, '[aria-label="Minimize Plugin tools"]', {selector: '.pv-status summary', action: 'press', key: 'Enter', frame: 'iframe', waitFor: '.pv-status details[open]'}, {
    empty: skip('Personal Visuals seeds an example when no document is stored; its diagram schema requires at least one node.'),
    error: {api: 'error', ready: '.plugin-workspace iframe', frame: 'iframe', waitFor: '.pv-error'},
    loading: {api: 'loading', hold: '^/api/plugins/personal-visuals/rpc$', ready: '.plugin-workspace iframe', frame: 'iframe', waitFor: '.pv-status'},
  }, 'iframe') },
  { id: 'usage-dialog', fixture: 'usage-context-fixture.tsx', ready: 'html[data-usage-fixture-ready="true"]', states: surfaceStates({steps: [{selector: 'button:has-text("Open Usage")', action: 'click'}], waitFor: '.usage-dialog'}, '[aria-label="Usage scope"]', {selector: '[aria-label="Usage scope"]', action: 'click', waitFor: '[role="listbox"]'}, {
    empty: {event: {name: 'usage-fixture', detail: 'empty'}, waitFor: '.usage-dialog-empty'},
    error: {event: {name: 'usage-fixture', detail: 'error'}, waitFor: '.usage-dialog-error'},
    loading: {event: {name: 'usage-fixture', detail: 'loading'}, waitFor: '.usage-dialog-skeleton'},
  }) },
  { id: 'context-inspector', fixture: 'usage-context-fixture.tsx', ready: 'html[data-usage-fixture-ready="true"]', states: surfaceStates({steps: [{selector: '[aria-label="Inspect context"]', action: 'click'}], waitFor: '.context-inspector'}, '.context-inspector button', {event: {name: 'usage-fixture', detail: 'categories'}}, {
    empty: {event: {name: 'usage-fixture', detail: 'unknown'}, waitFor: '.context-inspector:has-text("Not reported")'},
    error: {api: 'error', steps: [{selector: '.context-inspector button', action: 'click'}], waitFor: '.context-inspector [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/commands$', steps: [{selector: '.context-inspector button', action: 'click'}], waitFor: '.context-inspector:has-text("Compacting")'},
  }) },
  { id: 'task-interactions', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.review-item-detail', states: surfaceStates({query: 'surface=interactions'}, '[aria-label="Next item"]', {selector: '.interaction-source > summary', action: 'click', waitFor: '.interaction-source[open]'}, {
    empty: {query: 'variant=empty', api: 'empty', waitFor: 'text=No records supplied.'},
    error: {steps: [{selector: 'button:has-text("Send review")', action: 'click'}], waitFor: '.review-queue [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/commands$', steps: [{selector: 'button:has-text("Apply settings")', action: 'click'}], waitFor: '.parameter-controls button:has-text("Sending")'},
  }) },
  { id: 'task-work-objects', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.trace-waterfall [role="treeitem"]', states: surfaceStates({query: 'surface=work-objects'}, '.workflow-card-select', {selector: '.work-object-source > summary', action: 'click', waitFor: '.work-object-source[open]'}, {
    empty: {query: 'variant=empty', api: 'empty', ready: '.trace-waterfall', waitFor: 'text=No trace spans were supplied.'},
    error: {api: 'error', steps: [{selector: '.trace-span', action: 'click'}, {selector: 'button:has-text("Ask about span")', action: 'click'}], waitFor: '.trace-waterfall [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/commands$', steps: [{selector: '.trace-span', action: 'click'}, {selector: 'button:has-text("Ask about span")', action: 'click'}], waitFor: '.trace-waterfall button:has-text("Sending")'},
  }) },
  { id: 'task-everyday', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.everyday-comparison-table', states: surfaceStates({query: 'surface=everyday'}, '.everyday-comparison th button', {selector: '.everyday-source > summary', action: 'click', waitFor: '.everyday-source[open]'}, {
    empty: {query: 'variant=empty', api: 'empty', waitFor: '.everyday-empty'},
    error: {api: 'error', steps: [{selector: 'button:has-text("Save selected plan")', action: 'click'}], waitFor: '.everyday-comparison [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/commands$', steps: [{selector: 'button:has-text("Save selected plan")', action: 'click'}], waitFor: '.everyday-comparison button:has-text("Submitting")'},
  }) },
  { id: 'task-exploration', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.image-annotator img', states: surfaceStates({query: 'surface=exploration'}, '[aria-label="Search logs"]', {selector: '.exploration-source > summary', action: 'click', waitFor: '.exploration-source[open]'}, {
    empty: {query: 'variant=empty', api: 'empty', waitFor: 'text=No log events were supplied.'},
    error: {api: 'error', ready: '.image-annotator [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/resources/capture-task-annotation/content$', ready: '.image-annotator [role="status"]'},
  }) },
  { id: 'task-software', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.software-pipeline', states: surfaceStates({query: 'surface=software'}, '.software-diagnostics [role="tab"]', {selector: '.software-source > summary', action: 'click', waitFor: '.software-source[open]'}, {
    empty: {query: 'variant=empty', api: 'empty', waitFor: '.software-empty'},
    error: {api: 'error', steps: [{selector: '.software-diagnostics .software-actions button', action: 'click'}], waitFor: '.software-diagnostics [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/commands$', steps: [{selector: '.software-diagnostics .software-actions button', action: 'click'}], waitFor: '.software-diagnostics button:has-text("Requesting")'},
  }) },
  { id: 'task-media', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.image-compare-stage[data-ready="true"]', states: surfaceStates({query: 'surface=media'}, 'button:has-text("Side by side")', {selector: 'button:has-text("Side by side")', action: 'click', waitFor: '.image-compare-stage[data-mode="split"]'}, {
    empty: skip('MapView requires at least one point and ImageCompare requires both source images; neither exposes a separate empty view.'),
    error: {api: 'error', ready: '.image-compare-message [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/resources/capture-task-(before|after)/content$', ready: '.image-compare-message[role="status"]'},
  }) },
  { id: 'task-document', readyTimeout: 30000, retryReadyTimeout: true, fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.document-preview[data-preview-state="ready"] canvas[width]:not([width="0"])', states: surfaceStates({query: 'surface=document', waitFor: '.signature-pad img'}, 'button:has-text("Edit name")', {selector: 'button:has-text("Edit name")', action: 'click', waitFor: '.signature-name-input'}, {
    empty: {query: 'variant=empty', api: 'empty', waitFor: '.signature-image-preview'},
    error: {api: 'error', ready: '.document-preview[data-preview-state="error"]', waitFor: '.document-preview [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/resources/capture-task-pdf/content$', ready: '.document-preview[data-preview-state="updating"]', waitFor: '.document-preview [role="status"]'},
  }) },
  { id: 'task-document-window', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.document-text-window textarea:not([readonly])', states: surfaceStates({query: 'surface=document-window'}, '[aria-label="Document text"]', {selector: '[aria-label="Dock document"]', action: 'click', waitFor: '.document-text-window[data-placement="docked"]'}, {
    empty: {api: 'empty'},
    error: {api: 'error', ready: '.document-text-window [role="alert"]'},
    loading: {api: 'loading', hold: '^/api/resources/capture-task-text/content$', ready: '.document-text-window [role="status"]'},
  }) },
  { id: 'task-table-disclosure', fixture: '', entry: '/scripts/capture-ui/task-surfaces.tsx', ready: '.task-table table', states: surfaceStates({query: 'surface=table-disclosure'}, '[aria-label="Select row 1"]', {selector: '.disclosure-trigger:has-text("Where can I see")', action: 'click', waitFor: '.disclosure-trigger:has-text("Where can I see")[aria-expanded="true"]'}, {
    empty: {query: 'variant=empty', api: 'empty'},
    error: skip('Table and Disclosure consume synchronous bindings here; neither has an actionId or asynchronous error boundary.'),
    loading: skip('Table and Disclosure render supplied rows/text synchronously; this gallery has no fetch or pending prop.'),
  }) },
  {id:'project-search',fixture:'project-search-fixture.tsx',ready:'[aria-label="Search scope"]',states:surfaceStates({steps:[{selector:'[aria-label="Search scope"]',action:'click'},{selector:'[role="option"]:has-text("Project")',action:'click'},{selector:'input[placeholder="File names and text"]',action:'fill',value:'workspace'}],waitFor:'.project-search-hit'},'.project-search-hit',{selector:'.project-search-hit',action:'click',waitFor:'.files-preview-content'}, {
    empty:{query:'state=empty',waitFor:'.project-search-results',steps:[{selector:'[aria-label="Search scope"]',action:'click'},{selector:'[role="option"]:has-text("Project")',action:'click'},{selector:'input[placeholder="File names and text"]',action:'fill',value:'workspace'}]},
    error:{query:'state=error',waitFor:'.project-search-results [role="alert"]'},
    loading:{query:'state=loading',waitFor:'.project-search-results [role="status"]'},
  })},
  {id:'saved-drafts',fixture:'saved-drafts-fixture.tsx',ready:'[data-saved-composer] textarea:enabled',states:surfaceStates({query:'capture=1',steps:[{selector:'.saved-drafts-trigger:visible',action:'click'}],waitFor:'.saved-drafts-popover li'},'.saved-drafts-row-actions button',{selector:'.saved-drafts-row-actions button',action:'click',waitFor:'.saved-drafts-dialog'}, {
    empty:{query:'capture-empty=1',waitFor:'text=No saved drafts yet.'},
    error:{query:'capture-boundary=error',waitFor:'.saved-drafts-popover [role="alert"]'},
    loading:{query:'capture-boundary=loading',waitFor:'.saved-drafts-popover [role="status"]'},
  })},
  {id:'terminal-excerpts',readyTimeout:30000,retryReadyTimeout:true,fixture:'terminal-excerpts-fixture.tsx',ready:'.xterm-screen',states:surfaceStates({steps:[{selector:'.xterm-helper-textarea',action:'focus'},{selector:'.xterm-helper-textarea',action:'press',key:'Control+Shift+a'},{selector:'button:has-text("Add selection to prompt")',action:'click'}],waitFor:'.terminal-excerpt-chip:visible'},'.terminal-excerpt-chip:visible button',{selector:'.terminal-excerpt-chip:visible button',action:'click',waitFor:'[aria-label="Excerpt text"]'}, {
    empty:{api:'empty',steps:[],waitFor:'.xterm-screen'},
    error:skip('Excerpt capture is synchronous; rejected and uncertain normal Sends are exercised by terminal-excerpts.spec.ts, with no separate capture error prop.'),
    loading:{api:'loading',hold:'^/api/terminals$',steps:[],ready:'.terminal-read',waitFor:'.terminal-read [role="status"]'},
  })},
  {id:'conversation-find',readyTimeout:30000,retryReadyTimeout:true,fixture:'conversation-find-fixture.tsx',ready:'.composer textarea',states:surfaceStates({steps:[{selector:'[aria-label="Find in conversation"]',action:'click'},{selector:'[aria-label="Find phrase"]',action:'fill',value:'workspace'}],waitFor:'.conversation-find-count'},'[aria-label="Next match"]',{selector:'[aria-label="Find phrase"]',action:'focus'}, {
    empty:{steps:[{selector:'[aria-label="Find in conversation"]',action:'click'},{selector:'[aria-label="Find phrase"]',action:'fill',value:'no-match-in-this-conversation'}],waitFor:'.conversation-find-count'},
    error:{api:'error',steps:[],ready:'[role="alert"]',waitFor:'[role="alert"]'},
    loading:{api:'loading',hold:'^/api/bootstrap$',steps:[],ready:'.workspace-host-bootstrap [role="status"]',waitFor:'.workspace-host-bootstrap [role="status"]'},
  })},
  {id:'file-checkpoints',fixture:'file-checkpoints-fixture.tsx',ready:'.file-checkpoints',states:surfaceStates({waitFor:'.file-checkpoints-list button'},'.file-checkpoints-list button',{selector:'.file-checkpoints-list button',action:'click',waitFor:'[aria-label="Checkpoint review"]'}, {
    empty:{query:'state=empty',ready:'.file-checkpoints',waitFor:'text=No file checkpoints available.'},
    error:{query:'state=error',ready:'.file-checkpoints',waitFor:'.file-checkpoints [role="alert"]'},
    loading:{query:'state=loading',ready:'.file-checkpoints',waitFor:'.file-checkpoints [role="status"]'},
  })},
  {id:'redundant-ui',fixture:'redundant-ui-fixture.tsx',ready:'.wo5-redundant-fixture',states:surfaceStates({steps:[{selector:'[aria-label="Inspect live usage"]',action:'click'}],waitFor:'.project-context-card'},'button:has-text("Open Usage")',{selector:'button:has-text("Open Usage")',action:'click',waitFor:'dialog[open]'}, {
    empty:{query:'state=empty',waitFor:'.project-context-card'},
    error:{query:'state=error',waitFor:'.project-context-card [role="alert"]'},
    loading:{query:'state=loading',waitFor:'.project-context-card [role="status"]'},
  })},
];
// Single source for scope rules and the documentation mapping table. All matches accumulate.
export const mapping = [
  {pattern:'(ProjectSearch|project-search|^apps/web/src/files/)',screens:['project-search']},
  {pattern:'(SavedDrafts|saved-drafts)',screens:['saved-drafts']},
  {pattern:'(TerminalExcerpt|terminal-excerpts|TerminalBody|ComposerAttachments|composer-entry)',screens:['terminal-excerpts']},
  {pattern:'(ConversationFind|conversation-find|conversation-workspace/ConversationPane)',screens:['conversation-find']},
  {pattern:'(FileCheckpoints|file-checkpoint|WorkspacePanelBodies|WorkspaceSurfaceBody)',screens:['file-checkpoints']},
  {pattern:'(ProjectContextCard|ProjectContextSurface|UsageFooter|TaskMemory|WorkspaceSurfaceBody)',screens:['redundant-ui']},
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
