import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hydrateGeneration, parseSessionFile, sessionFileName, turnCutId, validateSessionGeneration } from '../packages/runtime-hermes/turn-cut.ts';

const COMMIT = 'c627ec84664d43e0b18b95d9d86d8963747d56c7';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const session = (over: Record<string, unknown> = {}) => ({
  format: 'hermes-source-session-v1', sourceCommit: COMMIT,
  ownership: { threadId: 'thread-1', accountId: null, sessionPath: '/home/sessions/' + sha('thread-1') + '.json', sourceCommit: COMMIT },
  identity: '{"a":1}', sessionId: 'native-9', messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'reply' }],
  ...over,
});

describe('sessionFileName (parity with worker.py expected path)', () => {
  it('legacy sessions hash the bare threadId', () => {
    expect(sessionFileName({ threadId: 'thread-1' })).toBe(sha('thread-1') + '.json');
  });
  it('generations hash threadId + ":" + generation, matching the worker formula', () => {
    expect(sessionFileName({ threadId: 'thread-1', sessionGeneration: 'g00000000000000aa' })).toBe(sha('thread-1:g00000000000000aa') + '.json');
    expect(sessionFileName({ threadId: 'thread-1', sessionGeneration: null })).toBe(sha('thread-1') + '.json');
  });
  it('rejects malformed generation ids', () => {
    for (const g of ['', 'g', 'h00000000000000aa', 'g00000000000000AA', 'g00000000000000a', 'g00000000000000aab', '../x', 'g' + '0'.repeat(16) + ' '])
      expect(() => sessionFileName({ threadId: 't', sessionGeneration: g })).toThrow();
    expect(() => validateSessionGeneration('g00000000000000aa')).not.toThrow();
  });
});

describe('parseSessionFile', () => {
  it('accepts a sealed pinned session and rejects other formats, engines and corrupt bodies', () => {
    expect(parseSessionFile(session()).messages).toHaveLength(2);
    expect(() => parseSessionFile(session({ format: 'other' }))).toThrow();
    expect(() => parseSessionFile(session({ sourceCommit: 'f'.repeat(40) }))).toThrow();
    expect(() => parseSessionFile(session({ ownership: { ...session().ownership as object, sourceCommit: 'f'.repeat(40) } }))).toThrow();
    expect(() => parseSessionFile(session({ ownership: { ...session().ownership as object, sessionGeneration: 'bogus' } }))).toThrow();
    expect(() => parseSessionFile(session({ ownership: { ...session().ownership as object, threadId: '' } }))).toThrow();
    expect(() => parseSessionFile(session({ messages: 'nope' }))).toThrow();
    expect(() => parseSessionFile(null)).toThrow();
    expect(() => parseSessionFile(42)).toThrow();
  });
});

describe('hydrateGeneration', () => {
  it('rebinds ownership to the generation path, keeps messages, drops the native session id', () => {
    const cut = session();
    const genPath = '/home/sessions/' + sha('thread-1:g00000000000000aa') + '.json';
    const hydrated = hydrateGeneration(cut, genPath, 'g00000000000000aa');
    expect(hydrated.ownership).toEqual({ threadId: 'thread-1', accountId: null, sessionPath: genPath, sourceCommit: COMMIT, sessionGeneration: 'g00000000000000aa' });
    expect(hydrated.messages).toBe(cut.messages);
    expect(hydrated.sessionId).toBeNull();
    expect(hydrated.identity).toBe(cut.identity);
    expect(cut.ownership!.sessionPath).not.toBe(genPath); // cut never mutated
    expect(hydrated.ownership!.threadId).toBe('thread-1');
  });
  it('never produces a legacy-path hydration and validates the generation id', () => {
    expect(() => hydrateGeneration(session(), '/x', 'bad')).toThrow();
    expect(() => hydrateGeneration(session({ format: 'x' }), '/x', 'g00000000000000aa')).toThrow();
  });
});

describe('turnCutId', () => {
  it('is content-addressed c + sha256[:16]', () => {
    const text = JSON.stringify(session());
    expect(turnCutId(text)).toBe('c' + sha(text).slice(0, 16));
    expect(turnCutId('x')).toMatch(/^c[0-9a-f]{16}$/);
  });
});
