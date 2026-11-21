import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { ConversationReadModels } from '../packages/core/conversation-read-models.ts';
import { Service } from '../packages/core/service.ts';
import type { RuntimeAdapter, RuntimeCallbacks, StartRun, Thread } from '../packages/contracts/index.ts';

// Service-level fixture: a stub adapter with real cut/hydrate file semantics
// proves command admission, turn records and generation passthrough.
const makeRuntime = (dir: string, prompts: StartRun[]) => {
  let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = {
    configure: c => { callbacks = c; },
    models: async () => [{ id: 'openai/m', provider: 'openai', name: 'm' }],
    start: async input => {
      prompts.push(structuredClone(input));
      callbacks.onEvent({ ...input, type: 'session', sessionPath: input.sessionPath });
      callbacks.onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds ?? [input.inputId] });
      callbacks.onEvent({ ...input, type: 'assistant.message', content: 'R' });
      callbacks.onEvent({ ...input, type: 'settled' });
    },
    followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {},
    captureTurnCut: async path => ({ cutId: 'c' + 'a'.repeat(16), path: path.slice(0, -5) + '.cut-' + 'c' + 'a'.repeat(16) + '.json' }),
    hydrateSessionGeneration: async (_cut, input) => join(dir, 'hermes', 'sessions', 'gen-' + input.sessionGeneration + '.json'),
  };
  return { runtime };
};

describe('message.editRerun (#1532 T02)', async () => {
  it('admits an edit, flips the turn pointer and dispatches the generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'edit-rerun-'));
    const store = new Store(dir);
    const prompts: StartRun[] = [];
    const { runtime } = makeRuntime(dir, prompts);
    const service = new Service(store, runtime);
    try {
      await service.recover();
      const thread = (await service.command({ id: crypto.randomUUID(), type: 'thread.create', payload: {} })).result as Thread;
      await service.command({ id: 'in-1', threadId: thread.id, type: 'message.send', payload: { content: 'ORIGINAL_PROMPT', modelId: 'openai/m' } });
      await vi.waitFor(() => expect(store.get<{ status: string }>('outbox', 'in-1')?.status).toBe('handled'), { timeout: 15000, interval: 50 });
      const users = store.all<{ id: string; role: string }>('message', thread.id).filter(m => m.role === 'user');
      const original = users[0];
      const receipt = await service.command({ id: 'edit-1', threadId: thread.id, type: 'message.editRerun', payload: { messageId: original.id, expectedRevision: 0, content: 'REVISED_PROMPT' } });
      const result = receipt.result as { turnId: string; versionId: string; messageId: string; inputId: string };
      expect(result).toMatchObject({ turnId: original.id, inputId: 'edit-1' });
      await vi.waitFor(() => expect(store.get<{ status: string }>('outbox', 'edit-1')?.status).toBe('handled'), { timeout: 15000, interval: 50 });
      const turn = store.get<any>('turn', original.id);
      expect(turn).toMatchObject({ revision: 1, generationId: expect.stringMatching(/^g[0-9a-f]{16}$/) });
      const versions = store.all<any>('turnVersion', thread.id).filter(v => v.turnId === original.id);
      expect(versions.map(v => [v.version, v.status])).toEqual([[1, 'superseded'], [2, 'active']]);
      const updated = store.get<Thread>('thread', thread.id)!;
      expect(updated.sessionGeneration).toBe(turn.generationId);
      expect(updated.sessionPath).toBe(join(dir, 'hermes', 'sessions', 'gen-' + turn.generationId + '.json'));
      const rerun = prompts[prompts.length - 1];
      expect(rerun.sessionGeneration).toBe(turn.generationId);
      expect(rerun.sessionPath).toBe(updated.sessionPath);
      expect(rerun.prompt).toContain('REVISED_PROMPT');
      expect(rerun.prompt).not.toContain('ORIGINAL_PROMPT');
      // Idempotent retry returns the same receipt.
      const again = await service.command({ id: 'edit-1', threadId: thread.id, type: 'message.editRerun', payload: { messageId: original.id, expectedRevision: 0, content: 'REVISED_PROMPT' } });
      expect((again.result as { messageId: string }).messageId).toBe(result.messageId);
      // Negative: stale revision, unknown keys, non-newest prompt, unchanged content.
      const active = store.all<any>('turnVersion', thread.id).find(v => v.status === 'active');
      await expect(service.command({ id: 'edit-2', threadId: thread.id, type: 'message.editRerun', payload: { messageId: active.messageId, expectedRevision: 0, content: 'X' } })).rejects.toMatchObject({ code: 'STALE_REVISION' });
      await expect(service.command({ id: 'edit-3', threadId: thread.id, type: 'message.editRerun', payload: { messageId: active.messageId, expectedRevision: 1, content: 'Y', extra: 1 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(service.command({ id: 'edit-4', threadId: thread.id, type: 'message.editRerun', payload: { messageId: original.id, expectedRevision: 1, content: 'Z' } })).rejects.toMatchObject({ code: 'EDIT_UNAVAILABLE' });
      await expect(service.command({ id: 'edit-5', threadId: thread.id, type: 'message.editRerun', payload: { messageId: active.messageId, expectedRevision: 1, content: 'REVISED_PROMPT' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(service.command({ id: 'edit-6', threadId: thread.id, type: 'message.editRerun', payload: { messageId: active.messageId, expectedRevision: 1, content: '   ' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      // Second edit: revision advances, previous active superseded.
      await service.command({ id: 'edit-7', threadId: thread.id, type: 'message.editRerun', payload: { messageId: active.messageId, expectedRevision: 1, content: 'REVISED_V2' } });
      await vi.waitFor(() => expect(store.get<{ status: string }>('outbox', 'edit-7')?.status).toBe('handled'), { timeout: 15000, interval: 50 });
      const versions2 = store.all<any>('turnVersion', thread.id).filter(v => v.turnId === original.id);
      expect(versions2.map(v => [v.version, v.status])).toEqual([[1, 'superseded'], [2, 'superseded'], [3, 'active']]);
      expect(store.get<Thread>('thread', thread.id)!.sessionGeneration).not.toBe(turn.generationId);
      expect(prompts[prompts.length - 1].prompt).toContain('REVISED_V2');
      // T03 projection: superseded versions are absent from transcript reads…
      const superseded = store.supersededMessageIds(thread.id);
      expect(superseded.size).toBe(2);
      const visible = store.messagesFor(thread.id).messages;
      expect(visible.filter(m => superseded.has(m.id))).toHaveLength(0);
      expect(store.snapshot().messages.some(m => superseded.has(m.id))).toBe(false);
      // …but explicitly readable through the scoped turn-disclosure model.
      const reads = new ConversationReadModels(store);
      const context = reads.context({authority: 'personal', threadId: thread.id});
      const disclosed = reads.turns({authority: 'personal', threadId: thread.id, scopeKey: (context as {scopeKey: string}).scopeKey});
      expect(disclosed.turns).toHaveLength(1);
      expect(disclosed.turns[0].versions.map(v => [v.version, v.status, v.content])).toEqual([[1, 'superseded', 'ORIGINAL_PROMPT'], [2, 'superseded', 'REVISED_PROMPT'], [3, 'active', 'REVISED_V2']]);
      expect(disclosed.turns[0].versions[0].reply).toBe('R');
      reads.dispose();
    } finally {
      await service.dispose(); store.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 60000);
});
