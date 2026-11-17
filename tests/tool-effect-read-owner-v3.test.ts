import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ToolEffectReadModels } from '../packages/core/tool-effect-read-models.ts';
import type { ToolEffectRecord } from '../packages/contracts/tool-effects.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'effect-read-owner-'));
  const store = new Store(root);
  const reader = new ToolEffectReadModels(store);
  cleanups.push(() => { reader.dispose(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const thread = { id: 'thread-a', accountId: 'account-a', projectId: 'project-a', workspaceId: 'workspace-a' };
  const update = (changes: Partial<typeof thread>) => store.internal('fixture.owner', thread.id, () =>
    store.put('thread', thread.id, thread.id, { ...thread, ...changes }));
  update({});
  const effect: ToolEffectRecord = {
    effectId: 'effect-a', invocationId: 'inv-a', attemptId: 1, parentInvocationId: null,
    owner: { threadId: thread.id, runId: 'run-a', epoch: 1, projectId: thread.projectId,
      workspaceId: thread.workspaceId, accountBinding: thread.accountId },
    threadId: thread.id, toolId: 'repository_read', definitionDigest: 'a'.repeat(64),
    privateArgumentCommitment: 'b'.repeat(64), publicRedactedSummary: 'fixture',
    targetPreconditions: [], approvalId: null, state: 'DISPATCHED', providerReceiptRef: null,
    createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z', transitions: [],
  };
  const putEffect = (value: ToolEffectRecord) => store.internal('toolEffect.admitted', thread.id, () => {
    store.put('toolEffect', value.invocationId, thread.id, value);
    return { invocationId: value.invocationId, state: value.state };
  });
  putEffect(effect);
  const context = reader.context({ threadId: thread.id });
  return { store, reader, thread, effect, context, update, putEffect };
}

for (const method of ['invocations', 'observations'] as const) {
  describe(`M02 ${method} owner fence`, () => {
    const read = (x: ReturnType<typeof fixture>, threadId = x.thread.id) => x.reader[method]({
      threadId, scopeKey: x.context.scopeKey, ...(method === 'observations' ? { invocationId: 'inv-a' } : {}),
    });
    it('rejects a scope reused under a different route thread', () => {
      const x = fixture();
      expect(() => read(x, 'thread-b')).toThrow(expect.objectContaining({ code: 'RESYNC_REQUIRED' }));
    });
    it.each(['accountId', 'projectId', 'workspaceId'] as const)('revokes a changed %s binding', field => {
      const x = fixture();
      x.update({ [field]: 'changed' });
      expect(() => read(x)).toThrow(expect.objectContaining({ code: 'RESYNC_REQUIRED' }));
      x.update({});
      expect(() => read(x)).toThrow(expect.objectContaining({ code: 'RESYNC_REQUIRED' }));
    });
    it('rejects a deleted owner', () => {
      const x = fixture();
      x.store.internal('fixture.remove', x.thread.id, () => x.store.remove('thread', x.thread.id));
      expect(() => read(x)).toThrow(expect.objectContaining({ code: 'RESYNC_REQUIRED' }));
    });
    it('still permits the unchanged owner', () => {
      expect(() => read(fixture())).not.toThrow();
    });
    it('does not expose a receipt from another account under a current scope', () => {
      const x = fixture();
      x.putEffect({ ...x.effect, owner: { ...x.effect.owner, accountBinding: 'other-account' } });
      if (method === 'observations') {
        expect(() => read(x)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      } else {
        expect(x.reader.invocations({ threadId: x.thread.id, scopeKey: x.context.scopeKey }).effects).toEqual([]);
      }
    });
  });
}
