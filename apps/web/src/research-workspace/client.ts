import type {ResearchCommand, ResearchContext, ResearchDocument, ResearchFileReference, ResearchPassage, ResearchProvider, ResearchSource} from '../../../../packages/contracts/research';
import {ApiError, authenticated, command, read} from '../api';

export type ResearchResource = {kind: 'source' | 'document'; id: string; revision?: number};
export interface ResearchSelection extends ResearchContext {epoch: number; resource: ResearchResource | null}
export type ResearchDocumentRead = Omit<ResearchDocument, 'citations'> & {citations: ReturnType<ResearchProvider['document']>['citations'][number][]};
export type ResearchDocumentHead = Omit<ResearchDocument, 'body' | 'citations'>;
export interface ResearchPage<T> {items: T[]; nextCursor: string | null}
type Payload<T extends ResearchCommand['type']> = Omit<Extract<ResearchCommand, {type: T}>['payload'], keyof ResearchContext>;

export function researchScope(selection: ResearchSelection) {
  return JSON.stringify([selection.authority, selection.threadId, selection.projectId, selection.epoch]);
}
function context(selection: ResearchSelection): ResearchContext {
  if (selection.authority.kind !== 'personal') throw new ApiError('ACCESS_DENIED', 'Personal research only.');
  return {authority: {kind: 'personal'}, threadId: selection.threadId, projectId: selection.projectId};
}
function get<T>(selection: ResearchSelection, path: string, extra: Record<string, string | undefined> = {}, signal?: AbortSignal) {
  const owner = context(selection), query = new URLSearchParams({authority: 'personal', threadId: owner.threadId});
  if (owner.projectId !== null) query.set('projectId', owner.projectId);
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) query.set(key, value);
  return authenticated(() => fetch(`/api/research${path}?${query}`, {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal})).then(read<T>);
}
function send<T extends ResearchCommand['type']>(selection: ResearchSelection, type: T, payload: Payload<T>, commandId?: string) {
  const owner = context(selection);
  return command(type, {...owner, ...payload}, owner.threadId, commandId);
}
export const researchClient = {
  list<K extends 'sources' | 'documents'>(selection: ResearchSelection, kind: K, cursor?: string, signal?: AbortSignal, limit = 40) {
    return get<ResearchPage<K extends 'sources' ? ResearchSource : ResearchDocumentHead>>(selection, '', {kind, cursor, limit: String(limit)}, signal);
  },
  source: (selection: ResearchSelection, id: string, revision?: number, signal?: AbortSignal) => get<ResearchSource>(selection, `/sources/${encodeURIComponent(id)}`, {revision: revision?.toString()}, signal),
  document: (selection: ResearchSelection, id: string, revision?: number, signal?: AbortSignal) => get<ResearchDocumentRead>(selection, `/documents/${encodeURIComponent(id)}`, {revision: revision?.toString()}, signal),
  passage: (selection: ResearchSelection, ref: ResearchPassage, signal?: AbortSignal) => get<ReturnType<ResearchProvider['passage']>>(selection, `/sources/${encodeURIComponent(ref.sourceId)}/passage`, {revision: String(ref.revision), sha256: ref.sha256, start: String(ref.start), end: String(ref.end)}, signal),
  fileReference: (selection: ResearchSelection, resourceId: string, relativePath?: string, signal?: AbortSignal) => get<ResearchFileReference>(selection, '/file-reference', {resourceId, relativePath}, signal),
  capture: (selection: ResearchSelection, payload: Payload<'research.source.capture'>, commandId?: string) => send(selection, 'research.source.capture', payload, commandId),
  bookmark: (selection: ResearchSelection, payload: Payload<'research.source.bookmark'>, commandId?: string) => send(selection, 'research.source.bookmark', payload, commandId),
  save: (selection: ResearchSelection, payload: Payload<'research.document.save'>, commandId?: string) => send(selection, 'research.document.save', payload, commandId),
};

/** Do not echo server/provider messages: they can contain revoked resource paths. */
export function researchError(error: unknown): string {
  switch (error instanceof ApiError ? error.code : '') {
    case 'ACCESS_DENIED': case 'CAPABILITY_DENIED': case 'AUTH_REQUIRED': return 'Access unavailable or revoked. Check the grant, then retry.';
    case 'NOT_FOUND': return 'This revision is missing. Refresh or choose another item.';
    case 'PRECONDITION_FAILED': return 'A newer revision was saved. Your draft is preserved.';
    case 'SOURCE_CHANGED': return 'Source changed. Verify the granted file again, then retry.';
    case 'INVALID_CITATION': case 'INVALID_SOURCE': return 'Choose an exact UTF-8 passage within this capture.';
    case 'CAPABILITY_UNAVAILABLE': return 'Browser capture is unavailable on this host.';
    case 'RESOURCE_LIMIT': return 'Content exceeds its limit. Use a smaller source or document.';
    default: return 'Could not reach research. Check the connection, then retry.';
  }
}
