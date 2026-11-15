import { mkdtempSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../packages/storage/store.ts';
import { ProjectMemory } from '../packages/core/project-memory.ts';
import type { MemoryAccess, MemoryAction, MemorySourceRefV1 } from '../packages/contracts/project-memory.ts';

export async function memoryFixture(beforeMemoryInit?: (store: Store) => void) {
  const root = mkdtempSync(join(tmpdir(), 'm05-')), path = join(root, 'project'); mkdirSync(path);
  const store = new Store(join(root, 'profile')), stamp = new Date().toISOString();
  const physical = statSync(path, { bigint: true });
  store.internal('fixture', null, () => {
    store.put('workspaceProject', 'project', null, { id: 'project', name: 'Original', authority: {kind: 'local'}, rootPath: path, createdAt: stamp });
    store.put('workspaceProjectRoot', 'project', null, { path, identity: { dev: String(physical.dev), ino: String(physical.ino) } });
    for (const id of ['thread', 'other']) store.put('thread', id, id, { id, title: id, projectId: 'project', projectName: 'Original', createdAt: stamp, updatedAt: stamp, status: 'completed', epoch: 1, runId: null, modelId: 'model', sessionPath: null, accountId: 'account' });
    store.put('message', 'source', 'thread', { id: 'source', threadId: 'thread', role: 'user', content: 'Use SQLite for project persistence.', createdAt: stamp, runId: null });
  });
  beforeMemoryInit?.(store);
  const memory = new ProjectMemory(store, { enabled: () => true });
  const access = await memory.access('project', 'thread');
  const act = (operation: MemoryAction, owner: MemoryAccess = access) => memory.review(owner, { id: randomUUID(), type: 'project.memory.review', threadId: owner.threadId, payload: { operation } }, 'local-user');
  act({ action: 'configure', enabled: true, sourceThreadIds: ['thread'], baseRevision: 0 });
  const ref = memory.captureMessage(access, 'source');
  const propose = (text = 'Use SQLite for project persistence.', refs: MemorySourceRefV1[] = [ref]) => memory.propose(access, { kind: 'DECISION', text, sourceRefs: refs }, { kind: 'AGENT', id: 'agent' });
  const accept = (text?: string) => { const item = propose(text); act({ action: 'accept', itemId: item.id, baseRevision: item.revision }); return memory.read(access).items.find(row => row.item.id === item.id)!.item; };
  return { root, path, store, memory, access, act, ref, propose, accept };
}
