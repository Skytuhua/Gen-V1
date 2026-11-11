/** Explicit recording fixtures. Never imported by the production host/runtime. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync, crc32 } from 'node:zlib';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { buildServer } from '../apps/server/server.ts';
import type { ArtifactRecord, DataRecord, Operation, ResourceGrant, RunContext, RuntimeAdapter, RuntimeCallbacks, StartRun, SurfaceSpec, Thread } from '../packages/contracts/index.ts';
import { createSigningPdfFixture } from '../tests/e2e/document-preview-fixture.ts';
import {SOFTWARE_FIXTURE_DATA} from './software-development-fixtures.ts';
import { catalogSpec, EVERYDAY_REVIEW_DATA, INTERACTION_REVIEW_DATA, faqSpec, graphData, graphSpec, MAP_DATA, mapSpec, migrationSpec, REVIEW_PROVENANCE, SIGNING_BOX, signingSpec, type PRPhase } from './review-fixtures.ts';
import {EXPLORATION_REVIEW_DATA,ANNOTATION_REVIEW_IMAGE} from './exploration-review-data.ts';
import { WORK_OBJECT_REVIEW_DATA } from './work-object-review-data.ts';

export type Scenario = 'signing' | 'pr-dark' | 'pr-light' | 'migration' | 'context' | 'faq' | 'map' | 'catalog' | 'shell';
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const questionRoots = [{ id: 'eligibility', title: 'Who can open an account?' }, { id: 'payments', title: 'How do payments work?' }, { id: 'cost', title: 'What does it cost?' }];
const answers: Record<string, { answer: string; followups?: { id: string; title: string }[] }> = {
  eligibility: { answer: 'Individuals and registered businesses can apply. Bring a valid ID and a supported address.', followups: [{ id: 'documents', title: 'What documents do I need?' }] },
  documents: { answer: 'A photo ID and recent proof of address are enough for most applicants.', followups: [{ id: 'approval', title: 'How long does approval take?' }] },
  approval: { answer: 'Applications are usually reviewed within two business days.' },
  payments: { answer: 'Send local or international transfers from the same account. Review the destination and fee before confirming.', followups: [{ id: 'international', title: 'How long do international transfers take?' }] },
  international: { answer: 'Local rails may settle the same day. International timing depends on the destination and network.', followups: [{ id: 'currencies', title: 'Which currencies can I hold?' }] },
  currencies: { answer: 'You can hold USD, EUR and GBP.' },
  cost: { answer: 'There is no monthly fee. Transfer fees are shown before confirmation.' },
};
export class ReviewRuntime implements RuntimeAdapter {
  callbacks!: RuntimeCallbacks;
  service!: Service;
  scenarios = new Map<string, Scenario>();
  aliases = new Map<string, Map<string, string>>();
  questions = new Map<string, { id: string; title: string; parent?: string }[]>();
  grants = new Map<string, { pdf: string; output: string; image: string; database: string; annotation?:string }>();
  controllers = new Map<string, AbortController>();
  beforeMigrationTable?: (table: string) => Promise<void>;
  constructor(readonly store: Store, readonly folder: string) {}
  configure(callbacks: RuntimeCallbacks) { this.callbacks = callbacks; }
  async models() { return [{ id: 'review/local-fixture', provider: 'recording fixture', name: 'Local UI demo · no model inference' }]; }
  async history(path: string): Promise<string[]> { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return []; } }
  async start(input: StartRun) { await this.deliver(input); }
  async followUp(input: StartRun) { await this.deliver(input); }
  async cancel(ctx: RunContext) { this.controllers.get(ctx.runId)?.abort(); }
  async dispose() { this.controllers.forEach(controller => controller.abort()); }
  async compact(ctx: RunContext) {
    this.callbacks.onEvent({ ...ctx, type: 'usage', usage: { activity: 'compacting' } });
    await pause(1800); this.service.assertRun(ctx);
    this.callbacks.onEvent({ ...ctx, type: 'usage', usage: { contextTokens: 76700, inputTokens: 21000, outputTokens: 14200, contextBreakdown: [{ label: 'System', tokens: 18000 }, { label: 'Tools', tokens: 15500 }, { label: 'Skills', tokens: 12000 }, { label: 'Messages', tokens: 14200 }, { label: 'Reserved', tokens: 17000 }], sessionPercent: 69, activity: 'idle' } });
    this.callbacks.onEvent({ ...ctx, type: 'settled', aborted: false });
  }
  private event(input: StartRun, type: string, extra: Record<string, unknown> = {}) { this.callbacks.onEvent({ threadId: input.threadId, runId: input.runId, epoch: input.epoch, type, ...extra }); }
  private alias(threadId: string) { let values = this.aliases.get(threadId); if (!values) { values = new Map(); this.aliases.set(threadId, values); } return values; }
  source(ctx: RunContext, alias: string, value: unknown) {
    this.service.assertRun(ctx); const refs = this.alias(ctx.threadId), id = refs.get(alias) ?? randomUUID(); refs.set(alias, id);
    const old = this.store.get<DataRecord>('data', id);
    const data: DataRecord = { id, threadId: ctx.threadId, revision: (old?.revision ?? 0) + 1, value, provenance: REVIEW_PROVENANCE, createdAt: new Date().toISOString() };
    this.store.internal('review.fixture-data', ctx.threadId, () => { this.store.put('data', id, ctx.threadId, data); this.store.put('dataVersion', `${id}@${data.revision}`, ctx.threadId, data); });
  }
  private async present(input: StartRun, spec: SurfaceSpec, title: string, actions: Record<string, unknown> = {}) {
    const existing = this.store.all<ArtifactRecord>('artifact', input.threadId)[0];
    const bindings = Object.fromEntries([...this.alias(input.threadId)].map(([alias, id]) => [alias, { mode: 'live', id }]));
    const scenario = this.scenarios.get(input.threadId);
    return this.service.tool({ name: 'ui_present', args: { ...(existing ? { artifactId: existing.id, baseRevision: existing.revision } : { initialState: { name: 'Alex Morgan', title: 'Designer', signedDate: 'October 30, 2026', place: 'boathouse', table: 'workspaces' } }), title, purpose: REVIEW_PROVENANCE, spec, bindings, actions, presentation: { width: scenario === 'faq' || scenario?.startsWith('pr-') ? 'compact' : 'standard', frame: scenario === 'faq' ? 'canvas' : 'card' } } }, input);
  }
  private async deliver(input: StartRun) {
    const controller = new AbortController(); this.controllers.set(input.runId, controller);
    const check = () => { controller.signal.throwIfAborted(); this.service.assertRun(input); };
    const delay = async (ms: number) => { await pause(ms); check(); };
    check();
    const sessionPath = join(this.folder, `review-session-${input.threadId}.json`);
    const ids = input.inputIds ?? [input.inputId]; await writeFile(sessionPath, JSON.stringify([...new Set([...await this.history(sessionPath), ...ids])]));
    this.event(input, 'session', { sessionPath }); this.event(input, 'input.processing', { inputIds: ids });
    const scenario = this.scenarios.get(input.threadId) ?? 'shell';
    const existing = this.store.all<ArtifactRecord>('artifact', input.threadId)[0];
    const accepted = this.store.all<{ actionId: string; payload: Record<string, unknown>; submittedState: Record<string, unknown>; acceptedAt: string }>('acceptedAction', input.threadId).sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))[0];
    this.event(input, 'assistant.message', { messageId: randomUUID(), content: !existing ? scenario === 'faq' ? 'Explore a question, or ask your own.' : scenario === 'signing' ? 'I found the fields. Let’s fill in the remaining details.' : scenario.startsWith('pr-') ? 'The branches overlap in three places.' : scenario === 'migration' ? 'The local migration is ready for exact review.' : scenario === 'map' ? 'Three places to compare. Choose a marker or use the carousel.' : '' : '', inputIds: ids });
    try {
      const grants = this.grants.get(input.threadId)!;
      if (scenario === 'signing') {
        const exported = this.store.all<Operation>('operation', input.threadId).find(op => op.kind === 'pdf.export' && op.status === 'succeeded');
        if (exported) {
          const result = exported.result as { resourceId: string; path: string };
          this.source(input, 'receipt', { operationId: exported.id, status: exported.status, description: 'Export saved', result: { path: result.path } });
          await this.present(input, { root: 'pair', elements: {
            pair: { type: 'Split', props: { ratio: .51 }, children: ['pdf', 'completion'] },
            pdf: { type: 'DocumentPreview', props: { resourceId: result.resourceId, resourcePath: result.path, title: 'Signed service agreement.pdf', fit: 'page', exportOperationId: exported.id } },
            completion: { type: 'Panel', props: { align: 'center' }, children: ['receipt', 'download'] },
            receipt: { type: 'Status', props: { dataBinding: 'receipt', presentation: 'receipt', label: 'Signed for ' + String(accepted?.submittedState.name ?? 'the contractor') } },
            download: { type: 'Document', props: { resourceId: result.resourceId, resourcePath: result.path, title: 'Signed agreement', linkLabel: 'Download PDF', download: true } },
          } }, 'Service agreement.pdf');
          await this.service.tool({ name: 'task_finish', args: { outcome: 'Prepared local PDF export verified and saved', evidence: [exported.result] } }, input);
        } else if (accepted?.actionId === 'sign') {
          const state = accepted.submittedState, signature = state.signature as Record<string, unknown> | undefined;
          if (state.accepted !== true || !signature) throw new Error('Review and add a signature before continuing.');
          const operation = await this.service.tool({ name: 'pdf_prepare', args: { resourceId: grants.pdf, exportResourceId: grants.output, outputPath: 'signed-agreement.pdf', fields: { Name: String(state.name), Title: String(state.title), Email: String(state.email), SignedDate: String(state.signedDate) }, signatures: [{ ...signature, ...SIGNING_BOX }] } }, input) as Operation;
          const spec = signingSpec(grants.pdf); spec.elements.review = { type: 'Panel', props: { title: 'Prepared local export' }, children: ['ready', 'accept', 'export'] }; spec.elements.export = { type: 'Button', props: { label: 'Review local export', actionId: 'export', tone: 'primary' } };
          await this.present(input, spec, 'Service agreement.pdf', { export: { kind: 'operation', operationId: operation.id } });
        } else await this.present(input, signingSpec(grants.pdf), 'Service agreement.pdf', { sign: { kind: 'agent', prompt: 'Prepare the reviewed local PDF export' } });
      } else if (scenario.startsWith('pr-')) {
        const orientation = 'vertical';
        const actions = { resolve: { kind: 'agent', prompt: 'Resolve the recorded branch conflicts' }, merge: { kind: 'agent', prompt: 'Merge the recorded pull request' } };
        let phase: PRPhase = 'conflicts';
        if (!existing) {
          for (const entry of ['preparing', 'checking'] as const) {
            this.source(input, 'graph', graphData(entry)); await this.present(input, graphSpec(orientation, entry), 'Session refresh', actions); await delay(900);
          }
        }
        if (existing && accepted?.actionId === 'resolve') {
          phase = 'resolving'; this.source(input, 'graph', graphData(phase)); await this.present(input, graphSpec(orientation, phase), 'Session refresh', actions);
          for (const count of [8, 20, 34, 42]) { await delay(800); this.source(input, 'graph', graphData(phase, count)); }
          phase = 'ready';
        } else if (existing && accepted?.actionId === 'merge') {
          phase = 'merging'; this.source(input, 'graph', graphData(phase)); await this.present(input, graphSpec(orientation, phase), 'Session refresh', actions); await delay(1400); phase = 'merged';
        }
        this.source(input, 'graph', graphData(phase));
        await this.present(input, graphSpec(orientation, phase), 'Session refresh', actions);
      } else if (scenario === 'faq') {
        let questions = this.questions.get(input.threadId); if (!questions) { questions = [...questionRoots]; this.questions.set(input.threadId, questions); }
        if (!existing) for (const question of questions) this.source(input, question.id, { status: 'idle' });
        if (existing && accepted) {
          const id = accepted.actionId === 'ask' ? `custom${questions.length}` : String(accepted.payload.questionId);
          if (accepted.actionId === 'ask') { questions.push({ id, title: String(accepted.payload.question).slice(0, 200) }); this.source(input, id, { status: 'pending' }); await this.present(input, faqSpec(questions), 'Questions & answers', { answer: { kind: 'agent' }, ask: { kind: 'agent' } }); }
          const entry = answers[id] ?? { answer: 'Yes, wire transfers are supported. Review the destination and fee before confirming.', followups: [{ id: id + 'plans', title: 'Can I change plans later?' }] };
          this.source(input, id, { status: 'pending' }); await delay(450);
          const words = entry.answer.split(' ');
          for (let n = 5; n < words.length + 5; n += 5) { this.source(input, id, { status: n >= words.length ? 'ready' : 'pending', answer: words.slice(0, n).join(' ') }); await delay(130); }
          this.source(input, id, { status: 'ready', answer: entry.answer, followupsPending: Boolean(entry.followups?.length) });
          if (entry.followups?.length) await delay(600);
          for (const child of entry.followups ?? []) if (!questions.some(question => question.id === child.id)) { questions.push({ ...child, parent: id }); this.source(input, child.id, { status: 'idle' }); }
          this.source(input, id, { status: 'ready', answer: entry.answer });
        }
        await this.present(input, faqSpec(questions), 'Questions & answers', { answer: { kind: 'agent', prompt: 'Answer this question and add a relevant follow-up' }, ask: { kind: 'agent', prompt: 'Add and answer the submitted question' } });
      } else if (scenario === 'map') {
        if (!existing) { this.source(input, 'places', MAP_DATA); await this.present(input, mapSpec(), 'Around Linden Park', { send: { kind: 'agent', prompt: 'Record the selected-place delivery intent; no phone integration' } }); }
        else { await delay(650); this.event(input, 'assistant.message', { messageId: randomUUID(), content: 'Selection saved.', inputIds: ids }); }
      } else if (scenario === 'migration') {
        const tables = ['workspaces', 'users', 'projects', 'messages'];
        const schema = (verified: string[] = []) => ({
          nodes: [{ id: 'workspaces', label: 'workspaces.id', detail: 'New table: id, name', kind: 'endpoint', column: 2, lane: 1, status: verified.includes('workspaces') ? 'success' : 'neutral' }, ...['users', 'projects', 'messages'].map((id, lane) => ({ id, label: `${id}.workspace_id`, detail: 'Assignment to a workspace', kind: 'endpoint', column: 0, lane, status: verified.includes(id) ? 'success' : 'neutral' }))],
          edges: ['users', 'projects', 'messages'].map(from => ({ from, to: 'workspaces', label: 'workspace_id → id', status: verified.includes(from) ? 'success' : 'neutral' })),
          branchLabels: [{ label: 'workspace_id → id', lane: 1, column: 1 }, { label: 'New table · id, name', lane: 1, column: 2 }],
          source: 'Workspace assignments from the prepared SQL and committed SQLite records. This migration adds no foreign-key constraint.',
        });
        const statements = [
          { sql: "CREATE TABLE workspaces AS SELECT 1 AS id,'Acme Studio' AS name UNION ALL SELECT 2,'Fieldwork' UNION ALL SELECT 3,'Personal'" },
          ...['users', 'projects', 'messages'].map(table => ({ sql: `UPDATE ${table} SET workspace_id=((id-1)%3)+1`, expectedChanges: 12 })),
        ];
        const operation = this.store.all<Operation>('operation', input.threadId).find(op => op.kind === 'database.migration');
        if (!operation) {
          // Preparation still authorizes exact SQL without applying it.
          const prepared = await this.service.tool({ name: 'database_prepare', args: { resourceId: grants.database, mode: 'migration', statements } }, input) as Operation;
          this.source(input, 'operation', { status: 'pending', label: 'Migration prepared', detail: 'Local SQLite · 4 tables · exact approval required' });
          this.source(input, 'migrationSchema', schema());
          this.source(input, 'migrationSummary', '**3 new workspaces** · **36 existing records to link**');
          this.source(input, 'migrationSql', statements.map(statement => statement.sql + ';').join('\n\n'));
          this.source(input, 'migrationTabs', { detail: 'Current records · changes await approval', status: 'pending', items: tables.map(label => ({ label, status: 'neutral' })) });
          for (const table of tables) { const rows = table === 'workspaces' ? [] : ((await this.service.tool({ name: 'database_inspect', args: { resourceId: grants.database, table, limit: 12 } }, input) as DataRecord).value as { rows: Record<string, unknown>[] }).rows; this.source(input, table, rows.map(row => ({ id: row.id, name: row.name, workspace: null }))); this.source(input, table + 'Changes', { rows: [] }); }
          const spec = migrationSpec(); spec.elements.root.children!.push('run'); spec.elements.run = { type: 'Button', props: { actionId: 'run', label: 'Review local migration', tone: 'primary' } };
          await this.present(input, spec, 'Add workspace ownership', { run: { kind: 'operation', operationId: prepared.id } });
        } else if (operation.status === 'succeeded') {
          this.source(input, 'operation', { operationId: operation.id, status: 'succeeded', description: 'Applied locally', result: operation.result });
          this.source(input, 'migrationSummary', '**Migration committed** · inspecting stored records');
          const inspected: string[] = [], counts = new Map<string, number>();
          for (const table of tables) {
            const value = await this.service.tool({ name: 'database_inspect', args: { resourceId: grants.database, table, limit: 12 } }, input) as DataRecord;
            const rows = (value.value as { rows: Record<string, unknown>[] }).rows; counts.set(table, rows.length);
            // The recording driver selects this table before publishing its real
            // committed read, so value/highlight motion is not hidden in a tab.
            await this.beforeMigrationTable?.(table); check();
            this.source(input, table, rows.map(row => ({ id: row.id, name: row.name, workspace: row.workspace_id ?? null })));
            this.source(input, table + 'Changes', { revision: 1, activeRowId: rows.at(-1) ? String(rows.at(-1)!.id) : undefined, rows: rows.map(row => ({ id: String(row.id), status: table === 'workspaces' ? 'added' : 'updated', cells: [{ key: table === 'workspaces' ? 'name' : 'workspace', status: table === 'workspaces' ? 'added' : 'updated', before: null }] })) });
            inspected.push(table);
            this.source(input, 'migrationSchema', schema(inspected));
            this.source(input, 'migrationTabs', { detail: `${inspected.length} of ${tables.length} tables verified`, status: 'success', items: tables.map(label => ({ label, status: inspected.includes(label) ? 'success' : 'neutral' })) });
            await delay(950);
          }
          this.source(input, 'migrationSummary', `**${counts.get('workspaces')} workspaces created** · **${tables.slice(1).reduce((total, table) => total + counts.get(table)!, 0)} records linked**`);
          this.source(input, 'migrationTabs', { detail: 'Committed records · all 4 tables verified', status: 'success', items: tables.map(label => ({ label, status: 'success' })) });
          await this.present(input, migrationSpec(), 'Add workspace ownership');
          await this.service.tool({ name: 'task_finish', args: { outcome: 'Local SQLite migration committed', evidence: [operation.result] } }, input);
        }
      } else if (scenario === 'context') {
        this.event(input, 'usage', { usage: { contextTokens: 604100, contextWindow: 1000000, inputTokens: 38000, outputTokens: 14200, cost: null, sessionPercent: 68, weeklyPercent: 24, activity: 'idle', contextBreakdown: [{ label: 'System', tokens: 18000 }, { label: 'Tools', tokens: 15500 }, { label: 'Skills', tokens: 12000 }, { label: 'Messages', tokens: 541600 }, { label: 'Reserved', tokens: 17000 }] } });
      } else {
        this.source(input, 'rows', [{ id: 'a', name: 'Evidence', value: 8 }, { id: 'b', name: 'Review', value: 5 }, { id: 'c', name: 'Outcome', value: 12 }]); this.source(input, 'count', 12); this.source(input, 'progress', 8); this.source(input, 'places', MAP_DATA); this.source(input, 'graph', graphData('ready'));
        this.source(input, 'events', [{ title: 'Source imported', status: 'success' }, { title: 'Review accepted', status: 'success' }, { title: 'Next observation', status: 'running' }]); this.source(input, 'tree', [{ label: 'Project', children: [{ label: 'source.ts' }, { label: 'source.test.ts' }] }]); this.source(input, 'operation', { status: 'success', label: accepted ? 'Choice saved locally' : 'Catalog ready',  }); this.source(input, 'evidence', [{ label: 'Bundled source', source: 'Local review fixture' }]);
        for(const [alias,name] of [['diagnostics','Diagnostics'],['changeSet','ChangeSet'],['api','ApiExplorer'],['pipeline','Pipeline']] as const)this.source(input,alias,SOFTWARE_FIXTURE_DATA[name]);
        this.source(input,'metrics',EVERYDAY_REVIEW_DATA.Stats);this.source(input,'choices',EVERYDAY_REVIEW_DATA.Comparison);this.source(input,'schedule',EXPLORATION_REVIEW_DATA.schedule);this.source(input,'logs',EXPLORATION_REVIEW_DATA.logs);
        this.source(input,'reviewItems',INTERACTION_REVIEW_DATA.ReviewQueue);this.source(input,'editableRecords',INTERACTION_REVIEW_DATA.EditableTable);this.source(input,'parameters',INTERACTION_REVIEW_DATA.ParameterControls);
        this.source(input, 'workBoard', WORK_OBJECT_REVIEW_DATA.board); this.source(input, 'workArchitecture', WORK_OBJECT_REVIEW_DATA.architecture); this.source(input, 'workTrace', WORK_OBJECT_REVIEW_DATA.trace);
         await this.present(input, catalogSpec(grants.pdf, grants.image,grants.annotation || grants.image), 'Component catalog', { inspect: { kind: 'agent', prompt: 'Acknowledge the submitted local choice' } });
      }
      check(); this.event(input, 'settled', { aborted: false });
    } catch (error) { if (controller.signal.aborted) this.event(input, 'settled', { aborted: true }); else this.event(input, 'error', { message: error instanceof Error ? error.message : String(error) }); }
    finally { this.controllers.delete(input.runId); }
  }
}

export function reviewColorStudyPng(): Buffer {
  const width = 256, height = 144, pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    const color = x < width / 3 ? [41, 65, 91] : x < width * 2 / 3 ? [212, 143, 93] : [115, 153, 137];
    pixels.set([...color.map(channel => Math.round(channel * (.78 + .22 * y / (height - 1)))), 255], offset);
  }
  const chunk = (kind: string, data: Buffer) => { const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(kind, 4, 4, 'ascii'); data.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export async function openReviewHost(folder: string, port = 4347) {
  await mkdir(join(folder, 'resources', 'exports'), { recursive: true });
  const source = join(folder, 'resources', 'agreement.pdf'), image = join(folder, 'resources', 'mark.png'), database = join(folder, 'resources', 'project.sqlite');
  await writeFile(source, await createSigningPdfFixture({ pages: 2 }), { flag: 'wx' });
  await writeFile(image, reviewColorStudyPng(), { flag: 'wx' });
  const db = new DatabaseSync(database); db.exec('PRAGMA journal_mode=DELETE');
  for (const table of ['users', 'projects', 'messages']) { db.exec(`CREATE TABLE ${table}(id INTEGER PRIMARY KEY,name TEXT,workspace_id INTEGER)`); for (let n = 1; n <= 12; n++) db.prepare(`INSERT INTO ${table}(id,name) VALUES(?,?)`).run(n, table === 'messages' ? `Design note ${n}` : ['Alex', 'Morgan', 'Lena', 'Sam'][n % 4] + (table === 'projects' ? ' project' : '')); } db.close();
  const store = new Store(join(folder, 'state')), runtime = new ReviewRuntime(store, folder), service = new Service(store, runtime); runtime.service = service; await service.recover();
  const app = await buildServer(service, { port, dev: false }); await app.listen({ port, host: '127.0.0.1' });
  const threads = new Map<Scenario, Thread>();
  for (const scenario of ['signing', 'pr-dark', 'pr-light', 'migration', 'context', 'faq', 'map', 'catalog', 'shell'] as Scenario[]) {
    const thread = (await service.command({ id: randomUUID(), type: 'thread.create', payload: { title: ({ signing: 'Sign the service agreement', 'pr-dark': 'Review session refresh', 'pr-light': 'Resolve branch overlap', migration: 'Add workspaces', context: 'Inspect context', faq: 'Account questions', map: 'Find a quiet café', catalog: 'Explore the component catalog', shell: 'Workspace & settings' })[scenario], projectName: 'UI review recordings' } })).result as Thread;
    threads.set(scenario, thread); runtime.scenarios.set(thread.id, scenario);
    const grant = async (path: string, kind: ResourceGrant['kind'], writable = false) => (await service.command({ id: randomUUID(), type: 'resource.grant', threadId: thread.id, payload: { path, kind, writable } })).result as ResourceGrant;
    const grants = { pdf: '', output: '', image: '', database: '', annotation:'' };
    if (['signing', 'catalog', 'shell'].includes(scenario)) grants.pdf = (await grant(source, 'file')).id;
    if (scenario === 'signing') grants.output = (await grant(join(folder, 'resources', 'exports'), 'export', true)).id;
    if (['catalog', 'shell'].includes(scenario)) grants.image = (await grant(image, 'file')).id;
    if (scenario === 'migration') grants.database = (await grant(database, 'database', true)).id;
    if(scenario==='catalog'){const annotation=join(folder,'resources','export-panel.svg');await writeFile(annotation,ANNOTATION_REVIEW_IMAGE);grants.annotation=(await grant(annotation,'file')).id;}
    runtime.grants.set(thread.id, grants);
  }
  return { app, service, store, runtime, threads, async close() { await app.close(); await service.dispose(); store.close(); } };
}
