import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service, type ServiceOptions } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { HarnessError, type Message, type RuntimeAdapter, type Thread } from '../packages/contracts/index.ts';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags.ts';
import {
  M14_ADAPTER_CAPABILITIES, SessionBranchReadModels, adapterForkCapability,
} from '../packages/core/session-branches.ts';
import type { SessionBranchV1 } from '../packages/contracts/session-branch.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  __setCapabilityFlagForTests('sessions.branchV1', undefined);
  __setCapabilityFlagForTests('sessions.inertImportV1', undefined);
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0)) await close();
});

async function fixture(options: ServiceOptions = {}) {
  const base = mkdtempSync(join(tmpdir(), 'm14-branch-')), store = new Store(join(base, 'profile'));
  const runtime: RuntimeAdapter = {
    configure() {}, models: vi.fn(async () => []),
    start: vi.fn(async () => {}), followUp: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    compact: vi.fn(async () => {}), history: vi.fn(async () => []), dispose: vi.fn(async () => {}),
  };
  const service = new Service(store, runtime, options);
  const reads = new SessionBranchReadModels(store);
  const send = (type: string, payload: Record<string, unknown> = {}, threadId?: string, id: string = crypto.randomUUID()) =>
    service.command({ id, type, threadId, payload });
  const create = async (payload: Record<string, unknown> = {}) => (await send('thread.create', payload)).result as Thread;
  const thread = await create();
  const message = (id: string, content: string, threadId = thread.id, role: Message['role'] = 'assistant') =>
    store.internal('fixture.message', threadId, () => store.put('message', id, threadId, { id, threadId, role, content, createdAt: new Date().toISOString(), runId: null }));
  cleanups.push(async () => { await service.dispose(); store.close(); rmSync(base, { recursive: true, force: true }); });
  return { base, store, runtime, service, reads, thread, send, create, message };
}

const throwsHarness = (work: () => unknown): HarnessError => {
  try { work(); } catch (e) { expect(e).toBeInstanceOf(HarnessError); return e as HarnessError; }
  return expect.unreachable('expected a HarnessError') as never;
};
const rejectsHarness = async (work: Promise<unknown>): Promise<HarnessError> => {
  try { await work; } catch (e) { expect(e).toBeInstanceOf(HarnessError); return e as HarnessError; }
  return expect.unreachable('expected a HarnessError') as never;
};

describe('adapter capability matrix', () => {
  it('reports receipt history without claiming a tested native fork anywhere', () => {
    expect(M14_ADAPTER_CAPABILITIES.length).toBeGreaterThan(0);
    for (const entry of M14_ADAPTER_CAPABILITIES) {
      expect(entry.receiptHistory).toBe(true);
      expect(entry.fixedCutInspect).toBe('UNSUPPORTED');
      expect(entry.nativeFork).toBe('UNPROVEN');
    }
    expect(adapterForkCapability()).toBe('UNPROVEN');
  });
});

describe('Inspect point — immutable fixed cut', () => {
  it('captures an owner-bound frozen view that new events never move', async () => {
    __setCapabilityFlagForTests('sessions.branchV1', true);
    const f = await fixture();
    const other = await f.create();
    f.message('m1', 'first'); f.message('m2', 'second');
    f.message('foreign', 'other thread content', other.id);
    const result = (await f.send('session.branch', { intent: 'INSPECT' }, f.thread.id)).result as { capture: { captureId: string } };
    f.message('m3', 'arrived after the cut');
    f.store.internal('fixture.mutate', f.thread.id, () => f.store.put('message', 'm1', f.thread.id, { id: 'm1', threadId: f.thread.id, role: 'assistant', content: 'rewritten after capture', createdAt: 'x', runId: null }));
    const page = f.reads.captureMessages(result.capture.captureId, { limit: 10 });
    expect(page.messages.map(item => item.id)).toEqual(['m1', 'm2']);
    expect(page.messages[0]!.content).toBe('first');
    expect(page.snapshotUpperSequence).toBeLessThan(f.store.sequence);
    // Paging while newer events keep arriving preserves the same fixed rows.
    f.message('m4', 'still later');
    expect(f.reads.captureMessages(result.capture.captureId, { limit: 10 }).messages.map(item => item.id)).toEqual(['m1', 'm2']);
    // No cross-thread records: the foreign message never enters the capture.
    expect(f.reads.captureMessages(result.capture.captureId).messages.some(item => item.content === 'other thread content')).toBe(false);
  });
  it('records explicit incomplete coverage for a truncated capture', async () => {
    __setCapabilityFlagForTests('sessions.branchV1', true);
    const f = await fixture();
    for (let index = 0; index < 505; index++) f.message(`m${index}`, `content ${index}`);
    const result = (await f.send('session.branch', { intent: 'INSPECT' }, f.thread.id)).result as { capture: { captureId: string; coverage: string; truncated: number; incompleteSource: string[] } };
    expect(result.capture.coverage).toBe('TRUNCATED');
    expect(result.capture.truncated).toBeGreaterThan(0);
    expect(result.capture.incompleteSource).toContain('TRUNCATED_HISTORY');
    expect(result.capture.incompleteSource).toContain('ATTACHMENTS_NOT_CAPTURED');
  });
  it('fences capture reads to the recorded owner — revocation and removal stay unavailable', async () => {
    __setCapabilityFlagForTests('sessions.branchV1', true);
    const f = await fixture();
    f.store.internal('fixture.owner', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, { ...f.thread, accountId: 'acct-1' }));
    f.store.internal('fixture.account', null, () => f.store.put('account', 'acct-1', null, { id: 'acct-1' }));
    f.message('m1', 'owned content');
    const result = (await f.send('session.branch', { intent: 'INSPECT' }, f.thread.id)).result as { capture: { captureId: string } };
    f.store.internal('fixture.revoke', f.thread.id, () => {
      f.store.put('thread', f.thread.id, f.thread.id, { ...f.store.get<Thread>('thread', f.thread.id)!, accountId: 'other-account' });
    });
    expect(throwsHarness(() => f.reads.captureMessages(result.capture.captureId)).code).toBe('CAPABILITY_DENIED');
    f.store.internal('fixture.restore', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, { ...f.store.get<Thread>('thread', f.thread.id)!, accountId: 'acct-1' }));
    expect(f.reads.captureMessages(result.capture.captureId).messages).toHaveLength(1);
    f.store.internal('fixture.remove', f.thread.id, () => f.store.remove('thread', f.thread.id));
    expect(throwsHarness(() => f.reads.captureMessages(result.capture.captureId)).code).toBe('CAPABILITY_DENIED');
  });
  it('denies Inspect and every branch command while sessions.branchV1 is off', async () => {
    const f = await fixture();
    expect((await rejectsHarness(f.send('session.branch', { intent: 'INSPECT' }, f.thread.id))).code).toBe('CAPABILITY_DENIED');
    expect(f.store.all('sessionCapture', f.thread.id)).toEqual([]);
  });
});

describe('START_NEW_WITH_QUOTE — an explicitly labeled new task', () => {
  it('creates a fresh main thread with lineage and real quoted excerpts', async () => {
    __setCapabilityFlagForTests('sessions.branchV1', true);
    const f = await fixture();
    f.message('q1', 'the quoted source text', f.thread.id, 'user');
    f.message('q2', 'an assistant answer', f.thread.id, 'assistant');
    const result = (await f.send('session.branch', { intent: 'START_NEW_WITH_QUOTE', quoteMessageIds: ['q1', 'q2'], title: 'Follow-up investigation' }, f.thread.id)).result as {
      intent: string; branch: SessionBranchV1; thread: Thread;
    };
    expect(result.intent).toBe('START_NEW_WITH_QUOTE');
    const child = result.thread;
    expect(child.id).not.toBe(f.thread.id);
    expect(child.kind ?? 'main').toBe('main');
    expect(child).toMatchObject({ epoch: 0, runId: null, status: 'ready', sessionPath: null, title: 'Follow-up investigation' });
    expect(child.parentThreadId).toBeUndefined();
    expect(result.branch).toMatchObject({ intent: 'START_NEW_WITH_QUOTE', parentThreadId: f.thread.id, childThreadId: child.id });
    expect(result.branch.quote.excerpts).toEqual([
      { id: 'q1', role: 'user', excerpt: 'the quoted source text' },
      { id: 'q2', role: 'assistant', excerpt: 'an assistant answer' },
    ]);
    // Lineage is readable for the branch header; the source cut names the parent.
    const overview = f.reads.overview(child.id) as { branch: SessionBranchV1 | null };
    expect(overview.branch?.sourceCut.messageCount).toBe(2);
    expect(f.runtime.start).not.toHaveBeenCalled();
  });
  it('rejects quotes that are not part of the source thread', async () => {
    __setCapabilityFlagForTests('sessions.branchV1', true);
    const f = await fixture(), other = await f.create();
    f.message('mine', 'source', f.thread.id);
    f.store.internal('fixture.other', other.id, () => f.store.put('message', 'foreign', other.id, { id: 'foreign', threadId: other.id, role: 'user', content: 'other thread', createdAt: 'x', runId: null }));
    expect((await rejectsHarness(f.send('session.branch', { intent: 'START_NEW_WITH_QUOTE', quoteMessageIds: ['mine', 'foreign'] }, f.thread.id))).code).toBe('INVALID_INPUT');
    expect(f.store.all<SessionBranchV1>('sessionBranch')).toEqual([]);
    expect((await rejectsHarness(f.send('session.branch', { intent: 'START_NEW_WITH_QUOTE', quoteMessageIds: [] }, f.thread.id))).code).toBe('INVALID_INPUT');
  });
});

describe('FORK_CONVERSATION — unsupported without native proof', () => {
  it('never produces an apparent exact continuation', async () => {
    __setCapabilityFlagForTests('sessions.branchV1', true);
    const f = await fixture();
    f.message('m1', 'source');
    expect((await rejectsHarness(f.send('session.branch', { intent: 'FORK_CONVERSATION' }, f.thread.id))).code).toBe('FORK_UNSUPPORTED');
    expect(f.store.all('thread')).toHaveLength(1);
    expect(f.store.all('sessionBranch')).toEqual([]);
    expect(f.runtime.start).not.toHaveBeenCalled();
  });
  it('refuses account mismatch with the same unsupported outcome', async () => {
    __setCapabilityFlagForTests('sessions.branchV1', true);
    const f = await fixture();
    f.store.internal('fixture.owner', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, { ...f.thread, accountId: 'acct-source' }));
    expect((await rejectsHarness(f.send('session.branch', { intent: 'FORK_CONVERSATION', requestedModelBinding: { modelId: 'm', accountId: 'acct-other' } }, f.thread.id))).code).toBe('FORK_UNSUPPORTED');
    expect(f.store.all('thread')).toHaveLength(1);
  });
});

describe('branch and file authority', () => {
  it('never creates operations, grants, approvals or workspace changes', async () => {
    __setCapabilityFlagForTests('sessions.branchV1', true);
    const f = await fixture();
    f.message('q', 'quote me', f.thread.id, 'user');
    await f.send('session.branch', { intent: 'INSPECT' }, f.thread.id);
    await f.send('session.branch', { intent: 'START_NEW_WITH_QUOTE', quoteMessageIds: ['q'] }, f.thread.id);
    for (const kind of ['operation', 'resource', 'toolEffect', 'workspaceCheckpoint', 'checkpoint', 'editJournal', 'outbox'] as const)
      expect(f.store.all(kind, f.thread.id)).toEqual([]);
    expect(f.runtime.start).not.toHaveBeenCalled();
    expect(f.runtime.compact).not.toHaveBeenCalled();
  });
});
