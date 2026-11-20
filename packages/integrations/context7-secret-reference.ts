import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { integrationSecretReferenceStatusSchema, type Context7SecretReferenceMetadata, type IntegrationSecretReferenceStatus } from '../contracts/integration-secrets.ts';
import { SecretReferenceLedger } from '../core/secret-references.ts';

const unavailable = () => new HarnessError('SECRET_REF_UNAVAILABLE', 'The configured Context7 reference is unavailable.');
const maximumExecutableBytes = 512n * 1024n * 1024n;
const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && b.nlink === 1n && b.isFile();
export interface ObservedContext7Executable { path: string; dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string; sha256: string }

/** A read-only observation for metadata and later approval previews. It is not
 * a native execution lease. Approved launch must reacquire native custody and
 * recheck the exact bytes and identity before resolving a reference. */
export async function observeContext7Executable(path: string): Promise<ObservedContext7Executable> {
  if (!isAbsolute(path)) throw unavailable();
  try {
  const canonical = await realpath(path), before = await lstat(canonical, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size <= 0n || before.size > maximumExecutableBytes) throw unavailable();
  const handle = await open(canonical, 'r');
  try {
    if (!sameFile(before, await handle.stat({ bigint: true }))) throw unavailable();
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024); let bytes = 0n;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += BigInt(bytesRead); if (bytes > maximumExecutableBytes || bytes > before.size) throw unavailable();
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (bytes !== before.size || await realpath(path) !== canonical || !sameFile(before, await handle.stat({ bigint: true })) || !sameFile(before, await lstat(canonical, { bigint: true }))) throw unavailable();
    return { path: canonical, dev: String(before.dev), ino: String(before.ino), size: String(before.size), mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs), sha256: hash.digest('hex') };
  } finally { await handle.close(); }
  } catch (error) { if (error instanceof HarnessError) throw error; throw unavailable(); }
}

/** Host-owned references. Configuration invalidates before child drain; the
 * resolver remains private and is never invoked by the metadata surface. */
export class Context7SecretReferences {
  private ledger = new SecretReferenceLedger();
  private generation = 0;
  private configured = false;
  private invalidated = false;
  private current: { observation: ObservedContext7Executable; metadata: Context7SecretReferenceMetadata } | undefined;
  constructor(readonly enabled: boolean, private readonly executable: string, private readonly resolver: () => string | undefined) {}

  invalidate(): void { this.generation++; if (this.current) this.ledger.revoke(this.current.metadata.refId); this.current = undefined; this.invalidated = true; }
  configure(configured: boolean): void { this.invalidate(); this.configured = configured; this.invalidated = false; }
  requiresConfiguration(): boolean { return this.invalidated; }
  close(): void { this.invalidate(); this.configured = false; }

  async capture(): Promise<{ reference: Context7SecretReferenceMetadata; executable: ObservedContext7Executable }> {
    const status = await this.status();
    if (!status.references.length || !this.current || status.references[0]!.refId !== this.current.metadata.refId) throw unavailable();
    return structuredClone({ reference: this.current.metadata, executable: this.current.observation });
  }
  assertCurrent(reference: Context7SecretReferenceMetadata, executable: ObservedContext7Executable): void {
    if (!this.enabled || !this.configured || this.invalidated || !this.current || JSON.stringify(reference) !== JSON.stringify(this.current.metadata)
      || JSON.stringify(executable) !== JSON.stringify(this.current.observation)) throw unavailable();
  }
  /** Delegates only the already approved host operation's delivery. The host
   * calls this while exact native launch custody is held, never at startup. */
  async resolveApproved(reference: Context7SecretReferenceMetadata, executable: ObservedContext7Executable, operationId: string): Promise<string> {
    this.assertCurrent(reference, executable);
    const approval = this.ledger.approve(reference.refId, reference.destination, { actor: operationId });
    const delivery = await this.ledger.resolve(reference.refId, reference.destination, approval);
    this.assertCurrent(reference, executable);
    const value = delivery.env?.CONTEXT7_API_KEY; if (!value) throw unavailable(); return value;
  }

  async status(): Promise<IntegrationSecretReferenceStatus> {
    const base = { version: 1 as const, enabled: this.enabled, configured: this.configured, references: [] };
    if (!this.enabled || !this.configured) return base;
    const generation = this.generation;
    try {
      if (this.invalidated) throw unavailable();
      const observation = await observeContext7Executable(this.executable);
      if (generation !== this.generation || this.invalidated || !this.configured) throw unavailable();
      if (!this.current || JSON.stringify(this.current.observation) !== JSON.stringify(observation)) {
        if (this.current) this.ledger.revoke(this.current.metadata.refId);
        // A new ledger releases obsolete resolver entries. No value is cached.
        this.ledger = new SecretReferenceLedger();
        const refId = 'context7.' + randomUUID(), destination = { kind: 'process-env' as const, executableSha256: observation.sha256, envName: 'CONTEXT7_API_KEY' as const };
        this.ledger.register({ version: 1, refId, purpose: 'Context7 documentation', owner: 'personal/context7', destination }, () => {
          if (generation !== this.generation || this.invalidated || this.current?.metadata.refId !== refId) throw unavailable();
          const value = this.resolver(); if (!value) throw unavailable(); return value;
        });
        const metadata = { refId, purpose: 'Context7 documentation' as const, owner: 'personal/context7' as const, destination, revoked: false as const };
        this.current = { observation, metadata };
      }
      return integrationSecretReferenceStatusSchema.parse({ ...base, references: [this.current.metadata] });
    } catch {
      // A changed configuration makes this observation obsolete. Report the
      // current configured bit without publishing the superseded reference.
      if (!this.configured) return { ...base, configured: false };
      return { ...base, configured: true, unavailableReason: 'The configured Context7 reference is unavailable.' };
    }
  }
}
