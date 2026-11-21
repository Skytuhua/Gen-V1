import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, appendFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { createHermesRuntime, type HermesEngine } from '../packages/runtime-hermes/index.ts';
import type { RuntimeAdapter, RuntimeCallbacks, Thread } from '../packages/contracts/index.ts';
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


// Portable custody proof — no worker required: captureTurnCut and
// hydrateSessionGeneration are pure host file-custody operations over the
// sealed session file.
it('captures an immutable cut and hydrates an isolated generation (portable host custody)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hermes-cut-portable-'));
  const sessions = join(directory, 'hermes', 'sessions');
  const legacyPath = join(sessions, sha('thread-1') + '.json');
  await import('node:fs/promises').then(fs => fs.mkdir(sessions, { recursive: true }));
  const { writeFile } = await import('node:fs/promises');
  const turnOne = session({ ownership: { threadId: 'thread-1', accountId: null, sessionPath: legacyPath, sourceCommit: COMMIT } });
  await writeFile(legacyPath, JSON.stringify(turnOne));
  const runtime = createHermesRuntime({ dataDir: directory, nativeCatalog: undefined, skillPolicy: { enabled: false } }) as HermesEngine;
  try {
    const cut = await runtime.captureTurnCut!(legacyPath);
    expect(cut.cutId).toBe(turnCutId(JSON.stringify(turnOne)));
    expect(cut.path).toBe(legacyPath.slice(0, -5) + '.cut-' + cut.cutId + '.json');
    expect(await readFile(cut.path, 'utf8')).toBe(JSON.stringify(turnOne));
    // The legacy conversation keeps writing after the cut exists (turn two).
    const turnTwo = { ...turnOne, messages: [...turnOne.messages, { role: 'user', content: 'SUPERSEDED_SENTINEL' }] };
    await writeFile(legacyPath, JSON.stringify(turnTwo));
    // Second capture addresses new content; the first cut stays immutable.
    const cut2 = await runtime.captureTurnCut!(legacyPath);
    expect(cut2.cutId).not.toBe(cut.cutId);
    expect(await readFile(cut.path, 'utf8')).toBe(JSON.stringify(turnOne));
    // Hydrate generation: only the pre-turn-two prefix is present.
    const generation = 'g00000000000000aa';
    const input = { threadId: 'thread-1', runId: 'rerun', epoch: 2, prompt: '', modelId: 'openai/x', sessionPath: null, accountId: null, inputId: 'i', resources: [], sessionGeneration: generation };
    const genPath = await runtime.hydrateSessionGeneration!(cut.path, input as never);
    expect(genPath).toBe(join(sessions, sha('thread-1:' + generation) + '.json'));
    const saved = JSON.parse(await readFile(genPath, 'utf8'));
    expect(saved.ownership).toEqual({ threadId: 'thread-1', accountId: null, sessionPath: genPath, sourceCommit: COMMIT, sessionGeneration: generation });
    expect(JSON.stringify(saved.messages)).toContain('first');
    expect(JSON.stringify(saved.messages)).not.toContain('SUPERSEDED_SENTINEL');
    // Negative: corrupt cut, cross-owner hydrate, non-cut path, missing cut, bad generation all rejected.
    const otherPath = join(sessions, sha('thread-2') + '.json');
    await writeFile(otherPath, JSON.stringify(session({ ownership: { threadId: 'thread-2', accountId: null, sessionPath: otherPath, sourceCommit: COMMIT } })));
    const otherCut = await runtime.captureTurnCut!(otherPath);
    await appendFile(cut.path, 'tamper');
    await expect(runtime.hydrateSessionGeneration!(cut.path, { ...input, sessionGeneration: 'g00000000000000cc' } as never)).rejects.toThrow(/stale or corrupt/);
    await expect(runtime.hydrateSessionGeneration!(otherCut.path, { ...input, sessionGeneration: 'g00000000000000bb' } as never)).rejects.toThrow(/another thread or account/);
    await expect(runtime.hydrateSessionGeneration!(legacyPath, { ...input, sessionGeneration: 'g00000000000000bb' } as never)).rejects.toThrow(/app-owned turn cut/);
    await expect(runtime.hydrateSessionGeneration!(join(sessions, 'missing.cut-c0000000000000dd.json'), input as never)).rejects.toThrow();
    await expect(runtime.hydrateSessionGeneration!(otherCut.path, { ...input, sessionGeneration: 'bad-gen' } as never)).rejects.toThrow();
  } finally {
    await runtime.dispose(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);

// Full worker custody: a captured multi-turn conversation through the real
// Python worker and broker. Native host custody is exercised by Windows CI;
// Linux has no guard fallback (linux-path-guard denies the boundary).
it.skipIf(process.platform !== 'win32')('cut+generation custody through the real Hermes worker and broker (#1532 T01)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hermes-turn-cut-'));
  const store = new Store(directory);
  const prompts: string[] = [];
  const events: string[] = [];
  const native = (): RuntimeAdapter => { let callbacks!: RuntimeCallbacks; return {
    configure: value => { callbacks = value; },
    models: async () => [{ id: 'openai/source-proof', provider: 'openai', name: 'Scripted native transport' }],
    start: async input => {
      prompts.push(input.prompt);
      callbacks.onEvent({ ...input, type: 'input.processing', inputIds: input.inputIds ?? [input.inputId] });
      callbacks.onEvent({ ...input, type: 'assistant.message', content: 'SCRIPTED_REPLY_' + prompts.length });
      callbacks.onEvent({ ...input, type: 'usage', usage: { inputTokens: 10, outputTokens: 5, contextTokens: 15, contextWindow: 200000, cost: null } });
      callbacks.onEvent({ ...input, type: 'settled' });
    },
    followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {},
  }; };
  const runtime = createHermesRuntime({ dataDir: directory, nativeCatalog: native(), skillPolicy: { enabled: false }, onSourceEvent: event => events.push(event.event) }, { createNativeRuntime: () => native() }) as HermesEngine;
  const service = new Service(store, runtime);
  const sessions = join(directory, 'hermes', 'sessions');
  let thread!: Thread;
  const send = async (id: string, content: string) => {
    await service.command({ id, threadId: thread.id, type: 'message.send', payload: { content, modelId: 'openai/source-proof' } });
    await vi.waitFor(() => expect(store.get<{ status: string }>('outbox', id)?.status).toBe('handled'), { timeout: 120000, interval: 200 });
  };
  try {
    await service.recover();
    thread = (await service.command({ id: crypto.randomUUID(), type: 'thread.create', payload: {} })).result as Thread;
    await send('cut-turn-one', 'TURN_ONE_SENTINEL');
    const legacyPath = join(sessions, sha(thread.id) + '.json');
    await access(legacyPath);
    const cut = await runtime.captureTurnCut!(legacyPath);
    expect(cut.cutId).toMatch(/^c[0-9a-f]{16}$/);
    // Legacy ordinary start still valid after the cut exists.
    await send('cut-turn-two', 'SUPERSEDED_SENTINEL');
    const generation = 'g00000000000000aa';
    const genInput = { threadId: thread.id, runId: 'rerun-run-1', epoch: 9, prompt: '', modelId: 'openai/source-proof', sessionPath: null, accountId: null, inputId: 'gen-input', resources: [], sessionGeneration: generation };
    const genPath = await runtime.hydrateSessionGeneration!(cut.path, genInput as never);
    expect(genPath).toBe(join(sessions, sha(thread.id + ':' + generation) + '.json'));
    const before = prompts.length;
    await runtime.start({ ...genInput, prompt: 'REVISED_SENTINEL', inputId: 'gen-rerun-1', inputIds: ['gen-rerun-1'], sessionPath: genPath, resources: [] } as never);
    await vi.waitFor(() => expect(prompts.length).toBeGreaterThan(before), { timeout: 120000, interval: 200 });
    const finalRequest = prompts[prompts.length - 1];
    expect(finalRequest).toContain('TURN_ONE_SENTINEL');
    expect(finalRequest.match(/REVISED_SENTINEL/g)).toHaveLength(1);
    expect(finalRequest).not.toContain('SUPERSEDED_SENTINEL');
    expect(finalRequest).not.toContain('SCRIPTED_REPLY_2'); // superseded reply marker zero times
    // Generation sidecar is isolated from the legacy one.
    await vi.waitFor(() => expect(readFile(genPath + '.inputs.jsonl', 'utf8').then(t => t.includes('gen-rerun-1'))).resolves.toBe(true), { timeout: 30000, interval: 200 });
    const legacyReceipts = await readFile(legacyPath + '.inputs.jsonl', 'utf8');
    expect(legacyReceipts).toContain('cut-turn-two');
    expect(legacyReceipts).not.toContain('gen-rerun-1');
    // Negative: a generation file must not be readable as a legacy session.
    await expect(runtime.start({ ...genInput, sessionGeneration: undefined, sessionPath: genPath, prompt: 'p', inputId: 'nope-1', inputIds: ['nope-1'], resources: [] } as never)).rejects.toThrow(/native session|different task|session/);
  } finally {
    await service.dispose(); store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 300000);
