import {createHash} from 'node:crypto';
import {HarnessError, type ResourceGrant} from '../contracts/index.ts';
import type {ResearchContext} from '../contracts/research.ts';
import type {Store} from '../storage/store.ts';

export const researchHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const researchDenied = (): never => {throw new HarnessError('CAPABILITY_DENIED', 'This research source is not authorized in the current workspace.');};
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
