import type { Operation, ResourceGrant } from '../contracts';

export type DocumentLocation = { resourceId: string; resourcePath?: string };
export type VerifiedExportEvidence = { operationId: string; source: DocumentLocation; destination: DocumentLocation; sourceSha256: string; outputSha256: string };
const path = (value: unknown) => value === undefined ? '' : typeof value === 'string' ? value : null;
export const sameDocumentLocation = (a: DocumentLocation, b: DocumentLocation) => a.resourceId === b.resourceId && path(a.resourcePath) === path(b.resourcePath);

/** Evidence correlation only. Resource access and byte verification remain separate. */
export function documentExportEvidence(threadId: string, operationId: string, operations: readonly Operation[], resources: readonly ResourceGrant[], destination: DocumentLocation, previous?: DocumentLocation): VerifiedExportEvidence {
  const deny = (): never => { throw new Error('The completed PDF export could not be verified for this document. Open the source or retry.'); };
  const operation = operations.find(item => item.id === operationId);
  if (!operation || operation.threadId !== threadId || operation.kind !== 'pdf.export' || !operation.approved || operation.status !== 'succeeded') return deny();
  const { args, preconditions } = operation, result = operation.result as Record<string, unknown> | undefined;
  if (!result || typeof result !== 'object' || typeof args.resourceId !== 'string' || typeof args.exportResourceId !== 'string' || typeof args.outputPath !== 'string' || !args.outputPath || path(args.path) === null) return deny();
  const source: DocumentLocation = { resourceId: args.resourceId, ...(args.path === undefined ? {} : { resourcePath: args.path as string }) };
  const expectedDestination: DocumentLocation = { resourceId: args.exportResourceId, resourcePath: args.outputPath };
  if (!sameDocumentLocation(destination, expectedDestination) || result.resourceId !== expectedDestination.resourceId || path(result.path) !== path(expectedDestination.resourcePath)) return deny();
  const sourceSha256 = preconditions.sha256, outputSha256 = preconditions.outputSha256;
  if (!/^[a-f0-9]{64}$/.test(sourceSha256 ?? '') || !/^[a-f0-9]{64}$/.test(outputSha256 ?? '') || result.sha256 !== outputSha256) return deny();
  for (const id of [source.resourceId, expectedDestination.resourceId]) {
    if (!operation.resourceIds.includes(id) || !resources.some(grant => grant.id === id && grant.threadId === threadId)) return deny();
  }
  if (previous && !sameDocumentLocation(previous, source) && !sameDocumentLocation(previous, expectedDestination)) return deny();
  return { operationId, source, destination: expectedDestination, sourceSha256, outputSha256 };
}
