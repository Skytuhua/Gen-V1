import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import type { Snapshot, Thread, RuntimeUsage, ModelInfo, CommandReceipt } from '../packages/contracts/index.ts';
import {isConnectionProviderId} from '../packages/contracts/connections.ts';
import { memoryPreparedRequestSchema, memoryUsageReportSchema, projectMemoryViewSchema, type MemoryPreparedRequest, type MemoryUsageReport, type MemoryScope, type MemoryItemV1 } from '../packages/contracts/project-memory.ts';

export const MEMORY_STUDY_POLICY = 'Export report timestamps as UTC ISO 8601 with milliseconds. Format monetary amounts with exactly two decimal places. Preserve original source files.';
export const MEMORY_STUDY_CASES = [
  {id: 'report-1', input: {timestamp: '2026-02-03T16:04:05+02:00', amount: '12'}, expected: {timestamp: '2026-02-03T14:04:05.000Z', amount: '12.00'}},
  {id: 'report-2', input: {timestamp: '2026-06-07T01:02:03-07:00', amount: '4.5'}, expected: {timestamp: '2026-06-07T08:02:03.000Z', amount: '4.50'}},
  {id: 'report-3', input: {timestamp: '2026-10-11T23:59:59Z', amount: '0.08'}, expected: {timestamp: '2026-10-11T23:59:59.000Z', amount: '0.08'}},
] as const;
type StudyCase = (typeof MEMORY_STUDY_CASES)[number];
export function scoreMemoryStudyOutput(test: StudyCase, text: string) {
  let result: unknown; try {result = JSON.parse(text);} catch {result = null;}
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {};
  const assertions = {timestamp: value.timestamp === test.expected.timestamp, amount: value.amount === test.expected.amount, exactFields: Object.keys(value).sort().join(',') === 'amount,timestamp'};
  return {correct: Object.values(assertions).every(Boolean), assertions};
}
export interface MemoryStudyOptions { destination: string; host?: string; modelId?: string; projectId?: string; sourceThreadId?: string; timeoutMs?: number; signal?: AbortSignal }
type ReportedUsage = Pick<RuntimeUsage, 'cost' | 'inputTokens' | 'outputTokens'>;
interface StudyRun { caseId: string; arm: 'thread-note-only' | 'project-memory'; threadId: string; requestId: string; contextGeneration: number; correct: boolean; assertions: ReturnType<typeof scoreMemoryStudyOutput>['assertions']; injectedBytes: number; selectedRevisions: {itemId: string; revision: number}[]; output: string; elapsedMs: number; foregroundCost: number | null; inputTokens: number | null; outputTokens: number | null; reportedUsage: ReportedUsage; sessionPath: string; modelId: string; accountId: string | null; thinkingLevel: string | null }
const scopeKey = (scope: MemoryScope) => JSON.stringify([scope.projectId, scope.projectIdentity, scope.threadId, scope.accountId, scope.bindingDigest]);
const ownerKey = (scope: MemoryScope) => JSON.stringify([scope.projectId, scope.projectIdentity, scope.threadId, scope.accountId]);
const reportedUsage = (usage?: RuntimeUsage): ReportedUsage => {
  const measurement = (key: keyof ReportedUsage) => typeof usage?.[key] === 'number' && Number.isFinite(usage[key]) && usage[key]! >= 0 ? usage[key]! : null;
  return {cost: measurement('cost'), inputTokens: measurement('inputTokens'), outputTokens: measurement('outputTokens')};
};

/** This uses the ordinary authenticated host API. It never supplies a fake model,
 * guesses an origin, changes accounts, or enables host capability flags. */
export async function runMemoryStudy(options: MemoryStudyOptions) {
  if (!options.destination) throw new Error('An explicit new output directory is required.');
  const destination = resolve(options.destination); await mkdir(destination);
  const report = {
    schemaVersion: 1, study: 'project-memory-v3-repeated-tasks', status: 'MANIFEST_ONLY', createdAt: new Date().toISOString(),
    execution: {host: options.host ?? null, modelId: options.modelId ?? null, providerId: null as string | null, accountId: null as string | null, thinkingLevel: null as string | null, projectId: options.projectId ?? null, sourceThreadId: options.sourceThreadId ?? null, providerCalls: 0 as number | null, foregroundSubmissions: 0},
    fixtureDigest: createHash('sha256').update(JSON.stringify({policy: MEMORY_STUDY_POLICY, cases: MEMORY_STUDY_CASES})).digest('hex'),
    runs: [] as StudyRun[], auxiliaryBefore: null as MemoryUsageReport | null, auxiliaryAfter: null as MemoryUsageReport | null,
    sourceCut: null as {scope: MemoryScope; item: MemoryItemV1} | null,
    warmups: [] as {caseId: string; arm: StudyRun['arm']; threadId: string; requestId: string; sessionPath: string; reportedUsage: ReportedUsage}[],
    summary: {controlCorrectness: null as number | null, treatmentCorrectness: null as number | null, recallUsefulness: null as number | null, totalAuxiliaryCost: null as number | null, injectedBytes: null as number | null, retrievalLatencyMs: null as number | null},
    gates: ['Supply an actual loopback host, available model, and explicitly opted-in disposable fixture project/source conversation.'],
    definitions: {correctness: 'Exact JSON output for UTC conversion, two decimal amounts, and no extra fields. Reject recorded operations and writable grants; this inline-input study does not independently measure source-file preservation.', recallUsefulness: 'Fraction of treatment outputs that are correct and whose captured request selected only the pinned policy. This is an operational proxy, not a causal truth claim.', auxiliaryCost: 'All reported extraction and consolidation spend for the dedicated fixture project, including setup. Unknown cost or pending cleanup remains null.', foregroundCost: 'RuntimeUsage does not specify cumulative versus per-run counters. Preserve warmup and task snapshots without subtracting them; attributed foreground charges and tokens remain null.', foregroundSubmissions: 'Attempted message.send submissions, including warmup and uncertain transport outcomes. This is not a provider-call count.', control: 'The same policy in existing thread notes, with every project-memory revision excluded from that exact prepared request.', ordering: 'Alternating control/treatment order across three fixed tasks. Each arm uses a fresh thread and identical READY warmup with the pinned thinking level; missing warmup capture or any recalled memory rejects the study.'},
  };
  const save = async () => {await writeFile(join(destination, 'results.json'), JSON.stringify(report, null, 2) + '\n'); return report;};
  await writeFile(join(destination, 'frozen-cases.json'), JSON.stringify({policy: MEMORY_STUDY_POLICY, cases: MEMORY_STUDY_CASES, fixtureDigest: report.fixtureDigest}, null, 2) + '\n', {flag: 'wx'});
  if (!options.host || !options.modelId || !options.projectId || !options.sourceThreadId) return save();
  const origin = new URL(options.host);
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use the supplied actual local host HTTP origin.');
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) throw new Error('Choose a bounded per-task deadline.');
  let cookie = '', csrf = '', activeThread: string | null = null, sourceScope: MemoryScope | undefined;
  const request = async (path: string, body?: unknown, recovery = false): Promise<unknown> => {
    const response = await fetch(new URL(path, origin), {method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: {...(cookie ? {cookie} : {}), ...(body === undefined ? {} : {'content-type': 'application/json', 'x-harness-csrf': csrf})}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: options.signal && !recovery ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)});
    const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(value => value.split(';', 1)[0]).join('; ');
    const value = await response.json(); if (!response.ok) throw new Error(`The live host rejected ${path} (${response.status}).`); return value;
  };
  const command = (type: string, payload: Record<string, unknown>, threadId?: string): Promise<CommandReceipt> => request('/api/commands', {id: randomUUID(), type, payload, ...(threadId ? {threadId} : {})}, type === 'run.stop') as Promise<CommandReceipt>;
  const send = (payload: Record<string, unknown>, threadId: string) => {report.execution.foregroundSubmissions++; return command('message.send', payload, threadId);};
  const base = '/api/projects/' + encodeURIComponent(options.projectId) + '/memory';
  const pause = async () => {await new Promise<void>(resolve => setTimeout(resolve, 250)); options.signal?.throwIfAborted();};
  const usage = async (recovery = false) => {
    const value = memoryUsageReportSchema.parse(await request(base + '/usage?threadId=' + encodeURIComponent(options.sourceThreadId!), undefined, recovery));
    if (!sourceScope || scopeKey(value.scope) !== scopeKey(sourceScope)) throw new Error('The auxiliary usage owner changed.');
    return value;
  };
  const auxiliaryCost = (value: MemoryUsageReport) => value.extraction.pending || value.consolidation.pending || value.extraction.cost === null || value.consolidation.cost === null ? null : value.extraction.cost + value.consolidation.cost;
  const settledUsage = async () => {
    const deadline = Date.now() + Math.min(timeoutMs, 30000); let value = await usage();
    while ((value.extraction.pending || value.consolidation.pending) && Date.now() < deadline) {await pause(); value = await usage();}
    return value;
  };
  const settled = async (threadId: string, priorAssistantIds: Set<string>) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted(); const snapshot = await request('/api/threads/' + encodeURIComponent(threadId) + '/snapshot') as Snapshot;
      const thread = snapshot.threads.find(value => value.id === threadId), messages = snapshot.messages.filter(value => value.threadId === threadId && value.role === 'assistant' && !priorAssistantIds.has(value.id));
      if (thread && !thread.runId && ['ready', 'completed'].includes(thread.status) && messages.length) return {snapshot, thread, messages};
      if (thread && ['failed', 'stopped', 'interrupted', 'awaiting_input'].includes(thread.status)) throw new Error('A live study task did not complete under its original authority.');
      await pause();
    }
    throw new Error('The live study task exceeded its deadline.');
  };
  try {
    const bootstrap = await request('/api/bootstrap') as { csrfToken: string }; csrf = bootstrap.csrfToken;
    const sourceSnapshot = await request('/api/threads/' + encodeURIComponent(options.sourceThreadId) + '/snapshot') as Snapshot;
    const source = sourceSnapshot.threads.find(value => value.id === options.sourceThreadId);
    if (!source || source.projectId !== options.projectId || source.modelId !== options.modelId || source.runId || !source.sessionPath || !['ready', 'completed'].includes(source.status) || source.sideParentId || source.kind === 'side' || source.kind === 'delegate') throw new Error('The fixture source must be settled and pinned to the explicitly selected project/model/account.');
    const models = await request('/api/models?threadId=' + encodeURIComponent(source.id)) as { models?: ModelInfo[] };
    const model = models.models?.find(value => value.id === options.modelId);
    if (!model || model.provider !== model.id.split('/')[0] || source.thinkingLevel && !model.thinkingLevels?.includes(source.thinkingLevel)) throw new Error('The explicitly selected model or pinned thinking level is unavailable.');
    const accountId = source.accountId ?? null, thinkingLevel = source.thinkingLevel ?? null;
    report.execution.providerId = model.provider; report.execution.accountId = accountId; report.execution.thinkingLevel = thinkingLevel;
    const checkThread = (thread: Thread) => {
      if (thread.projectId !== options.projectId || (thread.accountId ?? null) !== accountId || thread.modelId !== model.id || (thread.thinkingLevel ?? null) !== thinkingLevel || !thread.sessionPath || thread.sideParentId || thread.kind === 'side' || thread.kind === 'delegate') throw new Error('The task project, account, model, thinking level or native session changed.');
    };
    const checkSelection = async () => {
      const current = await request('/api/snapshot') as Snapshot;
      const selected = isConnectionProviderId(model.provider) ? current.settings.selectedAccounts?.[model.provider] ?? null : null;
      if (selected !== accountId) throw new Error('The selected account differs from the source. The study does not switch accounts.');
      const currentSource = current.threads.find(value => value.id === source.id); if (!currentSource || currentSource.runId) throw new Error('The fixture source is no longer settled.'); checkThread(currentSource);
    };
    await checkSelection();
    const view = projectMemoryViewSchema.parse(await request(base + '?threadId=' + encodeURIComponent(source.id)));
    const policies = view.items.filter(value => value.item.state === 'ACCEPTED');
    if (!view.available || !view.enabled || view.sourceThreadIds.length !== 1 || view.sourceThreadIds[0] !== source.id || policies.length !== 1 || policies[0].item.text !== MEMORY_STUDY_POLICY || policies[0].item.scope !== 'PROJECT') throw new Error('Use a dedicated opted-in fixture project with the exact reviewed policy and only its source conversation selected. No user project data is changed to make this condition pass.');
    if (view.scope.projectId !== options.projectId || view.scope.threadId !== source.id || view.scope.accountId !== accountId || policies[0].item.projectIdentity !== view.scope.projectIdentity) throw new Error('The policy source owner differs from the requested study.');
    sourceScope = view.scope; report.sourceCut = {scope: view.scope, item: policies[0].item};
    const pinned = {itemId: policies[0].item.id, revision: policies[0].item.revision};
    const preparedView = (value: unknown, thread: Thread, phase: MemoryPreparedRequest['phase']) => {
      const prepared = memoryPreparedRequestSchema.parse(value), recall = prepared.recall;
      if (prepared.scope.projectId !== options.projectId || prepared.scope.threadId !== thread.id || prepared.scope.accountId !== accountId || prepared.scope.projectIdentity !== view.scope.projectIdentity || prepared.phase !== phase || recall.requestId !== prepared.requestId || recall.contextGeneration !== prepared.contextGeneration || recall.projectIdentity !== prepared.scope.projectIdentity || prepared.items.length !== recall.selectedRevisions.length || new Set(prepared.items.map(item => item.id)).size !== prepared.items.length || prepared.items.some(item => item.state !== 'ACCEPTED' || item.projectIdentity !== view.scope.projectIdentity || !recall.selectedRevisions.some(ref => ref.itemId === item.id && ref.revision === item.revision)) || prepared.injectedBytes > recall.budgetBytes) throw new Error('The prepared request owner or recall evidence changed.');
      return prepared;
    };
    const checkPolicy = async () => {
      const current = projectMemoryViewSchema.parse(await request(base + '?threadId=' + encodeURIComponent(source.id)));
      const accepted = current.items.filter(row => row.item.state === 'ACCEPTED');
      if (!current.available || !current.enabled || scopeKey(current.scope) !== scopeKey(view.scope) || current.configRevision !== view.configRevision || JSON.stringify(current.sourceThreadIds) !== JSON.stringify(view.sourceThreadIds) || accepted.length !== 1 || JSON.stringify(accepted[0].item) !== JSON.stringify(policies[0].item)) throw new Error('The reviewed policy or selected source cut changed during the study.');
    };
    report.auxiliaryBefore = await settledUsage();
    if (report.auxiliaryBefore.extraction.pending || report.auxiliaryBefore.consolidation.pending) throw new Error('Fixture setup auxiliary work did not settle within the bounded wait.');
    report.status = 'RUNNING'; report.execution.providerCalls = null; report.gates = []; await save();
    for (const [index, test] of MEMORY_STUDY_CASES.entries()) {
      const arms = (index % 2 ? ['project-memory', 'thread-note-only'] : ['thread-note-only', 'project-memory']) as StudyRun['arm'][];
      for (const arm of arms) {
        options.signal?.throwIfAborted(); await checkSelection(); await checkPolicy();
        const thread = (await command('thread.create', {projectId: options.projectId, title: `M05 study ${test.id} ${arm}`})).result as Thread | undefined;
        if (!thread?.id || thread.id === source.id || report.warmups.some(value => value.threadId === thread.id) || thread.projectId !== options.projectId || thread.runId || thread.sessionPath || thread.modelId || thread.epoch !== 0 || thread.sideParentId || thread.kind === 'side' || thread.kind === 'delegate') throw new Error('The host did not create a fresh isolated study conversation.');
        activeThread = thread.id;
        await send({content: 'READY', modelId: options.modelId, thinkingLevel}, thread.id);
        const warmup = await settled(thread.id, new Set());
        checkThread(warmup.thread);
        const warmupRecall = preparedView(await request(base + '/requests/latest?threadId=' + encodeURIComponent(thread.id)), warmup.thread, 'CAPTURED');
        if (warmupRecall.injectedBytes !== 0 || warmupRecall.items.length || warmupRecall.recall.selectedRevisions.length) throw new Error('Warmup received project memory and would contaminate the control history.');
        if (warmup.snapshot.operations.some(value => value.threadId === thread.id) || warmup.snapshot.resources.some(value => value.threadId === thread.id && value.writable)) throw new Error('Warmup attempted an effect or gained a writable grant.');
        report.warmups.push({caseId: test.id, arm, threadId: thread.id, requestId: warmupRecall.requestId, sessionPath: warmup.thread.sessionPath!, reportedUsage: reportedUsage(warmup.snapshot.usage[thread.id])});
        if (arm === 'thread-note-only') await command('memory.save', {key: 'study-policy', baseRevision: 0, content: MEMORY_STUDY_POLICY}, thread.id);
        const prompt = `Format the next report using the approved project policy. Return only JSON with timestamp and amount, both strings. Do not edit files or execute actions. Input: ${JSON.stringify(test.input)}`;
        let prepared = preparedView(await request(base + '/requests/prepare', {threadId: thread.id, prompt, modelId: options.modelId, thinkingLevel}), warmup.thread, 'PREPARING');
        if (prepared.items.length !== 1 || JSON.stringify(prepared.items[0]) !== JSON.stringify(policies[0].item) || JSON.stringify(prepared.recall.selectedRevisions) !== JSON.stringify([pinned]) || Date.parse(prepared.expiresAt) <= Date.now()) throw new Error('Preparation did not select exactly the pinned policy revision.');
        if (arm === 'thread-note-only') {
          for (const selected of [...prepared.recall.selectedRevisions]) {
            const before = prepared;
            prepared = preparedView(await request(base + '/requests/' + encodeURIComponent(prepared.requestId) + '/exclude', {scope: prepared.scope, contextGeneration: prepared.contextGeneration, itemId: selected.itemId, revision: selected.revision}), warmup.thread, 'PREPARING');
            if (scopeKey(prepared.scope) !== scopeKey(before.scope) || prepared.requestId !== before.requestId || prepared.contextGeneration !== before.contextGeneration || prepared.recall.queryDigest !== before.recall.queryDigest || prepared.items.some(item => item.id === selected.itemId) || !prepared.recall.exclusions.some(value => value.itemId === selected.itemId)) throw new Error('The exclusion was not acknowledged for the exact prepared request.');
          }
          if (prepared.injectedBytes || prepared.items.length || prepared.recall.selectedRevisions.length) throw new Error('Control request still contains project memory.');
        }
        const started = performance.now();
        await send({content: prompt, modelId: options.modelId, thinkingLevel, requestContextId: prepared.requestId}, thread.id);
        const completed = await settled(thread.id, new Set(warmup.snapshot.messages.filter(value => value.role === 'assistant').map(value => value.id)));
        checkThread(completed.thread); if (completed.thread.sessionPath !== warmup.thread.sessionPath) throw new Error('The native conversation changed after its warmup.');
        const captured = preparedView(await request(base + '/requests/latest?threadId=' + encodeURIComponent(thread.id)), completed.thread, 'CAPTURED');
        // Admission changes the epoch/run binding. Persisted recall retains
        // numeric evidence and exact revisions, but never plaintext match terms.
        const persistedRecall = {...prepared.recall, scores: prepared.recall.scores.map(score => ({...score, matchedTerms: []}))};
        if (ownerKey(captured.scope) !== ownerKey(prepared.scope) || captured.requestId !== prepared.requestId || captured.contextGeneration !== prepared.contextGeneration || captured.injectedBytes !== prepared.injectedBytes || JSON.stringify(captured.recall) !== JSON.stringify(persistedRecall) || JSON.stringify(captured.items) !== JSON.stringify(prepared.items)) throw new Error('Captured request differs from the exact reviewed preparation.');
        if (completed.snapshot.operations.some(value => value.threadId === thread.id) || completed.snapshot.resources.some(value => value.threadId === thread.id && value.writable)) throw new Error('A study task attempted an effect or gained a writable grant.');
        const output = completed.messages.map(value => value.content).join('\n');
        if (Buffer.byteLength(output) > 16384) throw new Error('A study output exceeded the reporting bound.');
        report.runs.push({caseId: test.id, arm, threadId: thread.id, requestId: captured.requestId, contextGeneration: captured.contextGeneration, ...scoreMemoryStudyOutput(test, output), injectedBytes: captured.injectedBytes, selectedRevisions: captured.recall.selectedRevisions, output, elapsedMs: performance.now() - started, foregroundCost: null, inputTokens: null, outputTokens: null, reportedUsage: reportedUsage(completed.snapshot.usage[thread.id]), sessionPath: completed.thread.sessionPath!, modelId: model.id, accountId, thinkingLevel});
        activeThread = null; await save();
      }
    }
    report.auxiliaryAfter = await settledUsage();
    const average = (arm: StudyRun['arm']) => report.runs.filter(run => run.arm === arm).reduce((sum, run) => sum + Number(run.correct), 0) / MEMORY_STUDY_CASES.length;
    const spend = report.auxiliaryAfter;
    if (spend.retrieval.requests < report.auxiliaryBefore.retrieval.requests || spend.retrieval.injectedBytes < report.auxiliaryBefore.retrieval.injectedBytes || spend.retrieval.latencyMs < report.auxiliaryBefore.retrieval.latencyMs || spend.extraction.modelCalls < report.auxiliaryBefore.extraction.modelCalls || spend.consolidation.modelCalls < report.auxiliaryBefore.consolidation.modelCalls) throw new Error('The cumulative project usage counters moved backwards.');
    for (const phase of ['extraction', 'consolidation'] as const) for (const field of ['cost', 'inputTokens', 'outputTokens'] as const) {
      const before = report.auxiliaryBefore[phase][field], after = spend[phase][field];
      if (before !== null && after !== null && after < before) throw new Error('The cumulative auxiliary measurements moved backwards.');
    }
    report.summary = {controlCorrectness: average('thread-note-only'), treatmentCorrectness: average('project-memory'), recallUsefulness: report.runs.filter(run => run.arm === 'project-memory').reduce((sum, run) => sum + Number(run.correct && run.selectedRevisions.some(ref => ref.itemId === pinned.itemId && ref.revision === pinned.revision)), 0) / MEMORY_STUDY_CASES.length, totalAuxiliaryCost: auxiliaryCost(spend), injectedBytes: report.runs.reduce((sum, run) => sum + run.injectedBytes, 0), retrievalLatencyMs: spend.retrieval.latencyMs - report.auxiliaryBefore.retrieval.latencyMs};
    report.status = report.summary.totalAuxiliaryCost === null ? 'INCOMPLETE_COST' : 'EXECUTED';
    if (report.status === 'INCOMPLETE_COST') report.gates.push('The provider did not report all auxiliary charges or cleanup remains pending.');
  } catch (error) {
    if (activeThread) await command('run.stop', {}, activeThread).catch(() => {});
    if (sourceScope) {try {report.auxiliaryAfter = await usage(true); report.summary.totalAuxiliaryCost = auxiliaryCost(report.auxiliaryAfter);} catch { /* Keep the missing measurement unknown. */ }}
    report.status = report.runs.length ? 'PARTIAL' : 'SETUP_FAILED'; report.gates.push(error instanceof Error ? error.message : 'The live study failed.');
  }
  return save();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {if (!['--out', '--host', '--model', '--project', '--source-thread'].includes(args[index]) || !args[index + 1]) throw new Error('Use --out NEW_DIRECTORY [--host ACTUAL_ORIGIN --model ACTUAL_ID --project DISPOSABLE_PROJECT_ID --source-thread SOURCE_THREAD_ID].'); values[args[index]] = args[index + 1];}
  const control = new AbortController(); process.once('SIGINT', () => control.abort()); process.once('SIGTERM', () => control.abort());
  runMemoryStudy({destination: values['--out'], host: values['--host'], modelId: values['--model'], projectId: values['--project'], sourceThreadId: values['--source-thread'], signal: control.signal}).then(report => {console.log(JSON.stringify({status: report.status, summary: report.summary, gates: report.gates}, null, 2)); if (report.status !== 'EXECUTED') process.exitCode = 2;}, error => {console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;});
}
