import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import {
  CURSOR_KEY_UNAVAILABLE,
  DEVICE_GRANT_REVOKED,
  PERSONAL_PROJECT_SCOPE,
  REMOTE_INPUT_DISABLED,
  SYNC_CURSOR_SCHEMA_VERSION,
  SYNC_PAGE_MAX_BYTES,
  SYNC_PAGE_MAX_EVENTS,
  syncPageV1Schema,
  type DeviceGrantV1,
  type RemoteViewStatus,
  type SyncCursorV1,
  type SyncDeltaV1,
  type SyncEvidenceDeltaV1,
  type SyncPageV1,
  type SyncTaskDeltaV1,
} from '../contracts/paired-device.ts';
import { capabilityEnabled } from './capability-flags.ts';
import { digest, type Store } from '../storage/store.ts';

/** M17 bounded read synchronization (S04/S05/S06/D04/D05/D06). The host is
 * the only Store writer; this module only reads the public task/evidence
 * projections and emits ordered deltas signed by a host-custodied cursor key.
 * No native Hermes/Pi session data, credential stores or raw private logs are
 * ever projected (S04/S09). */

interface CursorKey { keyId: string; material: string }
interface CursorKeyRecord { version: number; current: CursorKey; previous: CursorKey | null }
const CURSOR_KEY_ENTITY = 'readSyncCursorKey';
const EVIDENCE_EVENT = /artifact|verification|checkpoint|evidence/i;

const denied = (code: string, message: string) => new HarnessError(code, message);
const invalidCursor = () => denied('INVALID_CURSOR', 'The sync cursor is invalid for this device grant.');
const resync = () => denied('RESYNC_REQUIRED', 'The retained source history or schema changed; fetch a new authorized snapshot.');

export class ReadSyncHost {
  constructor(private readonly store: Store, private readonly deps: { now?: () => number } = {}) {}
  private now(): number { return (this.deps.now ?? Date.now)(); }
  private write<T>(type: string, apply: () => T): T {
    return this.store.inTransaction ? apply() : this.store.internal(type, null, apply) as T;
  }
  private enabled() {
    if (!capabilityEnabled('remote.readSyncV1')) throw denied('CAPABILITY_DENIED', 'Remote read synchronization is disabled on this host.');
  }

  /** D04: the cursor signing key lives in the host-custodied Store as a
   * 'hostSecret' entity. The entity body never enters snapshots, event
   * payloads or receipts — the recorded result is the key id only. If the
   * host secret binding cannot be read or written, cursor issuance is
   * BLOCKED with CURSOR_KEY_UNAVAILABLE (HOLD_CURSOR_KEY_CUSTODY). */
  private keyRecord(): CursorKeyRecord {
    const record = this.store.get<CursorKeyRecord>('hostSecret', CURSOR_KEY_ENTITY);
    if (!record || typeof record.current?.material !== 'string' || record.current.material.length !== 64) throw denied(CURSOR_KEY_UNAVAILABLE, 'The host cursor key cannot be bound; remote sync is blocked.');
    return record;
  }
  private ensureKey(): CursorKey {
    try { return this.keyRecord().current; } catch { /* mint below */ }
    // No key yet — mint one inside a host transaction. The event result
    // carries the key id only; material stays inside the entity body.
    const material = randomBytes(32).toString('hex'), keyId = randomBytes(8).toString('hex');
    this.write('host.cursorKey.issued', () => {
      const existing = this.store.get<CursorKeyRecord>('hostSecret', CURSOR_KEY_ENTITY);
      if (existing) return { keyId: existing.current.keyId };
      this.store.put('hostSecret', CURSOR_KEY_ENTITY, null, { version: 1, current: { keyId, material }, previous: null });
      return { keyId };
    });
    return this.keyRecord().current;
  }
  /** Key rotation keeps the previous key able to verify already-issued
   * cursors; new cursors sign under the current key. */
  rotateCursorKey(): { keyId: string } {
    const record = this.keyRecord();
    const material = randomBytes(32).toString('hex'), keyId = randomBytes(8).toString('hex');
    return this.write('host.cursorKey.rotated', () => {
      const next: CursorKeyRecord = { version: record.version + 1, current: { keyId, material }, previous: record.current };
      this.store.put('hostSecret', CURSOR_KEY_ENTITY, null, next);
      return { keyId };
    });
  }
  private sign(cursor: SyncCursorV1): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return payload + '.' + createHmac('sha256', Buffer.from(this.keyMaterial(cursor.keyId), 'hex')).update(payload).digest('base64url');
  }
  private keyMaterial(keyId: string): string {
    const record = this.keyRecord();
    if (record.current.keyId === keyId) return record.current.material;
    if (record.previous?.keyId === keyId) return record.previous.material;
    throw invalidCursor();
  }
  private verify(token: string): SyncCursorV1 {
    const [payload, signature, extra] = token.split('.');
    if (!payload || extra !== undefined || !/^[\w-]+$/.test(payload) || !/^[\w-]{43}$/.test(signature ?? '')) throw invalidCursor();
    let cursor: SyncCursorV1;
    try { cursor = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SyncCursorV1; } catch { throw invalidCursor(); }
    const material = this.keyMaterial(cursor.keyId);
    const supplied = Buffer.from(signature, 'base64url'), expected = createHmac('sha256', Buffer.from(material, 'hex')).update(payload).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalidCursor();
    return cursor;
  }

  private filterDigest(grant: DeviceGrantV1): string {
    return digest({ scopes: [...grant.scopes].sort(), approvedProjects: [...grant.approvedProjects].sort() });
  }
  private liveGrant(grantId: string): DeviceGrantV1 {
    const grant = this.store.get<DeviceGrantV1>('deviceGrant', grantId);
    if (!grant) throw denied('CAPABILITY_DENIED', 'The device grant no longer exists.');
    if (grant.revokedAt) throw denied(DEVICE_GRANT_REVOKED, 'This device grant was revoked.');
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= this.now()) throw denied('CAPABILITY_DENIED', 'This device grant expired.');
    return grant;
  }
  private bind(grant: DeviceGrantV1, cursor: SyncCursorV1) {
    // S06: a stale schema or an expired retention window resyncs; a changed
    // owner, filter or generation is a hard cursor rejection (D02).
    if (cursor.schemaVersion !== SYNC_CURSOR_SCHEMA_VERSION) throw resync();
    if (cursor.owner !== grant.grantId || cursor.deviceGrantGeneration !== grant.grantGeneration || cursor.filterDigest !== this.filterDigest(grant)) throw invalidCursor();
    if (cursor.afterSeq > cursor.snapshotUpperSeq) throw invalidCursor();
    if (cursor.afterSeq < this.retentionFloor()) throw resync();
  }

  /** Oldest retained source sequence. Anything below it cannot be verified —
   * a cursor positioned there is a verified retention gap, never a filtered
   * one (D03/S06). */
  retentionFloor(): number {
    const row = this.store.db.prepare('SELECT MIN(seq) AS floor FROM events').get() as { floor: number | null };
    return row.floor ?? 0;
  }

  private threadScope(threadId: string): { scope: string; thread: SyncTaskDeltaV1 } | null {
    const thread = this.store.get<{
      id: string; title: string; status: string; epoch: number; projectId?: string | null; projectName: string | null; kind?: string; updatedAt: string;
    }>('thread', threadId);
    if (!thread) return null;
    return {
      scope: thread.projectId ?? PERSONAL_PROJECT_SCOPE,
      thread: { threadId: thread.id, title: thread.title, status: thread.status, epoch: thread.epoch, projectId: thread.projectId ?? null, projectName: thread.projectName, kind: thread.kind ?? 'main', updatedAt: thread.updatedAt },
    };
  }
  private evidenceFor(threadId: string): SyncEvidenceDeltaV1[] {
    return this.store.all<{ id: string; threadId: string; title: string; kind: string; revision: number; lifecycle: string; updatedAt: string }>('artifact', threadId)
      .map(item => ({ artifactId: item.id, threadId: item.threadId, title: item.title, kind: item.kind, revision: item.revision, lifecycle: item.lifecycle, updatedAt: item.updatedAt }));
  }

  /** Emission rules: a task delta for every authorized event under
   * VIEW_TASKS; an evidence delta only for evidence-class events under a
   * separately granted VIEW_EVIDENCE (D03). Foreign-project and
   * unattributable events are filtered — a normal gap, never filled. */
  private authorizedDelta(seq: number, eventType: string, threadId: string | null, grant: DeviceGrantV1): SyncDeltaV1 | null {
    if (!threadId) return null;
    const target = this.threadScope(threadId);
    if (!target || !grant.approvedProjects.includes(target.scope)) return null;
    if (grant.scopes.includes('VIEW_EVIDENCE') && EVIDENCE_EVENT.test(eventType))
      return { seq, threadId, kind: 'evidence', task: null, evidence: this.evidenceFor(threadId) };
    if (!grant.scopes.includes('VIEW_TASKS')) return null;
    return { seq, threadId, kind: 'task', task: target.thread, evidence: null };
  }

  /** One bounded page over the fixed range (afterSeq, upperSeq]. Scanning
   * stops at the first bound: 1,000 authorized deltas or 1 MiB of payload.
   * The cursor's afterSeq is the last scanned source sequence, so filtered
   * records still advance it (S05). */
  private scan(grant: DeviceGrantV1, keyId: string, afterSeq: number, upperSeq: number): { page: SyncPageV1 } {
    const deltas = new Map<string, SyncDeltaV1>();
    let bytes = 0, scanned = afterSeq, full = false;
    for (;;) {
      const batch = this.store.eventsAfter(scanned, 500);
      if (!batch.length) break;
      let stop = false;
      for (const event of batch) {
        if (event.seq > upperSeq) { stop = true; break; }
        const delta = this.authorizedDelta(event.seq, event.type, event.threadId, grant);
        if (delta) {
          const size = Buffer.byteLength(JSON.stringify(delta));
          // A bound cut stops before this event is emitted; afterSeq stays at
          // the last fully processed sequence so the next page re-reads it.
          // One delta larger than the byte bound can never page — it is
          // dropped like a filtered record so the cursor still advances.
          if (bytes === 0 && deltas.size === 0 && size > SYNC_PAGE_MAX_BYTES) { scanned = event.seq; continue; }
          if (deltas.size >= SYNC_PAGE_MAX_EVENTS || bytes + size > SYNC_PAGE_MAX_BYTES) { full = true; break; }
          const key = `${delta.kind}:${delta.threadId}`;
          deltas.delete(key);
          deltas.set(key, delta);
          bytes += size;
        }
        scanned = event.seq;
      }
      if (full || stop || batch.length < 500) break;
    }
    // Without a bound cut, the whole range was examined — including empty
    // tail space — so the scanned position is the cut itself.
    if (!full) scanned = upperSeq;
    const ordered = [...deltas.values()].sort((a, b) => a.seq - b.seq);
    const complete = !full;
    const cursor: SyncCursorV1 = {
      owner: grant.grantId,
      deviceGrantGeneration: grant.grantGeneration,
      filterDigest: this.filterDigest(grant),
      schemaVersion: SYNC_CURSOR_SCHEMA_VERSION,
      snapshotUpperSeq: upperSeq,
      afterSeq: scanned,
      keyId,
    };
    return {
      page: {
        authority: 'personal',
        deltas: ordered,
        nextCursor: this.sign(cursor),
        complete,
        snapshotUpperSeq: upperSeq,
        afterSeq: scanned,
        sourceTimestamp: new Date(this.now()).toISOString(),
      },
    };
  }

  /** A fresh authorized snapshot: one fixed upper source sequence over the
   * retained range. Deltas are public projections at the cut — replaying the
   * emitted cursor inside the snapshot returns the same slice (S05/D05). */
  snapshot(grant: DeviceGrantV1): SyncPageV1 {
    this.enabled();
    const live = this.liveGrant(grant.grantId);
    const keyId = this.ensureKey().keyId;
    this.store.db.exec('BEGIN');
    try {
      const upperSeq = this.store.sequence;
      const result = this.scan(live, keyId, 0, upperSeq);
      this.liveGrant(live.grantId);
      this.store.db.exec('COMMIT');
      return result.page;
    } catch (error) { try { this.store.db.exec('ROLLBACK'); } catch { /* closed */ } throw error; }
  }

  /** Continue inside the cursor's fixed snapshot cut. A completed cursor
   * returns the same empty remainder — advancing to new source history is an
   * explicit advance() call, never implicit (S05). */
  page(grant: DeviceGrantV1, token: string): SyncPageV1 {
    this.enabled();
    const live = this.liveGrant(grant.grantId);
    const cursor = this.verify(token);
    this.bind(live, cursor);
    if (cursor.afterSeq >= cursor.snapshotUpperSeq) {
      return { authority: 'personal', deltas: [], nextCursor: this.sign(cursor), complete: true, snapshotUpperSeq: cursor.snapshotUpperSeq, afterSeq: cursor.afterSeq, sourceTimestamp: new Date(this.now()).toISOString() };
    }
    this.store.db.exec('BEGIN');
    try {
      const result = this.scan(live, cursor.keyId, cursor.afterSeq, cursor.snapshotUpperSeq);
      this.liveGrant(live.grantId);
      this.store.db.exec('COMMIT');
      return result.page;
    } catch (error) { try { this.store.db.exec('ROLLBACK'); } catch { /* closed */ } throw error; }
  }

  /** Move a completed cursor forward to a new fixed cut at the current
   * sequence. Replaying the old cursor is still valid and unchanged; the new
   * cursor carries a new immutable upper bound. */
  advance(grant: DeviceGrantV1, token: string): SyncPageV1 {
    this.enabled();
    const live = this.liveGrant(grant.grantId);
    const cursor = this.verify(token);
    this.bind(live, cursor);
    if (cursor.afterSeq < cursor.snapshotUpperSeq) throw denied('INVALID_INPUT', 'Finish the current snapshot before advancing its cut.');
    const keyId = this.ensureKey().keyId;
    this.store.db.exec('BEGIN');
    try {
      const upperSeq = this.store.sequence;
      const result = this.scan(live, keyId, cursor.afterSeq, upperSeq);
      this.liveGrant(live.grantId);
      this.store.db.exec('COMMIT');
      return result.page;
    } catch (error) { try { this.store.db.exec('ROLLBACK'); } catch { /* closed */ } throw error; }
  }

  /** S08/D05: remote submission is a separately gated phase. Both routes
   * reject before any durable-input admission; a future admitted submission
   * uses the same immutable input ID across retries and never grants remote
   * approval of another action. */
  submitInput(_grant: DeviceGrantV1, _input: unknown): never {
    throw denied(REMOTE_INPUT_DISABLED, 'Remote input submission is disabled until its M09 durable-input and M02 authority contracts are bound and tested.');
  }
  approveOperation(_grant: DeviceGrantV1, _operation: unknown): never {
    throw denied(REMOTE_INPUT_DISABLED, 'Remote operation approval is disabled until its M09 durable-input and M02 authority contracts are bound and tested.');
  }
}

/** C4/U02/U03/S07/S10: the bounded remote client. It applies a page only
 * after the whole bounded page validates against the request generation that
 * produced it — older request responses are discarded client-side (S05).
 * Canonical task facts and unsent drafts stay strictly separate: drafts are
 * editable offline, never execute offline, and are never mistaken for
 * delivered instructions. S09: cached artifacts are device-scoped and cleared
 * explicitly; already downloaded bytes cannot be remotely undisclosed. */
export interface ReadSyncTransport {
  snapshot(): Promise<SyncPageV1>;
  page(cursor: string): Promise<SyncPageV1>;
  advance(cursor: string): Promise<SyncPageV1>;
}

export const REMOTE_STALE_AFTER_MS = 30_000;

export class ReadSyncClient {
  readonly tasks = new Map<string, SyncTaskDeltaV1>();
  readonly evidence = new Map<string, SyncEvidenceDeltaV1>();
  readonly drafts = new Map<string, string>();
  status: RemoteViewStatus = 'OFFLINE';
  sourceTimestamp: string | null = null;
  lastError: string | null = null;
  private cursor: string | null = null;
  private appliedSeq = 0;
  private requestGeneration = 0;

  /** The generation a new page request is issued under; a response carrying
   * an older generation is stale and ignored by the client (S05). */
  nextGeneration(): number { return this.requestGeneration; }

  /** Validate then apply a whole bounded page. Returns the disposition —
   * 'stale' when the response belongs to an older request generation or a
   * lower source position, 'invalid' when it fails the wire contract. */
  acceptPage(generation: number, page: unknown): 'applied' | 'stale' | 'invalid' {
    if (generation < this.requestGeneration) return 'stale';
    const parsed = syncPageV1Schema.safeParse(page);
    if (!parsed.success) return 'invalid';
    const value = parsed.data;
    if (value.afterSeq < this.appliedSeq) return 'stale';
    for (const delta of value.deltas) {
      if (delta.task) this.tasks.set(delta.threadId, delta.task);
      if (delta.evidence) for (const item of delta.evidence) this.evidence.set(item.artifactId, item);
    }
    this.appliedSeq = value.afterSeq;
    this.cursor = value.nextCursor;
    this.sourceTimestamp = value.sourceTimestamp;
    return 'applied';
  }

  private async pump(transport: ReadSyncTransport, first: SyncPageV1): Promise<void> {
    let page: SyncPageV1 | null = first;
    const generation = ++this.requestGeneration;
    while (page) {
      const accepted = this.acceptPage(generation, page);
      if (accepted === 'invalid') throw denied('INVALID_CURSOR', 'The remote page failed validation.');
      if (accepted === 'stale') return;
      if (!page.nextCursor || page.complete) return;
      page = await transport.page(page.nextCursor);
    }
  }

  /** Full authorized snapshot then bounded pages to the cut. A RESYNC during
   * paging restarts from a fresh snapshot — never a silent gap (S06/U03). */
  async sync(transport: ReadSyncTransport): Promise<RemoteViewStatus> {
    this.status = 'RESYNCING';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // A fresh snapshot cut supersedes the old source position; cached
        // task/evidence rows stay until new pages replace them (U02).
        this.appliedSeq = 0;
        this.cursor = null;
        const first = await transport.snapshot();
        await this.pump(transport, first);
        this.status = 'SYNCED';
        this.lastError = null;
        return this.status;
      } catch (error) {
        if (!(error instanceof HarnessError && error.code === 'RESYNC_REQUIRED')) {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.status = 'OFFLINE';
          return this.status;
        }
        this.status = 'RESYNCING';
      }
    }
    this.lastError = 'Repeated resynchronization requests.';
    return this.status;
  }

  /** Incremental refresh after a completed snapshot. RESYNC_REQUIRED marks
   * the view RESYNCING and falls back to a fresh authorized snapshot. */
  async refresh(transport: ReadSyncTransport): Promise<RemoteViewStatus> {
    if (!this.cursor) return this.sync(transport);
    try {
      const first = await transport.advance(this.cursor);
      await this.pump(transport, first);
      this.status = 'SYNCED';
      this.lastError = null;
    } catch (error) {
      const code = error instanceof HarnessError ? error.code : '';
      if (code === 'RESYNC_REQUIRED') { this.status = 'RESYNCING'; return this.sync(transport); }
      this.lastError = error instanceof Error ? error.message : String(error);
      this.status = 'OFFLINE';
    }
    return this.status;
  }

  /** U02: staleness is a view presentation, not a mutation. The source
   * timestamp shown is the host's snapshot-cut time. */
  freshness(nowMs: number): RemoteViewStatus {
    if (this.status === 'OFFLINE' || this.status === 'RESYNCING') return this.status;
    if (this.sourceTimestamp === null) return this.status;
    return nowMs - Date.parse(this.sourceTimestamp) > REMOTE_STALE_AFTER_MS ? 'STALE' : this.status;
  }

  /** S07/U03: unsent drafts stay editable and separate from canonical facts;
   * they can never confirm a task action. Remote submission is disabled in
   * this phase — saving produces no send path at all. */
  saveDraft(threadId: string, text: string): void { this.drafts.set(threadId, text); }
  submitDraft(_threadId: string): { submitted: false; reason: string } {
    return { submitted: false, reason: REMOTE_INPUT_DISABLED };
  }

  /** S09: explicit device-scoped cache clear. Local drafts are retained —
   * they are unsent local state, not host data. */
  clearCache(): void {
    this.tasks.clear();
    this.evidence.clear();
    this.cursor = null;
    this.appliedSeq = 0;
    this.sourceTimestamp = null;
    this.status = 'OFFLINE';
  }
}
