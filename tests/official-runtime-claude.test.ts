import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent, StartRun } from '../packages/contracts/index.ts';
import { createOfficialRuntime, type OfficialRuntimeDependencies } from '../packages/runtime-official/index.ts';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function queue<T>() { const values: T[] = []; let wake = deferred<void>(); let stopped = false; return { push(value: T) { values.push(value); wake.resolve(); }, stop() { stopped = true; wake.resolve(); }, async *[Symbol.asyncIterator]() { while (!stopped) { if (!values.length) { await wake.promise; wake = deferred<void>(); } while (values.length) yield values.shift()!; } } }; }
function scripted(account: Record<string, unknown> = { apiProvider: 'firstParty', subscriptionType: 'Claude Max', apiKeySource: 'none' }) {
  const events = queue<any>();
  const accepted: any[] = [];
  let options: any;
  let closeCount = 0;
  let hold: Promise<void> | undefined;
  const flagSettings:any[]=[];
  const query = vi.fn(({ prompt, options: opts }: any) => {
    options = opts;
    void (async () => { for await (const input of prompt) accepted.push(input); })();
    return Object.assign(events[Symbol.asyncIterator](), {
      accountInfo: vi.fn(async () => { await hold; return account; }),
      supportedModels: vi.fn(async () => [{ value: 'advertised-model', displayName: 'Official model', description: '', supportedEffortLevels:['low','high'] }]),
      supportedCommands: vi.fn(async () => [{ name: 'compact', description: '' }]),
      setModel: vi.fn(async () => {}),
      applyFlagSettings:vi.fn(async value=>{flagSettings.push(value);}),
      getContextUsage: vi.fn(async () => ({ totalTokens: 12, maxTokens: 100, categories: [] })),
      interrupt: vi.fn(async () => ({})), close() { closeCount++; events.stop(); },
    });
  });
  const dependencies: OfficialRuntimeDependencies = { claudeSdk: { query } as any, claudeHistory: async () => [] };
  return { events, accepted, dependencies, query, flagSettings, get options() { return options; }, get closeCount() { return closeCount; }, hold(value: Promise<void>) { hold = value; } };
}
const run = (extra: Partial<StartRun> = {}): StartRun => ({ threadId: 'thread', runId: 'run-1', epoch: 1, modelId: 'claude-code/advertised-model', inputId: 'input-1', prompt: 'hello', resources: [], sessionPath: null, ...extra });

describe('official Claude SDK runtime', () => {
  it.each(['high',null])('applies the selected effort %s before submitting input',async thinkingLevel=>{
    const fake=scripted(),runtime=createOfficialRuntime({dataDir:await mkdtemp(join(tmpdir(),'official-effort-'))},fake.dependencies);
    runtime.configure({onEvent(){},onTool:async()=>null});
    try{await runtime.start(run({thinkingLevel}));expect(fake.flagSettings).toEqual([{effortLevel:thinkingLevel}]);}
    finally{await runtime.dispose();}
  });
  it('settles and closes when the SDK stream ends unexpectedly without consuming input',async()=>{
    const fake=scripted(),events:RuntimeEvent[]=[],runtime=createOfficialRuntime({dataDir:await mkdtemp(join(tmpdir(),'official-stream-failure-'))},fake.dependencies);
    runtime.configure({onEvent:event=>events.push(event),onTool:async()=>null});
    try{await runtime.start(run());fake.events.stop();await vi.waitFor(()=>expect(events.some(event=>event.type==='error')).toBe(true));await vi.waitFor(()=>expect(events.some(event=>event.type==='settled')).toBe(true));expect(events.some(event=>event.type==='input.processing')).toBe(false);}
    finally{await runtime.dispose();}
  });
  it('shares pending model discovery, returns copies and refreshes only explicitly',async()=>{
    const barrier=deferred<void>(),instances:ReturnType<typeof scripted>[]=[];
    const query=vi.fn((args:any)=>{const fake=scripted();fake.hold(barrier.promise);instances.push(fake);return fake.query(args);});
    const runtime=createOfficialRuntime({dataDir:await mkdtemp(join(tmpdir(),'official-discovery-'))},{claudeSdk:{query} as any});
    runtime.configure({onEvent(){},onTool:async()=>null});
    try{const first=runtime.models(),second=runtime.models();await vi.waitFor(()=>expect(query).toHaveBeenCalledOnce());barrier.resolve();const [a,b]=await Promise.all([first,second]);expect(a).toEqual(b);a[0].name='local mutation';expect((await runtime.models())[0].name).toBe('Official model');expect(query).toHaveBeenCalledOnce();await runtime.models({refresh:true});expect(query).toHaveBeenCalledTimes(2);}
    finally{barrier.resolve();await runtime.dispose();}
  });
  it('keeps streaming input empty until account and advertised model validation finish', async () => {
    const fake = scripted(); const barrier = deferred<void>(); fake.hold(barrier.promise);
    const runtime = createOfficialRuntime({ dataDir: await mkdtemp(join(tmpdir(), 'official-claude-')) }, fake.dependencies);
    runtime.configure({ onEvent: () => {}, onTool: async () => null });
    const starting = runtime.start(run({ prompt: 'User literal @C:/private/file.txt' }));
    await vi.waitFor(() => expect(fake.query).toHaveBeenCalledOnce());
    expect(fake.accepted).toHaveLength(0);
    expect(fake.options).toMatchObject({ tools: [], settingSources: [], strictMcpConfig: true, skills: [], plugins: [], agents: {} });
    expect(fake.options.allowedTools).toBeUndefined();
    const denied = await fake.options.canUseTool('Bash', { command: 'unsafe' }, {});
    expect(denied.behavior).toBe('deny');
    barrier.resolve(); await starting;
    await vi.waitFor(() => expect(fake.accepted).toHaveLength(1));
    expect(fake.accepted[0].message.content).not.toContain('@');
    expect(fake.accepted[0].message.content).toContain('\\u0040');
    await runtime.dispose();
  });

  it.each([
    { apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY', subscriptionType: 'Claude Max' },
    { apiProvider: 'bedrock', subscriptionType: 'Claude Max' },
    { apiProvider: 'firstParty', tokenSource: 'unknown', subscriptionType: 'Claude Max' },
    { apiProvider: 'firstParty', apiKeySource: 'none' },
  ])('rejects API billing and unknown auth context before prompt: %j', async account => {
    const fake = scripted(account);
    const runtime = createOfficialRuntime({ dataDir: await mkdtemp(join(tmpdir(), 'official-claude-')) }, fake.dependencies);
    runtime.configure({ onEvent: () => {}, onTool: async () => null });
    await expect(runtime.start(run())).rejects.toMatchObject({ code: 'OFFICIAL_SUBSCRIPTION_REQUIRED' });
    expect(fake.accepted).toHaveLength(0); expect(fake.closeCount).toBeGreaterThan(0);
    await runtime.dispose();
  });

  it('rejects an unadvertised model before delivering any input', async () => {
    const fake = scripted(); const runtime = createOfficialRuntime({ dataDir: await mkdtemp(join(tmpdir(), 'official-claude-')) }, fake.dependencies);
    runtime.configure({ onEvent: () => {}, onTool: async () => null });
    await expect(runtime.start(run({ modelId: 'claude-code/invented-model' }))).rejects.toMatchObject({ code: 'OFFICIAL_MODEL_UNAVAILABLE' });
    expect(fake.accepted).toHaveLength(0); await runtime.dispose();
  });

  it('revokes cancellation registered during startup and suppresses late SDK events', async () => {
    const fake = scripted(); const barrier = deferred<void>(); fake.hold(barrier.promise);
    const runtime = createOfficialRuntime({ dataDir: await mkdtemp(join(tmpdir(), 'official-claude-')) }, fake.dependencies);
    const events: RuntimeEvent[] = []; runtime.configure({ onEvent: event => events.push(event), onTool: async () => null });
    const starting = runtime.start(run()).catch(error => error);
    await vi.waitFor(() => expect(fake.query).toHaveBeenCalledOnce());
    const cancelling = runtime.cancel(run()); barrier.resolve(); await cancelling;
    expect(await starting).toMatchObject({ code: 'OFFICIAL_RUN_ABORTED' });
    fake.events.push({ type: 'assistant', session_id: 'late', message: { content: [{ type: 'text', text: 'stale' }] } });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fake.accepted).toHaveLength(0);
    expect(events.filter(event => event.type === 'settled')).toHaveLength(1);
    expect(events.some(event => event.type === 'assistant.message')).toBe(false);
    await runtime.dispose();
  });

  it('acknowledges only observed input UUIDs and snapshots the actual response batch', async () => {
    const fake = scripted(); const dataDir = await mkdtemp(join(tmpdir(), 'official-claude-'));
    const runtime = createOfficialRuntime({ dataDir }, fake.dependencies);
    const events: RuntimeEvent[] = []; runtime.configure({ onEvent: event => events.push(event), onTool: async () => null });
    await runtime.start(run()); await runtime.followUp(run({ inputId: 'input-2', prompt: 'follow-up' }));
    await vi.waitFor(() => expect(fake.accepted).toHaveLength(2));
    expect(events.some(event => event.type === 'input.processing')).toBe(false);
    const first = fake.accepted[0];
    fake.events.push({ type: 'assistant', session_id: fake.options.sessionId, parent_tool_use_id: null, user_message_uuids: [first.uuid], message: { id: 'response', content: [{ type: 'text', text: 'first answer' }] } });
    await vi.waitFor(() => expect(events.some(event => event.type === 'assistant.message')).toBe(true));
    expect(events.find(event => event.type === 'assistant.message')?.inputIds).toEqual(['input-1']);
    expect(events.filter(event => event.type === 'input.processing').flatMap(event => event.inputIds)).toEqual(['input-1']);
    const sessionPath = String(events.find(event => event.type === 'session')?.sessionPath);
    expect(await runtime.history(sessionPath)).toEqual(['input-1']);
    const manifest = JSON.parse(await readFile(sessionPath, 'utf8'));
    expect(Object.values(manifest.inputs).filter((input: any) => input.observed)).toHaveLength(1);
    fake.events.push({ type: 'result', subtype: 'success', session_id: fake.options.sessionId, user_message_uuids: [first.uuid], queued_turn_count: 1 });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(events.some(event => event.type === 'settled')).toBe(false);
    const second = fake.accepted[1];
    fake.events.push({ type: 'result', subtype: 'success', session_id: fake.options.sessionId, user_message_uuids: [second.uuid], queued_turn_count: 0 });
    await vi.waitFor(() => expect(events.some(event => event.type === 'settled')).toBe(true));
    expect(events.find(event => event.type === 'settled')).not.toHaveProperty('inputIds');
    expect(await runtime.history(sessionPath)).toEqual(['input-1', 'input-2']);
    expect(events.filter(event => event.type === 'usage').every(event => (event.usage as any).cost === null)).toBe(true);
    await runtime.dispose();
  });

  it('retains failed-delivery single-UUID results without acknowledging queued input', async () => {
    const fake = scripted(); const runtime = createOfficialRuntime({ dataDir: await mkdtemp(join(tmpdir(), 'official-claude-')) }, fake.dependencies);
    const events: RuntimeEvent[] = []; runtime.configure({ onEvent: event => events.push(event), onTool: async () => null });
    await runtime.start(run()); await vi.waitFor(() => expect(fake.accepted).toHaveLength(1));
    fake.events.push({ type: 'result', subtype: 'error_during_execution', session_id: fake.options.sessionId, user_message_uuid: fake.accepted[0].uuid, queued_turn_count: 0, errors: ['delivery failed'] });
    await vi.waitFor(() => expect(events.some(event => event.type === 'settled')).toBe(true));
    expect(events.some(event => event.type === 'input.processing')).toBe(false);
    expect(await runtime.history(String(events.find(event => event.type === 'session')?.sessionPath))).toEqual([]);
    await runtime.dispose();
  });
});
