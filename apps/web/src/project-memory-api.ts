import {z} from 'zod';
import { Sha256Hex } from '../../../packages/contracts/hashing.ts';
import {
  memoryActionEnvelopeSchema, memoryExportSchema, memoryForgetPreviewSchema, memoryMutationResultSchema,
  memoryScopeSchema, memorySourceDetailSchema, projectMemoryViewSchema,
  type MemoryAction, type MemoryItemV1, type MemoryScope, type MemorySourceRefV1,
} from '../../../packages/contracts/project-memory';
import {ApiError, authenticated, csrfToken, read} from './api';
import type {DesktopMemoryExportResult} from '../../../packages/desktop-contract/index';

export type MemoryOwner = Pick<MemoryScope, 'projectId' | 'threadId' | 'accountId'>;
const ownerSchema = memoryScopeSchema.pick({projectId: true, threadId: true, accountId: true});
const invalid = () => new ApiError('INVALID_RESPONSE', 'Project memory changed owner, source or revision. Close this review and reopen it.');
const revoked = () => new ApiError('CAPABILITY_DENIED', 'The owning project memory review changed. Reopen it before making changes.');
export const memoryOwnerKey = (owner: MemoryOwner) => JSON.stringify([owner.projectId, owner.threadId, owner.accountId]);
const scopeKey = (scope: MemoryScope) => JSON.stringify([scope.projectId, scope.projectIdentity, scope.threadId, scope.accountId, scope.bindingDigest]);
const sourceKey = (ref: MemorySourceRefV1) => JSON.stringify([ref.ownerThreadId, ref.sourceKind, ref.sourceId, ref.sourceRevision, ref.capturedSeq, ref.digest, ref.observedStatus]);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {const result = schema.safeParse(value); if (!result.success) throw invalid(); return result.data;}
function checkScope(expected: MemoryScope, actual: MemoryScope) {if (scopeKey(expected) !== scopeKey(actual)) throw invalid();}
function current(check: () => boolean) {if (!check()) throw revoked();}
const base = (projectId: string) => '/api/projects/' + encodeURIComponent(projectId) + '/memory';
const get = (owner: MemoryOwner, suffix: string, query: Record<string, string>, signal?: AbortSignal) => authenticated(() => {
  signal?.throwIfAborted();
  return fetch(base(owner.projectId) + suffix + '?' + new URLSearchParams({threadId: owner.threadId, ...query}), {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal});
}).then(read<unknown>);

export async function getProjectMemory(input: MemoryOwner, signal?: AbortSignal, expectedScope?: MemoryScope, options: {refreshBinding?: boolean} = {}) {
  const owner = ownerSchema.parse(input), view = parse(projectMemoryViewSchema, await get(owner, '', {}, signal));
  signal?.throwIfAborted();
  if (memoryOwnerKey(owner) !== memoryOwnerKey(view.scope)) throw invalid();
  if (expectedScope) {
    // Explicit user refresh may observe a later run of the same durable owner.
    // It cannot carry a correction across an account or physical project change.
    if (options.refreshBinding) {
      if (memoryOwnerKey(expectedScope) !== memoryOwnerKey(view.scope) || expectedScope.projectIdentity !== view.scope.projectIdentity) throw invalid();
    } else checkScope(expectedScope, view.scope);
  }
  const ids = new Set<string>();
  for (const row of view.items) {
    if (ids.has(row.item.id) || row.item.projectIdentity !== view.scope.projectIdentity || row.conflictRevisions.some(value => value.id !== row.item.id || value.projectIdentity !== view.scope.projectIdentity)) throw invalid();
    ids.add(row.item.id);
  }
  if (view.tombstones.some(value => value.projectIdentity !== view.scope.projectIdentity || ids.has(value.itemId))) throw invalid();
  return view;
}

export async function getMemorySource(scope: MemoryScope, item: MemoryItemV1, ref: MemorySourceRefV1, signal?: AbortSignal) {
  if (item.projectIdentity !== scope.projectIdentity || !item.sourceRefs.some(value => sourceKey(value) === sourceKey(ref))) throw invalid();
  const result = parse(memorySourceDetailSchema, await get(scope, '/source', {itemId: item.id, revision: String(item.revision), sourceDigest: ref.digest, sourceRef: JSON.stringify(ref)}, signal));
  signal?.throwIfAborted(); checkScope(scope, result.scope);
  if (sourceKey(result.ref) !== sourceKey(ref) || new TextEncoder().encode(result.content).length > 65536) throw invalid();
  if (!globalThis.crypto?.subtle) throw new ApiError('SOURCE_UNAVAILABLE', 'Source verification is unavailable in this browser. The source content was not opened.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(result.content));
  signal?.throwIfAborted();
  if ([...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') !== ref.digest) throw invalid();
  return result;
}

export async function getMemoryForgetPreview(scope: MemoryScope, item: MemoryItemV1, signal?: AbortSignal) {
  const result = parse(memoryForgetPreviewSchema, await get(scope, '/forget', {itemId: item.id, revision: String(item.revision)}, signal));
  signal?.throwIfAborted(); checkScope(scope, result.scope);
  if (result.itemId !== item.id || result.revision !== item.revision || item.projectIdentity !== scope.projectIdentity) throw invalid();
  return result;
}

export async function mutateProjectMemory(scope: MemoryScope, operation: MemoryAction, commandId: string, isCurrent: () => boolean) {
  const envelope = memoryActionEnvelopeSchema.parse({commandId, scope, operation}); current(isCurrent);
  const body = JSON.stringify(envelope);
  const send = () => {
    current(isCurrent);
    return fetch(base(scope.projectId) + '/actions', {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body});
  };
  // One transport retry uses the same immutable command envelope, including its review revision.
  const response = await authenticated(async () => {try {return await send();} catch (cause) {if (cause instanceof ApiError) throw cause; return send();}});
  current(isCurrent);
  const result = parse(memoryMutationResultSchema, await read<unknown>(response)); current(isCurrent);
  if (result.commandId !== commandId || result.result.revision <= operation.baseRevision || ('itemId' in operation && result.result.itemId !== operation.itemId)) throw invalid();
  return result;
}

export async function exportProjectMemory(scope: MemoryScope, isCurrent: () => boolean) {
  const response = await authenticated(() => {
    current(isCurrent);
    return fetch(base(scope.projectId) + '/export', {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body: JSON.stringify({scope})});
  });
  current(isCurrent); const result = parse(memoryExportSchema, await read<unknown>(response)); current(isCurrent); checkScope(scope, result.scope);
  return result;
}

const nativeExportResult = z.strictObject({status: z.enum(['saved', 'cancelled']), admitted: z.literal(true), filename: z.string().max(240), bytes: z.number().int().nonnegative().max(8 * 1024 * 1024), sha256: Sha256Hex});
export async function downloadProjectMemory(scope: MemoryScope, isCurrent: () => boolean): Promise<DesktopMemoryExportResult | {status: 'started'; admitted: false}> {
  const output = await exportProjectMemory(scope, isCurrent), content = JSON.stringify(output, null, 2) + '\n';
  const bytes = new TextEncoder().encode(content), filename = 'project-memory-' + output.scope.projectId.replaceAll(':', '_') + '.json';
  if (bytes.length > 8 * 1024 * 1024) throw new ApiError('EXPORT_UNAVAILABLE', 'The redacted export exceeds its byte bound.');
  current(isCurrent);
  const desktop = window.harnessDesktop;
  if (desktop) {
    if (!desktop.exportProjectMemory || !globalThis.crypto?.subtle) throw new ApiError('EXPORT_UNAVAILABLE', 'This desktop version cannot save a verified project memory export.');
    const hash = await crypto.subtle.digest('SHA-256', bytes), sha256 = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
    current(isCurrent);
    const receipt = parse(nativeExportResult, await desktop.exportProjectMemory(JSON.stringify(output)));
    current(isCurrent);
    if (receipt.filename !== filename || receipt.bytes !== bytes.length || receipt.sha256 !== sha256) throw invalid();
    return receipt;
  }
  const url = URL.createObjectURL(new Blob([content], {type: 'application/json'}));
  try {
    const link = document.createElement('a'); link.href = url; link.download = filename;
    current(isCurrent); link.click();
  } finally {setTimeout(() => URL.revokeObjectURL(url), 0);}
  return {status: 'started', admitted: false};
}
