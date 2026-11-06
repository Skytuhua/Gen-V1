import {createHash} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {HarnessError, type ResourceGrant} from '../contracts/index.ts';
import {RESEARCH_SOURCE_BYTES, type ResearchAuthority, type ResearchContext, type ResearchFileReference} from '../contracts/research.ts';
import {readBoundFile, withPathGuard, withResourceGrant} from '../core/file-access.ts';
import {digest, type Store} from '../storage/store.ts';

export interface VerifiedBrowserCapture {
  browserId: string; navigationId: string; authorizationId: string; url: string; bytes: Uint8Array;
  /** Synchronous owning-host authorization/navigation check while its lease is held. */
  assertCurrent(): void;
}
/** No default implementation. The owning host holds its explicit capture grant through consume.
 * Supply only authorized page text, excluding credentials/input values; never read browser profiles.
 */
export interface VerifiedBrowserCaptureProvider {
  readonly authority: ResearchAuthority;
  withCapture<T>(request: {context: ResearchContext; browserId: string; navigationId: string; maxBytes: number}, signal: AbortSignal, consume: (capture: VerifiedBrowserCapture) => Promise<T>): Promise<T>;
}

export const researchHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const researchDenied = (): never => {throw new HarnessError('CAPABILITY_DENIED', 'This research source is not authorized in the current workspace.');};
export function assertResearchActive(signal: AbortSignal): void {
  if (signal.aborted) throw new HarnessError('CANCELLED', 'Research capture was cancelled.');
}
function ordinaryDocumentPath(path: string) {
  const parts = path.replaceAll('\\', '/').toLowerCase().split('/');
  if (parts.some(p => p === '..' || /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.kube|\.npmrc|\.netrc|auth\.json|credentials(?:\..*)?|id_(?:rsa|ed25519)(?:\..*)?)$/.test(p)) || /\.(?:pem|key|pfx|p12|kdbx)$/i.test(path) || path.includes('\0')) researchDenied();
}
export function currentResearchGrant(store: Store, context: ResearchContext, resourceId: string): ResourceGrant {
  const grant = store.get<ResourceGrant>('resource', resourceId);
  if (!grant || grant.threadId !== context.threadId || !grant.identity || !['project', 'file', 'attachment'].includes(grant.kind)) return researchDenied();
  ordinaryDocumentPath(grant.path);
  return grant;
}

/** Holds existing namespace guards and a native deny-write file lease through consume/commit. */
export async function withGrantedResearchFile<T>(store: Store, context: ResearchContext, resourceId: string, relativePath: string | undefined, signal: AbortSignal, consume: (value: {bytes: Buffer; reference: ResearchFileReference; grantBinding: string; assertCurrent(): void}) => Promise<T>, expected?: ResearchFileReference): Promise<T> {
  assertResearchActive(signal);
  if (relativePath !== undefined) ordinaryDocumentPath(relativePath);
  const grant = currentResearchGrant(store, context, resourceId), grantBinding = digest(grant);
  const assertCurrent = () => {
    assertResearchActive(signal);
    if (digest(currentResearchGrant(store, context, resourceId)) !== grantBinding) researchDenied();
  };
  return withResourceGrant(grant, store.dataDir, relativePath, false, signal, async path => {
    ordinaryDocumentPath(path);
    const before = await lstat(path, {bigint: true});
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) return researchDenied();
    if (before.size > BigInt(RESEARCH_SOURCE_BYTES)) throw new HarnessError('RESOURCE_LIMIT', 'Research sources are limited to 4 MiB.');
    const identity = {dev: String(before.dev), ino: String(before.ino), size: Number(before.size)};
    return withPathGuard([{path, leaf: true, readOnly: true, dev: identity.dev, ino: identity.ino}], signal, async () => {
      assertCurrent();
      const bytes = await readBoundFile(path, RESEARCH_SOURCE_BYTES, identity), hash = researchHash(bytes);
      const after = await lstat(path, {bigint: true});
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || hash !== researchHash(await readBoundFile(path, RESEARCH_SOURCE_BYTES, identity))) throw new HarnessError('SOURCE_CHANGED', 'The selected source changed during capture.');
      const reference: ResearchFileReference = {dev: identity.dev, ino: identity.ino, bytes: bytes.length, sha256: hash, binding: digest({context, grant})};
      if (expected && digest(reference) !== digest(expected)) throw new HarnessError('SOURCE_CHANGED', 'The selected source changed. Inspect it again before capture.');
      assertCurrent();
      return consume({bytes, reference, grantBinding, assertCurrent});
    });
  });
}
