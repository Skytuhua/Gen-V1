import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {HarnessError, type Snapshot, type Thread, type LearningStatus, type RuntimeUsage} from '../contracts/index.ts';
import {getPreferences, preferencesSchema} from '../contracts/preferences.ts';
import {isConnectionProviderId} from '../contracts/connections.ts';
import type {ConnectionAccount} from '../contracts/accounts.ts';
import type {SkillSummary, SkillProposalSummary} from '../contracts/skills.ts';
import type {DraftTransferReferences, NavigationPage, ShellPage, ShellResourceRow, ShellSettingsReadModel, ThreadNavigationRow} from '../contracts/shell-read-models.ts';
import {digest, type Store} from '../storage/store.ts';

const preferences = z.object({...preferencesSchema.shape, keybindings: z.object(preferencesSchema.shape.keybindings.shape)});
const pageInput = z.strictObject({limit: z.number().int().min(1).max(100).default(50), cursor: z.string().max(2048).optional()});
const navInput = pageInput.extend({archived: z.boolean().default(false), text: z.string().trim().max(200).default('')});
type Owner = ThreadNavigationRow & Pick<Thread, 'sideParentId'>;
const invalidCursor = () => new HarnessError('INVALID_CURSOR', 'Reload this metadata list.');
const known = <T extends object>(value: T, keys: readonly (keyof T)[]): T => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])) as T;

/** Metadata-only Personal read model. Fixed SQL fields keep bodies outside JS. */
export class ShellReadModels {
  private readonly secret = randomBytes(32);
  constructor(private readonly store: Store) {}
  private records<T>(kind: string, fields: string[], where = '', args: (string | number)[] = []): T[] {
    // Field lists and predicates are private constant call sites, never client input.
    const columns = fields.map(field => `'${field}',json_extract(body,'$.${field}')`).join(',');
    return (this.store.db.prepare(`SELECT json_object(${columns}) AS metadata FROM entities WHERE kind=? ${where}`).all(kind, ...args) as {metadata: string}[]).map(row => JSON.parse(row.metadata) as T);
  }
  private owners() {
    const projects = new Map(this.records<{id: string; authority: {kind?: string} | null}>('workspaceProject', ['id', 'authority']).map(project => [project.id, project]));
    const all = this.records<Owner>('thread', ['id', 'title', 'projectId', 'projectName', 'createdAt', 'updatedAt', 'status', 'runId', 'kind', 'parentThreadId', 'sideParentId', 'presentation'], "AND json_extract(body,'$.id')=id AND (thread_id IS NULL OR thread_id=id)");
    const byId = new Map(all.map(thread => [thread.id, thread]));
    const personal = (thread: Owner) => {
      const seen = new Set<string>(); let current: Owner | undefined = thread;
      while (current) {
        if (seen.has(current.id) || seen.size >= 8) return false; seen.add(current.id);
        const project = current.projectId ? projects.get(current.projectId) : undefined;
        if (project && project.authority?.kind !== 'local') return false;
        const parent = current.sideParentId ?? current.parentThreadId;
        if (!parent) return current.kind !== 'delegate' && current.kind !== 'side';
        current = byId.get(parent); if (!current) return false;
      }
      return false;
    };
    const archived = new Set((this.store.db.prepare("SELECT id FROM entities WHERE kind='archivedThread' AND body='true'").all() as {id: string}[]).map(row => row.id));
    return {all: all.filter(personal), archived};
  }
  private row(thread: Owner): ThreadNavigationRow {
    const {id, title, projectId, projectName, createdAt, updatedAt, status, runId, kind, parentThreadId, presentation} = thread;
    return {id, title, projectName, createdAt, updatedAt, status, runId, ...(projectId ? {projectId} : {}), ...(kind ? {kind} : {}), ...(parentThreadId ? {parentThreadId} : {}), ...(presentation ? {presentation: {pinned: presentation.pinned === true, unread: presentation.unread === true, settled: presentation.settled === true, ...(typeof presentation.order === 'number' ? {order: presentation.order} : {})}} : {})};
  }
  private page<T extends {id: string}>(rows: T[], query: z.infer<typeof pageInput>, scope: unknown): ShellPage<T> {
    const scopeKey = digest(scope), membership = digest(rows.map(row => row.id)); let index = 0;
    if (query.cursor) {
      const [payload, signature, extra] = query.cursor.split('.');
      if (!payload || extra || !/^[\w-]+$/.test(payload) || !/^[\w-]{43}$/.test(signature ?? '')) throw invalidCursor();
      const expected = createHmac('sha256', this.secret).update(payload).digest(), supplied = Buffer.from(signature, 'base64url');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalidCursor();
      let value: {scope: string; membership: string; after: string};
      try {value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));} catch {throw invalidCursor();}
      if (value.scope !== scopeKey || value.membership !== membership || (index = rows.findIndex(row => row.id === value.after) + 1) < 1) throw invalidCursor();
    }
    const items = rows.slice(index, index + query.limit); let nextCursor: string | null = null;
    if (index + items.length < rows.length) {
      const payload = Buffer.from(JSON.stringify({scope: scopeKey, membership, after: items.at(-1)!.id})).toString('base64url');
      nextCursor = payload + '.' + createHmac('sha256', this.secret).update(payload).digest('base64url');
    }
    return {sequence: this.store.sequence, total: rows.length, items, nextCursor};
  }
  navigation(input: unknown): NavigationPage {
    const query = navInput.parse(input), {all, archived} = this.owners(), text = query.text.toLocaleLowerCase();
    const rows = all.filter(thread => !thread.sideParentId && thread.kind !== 'side' && archived.has(thread.id) === query.archived && (!text || (thread.title + ' ' + (thread.projectName ?? '')).toLocaleLowerCase().includes(text))).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(thread => this.row(thread));
    const order = rows.map(row => row.presentation?.order ?? 0);
    return {...this.page(rows, query, {kind: 'navigation', archived: query.archived, text}), order: 'created-desc', stats: {pinned: rows.filter(row => row.presentation?.pinned).length, working: rows.filter(row => row.runId || row.status === 'working').length, waiting: rows.filter(row => row.status === 'awaiting_input').length, settled: rows.filter(row => row.presentation?.settled).length, minOrder: Math.min(0, ...order), maxOrder: Math.max(0, ...order)}};
  }
  navigationItem(id: string): ThreadNavigationRow {
    const {all, archived} = this.owners();
    const row = all.find(thread => thread.id === id && !archived.has(id) && !thread.sideParentId && thread.kind !== 'side');
    if (!row) throw new HarnessError('NOT_FOUND', 'Conversation metadata is unavailable.');
    return this.row(row);
  }
  archive(input: unknown = {}): ShellPage<ThreadNavigationRow> {
    const query = pageInput.parse(input), {all, archived} = this.owners();
    const rows = all.filter(thread => archived.has(thread.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map(thread => this.row(thread));
    return this.page(rows, query, {kind: 'archive'});
  }
  private visibleIds() {const {all, archived} = this.owners(); return all.filter(thread => !archived.has(thread.id)).map(thread => thread.id);}
  private visibleWhere() {return "AND (thread_id IS NULL OR thread_id IN (SELECT value FROM json_each(?)))";}
  resources(input: unknown = {}): ShellPage<ShellResourceRow> {
    const query = pageInput.parse(input), ids = this.visibleIds();
    const rows = this.records<ShellResourceRow>('resource', ['id', 'threadId', 'kind', 'label', 'writable', 'path'], this.visibleWhere() + " AND thread_id=json_extract(body,'$.threadId') AND id=json_extract(body,'$.id')", [JSON.stringify(ids)]).map(row => ({...row, writable: Boolean(row.writable)})).sort((a, b) => a.id.localeCompare(b.id));
    return this.page(rows, query, {kind: 'resources'});
  }
  settings(): ShellSettingsReadModel {
    const {all, archived} = this.owners(), visible = all.filter(thread => !archived.has(thread.id)), ids = visible.map(thread => thread.id), where = this.visibleWhere();
    const count = (kind: string, extra = '') => Number((this.store.db.prepare('SELECT COUNT(*) AS n FROM entities WHERE kind=? ' + where + extra).get(kind, JSON.stringify(ids)) as {n: number}).n);
    const stored = this.store.get<Snapshot['settings']>('settings', 'global') ?? {theme: 'dark', modelId: null};
    const settings: Snapshot['settings'] = {theme: stored.theme === 'light' || stored.theme === 'system' ? stored.theme : 'dark', modelId: typeof stored.modelId === 'string' ? stored.modelId : null, selectedAccounts: Object.fromEntries(Object.entries(stored.selectedAccounts ?? {}).filter(([key, value]) => isConnectionProviderId(key) && (value === null || typeof value === 'string'))), preferences: preferences.parse(getPreferences(stored))};
    const accounts = this.records<ConnectionAccount>('account', ['id', 'providerId', 'label', 'enabled', 'createdAt', 'updatedAt']).map(row => ({...row, enabled: Boolean(row.enabled)}));
    const skills = this.records<SkillSummary>('skill', ['name', 'description', 'category', 'revision', 'state', 'enabled', 'protected', 'origin', 'managed', 'author', 'sourceThreadId', 'sourceRunId', 'createdAt', 'updatedAt', 'lastUsedAt', 'useCount', 'patchCount', 'migrationError']).map(skill => {const usage = this.store.get<{count: number; lastUsedAt: string}>('skillUsage', skill.name); return {...skill, enabled: Boolean(skill.enabled), protected: Boolean(skill.protected), managed: Boolean(skill.managed), ...(usage ? {useCount: usage.count, lastUsedAt: usage.lastUsedAt} : {})};});
    const skillProposals = this.records<SkillProposalSummary>('skillProposal', ['id', 'createdAt', 'status', 'actor', 'targets'], "AND json_extract(body,'$.status')='pending'").map(proposal => ({...proposal, actor: known(proposal.actor, ['kind', 'threadId', 'runId', 'evidence'])}));
    const [learning] = this.records<LearningStatus>('learningStatus', ['supported', 'status', 'lastReview', 'lastCuratedAt'], 'AND id=?', ['global']);
    if (learning?.lastReview) {
      learning.lastReview = known(learning.lastReview, ['sourceThreadId', 'sourceRunId', 'modelId', 'accountId', 'status', 'startedAt', 'finishedAt', 'toolCalls', 'inputBytes', 'appliedChanges', 'usage', 'error', 'cleanupConfirmed', 'engine', 'summary']);
      if (learning.lastReview.usage) {
        const usage = known<Partial<RuntimeUsage>>(learning.lastReview.usage, ['contextTokens', 'contextWindow', 'inputTokens', 'outputTokens', 'cost', 'activity', 'sessionPercent', 'weeklyPercent', 'contextBreakdown']);
        if (usage.contextBreakdown) usage.contextBreakdown = usage.contextBreakdown.map(item => known(item, ['label', 'tokens']));
        learning.lastReview.usage = usage;
      }
    }
    const projectMap = new Map(visible.filter(thread => thread.projectId).map(thread => [thread.projectId!, {id: thread.projectId!, name: thread.projectName ?? 'Project'}]));
    const resourcePage = this.resources({limit: 100});
    return {sequence: this.store.sequence, settings, accounts, skills, skillProposals, learning: learning ? {...learning, supported: Boolean(learning.supported)} : {supported: false, status: 'idle', lastReview: null}, projects: [...projectMap.values()], resources: resourcePage.items, resourcePage: {total: resourcePage.total, nextCursor: resourcePage.nextCursor}, counts: {threads: visible.length, archivedThreads: all.filter(thread => archived.has(thread.id)).length, artifacts: count('artifact'), resources: resourcePage.total, uncertainOperations: count('operation', " AND json_extract(body,'$.status')='unknown'")}};
  }
  draftReferences(keys: string[]): DraftTransferReferences {
    const visible = new Set(this.visibleIds()), references: DraftTransferReferences = {threads: [], skills: [], userStates: [], requests: []};
    for (const key of new Set(keys)) {
      if (key.startsWith('draft:') || key.startsWith('thinking:')) {const id = key.slice(key.indexOf(':') + 1); if (visible.has(id)) references.threads.push({id});}
      else if (key.startsWith('skill-draft:')) {const [skill] = this.records<{name: string; revision: number}>('skill', ['name', 'revision'], 'AND id=?', [key.slice(12)]); if (skill) references.skills.push(skill);}
      else if (key.startsWith('state:')) {const [state] = this.records<{id: string; revision: number; threadId: string}>('userState', ['id', 'revision', 'threadId'], "AND id=? AND thread_id=json_extract(body,'$.threadId') AND id=json_extract(body,'$.id')", [key.slice(6)]); if (state && visible.has(state.threadId)) references.userStates.push({id: state.id, revision: state.revision});}
      else if (key.startsWith('request:')) {const index = key.lastIndexOf(':'), id = key.slice(8, index), suffix = key.slice(index + 1); const [request] = this.records<{id: string; threadId: string; revision: number; responseSchema: Record<string, unknown>}>('request', ['id', 'threadId', 'revision', 'responseSchema'], "AND id=? AND thread_id=json_extract(body,'$.threadId') AND id=json_extract(body,'$.id')", [id]); if (request && visible.has(request.threadId)) {const presence = this.store.db.prepare("SELECT json_type(body,'$.presentation') AS p FROM entities WHERE kind='request' AND id=?").get(id) as {p: string | null}; const planning = presence.p === 'object'; if (suffix === (planning ? 'planning' : String(request.revision))) references.requests.push({id, revision: request.revision, ...(planning ? {presentation: true} : {}), responseSchema: request.responseSchema});}}
    }
    // Export's signature guard must inspect every visible thread, even one without a draft key.
    references.threads = [...visible].map(id => ({id}));
    return references;
  }
}
