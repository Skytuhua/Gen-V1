import { afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { memoryFixture } from './project-memory-fixture.ts';
import { Store } from '../packages/storage/store.ts';
import { ProjectMemory } from '../packages/core/project-memory.ts';

let cleanup: Store | undefined;
afterEach(() => { vi.restoreAllMocks(); if (cleanup) { const root = dirname(cleanup.dataDir); cleanup.close(); cleanup = undefined; rmSync(root, { recursive: true, force: true }); } });

it('persists ledger enrollment when configure retries after its first enrollment transaction failed', async () => {
  const originalInternal = Store.prototype.internal, originalReview = ProjectMemory.prototype.review;
  let injected = false, memory: ProjectMemory | undefined, reviewArgs: Parameters<ProjectMemory['review']> | undefined;
  const internal = vi.spyOn(Store.prototype, 'internal').mockImplementation(function (this: Store, type, threadId, apply) {
    if (type === 'project.memory.ledger.enrolled' && !injected) { cleanup = this; injected = true; throw new Error('Synthetic enrollment transaction failure'); }
    return originalInternal.call(this, type, threadId, apply);
  });
  const review = vi.spyOn(ProjectMemory.prototype, 'review').mockImplementation(function (this: ProjectMemory, ...args) {
    memory = this; reviewArgs = args; return originalReview.apply(this, args);
  });
  await expect(memoryFixture()).rejects.toThrow('Synthetic enrollment transaction failure');
  internal.mockRestore(); review.mockRestore();
  expect(injected).toBe(true);
  const recovered = memory!, args = reviewArgs!, store = cleanup!, access = args[0];
  expect(store.all('projectMemoryLedger')).toEqual([]);
  expect(recovered.read(access).enabled).toBe(false);
  expect(recovered.review(...args).result.state).toBe('ENABLED');
  expect(store.all('projectMemoryLedger')).toHaveLength(1);
  expect(store.get('projectMemoryLedger', access.profileId)).toMatchObject({ path: expect.any(String), dev: expect.any(String), ino: expect.any(String) });

  const ref = recovered.captureMessage(access, 'source');
  const proposal = recovered.propose(access, { kind: 'DECISION', text: 'An enabled profile has a durable deletion fence.', sourceRefs: [ref] }, { kind: 'AGENT', id: 'agent' });
  recovered.review(access, { id: 'accept-after-retry', type: 'project.memory.review', threadId: access.threadId, payload: { operation: { action: 'accept', itemId: proposal.id, baseRevision: proposal.revision } } }, 'local-user');
  const reopened = new ProjectMemory(store, { enabled: () => true });
  expect(reopened.accepted(await reopened.access('project', 'thread')).map(row => row.item.id)).toEqual([proposal.id]);
});
