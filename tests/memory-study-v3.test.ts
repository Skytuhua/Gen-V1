import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scoreMemoryStudyOutput, runMemoryStudy, MEMORY_STUDY_CASES, MEMORY_STUDY_POLICY } from '../evals/project-memory-study.ts';
import type {MemoryItemV1, MemoryPreparedRequest, MemoryScope, MemoryUsageReport, ProjectMemoryView} from '../packages/contracts/project-memory.ts';
import type {Snapshot, Thread} from '../packages/contracts/index.ts';

const directories: string[] = [];
afterEach(() => {vi.unstubAllGlobals(); for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true});});
it('scores actual task outputs against exact UTC and decimal requirements rather than retrieval similarity', () => {
  const row = MEMORY_STUDY_CASES[0];
  expect(scoreMemoryStudyOutput(row, JSON.stringify(row.expected))).toMatchObject({correct: true, assertions: {timestamp: true, amount: true}});
  expect(scoreMemoryStudyOutput(row, JSON.stringify({...row.expected, amount: '12'}))).toMatchObject({correct: false, assertions: {timestamp: true, amount: false}});
  expect(scoreMemoryStudyOutput(row, 'The recalled policy seems relevant.')).toMatchObject({correct: false});
});
it('writes an exclusive honest manifest without a supplied live host, model, and prepared fixture project', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'm05-study-')); directories.push(parent);
  const output = join(parent, 'study');
  const result = await runMemoryStudy({destination: output});
  expect(result.status).toBe('MANIFEST_ONLY'); expect(result.runs).toEqual([]);
  expect(result.summary.controlCorrectness).toBeNull(); expect(result.summary.treatmentCorrectness).toBeNull(); expect(result.summary.totalAuxiliaryCost).toBeNull();
  expect(JSON.parse(readFileSync(join(output, 'results.json'), 'utf8')).execution.providerCalls).toBe(0);
  await expect(runMemoryStudy({destination: output})).rejects.toThrow();
});

/** Protocol fixtures exercise the runner only. No model or network call occurs. */
function liveProtocol(options: {selectedAccount?: string; missingWarmup?: boolean; foreignPrepared?: boolean; extraTreatment?: boolean; unknownCost?: boolean; pendingOnce?: boolean; nativeCapture?: boolean; capturedTamper?: 'account' | 'selection' | 'query' | 'score'} = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'm05-study-protocol-')); directories.push(parent);
  const scope: MemoryScope = {projectId: 'project', threadId: 'source', accountId: 'account', projectIdentity: 'a'.repeat(64), bindingDigest: 'b'.repeat(64)};
  const source: Thread = {id: 'source', kind: 'main', projectId: 'project', accountId: 'account', title: 'Policy source', projectName: 'Disposable', modelId: 'openai/fixture-model', thinkingLevel: 'high', runId: null, epoch: 1, sessionPath: 'synthetic-source-session', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', status: 'completed'};
  const item: MemoryItemV1 = {id: 'policy', revision: 1, projectIdentity: scope.projectIdentity, scope: 'PROJECT', kind: 'CONSTRAINT', text: MEMORY_STUDY_POLICY, state: 'ACCEPTED', sourceRefs: [{ownerThreadId: 'source', sourceKind: 'MESSAGE', sourceId: 'policy-source', sourceRevision: '1', capturedSeq: 1, digest: 'c'.repeat(64), observedStatus: 'REPORTED'}], assertedBy: {kind: 'USER', id: 'user'}, observedAt: '2026-11-15T00:00:00Z', expiresAt: null, supersedes: [], sensitivity: 'NORMAL', reviewDecision: null};
  const view: ProjectMemoryView = {scope, projectName: 'Disposable', available: true, disabledReason: null, enabled: true, configRevision: 1, sourceThreadIds: ['source'], eligibleThreads: [{id: 'source', title: 'Policy source'}], items: [{item, lastUsedAt: null, conflictRevisions: []}], tombstones: []};
  const paths: string[] = [], commands: {id: string; type: string; threadId?: string; payload: Record<string, unknown>}[] = [];
  const threads = new Map<string, {thread: Thread; control: boolean; phase: 'new' | 'warmup' | 'task'; prepared?: MemoryPreparedRequest; latest?: MemoryPreparedRequest}>();
  let usageReads = 0;
  const requestView = (threadId: string, requestId: string, phase: MemoryPreparedRequest['phase'], items: MemoryItemV1[]): MemoryPreparedRequest => ({scope: {...scope, threadId}, requestId, contextGeneration: 1, phase, items, injectedBytes: items.length ? 240 : 0, expiresAt: '2099-01-01T00:00:00Z', recall: {requestId, contextGeneration: 1, projectIdentity: scope.projectIdentity, queryDigest: 'd'.repeat(64), candidateIds: items.map(value => value.id), selectedRevisions: items.map(value => ({itemId: value.id, revision: value.revision})), scores: options.nativeCapture ? items.map(value => ({itemId: value.id, revision: value.revision, projectOverlap: 0, symbolOverlap: 2, matchedTerms: ['timestamp', 'amount']})) : [], exclusions: [], budgetBytes: 4096, producedAt: '2026-11-15T00:00:00Z', status: 'COMPLETE'}});
  const snapshot = (thread: Thread, phase: 'new' | 'warmup' | 'task' = 'new'): Snapshot => ({seq: 1, threads: [thread], messages: phase === 'new' ? [] : [{id: 'ready-' + thread.id, threadId: thread.id, role: 'assistant', content: 'READY', createdAt: source.createdAt, runId: null}, ...(phase === 'task' ? [{id: 'answer-' + thread.id, threadId: thread.id, role: 'assistant' as const, content: JSON.stringify(MEMORY_STUDY_CASES[Math.floor((Number(thread.id.split('-')[1]) - 1) / 2)].expected), createdAt: source.createdAt, runId: null}] : [])], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {[thread.id]: {contextTokens: null, contextWindow: null, inputTokens: phase === 'warmup' ? 10 : 40, outputTokens: phase === 'warmup' ? 2 : 10, cost: phase === 'warmup' ? 1 : 3, activity: 'idle', sessionPercent: null, weeklyPercent: null}}, settings: {theme: 'dark', modelId: source.modelId, selectedAccounts: {openai: options.selectedAccount ?? 'account'}}, activeThreadId: thread.id});
  vi.stubGlobal('fetch', vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(target)); paths.push(url.pathname + url.search); const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (url.pathname === '/api/bootstrap') return Response.json({csrfToken: 'synthetic-csrf'});
    if (url.pathname === '/api/snapshot') return Response.json(snapshot(source));
    if (url.pathname === '/api/models') return Response.json({models: [{id: source.modelId, provider: 'openai', name: 'Synthetic protocol model', thinkingLevels: ['high']}]});
    if (url.pathname === '/api/commands') {
      commands.push(body);
      if (body.type === 'thread.create') {const id = `task-${threads.size + 1}`, thread = {...source, id, title: body.payload.title, accountId: undefined, modelId: null, thinkingLevel: undefined, epoch: 0, sessionPath: null}; threads.set(id, {thread, control: false, phase: 'new'}); return Response.json({commandId: body.id, eventSeq: 1, result: thread});}
      const state = threads.get(body.threadId)!;
      if (body.type === 'memory.save') state.control = true;
      if (body.type === 'message.send') {
        state.thread = {...state.thread, accountId: options.selectedAccount ?? 'account', modelId: source.modelId, thinkingLevel: body.payload.thinkingLevel, epoch: state.thread.epoch + 1, sessionPath: `synthetic-session-${body.threadId}`};
        if (body.payload.content === 'READY') {state.phase = 'warmup'; state.latest = requestView(body.threadId, `warmup-${body.threadId}`, 'CAPTURED', []);}
        else {
          state.phase = 'task'; state.latest = {...structuredClone(state.prepared!), phase: 'CAPTURED'};
          if (options.nativeCapture) {
            state.latest.scope.bindingDigest = 'e'.repeat(64);
            state.latest.recall.scores = state.latest.recall.scores.map(score => ({...score, matchedTerms: []}));
          }
          if (options.capturedTamper === 'account') state.latest.scope.accountId = 'foreign-account';
          if (options.capturedTamper === 'selection') {state.latest.items = [structuredClone(item)]; state.latest.recall.selectedRevisions = [{itemId: item.id, revision: item.revision}]; state.latest.injectedBytes = 240;}
          if (options.capturedTamper === 'query') state.latest.recall.queryDigest = 'f'.repeat(64);
          if (options.capturedTamper === 'score') state.latest.recall.scores[0].symbolOverlap++;
        }
      }
      return Response.json({commandId: body.id, eventSeq: 2, result: {accepted: true}});
    }
    const match = /^\/api\/threads\/([^/]+)\/snapshot$/.exec(url.pathname);
    if (match) {if (match[1] === 'source') return Response.json(snapshot(source)); const state = threads.get(match[1])!; return Response.json(snapshot(state.thread, state.phase));}
    if (url.pathname === '/api/projects/project/memory') return Response.json(view);
    if (url.pathname.endsWith('/memory/usage')) {
      usageReads++; const after = usageReads > 1;
      const value: MemoryUsageReport = {scope, extraction: {modelCalls: after ? 2 : 1, inputTokens: 20, outputTokens: 10, cost: options.unknownCost && after ? null : after ? 0.4 : 0.2, pending: options.pendingOnce && usageReads === 2 ? 1 : 0}, consolidation: {modelCalls: 1, inputTokens: 10, outputTokens: 2, cost: 0.1, pending: 0}, retrieval: {requests: after ? 12 : 0, injectedBytes: after ? 720 : 0, latencyMs: after ? 30 : 0}};
      return Response.json(value);
    }
    if (url.pathname.endsWith('/requests/prepare')) {
      const state = threads.get(body.threadId)!, selected = [structuredClone(item)];
      if (options.extraTreatment && !state.control) selected.push({...structuredClone(item), id: 'unreviewed-extra', text: 'A newly accepted hint.'});
      state.prepared = requestView(body.threadId, `request-${body.threadId}`, 'PREPARING', selected);
      if (options.foreignPrepared) state.prepared.scope.accountId = 'foreign'; return Response.json(state.prepared);
    }
    if (url.pathname.endsWith('/requests/latest')) {const state = threads.get(url.searchParams.get('threadId')!)!; return Response.json(options.missingWarmup && state.phase === 'warmup' ? null : state.latest);}
    if (url.pathname.endsWith('/exclude')) {
      const state = threads.get(body.scope.threadId)!, prepared = state.prepared!; prepared.items = prepared.items.filter(value => value.id !== body.itemId); prepared.recall.selectedRevisions = prepared.recall.selectedRevisions.filter(value => value.itemId !== body.itemId); prepared.recall.exclusions.push({itemId: body.itemId, reason: 'USER_EXCLUDED'}); prepared.injectedBytes = 0; return Response.json(prepared);
    }
    return Response.json({error: {message: 'Unexpected synthetic protocol route'}}, {status: 404});
  }));
  return {paths, commands, usageReads: () => usageReads, run: () => runMemoryStudy({destination: join(parent, 'study'), host: 'http://127.0.0.1:1', modelId: source.modelId!, projectId: 'project', sourceThreadId: 'source', timeoutMs: 1000})};
}

it('uses actual thread-bound model discovery and identical pinned reasoning for every submission', async () => {
  const protocol = liveProtocol(); const report = await protocol.run();
  expect(protocol.paths).toContain('/api/models?threadId=source');
  expect(protocol.commands.filter(value => value.type === 'message.send').every(value => value.payload.thinkingLevel === 'high')).toBe(true);
  expect(report.runs).toHaveLength(6); expect(report.status).toBe('EXECUTED');
});
it('rejects a different selected account before any provider submission', async () => {
  const protocol = liveProtocol({selectedAccount: 'other'}); const report = await protocol.run();
  expect(protocol.commands.filter(value => value.type === 'message.send')).toEqual([]); expect(report.status).toBe('SETUP_FAILED');
});
it.each([{missingWarmup: true}, {foreignPrepared: true}, {extraTreatment: true}])('rejects missing or changed comparison authority %j', async options => {
  const report = await liveProtocol(options).run(); expect(report.status).not.toBe('EXECUTED');
});
it('does not subtract unqualified runtime snapshots or report missing auxiliary charges as zero', async () => {
  const report = await liveProtocol({unknownCost: true}).run();
  expect(report.runs[0].foregroundCost).toBeNull(); expect(report.summary.totalAuxiliaryCost).toBeNull(); expect(report.status).toBe('INCOMPLETE_COST');
});
it('waits for registered auxiliary work and includes setup spend in the total', async () => {
  const protocol = liveProtocol({pendingOnce: true}); const report = await protocol.run();
  expect(protocol.usageReads()).toBeGreaterThan(2); expect(report.summary.totalAuxiliaryCost).toBe(0.5); expect(report.status).toBe('EXECUTED');
});
it('accepts the admitted owner binding and metadata-only captured scores while preserving exact preparation evidence', async () => {
  const report = await liveProtocol({nativeCapture: true}).run();
  expect(report.status).toBe('EXECUTED'); expect(report.runs).toHaveLength(6);
});
it.each(['account', 'selection', 'query', 'score'] as const)('rejects captured %s changes beyond the declared admission and redaction transition', async capturedTamper => {
  const report = await liveProtocol({nativeCapture: true, capturedTamper}).run();
  expect(report.status).toBe('SETUP_FAILED'); expect(report.runs).toEqual([]);
});
