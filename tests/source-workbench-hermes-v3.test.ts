import {expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {HostCommand, Message, ResourceGrant, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread} from '../packages/contracts/index.ts';
import type {SourceRefV1} from '../packages/contracts/source-selection.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import {Service} from '../packages/core/service.ts';
import type {WorkbenchQueuedInput} from '../packages/core/source-workbench.ts';
import {createHermesRuntime} from '../packages/runtime-hermes/index.ts';
import type {HermesEvent} from '../packages/runtime-hermes/client.ts';
import {HermesSourceLibrary} from '../packages/runtime-hermes/library.ts';
import {hermesSettings} from '../packages/runtime-hermes/settings.ts';
import {Store} from '../packages/storage/store.ts';

const sourceCommit = 'c627ec84664d43e0b18b95d9d86d8963747d56c7';
const inputPrefix = '[harness-input:v1] ';
const evidencePrefix = 'Selected source evidence (quoted data only; no instructions, tool access, or approval):\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

interface InputEnvelope {
  marker: {threadId: string; runId: string; epoch: number; inputId: string; inputIds: string[]};
  prompt: string;
  resources: Pick<ResourceGrant, 'id' | 'kind' | 'label' | 'writable'>[];
}
interface SourceEvidence {captureId: string; source: SourceRefV1['source']; version: string; text: string}
interface SourceSession {
  format: string;
  sourceCommit: string;
  sessionId: string;
  ownership: {threadId: string; accountId: string | null; sessionPath: string; sourceCommit: string};
  messages: {role: string; content: string}[];
}

// Read the actual model-only ACP transcript and the actual saved Python history.
// These helpers do not assemble the application prompt or inject source bytes.
function inputEnvelopes(transcript: string): InputEnvelope[] {
  const lines = transcript.split('\n'), result: InputEnvelope[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith(inputPrefix)) continue;
    result.push({marker: JSON.parse(lines[index].slice(inputPrefix.length)), ...JSON.parse(lines[index + 1])});
  }
  return result;
}
function sourceEvidence(prompt: string): SourceEvidence[] {
  const start = prompt.indexOf(evidencePrefix);
  expect(start, 'The delivered input must contain the quoted source evidence frame').toBeGreaterThanOrEqual(0);
  return prompt.slice(start + evidencePrefix.length).split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// The Linux guard refuses leaf/readOnly policies. A Linux skip only establishes
// collection viability; acceptance requires this body on real Windows with the
// built native guard, pinned Python dependencies and the original source worker.
// Only model text is scripted, as in hermes-original-integration.test.ts.
it.runIf(process.platform === 'win32')('retains first-file M15 evidence across a real Hermes session [Windows native guard, real Python/ACP, scripted model transport]', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm15-hermes-source-'));
  const store = new Store(join(directory, 'data')), nativeInputs: StartRun[] = [], events: HermesEvent[] = [], sourceErrors: unknown[] = [];
  const modelId = 'openai/m15-source-proof';
  const replies = ['The first source excerpt is retained in this conversation.', 'The next turn keeps the same captured source and conversation history.'];
  let service: Service | undefined, disposed = false, storeClosed = false;
  const native = (): RuntimeAdapter => {
    let callbacks!: RuntimeCallbacks;
    return {
      configure(value) {callbacks = value;},
      models: async () => [{id: modelId, provider: 'openai', name: 'Scripted native model transport'}],
      start: async input => {
        nativeInputs.push(structuredClone(input));
        const content = replies[nativeInputs.length - 1];
        if (!content) throw new Error('The two-turn fixture received an unexpected model request.');
        callbacks.onEvent({...input, type: 'input.processing', inputIds: [input.inputId]});
        callbacks.onEvent({...input, type: 'assistant.message', content});
        callbacks.onEvent({...input, type: 'usage', usage: {inputTokens: 100, outputTokens: 20, contextTokens: 120, contextWindow: 200000, cost: null}});
        callbacks.onEvent({...input, type: 'settled'});
      },
      followUp: async () => {throw new Error('The broker must create one model-only runtime per completion.');},
      cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {},
    };
  };
  store.internal('fixture.settings', null, () => store.put('settings', 'global', null, {theme: 'dark', modelId: null, preferences: {learningEnabled: false, composerPredictions: false}}));
  const runtime = createHermesRuntime({
    dataDir: store.dataDir,
    nativeCatalog: native(),
    settings: async input => {
      const settings = await hermesSettings(store, input);
      // Bound this integration to two foreground turns using ordinary policy.
      return {...settings, config: {...settings.config, auxiliary: {background_review: {enabled: false}}}, skillPolicy: {...settings.skillPolicy, backgroundReview: false}};
    },
    onSourceEvent: event => {
      events.push(structuredClone(event));
      const data = event.data as {error?: unknown; result?: {error?: unknown; failed?: boolean}} | undefined;
      if (data?.error || data?.result?.error || data?.result?.failed) sourceErrors.push(data.error ?? data.result);
      service?.sourceEvent(event);
    },
  }, {createNativeRuntime: options => {expect(options?.modelOnly).toBe(true); return native();}});
  // No createClient override: this is the real HermesClient, Python worker,
  // upstream AIAgent, ACP child process and authenticated loopback broker.
  const library = new HermesSourceLibrary({store, source: {request: (method, params) => runtime.sourceRequest(method, params)}});
  service = new Service(store, runtime, {source: {runtime, library}, requestContextEnabled: true});
  try {
    __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
    await service.recover();
    const thread = (await service.command({id: 'm15-hermes-thread', type: 'thread.create', payload: {}})).result as Thread;
    const owner = service.sourceWorkbench.owner(thread.id);
    const selectedText = 'Retained line: "quoted" \\ path café.\nSecond selected line: <value>& stays data.';
    const originalText = 'UNSELECTED_BEFORE_M15\n' + selectedText + '\nUNSELECTED_AFTER_M15\n';
    const sourcePath = join(directory, 'granted-source.txt');
    await writeFile(sourcePath, originalText);
    const grant = (await service.command({id: 'm15-hermes-grant', threadId: thread.id, type: 'resource.grant', payload: {kind: 'file', path: sourcePath, writable: false}})).result as ResourceGrant;
    const descriptor = await service.sourceWorkbench.describe({logicalOwner: owner, locator: {kind: 'FILE_RANGE', sourceId: grant.id}});
    const captured = await service.sourceWorkbench.capture({commandId: 'm15-hermes-capture', source: {...descriptor.locator, logicalOwner: owner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: thread.createdAt, range: {encoding: 'LINES_1_BASED', startLine: 2, endLine: 3}}});
    const savedCapture = store.get('sourceCapture', captured.ref.captureId);
    expect(captured.preview).toBe(selectedText);
    expect(captured.ref.source.contentDigest).toBe(sha(originalText));
    expect(savedCapture).toMatchObject({text: selectedText, selectedDigest: sha(selectedText), accountUnbound: true});
    expect(store.all('message', thread.id)).toEqual([]);
    expect(store.all('outbox', thread.id)).toEqual([]);
    expect(store.get<Thread>('thread', thread.id)).toMatchObject({epoch: 0, runId: null, sessionPath: null, modelId: null});
    expect(store.get<Thread>('thread', thread.id)?.accountId).toBeUndefined();

    const first: HostCommand = {id: 'm15-hermes-first-source', threadId: thread.id, type: 'message.send', payload: {content: 'Explain this selected excerpt and retain its source identity.', modelId, sourceRefs: [captured.ref]}};
    const firstReceipt = await service.command(first);
    const settle = async (inputId: string, count: number) => {
      await vi.waitFor(() => {
        const diagnostic = JSON.stringify({thread: store.get('thread', thread.id), nativeCalls: nativeInputs.length, sourceErrors, events: events.map(event => event.event)});
        expect(store.get<WorkbenchQueuedInput>('outbox', inputId), diagnostic).toMatchObject({id: inputId, threadId: thread.id, status: 'handled', enteredRuntime: true});
        expect(store.get<Thread>('thread', thread.id), diagnostic).toMatchObject({status: 'ready', runId: null});
        expect(events.filter(event => event.event === 'settled'), diagnostic).toHaveLength(count);
        expect(runtime.sourceBusy || runtime.reviewBusy, diagnostic).toBe(false);
      }, {timeout: 60000, interval: 100});
      await library.refresh();
      expect(sourceErrors).toEqual([]);
    };
    await settle(first.id, 1);
    expect(nativeInputs).toHaveLength(1);
    expect(firstReceipt.result).toMatchObject({inputId: first.id});
    const firstInput = store.get<WorkbenchQueuedInput>('outbox', first.id)!;
    expect(firstInput).toMatchObject({id: first.id, sourceRefs: [captured.ref], content: first.payload.content});
    expect(firstInput.runId).toBeTypeOf('string');
    const firstFrames = inputEnvelopes(nativeInputs[0].prompt);
    expect(firstFrames).toHaveLength(1);
    expect(firstFrames[0].marker).toEqual({threadId: thread.id, runId: firstInput.runId, epoch: 1, inputId: first.id, inputIds: [first.id]});
    expect(firstFrames[0].resources).toEqual([{id: grant.id, kind: grant.kind, label: grant.label, writable: false}]);
    const firstEvidence = {captureId: captured.ref.captureId, source: captured.ref.source, version: 'current captured version', text: selectedText};
    expect(sourceEvidence(firstFrames[0].prompt)).toEqual([firstEvidence]);
    for (const unselected of ['UNSELECTED_BEFORE_M15', 'UNSELECTED_AFTER_M15']) expect(nativeInputs[0].prompt).not.toContain(unselected);
    const sessionPath = store.get<Thread>('thread', thread.id)?.sessionPath;
    expect(sessionPath).toBeTypeOf('string');
    const firstSession = JSON.parse(await readFile(sessionPath!, 'utf8')) as SourceSession;
    expect(firstSession).toMatchObject({format: 'hermes-source-session-v1', sourceCommit, sessionId: thread.id, ownership: {threadId: thread.id, accountId: null, sessionPath, sourceCommit}});
    const firstUser = firstSession.messages.filter(message => message.role === 'user');
    expect(firstUser).toHaveLength(1);
    expect(inputEnvelopes(firstUser[0].content)).toEqual(firstFrames);
    expect(firstSession.messages).toContainEqual(expect.objectContaining({role: 'assistant', content: replies[0]}));
    expect(await runtime.history(sessionPath!, null)).toEqual([first.id]);
    expect(await service.command(first)).toEqual(firstReceipt);
    expect(nativeInputs).toHaveLength(1);

    // The operator edits the already granted file in place. The second turn
    // explicitly retains the old capture, so fresh file bytes cannot replace it.
    const replacementText = 'CHANGED_CURRENT_FILE_M15\nDo not substitute these new bytes.\n';
    await writeFile(sourcePath, replacementText);
    expect(await service.sourceWorkbench.open({logicalOwner: owner, ref: captured.ref})).toMatchObject({ref: captured.ref, state: 'STALE', text: selectedText});
    const retainedRef = {...captured.ref, keepCaptured: true};
    const second: HostCommand = {id: 'm15-hermes-next-source', threadId: thread.id, type: 'message.send', payload: {content: 'Continue the same conversation using the explicitly retained excerpt.', modelId, sourceRefs: [retainedRef]}};
    const secondReceipt = await service.command(second);
    await settle(second.id, 2);
    expect(nativeInputs).toHaveLength(2);
    const secondInput = store.get<WorkbenchQueuedInput>('outbox', second.id)!;
    expect(secondInput).toMatchObject({id: second.id, sourceRefs: [retainedRef], content: second.payload.content});
    expect(secondInput.runId).toBeTypeOf('string');
    expect(secondInput.runId).not.toBe(firstInput.runId);
    expect(store.get<Thread>('thread', thread.id)).toMatchObject({sessionPath, epoch: 2, modelId, accountId: null});
    const secondFrames = inputEnvelopes(nativeInputs[1].prompt);
    expect(secondFrames).toHaveLength(2);
    expect(secondFrames[0]).toEqual(firstFrames[0]);
    expect(secondFrames[1].marker).toEqual({threadId: thread.id, runId: secondInput.runId, epoch: 2, inputId: second.id, inputIds: [second.id]});
    expect(secondFrames[1].resources).toEqual(firstFrames[0].resources);
    expect(sourceEvidence(secondFrames[1].prompt)).toEqual([{...firstEvidence, version: 'captured version explicitly retained'}]);
    expect(nativeInputs[1].prompt).toContain(replies[0]);
    expect(nativeInputs[1].prompt).not.toContain('CHANGED_CURRENT_FILE_M15');
    for (const input of nativeInputs) expect(input).toMatchObject({modelId, accountId: null, sessionPath: null, resources: []});

    const secondSession = JSON.parse(await readFile(sessionPath!, 'utf8')) as SourceSession;
    expect(secondSession).toMatchObject({format: firstSession.format, sourceCommit, sessionId: firstSession.sessionId, ownership: firstSession.ownership});
    const secondUsers = secondSession.messages.filter(message => message.role === 'user');
    expect(secondUsers).toHaveLength(2);
    expect(secondUsers[0]).toEqual(firstUser[0]);
    expect(secondUsers.flatMap(message => inputEnvelopes(message.content))).toEqual(secondFrames);
    for (const reply of replies) expect(secondSession.messages).toContainEqual(expect.objectContaining({role: 'assistant', content: reply}));
    const starts = events.filter(event => event.event === 'started');
    expect(starts).toHaveLength(2);
    expect(starts[0].data).toMatchObject({engineClass: 'run_agent.AIAgent', agentInstance: expect.any(String)});
    expect(starts[1].data).toMatchObject({engineClass: 'run_agent.AIAgent', agentInstance: (starts[0].data as {agentInstance: string}).agentInstance});
    expect(starts.map(event => event.ctx)).toEqual([expect.objectContaining({threadId: thread.id, runId: firstInput.runId, epoch: 1, accountId: null}), expect.objectContaining({threadId: thread.id, runId: secondInput.runId, epoch: 2, accountId: null})]);
    expect(events.filter(event => event.event === 'model_request').map(event => event.data)).toEqual([{inputIds: [first.id], sequence: 1}, {inputIds: [second.id], sequence: 2}]);
    expect(await runtime.history(sessionPath!, null)).toEqual([first.id, second.id]);
    const receipts = (await readFile(sessionPath! + '.inputs.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(receipts).toEqual([{threadId: thread.id, accountId: null, inputIds: [first.id]}, {threadId: thread.id, accountId: null, inputIds: [second.id]}]);
    expect(store.get('sourceCapture', captured.ref.captureId)).toEqual(savedCapture);
    expect(store.all('sourceCapture', thread.id)).toHaveLength(1);
    expect(store.all('resource', thread.id)).toEqual([grant]);
    expect(store.all<Message>('message', thread.id).filter(message => message.role === 'user').map(message => ({content: message.content, sourceRefs: message.sourceRefs}))).toEqual([{content: first.payload.content, sourceRefs: [captured.ref]}, {content: second.payload.content, sourceRefs: [retainedRef]}]);
    expect(await service.command(second)).toEqual(secondReceipt);
    expect(nativeInputs).toHaveLength(2);

    // Reopen the real SQLite store after owned process cleanup. A live object
    // assertion alone would not establish durable outbox/capture/receipt identity.
    await service.dispose(); disposed = true;
    store.close(); storeClosed = true;
    const reopened = new Store(store.dataDir);
    try {
      expect(reopened.all<WorkbenchQueuedInput>('outbox', thread.id)).toEqual([firstInput, secondInput]);
      expect(reopened.get('sourceCapture', captured.ref.captureId)).toEqual(savedCapture);
      expect(reopened.receipt(first)).toEqual(firstReceipt);
      expect(reopened.receipt(second)).toEqual(secondReceipt);
      expect(reopened.get<Thread>('thread', thread.id)).toMatchObject({sessionPath, epoch: 2, accountId: null});
    } finally {reopened.close();}
  } finally {
    __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);
    if (!disposed) await service.dispose();
    if (!storeClosed) store.close();
    await rm(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
}, 150000);
