import {memoryPreparedRequestSchema, type MemoryPreparedRequest, type MemoryRevisionRef} from '../../../packages/contracts/project-memory';
import {ApiError, authenticated, csrfToken, read} from './api';
import {memoryOwnerKey, type MemoryOwner} from './project-memory-api';
import type {MemoryRequestInput} from './project-memory-preparation';

const invalid = () => new ApiError('INVALID_RESPONSE', 'Prepared memory changed owner or request. Refresh context before sending.');
const base = (owner: MemoryOwner) => `/api/projects/${encodeURIComponent(owner.projectId)}/memory/requests`;
const scopeKey = (value: MemoryPreparedRequest) => JSON.stringify([memoryOwnerKey(value.scope), value.scope.projectIdentity, value.scope.bindingDigest]);
function parse(owner: MemoryOwner, value: unknown): MemoryPreparedRequest | null {
  if (value === null) return null;
  const parsed = memoryPreparedRequestSchema.safeParse(value); if (!parsed.success) throw invalid();
  const view = parsed.data, recall = view.recall;
  if (memoryOwnerKey(owner) !== memoryOwnerKey(view.scope) || recall.requestId !== view.requestId || recall.contextGeneration !== view.contextGeneration || recall.projectIdentity !== view.scope.projectIdentity || view.injectedBytes > recall.budgetBytes || view.items.length !== recall.selectedRevisions.length || new Set(view.items.map(item => item.id)).size !== view.items.length) throw invalid();
  for (const item of view.items) if (item.projectIdentity !== view.scope.projectIdentity || item.state !== 'ACCEPTED' || !recall.selectedRevisions.some(ref => ref.itemId === item.id && ref.revision === item.revision)) throw invalid();
  return view;
}
async function post(owner: MemoryOwner, path: string, body: unknown, signal: AbortSignal) {
  const serialized = JSON.stringify(body);
  const response = await authenticated(() => {signal.throwIfAborted(); return fetch(base(owner) + path, {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: {'Content-Type': 'application/json', 'x-harness-csrf': csrfToken}, body: serialized});});
  signal.throwIfAborted(); const value = await read<unknown>(response); signal.throwIfAborted(); return parse(owner, value);
}
export async function prepareMemoryRequest(input: MemoryRequestInput, signal: AbortSignal) {
  const view = await post(input.owner, '/prepare', {threadId: input.owner.threadId, prompt: input.prompt, modelId: input.modelId, thinkingLevel: input.thinkingLevel}, signal);
  if (view && view.phase !== 'PREPARING') throw invalid(); return view;
}
export async function latestMemoryRequest(owner: MemoryOwner, signal: AbortSignal) {
  const response = await authenticated(() => {signal.throwIfAborted(); return fetch(base(owner) + '/latest?' + new URLSearchParams({threadId: owner.threadId}), {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal});});
  signal.throwIfAborted(); const value = await read<unknown>(response); signal.throwIfAborted(); const view = parse(owner, value);
  if (view && view.phase !== 'CAPTURED') throw invalid(); return view;
}
export async function excludeMemoryFromRequest(view: MemoryPreparedRequest, revision: MemoryRevisionRef, signal: AbortSignal) {
  if (view.phase !== 'PREPARING' || !view.items.some(item => item.id === revision.itemId && item.revision === revision.revision)) throw invalid();
  const updated = await post(view.scope, '/' + encodeURIComponent(view.requestId) + '/exclude', {scope: view.scope, contextGeneration: view.contextGeneration, ...revision}, signal);
  if (!updated || updated.phase !== 'PREPARING' || updated.requestId !== view.requestId || updated.contextGeneration !== view.contextGeneration || scopeKey(updated) !== scopeKey(view) || updated.items.some(item => item.id === revision.itemId) || !updated.recall.exclusions.some(item => item.itemId === revision.itemId)) throw invalid();
  const original = memoryPreparedRequestSchema.parse(view);
  const immutable = (value: MemoryPreparedRequest) => {const {selectedRevisions: _, exclusions: __, ...recall} = value.recall; return {scope: value.scope, requestId: value.requestId, contextGeneration: value.contextGeneration, phase: value.phase, expiresAt: value.expiresAt, recall};};
  if (JSON.stringify(immutable(updated)) !== JSON.stringify(immutable(original)) || updated.injectedBytes > original.injectedBytes || JSON.stringify(updated.items) !== JSON.stringify(original.items.filter(item => item.id !== revision.itemId)) || JSON.stringify(updated.recall.selectedRevisions) !== JSON.stringify(original.recall.selectedRevisions.filter(item => item.itemId !== revision.itemId)) || original.recall.exclusions.some(item => !updated.recall.exclusions.some(value => value.itemId === item.itemId && value.reason === item.reason)) || updated.recall.exclusions.some(item => item.itemId !== revision.itemId && !original.recall.exclusions.some(value => value.itemId === item.itemId && value.reason === item.reason))) throw invalid();
  return updated;
}
