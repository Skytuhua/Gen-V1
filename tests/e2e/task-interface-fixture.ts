import type { Page } from '@playwright/test';
import {panelBindingSchema} from '../../packages/contracts/workspace';
import {splitWorkspaceLayoutSchema,type SplitWorkspaceLayout} from '../../packages/contracts/split-workspace';
import type { ArtifactRecord, HostCommand, Snapshot } from '../../packages/contracts';
import {applySplitWorkspaceCommand, createSplitWorkspaceLayout} from '../../packages/core/split-workspace-layout';

export type TaskSpec = NonNullable<ArtifactRecord['spec']>;
const now = '2026-10-29T23:00:00.000Z';
export function taskFixture(spec: TaskSpec, inputs: Record<string, unknown> = {}, values: Record<string, unknown> = {}): Snapshot {
  return {
    seq: 1, activeThreadId: 'task-thread',
    threads: [{ id: 'task-thread', title: 'Source-bound task fixture', projectName: 'Reusable task surfaces', status: 'ready', epoch: 0, runId: null, modelId: 'test/model', sessionPath: 'fixture', createdAt: now, updatedAt: now }],
    messages: [{ id: 'reply', threadId: 'task-thread', role: 'assistant', content: 'Synthetic local source data for the reusable renderer.', runId: null, createdAt: now }],
    artifacts: [{ id: 'task-surface', threadId: 'task-thread', messageId: 'reply', title: 'Task surface', purpose: 'Authored source fixture; no model or external operation.', kind: 'structured', revision: 1, spec, widget: null, bindings: Object.fromEntries(Object.keys(inputs).map(name => [name, { mode: 'live', id: `input-${name}` }])), actions: { expand: { kind: 'agent' }, ask: { kind: 'agent' }, feedback: { kind: 'agent' } }, stateId: 'task-state', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1.0.0', presentation: { width: 'standard', frame: 'card' }, createdAt: now, updatedAt: now }],
    userStates: [{ id: 'task-state', threadId: 'task-thread', revision: 0, schemaVersion: 1, values }],
    data: Object.entries(inputs).map(([name, value]) => ({ id: `input-${name}`, threadId: 'task-thread', revision: 1, value, provenance: 'Authored synthetic local input', createdAt: now })),
    requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'system', modelId: 'test/model' },
  };
}
function taskSplitLayout(snapshot?: Snapshot) {
  // Ordinary Workspace now renders its conversation from the canonical split layout.
  // Use the production reducer so fixture navigation preserves the same owner and revision.
  let splitLayout = createSplitWorkspaceLayout();
  const initialThread = snapshot?.threads.find(thread => thread.id === snapshot.activeThreadId);
  if (initialThread) splitLayout = applySplitWorkspaceCommand(splitLayout, 'view.open', {view: {
    id: 'thread:' + initialThread.id, kind: 'thread', binding: {authority: {kind: 'local'}, threadId: initialThread.id,
      ...(initialThread.projectId ? {projectId: initialThread.projectId} : {})},
  }});
  return splitLayout;
}
// thread.reconcile is host-owned, so the pure geometry reducer deliberately excludes it.
// Match the existing split-app fixture's canonical owner and revision checks.
function taskSplitCommand(layout: SplitWorkspaceLayout, command: HostCommand, snapshot?: Snapshot) {
  if (command.type.replace(/^split-workspace\./, '') !== 'thread.reconcile') return applySplitWorkspaceCommand(layout, command.type, command.payload);
  if (Object.keys(command.payload).sort().join(',') !== 'baseRevision,expectedBinding,projectId,viewId,workspaceId' || command.payload.workspaceId !== layout.id || command.payload.baseRevision !== layout.revision) throw Error('The captured workspace identity or revision changed.');
  const expected = panelBindingSchema.parse(command.payload.expectedBinding), target = layout.views[String(command.payload.viewId)];
  if (!target || target.kind !== 'thread' || target.binding.authority.kind !== 'local' || !target.binding.threadId) throw Error('Only an existing local conversation view can be reconciled.');
  // Strict local authority has only kind; every other parsed binding field is primitive.
  const bindingEntries = Object.entries(target.binding);
  if (expected.authority.kind !== 'local' || bindingEntries.length !== Object.keys(expected).length ||
      bindingEntries.some(([key, value]) => !Object.hasOwn(expected, key) || (key !== 'authority' && !Object.is(value, expected[key as keyof typeof expected])))) throw Error('The captured conversation owner binding changed.');
  const owner = snapshot?.threads.find(thread => thread.id === target.binding.threadId);
  if (!owner || (owner.projectId ?? null) !== command.payload.projectId) throw Error('The canonical conversation project changed.');
  const next = structuredClone(layout);
  for (const view of Object.values(next.views)) {
    if (view.kind !== 'thread' || view.binding.authority.kind !== 'local' || view.binding.threadId !== owner.id) continue;
    if (owner.projectId == null) delete view.binding.projectId; else view.binding.projectId = owner.projectId;
  }
  return splitWorkspaceLayoutSchema.parse({...next, revision: layout.revision + 1});
}
export async function serveTaskFixture(page: Page, snapshot: Snapshot, action?: (command: HostCommand) => Promise<unknown>) {
  const commands: HostCommand[] = [];
  let splitLayout = taskSplitLayout(snapshot);
  await page.addInitScript(() => {
    class Source {
      onopen: (() => void) | null = null;
      onerror = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      receive = (event: Event) => this.onmessage?.({ data: JSON.stringify({ seq: (event as CustomEvent<number>).detail, type: 'fixture.changed' }) });
      constructor() { window.addEventListener('task-fixture-update', this.receive); queueMicrotask(() => this.onopen?.()); }
      addEventListener() {}
      close() { window.removeEventListener('task-fixture-update', this.receive); }
    }
    Object.defineProperty(window, 'EventSource', { value: Source });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/bootstrap') return route.fulfill({ json: { csrfToken: 'fixture-csrf', widgetOrigin: 'http://localhost:4318' } });
    if (path === '/api/models') return route.fulfill({ json: { models: [{ id: 'test/model', provider: 'test', name: 'Fixture' }] } });
    if (path === '/api/snapshot') return route.fulfill({ json: snapshot });
    if (path === '/api/operation-project-trust' || path === '/api/operation-project-trust/status') {
      const query = new URL(route.request().url()).searchParams;
      const operation = snapshot.operations.find(item => item.id === query.get('operationId') && item.threadId === query.get('threadId') && item.revision === Number(query.get('operationRevision')));
      if (!operation) return route.fulfill({ status: 404 });
      return route.fulfill({ json: { version: 1, enabled: false, reason: 'PROJECT_TRUST_DISABLED', threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision } });
    }
    if (path === '/api/shell-settings') return route.fulfill({json: snapshot.settings});
    if (path === '/api/split-workspace') return route.fulfill({json: splitLayout});
    if (path === '/api/split-workspace/profiles') return route.fulfill({json: []});
    if (path === '/api/split-workspace/commands') {
      const command = route.request().postDataJSON() as HostCommand;
      splitLayout = taskSplitCommand(splitLayout, command, snapshot);
      return route.fulfill({json: {commandId: command.id, eventSeq: snapshot.seq, result: splitLayout}});
    }
    if (path === '/api/workspace') return route.fulfill({json: {projects: [], state: {version: 1, revision: 0, activeCanvasId: 'workspace', canvases: [{id: 'workspace', name: 'Workspace', preset: 'workspace', version: 1, panels: [], filter: 'active', projectIds: [], viewport: {x: 0, y: 0, zoom: 1}}], profiles: [], disabledKinds: [], integrations: {}}}});
    if (path === '/api/plugins') return route.fulfill({json: {plugins: []}});
    const branchMatch = path.match(/^\/api\/session-branches\/([^/]+)$/);
    if (branchMatch) return route.fulfill({json: {enabled: {branch: false, import: false}, capabilities: {inspect: 'SUPPORTED', quote: 'SUPPORTED', nativeFork: 'UNSUPPORTED', adapters: []}, captures: [], branch: null, children: [], imports: []}});
    const workbenchMatch = path.match(/^\/api\/workbench\/threads\/([^/]+)(\/inputs)?$/);
    if (workbenchMatch) { const logicalOwner = {threadId: workbenchMatch[1], projectId: null, workspaceId: null}; return route.fulfill({json: workbenchMatch[2] ? {logicalOwner, inputs: []} : {logicalOwner, enabled: false, sources: [], sourceCapabilities: []}}); }
    if (path !== '/api/commands') return route.fulfill({ status: 404 });
    const command = route.request().postDataJSON() as HostCommand; commands.push(command);
    let result: unknown = {};
    if (command.type === 'settings.update') snapshot.settings = {...snapshot.settings, ...command.payload, preferences: {...snapshot.settings.preferences, ...(command.payload.preferences as Record<string, unknown> | undefined)}};
    if (command.type === 'state.save') { snapshot.userStates[0].values = command.payload.values as Record<string, unknown>; snapshot.userStates[0].revision++; result = snapshot.userStates[0]; }
    if (command.type === 'action.submit') result = await action?.(command) ?? {};
    snapshot.seq++;
    await route.fulfill({ json: { commandId: command.id, seq: snapshot.seq, result } });
    // The real host broadcasts accepted settings writes to every snapshot subscriber
    // (embedded conversations included); mirror that so tests see the same propagation.
    if (command.type === 'settings.update') await page.evaluate(seq => window.dispatchEvent(new CustomEvent('task-fixture-update', { detail: seq })), snapshot.seq).catch(() => {});
  });
  return {
    commands, snapshot,
    async publish() { snapshot.seq++; await page.evaluate(seq => window.dispatchEvent(new CustomEvent('task-fixture-update', { detail: seq })), snapshot.seq); },
    setInput(name: string, value: unknown) { const data = snapshot.data.find(row => row.id === `input-${name}`)!; data.value = value; data.revision++; },
  };
}
// Opt in for fixtures that navigate real App conversations in the canonical split workspace.
export async function serveTaskSplitLayout(page: Page, initial?: string | Snapshot) {
  const snapshot = typeof initial === 'string' ? undefined : initial;
  let layout = taskSplitLayout(snapshot);
  // Main conversation selection now comes from durable pane placement rather
  // than the snapshot's activeThreadId fallback.
  if (typeof initial === 'string') layout = applySplitWorkspaceCommand(layout, 'view.open', {
    view: {id: `thread:${initial}`, kind: 'thread', binding: {authority: {kind: 'local'}, threadId: initial}},
  });
  await page.route('**/api/split-workspace?workspaceId=workspace', route => route.fulfill({json: layout}));
  await page.route('**/api/split-workspace/profiles?workspaceId=workspace', route => route.fulfill({json: []}));
  await page.route('**/api/split-workspace/commands', route => {
    const command = route.request().postDataJSON();
    layout = taskSplitCommand(layout, command, snapshot);
    return route.fulfill({json: {commandId: command.id, seq: layout.revision, result: layout}});
  });
}
export const branchGraphSpec = (orientation: 'vertical' | 'horizontal'): TaskSpec => ({ root: 'graph', elements: { graph: { type: 'RelationshipGraph', props: { dataBinding: 'graph', stateKey: 'selectedCommit', label: 'Release branches', orientation } } } });
export const branchGraphData = {
  nodes: [
    { id: 'base', label: 'Refresh release metadata', lane: 0, status: 'success', hash: '7fe91ac', author: 'Sam', time: '8m ago', branch: 'main', dimmed: true },
    { id: 'topic', label: 'Keep retries ordered', lane: 1, status: 'pending', hash: 'bf2c00d', author: 'Mira', time: '3m ago', branch: 'ordered-retries', conflictCount: 2, excerpts: [{ label: 'Current', text: 'retry(source)' }, { label: 'Incoming', text: 'await retry(source)' }], checks: [{ label: 'Tests', status: 'neutral', detail: 'Fixture checks have not run.' }] },
    { id: 'head', label: 'Review merge result', lane: 0, status: 'neutral', hash: 'a405ac3', author: 'Jules', time: 'now' },
  ],
  edges: [{ from: 'base', to: 'topic', status: 'pending' }, { from: 'base', to: 'head' }, { from: 'topic', to: 'head', status: 'pending' }],
  checks: [{ label: 'Tests', status: 'neutral', detail: 'Synthetic fixture: no checks executed.' }], summary: { label: 'Review two conflicts', status: 'pending', detail: 'Source fixture only' },
};
export const linkedMapSpec: TaskSpec = { root: 'map', elements: { map: { type: 'MapView', props: { dataBinding: 'places', stateKey: 'selectedPlace', themeStateKey: 'mapTheme', label: 'A walk between studios', feedbackActionId: 'feedback', payload: { scope: 'walking-plan' } } } } };
export const linkedMapData = { points: [{ id: 'print', label: 'Print studio', x: 23, y: 37, category: 'Workshop', detail: 'A quiet first stop near the courtyard.', address: '12 North Walk' }, { id: 'ceramic', label: 'Ceramics room', x: 59, y: 48, category: 'Studio', detail: 'The second stop faces the garden.', address: '3 Garden Lane' }, { id: 'cafe', label: 'Garden cafe', x: 76, y: 68, category: 'Break', detail: 'A shaded meeting place.', address: '7 Garden Lane' }], routes: [{ id: 'walk', pointIds: ['print', 'ceramic', 'cafe'], label: 'Suggested walking route' }], source: 'Authored local schematic; coordinates are illustrative.' };
export const growingQaSpec: TaskSpec = { root: 'questions', elements: {
  questions: { type: 'Stack', props: { gap: 'sm' }, children: ['history', 'ask'] },
  history: { type: 'Stack', props: { gap: 'sm', scroll: 'bounded', label: 'Delivery questions' }, children: ['delivery', 'cost', 'tracking'] },
  delivery: { type: 'Disclosure', props: { title: 'Can delivery be split?', stateKey: 'deliveryOpen', dataBinding: 'answer', onOpenActionId: 'expand', payload: { topic: 'delivery' } }, children: ['note', 'child'] },
  note: { type: 'Input', props: { stateKey: 'deliveryNote', label: 'Destination note' } },
  child: { type: 'Disclosure', props: { title: 'Can each destination use a different date?', text: 'Yes, choose a date for each destination before confirming.', stateKey: 'datesOpen' } },
  cost: { type: 'Disclosure', props: { title: 'Where can I see the final fee?', text: 'Your confirmation shows the fee before you submit.', stateKey: 'costOpen' } },
  tracking: { type: 'Disclosure', props: { title: 'How can I track each package?', text: 'Each confirmed package receives its own tracking entry.', stateKey: 'trackingOpen' } },
  ask: { type: 'Form', props: { actionId: 'ask', submitLabel: 'Ask question', payloadFromState: { question: 'question' }, clearOnSuccess: ['question'] }, children: ['question'] },
  question: { type: 'Input', props: { stateKey: 'question', label: 'Ask another question', placeholder: 'Type a question', required: true } },
} };
export const migrationTableSpec: TaskSpec = { root: 'tabs', elements: {
  tabs: { type: 'Tabs', props: { labels: ['People', 'Projects'], stateKey: 'tableTab' }, children: ['people', 'projects'] },
  people: { type: 'Table', props: { rowsBinding: 'rows', changesBinding: 'changes', columns: [{ key: 'name', label: 'Name' }, { key: 'workspace_id', label: 'workspace_id' }], rowKey: 'id', caption: 'Source records' } },
  projects: { type: 'Table', props: { rowsBinding: 'projects', columns: [{ key: 'name', label: 'Project' }], caption: 'Projects' } },
} };
