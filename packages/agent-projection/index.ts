import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HarnessError, type Thread, type WorkspaceEvent } from '../contracts/index.ts';
import { PLANNING_PROVENANCE, planDataId, type AgentJob } from '../contracts/planning.ts';
import {
  agentScopeSchema, inventoryQuerySchema, historyQuerySchema, contentQuerySchema, updatesQuerySchema,
  type AgentScope, type AgentSummary, type InventoryQuery, type InventoryPage, type HistoryQuery, type HistoryPage,
  type ContentQuery, type MessageSlice, type UpdatesQuery, type InventoryUpdates, type PersonalAgentInventory,
} from '../contracts/agent-inventory.ts';
import { digest, type Store } from '../storage/store.ts';

type Scope = ReturnType<typeof agentScopeSchema.parse>;
interface Change { sequence: number; before: AgentSummary[]; after: AgentSummary[]; transcriptIds: string[] }
interface Cursor { kind: string; scope: string; position: string | number; version: string | number; messageId?: string }
interface MessageRow { row: number; id: string; threadId: string; role: MessageSlice['role']; createdAt: string; runId: string | null; content: string; contentLength: number; contentIdentity: string | null }
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const rootId = (id: string) => 'thread:' + id;
const jobId = (parent: string, job: string) => `job:${encodeURIComponent(parent)}:${encodeURIComponent(job)}`;
const text = (value: string | undefined | null, size = 512) => value?.slice(0, size) ?? null;
const invalidCursor = () => new HarnessError('INVALID_CURSOR', 'The cursor is invalid for this read scope');
const resync = () => new HarnessError('RESYNC_REQUIRED', 'The read scope changed; resync from its first page');

/** Personal-only read model over the canonical Store. No runtime or command dependency. */
export class AgentProjection implements PersonalAgentInventory {
  readonly authority = 'personal' as const;
  private readonly secret = randomBytes(32);
  private readonly groups = new Map<string, AgentSummary[]>();
  private readonly items = new Map<string, AgentSummary>();
  private readonly childOwners = new Map<string, string>();
  private readonly actions = new Map<string, string | null>();
  private readonly listeners = new Set<() => void>();
  private readonly changes: Change[] = [];
  private sequence: number;
  private floor: number;
  private generation = 0;
  private stop: () => void;

  constructor(private readonly store: Store) {
    store.db.function('gen_agent_message_identity', { deterministic: true }, body => {
      if (typeof body !== 'string') throw Error('Invalid message body');
      return createHash('sha256').update(body).digest('hex');
    });
    this.sequence = this.floor = store.sequence;
    this.rebuild();
    this.stop = store.subscribe(event => this.onEvent(event));
  }
  dispose() { this.stop(); this.listeners.clear(); this.changes.length = 0; this.groups.clear(); this.items.clear(); this.childOwners.clear(); this.actions.clear(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private scope(input: AgentScope): Scope {
    const scope = agentScopeSchema.parse(input);
    return { ...scope, statuses: [...new Set(scope.statuses ?? [])].sort(), text: (scope.text ?? '').toLowerCase() };
  }
  private scopeKey(scope: Scope) { return digest({ authority: this.authority, ...scope }); }
  private matches(item: AgentSummary, scope: Scope) {
    return (scope.includeArchived || !item.archived)
      && (scope.projectId === undefined || item.projectId === scope.projectId)
      && (!scope.statuses?.length || scope.statuses.includes(item.status))
      && (!scope.text || `${item.title}\n${item.projectName ?? ''}\n${item.currentAction ?? ''}`.toLowerCase().includes(scope.text));
  }
  private encode(cursor: Cursor) {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return payload + '.' + createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
  private decode(token: string, kind: string, scope: string): Cursor {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || !/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(signature)) throw invalidCursor();
    const actual = Buffer.from(signature, 'base64url'), expected = createHmac('sha256', this.secret).update(payload).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalidCursor();
    let value: Cursor;
    try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw invalidCursor(); }
    if (value.kind !== kind || value.scope !== scope) throw invalidCursor();
    return value;
  }
  private ancestors(items: AgentSummary[]) {
    const ids = new Set(items.map(item => item.agentId)), parents = new Set(items.flatMap(item => item.parentId && !ids.has(item.parentId) ? [item.parentId] : []));
    return [...parents].flatMap(id => this.items.has(id) ? [this.items.get(id)!] : []).sort((a, b) => cmp(a.orderKey, b.orderKey));
  }
  inventory(input: InventoryQuery): InventoryPage {
    const query = inventoryQuerySchema.parse(input), { limit, cursor, ...filters } = query, scope = this.scope(filters), scopeKey = this.scopeKey(scope);
    const matches = [...this.items.values()].filter(item => this.matches(item, scope)).sort((a, b) => cmp(a.orderKey, b.orderKey));
    // Progress and text streaming cannot invalidate a page. Changed membership/order explicitly requires resync.
    const version = digest(matches.map(item => [item.agentId, item.orderKey]));
    let after = '';
    if (cursor) { const value = this.decode(cursor, 'inventory', scopeKey); if (value.version !== version) throw resync(); after = String(value.position); }
    const rows = matches.filter(item => cmp(item.orderKey, after) > 0).slice(0, limit + 1), items = rows.slice(0, limit);
    return { authority: this.authority, scopeKey, sequence: this.sequence, items, ancestors: this.ancestors(items),
      nextCursor: rows.length > limit ? this.encode({ kind: 'inventory', scope: scopeKey, position: items.at(-1)!.orderKey, version }) : null };
  }

  private personal(thread: Thread) {
    const project = thread.projectId ? this.store.get<{ authority?: { kind: string } }>('workspaceProject', thread.projectId) : null;
    return !project || project.authority?.kind === 'local';
  }
  private jobs(parent: Thread): AgentJob[] {
    const row = this.store.db.prepare("SELECT json_extract(body,'$.value.agents') AS agents FROM entities WHERE kind='data' AND id=? AND thread_id=? AND json_extract(body,'$.threadId')=? AND json_extract(body,'$.provenance')=?")
      .get(planDataId(parent.id), parent.id, parent.id, PLANNING_PROVENANCE) as { agents: string | null } | undefined;
    return row?.agents ? JSON.parse(row.agents) as AgentJob[] : [];
  }
  private action(threadId: string) {
    if (!this.actions.has(threadId)) {
      const row = this.store.db.prepare("SELECT substr(json_extract(body,'$.content'),1,512) AS content FROM entities WHERE kind='message' AND thread_id=? AND json_extract(body,'$.threadId')=? AND json_extract(body,'$.role')='activity' ORDER BY rowid DESC LIMIT 1").get(threadId, threadId) as { content: string } | undefined;
      this.actions.set(threadId, row?.content ?? null);
    }
    return this.actions.get(threadId)!;
  }
  private readGroup(id: string): AgentSummary[] {
    const parent = this.store.get<Thread>('thread', id);
    if (!parent || parent.kind === 'delegate' || parent.kind === 'side' || parent.sideParentId || !this.personal(parent)) return [];
    const jobs = this.jobs(parent);
    const hasConversation = jobs.length || parent.runId || this.store.db.prepare("SELECT 1 FROM entities WHERE kind='message' AND thread_id=? AND json_extract(body,'$.threadId')=? AND json_extract(body,'$.role') IN ('user','assistant') AND length(trim(json_extract(body,'$.content')))>0 LIMIT 1").get(id, id);
    if (!jobs.length && !hasConversation && !parent.runId) return [];
    const project = parent.projectId ? this.store.get<{ name?: string }>('workspaceProject', parent.projectId) : null;
    const archived = Boolean(this.store.get('archivedThread', id));
    const base = { rootId: rootId(id), projectId: parent.projectId ?? null, projectName: text(project?.name ?? parent.projectName, 160), archived };
    // Creation and canonical IDs are stable; progress, unread, title and updatedAt never move a column.
    const prefix = JSON.stringify([base.projectId ?? '', parent.createdAt, parent.id]);
    const root: AgentSummary = { ...base, agentId: rootId(id), parentId: null, jobId: null, threadId: id,
      title: text(parent.title, 160)!, status: parent.status, modelId: text(parent.modelId, 300), currentAction: this.action(id),
      reportedPercent: null, createdAt: parent.createdAt, updatedAt: parent.updatedAt, orderKey: prefix + ':0', revision: this.sequence, readOnly: false, metadata: 'thread' };
    return [root, ...jobs.map(job => {
      const child = job.childThreadId ? this.store.get<Thread>('thread', job.childThreadId) : null;
      const linked = child?.kind === 'delegate' && child.parentThreadId === id && child.jobId === job.id && this.personal(child)
        && (child.projectId ?? null) === (parent.projectId ?? null);
      return { ...base, agentId: jobId(id, job.id), parentId: root.agentId, jobId: job.id, threadId: linked ? child.id : null,
        title: text(job.name, 160)!, status: job.status, modelId: linked ? text(child.modelId, 300) : null,
        currentAction: text(job.summary) ?? (linked ? this.action(child.id) : null), reportedPercent: job.reportedPercent, createdAt: job.createdAt, updatedAt: job.updatedAt,
        orderKey: prefix + ':1:' + JSON.stringify([job.createdAt, job.id]), revision: this.sequence,
        archived: archived || Boolean(linked && this.store.get('archivedThread', child.id)), readOnly: true,
        metadata: !job.childThreadId ? 'legacy_job' as const : linked ? 'canonical_job' as const : 'child_link_unavailable' as const };
    })];
  }
  private replaceGroup(id: string) {
    const before = this.groups.get(id) ?? [];
    for (const item of before) { this.items.delete(item.agentId); if (item.threadId && item.parentId) this.childOwners.delete(item.threadId); }
    const after = this.readGroup(id);
    this.groups.set(id, after);
    for (const item of after) {
      const previous = before.find(old => old.agentId === item.agentId);
      if (previous && JSON.stringify({ ...previous, revision: 0 }) === JSON.stringify({ ...item, revision: 0 })) item.revision = previous.revision;
      this.items.set(item.agentId, item);
      if (item.threadId && item.parentId) this.childOwners.set(item.threadId, id);
    }
    return { before, after };
  }
  private rebuild() {
    const previous = new Map(this.items);
    this.groups.clear(); this.items.clear(); this.childOwners.clear();
    const rows = this.store.db.prepare("SELECT id FROM entities WHERE kind='thread' AND coalesce(json_extract(body,'$.kind'),'main') NOT IN ('delegate','side') AND json_extract(body,'$.sideParentId') IS NULL").all() as { id: string }[];
    for (const row of rows) this.replaceGroup(row.id);
    for (const [id, item] of this.items) {
      const old = previous.get(id);
      if (old && JSON.stringify({ ...old, revision: 0 }) === JSON.stringify({ ...item, revision: 0 })) item.revision = old.revision;
    }
  }
  private onEvent(event: WorkspaceEvent) {
    if (event.seq <= this.sequence) return;
    const gap = event.seq !== this.sequence + 1;
    this.sequence = event.seq;
    if (gap) { this.generation++; this.actions.clear(); this.rebuild(); this.changes.length = 0; this.floor = event.seq; }
    else {
      const before: AgentSummary[] = [], after: AgentSummary[] = [], transcriptIds: string[] = [];
      const transcriptType = event.type === 'operation.progress' ? 'activity' : event.type === 'agent.transcript' ? (event.payload as { result?: { type?: string } } | null)?.result?.type : event.type.replace(/^runtime\./, '');
      const global = event.type === 'thread.create' || event.type === 'workspace.recovered' || event.type.startsWith('workspace.project.');
      if (global) {
        // Project mutations may carry a thread address but still affect every member of that project.
        if (event.type === 'workspace.recovered') { this.generation++; this.actions.clear(); }
        before.push(...this.items.values()); this.rebuild(); after.push(...this.items.values());
      } else if (event.threadId) {
        if (transcriptType === 'activity' || transcriptType === 'error') this.actions.delete(event.threadId);
        const current = this.store.get<Thread>('thread', event.threadId), owners = new Set([this.childOwners.get(event.threadId), current?.kind === 'delegate' ? current.parentThreadId : event.threadId]);
        for (const id of owners) if (id) { const change = this.replaceGroup(id); before.push(...change.before); after.push(...change.after); }
        if (['assistant.delta', 'assistant.message', 'activity', 'error'].includes(transcriptType ?? '') || /^(message\.send|input\.)/.test(event.type)) {
          for (const item of after) if (item.threadId === event.threadId) transcriptIds.push(item.agentId);
        }
      }
      const old = new Map(before.map(item => [item.agentId, item])), next = new Map(after.map(item => [item.agentId, item]));
      this.changes.push({ sequence: event.seq, before: before.filter(item => !next.has(item.agentId) || next.get(item.agentId)!.revision !== item.revision),
        after: after.filter(item => !old.has(item.agentId) || old.get(item.agentId)!.revision !== item.revision), transcriptIds });
      if (this.changes.at(-1)!.before.length + this.changes.at(-1)!.after.length > 100) { this.changes.length = 0; this.floor = event.seq; }
      if (this.changes.length > 512) this.floor = this.changes.shift()!.sequence;
    }
    for (const listener of this.listeners) { try { listener(); } catch { /* A reader cannot interrupt canonical commits. */ } }
  }

  private target(agentId: string, includeArchived: boolean) {
    const item = this.items.get(agentId);
    if (!item?.threadId || (item.archived && !includeArchived)) throw new HarnessError('NOT_FOUND', 'Agent transcript is unavailable in this scope');
    const root = this.store.get<Thread>('thread', this.items.get(item.rootId)!.threadId!);
    if (!root || !this.personal(root)) throw new HarnessError('CAPABILITY_DENIED', 'Personal transcript authority is unavailable');
    // Revalidate canonical parent/job linkage on every read; a summary grants no authority.
    const live = this.readGroup(root.id).find(row => row.agentId === agentId);
    if (!live?.threadId || live.threadId !== item.threadId || (live.archived && !includeArchived)) throw new HarnessError('NOT_FOUND', 'Agent transcript linkage changed');
    return live;
  }
  private historyScope(item: AgentSummary, includeArchived: boolean) { return digest({ agentId: item.agentId, threadId: item.threadId, includeArchived }); }
  private contentVersion(row: MessageRow) { return `${this.generation}:${row.contentIdentity ?? ''}`; }
  private messageSlice(row: MessageRow, scope: string, offset = 0): MessageSlice {
    const next = offset + [...row.content].length, version = this.contentVersion(row);
    return { id: row.id, threadId: row.threadId, role: row.role, createdAt: row.createdAt, runId: row.runId, content: row.content,
      contentOffset: offset, contentLength: row.contentLength,
      nextContentCursor: next < row.contentLength ? this.encode({ kind: 'content', scope, messageId: row.id, position: next, version }) : null };
  }
  private messageSelect = "SELECT rowid AS row,id,json_extract(body,'$.threadId') AS threadId,json_extract(body,'$.role') AS role,json_extract(body,'$.createdAt') AS createdAt,json_extract(body,'$.runId') AS runId,substr(json_extract(body,'$.content'),?,4096) AS content,length(json_extract(body,'$.content')) AS contentLength,CASE WHEN length(json_extract(body,'$.content'))>4096 THEN gen_agent_message_identity(body) ELSE NULL END AS contentIdentity FROM entities";
  history(input: HistoryQuery): HistoryPage {
    const query = historyQuerySchema.parse(input), item = this.target(query.agentId, query.includeArchived), scope = this.historyScope(item, query.includeArchived);
    let before = Number.MAX_SAFE_INTEGER;
    if (query.cursor) { const cursor = this.decode(query.cursor, 'history', scope); before = Number(cursor.position); if (!Number.isSafeInteger(before) || before < 1) throw invalidCursor(); }
    const rows = this.store.db.prepare(this.messageSelect + " WHERE kind='message' AND thread_id=? AND json_extract(body,'$.threadId')=? AND rowid<? ORDER BY rowid DESC LIMIT ?")
      .all(1, item.threadId!, item.threadId!, before, query.limit + 1) as unknown as MessageRow[];
    const selected = rows.slice(0, query.limit).reverse();
    return { authority: this.authority, agentId: item.agentId, threadId: item.threadId!, sequence: this.sequence,
      messages: selected.map(row => this.messageSlice(row, scope)),
      nextCursor: rows.length > query.limit ? this.encode({ kind: 'history', scope, position: selected[0].row, version: 1 }) : null };
  }
  content(input: ContentQuery): MessageSlice {
    const query = contentQuerySchema.parse(input), item = this.target(query.agentId, query.includeArchived), scope = this.historyScope(item, query.includeArchived);
    const cursor = this.decode(query.cursor, 'content', scope);
    const offset = Number(cursor.position);
    if (!Number.isSafeInteger(offset) || offset < 1) throw invalidCursor();
    if (typeof cursor.messageId !== 'string' || !cursor.messageId || cursor.messageId.length > 500) throw invalidCursor();
    const row = this.store.db.prepare(this.messageSelect + " WHERE kind='message' AND id=? AND thread_id=? AND json_extract(body,'$.threadId')=?")
      .get(offset + 1, cursor.messageId, item.threadId!, item.threadId!) as MessageRow | undefined;
    if (!row || cursor.version !== this.contentVersion(row)) throw resync();
    return this.messageSlice(row, scope, offset);
  }
  updates(input: UpdatesQuery): InventoryUpdates {
    const query = updatesQuerySchema.parse(input), { after, scopeKey, visibleAgentIds, ...filters } = query, scope = this.scope(filters);
    if (scopeKey !== this.scopeKey(scope)) throw new HarnessError('INVALID_SCOPE', 'Update scope differs from the inventory scope');
    const result: InventoryUpdates = { authority: this.authority, scopeKey, fromSequence: after, sequence: this.sequence,
      resync: after < this.floor || after > this.sequence, upserts: [], removed: [], ancestors: [], transcripts: [] };
    if (result.resync) return result;
    const ids = new Set<string>(), transcript = new Map<string, number>(), visible = new Set(visibleAgentIds);
    for (const change of this.changes) if (change.sequence > after) {
      for (const item of [...change.before, ...change.after]) if (this.matches(item, scope)) ids.add(item.agentId);
      for (const id of change.transcriptIds) if (visible.has(id)) transcript.set(id, change.sequence);
    }
    if (ids.size > 100) return { ...result, resync: true };
    for (const id of ids) { const item = this.items.get(id); if (item && this.matches(item, scope)) result.upserts.push(item); else result.removed.push(id); }
    result.upserts.sort((a, b) => cmp(a.orderKey, b.orderKey));
    result.ancestors = this.ancestors(result.upserts);
    result.transcripts = [...transcript].flatMap(([agentId, sequence]) => { const item = this.items.get(agentId); return item && this.matches(item, scope) ? [{ agentId, sequence }] : []; });
    return result;
  }
}
