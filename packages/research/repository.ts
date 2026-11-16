import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {HarnessError, type Thread} from '../contracts/index.ts';
import {
  RESEARCH_SOURCE_BYTES, researchContextSchema,
  researchPageSchema, researchPassageSchema, type ResearchContext, type ResearchDocument,
  type ResearchPageQuery, type ResearchPassage, type ResearchProvider, type ResearchSource,
} from '../contracts/research.ts';
import {digest, type Store} from '../storage/store.ts';
import {currentResearchGrant, researchDenied, researchHash} from './capture.ts';

const missing = (): never => {throw new HarnessError('NOT_FOUND', 'The requested research revision is unavailable.');};
const key = (context: ResearchContext, id: string) => digest(context) + ':' + id;
const versionKey = (context: ResearchContext, id: string, revision: number) => key(context, id) + '@' + revision;
const sameContext = (a: ResearchContext, b: ResearchContext) => digest({authority: a.authority, threadId: a.threadId, projectId: a.projectId}) === digest(b);
function utf8(bytes: Uint8Array): string {
  try {const value = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); if (value.includes('\0')) throw Error(); return value;}
  catch {throw new HarnessError('INVALID_SOURCE', 'Research passages require exact UTF-8 text without binary data.');}
}
type DocumentHead = Omit<ResearchDocument, 'body' | 'citations'>;

/** Personal storage only. A Company owner must supply its own provider and namespace. */
export class PersonalResearchRepository implements ResearchProvider {
  readonly authority = {kind: 'personal'} as const;
  private readonly cursorSecret = randomBytes(32);
  constructor(private readonly store: Store, private readonly options: {assertHostActive?: () => void} = {}) {}

  private binding(input: ResearchContext): string {
    this.options.assertHostActive?.();
    const context = researchContextSchema.parse(input);
    if (context.authority.kind !== 'personal') return researchDenied();
    const thread = this.store.get<Thread>('thread', context.threadId);
    if (!thread || this.store.get('archivedThread', thread.id) || thread.kind === 'delegate' || thread.sideParentId || thread.kind === 'side' || (thread.projectId ?? null) !== context.projectId) return researchDenied();
    const project = context.projectId ? this.store.get<{authority?: {kind: string}}>('workspaceProject', context.projectId) : null;
    if (context.projectId && project?.authority?.kind !== 'local') return researchDenied();
    return digest({threadId: thread.id, epoch: thread.epoch, projectId: thread.projectId ?? null, workspaceId: thread.workspaceId ?? null, project});
  }
  private read<T extends ResearchContext>(kind: string, context: ResearchContext, id: string, revision?: number): T {
    this.binding(context);
    if (!/^[A-Za-z0-9:_-]{1,200}$/.test(id) || (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))) throw new HarnessError('INVALID_INPUT', 'Choose an exact research revision.');
    const record = this.store.get<T>(revision === undefined ? kind : kind + 'Version', revision === undefined ? key(context, id) : versionKey(context, id, revision));
    if (!record || !sameContext(record, context)) return missing();
    return record;
  }
  source(context: ResearchContext, sourceId: string, revision?: number): ResearchSource {
    return this.read('researchSource', context, sourceId, revision);
  }
  private assertSourceAccess(context: ResearchContext, source: ResearchSource) {
    if (source.identity.kind === 'file' && digest(currentResearchGrant(this.store, context, source.identity.resourceId)) !== source.identity.grantBinding) researchDenied();
  }
  private material(context: ResearchContext, ref: ResearchPassage): {source: ResearchSource; bytes: Buffer} {
    const source = this.source(context, ref.sourceId, ref.revision);
    this.assertSourceAccess(context, source);
    if (source.status !== 'captured' || source.sha256 !== ref.sha256 || !source.materialId) throw new HarnessError('INVALID_CITATION', 'The passage must reference an exact captured source hash.');
    const material = this.store.get<{base64: string}>('researchMaterial', source.materialId);
    if (!material) return missing();
    const bytes = Buffer.from(material.base64, 'base64');
    if (bytes.length !== source.bytes || bytes.length > RESEARCH_SOURCE_BYTES || researchHash(bytes) !== ref.sha256) throw new HarnessError('SOURCE_CHANGED', 'The stored source failed its integrity check.');
    return {source, bytes};
  }
  private passageText(ref: ResearchPassage, bytes: Buffer) {
    if (ref.end > bytes.length) throw new HarnessError('INVALID_CITATION', 'The passage falls outside this captured revision.');
    return utf8(bytes.subarray(ref.start, ref.end));
  }
  passage(context: ResearchContext, input: ResearchPassage): {text: string; sourceRevision: number; status: 'current-capture' | 'stale'} {
    const ref = researchPassageSchema.parse(input), {bytes} = this.material(context, ref), text = this.passageText(ref, bytes);
    return {text, sourceRevision: ref.revision, status: this.source(context, ref.sourceId).revision === ref.revision ? 'current-capture' : 'stale'};
  }
  document(context: ResearchContext, documentId: string, revision?: number) {
    const head = this.read<DocumentHead>('researchDocument', context, documentId);
    const document = this.read<ResearchDocument>('researchDocument', context, documentId, revision ?? head.revision);
    return {...document, citations: document.citations.map(ref => {
      let status: 'current-capture' | 'stale' | 'unavailable';
      try {
        const source = this.source(context, ref.sourceId, ref.revision);
        this.assertSourceAccess(context, source);
        if (source.status !== 'captured' || source.sha256 !== ref.sha256 || ref.end > source.bytes) throw Error();
        status = this.source(context, ref.sourceId).revision === ref.revision ? 'current-capture' : 'stale';
      } catch {status = 'unavailable';}
      return {...ref, status, liveStatus: 'unverified' as const};
    })};
  }

  list(context: ResearchContext, input: ResearchPageQuery) {
    this.binding(context);
    const query = researchPageSchema.parse(input), kind = query.kind === 'sources' ? 'researchSource' : 'researchDocument';
    const binding = digest({context, kind}), limit = query.limit ?? 50;
    let after = '';
    if (query.cursor) {
      const [payload, signature, extra] = query.cursor.split('.');
      const expected = createHmac('sha256', this.cursorSecret).update(payload ?? '').digest('base64url');
      if (!signature || extra !== undefined || signature.length !== expected.length || !/^[A-Za-z0-9_-]+$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new HarnessError('INVALID_CURSOR', 'Choose a current research page.');
      try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (decoded.binding !== binding || typeof decoded.after !== 'string' || !/^[a-f0-9]{64}:[A-Za-z0-9:_-]{1,200}$/.test(decoded.after)) throw Error();
        after = decoded.after;
      } catch {throw new HarnessError('INVALID_CURSOR', 'Choose a current research page.');}
    }
    const prefix = digest(context) + ':';
    // Keyset SQL paging bounds materialization; heads never contain source bytes or document bodies.
    const rows = this.store.db.prepare('SELECT id,body FROM entities WHERE kind=? AND thread_id=? AND id>? AND id LIKE ? ORDER BY id LIMIT ?').all(kind, context.threadId, after || prefix, prefix + '%', limit + 1) as {id: string; body: string}[];
    const items: (ResearchSource | DocumentHead)[] = []; let responseBytes = 0;
    for (const row of rows.slice(0, limit)) {
      if (responseBytes + Buffer.byteLength(row.body) > 192 * 1024) break;
      const item = JSON.parse(row.body) as ResearchSource | DocumentHead;
      if (!sameContext(item, context)) researchDenied();
      items.push(item); responseBytes += Buffer.byteLength(row.body);
    }
    let nextCursor: string | null = null;
    if (rows.length > items.length && items.length) {
      const payload = Buffer.from(JSON.stringify({binding, after: rows[items.length - 1].id})).toString('base64url');
      nextCursor = payload + '.' + createHmac('sha256', this.cursorSecret).update(payload).digest('base64url');
    }
    return {items, nextCursor};
  }

}
