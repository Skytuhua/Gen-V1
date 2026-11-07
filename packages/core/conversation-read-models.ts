import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {HarnessError, type WorkspaceEvent} from '../contracts/index.ts';
import {
  conversationTargetSchema, conversationHistoryQuerySchema, conversationContentQuerySchema, conversationUpdatesQuerySchema,
  conversationOwnerSchema, conversationMessageSchema,
  type ConversationContext, type ConversationHistoryPage, type ConversationContentPage, type ConversationMessage, type ConversationOwner,
  type ConversationUpdates,
} from '../contracts/conversation-read-models.ts';
import {digest, type Store} from '../storage/store.ts';

type Target = z.output<typeof conversationTargetSchema>;
interface OwnerRow extends ConversationOwner {kind: string | null; parentThreadId: string | null; sideParentId: string | null; workspaceId: string | null; accountId: string | null; createdAt: string; archived: number}
interface Admission {owner: ConversationOwner; binding: string; readOnly: boolean; archived: boolean; dependencies: string[]}
interface Scope {target: Target; admission: Admission; revoked: boolean}
interface Change {sequence: number; threadId: string | null}
interface MessageRow extends Omit<ConversationMessage, 'contentOffset' | 'nextContentCursor'> {row: number}
const unavailable = () => new HarnessError('CAPABILITY_DENIED', 'The Personal conversation is unavailable.');
const resync = () => new HarnessError('RESYNC_REQUIRED', 'The conversation changed; resync its context and transcript.');
const invalidCursor = () => new HarnessError('INVALID_CURSOR', 'The cursor is invalid for this conversation scope.');
const cursorSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('history'), scope: z.string(), position: z.number().int().positive(), messageId: z.string()}),
  z.strictObject({kind: z.literal('content'), scope: z.string(), position: z.number().int().positive(), messageId: z.string(), row: z.number().int().positive(), revision: z.string()}),
  z.strictObject({kind: z.literal('updates'), scope: z.string(), sequence: z.number().int().nonnegative(), revision: z.string()}),
]);
type Cursor = z.infer<typeof cursorSchema>;

// Fixed projections never materialize a canonical Thread, Snapshot or global transcript.
const ownerSelect = `SELECT id AS threadId,substr(json_extract(body,'$.title'),1,160) AS title,
  json_extract(body,'$.projectId') AS projectId,substr(json_extract(body,'$.projectName'),1,160) AS projectName,
  json_extract(body,'$.epoch') AS epoch,json_extract(body,'$.runId') AS runId,json_extract(body,'$.status') AS status,
  json_extract(body,'$.modelId') AS modelId,json_extract(body,'$.kind') AS kind,
  json_extract(body,'$.parentThreadId') AS parentThreadId,json_extract(body,'$.sideParentId') AS sideParentId,
  json_extract(body,'$.workspaceId') AS workspaceId,json_extract(body,'$.accountId') AS accountId,
  json_extract(body,'$.createdAt') AS createdAt,
  coalesce((SELECT CASE WHEN a.thread_id=a.id AND a.body='true' THEN 1 WHEN a.thread_id=a.id AND a.body='false' THEN 0 ELSE -1 END
    FROM entities a WHERE a.kind='archivedThread' AND a.id=entities.id),0) AS archived
  FROM entities WHERE kind='thread' AND id=? AND json_extract(body,'$.id')=id AND thread_id=id
    AND json_type(body,'$.id')='text' AND json_type(body,'$.epoch')='integer' AND json_type(body,'$.title')='text'
    AND json_type(body,'$.projectName') IN ('text','null') AND json_type(body,'$.runId') IN ('text','null')
    AND json_type(body,'$.modelId') IN ('text','null')`;
const messageWhere = "kind='message' AND thread_id=? AND json_extract(body,'$.threadId')=? AND json_extract(body,'$.id')=id AND json_type(body,'$.id')='text' AND json_type(body,'$.threadId')='text'";
const messageSelect = `SELECT rowid AS row,id,json_extract(body,'$.threadId') AS threadId,
  json_extract(body,'$.role') AS role,json_extract(body,'$.createdAt') AS createdAt,json_extract(body,'$.runId') AS runId,
  CASE WHEN json_type(body,'$.content')='text' AND instr(json_extract(body,'$.content'),char(0))=0
    THEN substr(json_extract(body,'$.content'),?,4096) ELSE NULL END AS content,length(json_extract(body,'$.content')) AS contentLength,
  gen_conversation_revision(body) AS revision FROM entities`;

/** Read-only Personal capture. Scopes are bounded, revocable read fences, never command grants. */
export class ConversationReadModels {
  readonly authority = 'personal' as const;
  private readonly secret = randomBytes(32);
  private readonly scopes = new Map<string, Scope>();
  private readonly changes: Change[] = [];
  private sequence: number;
  private floor: number;
  private closed = false;
  private readonly stop: () => void;
  constructor(private readonly store: Store, private readonly options: {assertHostActive?: () => void} = {}) {
    // Canonical messages have no revision column. Hash one selected body at a time,
    // as the existing bounded Agent reader does; only the digest leaves this callback.
    store.db.function('gen_conversation_revision', {deterministic: true}, body => {
      if (typeof body !== 'string') throw unavailable();
      return createHash('sha256').update(body).digest('hex');
    });
    this.sequence = this.floor = store.sequence;
    this.stop = store.subscribe(event => this.onEvent(event));
  }
  dispose() {this.closed = true; this.stop(); this.scopes.clear(); this.changes.length = 0;}

  private active() {
    try {
      if (this.closed) throw unavailable();
      const result: unknown = this.options.assertHostActive?.();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {}); throw unavailable();
      }
    } catch (error) {for (const scope of this.scopes.values()) scope.revoked = true; throw error;}
  }
  private reset(sequence: number) {
    for (const scope of this.scopes.values()) scope.revoked = true;
    this.changes.length = 0; this.sequence = this.floor = sequence;
  }
  private read<T>(action: () => T): T {
    this.active();
    // A single synchronous SQLite read transaction fences cross-connection commits.
    this.store.db.exec('BEGIN');
    let open = true;
    try {
      const sequence = this.store.sequence;
      if (sequence !== this.sequence) this.reset(sequence);
      const value = action(); this.active(); this.store.db.exec('COMMIT'); open = false;
      // Do not release an old capture after a writer committed during its snapshot.
      const current = this.store.sequence;
      if (current !== sequence) {this.reset(current); throw resync();}
      return value;
    } catch (error) {if (open) this.store.db.exec('ROLLBACK'); throw error;}
  }
  private owner(id: string): OwnerRow {
    const row = this.store.db.prepare(ownerSelect).get(id) as unknown as OwnerRow | undefined;
    if (!row || row.archived < 0 || !conversationOwnerSchema.safeParse(this.projectOwner(row)).success || typeof row.createdAt !== 'string') throw unavailable();
    if (row.kind !== null && !['main', 'side', 'delegate'].includes(row.kind)) throw unavailable();
    for (const link of [row.parentThreadId, row.sideParentId, row.workspaceId, row.accountId]) {
      if (link !== null && !conversationOwnerSchema.shape.threadId.safeParse(link).success) throw unavailable();
    }
    return row;
  }
  private projectOwner(row: OwnerRow): ConversationOwner {
    const {threadId, title, projectId, projectName, epoch, runId, status, modelId} = row;
    return {threadId, title, projectId, projectName, epoch, runId, status, modelId};
  }
  private admission(target: Target): Admission {
    const row = this.owner(target.threadId);
    if (row.kind === 'delegate') throw unavailable();
    const readOnly = Boolean(row.sideParentId) || row.kind === 'side';
    const lineage = [row];
    if (readOnly) {
      if (!row.sideParentId || row.parentThreadId !== row.sideParentId) throw unavailable();
      const parent = this.owner(row.sideParentId);
      if (parent.kind === 'delegate' || parent.kind === 'side' || parent.sideParentId || parent.parentThreadId || parent.projectId !== row.projectId) throw unavailable();
      lineage.push(parent);
    } else if (row.parentThreadId) throw unavailable();
    const projects: unknown[] = [];
    for (const thread of lineage) {
      if (thread.archived && !target.includeArchived) throw unavailable();
      if (thread.projectId !== null) {
        const project = this.store.db.prepare("SELECT id,json_extract(body,'$.authority') AS authority FROM entities WHERE kind='workspaceProject' AND id=? AND json_extract(body,'$.id')=id AND json_type(body,'$.id')='text' AND thread_id IS NULL")
          .get(thread.projectId) as {id: string; authority: string | null} | undefined;
        if (!project?.authority || JSON.parse(project.authority)?.kind !== 'local') throw unavailable();
        projects.push(project);
      }
    }
    const binding = digest({lineage: lineage.map(thread => ({id: thread.threadId, epoch: thread.epoch, projectId: thread.projectId, workspaceId: thread.workspaceId, accountId: thread.accountId,
      modelId: thread.modelId, kind: thread.kind, parentThreadId: thread.parentThreadId, sideParentId: thread.sideParentId, createdAt: thread.createdAt, archived: thread.archived})), projects});
    return {owner: this.projectOwner(row), binding, readOnly, archived: lineage.some(thread => Boolean(thread.archived)), dependencies: lineage.map(thread => thread.threadId)};
  }
  private onEvent(event: WorkspaceEvent) {
    if (this.closed) return;
    if (event.seq !== this.sequence + 1 || event.type === 'workspace.recovered') {this.reset(event.seq); return;}
    this.sequence = event.seq;
    this.changes.push({sequence: event.seq, threadId: event.threadId});
    if (this.changes.length > 512) this.floor = this.changes.shift()!.sequence;
    for (const scope of this.scopes.values()) {
      if (scope.revoked || event.threadId && !scope.admission.dependencies.includes(event.threadId) && !event.type.startsWith('workspace.project.')) continue;
      try {if (this.admission(scope.target).binding !== scope.admission.binding) scope.revoked = true;}
      catch {scope.revoked = true;}
    }
  }
  private scoped(target: Target, key: string) {
    const scope = this.scopes.get(key);
    if (!scope || scope.revoked) throw resync();
    if (digest(target) !== digest(scope.target)) throw invalidCursor();
    const admission = this.admission(target);
    if (admission.binding !== scope.admission.binding) {scope.revoked = true; throw resync();}
    // LRU retention bounds open-window captures without an unbounded owner cache.
    this.scopes.delete(key); this.scopes.set(key, scope);
    return admission;
  }
  private encode(value: Cursor) {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return payload + '.' + createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
  private decode<K extends Cursor['kind']>(token: string, kind: K, scope: string): Extract<Cursor, {kind: K}> {
    const [payload, signature, extra] = token.split('.');
    if (!payload || extra !== undefined || !/^[\w-]+$/.test(payload) || !/^[\w-]{43}$/.test(signature ?? '')) throw invalidCursor();
    const supplied = Buffer.from(signature, 'base64url'), expected = createHmac('sha256', this.secret).update(payload).digest();
    if (supplied.toString('base64url') !== signature || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalidCursor();
    let parsed: ReturnType<typeof cursorSchema.safeParse>;
    try {parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));} catch {throw invalidCursor();}
    if (!parsed.success || parsed.data.kind !== kind || parsed.data.scope !== scope) throw invalidCursor();
    return parsed.data as Extract<Cursor, {kind: K}>;
  }
  private revision(admission: Admission) {return digest({owner: admission.owner, readOnly: admission.readOnly, archived: admission.archived});}
  private envelope(target: Target, scopeKey: string) {return {authority: this.authority, threadId: target.threadId, scopeKey, sequence: this.sequence};}
  private contextValue(admission: Admission, scopeKey: string): ConversationContext {
    const revision = this.revision(admission);
    return {authority: this.authority, owner: admission.owner, scopeKey, revision, sequence: this.sequence, readOnly: admission.readOnly,
      archived: admission.archived, includeArchived: this.scopes.get(scopeKey)!.target.includeArchived, researchEligible: !admission.archived && !admission.readOnly,
      checkpoint: this.encode({kind: 'updates', scope: scopeKey, sequence: this.sequence, revision})};
  }
  context(input: unknown): ConversationContext {
    const target = conversationTargetSchema.parse(input);
    return this.read(() => {
      const admission = this.admission(target), scopeKey = randomBytes(32).toString('hex');
      this.scopes.set(scopeKey, {target, admission, revoked: false});
      if (this.scopes.size > 128) this.scopes.delete(this.scopes.keys().next().value!);
      return this.contextValue(admission, scopeKey);
    });
  }
  private slice(row: MessageRow, scope: string, offset = 0): ConversationMessage {
    if (typeof row.content !== 'string') throw unavailable();
    const length = [...row.content].length;
    // SQLite counts an unpaired escaped surrogate once but its UTF-8 decoder can
    // return several replacement characters. Never publish mismatched offsets.
    if (!Number.isSafeInteger(row.contentLength) || row.contentLength < offset || length !== Math.min(4096, row.contentLength - offset)) throw unavailable();
    const next = offset + length;
    return conversationMessageSchema.parse({id: row.id, threadId: row.threadId, role: row.role, createdAt: row.createdAt, runId: row.runId, revision: row.revision,
      content: row.content, contentOffset: offset, contentLength: row.contentLength,
      nextContentCursor: next < row.contentLength ? this.encode({kind: 'content', scope, position: next, messageId: row.id, row: row.row, revision: row.revision}) : null});
  }
  history(input: unknown): ConversationHistoryPage {
    const {scopeKey, limit, cursor, ...target} = conversationHistoryQuerySchema.parse(input);
    return this.read(() => {
      this.scoped(target, scopeKey); let before = Number.MAX_SAFE_INTEGER;
      if (cursor) {
        const value = this.decode(cursor, 'history', scopeKey); before = value.position;
        if (!this.store.db.prepare('SELECT 1 FROM entities WHERE ' + messageWhere + ' AND rowid=? AND id=?').get(target.threadId, target.threadId, before, value.messageId)) throw resync();
      }
      const rows = this.store.db.prepare(messageSelect + ' WHERE ' + messageWhere + ' AND rowid<? ORDER BY rowid DESC LIMIT ?')
        .all(1, target.threadId, target.threadId, before, limit + 1) as unknown as MessageRow[];
      const selected = rows.slice(0, limit).reverse();
      return {...this.envelope(target, scopeKey), messages: selected.map(row => this.slice(row, scopeKey)),
        nextCursor: rows.length > limit ? this.encode({kind: 'history', scope: scopeKey, position: selected[0].row, messageId: selected[0].id}) : null};
    });
  }
  content(input: unknown): ConversationContentPage {
    const {scopeKey, cursor, ...target} = conversationContentQuerySchema.parse(input);
    return this.read(() => {
      this.scoped(target, scopeKey); const value = this.decode(cursor, 'content', scopeKey);
      const row = this.store.db.prepare(messageSelect + ' WHERE ' + messageWhere + ' AND id=? AND rowid=?')
        .get(value.position + 1, target.threadId, target.threadId, value.messageId, value.row) as MessageRow | undefined;
      if (!row || row.revision !== value.revision || value.position >= row.contentLength) throw resync();
      return {...this.envelope(target, scopeKey), message: this.slice(row, scopeKey, value.position)};
    });
  }
  updates(input: unknown): ConversationUpdates {
    const {scopeKey, checkpoint, ...target} = conversationUpdatesQuerySchema.parse(input);
    return this.read(() => {
      const admission = this.scoped(target, scopeKey), value = this.decode(checkpoint, 'updates', scopeKey);
      if (value.sequence < this.floor || value.sequence > this.sequence) throw resync();
      const context = this.contextValue(admission, scopeKey);
      return {...this.envelope(target, scopeKey), fromSequence: value.sequence,
        owner: context.revision !== value.revision ? context : null,
        transcriptChanged: this.changes.some(change => change.sequence > value.sequence && change.threadId === target.threadId), checkpoint: context.checkpoint};
    });
  }
}
