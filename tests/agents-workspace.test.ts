import {describe, expect, it, vi} from 'vitest';
import type {AgentSummary, HistoryPage, InventoryPage, InventoryUpdates, MessageSlice} from '../packages/contracts/agent-inventory';
import {AgentsWorkspaceController, groupAgents, visibleLease} from '../apps/web/src/agents-workspace/controller';
import type {AgentTransport} from '../apps/web/src/agents-workspace/transport';
import {ApiError} from '../apps/web/src/api';

export const agent = (id: string, patch: Partial<AgentSummary> = {}): AgentSummary => ({agentId: id, parentId: null, rootId: id, jobId: null, threadId: id, projectId: 'p', projectName: 'Project', title: id, status: 'working', modelId: 'model', currentAction: 'Reading source', reportedPercent: null, createdAt: '2026-11-06', updatedAt: '2026-11-06', orderKey: id, revision: 1, archived: false, readOnly: false, metadata: 'thread', ...patch});
const page = (items: AgentSummary[], patch: Partial<InventoryPage> = {}): InventoryPage => ({authority: 'personal', scopeKey: 'scope', sequence: 10, items, ancestors: [], nextCursor: null, ...patch});
const message = (content: string, patch: Partial<MessageSlice> = {}): MessageSlice => ({id: 'm', threadId: 'a', role: 'assistant', createdAt: '2026-11-06', runId: 'run', content, contentOffset: 0, contentLength: content.length, nextContentCursor: null, ...patch});
const history = (messages: MessageSlice[], patch: Partial<HistoryPage> = {}): HistoryPage => ({authority: 'personal', agentId: 'a', threadId: 'a', sequence: 10, messages, nextCursor: null, ...patch});
function fixture(overrides: Partial<AgentTransport> = {}) {
 const listeners: {accept: (value: InventoryUpdates) => void; signal: AbortSignal}[] = [];
 const transport: AgentTransport = {inventory: vi.fn(async () => page([agent('a')])), history: vi.fn(async () => history([message('Initial')])), content: vi.fn(async () => message('')), updates: vi.fn(async q => ({authority: 'personal' as const, scopeKey: q.scopeKey, fromSequence: q.after, sequence: q.after, resync: false, upserts: [], removed: [], ancestors: [], transcripts: []})), events: vi.fn(async (_q, accept, signal) => {listeners.push({accept, signal}); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {once: true}));}), ...overrides};
 return {transport, listeners, controller: new AgentsWorkspaceController(transport)};
}
const settle = async () => {for (let i = 0; i < 20; i++) await Promise.resolve();};

describe('compact agent workspace', () => {
 it('pages the entire inventory and nests filtered children under their owning ancestors', async () => {
  const root = agent('root', {status: 'completed'}), child = agent('child', {parentId: 'root', rootId: 'root', readOnly: true});
  const f = fixture({inventory: vi.fn(async q => q.cursor ? page([agent('other', {projectId: 'q'})]) : page([child], {ancestors: [root], nextCursor: 'next'}))});
  await f.controller.start();
  expect(f.transport.inventory).toHaveBeenCalledTimes(2);
  const groups = groupAgents(f.controller.getSnapshot().agents);
  expect(groups).toHaveLength(2); expect(groups[0].parents[0].agent.agentId).toBe('root');
  expect(groups[0].parents[0].children[0].agent.agentId).toBe('child');
  expect(f.transport.history).not.toHaveBeenCalled(); f.controller.dispose();
 });
 it('assembles large content without slicing and pages earlier history without replacing newer messages', async () => {
  const f = fixture({history: vi.fn(async q => q.cursor ? history([message('Earlier', {id: 'old', createdAt: '2026-11-05'})]) : history([message('abc', {contentLength: 6, nextContentCursor: 'rest'})], {nextCursor: 'older'})), content: vi.fn(async () => message('def', {contentOffset: 3, contentLength: 6}))});
  await f.controller.start(); f.controller.setVisible(['a']); await settle();
  expect(f.controller.transcript('a').messages[0].content).toBe('abcdef');
  await f.controller.loadEarlier('a'); expect(f.controller.transcript('a').messages.map(m => m.content)).toEqual(['Earlier', 'abcdef']); f.controller.dispose();
 });
 it('aborts old scopes and discards their late pages', async () => {
  let resolve!: (p: InventoryPage) => void;
  const f = fixture({inventory: vi.fn(q => q.text === 'new' ? Promise.resolve(page([agent('new')], {scopeKey: 'new'})) : new Promise<InventoryPage>(r => {resolve = r;}))});
  const old = f.controller.start(); await f.controller.setScope({text: 'new'}); resolve(page([agent('old')])); await old;
  expect(f.controller.getSnapshot().agents.map(a => a.agentId)).toEqual(['new']); f.controller.dispose();
 });
 it('resyncs gapped events, ignores old events, and refreshes only visible transcripts', async () => {
  const f = fixture(); await f.controller.start(); f.controller.setVisible(['a']); await settle();
  const update = (patch: Partial<InventoryUpdates>): InventoryUpdates => ({authority: 'personal', scopeKey: 'scope', fromSequence: 10, sequence: 11, resync: false, upserts: [], removed: [], ancestors: [], transcripts: [], ...patch});
  await f.controller.accept(update({transcripts: [{agentId: 'a', sequence: 11}, {agentId: 'offscreen', sequence: 11}]}));
  await settle(); expect(f.transport.history).toHaveBeenCalledTimes(2);
  await f.controller.accept(update({sequence: 9, upserts: [agent('stale')]}));
  expect(f.controller.getSnapshot().agents.some(a => a.agentId === 'stale')).toBe(false);
  await f.controller.accept(update({fromSequence: 14, sequence: 15})); expect(f.transport.inventory).toHaveBeenCalledTimes(2);
  f.controller.dispose(); expect(f.listeners.every(l => l.signal.aborted)).toBe(true);
 });
 it('keeps scroll, collapse and focus state when filters hide and restore a view', async () => {
  const f = fixture(); await f.controller.start(); f.controller.setView('a', {top: 123, atEnd: false, collapsed: true, focus: 'composer'});
  await f.controller.setScope({statuses: ['cancelled', 'queued', 'needs_review']});
  expect(f.controller.view('a')).toMatchObject({top: 123, atEnd: false, collapsed: true, focus: 'composer'}); f.controller.dispose();
 });
 it('leases the actual visible set, never the first inventory entries, and fairly rotates excess visibility', () => {
  const ids = Array.from({length: 40}, (_, i) => 'visible-' + (i + 100));
  const first = visibleLease(ids, 0), second = visibleLease(ids, 24);
  expect(first).toHaveLength(24); expect(second).toHaveLength(24); expect(new Set([...first, ...second]).size).toBe(40);
  expect(visibleLease(['last-inventory-agent'], 0)).toEqual(['last-inventory-agent']);
 });
 it('refreshes a cached transcript after returning from offscreen and after scope resync', async () => {
  let content = 'Before'; const f = fixture({history: vi.fn(async () => history([message(content)]))});
  await f.controller.start(); f.controller.setVisible(['a']); await settle();
  f.controller.setVisible([]); content = 'While hidden'; f.controller.setVisible(['a']); await settle();
  expect(f.controller.transcript('a').messages[0].content).toBe('While hidden');
  content = 'After resync'; await f.controller.start(); await settle();
  expect(f.controller.transcript('a').messages[0].content).toBe('After resync'); f.controller.dispose();
 });
 it('can restart a visible history request that was aborted by a filter', async () => {
  let first = true;
  const f = fixture({history: vi.fn(async (_q, signal) => {if (!first) return history([message('Restored')]); first = false; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), {once: true})); throw new DOMException('Aborted', 'AbortError');})});
  await f.controller.start(); f.controller.setVisible(['a']); await settle(); await f.controller.setScope({text: 'a'}); await settle();
  expect(f.controller.transcript('a').messages[0]?.content).toBe('Restored'); f.controller.dispose();
 });
 it('rejects a content cursor that repeats or changes message identity', async () => {
  const f = fixture({history: vi.fn(async () => history([message('abc', {contentLength: 6, nextContentCursor: 'rest'})])), content: vi.fn(async () => message('bad', {id: 'other', contentOffset: 3, contentLength: 6}))});
  await f.controller.start(); f.controller.setVisible(['a']); await settle();
  expect(f.controller.transcript('a').error).toMatch(/changed|incomplete/i); expect(f.controller.transcript('a').messages).toHaveLength(0); f.controller.dispose();
 });
 it('honors the published Unicode code-point offsets and canonical row order', async () => {
  const f = fixture({history: vi.fn(async () => history([message('A😀', {id: 'z-first', contentLength: 3, nextContentCursor: 'rest'}), message('Second', {id: 'a-second'})])), content: vi.fn(async () => message('B', {id: 'z-first', contentOffset: 2, contentLength: 3}))});
  await f.controller.start(); f.controller.setVisible(['a']); await settle();
  expect(f.controller.transcript('a').messages.map(m => [m.id, m.content])).toEqual([['z-first', 'A😀B'], ['a-second', 'Second']]); f.controller.dispose();
 });
 it('restarts an expired inventory cursor from page one', async () => {
  let calls = 0; const f = fixture({inventory: vi.fn(async q => {calls++; if (q.cursor) throw new ApiError('RESYNC_REQUIRED', 'changed'); return page([agent('a')], {nextCursor: calls === 1 ? 'old' : null});})});
  await f.controller.start(); expect(f.transport.inventory).toHaveBeenCalledTimes(3); expect(f.controller.getSnapshot().error).toBe(''); f.controller.dispose();
 });
 it('refreshes visible ancestor history on scoped ticks and removes orphan ancestor containers', async () => {
  const root = agent('root'), child = agent('child', {parentId: 'root', rootId: 'root'});
  const f = fixture({inventory: vi.fn(async () => page([child], {ancestors: [root]})), history: vi.fn(async q => history([message(q.agentId)], {agentId: q.agentId, threadId: q.agentId}))});
  await f.controller.start(); f.controller.setVisible(['root', 'child']); await settle();
  await f.controller.accept({authority: 'personal', scopeKey: 'scope', fromSequence: 10, sequence: 11, resync: false, upserts: [], ancestors: [], removed: [], transcripts: []}); await settle();
  expect(f.transport.history).toHaveBeenCalledTimes(3);
  await f.controller.accept({authority: 'personal', scopeKey: 'scope', fromSequence: 11, sequence: 12, resync: false, upserts: [], ancestors: [], removed: ['child'], transcripts: []});
  expect(f.controller.getSnapshot().agents).toHaveLength(0); f.controller.dispose();
 });
 it('coalesces transcript updates while a large history read is in flight', async () => {
  let release!: (value: HistoryPage) => void; let signal!: AbortSignal;
  const f = fixture({history: vi.fn((_q, readSignal) => {signal = readSignal; return new Promise<HistoryPage>(resolve => {release = resolve;});})});
  await f.controller.start(); f.controller.setVisible(['a']); await settle();
  await f.controller.accept({authority: 'personal', scopeKey: 'scope', fromSequence: 10, sequence: 11, resync: false, upserts: [], ancestors: [], removed: [], transcripts: [{agentId: 'a', sequence: 11}]});
  expect(f.transport.history).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(false);
  release(history([message('First')])); await settle(); expect(f.transport.history).toHaveBeenCalledTimes(2); f.controller.dispose();
 });
});

it('keeps messages between disjoint live history pages reachable', async () => {
 const item = (id: string) => message(id, {id});
 let latest = false;
 const f = fixture({history: vi.fn(async q => q.cursor === 'gap'
  ? history([item('middle'), item('new')], {sequence: 11, nextCursor: 'old'})
  : q.cursor === 'old' ? history([item('old')], {sequence: 11})
  : latest ? history([item('newest')], {sequence: 11, nextCursor: 'gap'})
  : history([item('old')]))});
 try {
  await f.controller.start(); f.controller.setVisible(['a']); await settle();
  latest = true; await f.controller.retryHistory('a');
  for (let i = 0; i < 3 && f.controller.transcript('a').cursor; i++) await f.controller.loadEarlier('a');
  expect(f.controller.transcript('a').messages.map(value => value.id)).toEqual(['old', 'middle', 'new', 'newest']);
 } finally {f.controller.dispose();}
});
