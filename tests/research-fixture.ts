import {mkdtemp, realpath, lstat, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {PersonalResearchRepository} from '../packages/research/repository.ts';
import type {VerifiedBrowserCaptureProvider} from '../packages/research/capture.ts';
import type {HostCommand, ResourceGrant, Thread} from '../packages/contracts/index.ts';

export const context = {authority: {kind: 'personal' as const}, threadId: 'thread-a', projectId: 'project-a'};
export const abcHash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
export function command(id: string, type: string, payload: Record<string, unknown>): HostCommand {
  return {id, type: 'research.' + type, threadId: context.threadId, payload: {...context, ...payload}};
}
export const textSource = (id = 'capture', text = 'abc', expectedRevision = 0) => command(id, 'source.capture', {sourceId: 'source-a', expectedRevision, title: 'Source A', input: {kind: 'text', text}});
export async function researchFixture(browser?: VerifiedBrowserCaptureProvider) {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-research-'));
  await mkdir(join(root, 'sources')); await writeFile(join(root, 'sources', 'source.txt'), 'abc');
  const store = new Store(join(root, 'data'));
  const thread: Thread = {...context, id: context.threadId, title: 'Research', projectName: 'Project A', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null};
  const path = join(root, 'sources', 'source.txt'), info = await lstat(path, {bigint: true});
  const grant: ResourceGrant = {id: 'grant-a', threadId: thread.id, kind: 'file', path, label: 'Source file', writable: false, createdAt: thread.createdAt, identity: {dev: String(info.dev), ino: String(info.ino)}};
  store.internal('fixture', null, () => {
    store.put('thread', thread.id, thread.id, thread);
    store.put('workspaceProject', context.projectId, null, {id: context.projectId, name: 'Project A', authority: {kind: 'local'}, rootPath: join(root, 'sources')});
    store.put('resource', grant.id, thread.id, grant);
  });
  const repository = new PersonalResearchRepository(store, {browser});
  return {store, repository, root, path, grant, thread, close: async () => {
    if (store.db.isOpen) store.close();
    if (await realpath(root) !== resolve(root) || !root.startsWith(base + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe research fixture cleanup');
    await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }};
}
