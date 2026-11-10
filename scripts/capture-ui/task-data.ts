import type {ElementSpec, Snapshot, SurfaceSpec} from '../../packages/contracts';
import {EVERYDAY_REVIEW_DATA, INTERACTION_REVIEW_DATA, MAP_DATA, SIGNING_BOX} from '../review-fixtures';
import {EXPLORATION_REVIEW_DATA} from '../exploration-review-data';
import {SOFTWARE_FIXTURE_DATA} from '../software-development-fixtures';

// Tooling-owned synthetic datasets, following task-interface and work-objects e2e fixtures.
// Every element below is rendered by the application's catalog registry.
export const TASK_SURFACES = ['interactions', 'work-objects', 'everyday', 'exploration', 'software', 'media', 'document', 'document-window', 'table-disclosure'] as const;
export type TaskSurface = typeof TASK_SURFACES[number];
export const TASK_RESOURCE_IDS = {pdf: 'capture-task-pdf', document: 'capture-task-text', before: 'capture-task-before', after: 'capture-task-after', annotation: 'capture-task-annotation', signature: 'capture-task-signature'} as const;
export const TASK_DOCUMENT_TEXT = '# Delivery brief\n\nConfirm the delivery method and keep the original source attached.\n\n## Review checklist\n\n- Inspect the prepared agreement.\n- Confirm the contact details.\n- Save the draft for team review.\n\nThis is a synthetic local document. Editing retains a draft and does not deliver it.';
const source = 'Synthetic local capture fixture; no external operation has been executed.';
export const TASK_WORK_DATA = {
  WorkflowBoard: {revision: 'board-7', title: 'Release preparation', lanes: [{id: 'ready', label: 'Ready'}, {id: 'review', label: 'In review'}, {id: 'done', label: 'Prepared'}], cards: [{id: 'retry', laneId: 'ready', title: 'Keep retries ordered', detail: 'Review queue ordering before the release.', tag: 'Runtime', owner: 'Mira'}, {id: 'grant', laneId: 'ready', title: 'Bound document grants', tag: 'Security', owner: 'Jules'}, {id: 'notes', laneId: 'review', title: 'Prepare migration notes', tag: 'Docs', owner: 'Sam'}], source},
  ArchitectureCanvas: {revision: 'architecture-2', title: 'Document processing path', layers: [{id: 'experience', label: 'Experience'}, {id: 'boundary', label: 'Boundary'}, {id: 'storage', label: 'Storage'}], nodes: [{id: 'preview', layerId: 'experience', label: 'Document preview', kind: 'client', detail: 'Shows the granted document.', facts: [{label: 'Input', value: 'Granted resource ID'}]}, {id: 'parser', layerId: 'boundary', label: 'Bounded parser', kind: 'service', detail: 'Parses only the supplied resource.'}, {id: 'queue', layerId: 'boundary', label: 'Draft queue', kind: 'queue'}, {id: 'files', layerId: 'storage', label: 'Resource store', kind: 'store', detail: 'Retains the supplied source bytes.'}], edges: [{from: 'preview', to: 'parser', label: 'Preview request'}, {from: 'parser', to: 'files', label: 'Resource read'}, {from: 'queue', to: 'files', label: 'Draft storage'}], source},
  TraceWaterfall: {revision: 'trace-4', title: 'Import request', spans: [{id: 'request', name: 'Import request', service: 'gateway', status: 'ok', startMs: 0, durationMs: 240}, {id: 'grant', parentId: 'request', name: 'Validate grant', service: 'gateway', status: 'ok', startMs: 12, durationMs: 32}, {id: 'parse', parentId: 'request', name: 'Parse document', service: 'worker', status: 'error', startMs: 48, durationMs: 170, detail: 'The supplied record reports a page limit failure.'}, {id: 'fetch', parentId: 'parse', name: 'Read source bytes', service: 'storage', status: 'ok', startMs: 58, durationMs: 65}, {id: 'unknown', parentId: 'request', name: 'Legacy adapter', service: 'adapter', status: 'unknown'}], source},
};

const node = (type: string, props: Record<string, unknown>, children?: string[]): ElementSpec => ({type, props, ...(children ? {children} : {})});
function stack(elements: Record<string, ElementSpec>): SurfaceSpec {
  const nested = new Set(Object.values(elements).flatMap(element => element.children ?? []));
  return {root: 'captureRoot', elements: {captureRoot: node('Stack', {gap: 'lg'}, Object.keys(elements).filter(id => !nested.has(id))), ...elements}};
}
type Fixture = {title: string; spec: SurfaceSpec; inputs: Record<string, unknown>; values: Record<string, unknown>};
export const taskSurfaceFixtures: Record<TaskSurface, Fixture> = {
  interactions: {title: 'Review, records and parameters', spec: stack({
    review: node('ReviewQueue', {dataBinding: 'review', stateKey: 'reviewDraft', actionId: 'inspect', actionLabel: 'Send review'}),
    records: node('EditableTable', {dataBinding: 'records', stateKey: 'recordDraft', actionId: 'inspect', actionLabel: 'Submit changes'}),
    parameters: node('ParameterControls', {dataBinding: 'parameters', stateKey: 'parameterDraft', actionId: 'inspect', actionLabel: 'Apply settings'}),
  }), inputs: {review: INTERACTION_REVIEW_DATA.ReviewQueue, records: INTERACTION_REVIEW_DATA.EditableTable, parameters: INTERACTION_REVIEW_DATA.ParameterControls}, values: {}},
  'work-objects': {title: 'Workflow, architecture and trace', spec: stack(Object.fromEntries(Object.keys(TASK_WORK_DATA).map(type => [type, node(type, {dataBinding: type, stateKey: `${type}View`, actionId: 'inspect'})]))), inputs: TASK_WORK_DATA, values: {}},
  everyday: {title: 'Project statistics and comparison', spec: stack({stats: node('Stats', {dataBinding: 'stats', stateKey: 'selectedMetric'}), comparison: node('Comparison', {dataBinding: 'comparison', stateKey: 'planChoice', actionId: 'inspect', actionLabel: 'Save selected plan'})}), inputs: {stats: EVERYDAY_REVIEW_DATA.Stats, comparison: EVERYDAY_REVIEW_DATA.Comparison}, values: {planChoice: 'studio'}},
  exploration: {title: 'Image feedback, schedule and logs', spec: stack({
    annotation: node('ImageAnnotator', {resourceId: TASK_RESOURCE_IDS.annotation, alt: 'Export panel under review', title: 'Image feedback', stateKey: 'imageFeedback', actionId: 'inspect', actionLabel: 'Send feedback'}),
    schedule: node('SchedulePicker', {dataBinding: 'schedule', stateKey: 'scheduleChoice', actionId: 'inspect', actionLabel: 'Propose this time'}),
    logs: node('LogExplorer', {dataBinding: 'logs', stateKey: 'logSelection', actionId: 'inspect', actionLabel: 'Investigate event'}),
  }), inputs: EXPLORATION_REVIEW_DATA, values: {}},
  software: {title: 'Software evidence inspectors', spec: stack(Object.fromEntries(Object.keys(SOFTWARE_FIXTURE_DATA).map(type => [type, node(type, {dataBinding: type, stateKey: `${type}Selection`, actionId: 'inspect'})]))), inputs: SOFTWARE_FIXTURE_DATA, values: {}},
  media: {title: 'Image comparison and local map', spec: stack({
    comparison: node('ImageCompare', {beforeResourceId: TASK_RESOURCE_IDS.before, afterResourceId: TASK_RESOURCE_IDS.after, stateKey: 'imageComparison', title: 'Synthetic color studies'}),
    map: node('MapView', {dataBinding: 'places', stateKey: 'place', themeStateKey: 'mapTheme', label: 'Around Linden Park', feedbackActionId: 'inspect'}),
  }), inputs: {places: MAP_DATA}, values: {place: 'boathouse'}},
  document: {title: 'Synthetic document and visual signature', spec: stack({
    pdf: node('DocumentPreview', {resourceId: TASK_RESOURCE_IDS.pdf, title: 'Synthetic service agreement.pdf', fieldStateKeys: {Name: 'name', Title: 'title', Email: 'email', SignedDate: 'signedDate'}, signatureStateKey: 'signature', signatureBox: SIGNING_BOX, fit: 'page'}),
    signature: node('SignaturePad', {stateKey: 'signature', nameStateKey: 'name', label: 'Signature controls', initialMode: 'generate'}),
  }), inputs: {}, values: {name: 'Alex Morgan', title: 'Designer', email: 'alex@studio.example', signedDate: 'November 9, 2026', signature: {kind: 'image', resourceId: TASK_RESOURCE_IDS.signature}}},
  'document-window': {title: 'Delivery brief', spec: stack({document: node('Document', {title: 'Delivery brief', resourceId: TASK_RESOURCE_IDS.document, presentation: 'window', editableStateKey: 'briefDraft'})}), inputs: {}, values: {}},
  'table-disclosure': {title: 'Source records and delivery questions', spec: stack({
    table: node('Table', {rowsBinding: 'rows', changesBinding: 'changes', stateKey: 'selectedRows', rowKey: 'id', caption: 'Source records', columns: [{key: 'name', label: 'Name'}, {key: 'workspace', label: 'Workspace'}, {key: 'status', label: 'Status'}]}),
    question: node('Disclosure', {title: 'Can delivery be split?', stateKey: 'deliveryOpen', defaultOpen: true, text: 'Yes. Each confirmed destination receives its own date and tracking entry.'}, ['followup']),
    followup: node('Disclosure', {title: 'Where can I see the final fee?', stateKey: 'feeOpen', defaultOpen: false, text: 'Your confirmation shows the fee before you submit.'}),
  }), inputs: {rows: [{id: 'record-1', name: 'Print studio', workspace: 'North Walk', status: 'Reviewed'}, {id: 'record-2', name: 'Ceramics room', workspace: 'Garden Lane', status: 'Ready'}, {id: 'record-3', name: 'Garden cafe', workspace: 'Linden Park', status: 'Needs review'}], changes: {revision: 1, rows: [{id: 'record-2', status: 'added'}, {id: 'record-3', status: 'updated', cells: [{key: 'status', status: 'updated', before: 'Ready'}]}]}}, values: {deliveryOpen: true, feeOpen: false}},
};

export function taskSurface(value: string | null): TaskSurface {
  return TASK_SURFACES.includes(value as TaskSurface) ? value as TaskSurface : 'interactions';
}

export function createTaskSnapshot(surface: TaskSurface, empty = false): Snapshot {
  const fixture = taskSurfaceFixtures[surface], now = '2026-11-09T20:00:00.000Z', threadId = `capture-task-${surface}`, stateId = `${threadId}-state`;
  const snapshot: Snapshot = {
    seq: 1, activeThreadId: threadId,
    threads: [{id: threadId, title: fixture.title, projectName: 'Renderer capture fixtures', status: 'ready', epoch: 0, runId: null, modelId: 'test/model', sessionPath: 'fixture', createdAt: now, updatedAt: now}],
    messages: [{id: `${threadId}-message`, threadId, role: 'assistant', content: source, runId: null, createdAt: now}],
    artifacts: [{id: `${threadId}-artifact`, threadId, messageId: `${threadId}-message`, title: fixture.title, purpose: source, kind: 'structured', revision: 1, spec: structuredClone(fixture.spec), widget: null, bindings: Object.fromEntries(Object.keys(fixture.inputs).map(name => [name, {mode: 'live', id: `${threadId}-input-${name}`}])) , actions: {inspect: {kind: 'agent'}}, stateId, lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1.0.0', presentation: {width: 'standard', frame: 'card'}, createdAt: now, updatedAt: now}],
    userStates: [{id: stateId, threadId, revision: 0, schemaVersion: 1, values: structuredClone(fixture.values)}],
    data: Object.entries(fixture.inputs).map(([name, value]) => ({id: `${threadId}-input-${name}`, threadId, revision: 1, value: structuredClone(value), provenance: source, createdAt: now})),
    resources: Object.values(TASK_RESOURCE_IDS).map(id => ({id, threadId, kind: 'attachment', path: `/synthetic/${id}`, label: id, writable: false, createdAt: now})),
    requests: [], operations: [], usage: {}, settings: {theme: 'dark', modelId: 'test/model'},
  };
  if (empty) {
    const input = (name: string) => snapshot.data.find(row => row.id.endsWith(`-input-${name}`))!.value as Record<string, unknown>;
    if (surface === 'interactions') input('records').rows = [];
    if (surface === 'work-objects') {
      input('WorkflowBoard').cards = [];
      Object.assign(input('ArchitectureCanvas'), {nodes: [], edges: []});
      input('TraceWaterfall').spans = [];
    }
    if (surface === 'everyday') {
      const options = input('comparison').options as {values: Record<string, unknown>}[];
      options.forEach(option => { option.values = structuredClone(options[0].values); });
      snapshot.userStates[0].values.planChoice = {selectedId: 'studio', differencesOnly: true};
    }
    if (surface === 'exploration') { input('schedule').slots = []; input('logs').events = []; }
    if (surface === 'software') for (const [name, field] of [['Diagnostics', 'items'], ['ChangeSet', 'files'], ['ApiExplorer', 'endpoints'], ['Pipeline', 'stages']]) input(name)[field] = [];
    if (surface === 'document') Object.assign(snapshot.userStates[0].values, {signature: null, name: ''});
    if (surface === 'table-disclosure') { snapshot.data.find(row => row.id.endsWith('-input-rows'))!.value = []; input('changes').rows = []; }
  }
  return snapshot;
}
