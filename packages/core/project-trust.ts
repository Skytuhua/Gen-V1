import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { canonical, inside } from './security.ts';
import {
  projectTrustV1Schema, projectTrustScopeV1Schema, rootRelativePathSchema,
  type ApprovedDigestV1, type ProjectTrustScopeV1, type ProjectTrustV1,
} from '../contracts/execution-profile.ts';
import type { Store } from '../storage/store.ts';

/** Project trust binds the canonical physical root identity (device + inode),
 * the approved executable/configuration digests, the requested scope, the
 * explicit user decision and its revision. Reading ordinary granted text
 * remains a separate capability; this record governs execution approval. */

export interface RootIdentity { canonicalPath: string; dev: string; ino: string }

const MAX_DIGEST_FILE_BYTES = 64 * 1024 * 1024;

export async function canonicalRootIdentity(path: string): Promise<RootIdentity> {
  const canonicalPath = await canonical(path);
  const info = await stat(canonicalPath, { bigint: true });
  if (!info.isDirectory()) throw new HarnessError('INVALID_RESOURCE', 'Project trust requires a directory root');
  return { canonicalPath, dev: String(info.dev), ino: String(info.ino) };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_DIGEST_FILE_BYTES) throw new HarnessError('RESOURCE_LIMIT', 'Approved file exceeds the digest size limit');
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Compute approved digests for root-relative files. Every path must resolve
 * inside the canonical root through the existing path-identity guards; links,
 * retargets and escapes are rejected, never followed. */
export async function approvedFileDigests(rootCanonicalPath: string, files: readonly { path: string; kind: 'executable' | 'configuration' }[]): Promise<ApprovedDigestV1[]> {
  const root = await canonical(rootCanonicalPath);
  const entries: ApprovedDigestV1[] = [];
  for (const file of files) {
    const parsedPath = rootRelativePathSchema.parse(file.path);
    if (file.kind !== 'executable' && file.kind !== 'configuration') throw new HarnessError('INVALID_INPUT', 'Approved digest kind must be executable or configuration');
    const candidate = await canonical(join(root, ...parsedPath.split('/')));
    if (!inside(root, candidate)) throw new HarnessError('CAPABILITY_DENIED', 'An approved path leaves the trusted root');
    const info = await stat(candidate, { bigint: true });
    if (!info.isFile()) throw new HarnessError('INVALID_RESOURCE', 'Approved digests require regular files');
    entries.push({ path: parsedPath, kind: file.kind, sha256: await sha256File(candidate) });
  }
  return entries;
}

export interface CreateTrustInput {
  trustId?: string;
  rootPath: string;
  approvedFiles: readonly { path: string; kind: 'executable' | 'configuration' }[];
  scope: ProjectTrustScopeV1;
  decision: 'trusted' | 'declined';
  revision?: number;
  decidedAt?: string;
}

export async function createProjectTrust(input: CreateTrustInput): Promise<ProjectTrustV1> {
  const identity = await canonicalRootIdentity(input.rootPath);
  const approvedDigests = await approvedFileDigests(identity.canonicalPath, input.approvedFiles);
  return projectTrustV1Schema.parse({
    version: 1,
    trustId: input.trustId ?? `trust-${randomUUID()}`,
    root: { canonicalPath: identity.canonicalPath, identity: { dev: identity.dev, ino: identity.ino } },
    approvedDigests,
    scope: projectTrustScopeV1Schema.parse(input.scope),
    decision: input.decision,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
    revision: input.revision ?? 1,
  });
}

export interface TrustVerification { status: 'CURRENT' | 'INVALIDATED'; reasons: string[] }

/** Pre-dispatch check: recompute the physical root identity and every approved
 * digest. Any alias retarget, root recreation or changed byte invalidates. */
export async function verifyProjectTrust(record: ProjectTrustV1, rootPath: string): Promise<TrustVerification> {
  const reasons: string[] = [];
  let parsed: ProjectTrustV1;
  try { parsed = projectTrustV1Schema.parse(record); }
  catch { return { status: 'INVALIDATED', reasons: ['malformed-trust-record'] }; }
  if (parsed.decision !== 'trusted') reasons.push('decision-not-trusted');
  let identity: RootIdentity;
  try { identity = await canonicalRootIdentity(rootPath); }
  catch { return { status: 'INVALIDATED', reasons: [...reasons, 'root-unavailable'] }; }
  if (identity.dev !== parsed.root.identity.dev || identity.ino !== parsed.root.identity.ino) reasons.push('root-identity-changed');
  if (!samePath(identity.canonicalPath, parsed.root.canonicalPath)) reasons.push('root-path-changed');
  for (const approved of parsed.approvedDigests) {
    try {
      const current = await approvedFileDigests(identity.canonicalPath, [approved]);
      if (current[0]!.sha256 !== approved.sha256) reasons.push(`approved-bytes-changed:${approved.path}`);
    } catch {
      reasons.push(`approved-file-unavailable:${approved.path}`);
    }
  }
  return { status: reasons.length ? 'INVALIDATED' : 'CURRENT', reasons };
}

export async function assertProjectTrustCurrent(record: ProjectTrustV1, rootPath: string): Promise<void> {
  const verification = await verifyProjectTrust(record, rootPath);
  if (verification.status !== 'CURRENT') {
    throw new HarnessError('PROJECT_TRUST_INVALIDATED', 'The project trust decision no longer matches the physical root or approved bytes.', { reasons: verification.reasons });
  }
}

/** Requested access must stay inside the granted scope. Network 'allowlist'
 * covers declared-origin access only; it is still not open egress. */
export function trustScopeCovers(granted: ProjectTrustScopeV1, requested: ProjectTrustScopeV1): boolean {
  if (requested.read && !granted.read) return false;
  if (requested.write && !granted.write) return false;
  if (requested.network === 'allowlist' && granted.network !== 'allowlist') return false;
  return true;
}

interface TrustEnvelope { version: 1; record: ProjectTrustV1; revokedAt: string | null }

/** Durable trust ledger. Records and revocations persist through the host Store
 * (sole SQLite writer); history is retained, never deleted. */
export class ProjectTrustLedger {
  private readonly records = new Map<string, TrustEnvelope>();
  constructor(private readonly store?: Store) {
    for (const raw of store?.all<TrustEnvelope>('projectTrust') ?? []) {
      try {
        const envelope = raw as TrustEnvelope;
        projectTrustV1Schema.parse(envelope.record);
        this.records.set(envelope.record.trustId, Object.freeze({ ...envelope }));
      } catch { /* A malformed stored record cannot authorize anything. */ }
    }
  }
  private persist(envelope: TrustEnvelope): void {
    this.store?.internal('projectTrust.changed', null, () => this.store!.put('projectTrust', envelope.record.trustId, null, envelope));
  }
  async decide(input: CreateTrustInput & { trustId: string }): Promise<ProjectTrustV1> {
    const prior = this.records.get(input.trustId)?.record;
    const record = await createProjectTrust({ ...input, revision: (prior?.revision ?? 0) + 1 });
    const envelope: TrustEnvelope = { version: 1, record, revokedAt: null };
    const previous = this.records.get(record.trustId);
    this.records.set(record.trustId, Object.freeze(envelope));
    try { this.persist(envelope); }
    catch (error) {
      if (this.records.get(record.trustId) === envelope) {
        if (previous) this.records.set(record.trustId, previous);
        else this.records.delete(record.trustId);
      }
      throw error;
    }
    return record;
  }
  get(trustId: string): Readonly<TrustEnvelope> | null {
    const envelope = this.records.get(trustId);
    return envelope ? { ...envelope, record: { ...envelope.record } } : null;
  }
  revoke(trustId: string): boolean {
    const envelope = this.records.get(trustId);
    if (!envelope || envelope.revokedAt) return false;
    const next: TrustEnvelope = { ...envelope, revokedAt: new Date().toISOString() };
    this.records.set(trustId, Object.freeze(next));
    this.persist(next);
    return true;
  }
  list(): readonly { trustId: string; revision: number; decision: string; revokedAt: string | null }[] {
    return [...this.records.values()].map(envelope => ({ trustId: envelope.record.trustId, revision: envelope.record.revision, decision: envelope.record.decision, revokedAt: envelope.revokedAt }));
  }
  async verify(trustId: string, rootPath: string): Promise<TrustVerification> {
    const envelope = this.records.get(trustId);
    if (!envelope) return { status: 'INVALIDATED', reasons: ['unknown-trust-record'] };
    if (envelope.revokedAt) return { status: 'INVALIDATED', reasons: ['trust-revoked'] };
    return verifyProjectTrust(envelope.record, rootPath);
  }
}
