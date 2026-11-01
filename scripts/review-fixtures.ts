import type { SurfaceSpec, ElementSpec } from '../packages/contracts/index.ts';
import { CAPABILITIES, validateSurface } from '../packages/ui-catalog/index.ts';
import {explorationElements} from './exploration-review-data.ts';
import type {ComparisonData,StatsData} from '../packages/ui-catalog/everyday.ts';
import type {ReviewQueueData,EditableTableData,ParameterControlsData} from '../packages/ui-catalog/interactions.ts';
export const INTERACTION_REVIEW_DATA:{ReviewQueue:ReviewQueueData;EditableTable:EditableTableData;ParameterControls:ParameterControlsData}={
 ReviewQueue:{title:'Review the release notes',source:'Bundled illustrative notes. Decisions are review feedback, never permission to publish.',items:[{id:'summary',label:'Opening summary',detail:'A shorter explanation of the checkout repair.',evidence:[{label:'Proposed',value:'Checkout totals now include item quantity.'}]},{id:'compatibility',label:'Compatibility note',detail:'Describe the unchanged public interface.',evidence:[{label:'Proposed',value:'Existing callers require no changes.'}]},{id:'timing',label:'Publication timing',detail:'Choose the release window with the team.'}]},
 EditableTable:{title:'Adjust the delivery list',source:'Bundled illustrative delivery records. Submitting edits sends a proposal; no external records are changed.',columns:[{id:'item',label:'Item',type:'text',readOnly:true},{id:'quantity',label:'Quantity',type:'number',required:true,min:1,max:50,step:1},{id:'priority',label:'Priority',type:'choice',options:[{value:'normal',label:'Normal'},{value:'urgent',label:'Urgent'}]},{id:'ready',label:'Ready',type:'boolean'}],rows:[{id:'prints',label:'Prints',values:{item:'Print set',quantity:4,priority:'normal',ready:false}},{id:'frames',label:'Frames',values:{item:'Frame set',quantity:2,priority:'normal',ready:true}}]},
 ParameterControls:{title:'Tune the export',source:'Bundled illustrative export parameters. Apply sends values to the owning task; no export is executed.',controls:[{id:'quality',label:'Quality',type:'range',value:85,min:50,max:100,step:5,required:true},{id:'width',label:'Width',type:'number',value:1600,min:640,max:3840,step:160,required:true},{id:'format',label:'Format',type:'choice',value:'png',options:[{value:'png',label:'PNG'},{value:'webp',label:'WebP'}],required:true},{id:'metadata',label:'Include metadata',type:'boolean',value:false}]},
};
export function interactionSpec():SurfaceSpec{return {root:'interactionTabs',elements:{
 interactionTabs:node('Tabs',{labels:['Review items','Edit records','Parameters'],stateKey:'interactionTab'},['reviewQueue','editableTable','parameterControls']),
 reviewQueue:node('ReviewQueue',{dataBinding:'reviewItems',stateKey:'reviewDraft',actionId:'sendReview',actionLabel:'Send review'}),
 editableTable:node('EditableTable',{dataBinding:'editableRecords',stateKey:'recordEdits',actionId:'submitRecords',actionLabel:'Submit changes'}),
 parameterControls:node('ParameterControls',{dataBinding:'parameters',stateKey:'parameterDraft',actionId:'applyParameters',actionLabel:'Apply settings'}),
}};}

export const REVIEW_PROVENANCE = 'Illustrative local UI review fixture. External GitHub, CI, Supabase, email and phone effects are simulated.';
export const SIGNING_BOX = { page: 1, x: 76, y: 214, width: 300, height: 60 };
const node = (type: string, props: Record<string, unknown>, children?: string[]): ElementSpec => ({ type, props, ...(children ? { children } : {}) });
/** Only the recorder inputs this obviously synthetic value; it is never task data. */
export const SYNTHETIC_REVIEW_TOKEN='SYNTHETIC_REVIEW_TOKEN_NOT_A_SECRET';
export const EVERYDAY_REVIEW_DATA:{Stats:StatsData;Comparison:ComparisonData}={
  Stats:{title:'Project activity',period:'Last 7 days',source:'Bundled illustrative project observations; no live monitoring connection.',metrics:[
    {id:'requests',label:'Requests',value:12480,comparison:{value:18,label:'versus the previous 7 days',unit:'percent',favorable:true},series:[{label:'Mon',value:1320},{label:'Tue',value:1640},{label:'Wed',value:1880},{label:'Thu',value:1760},{label:'Fri',value:1960},{label:'Sat',value:1830},{label:'Sun',value:2090}]},
    {id:'latency',label:'Response time',value:184,unit:'ms',comparison:{value:-26,label:'versus the previous 7 days',unit:'absolute',favorable:true},series:[{label:'Mon',value:230},{label:'Tue',value:215},{label:'Wed',value:224},{label:'Thu',value:196},{label:'Fri',value:200},{label:'Sat',value:190},{label:'Sun',value:184}]},
    {id:'availability',label:'Availability',value:99.98,format:'percent',series:[{label:'Mon',value:99.96},{label:'Tue',value:100},{label:'Wed',value:null},{label:'Thu',value:99.99},{label:'Fri',value:100},{label:'Sat',value:99.98},{label:'Sun',value:99.98}]},
    {id:'cost',label:'Cost',value:null,format:'currency',currency:'USD'},
  ]},
  Comparison:{title:'Choose a project plan',source:'Bundled illustrative plan terms. Selection saves a preference; it does not purchase or activate a service.',criteria:[{id:'price',label:'Monthly price',unit:'USD'},{id:'projects',label:'Projects'},{id:'members',label:'Members'},{id:'exports',label:'Exports'},{id:'support',label:'Support'}],options:[
    {id:'starter',label:'Starter',summary:'For a personal project',values:{price:0,projects:2,members:1,exports:true,support:'Community'}},
    {id:'studio',label:'Studio',summary:'For a small working team',values:{price:18,projects:12,members:5,exports:true,support:'Email'}},
    {id:'team',label:'Team',summary:'For several active projects',values:{price:42,projects:40,members:15,exports:true,support:'Priority'}},
  ]},
};
export function everydaySpec(selected=false):SurfaceSpec{return {root:'everyday',elements:{
  everyday:node('Tabs',{labels:['Statistics','Compare plans','Private token'],stateKey:'everydayTab'},['statistics','plans','privateToken']),
  statistics:node('Stats',{dataBinding:'metrics',stateKey:'selectedMetric'}),
  plans:node('Stack',{gap:'md'},selected?['planComparison','selectedPlan']:['planComparison']),
  planComparison:node('Comparison',{dataBinding:'choices',stateKey:'planChoice',actionId:'choosePlan',actionLabel:'Save selected plan'}),
  privateToken:node('CredentialEntry',{slotKey:'projectApiToken',label:'API token',service:'Project API'}),
  ...(selected?{selectedPlan:node('Status',{dataBinding:'selection'})}:{}),
}};}
export function signingSpec(resourceId: string): SurfaceSpec {
  return { root: 'pair', elements: {
    pair: node('Split', { ratio: .51, gap: 'lg' }, ['pdf', 'steps']),
    pdf: node('DocumentPreview', { resourceId, title: 'Service agreement.pdf', fieldStateKeys: { Name: 'name', Title: 'title', Email: 'email', SignedDate: 'signedDate' }, activeFieldStateKey: 'step', signatureStateKey: 'signature', signatureBox: SIGNING_BOX }),
    steps: node('Steps', { stateKey: 'step', steps: [{ key: 'Name', label: 'Contractor' }, { key: 'Email', label: 'Notices' }, { key: 'signature', label: 'Signature' }, { key: 'review', label: 'Review' }] }, ['contractor', 'notices', 'mark', 'review']),
    contractor: node('ChoiceList', { stateKey: 'name', label: 'Who is signing?', options: [{ value: 'Alex Morgan', label: 'Alex Morgan', detail: 'Designer' }, { value: 'Acme Studio LLC', label: 'Acme Studio LLC', detail: 'Company' }] }),
    notices: node('Panel', {}, ['emails']),
    emails: node('ChoiceList', { stateKey: 'email', label: 'Where should notices go?', options: [{ value: 'alex@studio.example', label: 'Work', detail: 'alex@studio.example' }, { value: 'alex@home.example', label: 'Personal', detail: 'alex@home.example' }], custom: { label: 'Something else', placeholder: 'An email address' } }),
    mark: node('SignaturePad', { stateKey: 'signature', nameStateKey: 'name', label: 'Add your signature', initialMode: 'generate' }),
    review: node('Form', { actionId: 'sign', submitLabel: 'Sign & prepare export', payloadFromState: { name: 'name', email: 'email', signature: 'signature', accepted: 'accepted' } }, ['ready', 'accept']),
    ready: node('Text', { text: 'Your details are ready. Review the prepared local export before saving.', size: 'sm' }),
    accept: node('Toggle', { stateKey: 'accepted', label: 'I have reviewed these details' }),
  } };
}
export { graphSpec, graphData, type PRPhase } from './review-pr.ts';

export function migrationSpec(): SurfaceSpec {
  return { root: 'root', elements: {
    root: node('Stack', { gap: 'sm' }, ['outcome', 'schema', 'tables', 'sqlDetails']),
    outcome: node('Markdown', { dataBinding: 'migrationSummary' }),
    schema: node('RelationshipGraph', { dataBinding: 'migrationSchema', stateKey: 'table', orientation: 'horizontal', label: 'Workspace links' }),
    tables: node('Tabs', { stateKey: 'table', labels: ['workspaces', 'users', 'projects', 'messages'], statusBinding: 'migrationTabs' }, ['workspaces', 'users', 'projects', 'messages']),
    ...Object.fromEntries(['workspaces', 'users', 'projects', 'messages'].map(table => [table, node('Table', { rowsBinding: table, changesBinding: table + 'Changes', rowKey: 'id', columns: [{ key: 'id', label: 'id' }, { key: 'name', label: table === 'messages' ? 'message' : 'name' }, ...(table === 'workspaces' ? [] : [{ key: 'workspace', label: 'workspace_id' }])] })])),
    sqlDetails: node('Disclosure', { title: 'SQL and approval details', stateKey: 'migrationSqlOpen' }, ['sql']),
    sql: node('Code', { dataBinding: 'migrationSql', language: 'sql' }),
  } };
}
export function faqSpec(questions: { id: string; title: string; parent?: string }[]): SurfaceSpec {
  const roots = questions.filter(q => !q.parent).map(q => q.id);
  return { root: 'root', elements: {
    root: node('Stack', { gap: 'md' }, ['history', 'ask']), history: node('Stack', { gap: 'sm', scroll: 'bounded', label: 'Question history' }, roots),
    ...Object.fromEntries(questions.map(q => [q.id, node('Disclosure', { title: q.title, stateKey: q.id + 'Open', dataBinding: q.id, ...(q.id.startsWith('custom') && !q.parent ? { defaultOpen: true } : {}), onOpenActionId: 'answer', payload: { questionId: q.id } }, questions.filter(child => child.parent === q.id).map(child => child.id))])),
    ask: node('Form', { actionId: 'ask', submitLabel: 'Ask', payloadFromState: { question: 'question' }, clearOnSuccess: ['question'] }, ['question']),
    question: node('Input', { stateKey: 'question', label: 'Your question', placeholder: 'Type in your question…', required: true }),
  } };
}
export const MAP_DATA = {
  source: 'Bundled illustrative locations and routes; not live places or routing.',
  points: [{ id: 'boathouse', label: 'The Boathouse', x: 64, y: 55, category: 'Lakeside café', detail: 'Quiet mornings · Outlets · Lake view', address: 'Linden Park' }, { id: 'fern', label: 'Fern & Fig', x: 16, y: 34, category: 'Bakery café', detail: 'Bright tables · Outlets · Good espresso', address: 'West entrance' }, { id: 'lumen', label: 'Lumen Coffee', x: 86, y: 26, category: 'Coffee shop', detail: 'Fast Wi-Fi · Outlets · Open late', address: 'North entrance' }],
  routes: [{ id: 'walk', pointIds: ['fern', 'boathouse', 'lumen'], label: 'Illustrative walking connections' }],
};
export function mapSpec(): SurfaceSpec { return { root: 'map', elements: { map: node('MapView', { dataBinding: 'places', stateKey: 'place', themeStateKey: 'mapTheme', label: 'Around Linden Park', feedbackActionId: 'send' }) } }; }

export function catalogSpec(pdfId: string, pngId: string, annotationId=pngId): SurfaceSpec {
  const spec: SurfaceSpec = { root: 'catalog', elements: {
    catalog: node('Tabs', { labels: ['Controls', 'Data & visuals', 'Documents', 'Content', 'Development','Everyday','Interactions','Explore','Work objects'], stateKey: 'catalogTab' }, ['controls', 'data', 'documents', 'content','development','everyday','interactions','exploration','workObjects']),
    ...explorationElements(annotationId),
    controls: node('Grid', { columns: 2, gap: 'lg' }, ['controlPanel', 'stepPanel']),
    controlPanel: node('Panel', { title: 'Delivery' }, ['choice', 'input', 'select', 'toggle', 'form']),
    choice: node('ChoiceList', { stateKey: 'delivery', label: 'Delivery', options: [{ value: 'download', label: 'Download', detail: 'Local' }, { value: 'review', label: 'Review', detail: 'In conversation' }] }),
    input: node('Input', { stateKey: 'note', label: 'Review note', placeholder: 'Add a note' }),
    select: node('Select', { stateKey: 'density', label: 'Density', options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] }),
    toggle: node('Toggle', { stateKey: 'enabled', label: 'Keep selection on reload' }),
    form: node('Form', { actionId: 'inspect', submitLabel: 'Save choice', payloadFromState: { delivery: 'delivery', note: 'note' } }),
    stepPanel: node('Steps', { stateKey: 'catalogStep', steps: [{ key: 'one', label: 'Inspect' }, { key: 'two', label: 'Continue' }] }, ['stepOne', 'stepTwo']),
    stepOne: node('Text', { text: 'Review your delivery note before continuing.' }), stepTwo: node('Button', { label: 'Continue review', actionId: 'inspect', tone: 'primary' }),
    data: node('Stack', { gap: 'lg' }, ['metrics', 'table', 'chart', 'graph', 'map', 'timeline', 'tree', 'image']),
    metrics: node('Split', { ratio: .5 }, ['metric', 'progress']), metric: node('Metric', { label: 'Records', dataBinding: 'count' }), progress: node('Progress', { label: 'Reviewed records', dataBinding: 'progress', max: 12 }),
    table: node('Table', { rowsBinding: 'rows', stateKey: 'selectedRows', rowKey: 'id', columns: [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Count' }] }),
    chart: node('Chart', { title: 'Supplied counts', rowsBinding: 'rows', kind: 'bar', xKey: 'name', yKey: 'value' }),
    graph: node('RelationshipGraph', { dataBinding: 'graph', stateKey: 'node', orientation: 'horizontal', label: 'Linked evidence' }), map: node('MapView', { dataBinding: 'places', stateKey: 'place', themeStateKey: 'mapTheme', label: 'Explore places' }),
    timeline: node('Timeline', { rowsBinding: 'events' }), tree: node('Tree', { rowsBinding: 'tree' }), image: node('Image', { resourceId: pngId, alt: 'Locally generated color study' }),
    documents: node('Stack', { gap: 'lg' }, ['pdfPair', 'document', 'code', 'diff']), pdfPair: node('Split', { ratio: .55 }, ['pdf', 'signature']),
    pdf: node('DocumentPreview', { resourceId: pdfId, title: 'Catalog agreement.pdf', fieldStateKeys: { Name: 'name' }, signatureStateKey: 'signature', signatureBox: SIGNING_BOX }), signature: node('SignaturePad', { stateKey: 'signature', nameStateKey: 'name', label: 'Signature controls', initialMode: 'generate' }),
    document: node('Document', { title: 'Delivery brief', text: 'Confirm the delivery method and keep the original source attached.' }),
    code: node('Code', { code: 'const result = await inspect(source);', language: 'typescript' }), diff: node('Diff', { before: 'const value = 1;', after: 'const value = 2;' }),
    content: node('Stack', { gap: 'md' }, ['status', 'text', 'markdown', 'evidence', 'disclosure']), status: node('Status', { dataBinding: 'operation' }), text: node('Text', { text: 'Three groups are ready to review.' }),
    markdown: node('Markdown', { text: '**Evidence:** 8 items. **Review:** 5 items.' }), evidence: node('EvidenceList', { rowsBinding: 'evidence', title: 'Sources' }),
    disclosure: node('Disclosure', { title: 'What is included?', stateKey: 'detailOpen', text: 'Evidence: 8 items. Review: 5 items. Outcomes: 12 items.' }),
    development:node('Stack',{gap:'lg'},['diagnostics','changeSet','api','pipeline','comparison']),
    diagnostics:node('Diagnostics',{dataBinding:'diagnostics',stateKey:'selectedFailure'}),
    changeSet:node('ChangeSet',{dataBinding:'changeSet',stateKey:'selectedChange'}),
    api:node('ApiExplorer',{dataBinding:'api',stateKey:'selectedEndpoint'}),
    pipeline:node('Pipeline',{dataBinding:'pipeline',stateKey:'selectedStage'}),
    comparison:node('ImageCompare',{beforeResourceId:pngId,afterResourceId:pngId,stateKey:'catalogImageComparison'}),
    everyday:node('Stack',{gap:'lg'},['statistics','planComparison','privateToken']),
    statistics:node('Stats',{dataBinding:'metrics',stateKey:'selectedMetric'}),
    planComparison:node('Comparison',{dataBinding:'choices',stateKey:'planChoice',actionId:'inspect',actionLabel:'Save selected plan'}),
    privateToken:node('CredentialEntry',{slotKey:'projectApiToken',label:'API token',service:'Project API'}),
    interactions:node('Stack',{gap:'lg'},['reviewQueue','editableTable','exportProposal']),
    exportProposal:node('Split',{ratio:.55,gap:'md'},['exportSource','parameterControls']),
    exportSource:node('Image',{resourceId:annotationId,alt:'Source image for the export proposal'}),
    reviewQueue:node('ReviewQueue',{dataBinding:'reviewItems',stateKey:'reviewDraft',actionId:'inspect',actionLabel:'Send review'}),
    editableTable:node('EditableTable',{dataBinding:'editableRecords',stateKey:'recordEdits',actionId:'inspect',actionLabel:'Submit changes'}),
    parameterControls:node('ParameterControls',{dataBinding:'parameters',stateKey:'parameterDraft',actionId:'inspect',actionLabel:'Apply settings'}),
    workObjects: node('Tabs', { labels: ['Workflow', 'Architecture', 'Trace'], stateKey: 'workObjectTab' }, ['workflowBoard', 'architectureCanvas', 'traceWaterfall']),
    workflowBoard: node('WorkflowBoard', { dataBinding: 'workBoard', stateKey: 'workBoardDraft', actionId: 'inspect' }),
    architectureCanvas: node('ArchitectureCanvas', { dataBinding: 'workArchitecture', stateKey: 'workArchitectureView', actionId: 'inspect' }),
    traceWaterfall: node('TraceWaterfall', { dataBinding: 'workTrace', stateKey: 'workTraceView', actionId: 'inspect' }),
  } };
  return spec;
}
export function assertCatalogCoverage(spec: SurfaceSpec): string[] {
  validateSurface(spec); const covered = new Set(Object.values(spec.elements).map(element => element.type));
  const missing = CAPABILITIES.filter(capability => !covered.has(capability.name)).map(capability => capability.name);
  if (missing.length) throw new Error('Unrecorded catalog capabilities: ' + missing.join(', '));
  return [...covered].sort();
}
