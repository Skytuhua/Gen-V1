import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { HarnessError, type HostCommand, type Message, type ResourceGrant, type RunContext, type Thread } from '../contracts/index.ts';
import type { ProjectSummary } from '../contracts/workspace.ts';
import { PROJECT_MEMORY_LIMITS as LIMITS, memoryActionSchema, memoryItemV1Schema, memoryRecallV1Schema, memorySourceRefV1Schema, memoryTombstoneV1Schema, memoryScope, type MemoryAccess, type MemoryAction, type MemoryExport, type MemoryForgetPreview, type MemoryItemV1, type MemoryMutationResult, type MemoryRecallV1, type MemorySourceDetail, type MemorySourceRefV1, type MemorySourceSnapshot, type MemoryTombstoneV1, type ProjectMemoryView, type StoredMemory } from '../contracts/project-memory.ts';
import { digest, Store } from '../storage/store.ts';
import { ProjectTools, type WorkspaceBinding } from '../workspace/tools.ts';
import { capabilityEnabled } from './capability-flags.ts';
import { readBoundFile, withResourceGrant } from './file-access.ts';
import { projectMemoryDeletionLedgerPath } from './security.ts';
import { memoryContainsSecret } from './memory-publication.ts';
import { memoryUsageReportSchema, type MemoryUsageReport } from '../contracts/project-memory.ts';
import { validateMemoryExtraction, type MemoryCheckpointV1, type MemoryConsolidationSnapshot, type MemoryExtractionCut, type MemoryExtractionResult } from './memory-consolidation.ts';
import { sourceRefsV1Schema, type LogicalOwnerV1, type SourceRefV1 } from '../contracts/source-selection.ts';
import type { RetainedFileSource } from './source-workbench.ts';
export { memoryContainsSecret } from './memory-publication.ts';

export interface ProjectMemoryOptions {
  enabled?: () => boolean;
  readFileSource?: (owner: LogicalOwnerV1, ref: SourceRefV1) => RetainedFileSource;
}
interface Config { id: string; revision: number; enabled: boolean; sourceThreadIds: string[]; watermark: number }
interface Deletion { profileId: string; projectId: string; accountId: string | null; tombstone: MemoryTombstoneV1 }
interface PhysicalRoot { path: string; identity: { dev: string; ino: string } }
interface Derived { id: string; projectIdentity: string; accountId: string | null; refs: { itemId: string; revision: number }[]; valid: boolean }
interface LedgerIdentity { path: string; dev: string; ino: string }
const stamp = () => new Date().toISOString();
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
function fail(message: string, code = 'INVALID_MEMORY'): never { throw new HarnessError(code, message); }

function checkedText(text: string): string {
  if (!text.trim() || Buffer.byteLength(text) > LIMITS.textBytes || memoryContainsSecret(text) || text.includes('\0')) fail('Keep memory under 2 KiB and omit credentials and private keys.');
  return text.trim();
}
function physicalMatches(root: PhysicalRoot, kind: 'directory' | 'file' = 'directory'): boolean {
  try { const info = lstatSync(root.path, { bigint: true }), normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path); return (kind === 'directory' ? info.isDirectory() : info.isFile()) && !info.isSymbolicLink() && normalize(realpathSync(root.path)) === normalize(root.path) && String(info.dev) === root.identity.dev && String(info.ino) === root.identity.ino; } catch { return false; }
}

/** Host-owned memory admission and storage. Models never receive its mutation API. */
export class ProjectMemory {
  private readonly tools: ProjectTools;
  private readonly profileId: string;
  private readonly deletions = new Map<string, Deletion>();
  private readonly deletionPath: string;
  private readonly fencePath: string;
  private fenceIdentity: LedgerIdentity | null;
  private readonly enabled: () => boolean;
  constructor(readonly store: Store, private readonly options: ProjectMemoryOptions = {}) {
    // Updates can free old item/source cells before a later Forget. Erase those
    // cells from the first memory write, not only while deleting current rows.
    store.db.exec('PRAGMA secure_delete=ON');
    if (!store.get('projectMemoryStorageFormat', 'secure-delete-v1')) {
      // A pre-fix database (including a restored backup) can already contain
      // unreferenced plaintext cells. Secure deletion cannot erase them after
      // the fact. This one-time host migration rebuilds live pages outside a
      // Store transaction; it is not part of the bounded maintenance batch.
      // Failure leaves the format unmarked and M05 unavailable for retry.
      const legacy = store.db.prepare("SELECT 1 FROM entities WHERE kind >= 'projectMemory' AND kind < 'projectMemorz' LIMIT 1").get();
      if (legacy) {
        store.db.exec('VACUUM');
        const busyTimeout = (store.db.prepare('PRAGMA busy_timeout').get() as {timeout: number}).timeout;
        store.db.exec('PRAGMA busy_timeout=0');
        try {
          if ((store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as {busy: number}).busy) fail('The memory storage migration is waiting for an old database reader.', 'MEMORY_STORAGE_MIGRATION_PENDING');
        } finally {store.db.exec(`PRAGMA busy_timeout=${busyTimeout}`);}
      }
      store.internal('project.memory.storage.migrated', null, () => {
        store.put('projectMemoryStorageFormat', 'secure-delete-v1', null, {version: 1, secureDelete: true});
        return {version: 1, legacyPagesRebuilt: Boolean(legacy)};
      });
    }
    this.tools = new ProjectTools(store); this.enabled = options.enabled ?? (() => capabilityEnabled('memory.projectV1'));
    const profile = lstatSync(store.dataDir, { bigint: true });
    this.profileId = digest({ path: store.dataDir, dev: String(profile.dev), ino: String(profile.ino) });
    this.deletionPath = join(store.dataDir, 'project-memory-deletions.jsonl');
    this.fencePath = projectMemoryDeletionLedgerPath(store.dataDir);
    this.fenceIdentity = store.get<LedgerIdentity>('projectMemoryLedger', this.profileId);
    this.assertDeletionFence();
    // Additive indexes keep maintenance scoped to the affected project and item.
    store.db.exec(`
      CREATE INDEX IF NOT EXISTS project_memory_items_scope ON entities(json_extract(body,'$.item.projectIdentity'),json_extract(body,'$.accountId'),json_extract(body,'$.profileId')) WHERE kind='projectMemoryItem';
      CREATE INDEX IF NOT EXISTS project_memory_revisions_scope ON entities(json_extract(body,'$.item.projectIdentity'),json_extract(body,'$.accountId'),json_extract(body,'$.item.id'),id) WHERE kind='projectMemoryRevision';
      CREATE INDEX IF NOT EXISTS project_memory_sources_scope ON entities(json_extract(body,'$.projectIdentity'),json_extract(body,'$.accountId'),json_extract(body,'$.ref.digest'),id) WHERE kind='projectMemorySource';
      CREATE INDEX IF NOT EXISTS project_memory_sources_revision ON entities(json_extract(body,'$.projectIdentity'),json_extract(body,'$.accountId'),json_extract(body,'$.ref.ownerThreadId'),json_extract(body,'$.ref.sourceKind'),json_extract(body,'$.ref.sourceId'),json_extract(body,'$.ref.sourceRevision'),json_extract(body,'$.ref.digest'),json_extract(body,'$.ref.observedStatus'),json_extract(body,'$.fileGrant.resourceId'),json_extract(body,'$.fileGrant.grantDigest'),json_extract(body,'$.ref.capturedSeq'),id) WHERE kind='projectMemorySource';
      CREATE INDEX IF NOT EXISTS project_memory_derived_scope ON entities(json_extract(body,'$.projectIdentity'),json_extract(body,'$.accountId')) WHERE kind='projectMemoryDerived';
      CREATE INDEX IF NOT EXISTS project_memory_tombstones_scope ON entities(json_extract(body,'$.tombstone.projectIdentity'),json_extract(body,'$.accountId'),json_extract(body,'$.profileId')) WHERE kind='projectMemoryTombstone';
      CREATE INDEX IF NOT EXISTS project_memory_auxiliary_scope ON entities(json_extract(body,'$.projectIdentity'),json_extract(body,'$.accountId'),json_extract(body,'$.profileId')) WHERE kind='projectMemoryAuxiliaryUsage';
      CREATE INDEX IF NOT EXISTS project_memory_request_usage_scope ON entities(json_extract(body,'$.projectIdentity'),json_extract(body,'$.accountId'),json_extract(body,'$.profileId')) WHERE kind='projectMemoryRequestUsage';
    `);
    this.loadDeletions();
  }
  private ledgerIdentity(path: string, fd: number): LedgerIdentity {
    const file = fstatSync(fd, { bigint: true });
    if (!file.isFile() || file.nlink !== 1n || file.size > 64n * 1024n * 1024n || (process.platform !== 'win32' && ((file.mode & 0o077n) !== 0n || (process.getuid && file.uid !== BigInt(process.getuid()))))) fail('The memory deletion ledger is unavailable.', 'MEMORY_DELETION_LEDGER');
    return { path, dev: String(file.dev), ino: String(file.ino) };
  }
  private ordinaryLedger(path: string): void {
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) fail('The memory deletion ledger must be an ordinary private file.', 'MEMORY_DELETION_LEDGER');
  }
  private assertDeletionFence(): void {
    if (!this.fenceIdentity) return;
    let fd: number | undefined;
    try {
      this.ordinaryLedger(this.fencePath);
      fd = openSync(this.fencePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (digest(this.ledgerIdentity(this.fencePath, fd)) !== digest(this.fenceIdentity)) fail('The enrolled deletion ledger changed.', 'MEMORY_DELETION_LEDGER');
    } catch { fail('The enrolled memory deletion ledger needs recovery.', 'MEMORY_DELETION_LEDGER'); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  private syncLedgerDirectory(path: string): void {
    if (process.platform !== 'win32') { const directory = openSync(dirname(path), constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); } }
  }
  private ensureDeletionFence(): void {
    if (this.fenceIdentity) {
      this.assertDeletionFence();
      if (digest(this.store.get('projectMemoryLedger', this.profileId)) === digest(this.fenceIdentity)) return;
    }
    let fd: number;
    try { fd = openSync(this.fencePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; this.ordinaryLedger(this.fencePath); fd = openSync(this.fencePath, constants.O_WRONLY | constants.O_NOFOLLOW); }
    try { this.fenceIdentity = this.ledgerIdentity(this.fencePath, fd); fsyncSync(fd); }
    finally { closeSync(fd); }
    this.syncLedgerDirectory(this.fencePath);
    this.loadDeletions();
    // Carry forward any older local deletion records before enrollment can succeed.
    for (const entry of this.deletions.values()) this.writeDeletion(this.fencePath, entry, this.fenceIdentity);
    this.store.internal('project.memory.ledger.enrolled', null, () => { this.store.put('projectMemoryLedger', this.profileId, null, this.fenceIdentity); return { enrolled: true }; });
  }
  private loadDeletions(): void {
    for (const path of [this.deletionPath, this.fencePath]) {
    if (!existsSync(path)) continue;
    this.ordinaryLedger(path);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let data: string;
    try { this.ledgerIdentity(path, fd); data = readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
    for (const line of data.split('\n').filter(Boolean)) {
      let entry: Deletion;
      try { entry = z.strictObject({ profileId: z.string(), projectId: z.string(), accountId: z.string().nullable(), tombstone: memoryTombstoneV1Schema }).parse(JSON.parse(line)); }
      catch { fail('The memory deletion ledger needs recovery before memory can be used.', 'MEMORY_DELETION_LEDGER'); }
      const old = this.deletions.get(entry!.tombstone.itemId);
      if (!old || old.tombstone.deletionRevision < entry!.tombstone.deletionRevision) this.deletions.set(entry!.tombstone.itemId, entry!);
      else if (old.tombstone.deletionRevision === entry!.tombstone.deletionRevision) this.deletions.set(entry!.tombstone.itemId, { ...old, tombstone: memoryTombstoneV1Schema.parse({ ...old.tombstone,
        sourceExclusions: [...new Map([...old.tombstone.sourceExclusions, ...entry!.tombstone.sourceExclusions].map(ref => [digest(ref), ref])).values()],
        affectedDerivedArtifacts: [...new Set([...old.tombstone.affectedDerivedArtifacts, ...entry!.tombstone.affectedDerivedArtifacts])],
        purgeStatus: old.tombstone.purgeStatus === 'COMPLETE' || entry!.tombstone.purgeStatus === 'COMPLETE' ? 'COMPLETE' : 'PENDING',
      }) });
    }
    }
    // The sibling fence survives SQLite-only and in-place whole-profile restoration.
    const missing = [...this.deletions.values()].filter(entry => entry.profileId === this.profileId).map(entry => this.reconcileArtifacts(entry));
    if (missing.length) this.store.internal('project.memory.deletions.reconciled', null, () => {
      for (const entry of missing) { this.store.put('projectMemoryTombstone', entry.tombstone.itemId, null, entry); this.invalidateDeletion(entry); }
      return { count: missing.length };
    });
  }
  private writeDeletion(path: string, entry: Deletion, expected?: LedgerIdentity): void {
    const current = existsSync(path) ? lstatSync(path) : null;
    if (current && (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.size > 64 * 1024 * 1024)) fail('The memory deletion ledger is unavailable.', 'MEMORY_DELETION_LEDGER');
    const fd = openSync(path, constants.O_WRONLY | (expected ? 0 : constants.O_CREAT) | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try {
      const identity = this.ledgerIdentity(path, fd);
      if (expected && digest(identity) !== digest(expected)) fail('The enrolled deletion ledger changed.', 'MEMORY_DELETION_LEDGER');
      const bytes = Buffer.from(JSON.stringify(entry) + '\n');
      if (fstatSync(fd).size + bytes.length > 64 * 1024 * 1024) fail('The deletion ledger needs bounded maintenance before more writes.', 'MEMORY_DELETION_LEDGER');
      let offset = 0; while (offset < bytes.length) offset += writeSync(fd, bytes, offset); fsyncSync(fd);
    } finally { closeSync(fd); }
    if (!current) this.syncLedgerDirectory(path);
  }
  private appendDeletion(entry: Deletion): void {
    this.assertDeletionFence();
    if (!this.fenceIdentity) fail('A deletion ledger must be enrolled before Forget.', 'MEMORY_DELETION_LEDGER');
    this.writeDeletion(this.fencePath, entry, this.fenceIdentity);
    this.deletions.set(entry.tombstone.itemId, structuredClone(entry));
    this.writeDeletion(this.deletionPath, entry);
  }
  /** Synchronous attestation for an already admitted host lifecycle transaction. */
  currentAccess(projectId: string, threadId: string): MemoryAccess {
    const project = this.store.get<ProjectSummary>('workspaceProject', projectId), thread = this.store.get<Thread>('thread', threadId), root = this.store.get<PhysicalRoot>('workspaceProjectRoot', projectId);
    if (!project || project.authority.kind !== 'local' || !thread || thread.projectId !== projectId || thread.sideParentId || thread.kind === 'side' || thread.kind === 'delegate' || this.store.get('archivedThread', threadId) || !root || !physicalMatches(root)) fail('The attested project or owning conversation changed.', 'CAPABILITY_DENIED');
    const workspace = thread!.workspaceId ? this.store.get<WorkspaceBinding>('workspaceBinding', thread!.workspaceId) : null;
    if (thread!.workspaceId && (!workspace || workspace.threadId !== threadId || workspace.projectId !== projectId || !physicalMatches(workspace))) fail('The working copy changed.', 'CAPABILITY_DENIED');
    const projectIdentity = digest({ profileId: this.profileId, projectId, physical: root!.identity });
    return { profileId: this.profileId, projectId, projectIdentity, threadId, accountId: thread!.accountId ?? null,
      bindingDigest: digest({ projectIdentity, threadId, accountId: thread!.accountId ?? null, epoch: thread!.epoch, runId: thread!.runId, modelId: thread!.modelId, workspaceId: thread!.workspaceId ?? null, workspaceIdentity: workspace?.identity ?? null }) };
  }
  async access(projectId: string, threadId: string): Promise<MemoryAccess> { await this.tools.binding(projectId, threadId); return this.currentAccess(projectId, threadId); }
  assertAccess(access: MemoryAccess): void { this.assertDeletionFence(); if (digest(access) !== digest(this.currentAccess(access.projectId, access.threadId))) fail('Memory ownership changed. Refresh the project.', 'CAPABILITY_DENIED'); }
  private key(access: MemoryAccess): string { return digest([access.profileId, access.projectIdentity, access.accountId]); }
  private config(access: MemoryAccess): Config { return this.store.get<Config>('projectMemoryScope', this.key(access)) ?? { id: this.key(access), revision: 0, enabled: false, sourceThreadIds: [], watermark: 0 }; }
  private requireEnabled(access: MemoryAccess): Config { this.assertAccess(access); const config = this.config(access); if (!this.enabled() || !config.enabled) fail('Project memory requires an explicit project opt-in and reviewed host activation.', 'MEMORY_DISABLED'); if (!this.fenceIdentity || digest(this.store.get('projectMemoryLedger', this.profileId)) !== digest(this.fenceIdentity)) fail('Project memory needs durable deletion-ledger enrollment.', 'MEMORY_DELETION_LEDGER'); return config; }
  private sourceThread(access: MemoryAccess, threadId: string): Thread {
    const thread = this.store.get<Thread>('thread', threadId);
    if (!thread || thread.projectId !== access.projectId || (thread.accountId ?? null) !== access.accountId || thread.sideParentId || thread.kind === 'side' || thread.kind === 'delegate' || this.store.get('archivedThread', threadId) || !this.config(access).sourceThreadIds.includes(threadId)) fail('This source is outside the approved project and account scope.', 'MEMORY_SOURCE_DENIED');
    return thread!;
  }
  private settled(access: MemoryAccess, threadId: string): Thread { const thread = this.sourceThread(access, threadId); if (thread.runId || !['ready', 'completed', 'stopped', 'interrupted'].includes(thread.status)) fail('Memory extraction requires a settled source task.', 'MEMORY_SOURCE_BUSY'); return thread; }
  private owned(access: MemoryAccess, row: StoredMemory): boolean { return row.profileId === access.profileId && row.projectId === access.projectId && row.item.projectIdentity === access.projectIdentity && row.accountId === access.accountId; }
  private rows(access: MemoryAccess): StoredMemory[] {
    const rows = this.store.db.prepare("SELECT body FROM entities INDEXED BY project_memory_items_scope WHERE kind='projectMemoryItem' AND json_extract(body,'$.item.projectIdentity')=? AND json_extract(body,'$.accountId') IS ? AND json_extract(body,'$.profileId')=? LIMIT 501").all(access.projectIdentity, access.accountId, access.profileId) as { body: string }[];
    if (rows.length > LIMITS.items) fail('The project memory record limit was exceeded.');
    return rows.map(row => JSON.parse(row.body) as StoredMemory).filter(row => this.owned(access, row));
  }
  private item(access: MemoryAccess, itemId: string): StoredMemory { const row = this.store.get<StoredMemory>('projectMemoryItem', itemId); if (!row || !this.owned(access, row) || this.isDeleted(access, itemId)) fail('Memory revision is unavailable.', 'NOT_FOUND'); return row!; }
  private excludedSourceIds(entry: Deletion, limit: number): string[] {
    return (this.store.db.prepare("SELECT id FROM entities INDEXED BY project_memory_sources_scope WHERE kind='projectMemorySource' AND json_extract(body,'$.projectIdentity')=? AND json_extract(body,'$.accountId') IS ? AND json_extract(body,'$.ref.digest') IN (SELECT value FROM json_each(?)) ORDER BY id LIMIT ?").all(entry.tombstone.projectIdentity, entry.accountId, JSON.stringify(entry.tombstone.sourceExclusions.map(ref => ref.digest)), limit) as { id: string }[]).map(row => row.id);
  }
  private revisionIds(entry: Deletion, limit: number): string[] {
    return (this.store.db.prepare("SELECT id FROM entities INDEXED BY project_memory_revisions_scope WHERE kind='projectMemoryRevision' AND json_extract(body,'$.item.projectIdentity')=? AND json_extract(body,'$.accountId') IS ? AND json_extract(body,'$.item.id')=? ORDER BY id LIMIT ?").all(entry.tombstone.projectIdentity, entry.accountId, entry.tombstone.itemId, limit) as { id: string }[]).map(row => row.id);
  }
  private retainedCopies(entry: Deletion): boolean {
    return !!this.store.get('projectMemoryItem', entry.tombstone.itemId) || this.revisionIds(entry, 1).length > 0 || this.excludedSourceIds(entry, 1).length > 0 || entry.tombstone.affectedDerivedArtifacts.some(id => !!this.store.get('projectMemoryDerived', id));
  }
  private deletionEntries(access: MemoryAccess): Deletion[] {
    const rows = this.store.db.prepare("SELECT body FROM entities INDEXED BY project_memory_tombstones_scope WHERE kind='projectMemoryTombstone' AND json_extract(body,'$.tombstone.projectIdentity')=? AND json_extract(body,'$.accountId') IS ? AND json_extract(body,'$.profileId')=? LIMIT 501").all(access.projectIdentity, access.accountId, access.profileId) as { body: string }[];
    if (rows.length > 500) fail('The project tombstone limit was exceeded.');
    const entries = new Map(rows.map(row => { const entry = JSON.parse(row.body) as Deletion; return [entry.tombstone.itemId, entry] as const; }));
    for (const [id, entry] of this.deletions) if (entry.profileId === access.profileId && entry.accountId === access.accountId && entry.tombstone.projectIdentity === access.projectIdentity) entries.set(id, entry);
    return [...entries.values()];
  }
  tombstones(access: MemoryAccess): MemoryTombstoneV1[] { this.assertAccess(access); return this.deletionEntries(access).map(entry => ({ ...structuredClone(entry.tombstone), purgeStatus: this.retainedCopies(entry) ? 'PENDING' : entry.tombstone.purgeStatus })); }
  private isDeleted(access: MemoryAccess, id: string): boolean { const entry = this.deletions.get(id) ?? this.store.get<Deletion>('projectMemoryTombstone', id); return !!entry && entry.tombstone.projectIdentity === access.projectIdentity && entry.accountId === access.accountId; }
  private sourceExcluded(access: MemoryAccess, ref: MemorySourceRefV1): boolean { return this.deletionEntries(access).some(entry => entry.tombstone.sourceExclusions.some(source => source.digest === ref.digest)); }
  sourceAvailable(access: MemoryAccess, ref: MemorySourceRefV1): boolean {
    try { this.assertAccess(access); return this.authorizedSource(access, ref, new Set(this.deletionEntries(access).flatMap(entry => entry.tombstone.sourceExclusions.map(source => source.digest)))); }
    catch { return false; }
  }
  private authorizedSource(access: MemoryAccess, ref: MemorySourceRefV1, excluded: ReadonlySet<string>): boolean {
    try { this.sourceThread(access, ref.ownerThreadId); if (excluded.has(ref.digest)) return false;
      const source = this.store.get<MemorySourceSnapshot>('projectMemorySource', digest(ref));
      if (ref.sourceKind === 'FILE') {
        const grant = source?.fileGrant && this.store.get<ResourceGrant>('resource', source.fileGrant.resourceId);
        if (!grant || grant.threadId !== ref.ownerThreadId || !['project', 'file'].includes(grant.kind) || !grant.identity || !physicalMatches({path: grant.path, identity: grant.identity}, grant.kind === 'file' ? 'file' : 'directory') || digest(grant) !== source!.fileGrant!.grantDigest) return false;
      }
      return !!source && digest(source.ref) === digest(ref) && source.projectIdentity === access.projectIdentity && source.accountId === access.accountId && sha256(source.content) === ref.digest;
    } catch { return false; }
  }
  private saveSource(access: MemoryAccess, source: MemorySourceSnapshot): MemorySourceRefV1 {
    this.requireEnabled(access); this.settled(access, source.ref.ownerThreadId);
    if (Buffer.byteLength(source.content) > LIMITS.sourceBytes || memoryContainsSecret(source.content) || this.sourceExcluded(access, source.ref)) fail('The source is secret-bearing, excluded, or exceeds the bounded source cut.');
    const key = digest(source.ref), existing = this.store.get<MemorySourceSnapshot>('projectMemorySource', key);
    if (existing) { if (digest(existing) !== digest(source)) fail('Source digest collision.'); if (!this.sourceAvailable(access, existing.ref)) fail('The retained source is no longer authorized.', 'MEMORY_SOURCE_DENIED'); return structuredClone(existing.ref); }
    // A retry preserves the first immutable capture. Scope and all revision /
    // grant fields participate in the indexed lookup; plaintext equality and
    // current authorization are checked before any retained ref is returned.
    const previous = this.store.db.prepare(`SELECT body FROM entities INDEXED BY project_memory_sources_revision
      WHERE kind='projectMemorySource' AND json_extract(body,'$.projectIdentity')=? AND json_extract(body,'$.accountId') IS ?
      AND json_extract(body,'$.ref.ownerThreadId')=? AND json_extract(body,'$.ref.sourceKind')=? AND json_extract(body,'$.ref.sourceId')=?
      AND json_extract(body,'$.ref.sourceRevision')=? AND json_extract(body,'$.ref.digest')=? AND json_extract(body,'$.ref.observedStatus')=?
      AND json_extract(body,'$.fileGrant.resourceId') IS ? AND json_extract(body,'$.fileGrant.grantDigest') IS ?
      ORDER BY json_extract(body,'$.ref.capturedSeq'),id LIMIT 1`).get(source.projectIdentity, source.accountId, source.ref.ownerThreadId, source.ref.sourceKind, source.ref.sourceId, source.ref.sourceRevision, source.ref.digest, source.ref.observedStatus, source.fileGrant?.resourceId ?? null, source.fileGrant?.grantDigest ?? null) as {body: string} | undefined;
    if (previous) {
      const retained = JSON.parse(previous.body) as MemorySourceSnapshot;
      if (digest({...retained, ref: {...retained.ref, capturedSeq: source.ref.capturedSeq}}) === digest(source) && this.sourceAvailable(access, retained.ref)) return structuredClone(retained.ref);
    }
    const count = (this.store.db.prepare("SELECT count(*) AS n FROM entities WHERE kind='projectMemorySource' AND json_extract(body,'$.projectIdentity')=?").get(access.projectIdentity) as { n: number }).n;
    if (count >= 1000) fail('The retained source limit was reached.');
    this.store.internal('project.memory.source.captured', access.threadId, () => { this.assertAccess(access); this.settled(access, source.ref.ownerThreadId); this.store.put('projectMemorySource', key, source.ref.ownerThreadId, source); return { digest: source.ref.digest, sourceRevision: source.ref.sourceRevision }; });
    return structuredClone(source.ref);
  }
  captureMessage(access: MemoryAccess, messageId: string): MemorySourceRefV1 {
    this.requireEnabled(access); const message = this.store.get<Message>('message', messageId);
    if (!message || message.role === 'activity') fail('This exact source message is unavailable.', 'NOT_FOUND');
    this.settled(access, message!.threadId);
    const ref = memorySourceRefV1Schema.parse({ ownerThreadId: message!.threadId, sourceKind: 'MESSAGE', sourceId: message!.id, sourceRevision: digest({ role: message!.role, createdAt: message!.createdAt, content: message!.content }), capturedSeq: this.store.sequence, digest: sha256(message!.content), observedStatus: message!.role === 'assistant' ? 'PROPOSED' : 'REPORTED' });
    return this.saveSource(access, { ref, projectIdentity: access.projectIdentity, accountId: access.accountId, content: message!.content, label: `${message!.role} message ${message!.id}` });
  }
  async captureFile(access: MemoryAccess, resourceId: string, relativePath?: string): Promise<MemorySourceRefV1> {
    this.requireEnabled(access); this.settled(access, access.threadId);
    const resource = this.store.get<ResourceGrant>('resource', resourceId);
    if (!resource || resource.threadId !== access.threadId || !['project', 'file'].includes(resource.kind) || !resource.identity || !physicalMatches({path: resource.path, identity: resource.identity}, resource.kind === 'file' ? 'file' : 'directory')) fail('The source file needs a current physically bound owning resource grant.', 'MEMORY_SOURCE_DENIED');
    const bytes = await withResourceGrant(resource!, this.store.dataDir, relativePath, false, new AbortController().signal, path => readBoundFile(path, LIMITS.sourceBytes));
    this.assertAccess(access); this.settled(access, access.threadId);
    if (digest(resource) !== digest(this.store.get('resource', resourceId))) fail('The file grant changed.', 'CAPABILITY_DENIED');
    let content: string; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('Only UTF-8 source files can be retained.'); }
    const ref = memorySourceRefV1Schema.parse({ ownerThreadId: access.threadId, sourceKind: 'FILE', sourceId: `${resourceId}:${relativePath ?? ''}`, sourceRevision: sha256(content!), capturedSeq: this.store.sequence, digest: sha256(content!), observedStatus: 'OBSERVED' });
    return this.saveSource(access, { ref, projectIdentity: access.projectIdentity, accountId: access.accountId, content: content!, label: relativePath ?? resource!.label, fileGrant: { resourceId, grantDigest: digest(resource) } });
  }
  propose(access: MemoryAccess, input: { kind: MemoryItemV1['kind']; text: string; sourceRefs: MemorySourceRefV1[]; expiresAt?: string | null; sensitivity?: MemoryItemV1['sensitivity'] }, assertedBy: MemoryItemV1['assertedBy']): MemoryItemV1 {
    this.requireEnabled(access); this.settled(access, access.threadId);
    if (input.kind === 'PREFERENCE') fail('Reusable preferences require a separately confirmed source cut.');
    if (!Array.isArray(input.sourceRefs) || input.sourceRefs.length < 1 || input.sourceRefs.length > 8) fail('Every proposal needs one to eight exact source references.', 'MEMORY_SOURCE_DENIED');
    if (input.sourceRefs.some(ref => !this.sourceAvailable(access, memorySourceRefV1Schema.parse(ref)))) fail('Every proposal must cite an exact authorized retained source.', 'MEMORY_SOURCE_DENIED');
    if (this.rows(access).length + this.tombstones(access).length >= LIMITS.items) fail('Project memory is full.');
    const item = memoryItemV1Schema.parse({ id: randomUUID(), projectIdentity: access.projectIdentity, scope: 'PROJECT', kind: input.kind, text: checkedText(input.text), revision: 1, state: 'PROPOSED', sourceRefs: input.sourceRefs, assertedBy, observedAt: stamp(), expiresAt: input.expiresAt ?? null, supersedes: [], sensitivity: input.sensitivity ?? 'NORMAL', reviewDecision: null });
    this.store.internal('project.memory.proposed', access.threadId, () => { this.requireEnabled(access); this.save(access, item); return { itemId: item.id, revision: item.revision, state: item.state }; });
    return structuredClone(item);
  }
  private save(access: MemoryAccess, item: MemoryItemV1): void {
    memoryItemV1Schema.parse(item); const key = `${item.id}@${item.revision}`;
    if (this.store.get('projectMemoryRevision', key)) fail('Memory revisions are immutable.', 'STALE_MEMORY');
    const row: StoredMemory = { item, profileId: access.profileId, projectId: access.projectId, accountId: access.accountId, lastUsedAt: null };
    this.store.put('projectMemoryRevision', key, null, row); this.store.put('projectMemoryItem', item.id, null, row);
    const config = this.config(access); this.store.put('projectMemoryScope', config.id, null, { ...config, watermark: config.watermark + 1 });
    this.invalidate(item.id, access.projectIdentity, access.accountId);
  }
  private invalidate(itemId: string, identity: string, accountId: string | null): void {
    for (const index of this.derived(identity, accountId)) if (index.refs?.some(ref => ref.itemId === itemId)) this.store.put('projectMemoryDerived', index.id, null, { ...index, valid: false });
  }
  private derived(identity: string, accountId: string | null): Derived[] {
    const rows = this.store.db.prepare("SELECT body FROM entities WHERE kind='projectMemoryDerived' AND json_extract(body,'$.projectIdentity')=? AND json_extract(body,'$.accountId') IS ? LIMIT 501").all(identity, accountId) as { body: string }[];
    if (rows.length > 500) fail('The project derived-artifact limit was exceeded.');
    return rows.map(row => JSON.parse(row.body) as Derived);
  }
  private itemSourceRefs(access: MemoryAccess, itemId: string): MemorySourceRefV1[] {
    const rows = this.store.db.prepare("SELECT DISTINCT json(source.value) AS body FROM entities AS entity, json_each(entity.body,'$.item.sourceRefs') AS source WHERE entity.kind='projectMemoryRevision' AND json_extract(entity.body,'$.item.projectIdentity')=? AND json_extract(entity.body,'$.accountId') IS ? AND json_extract(entity.body,'$.item.id')=? LIMIT 257").all(access.projectIdentity, access.accountId, itemId) as { body: string }[];
    if (rows.length > 256) fail('The source provenance limit was exceeded.');
    return rows.map(row => memorySourceRefV1Schema.parse(JSON.parse(row.body)));
  }
  private affectedArtifacts(identity: string, accountId: string | null, itemId: string, refs: MemorySourceRefV1[]): string[] {
    const rows = this.store.db.prepare("SELECT DISTINCT json_extract(entity.body,'$.item.id') AS id FROM entities AS entity INDEXED BY project_memory_revisions_scope, json_each(entity.body,'$.item.sourceRefs') AS source WHERE entity.kind='projectMemoryRevision' AND json_extract(entity.body,'$.item.projectIdentity')=? AND json_extract(entity.body,'$.accountId') IS ? AND json_extract(source.value,'$.digest') IN (SELECT value FROM json_each(?)) LIMIT 501").all(identity, accountId, JSON.stringify(refs.map(ref => ref.digest))) as { id: string }[];
    if (rows.length > 500) fail('The related memory limit was exceeded.');
    const affected = new Set([itemId, ...rows.map(row => row.id)]);
    return this.derived(identity, accountId).filter(index => index.refs?.some(ref => affected.has(ref.itemId))).map(index => index.id);
  }
  private reconcileArtifacts(entry: Deletion): Deletion {
    const affectedDerivedArtifacts = [...new Set([...entry.tombstone.affectedDerivedArtifacts, ...this.affectedArtifacts(entry.tombstone.projectIdentity, entry.accountId, entry.tombstone.itemId, entry.tombstone.sourceExclusions)])];
    if (affectedDerivedArtifacts.length === entry.tombstone.affectedDerivedArtifacts.length) return entry;
    const updated = { ...entry, tombstone: memoryTombstoneV1Schema.parse({ ...entry.tombstone, affectedDerivedArtifacts }) };
    if (this.fenceIdentity) this.appendDeletion(updated);
    else this.deletions.set(updated.tombstone.itemId, updated);
    return updated;
  }
  private invalidateDeletion(entry: Deletion): void {
    for (const index of this.derived(entry.tombstone.projectIdentity, entry.accountId)) if (entry.tombstone.affectedDerivedArtifacts.includes(index.id) || index.refs?.some(ref => ref.itemId === entry.tombstone.itemId)) this.store.put('projectMemoryDerived', index.id, null, { ...index, valid: false });
  }
  accepted(access: MemoryAccess): StoredMemory[] {
    this.assertAccess(access); if (!this.enabled() || !this.config(access).enabled) return [];
    if (!this.fenceIdentity || digest(this.store.get('projectMemoryLedger', this.profileId)) !== digest(this.fenceIdentity)) fail('Project memory needs an enrolled deletion ledger.', 'MEMORY_DELETION_LEDGER');
    const entries = this.deletionEntries(access), deleted = new Set(entries.map(entry => entry.tombstone.itemId)), excluded = new Set(entries.flatMap(entry => entry.tombstone.sourceExclusions.map(ref => ref.digest)));
    return this.rows(access).filter(row => row.item.state === 'ACCEPTED' && !deleted.has(row.item.id) && (!row.item.expiresAt || Date.parse(row.item.expiresAt) > Date.now()) && row.item.sourceRefs.every(ref => this.authorizedSource(access, ref, excluded)));
  }
  watermark(access: MemoryAccess): number { this.assertAccess(access); return this.config(access).watermark; }
  isEnabled(access: MemoryAccess): boolean { this.assertAccess(access); return this.enabled() && this.config(access).enabled; }
  consolidationSnapshot(access: MemoryAccess): MemoryConsolidationSnapshot {
    return { access: structuredClone(access), items: this.accepted(access).map(row => row.item), watermark: this.watermark(access), tombstones: this.tombstones(access) };
  }
  /** Only the accepted settled event and its canonical outbox/messages define a cut. */
  extractionCut(access: MemoryAccess, source: RunContext): MemoryExtractionCut {
    this.requireEnabled(access); const thread = this.settled(access, access.threadId);
    if (source.threadId !== access.threadId || source.epoch !== thread.epoch || !source.runId) fail('The settled source owner changed.', 'MEMORY_SOURCE_BUSY');
    const inputs = this.store.all<{status: string; runId: string | null; messageId?: string; enteredRuntime?: boolean; sourceRefs?: SourceRefV1[]}>('outbox', access.threadId);
    if (inputs.some(input => input.status !== 'handled')) fail('A new input is waiting for this source task.', 'MEMORY_SOURCE_BUSY');
    const inputIds = new Set(inputs.filter(input => input.runId === source.runId).map(input => input.messageId).filter(Boolean));
    const messages = this.store.all<Message>('message', access.threadId).filter(message => message.role !== 'activity' && (message.runId === source.runId || inputIds.has(message.id))).slice(-LIMITS.sources);
    const cut: MemoryExtractionCut = { access: structuredClone(access), settled: true, sourceRunId: source.runId, watermark: this.store.sequence, authorizedThreadIds: [access.threadId], sources: [], tombstones: this.tombstones(access) };
    for (const message of messages) {
      if (!message.content.trim() || memoryContainsSecret(message.content) || Buffer.byteLength(message.content) > LIMITS.sourceBytes / 2) continue;
      const estimated = { ref: {ownerThreadId: message.threadId, sourceKind: 'MESSAGE', sourceId: message.id, sourceRevision: '0'.repeat(64), capturedSeq: Number.MAX_SAFE_INTEGER, digest: '0'.repeat(64), observedStatus: 'PROPOSED'}, projectIdentity: access.projectIdentity, accountId: access.accountId, content: message.content, label: `${message.role} message ${message.id}` };
      if (Buffer.byteLength(JSON.stringify({...cut, sources: [...cut.sources, estimated]})) > LIMITS.sourceBytes) continue;
      const ref = this.captureMessage(access, message.id);
      const retained = this.store.get<MemorySourceSnapshot>('projectMemorySource', digest(ref))!;
      // Private source/grant metadata is never sent to a provider or public cut.
      cut.sources.push({ref: retained.ref, projectIdentity: retained.projectIdentity, accountId: retained.accountId, content: retained.content, label: retained.label});
      cut.watermark = this.store.sequence;
    }
    // Only a canonical handled input can supply selected file evidence. An
    // existing grant or unsent capture alone is not consent to extract a file.
    const seen = new Set<string>(), owner = {threadId: access.threadId, projectId: access.projectId, workspaceId: thread.workspaceId ?? null};
    let inspected = 0;
    if (this.options.readFileSource) for (const input of inputs) {
      if (input.runId !== source.runId || input.enteredRuntime !== true) continue;
      const refs = sourceRefsV1Schema.safeParse(input.sourceRefs ?? []); if (!refs.success) continue;
      for (const selected of refs.data) {
        if (selected.source.kind !== 'FILE_RANGE' || seen.has(selected.captureId)) continue;
        if (inspected >= LIMITS.sources || cut.sources.length >= LIMITS.sources) break;
        inspected++; seen.add(selected.captureId);
        let captured: RetainedFileSource;
        try {captured = this.options.readFileSource(owner, selected);}
        catch (error) {if (error instanceof HarnessError && ['CAPABILITY_DENIED', 'SOURCE_UNAVAILABLE', 'STALE_SOURCE'].includes(error.code)) continue; throw error;}
        const resource = this.store.get<ResourceGrant>('resource', captured.source.sourceId);
        if (!resource || resource.threadId !== access.threadId || !['project', 'file'].includes(resource.kind) || !resource.identity || !physicalMatches({path: resource.path, identity: resource.identity}, resource.kind === 'file' ? 'file' : 'directory')) continue;
        const content = captured.text;
        if (!content.trim() || memoryContainsSecret(content) || Buffer.byteLength(content) > LIMITS.sourceBytes) continue;
        const ref = memorySourceRefV1Schema.parse({ownerThreadId: access.threadId, sourceKind: 'FILE', sourceId: 'source-capture:' + captured.captureId,
          sourceRevision: captured.source.sourceRevision, capturedSeq: this.store.sequence, digest: sha256(content), observedStatus: 'OBSERVED'});
        if (this.sourceExcluded(access, ref)) continue;
        const snapshot = {ref, projectIdentity: access.projectIdentity, accountId: access.accountId, content,
          label: `${captured.label} (lines ${captured.source.range.startLine}-${captured.source.range.endLine})`};
        if (Buffer.byteLength(JSON.stringify({...cut, sources: [...cut.sources, {...snapshot, ref: {...ref, capturedSeq: Number.MAX_SAFE_INTEGER}}]})) > LIMITS.sourceBytes) continue;
        captured.assertCurrent();
        const retained = this.saveSource(access, {...snapshot, fileGrant: {resourceId: resource.id, grantDigest: digest(resource)}});
        cut.sources.push({...snapshot, ref: retained}); cut.watermark = this.store.sequence;
      }
      if (inspected >= LIMITS.sources || cut.sources.length >= LIMITS.sources) break;
    }
    if (!cut.sources.length || Buffer.byteLength(JSON.stringify(cut)) > LIMITS.sourceBytes) fail('No bounded authorized source cut is available.', 'MEMORY_SOURCE_UNAVAILABLE');
    return structuredClone(cut);
  }
  assertExtractionCut(cut: MemoryExtractionCut): void {
    this.requireEnabled(cut.access); this.settled(cut.access, cut.access.threadId);
    if (!cut.settled || cut.authorizedThreadIds.length !== 1 || cut.authorizedThreadIds[0] !== cut.access.threadId || cut.sources.some(source => source.ref.ownerThreadId !== cut.access.threadId)) fail('The source cut owner changed.', 'MEMORY_SOURCE_DENIED');
    if (this.store.all<{status: string}>('outbox', cut.access.threadId).some(input => input.status !== 'handled')) fail('The source task has new work.', 'MEMORY_SOURCE_BUSY');
    for (const source of cut.sources) {
      if (!this.sourceAvailable(cut.access, source.ref)) fail('An extraction source is no longer authorized.', 'MEMORY_SOURCE_DENIED');
      if (source.ref.sourceKind === 'MESSAGE') {
        const message = this.store.get<Message>('message', source.ref.sourceId);
        if (!message || message.threadId !== source.ref.ownerThreadId || digest({role: message.role, createdAt: message.createdAt, content: message.content}) !== source.ref.sourceRevision) fail('The extraction source revision changed.', 'MEMORY_SOURCE_CHANGED');
      }
    }
  }
  publishExtraction(cut: MemoryExtractionCut, candidates: unknown, modelId: string): MemoryExtractionResult {
    this.assertExtractionCut(cut);
    const key = digest({projectIdentity: cut.access.projectIdentity, accountId: cut.access.accountId, sourceRunId: cut.sourceRunId});
    const result = validateMemoryExtraction({...cut, tombstones: this.tombstones(cut.access)}, candidates, {assertedBy: 'model:' + sha256(modelId).slice(0, 32), observedAt: stamp()});
    if (this.store.get('projectMemoryExtraction', key)) return {...result, items: [], unresolvedWork: []};
    if (result.items.some(item => item.kind === 'PREFERENCE')) fail('Reusable preferences require an authenticated user confirmation.', 'MEMORY_PREFERENCE_CONFIRMATION_REQUIRED');
    if (this.rows(cut.access).length + this.tombstones(cut.access).length + result.items.length > LIMITS.items) fail('Project memory is full.');
    this.store.internal('project.memory.extracted', cut.access.threadId, () => {
      this.assertExtractionCut(cut);
      for (const item of result.items) this.save(cut.access, item);
      // No source prose, unresolved prose, or provider response is copied here.
      this.store.put('projectMemoryExtraction', key, cut.access.threadId, {id: key, projectIdentity: cut.access.projectIdentity, accountId: cut.access.accountId, sourceRunId: cut.sourceRunId, watermark: cut.watermark, sourceDigest: digest(cut.sources.map(source => source.ref)), itemIds: result.items.map(item => item.id), unresolvedCount: result.unresolvedWork.length});
      return {itemIds: result.items.map(item => item.id), unresolvedCount: result.unresolvedWork.length};
    });
    return result;
  }
  extractionComplete(access: MemoryAccess, sourceRunId: string): boolean {
    this.assertAccess(access); return Boolean(this.store.get('projectMemoryExtraction', digest({projectIdentity: access.projectIdentity, accountId: access.accountId, sourceRunId})));
  }
  markUsed(access: MemoryAccess, raw: MemoryRecallV1): void {
    const recall = memoryRecallV1Schema.parse(raw); this.assertAccess(access);
    if (recall.projectIdentity !== access.projectIdentity) fail('Recall usage belongs to another project.', 'MEMORY_SCOPE_CHANGED');
    const selected = new Map(recall.selectedRevisions.map(ref => [ref.itemId, ref.revision]));
    const items = this.accepted(access).filter(row => selected.get(row.item.id) === row.item.revision);
    if (!items.length) return;
    this.store.internal('project.memory.used', access.threadId, () => {
      this.assertAccess(access);
      for (const row of items) this.store.put('projectMemoryUsage', row.item.id, null, {at: stamp(), revision: row.item.revision, requestId: recall.requestId, contextGeneration: recall.contextGeneration});
      return {requestId: recall.requestId, selectedRevisions: items.map(row => ({itemId: row.item.id, revision: row.item.revision}))};
    });
  }
  recordRequestUsage(access: MemoryAccess, requestId: string, contextGeneration: number, injectedBytes: number, latencyMs: number): void {
    this.assertAccess(access);
    if (!/^[a-zA-Z0-9:_.-]{1,200}$/.test(requestId) || !Number.isSafeInteger(contextGeneration) || contextGeneration < 0 || !Number.isSafeInteger(injectedBytes) || injectedBytes < 0 || injectedBytes > LIMITS.recallBytes || !Number.isFinite(latencyMs) || latencyMs < 0) fail('The dispatched recall measurement is invalid.');
    if (this.store.get('projectMemoryRequestUsage', requestId)) return;
    this.store.internal('project.memory.request.used', access.threadId, () => {
      this.assertAccess(access);
      this.store.put('projectMemoryRequestUsage', requestId, access.threadId, {requestId, contextGeneration, profileId: access.profileId, projectIdentity: access.projectIdentity, projectId: access.projectId, accountId: access.accountId, injectedBytes, latencyMs, at: stamp()});
      return {requestId, contextGeneration, injectedBytes, latencyMs};
    });
  }
  usage(access: MemoryAccess): MemoryUsageReport {
    this.assertAccess(access);
    type Spend = MemoryUsageReport['extraction'];
    const zero = (): Spend => ({modelCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0, pending: 0});
    const rows = this.store.db.prepare(`SELECT json_extract(body,'$.phase') AS phase,
      COALESCE(SUM(json_extract(body,'$.usage.modelCalls')),0) AS modelCalls,
      CASE WHEN SUM(CASE WHEN json_extract(body,'$.usage.modelCalls')>0 AND json_extract(body,'$.usage.inputTokens') IS NULL THEN 1 ELSE 0 END)>0 THEN NULL ELSE COALESCE(SUM(json_extract(body,'$.usage.inputTokens')),0) END AS inputTokens,
      CASE WHEN SUM(CASE WHEN json_extract(body,'$.usage.modelCalls')>0 AND json_extract(body,'$.usage.outputTokens') IS NULL THEN 1 ELSE 0 END)>0 THEN NULL ELSE COALESCE(SUM(json_extract(body,'$.usage.outputTokens')),0) END AS outputTokens,
      CASE WHEN SUM(CASE WHEN json_extract(body,'$.usage.modelCalls')>0 AND json_extract(body,'$.usage.cost') IS NULL THEN 1 ELSE 0 END)>0 THEN NULL ELSE COALESCE(SUM(json_extract(body,'$.usage.cost')),0) END AS cost,
      COUNT(DISTINCT CASE WHEN json_extract(body,'$.settled')<>1 AND COALESCE(json_extract(body,'$.interrupted'),0)<>1 THEN COALESCE(json_extract(body,'$.sourceRunId'),id) ELSE NULL END) AS pending
      FROM entities WHERE kind='projectMemoryAuxiliaryUsage' AND json_extract(body,'$.projectIdentity')=? AND json_extract(body,'$.accountId') IS ? AND json_extract(body,'$.profileId')=? GROUP BY json_extract(body,'$.phase')`).all(access.projectIdentity, access.accountId, access.profileId) as (Spend & {phase: string})[];
    const spend = (phase: string): Spend => {const row = rows.find(row => row.phase === phase); if (!row) return zero(); const {phase: _, ...value} = row; return value;};
    const retrieval = this.store.db.prepare("SELECT COUNT(*) AS requests, COALESCE(SUM(json_extract(body,'$.injectedBytes')),0) AS injectedBytes, COALESCE(SUM(json_extract(body,'$.latencyMs')),0) AS latencyMs FROM entities WHERE kind='projectMemoryRequestUsage' AND json_extract(body,'$.projectIdentity')=? AND json_extract(body,'$.accountId') IS ? AND json_extract(body,'$.profileId')=?").get(access.projectIdentity, access.accountId, access.profileId);
    return memoryUsageReportSchema.parse({scope: memoryScope(access), extraction: spend('EXTRACTION'), consolidation: spend('CONSOLIDATION'), retrieval});
  }
  assertCheckpointCurrent(access: MemoryAccess, checkpoint: MemoryCheckpointV1): void {
    this.requireEnabled(access);
    const {digest: packetDigest, ...body} = checkpoint;
    const items = this.accepted(access).map(row => row.item).filter(item => item.kind === 'CONSTRAINT' || item.kind === 'DECISION').sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const expected = items.map(({id, revision, kind, text, sourceRefs}) => ({itemId: id, revision, kind, text, sourceRefs}));
    if (checkpoint.version !== 1 || !/^memory-checkpoint:[a-zA-Z0-9-]+$/.test(checkpoint.id) || checkpoint.profileId !== access.profileId || checkpoint.projectId !== access.projectId || checkpoint.projectIdentity !== access.projectIdentity || checkpoint.accountId !== access.accountId || checkpoint.threadId !== access.threadId || checkpoint.bindingDigest !== access.bindingDigest || checkpoint.watermark !== this.watermark(access) || digest(body) !== packetDigest || digest(checkpoint.constraints) !== digest(expected) || digest(checkpoint.refs) !== digest(expected.map(({itemId, revision}) => ({itemId, revision}))) || Buffer.byteLength(JSON.stringify(checkpoint)) > LIMITS.sourceBytes) fail('The checkpoint no longer matches accepted memory.', 'MEMORY_CHECKPOINT_STALE');
  }
  persistCheckpoint(access: MemoryAccess, checkpoint: MemoryCheckpointV1): {id: string; persisted: true; digest: string} {
    this.assertCheckpointCurrent(access, checkpoint);
    this.store.internal('project.memory.checkpoint.saved', access.threadId, () => {
      this.assertAccess(access);
      const existing = this.store.get<{checkpoint?: MemoryCheckpointV1}>('projectMemoryDerived', checkpoint.id);
      if (existing && digest(existing.checkpoint) !== digest(checkpoint)) fail('Checkpoint IDs are immutable.', 'MEMORY_CHECKPOINT_FAILED');
      this.store.put('projectMemoryDerived', checkpoint.id, null, {id: checkpoint.id, profileId: access.profileId, projectId: access.projectId, projectIdentity: access.projectIdentity, accountId: access.accountId, refs: checkpoint.refs, valid: true, checkpoint});
      const old = this.derived(access.projectIdentity, access.accountId).filter(row => row.id.startsWith('memory-checkpoint:') && row.id !== checkpoint.id);
      for (const row of old.slice(0, Math.max(0, old.length - 15))) this.store.remove('projectMemoryDerived', row.id);
      return {id: checkpoint.id, digest: checkpoint.digest};
    });
    return {id: checkpoint.id, persisted: true, digest: checkpoint.digest};
  }
  read(access: MemoryAccess): ProjectMemoryView {
    this.assertAccess(access); const config = this.config(access);
    const items = this.rows(access).filter(row => !this.isDeleted(access, row.item.id)).map(row => {
      const revisions = this.store.get<{ revisions: number[] }>('projectMemoryConflict', row.item.id)?.revisions ?? [];
      return { item: row.item, lastUsedAt: this.store.get<{ at: string }>('projectMemoryUsage', row.item.id)?.at ?? row.lastUsedAt, conflictRevisions: revisions.map(revision => this.store.get<StoredMemory>('projectMemoryRevision', `${row.item.id}@${revision}`)?.item).filter((item): item is MemoryItemV1 => !!item) };
    });
    return { scope: memoryScope(access), projectName: this.store.get<ProjectSummary>('workspaceProject', access.projectId)!.name, available: this.enabled(), disabledReason: this.enabled() ? null : 'Project memory is disabled by this host. Existing records remain reviewable.', enabled: config.enabled, configRevision: config.revision, sourceThreadIds: config.sourceThreadIds,
      eligibleThreads: this.store.all<Thread>('thread').filter(thread => thread.projectId === access.projectId && (thread.accountId ?? null) === access.accountId && !thread.sideParentId && !['side', 'delegate'].includes(thread.kind ?? '') && !this.store.get('archivedThread', thread.id)).slice(0, 200).map(thread => ({ id: thread.id, title: thread.title.slice(0, 1000) })), items, tombstones: this.tombstones(access) };
  }
  source(access: MemoryAccess, itemId: string, revision: number, sourceDigest: string, selector?: MemorySourceRefV1): MemorySourceDetail {
    this.assertAccess(access); this.item(access, itemId);
    const row = this.store.get<StoredMemory>('projectMemoryRevision', `${itemId}@${revision}`), refs = row?.item.sourceRefs.filter(ref => ref.digest === sourceDigest && (!selector || digest(ref) === digest(selector))) ?? [], ref = refs.length === 1 ? refs[0] : undefined;
    if (!row || !this.owned(access, row) || !ref || !this.sourceAvailable(access, ref)) fail('The exact supporting source revision is unavailable.', 'NOT_FOUND');
    const source = this.store.get<MemorySourceSnapshot>('projectMemorySource', digest(ref!))!;
    return { scope: memoryScope(access), ref: source.ref, content: source.content, label: source.label };
  }
  forgetPreview(access: MemoryAccess, itemId: string, revision: number): MemoryForgetPreview {
    this.assertAccess(access); const row = this.item(access, itemId); if (row.item.revision !== revision) fail('Memory changed. Review its current revision.', 'STALE_MEMORY');
    return { scope: memoryScope(access), itemId, revision, affectedDerivedArtifacts: this.affectedArtifacts(access.projectIdentity, access.accountId, itemId, this.itemSourceRefs(access, itemId)), immediateExclusion: true, localPurgeAfter: new Date(Date.now() + LIMITS.purgeRetentionMs).toISOString(), externalDeletion: 'NOT_SUPPORTED' };
  }
  review(access: MemoryAccess, command: HostCommand, userId: string): MemoryMutationResult {
    this.assertAccess(access); if (command.type !== 'project.memory.review' || command.threadId !== access.threadId || !/^[a-zA-Z0-9:_.-]{1,200}$/.test(userId)) fail('Only authenticated user review can change memory.', 'AUTH_REQUIRED');
    const operation = memoryActionSchema.parse(command.payload.operation), existing = this.store.receipt(command); if (existing) return existing as MemoryMutationResult;
    if (operation.action === 'forget' || (operation.action === 'configure' && operation.enabled && this.enabled())) this.ensureDeletionFence();
    let forgotten: Deletion | undefined;
    if (operation.action === 'forget') {
      const preview = this.forgetPreview(access, operation.itemId, operation.baseRevision), sourceExclusions = this.itemSourceRefs(access, operation.itemId);
      forgotten = { profileId: access.profileId, projectId: access.projectId, accountId: access.accountId, tombstone: memoryTombstoneV1Schema.parse({ itemId: operation.itemId, deletionRevision: operation.baseRevision + 1, projectIdentity: access.projectIdentity, deletedAt: stamp(), sourceExclusions, affectedDerivedArtifacts: preview.affectedDerivedArtifacts, purgeStatus: 'PENDING' }) };
      // Durable exclusion precedes the SQLite transaction, so a crash can fail closed.
      this.appendDeletion(forgotten);
    }
    return this.store.command(command, () => {
      this.assertAccess(access);
      if (operation.action === 'configure') {
        const config = this.config(access); if (config.revision !== operation.baseRevision) fail('Project memory scope changed.', 'STALE_MEMORY');
        if (operation.enabled && !this.enabled()) fail('Host activation is required before opting in.', 'MEMORY_DISABLED');
        const eligible = new Set(this.read(access).eligibleThreads.map(thread => thread.id));
        if (operation.enabled && (!operation.sourceThreadIds.length || operation.sourceThreadIds.some(id => !eligible.has(id)) || new Set(operation.sourceThreadIds).size !== operation.sourceThreadIds.length)) fail('Choose explicit source conversations in this project and account.');
        this.store.put('projectMemoryScope', config.id, null, { ...config, enabled: operation.enabled, sourceThreadIds: operation.sourceThreadIds, revision: config.revision + 1, watermark: config.watermark + 1 });
        return { revision: config.revision + 1, state: operation.enabled ? 'ENABLED' : 'DISABLED' };
      }
      if (forgotten) {
        const row = this.store.get<StoredMemory>('projectMemoryItem', operation.itemId)!;
        if (!row || !this.owned(access, row) || row.item.revision !== operation.baseRevision) fail('Memory changed during Forget.', 'STALE_MEMORY');
        this.store.put('projectMemoryTombstone', operation.itemId, null, forgotten);
        this.invalidateDeletion(forgotten);
        this.save(access, { ...row.item, revision: forgotten.tombstone.deletionRevision, state: 'DELETED', text: '', reviewDecision: { action: 'FORGET', userId, at: stamp() }, supersedes: [{ itemId: row.item.id, revision: row.item.revision }] });
        this.store.remove('projectMemoryConflict', operation.itemId);
        return { itemId: operation.itemId, revision: forgotten.tombstone.deletionRevision, state: 'DELETED' };
      }
      return this.applyReview(access, operation, userId);
    }) as MemoryMutationResult;
  }
  private applyReview(access: MemoryAccess, action: Exclude<MemoryAction, { action: 'configure' }>, userId: string) {
    const row = this.item(access, action.itemId), old = row.item;
    if (old.revision !== action.baseRevision && action.action !== 'edit' && action.action !== 'confirm-preference') fail('Memory changed. Review its current revision.', 'STALE_MEMORY');
    if (action.action === 'forget') fail('Forget requires a durable deletion fence.');
    if (['accept', 'edit', 'confirm-preference', 'resolve'].includes(action.action) && old.sourceRefs.some(ref => !this.sourceAvailable(access, ref))) fail('The supporting source is unavailable.', 'MEMORY_SOURCE_DENIED');
    let state: MemoryItemV1['state'], text = old.text, decision: NonNullable<MemoryItemV1['reviewDecision']>['action'], expiresAt = old.expiresAt;
    if (action.action === 'accept') { if (old.state !== 'PROPOSED') fail('Only a proposal can be accepted.'); state = 'ACCEPTED'; decision = 'ACCEPT'; }
    else if (action.action === 'reject') { if (old.state !== 'PROPOSED') fail('Only a proposal can be rejected.'); state = 'EXPIRED'; decision = 'REJECT'; expiresAt = stamp(); }
    else if (action.action === 'expire') { if (old.state !== 'ACCEPTED') fail('Only accepted memory can be expired.'); state = 'EXPIRED'; decision = 'EXPIRE'; expiresAt = stamp(); }
    else if (action.action === 'edit' || action.action === 'confirm-preference') {
      text = checkedText(action.text); decision = 'EDIT_ACCEPT'; expiresAt = action.expiresAt === undefined ? old.expiresAt : action.expiresAt;
      if (!this.store.get('projectMemoryRevision', `${old.id}@${action.baseRevision}`)) fail('The corrected revision is unavailable.', 'STALE_MEMORY');
      state = old.revision !== action.baseRevision || old.state === 'CONFLICT' ? 'CONFLICT' : 'ACCEPTED';
      if (state === 'CONFLICT') {
        const revisions = this.store.get<{ revisions: number[] }>('projectMemoryConflict', old.id)?.revisions ?? [old.revision];
        if (revisions.length >= 32) fail('Resolve the existing conflict before adding another edit.');
        this.store.put('projectMemoryConflict', old.id, null, { revisions: [...revisions, old.revision + 1] });
      }
    } else {
      if (old.state !== 'CONFLICT') fail('This memory has no unresolved conflict.');
      const available = this.store.get<{ revisions: number[] }>('projectMemoryConflict', old.id)?.revisions ?? [];
      if (new Set(action.survivingRevisions).size !== action.survivingRevisions.length || action.survivingRevisions.some(revision => !available.includes(revision))) fail('Choose explicit conflicting revisions.');
      if (memoryContainsSecret(action.note)) fail('Omit secrets from review notes.');
      const survivors = action.survivingRevisions.map(revision => this.store.get<StoredMemory>('projectMemoryRevision', `${old.id}@${revision}`)!.item);
      const decision = { action: 'RESOLVE' as const, userId, at: stamp(), note: action.note }, additionalItemIds: string[] = [];
      this.save(access, { ...survivors[0], id: old.id, revision: old.revision + 1, state: 'ACCEPTED', supersedes: available.map(revision => ({ itemId: old.id, revision })), reviewDecision: decision });
      if (survivors[1]) { if (this.rows(access).length + this.tombstones(access).length >= LIMITS.items) fail('Project memory is full.'); const id = randomUUID(); this.save(access, { ...survivors[1], id, revision: 1, state: 'ACCEPTED', supersedes: [{ itemId: old.id, revision: survivors[1].revision }], reviewDecision: decision }); additionalItemIds.push(id); }
      this.store.remove('projectMemoryConflict', old.id);
      return { itemId: old.id, revision: old.revision + 1, state: 'ACCEPTED', additionalItemIds };
    }
    this.save(access, { ...old, text, ...(['edit', 'confirm-preference'].includes(action.action) ? { assertedBy: { kind: 'USER' as const, id: userId } } : {}), ...(action.action === 'confirm-preference' ? {kind: 'PREFERENCE' as const, scope: 'PROJECT' as const} : {}), revision: old.revision + 1, state, expiresAt, supersedes: [{ itemId: old.id, revision: action.baseRevision }], reviewDecision: { action: decision, userId, at: stamp(), ...(action.action === 'confirm-preference' ? {note: 'Confirmed reusable preference for this project only.'} : {}) } });
    return { itemId: old.id, revision: old.revision + 1, state };
  }
  /** Bounded host maintenance. Tombstones survive; native history is outside this purge. */
  purge(now = Date.now(), limit = 20): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('Choose a purge batch of at most 50.');
    const entries: Deletion[] = [];
    for (const recorded of this.deletions.values()) {
      if (recorded.profileId !== this.profileId || Date.parse(recorded.tombstone.deletedAt) + LIMITS.purgeRetentionMs > now) continue;
      const entry = this.reconcileArtifacts(recorded);
      if (entry.tombstone.purgeStatus === 'PENDING' || this.retainedCopies(entry)) entries.push(entry);
      if (entries.length === limit) break;
    }
    let completed = 0, remainingRows = 256;
    for (const entry of entries) {
      if (remainingRows <= 3) break;
      const secure = (this.store.db.prepare('PRAGMA secure_delete').get() as { secure_delete: number }).secure_delete;
      this.store.db.exec('PRAGMA secure_delete=ON');
      try {
      this.store.internal('project.memory.purged', null, () => {
        this.store.put('projectMemoryTombstone', entry.tombstone.itemId, null, entry); this.invalidateDeletion(entry);
        const revisions = this.revisionIds(entry, remainingRows - 3);
        for (const id of revisions) this.store.remove('projectMemoryRevision', id);
        remainingRows -= revisions.length + 3;
        this.store.remove('projectMemoryItem', entry.tombstone.itemId); this.store.remove('projectMemoryConflict', entry.tombstone.itemId); this.store.remove('projectMemoryUsage', entry.tombstone.itemId);
        const sources = this.excludedSourceIds(entry, remainingRows);
        for (const id of sources) this.store.remove('projectMemorySource', id);
        remainingRows -= sources.length;
        for (const id of entry.tombstone.affectedDerivedArtifacts) if (remainingRows && this.store.get('projectMemoryDerived', id)) { this.store.remove('projectMemoryDerived', id); remainingRows--; }
        return { itemId: entry.tombstone.itemId, deletedCopies: true };
      });
      if (this.retainedCopies(entry)) continue;
      const busyTimeout = (this.store.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout;
      this.store.db.exec('PRAGMA busy_timeout=0');
      let checkpoint: { busy: number };
      try { checkpoint = this.store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number }; }
      finally { this.store.db.exec(`PRAGMA busy_timeout=${busyTimeout}`); }
      if (checkpoint.busy) continue; // A reader holds old WAL pages. Keep physical purge pending.
      const complete: Deletion = { ...entry, tombstone: { ...entry.tombstone, purgeStatus: 'COMPLETE' } }; this.appendDeletion(complete);
      this.store.internal('project.memory.purge.completed', null, () => { this.store.put('projectMemoryTombstone', entry.tombstone.itemId, null, complete); return { itemId: entry.tombstone.itemId, purgeStatus: 'COMPLETE' }; });
      completed++;
      } finally { this.store.db.exec(`PRAGMA secure_delete=${secure}`); }
    }
    return completed;
  }
  export(access: MemoryAccess): MemoryExport {
    this.assertAccess(access);
    return { scope: memoryScope(access), redacted: true, items: this.read(access).items.map(({ item }) => ({ id: item.id, revision: item.revision, kind: item.kind, state: item.state, text: item.sensitivity === 'SENSITIVE' || memoryContainsSecret(item.text) ? '[redacted]' : item.text, sourceDigests: item.sourceRefs.map(ref => ref.digest) })), tombstones: this.tombstones(access).map(({ itemId, deletionRevision, deletedAt, purgeStatus }) => ({ itemId, deletionRevision, deletedAt, purgeStatus })) };
  }
}
