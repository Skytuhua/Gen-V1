import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HarnessError, type Message, type TaskMemory, type Thread } from '../packages/contracts/index.ts';
import { Store } from '../packages/storage/store.ts';
import { MEMORY_LIMITS, changeTaskMemory, taskMemories, taskMemoryContext } from '../packages/core/task-memory.ts';
import { EffectAdmissionPolicy } from '../packages/core/effect-admission-policy.ts';
import { SKILL_LEARNING_POLICY, learningReviewPrompt, searchSessions } from '../packages/core/learning-context.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const fn of cleanups.splice(0)) fn(); });
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-helpers-'));
  const store = new Store(dir);
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const write = (type: string, apply: () => unknown) => store.internal(type, 'thread-a', apply);
  return { store, write };
};
const code = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return (error as HarnessError).code; } };

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 'thread-a', title: 'Task', projectName: null, createdAt: 't', updatedAt: 't',
  status: 'ready', epoch: 1, runId: null, modelId: null, sessionPath: null, ...over,
});
const message = (id: string, content: string, role: Message['role'] = 'user', threadId = 'thread-a'): Message =>
  ({ id, threadId, role, content, createdAt: 't', runId: null });

describe('task memory', () => {
  it('saves, reads and contexts notes sorted by key', () => {
    const { store, write } = fixture();
    write('fixture', () => {
      changeTaskMemory(store, 'thread-a', 'save', { key: 'b', content: 'B note', baseRevision: 0 }, 'agent');
      changeTaskMemory(store, 'thread-a', 'save', { key: 'a', content: 'A note', baseRevision: 0 }, 'user');
    });
    expect(taskMemories(store, 'thread-a').map(note => note.key)).toEqual(['a', 'b']);
    const context = JSON.parse(taskMemoryContext(store, 'thread-a')!);
    expect(context).toEqual([{ key: 'a', content: 'A note' }, { key: 'b', content: 'B note' }]);
  });
  it('returns undefined context for a thread without notes', () => {
    expect(taskMemoryContext(fixture().store, 'empty')).toBeUndefined();
  });
  it('rejects invalid keys', () => {
    const { store, write } = fixture();
    for (const key of ['', ' spaces', 'with space', 'x'.repeat(65), '.dot', 5, null]) {
      write('t', () => { expect(code(() => changeTaskMemory(store, 'thread-a', 'save', { key, content: 'c', baseRevision: 0 }, 'agent'))).toBe('INVALID_MEMORY'); });
    }
    expect(code(() => write('t', () => changeTaskMemory(store, 'thread-a', 'save', { key: 'ok-key.1_x', content: 'c', baseRevision: 0 }, 'agent')))).toBe(null);
  });
  it('enforces optimistic concurrency via baseRevision', () => {
    const { store, write } = fixture();
    write('t', () => changeTaskMemory(store, 'thread-a', 'save', { key: 'k', content: 'v1', baseRevision: 0 }, 'agent'));
    expect(code(() => write('t', () => changeTaskMemory(store, 'thread-a', 'save', { key: 'k', content: 'v2', baseRevision: 0 }, 'agent')))).toBe('STALE_MEMORY');
    write('t', () => { expect((changeTaskMemory(store, 'thread-a', 'save', { key: 'k', content: 'v2', baseRevision: 1 }, 'agent') as TaskMemory).revision).toBe(2); });
  });
  it('deletes notes and preserves their revision numbering', () => {
    const { store, write } = fixture();
    write('t', () => changeTaskMemory(store, 'thread-a', 'save', { key: 'k', content: 'v1', baseRevision: 0 }, 'agent'));
    expect(code(() => write('t', () => changeTaskMemory(store, 'thread-a', 'delete', { key: 'k', baseRevision: 0 }, 'agent')))).toBe('STALE_MEMORY');
    write('t', () => { expect(changeTaskMemory(store, 'thread-a', 'delete', { key: 'k', baseRevision: 1 }, 'agent')).toEqual({ deleted: true }); });
    expect(taskMemories(store, 'thread-a')).toEqual([]);
    expect(code(() => write('t', () => changeTaskMemory(store, 'thread-a', 'delete', { key: 'k', baseRevision: 1 }, 'agent')))).toBe('NOT_FOUND');
    // A re-created note counts as new (baseRevision 0) but keeps the deleted
    // note's revision counter instead of restarting at 1.
    write('t', () => { expect((changeTaskMemory(store, 'thread-a', 'save', { key: 'k', content: 'back', baseRevision: 0 }, 'agent') as TaskMemory).revision).toBe(2); });
  });
  it('rejects empty, oversized or secret-looking content', () => {
    const { store, write } = fixture();
    for (const content of ['', '   ', 'x'.repeat(MEMORY_LIMITS.entryBytes + 1), 'use sk-' + 'a'.repeat(21), '-----BEGIN PRIVATE KEY-----']) {
      write('t', () => { expect(code(() => changeTaskMemory(store, 'thread-a', 'save', { key: 'k', content, baseRevision: 0 }, 'agent'))).toBe('INVALID_MEMORY'); });
    }
    write('t', () => { expect((changeTaskMemory(store, 'thread-a', 'save', { key: 'k', content: 'x'.repeat(MEMORY_LIMITS.entryBytes), baseRevision: 0 }, 'agent') as TaskMemory).key).toBe('k'); });
  });
  it('bounds the entry count and total byte budget', () => {
    const { store, write } = fixture();
    write('t', () => {
      for (let i = 0; i < MEMORY_LIMITS.entries; i++) changeTaskMemory(store, 'thread-a', 'save', { key: 'k' + String(i).padStart(2, '0'), content: 'x', baseRevision: 0 }, 'agent');
      expect(code(() => changeTaskMemory(store, 'thread-a', 'save', { key: 'extra', content: 'x', baseRevision: 0 }, 'agent'))).toBe('MEMORY_FULL');
    });
    const { store: store2, write: write2 } = fixture();
    write2('t', () => {
      for (let i = 0; i < 5; i++) changeTaskMemory(store2, 'thread-a', 'save', { key: 'big' + i, content: 'x'.repeat(760), baseRevision: 0 }, 'agent');
      expect(code(() => changeTaskMemory(store2, 'thread-a', 'save', { key: 'big5', content: 'x'.repeat(760), baseRevision: 0 }, 'agent'))).toBe('MEMORY_FULL');
    });
  });
  it('scopes notes per thread', () => {
    const { store, write } = fixture();
    write('t', () => {
      changeTaskMemory(store, 'thread-a', 'save', { key: 'k', content: 'A', baseRevision: 0 }, 'agent');
      changeTaskMemory(store, 'thread-b', 'save', { key: 'k', content: 'B', baseRevision: 0 }, 'agent');
    });
    expect(taskMemories(store, 'thread-a')[0]!.content).toBe('A');
    expect(taskMemories(store, 'thread-b')[0]!.content).toBe('B');
  });
});

const flags = (on: string[] = []) => ({ enabled: (key: 'audit.effectsV1' | 'security.authorityV1') => on.includes(key) });

describe('EffectAdmissionPolicy', () => {
  const put = (store: Store, kind: string, id: string, body: unknown) =>
    store.internal('fixture', null, () => store.put(kind, id, null, body));
  it('admits a fresh profile with no flags and nothing persisted', () => {
    const { store } = fixture();
    const policy = new EffectAdmissionPolicy(store, flags());
    expect(policy.disabled).toBe(false);
    expect(() => policy.assertEnabled()).not.toThrow();
  });
  it('adopts AUDIT mode from the effects flag and persists it', () => {
    const { store } = fixture();
    new EffectAdmissionPolicy(store, flags(['audit.effectsV1']));
    expect(store.get('toolEffectAdmissionPolicy', 'global')).toEqual({ version: 1, mode: 'AUDIT' });
    expect(new EffectAdmissionPolicy(store, flags(['audit.effectsV1'])).disabled).toBe(false);
  });
  it('keeps a persisted AUDIT requirement denied when all flags are off', () => {
    const { store } = fixture();
    put(store, 'toolEffectAdmissionPolicy', 'global', { version: 1, mode: 'AUDIT' });
    const policy = new EffectAdmissionPolicy(store, flags());
    expect(policy.disabled).toBe(true);
    expect(code(() => policy.assertEnabled())).toBe('EFFECT_ADMISSIONS_DISABLED');
  });
  it('adopts AUTHENTICATED from a prior approval even without flags', () => {
    const { store } = fixture();
    put(store, 'approval', 'a1', { id: 'a1' });
    const policy = new EffectAdmissionPolicy(store, flags());
    expect(policy.disabled).toBe(true);
  });
  it('adopts AUDIT history from retained tool effects', () => {
    const { store } = fixture();
    put(store, 'toolEffect', 'e1', { id: 'e1' });
    expect(new EffectAdmissionPolicy(store, flags()).disabled).toBe(true);
    expect(new EffectAdmissionPolicy(store, flags(['audit.effectsV1'])).disabled).toBe(false);
    // Seeing the authenticated flag latches AUTHENTICATED and persists it.
    expect(new EffectAdmissionPolicy(store, flags(['security.authorityV1'])).disabled).toBe(false);
    expect(store.get('toolEffectAdmissionPolicy', 'global')).toEqual({ version: 1, mode: 'AUTHENTICATED' });
    // After the latch, AUDIT-only flags cannot demote the required mode.
    expect(new EffectAdmissionPolicy(store, flags(['audit.effectsV1'])).disabled).toBe(true);
  });
  it('treats an authority-flagged profile as authenticated', () => {
    const { store } = fixture();
    expect(new EffectAdmissionPolicy(store, flags(['security.authorityV1'])).disabled).toBe(false);
    expect(store.get('toolEffectAdmissionPolicy', 'global')).toEqual({ version: 1, mode: 'AUTHENTICATED' });
  });
  it('marks malformed stored policy as disabled without corrupting the store', () => {
    const { store } = fixture();
    put(store, 'toolEffectAdmissionPolicy', 'global', { version: 9, mode: 'LEGACY' });
    expect(new EffectAdmissionPolicy(store, flags(['security.authorityV1'])).disabled).toBe(true);
    store.db.prepare("UPDATE entities SET body='not json' WHERE kind='toolEffectAdmissionPolicy'").run();
    expect(new EffectAdmissionPolicy(store, flags()).disabled).toBe(true);
  });
});

describe('searchSessions', () => {
  const seed = (store: Store, write: (t: string, fn: () => unknown) => unknown) =>
    write('fixture', () => {
      store.put('message', 'm1', 'thread-a', message('m1', 'the quick brown fox', 'user'));
      store.put('message', 'm2', 'thread-a', message('m2', 'lazy DOG fox', 'assistant'));
      store.put('message', 'm3', 'thread-a', message('m3', 'nothing here', 'activity'));
      store.put('message', 'm4', 'thread-b', message('m4', 'fox on thread-b', 'user', 'thread-b'));
    });
  it('finds matches across threads, case-insensitively, newest first', () => {
    const { store, write } = fixture();
    seed(store, write);
    const result = searchSessions(store, { query: 'FOX' });
    expect(result.matches.map(row => row.messageId)).toEqual(['m4', 'm2', 'm1']);
    expect(result.matches[0]!.threadId).toBe('thread-b');
    expect(result.authority).toContain('untrusted');
  });
  it('honors the limit and defaults to 5', () => {
    const { store, write } = fixture();
    seed(store, write);
    expect(searchSessions(store, { query: 'fox', limit: 2 }).matches).toHaveLength(2);
    expect(searchSessions(store, { query: 'fox', limit: 10 }).matches).toHaveLength(3);
  });
  it.each([{}, { query: '' }, { query: '   ' }, { query: 'x'.repeat(513) }, { query: 'ok', limit: 0 }, { query: 'ok', limit: 11 }, { query: 'ok', limit: 2.5 }, { query: 'ok', limit: 'x' }, { query: 5 }])('rejects invalid args %j', args => {
    const { store } = fixture();
    expect(code(() => searchSessions(store, args))).toBe('INVALID_INPUT');
  });
  it('treats LIKE metacharacters literally', () => {
    const { store, write } = fixture();
    write('t', () => store.put('message', 'm1', 'thread-a', message('m1', '100% done (really)', 'user')));
    expect(searchSessions(store, { query: '100%_' }).matches).toEqual([]);
    expect(searchSessions(store, { query: '100% done' }).matches).toHaveLength(1);
    expect(searchSessions(store, { query: '100\\' }).matches).toEqual([]);
  });
  it('redacts credential patterns from matched content', () => {
    const { store, write } = fixture();
    const secret = 'sk-' + 'a'.repeat(25);
    write('t', () => store.put('message', 'm1', 'thread-a', message('m1', 'token ' + secret + ' thanks', 'user')));
    const row = searchSessions(store, { query: 'token' }).matches[0]!;
    expect(row.content).not.toContain(secret);
    expect(row.content).toContain('[redacted credential]');
  });
  it('returns an empty match list for absent terms', () => {
    const { store, write } = fixture();
    seed(store, write);
    expect(searchSessions(store, { query: 'zebra' }).matches).toEqual([]);
  });
});

describe('learningReviewPrompt', () => {
  it('quotes recent messages and operations with redaction', () => {
    const { store, write } = fixture();
    write('t', () => {
      store.put('message', 'm1', 'thread-a', message('m1', 'first question', 'user'));
      store.put('message', 'm2', 'thread-a', message('m2', 'an answer with sk-' + 'b'.repeat(25), 'assistant'));
      store.put('message', 'm3', 'thread-a', message('m3', 'heartbeat', 'activity'));
      store.put('operation', 'o1', 'thread-a', { id: 'o1', kind: 'write', status: 'succeeded', description: 'wrote a file' });
    });
    const prompt = learningReviewPrompt(store, thread(), { threadId: 'thread-a', runId: 'run-a', epoch: 1 }, 'INDEX-TEXT');
    expect(prompt).toContain(SKILL_LEARNING_POLICY);
    expect(prompt).toContain('INDEX-TEXT');
    expect(prompt).toContain('first question');
    expect(prompt).toContain('wrote a file');
    expect(prompt).not.toContain('heartbeat');
    expect(prompt).not.toContain('sk-' + 'b'.repeat(25));
    expect(prompt).toContain('[redacted credential]');
  });
  it('drops oldest messages until the packet fits the byte budget', () => {
    const { store, write } = fixture();
    write('t', () => {
      for (let i = 0; i < 20; i++) store.put('message', 'm' + i, 'thread-a', message('m' + i, 'x'.repeat(3900) + i, i % 2 ? 'assistant' : 'user'));
    });
    const prompt = learningReviewPrompt(store, thread(), { threadId: 'thread-a', runId: 'r', epoch: 1 }, '');
    expect(Buffer.byteLength(prompt)).toBeLessThan(50 * 1024);
    // The most recent messages survive truncation; the oldest were dropped.
    expect(prompt).toContain('x'.repeat(3900) + '19');
    expect(prompt).not.toContain('x'.repeat(3900) + '0');
  });
  it('handles a thread with no messages', () => {
    const { store } = fixture();
    const prompt = learningReviewPrompt(store, thread(), { threadId: 'thread-a', runId: 'r', epoch: 1 }, 'idx');
    expect(prompt).toContain('idx');
    expect(prompt).toContain('"messages":[]');
  });
});
