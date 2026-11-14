import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Thread, Message } from '../packages/contracts/index.ts';
import type { AgentJob, PlanRecord } from '../packages/contracts/planning.ts';
import { Store } from '../packages/storage/store.ts';
import { AgentProjection } from '../packages/agent-projection/index.ts';
import { inventoryUpdateDisposition } from '../packages/contracts/agent-inventory.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
const date = '2026-11-05T00:00:00.000Z';
function thread(id: string, extra: Partial<Thread> = {}): Thread {
  return { id, title: id, kind: 'main', projectName: null, createdAt: date, updatedAt: date,
    status: 'working', epoch: 1, runId: `run-${id}`, modelId: 'fixture/model', sessionPath: '/private/session', accountId: 'private-account', ...extra };
}
function job(id: string, status: AgentJob['status'] = 'working', extra: Partial<AgentJob> = {}): AgentJob {
  return { id, commandId: `command-${id}`, taskId: `task-${id}`, name: id, task: 'Inspect source', status,
    requirements: [], completedRequirementIds: [], reportedPercent: 100, createdAt: date, updatedAt: date, ...extra };
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-projection-')), store = new Store(dir);
  let projection: AgentProjection | undefined;
  cleanups.push(() => { projection?.dispose(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const putThread = (value: Thread) => store.internal('fixture.thread', value.id, () => store.put('thread', value.id, value.id, value));
  const putPlan = (parent: string, agents: AgentJob[]) => store.internal('agent.updated', parent, () => store.put('data', `plan:${parent}`, parent,
    { id: `plan:${parent}`, threadId: parent, provenance: 'harness:plan', revision: store.sequence + 1, createdAt: date,
      value: { version: 1, title: 'Plan', steps: [], agents } satisfies PlanRecord }));
  const putMessage = (parent: string, id: string, content: string, role: Message['role'] = 'assistant') => store.internal(role === 'activity' ? 'runtime.activity' : 'runtime.assistant.delta', parent, () => store.put('message', id, parent,
    { id, threadId: parent, content, role, createdAt: date, runId: `run-${parent}` } satisfies Message));
  return { store, putThread, putPlan, putMessage, open: () => projection ??= new AgentProjection(store) };
}

it('joins multiple personal projects, exact children and legacy jobs without inflating empty drafts or leaking host metadata', () => {
  const x = setup();
  x.store.internal('fixture.projects', null, () => {
    for (const id of ['p1', 'p2']) x.store.put('workspaceProject', id, null, { id, name: id, authority: { kind: 'local' }, rootPath: '/secret' });
    x.store.put('workspaceProject', 'company', null, { id: 'company', name: 'Secret Company', authority: { kind: 'plugin', pluginId: 'private', scopeId: 'owner' } });
  });
  for (const value of [thread('parent1', { projectId: 'p1', status: 'completed', runId: null }), thread('parent2', { projectId: 'p2' }),
    thread('draft', { status: 'ready', runId: null }), thread('side', { kind: 'side', sideParentId: 'parent1' }),
    thread('private', { projectId: 'company' }), thread('child', { kind: 'delegate', parentThreadId: 'parent1', jobId: 'live', projectId: 'p1' }),
    thread('wrong-child', { kind: 'delegate', parentThreadId: 'parent2', jobId: 'mismatch' })]) x.putThread(value);
  x.putPlan('parent1', [job('live', 'working', { childThreadId: 'child' }), job('legacy', 'queued'), job('mismatch', 'needs_review', { childThreadId: 'wrong-child' })]);
  const p = x.open(), page = p.inventory({});
  expect(page.items.map(a => a.title)).toEqual(['parent1', 'legacy', 'live', 'mismatch', 'parent2']);
  const child = page.items.find(a => a.jobId === 'live')!;
  expect(child).toMatchObject({ parentId: 'thread:parent1', rootId: 'thread:parent1', projectId: 'p1', threadId: 'child', status: 'working', reportedPercent: 100, readOnly: true });
  expect(page.items.find(a => a.jobId === 'legacy')).toMatchObject({ threadId: null, modelId: null, metadata: 'legacy_job' });
  expect(page.items.find(a => a.jobId === 'mismatch')).toMatchObject({ threadId: null, metadata: 'child_link_unavailable' });
  expect(JSON.stringify(page)).not.toMatch(/private-account|private\/session|\/secret|Secret Company/);
  const working = p.inventory({ statuses: ['working'] });
  expect(working.ancestors).toEqual([expect.objectContaining({ agentId: 'thread:parent1', status: 'completed' })]);
  expect(p.inventory({ projectId: 'p2' }).items.map(a => a.title)).toEqual(['parent2']);
  expect(p.inventory({ text: 'LEGACY' }).items.map(a => a.title)).toEqual(['legacy']);
});

it('preserves every canonical job outcome independently of thread status and reported progress', () => {
  const x = setup(); x.putThread(thread('parent'));
  const statuses: AgentJob['status'][] = ['queued', 'working', 'completed', 'needs_review', 'failed', 'cancelled', 'interrupted'];
  x.putPlan('parent', statuses.map(s => job(s, s)));
  expect(x.open().inventory({}).items.filter(a => a.jobId).map(a => a.status).sort()).toEqual([...statuses].sort());
  expect(x.open().inventory({ statuses: ['completed'] }).items).toHaveLength(1);
  expect(x.open().inventory({ statuses: ['cancelled'] }).items.map(a => a.status)).toEqual(['cancelled']);
});

it('pages stable positions, binds cursors to filters, rejects tampering and resyncs changed membership', () => {
  const x = setup(); for (let i = 0; i < 7; i++) x.putThread(thread(`a${i}`));
  const p = x.open(), first = p.inventory({ limit: 2 });
  x.putThread(thread('a0', { updatedAt: '2026-11-05T01:00:00.000Z' }));
  const second = p.inventory({ limit: 2, cursor: first.nextCursor! });
  expect(second.items.map(a => a.threadId)).toEqual(['a2', 'a3']);
  expect(() => p.inventory({ projectId: 'other', cursor: first.nextCursor! })).toThrow(/cursor/i);
  expect(() => p.inventory({ cursor: first.nextCursor! + 'x' })).toThrow(/cursor/i);
  expect(() => p.inventory({ limit: 101 })).toThrow();
  x.putThread(thread('new'));
  expect(() => p.inventory({ limit: 2, cursor: second.nextCursor! })).toThrow(/resync/i);
});

it('keeps archive opt-in, including archived descendants, and rejects unbound transcript authority', () => {
  const x = setup(); x.putThread(thread('parent')); x.putThread(thread('child', { kind: 'delegate', parentThreadId: 'parent', jobId: 'j' }));
  x.putPlan('parent', [job('j', 'working', { childThreadId: 'child' })]);
  const p = x.open(), child = p.inventory({}).items.find(a => a.jobId)!;
  x.store.internal('thread.archive', 'parent', () => x.store.put('archivedThread', 'parent', 'parent', true));
  expect(p.inventory({}).items).toEqual([]);
  expect(p.inventory({ includeArchived: true }).items).toHaveLength(2);
  expect(() => p.history({ agentId: child.agentId })).toThrow();
  expect(p.history({ agentId: child.agentId, includeArchived: true }).messages).toEqual([]);
  x.putThread(thread('child', { kind: 'delegate', parentThreadId: 'wrong', jobId: 'j' }));
  expect(() => p.history({ agentId: child.agentId, includeArchived: true })).toThrow();
});

it('reads real chronological history and bounded Unicode content, isolating cursors by agent and revision', () => {
  const x = setup(); x.putThread(thread('a')); x.putThread(thread('b'));
  for (let i = 0; i < 5; i++) x.putMessage('a', `m${i}`, i === 4 ? '😀'.repeat(10000) : `message ${i}`);
  x.putMessage('b', 'secret', 'not a message in a');
  const p = x.open(), first = p.history({ agentId: 'thread:a', limit: 2 });
  expect(first.messages.map(m => m.id)).toEqual(['m3', 'm4']);
  expect([...first.messages[1].content]).toHaveLength(4096);
  let text = first.messages[1].content, cursor = first.messages[1].nextContentCursor;
  while (cursor) { const chunk = p.content({ agentId: 'thread:a', cursor }); text += chunk.content; cursor = chunk.nextContentCursor; }
  expect(text).toBe('😀'.repeat(10000));
  expect(p.history({ agentId: 'thread:a', cursor: first.nextCursor!, limit: 2 }).messages.map(m => m.id)).toEqual(['m1', 'm2']);
  expect(() => p.history({ agentId: 'thread:b', cursor: first.nextCursor! })).toThrow(/cursor/i);
  x.putMessage('a', 'm4', 'revised');
  expect(() => p.content({ agentId: 'thread:a', cursor: first.messages[1].nextContentCursor! })).toThrow(/resync/i);
  expect(() => p.history({ agentId: 'thread:missing' })).toThrow();
});

it('projects scoped sequenced updates without full snapshots, rejects stale checkpoints and signals retention gaps', { timeout: 60000 }, () => {
  const x = setup(); x.putThread(thread('a')); x.putThread(thread('b'));
  const p = x.open(), page = p.inventory({ text: 'a' }), snapshot = vi.spyOn(x.store, 'snapshot').mockImplementation(() => { throw Error('No snapshot'); });
  x.putMessage('b', 'other', 'private elsewhere');
  x.putMessage('a', 'first', 'visible');
  x.putThread(thread('a', { status: 'awaiting_input' }));
  const updates = p.updates({ after: page.sequence, scopeKey: page.scopeKey, text: 'a', visibleAgentIds: ['thread:a'] });
  expect(updates).toMatchObject({ fromSequence: page.sequence, sequence: x.store.sequence, resync: false, transcripts: [{ agentId: 'thread:a', sequence: expect.any(Number) }] });
  expect(updates.upserts.map(a => a.agentId)).toEqual(['thread:a']);
  expect(JSON.stringify(updates)).not.toContain('private elsewhere');
  expect(p.updates({ after: x.store.sequence + 1, scopeKey: page.scopeKey, text: 'a' }).resync).toBe(true);
  expect(() => p.updates({ after: page.sequence, scopeKey: page.scopeKey, text: 'b' })).toThrow(/scope/i);
  for (let i = 0; i < 520; i++) x.store.internal('unrelated', null, () => null);
  expect(p.updates({ after: page.sequence, scopeKey: page.scopeKey, text: 'a' }).resync).toBe(true);
  expect(snapshot).not.toHaveBeenCalled();
});

it.each([false, true])('uses the actual canonical producer, with task_finish=%s, independently of reported progress', async finish => {
  const { PlanningCoordinator } = await import('../packages/core/planning.ts');
  const x = setup(); x.putThread(thread('parent', { accountId: null }));
  let callbacks: import('../packages/contracts/index.ts').RuntimeCallbacks | undefined;
  let input: import('../packages/contracts/index.ts').StartRun | undefined;
  const coordinator = new PlanningCoordinator({ store: x.store, assertRun: () => {}, domainContext: () => { throw Error('No domain authority'); },
    runtimeFactory: () => ({ configure: c => { callbacks = c; }, models: async () => [], start: async i => { input = i; }, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} }) });
  const p = x.open(), observed: string[] = [];
  const stop = p.subscribe(() => { const child = p.inventory({}).items.find(a => a.jobId); if (child) observed.push(child.status); });
  const pending = coordinator.delegate({ threadId: 'parent', runId: 'run-parent', epoch: 1 },
    { commandId: 'real-producer', tasks: [{ id: 'inspect', name: 'Inspect', task: 'Inspect', prompt: 'Read only', requirements: [] }] }, new AbortController().signal);
  await vi.waitFor(() => expect(input).toBeDefined());
  const child = p.inventory({}).items.find(a => a.jobId)!;
  expect(child.status).toBe('working');
  callbacks!.onEvent({ ...input!, type: 'assistant.message', content: 'Observed result' });
  expect(p.history({ agentId: child.agentId }).messages.at(-1)?.content).toBe('Observed result');
  if (finish) await callbacks!.onTool({ name: 'task_finish', args: { outcome: 'Observed finish' } }, input!);
  callbacks!.onEvent({ ...input!, type: 'settled' });
  await pending;
  expect(p.inventory({}).items.find(a => a.jobId)?.status).toBe(finish ? 'completed' : 'needs_review');
  expect(observed).toContain('queued'); expect(observed).toContain('working'); stop();
  await coordinator.dispose();
});

it('does not inflate an archived empty draft, or rebuild the global inventory on unrelated events', () => {
  const x = setup(); x.putThread(thread('draft', { status: 'ready', runId: null })); x.putThread(thread('active'));
  const p = x.open(), first = p.inventory({ limit: 1 });
  x.putThread(thread('draft', { status: 'stopped', runId: null }));
  x.store.internal('thread.archive', 'draft', () => x.store.put('archivedThread', 'draft', 'draft', true));
  expect(p.inventory({ includeArchived: true }).items.map(a => a.threadId)).toEqual(['active']);
  const revision = p.inventory({}).items[0].revision;
  const prepare = vi.spyOn(x.store.db, 'prepare');
  x.store.internal('settings.update', null, () => x.store.put('settings', 'global', null, { theme: 'dark' }));
  expect(p.inventory({}).items[0].revision).toBe(revision);
  expect(prepare.mock.calls.filter(([sql]) => sql.includes("WHERE kind='thread'") && !sql.includes('id=?'))).toHaveLength(0);
  expect(p.updates({ after: first.sequence, scopeKey: first.scopeKey }).upserts).toEqual([]);
});

it('distinguishes a real project ID named none from an unbound personal project filter', () => {
  const x = setup(); x.putThread(thread('bound', { projectId: 'none' })); x.putThread(thread('unbound'));
  const p = x.open();
  expect(p.inventory({ projectId: 'none' }).items.map(a => a.title)).toEqual(['bound']);
  expect(p.inventory({ projectId: null }).items.map(a => a.title)).toEqual(['unbound']);
});

it('ignores stale notifications and forces a scoped resync after an actual notification gap', () => {
  const x = setup(); x.putThread(thread('a')); x.putMessage('a', 'long', 'x'.repeat(10000));
  let deliver: ((event: import('../packages/contracts/index.ts').WorkspaceEvent) => void) | undefined;
  const subscribe = x.store.subscribe.bind(x.store);
  vi.spyOn(x.store, 'subscribe').mockImplementation(listener => { deliver = listener; return subscribe(listener); });
  const p = x.open(), first = p.inventory({}), contentCursor = p.history({ agentId: 'thread:a' }).messages[0].nextContentCursor!;
  deliver!({ seq: first.sequence, id: 'stale', type: 'runtime.assistant.delta', threadId: 'a', payload: null, occurredAt: date });
  expect(p.inventory({}).sequence).toBe(first.sequence);
  deliver!({ seq: first.sequence + 2, id: 'gap', type: 'runtime.assistant.delta', threadId: 'a', payload: null, occurredAt: date });
  expect(p.updates({ after: first.sequence, scopeKey: first.scopeKey }).resync).toBe(true);
  expect(() => p.content({ agentId: 'thread:a', cursor: contentCursor })).toThrow(/resync/i);
});

it('bounds content lookup by signed message identity, independently of conversation length', () => {
  const x = setup(); x.putThread(thread('a')); x.putMessage('a', 'long', 'x'.repeat(10000));
  for (let i = 0; i < 200; i++) x.putMessage('a', `m${i}`, 'small');
  const p = x.open(), history = p.history({ agentId: 'thread:a', limit: 100 });
  const older = p.history({ agentId: 'thread:a', limit: 100, cursor: history.nextCursor! });
  const oldest = p.history({ agentId: 'thread:a', cursor: older.nextCursor! });
  const prepare = vi.spyOn(x.store.db, 'prepare');
  const content = p.content({ agentId: 'thread:a', cursor: oldest.messages[0].nextContentCursor! });
  expect(content.content).toHaveLength(4096);
  expect(prepare.mock.calls.some(([sql]) => /SELECT id FROM entities WHERE kind='message' AND thread_id=\?/.test(sql))).toBe(false);
});

it('does not inspect stored message bodies to rediscover an already active canonical parent on progress events', () => {
  const x = setup(); x.putThread(thread('a')); x.putPlan('a', [job('reader')]); x.putMessage('a', 'large', 'x'.repeat(100000));
  x.open(); const prepare = vi.spyOn(x.store.db, 'prepare');
  x.putPlan('a', [job('reader', 'working', { reportedPercent: 50 })]);
  expect(prepare.mock.calls.some(([sql]) => sql.includes("length(trim(json_extract(body,'$.content')))"))).toBe(false);
});

it('projects canonical activity text without replacing it with a guessed status', () => {
  const x = setup(); x.putThread(thread('a')); x.putMessage('a', 'action', 'Reading source', 'activity');
  const p = x.open(); expect(p.inventory({}).items[0].currentAction).toBe('Reading source');
  x.putMessage('a', 'next', 'Checking result', 'activity');
  expect(p.inventory({}).items[0].currentAction).toBe('Checking result');
});

it('updates every project member on a canonical rename even when the event has a thread address', () => {
  const x = setup(); x.putThread(thread('a', { projectId: 'p' })); x.putThread(thread('b', { projectId: 'p' }));
  const p = x.open(), first = p.inventory({});
  x.store.internal('workspace.project.rename', 'a', () => x.store.put('workspaceProject', 'p', null, { id: 'p', name: 'Renamed', authority: { kind: 'local' } }));
  expect(p.inventory({}).items.map(a => a.projectName)).toEqual(['Renamed', 'Renamed']);
  expect(p.updates({ after: first.sequence, scopeKey: first.scopeKey }).upserts).toHaveLength(2);
});

it('rejects out-of-order concurrent read responses by scope and exact checkpoint', () => {
  const x = setup(); x.putThread(thread('a')); const p = x.open(), first = p.inventory({});
  x.putMessage('a', 'm1', 'one'); const second = p.updates({ after: first.sequence, scopeKey: first.scopeKey });
  x.putMessage('a', 'm2', 'two'); const third = p.updates({ after: second.sequence, scopeKey: first.scopeKey });
  expect(inventoryUpdateDisposition(first, second)).toBe('apply');
  expect(inventoryUpdateDisposition(third, second)).toBe('stale');
  expect(inventoryUpdateDisposition(first, third)).toBe('resync');
  expect(inventoryUpdateDisposition({ ...first, scopeKey: 'new-filter' }, third)).toBe('stale');
});

it('refreshes an owning ancestor when the parent itself is excluded by the inventory filter', () => {
  const x = setup(); x.putThread(thread('parent', {status: 'ready'})); x.putPlan('parent', [job('reader', 'working')]);
  const p = x.open(), first = p.inventory({statuses: ['working']}), unrelated = p.inventory({statuses: ['failed']});
  expect(first.items.map(item => item.jobId)).toEqual(['reader']);
  expect(first.ancestors[0].title).toBe('parent');
  x.putThread(thread('parent', {status: 'ready', title: 'Renamed parent'}));
  const update = p.updates({after: first.sequence, scopeKey: first.scopeKey, statuses: ['working']});
  expect(update.ancestors.map(item => item.title)).toEqual(['Renamed parent']);
  expect(p.updates({after: unrelated.sequence, scopeKey: unrelated.scopeKey, statuses: ['failed']}).ancestors).toEqual([]);
});
