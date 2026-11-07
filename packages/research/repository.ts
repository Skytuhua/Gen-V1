import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {HarnessError, type CommandReceipt, type HostCommand, type Thread} from '../contracts/index.ts';
import {
  RESEARCH_DOCUMENT_BYTES, RESEARCH_SOURCE_BYTES, researchCommandSchema, researchContextSchema,
  researchPageSchema, researchPassageSchema, type ResearchContext, type ResearchDocument,
  type ResearchPageQuery, type ResearchPassage, type ResearchProvider, type ResearchSource, type ResearchSourceIdentity,
} from '../contracts/research.ts';
import {digest, type Store} from '../storage/store.ts';
import {assertResearchActive, currentResearchGrant, researchDenied, researchHash, withGrantedResearchFile, type VerifiedBrowserCaptureProvider} from './capture.ts';

const missing = (): never => {throw new HarnessError('NOT_FOUND', 'The requested research revision is unavailable.');};
const key = (context: ResearchContext, id: string) => digest(context) + ':' + id;
const versionKey = (context: ResearchContext, id: string, revision: number) => key(context, id) + '@' + revision;
const sameContext = (a: ResearchContext, b: ResearchContext) => digest({authority: a.authority, threadId: a.threadId, projectId: a.projectId}) === digest(b);
function utf8(bytes: Uint8Array): string {
  try {const value = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); if (value.includes('\0')) throw Error(); return value;}
  catch {throw new HarnessError('INVALID_SOURCE', 'Research passages require exact UTF-8 text without binary data.');}
}
function textBytes(text: string, max: number): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > max) throw new HarnessError('RESOURCE_LIMIT', 'Research content exceeds its byte limit.');
  if (utf8(bytes) !== text) throw new HarnessError('INVALID_SOURCE', 'Research text must contain valid Unicode.');
  return bytes;
}
function safeUrl(value: string): string {
  let url: URL;
  try {url = new URL(value);} catch {throw new HarnessError('INVALID_INPUT', 'Choose an HTTP or HTTPS source address.');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 8192) throw new HarnessError('INVALID_INPUT', 'Choose an HTTP or HTTPS source address without credentials.');
  return url.href;
}
type DocumentHead = Omit<ResearchDocument, 'body' | 'citations'>;

/** Personal storage only. A Company owner must supply its own provider and namespace. */
export class PersonalResearchRepository implements ResearchProvider {
  readonly authority = {kind: 'personal'} as const;
  private readonly cursorSecret = randomBytes(32);
  private readonly pending = new Map<string, {hash: string; promise: Promise<CommandReceipt>}>();
  constructor(private readonly store: Store, private readonly options: {browser?: VerifiedBrowserCaptureProvider; assertHostActive?: () => void} = {}) {}

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
  private assertBinding(context: ResearchContext, binding: string, signal: AbortSignal) {
    assertResearchActive(signal);
    if (this.binding(context) !== binding) researchDenied();
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

  async fileReference(context: ResearchContext, resourceId: string, relativePath?: string, signal = new AbortController().signal) {
    const binding = this.binding(context);
    return withGrantedResearchFile(this.store, context, resourceId, relativePath, signal, async capture => {
      this.assertBinding(context, binding, signal); utf8(capture.bytes); return capture.reference;
    });
  }
  async command(input: HostCommand, signal = new AbortController().signal): Promise<CommandReceipt> {
    const command = researchCommandSchema.parse(input), p = command.payload;
    const context: ResearchContext = {authority: p.authority, threadId: p.threadId, projectId: p.projectId};
    if (command.threadId !== context.threadId) return researchDenied();
    const binding = this.binding(context); assertResearchActive(signal);
    const hash = digest(command), existing = this.pending.get(command.id);
    if (existing) {
      if (hash !== existing.hash) throw new HarnessError('DUPLICATE_COMMAND', 'Command ID reused with different content.');
      return existing.promise;
    }
    const replay = this.store.receipt(command); if (replay) return replay;
    const execute = async (): Promise<CommandReceipt> => {
      const guard = () => this.assertBinding(context, binding, signal);
      const cas = (kind: string, id: string) => {
        const head = this.store.get<{revision: number}>(kind, key(context, id));
        if ((head?.revision ?? 0) !== p.expectedRevision) throw new HarnessError('PRECONDITION_FAILED', 'Research changed. Reload the current revision before saving.');
      };
      if (command.type === 'research.document.save') {
        const data = command.payload, bytes = textBytes(data.body, RESEARCH_DOCUMENT_BYTES);
        guard();
        return this.store.command(command, () => {
          guard(); cas('researchDocument', data.documentId);
          const groups = new Map<string, ResearchPassage[]>();
          for (const ref of data.citations) {
            const identity = JSON.stringify([ref.sourceId, ref.revision, ref.sha256]);
            const group = groups.get(identity); if (group) group.push(ref); else groups.set(identity, [ref]);
          }
          // Validate each immutable capture once; retain only one decoded material at a time.
          for (const refs of groups.values()) {
            const {bytes} = this.material(context, refs[0]);
            for (const ref of refs) this.passageText(ref, bytes);
          }
          const record: ResearchDocument = {...context, id: data.documentId, kind: data.kind, title: data.title, body: data.body, sha256: researchHash(bytes), revision: data.expectedRevision + 1, savedAt: new Date().toISOString(), citations: data.citations};
          const {body: _body, citations: _citations, ...head} = record;
          this.store.put('researchDocumentVersion', versionKey(context, record.id, record.revision), context.threadId, record);
          this.store.put('researchDocument', key(context, record.id), context.threadId, head);
          return {documentId: record.id, revision: record.revision, sha256: record.sha256};
        });
      }
      const data = command.payload;
      cas('researchSource', data.sourceId);
      const commit = async (bytes: Buffer | null, identity: ResearchSourceIdentity, assertCurrent = () => {}) => {
        if (bytes) {if (!bytes.length || bytes.length > RESEARCH_SOURCE_BYTES) throw new HarnessError('RESOURCE_LIMIT', 'Capture nonempty sources up to 4 MiB.'); utf8(bytes);}
        assertCurrent(); guard();
        return this.store.command(command, () => {
          assertCurrent(); guard(); cas('researchSource', data.sourceId);
          const previous = this.store.get<ResearchSource>('researchSource', key(context, data.sourceId));
          if (previous) {
            const old = previous.identity;
            const unchanged = old.kind === 'text' && identity.kind === 'text' ||
              old.kind === 'file' && identity.kind === 'file' && digest(old) === digest(identity) ||
              (old.kind === 'bookmark' || old.kind === 'browser') && (identity.kind === 'bookmark' || identity.kind === 'browser') && old.url === identity.url;
            if (!unchanged) throw new HarnessError('SOURCE_CHANGED', 'A source identity cannot be rebound. Create a separate source.');
          }
          const sha256 = bytes ? researchHash(bytes) : null, materialId = sha256 ? key(context, sha256) : null;
          if (materialId && !this.store.get('researchMaterial', materialId)) this.store.put('researchMaterial', materialId, context.threadId, {base64: bytes!.toString('base64')});
          const record: ResearchSource = {...context, id: data.sourceId, revision: data.expectedRevision + 1, title: data.title, identity, status: bytes ? 'captured' : 'unconfirmed', capturedAt: bytes ? new Date().toISOString() : null, sha256, bytes: bytes?.length ?? 0, materialId};
          this.store.put('researchSourceVersion', versionKey(context, record.id, record.revision), context.threadId, record);
          this.store.put('researchSource', key(context, record.id), context.threadId, record);
          return {sourceId: record.id, revision: record.revision, sha256};
        });
      };
      if (command.type === 'research.source.bookmark') return commit(null, {kind: 'bookmark', url: safeUrl(command.payload.url)});
      const source = command.payload.input;
      if (source.kind === 'text') return commit(textBytes(source.text, RESEARCH_SOURCE_BYTES), {kind: 'text'});
      if (source.kind === 'file') return withGrantedResearchFile(this.store, context, source.resourceId, source.relativePath, signal, capture => commit(capture.bytes, {kind: 'file', resourceId: source.resourceId, ...(source.relativePath ? {relativePath: source.relativePath} : {}), grantBinding: capture.grantBinding, dev: capture.reference.dev, ino: capture.reference.ino}, capture.assertCurrent), source.expected);
      const browser = this.options.browser;
      if (!browser) throw new HarnessError('CAPABILITY_UNAVAILABLE', 'This host has no authorized browser capture provider.');
      if (browser.authority.kind !== 'personal') return researchDenied();
      return browser.withCapture({context, browserId: source.browserId, navigationId: source.navigationId, maxBytes: RESEARCH_SOURCE_BYTES}, signal, async capture => {
        if (capture.browserId !== source.browserId || capture.navigationId !== source.navigationId || !/^[A-Za-z0-9:_-]{1,200}$/.test(capture.authorizationId)) return researchDenied();
        if (capture.bytes.byteLength > RESEARCH_SOURCE_BYTES) throw new HarnessError('RESOURCE_LIMIT', 'Research sources are limited to 4 MiB.');
        return commit(Buffer.from(capture.bytes), {kind: 'browser', browserId: capture.browserId, navigationId: capture.navigationId, authorizationId: capture.authorizationId, url: safeUrl(capture.url)}, () => {
          const result: unknown = capture.assertCurrent();
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => {});
            researchDenied();
          }
        });
      });
    };
    const promise = execute(); this.pending.set(command.id, {hash, promise});
    try {return await promise;} finally {if (this.pending.get(command.id)?.promise === promise) this.pending.delete(command.id);}
  }
}
