import type { ArtifactRecord, InputRequest, Operation, ResourceGrant, Thread, UserStateRecord, DataRecord } from '../contracts/index.ts';
import { HarnessError } from '../contracts/index.ts';
import type { Store } from '../storage/store.ts';
import { taskMemories } from './task-memory.ts';
import { threadData } from './ui-admission.ts';

function sourcePage(store: Store, threadId: string, args: Record<string, unknown>) {
  if (typeof args.dataId !== 'string' || args.revision !== undefined && (!Number.isSafeInteger(args.revision) || Number(args.revision) < 1)) throw new HarnessError('INVALID_DATA_REF', 'Choose a same-thread data ID and a valid revision.');
  const data = threadData(store, threadId, args.dataId, args.revision as number | undefined);
  let value: unknown = data.value; const pointer = args.pointer ?? '';
  if (typeof pointer !== 'string' || pointer.length > 2048 || pointer !== '' && !pointer.startsWith('/')) throw new HarnessError('INVALID_DATA_REF', 'Pointers are relative to data.value.');
  if (pointer) for (const token of pointer.slice(1).split('/')) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new HarnessError('INVALID_DATA_REF', 'This data path is unavailable.');
    value = (value as Record<string, unknown>)[key];
  }
  const offset = args.offset ?? 0, limit = args.limit ?? (typeof value === 'string' ? 2000 : 30), maximum = typeof value === 'string' ? 4000 : 100;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > maximum) throw new HarnessError('INVALID_INPUT', `Use a nonnegative offset and a limit of 1–${maximum}.`);
  const meta = { id: data.id, revision: data.revision, provenance: data.provenance.slice(0, 1000), pointer };
  const result: Record<string, unknown> = { ...meta, value };
  if (Array.isArray(value)) {
    const page: unknown[] = []; result.value = page; result.offset = offset; result.total = value.length;
    let bytes = Buffer.byteLength(JSON.stringify(result)) + 100;
    for (const item of value.slice(Number(offset), Number(offset) + Number(limit))) {
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (bytes + size > 8192) break; page.push(item); bytes += size;
    }
    if (Number(offset) + page.length < value.length) result.nextOffset = Number(offset) + page.length;
    if (!page.length && Number(offset) < value.length) { delete result.nextOffset; result.detailQuery = `Select a narrower pointer such as ${pointer}/${offset}/field.`; result.tooLarge = true; }
  } else if (typeof value === 'string') {
    let length = Math.min(Number(limit), Math.max(0, value.length - Number(offset)));
    result.value = value.slice(Number(offset), Number(offset) + length); result.offset = offset; result.total = value.length; result.units = 'UTF-16 code units';
    while (length > 1 && Buffer.byteLength(JSON.stringify(result)) > 8100) { length = Math.max(1, Math.floor(length / 2)); result.value = value.slice(Number(offset), Number(offset) + length); }
    if (Number(offset) + length < value.length) result.nextOffset = Number(offset) + length;
  } else if (Buffer.byteLength(JSON.stringify(result)) > 8192) {
    delete result.value; result.tooLarge = true;
    if (value && typeof value === 'object') result.keys = Object.keys(value).slice(0, 30).map(key => key.slice(0, 120));
    result.detailQuery = 'Choose a narrower pointer; full source data is retained.';
  }
  return result;
}

/** Read one thread's projections directly; never deserialize the global transcript. */
export function inspectTask(store: Store, thread: Thread, plan: unknown, args: Record<string, unknown>) {
  if (args.dataId !== undefined) return sourcePage(store, thread.id, args);
  // Fixed, module-owned field names: SQLite projects metadata without transferring
  // large specs, data tables or executor output into the host's JS heap.
  function metadata<T>(kind: string, fields: string[]): T[] {
    if (fields.some(field => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(field))) throw new Error('Invalid inspection projection');
    const projection = fields.flatMap(field => [`'${field}'`, `json_extract(body,'$.${field}')`]).join(',');
    const rows = store.db.prepare(`SELECT json_object(${projection}) AS body FROM entities WHERE kind=? AND thread_id=?`).all(kind, thread.id) as { body: string }[];
    return rows.map(row => JSON.parse(row.body) as T);
  }
  function own<T extends { threadId: string }>(kind: string, id: unknown): T | undefined {
    if (id === undefined) return undefined;
    if (typeof id !== 'string') throw new HarnessError('INVALID_INPUT', 'Use a valid inspection identifier.');
    const value = store.get<T>(kind, id);
    if (!value || value.threadId !== thread.id) throw new HarnessError('NOT_FOUND', 'This item is not available to this thread.');
    return value;
  }
  const artifact = own<ArtifactRecord>('artifact', args.artifactId), request = own<InputRequest>('request', args.requestId), operation = own<Operation>('operation', args.operationId);
  const artifacts = metadata<Pick<ArtifactRecord,'id'|'title'|'revision'|'stateId'|'lifecycle'|'pinned'>>('artifact', ['id', 'title', 'revision', 'stateId', 'lifecycle', 'pinned']), requests = metadata<Pick<InputRequest,'id'|'title'|'revision'|'status'|'artifactId'>>('request', ['id', 'title', 'revision', 'status', 'artifactId']), operations = metadata<Operation>('operation', ['id', 'revision', 'kind', 'description', 'status', 'approved']), resources = metadata<Pick<ResourceGrant,'id'|'label'|'kind'|'writable'>>('resource', ['id', 'label', 'kind', 'writable']), states = metadata<Pick<UserStateRecord,'id'|'revision'|'schemaVersion'>>('userState', ['id', 'revision', 'schemaVersion']), data = metadata<DataRecord>('data', ['id', 'revision', 'provenance']);
  // Explicit detail requests retain exact schemas/evidence needed for a valid revision.
  if (artifact || request || operation) return { thread, artifact, request, operation, userStates: artifact ? [own<UserStateRecord>('userState', artifact.stateId)].filter(Boolean) : [], resources };
  const summary = { thread: { ...thread, error: thread.error?.slice(0, 1024) }, plan, artifacts, requests, resources, data: data.map(({ id, revision, provenance }) => ({ id, revision, provenance: provenance?.slice(0, 200) })), operations: operations.map(({ id, revision, kind, description, status, approved }) => ({ id, revision, kind, description: description?.slice(0, 160), status, approved })), userStates: states, memory: taskMemories(store, thread.id).map(({ key, revision }) => ({ key, revision })), counts: { artifacts: artifacts.length, requests: requests.length, operations: operations.length, resources: resources.length, data: data.length, userStates: states.length }, truncated: false, detailQuery: 'Use artifactId for its spec/current state, requestId for the exact question, operationId for the exact receipt; task_memory list reads notes.' };
  // Bound each list before measuring the response. Never repeatedly serialize
  // thousands of rows while removing one at a time on the host event loop.
  const arrays = [summary.artifacts, summary.requests, summary.resources, summary.data, summary.operations, summary.userStates];
  for (const items of arrays) if (items.length > 20) { items.splice(0, items.length - 20); summary.truncated = true; }
  if (Buffer.byteLength(JSON.stringify(summary)) <= 8192) return summary;
  summary.truncated = true; summary.plan = undefined;
  while (Buffer.byteLength(JSON.stringify(summary)) > 8192) {
    const longest = arrays.reduce((best, items) => JSON.stringify(items).length > JSON.stringify(best).length ? items : best, arrays[0]);
    if (!longest.length) break; longest.splice(0, Math.max(1, Math.ceil(longest.length / 2)));
  }
  return summary;
}
