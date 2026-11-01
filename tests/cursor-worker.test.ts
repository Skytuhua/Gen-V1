import { mkdtemp, mkdir, readFile, rmdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { runCursorWorker } from '../packages/runtime-official/cursor-worker.ts';
import { assertCursorLoginUrl, cursorCredentialStore } from '../packages/runtime-official/cursor-credentials.ts';

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'cursor-worker-'));
  const home = join(dataDir, 'official', 'cursor-sdk', 'home');
  const taskDir = join(dataDir, 'official', 'cursor-sdk', 'tasks', 'fixture');
  await mkdir(home, { recursive: true }); await mkdir(join(taskDir, 'native-history'), { recursive: true });
  await writeFile(join(home, 'sdk-browser-login.json'), JSON.stringify({ version: 1, provenance: 'cursor-sdk-official-browser', credentials: { version: 1, backendUrl: 'https://api2.cursor.sh', apiKey: 'private-browser-user-key', apiKeyExpiresAtMs: Date.now() + 60_000, createdAtMs: Date.now() } }));
  return { dataDir, taskDir, home };
}
function nativeSdk(modelOnly=false) {
  let options: any; let rows: any[] = []; const sent: any[] = []; const calls: string[] = [];
  const agent = { agentId: 'agent-native', close: vi.fn(), send: vi.fn(async (text, opts) => {
    sent.push({ text, opts });
    return { id: 'run-native', agentId: 'agent-native', async *stream() {
      yield { type: 'system', subtype: 'init', agent_id: 'agent-native', run_id: 'run-native', tools: modelOnly?[]:['mcp'] };
      yield { type: 'user', agent_id: 'agent-native', run_id: 'run-native', message: { role: 'user', content: [{ type: 'text', text }] } };
      yield { type: 'assistant', agent_id: 'agent-native', run_id: 'run-native', message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }] } };
    }, wait: async () => ({ id: 'run-native', status: 'finished', usage: { inputTokens: 7, outputTokens: 2 } }), cancel: vi.fn() };
  }) };
  const sdk: any = {
    Cursor: { auth: { status: async ({ store }: any) => { calls.push('status'); const value = await store.load(); return value ? { status: 'logged-in', backendUrl: value.backendUrl } : { status: 'logged-out' }; }, login: vi.fn() }, me: async () => { calls.push('me'); return { userId: 42 }; }, models: { list: async () => { calls.push('models'); return [{ id: 'native-model', displayName: 'Native model' }]; } } },
    JsonlLocalAgentStore: class { agents = { get: async () => ({ agentId: 'agent-native', cwd: dirname(this.path) }) }; constructor(public path: string) {} },
    Agent: { create: vi.fn(async opt => { calls.push('create'); options = opt; return agent; }), resume: vi.fn(async (_id, opt) => { calls.push('resume'); options = opt; return agent; }), messages: { list: vi.fn(async () => rows) } },
  };
  return { sdk, agent, calls, sent, get options() { return options; }, set rows(value: any[]) { rows = value; } };
}
const wire = { uuid: 'wire-uuid', text: '[harness-input:v1] {"inputId":"input-1","inputIds":["input-1"],"threadId":"thread","runId":"run-host","epoch":3}\n{"prompt":"hello","resources":[]}', inputIds: ['input-1'] };

describe('Cursor private SDK worker', () => {
  it.each([false,true])('retains the default 2MiB wire bound and accepts a larger model-only transcript: %s',async modelOnly=>{
    const f=await fixture(),native=nativeSdk(modelOnly),events:any[]=[],controller=await runCursorWorker({mode:'run',...f,modelId:'native-model',systemPrompt:'Model text only',...(modelOnly?{modelOnly:true}:{}),mcp:{url:'http://127.0.0.1:3031/mcp',headers:{Authorization:'Bearer token'},names:[]}},event=>events.push(event),async()=>native.sdk);
    try{const large={...wire,text:wire.text+'x'.repeat(3*1024*1024)};if(modelOnly){expect(native.options).toMatchObject({tools:[],mcpServers:{}});await expect(controller!.submit({...wire,text:wire.text+'x'.repeat(32*1024*1024)})).rejects.toMatchObject({code:'OFFICIAL_PROTOCOL_INVALID'});expect(native.sent).toHaveLength(0);await controller!.submit(large);expect(native.sent[0].text).toBe(large.text);}else{await expect(controller!.submit(large)).rejects.toMatchObject({code:'OFFICIAL_PROTOCOL_INVALID'});expect(native.sent).toHaveLength(0);}}finally{await controller!.close();}
  });
  it('provides an isolated worker without eagerly importing the SDK', async () => {
    const module = await import('../packages/runtime-official/cursor-worker.ts').catch(() => undefined);
    expect(module?.runCursorWorker, 'worker must exist before a native SDK can be initialized').toBeTypeOf('function');
  });
  it.each([false, true])('applies only authenticated host MCP tools on new/resume=%s after account model validation', async resume => {
    const { dataDir, taskDir } = await fixture(); const native = nativeSdk(); const events: any[] = [];
    const controller = await runCursorWorker({ mode: 'run', dataDir, taskDir, sessionId: resume ? 'agent-native' : null, modelId: 'native-model', systemPrompt: 'Host instructions', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer host-only-token' }, names: ['resource_read'] } }, event => events.push(event), async () => native.sdk);
    expect(native.calls.slice(0, 3)).toEqual(['status', 'me', 'models']);
    expect(native.options).toMatchObject({ tools: ['mcp'], apiKey: 'private-browser-user-key', model: { id: 'native-model' }, systemPrompt: 'Host instructions', agents: {}, mcpServers: { host: { type: 'http', url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/), headers: { Authorization: expect.stringMatching(/^Bearer [a-f0-9]{64}$/) } } }, local: { cwd: taskDir, settingSources: [], enableAgentRetries: false } });
    expect(Object.keys(native.options.mcpServers)).toEqual(['host']);
    await controller!.close(); expect(native.agent.close).toHaveBeenCalledOnce();
  });
  it('rejects unavailable models and arbitrary credential provenance before creating an agent', async () => {
    const f = await fixture(); const native = nativeSdk();
    await expect(runCursorWorker({ mode: 'run', ...f, modelId: 'stale-model' }, () => {}, async () => native.sdk)).rejects.toMatchObject({ code: 'OFFICIAL_MODEL_UNAVAILABLE' });
    expect(native.sdk.Agent.create).not.toHaveBeenCalled();
    await writeFile(join(f.home, 'sdk-browser-login.json'), JSON.stringify({ version: 1, apiKey: 'generic-key' }));
    await expect(runCursorWorker({ mode: 'discover', ...f }, () => {}, async () => native.sdk)).rejects.toMatchObject({ code: 'OFFICIAL_SUBSCRIPTION_REQUIRED' });
  });
  it('correlates idempotency and canonical current user history, never echo-only messages', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = [];
    const controller = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer token' }, names: ['resource_read'] } }, event => events.push(event), async () => native.sdk);
    await controller!.submit(wire);
    expect(native.sent[0].opts.idempotencyKey).toBe('wire-uuid');
    expect(events.some(event => event.type === 'receipt')).toBe(false);
    expect(events.find(event => event.type === 'assistant')).toMatchObject({ text: 'Done', uuid: 'wire-uuid' });
    expect(events.some(event => event.type === 'settled')).toBe(true);
    await expect(controller!.submit(wire)).rejects.toMatchObject({ code: 'OFFICIAL_RUN_ABORTED' });
    await controller!.close();
    const other = nativeSdk(); other.rows = [{ type: 'user', agent_id: 'agent-native', uuid: 'canonical-0', message: { turn: { case: 'agentConversationTurn', value: { userMessage: { text: wire.text }, steps: [{ type: 'assistantMessage', message: { text: 'Done' } }] } } } }];
    const accepted: any[] = [];
    const next = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer token' }, names: ['resource_read'] } }, event => accepted.push(event), async () => other.sdk);
    await next!.submit(wire);
    expect(accepted.filter(event => event.type === 'receipt')).toEqual([{ type: 'receipt', uuid: 'wire-uuid', text: wire.text, sessionId: 'agent-native' }]);
    await next!.close();
  });
  it('discovery never creates an agent and history never authenticates or enables tools', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = [];
    await runCursorWorker({ mode: 'discover', ...f }, event => events.push(event), async () => native.sdk);
    expect(events).toContainEqual({ type: 'models', models: [{ id: 'cursor-sdk/native-model', provider: 'cursor-sdk', name: 'Native model' }] });
    expect(native.sdk.Agent.create).not.toHaveBeenCalled(); expect(native.sdk.Agent.resume).not.toHaveBeenCalled();
    native.calls.length = 0;
    await runCursorWorker({ mode: 'history', ...f, sessionId: 'agent-native' }, event => events.push(event), async () => native.sdk);
    expect(native.calls).toEqual([]); expect(native.sdk.Agent.create).not.toHaveBeenCalled(); expect(native.sdk.Agent.resume).not.toHaveBeenCalled();
  });
  it('accepts native MCP capability frames only for the registered host server and tool', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = [];
    native.agent.send = vi.fn(async () => ({ id: 'run-native', agentId: 'agent-native', async *stream() { yield { type: 'tool_call', call_id: 'mcp-call', status: 'completed', agent_id: 'agent-native', run_id: 'run-native', name: 'mcp', args: { providerIdentifier: 'host', toolName: 'resource_read' } }; }, wait: async () => ({ id: 'run-native', status: 'finished' }), cancel: vi.fn() })) as any;
    const controller = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer token' }, names: ['resource_read'] } }, event => events.push(event), async () => native.sdk);
    await expect(controller!.submit(wire)).resolves.toBeUndefined(); await controller!.close();
  });
  it('reports a redacted protocol error before terminal settlement when native tools escape', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = [];
    native.agent.send = vi.fn(async () => ({ id: 'run-native', agentId: 'agent-native', async *stream() { yield { type: 'tool_call', agent_id: 'agent-native', run_id: 'run-native', name: 'shell', args: { command: 'private-browser-user-key Bearer token' } }; }, wait: async () => ({ id: 'run-native', status: 'finished' }), cancel: vi.fn() })) as any;
    const controller = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer token' }, names: ['resource_read'] } }, event => events.push(event), async () => native.sdk);
    await expect(controller!.submit(wire)).rejects.toMatchObject({ code: 'OFFICIAL_TOOL_POLICY' });
    expect(events.map(event => event.type)).toContain('error'); expect(events.findIndex(event => event.type === 'error')).toBeLessThan(events.findIndex(event => event.type === 'settled'));
    expect(JSON.stringify(events)).not.toContain('private-browser-user-key'); expect(JSON.stringify(events)).not.toContain('Bearer token'); await controller!.close();
  });
  it('revokes active work before cancellation and ignores later native output', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = []; let release!: () => void; let started!: () => void;
    const gate = new Promise<void>(yes => { release = yes; }); const entered = new Promise<void>(yes => { started = yes; }); const cancel = vi.fn(async () => {});
    native.agent.send = vi.fn(async () => ({ id: 'run-native', agentId: 'agent-native', async *stream() { started(); await gate; yield { type: 'assistant', agent_id: 'agent-native', run_id: 'run-native', message: { role: 'assistant', content: [{ type: 'text', text: 'Late' }] } }; }, wait: async () => ({ id: 'run-native', status: 'finished' }), cancel })) as any;
    const controller = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer token' }, names: ['resource_read'] } }, event => events.push(event), async () => native.sdk);
    const pending = controller!.submit(wire); await entered; await controller!.close(); release();
    await expect(pending).rejects.toMatchObject({ code: 'OFFICIAL_RUN_ABORTED' }); expect(cancel).toHaveBeenCalledOnce(); expect(events.some(event => event.type === 'assistant' || event.type === 'receipt' || event.type === 'settled')).toBe(false);
  });
  it('keeps browser credentials private and rejects non-native login URLs and alternate backends', async () => {
    const f = await fixture(); const store = cursorCredentialStore(f.dataDir);
    await expect(store.save({ version: 1, backendUrl: 'https://api2.cursor.sh', apiKey: 'must-not-save', createdAtMs: Date.now() })).rejects.toMatchObject({ code: 'OFFICIAL_SUBSCRIPTION_REQUIRED' });
    const native = nativeSdk(); const events: any[] = [];
    native.sdk.Cursor.auth.login = async (options: any) => { options.onLoginUrl('https://cursor.com/loginDeepControl?challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&uuid=12345678-1234-1234-1234-123456789abc&mode=login&redirectTarget=sdk'); await options.store.save({ version: 1, backendUrl: options.backendUrl, apiKey: 'new-browser-secret', createdAtMs: Date.now(), apiKeyExpiresAtMs: Date.now() + 60_000 }); return { apiKey: 'new-browser-secret' }; };
    await runCursorWorker({ mode: 'login', ...f }, event => events.push(event), async () => native.sdk);
    expect(JSON.stringify(events)).not.toContain('new-browser-secret'); expect(JSON.parse(await readFile(join(f.home, 'sdk-browser-login.json'), 'utf8')).provenance).toBe('cursor-sdk-official-browser');
    expect(() => assertCursorLoginUrl('https://evil.invalid/loginDeepControl?challenge=x')).toThrow();
    expect(() => assertCursorLoginUrl('https://cursor.com@evil.invalid/loginDeepControl')).toThrow();
  });
  it('reads actual installed SDK local history with fetch forbidden and without native auth or agent creation', async () => {
    const f = await fixture(); const fetch = vi.fn(() => { throw new Error('Network forbidden in SDK bootstrap fixture'); }); const original = globalThis.fetch; globalThis.fetch = fetch as any;
    try {
      const sdk = await import('@cursor/sdk'); const store = new sdk.JsonlLocalAgentStore(join(f.taskDir, 'native-history'));
      await store.agents.create({ agent: { agentId: 'actual-native', cwd: f.taskDir, status: 'idle', createdAt: Date.now(), updatedAt: Date.now() } });
      const events: any[] = []; await runCursorWorker({ mode: 'history', ...f, sessionId: 'actual-native' }, event => events.push(event));
      expect(events).toEqual([{ type: 'history', sessionId: 'actual-native', messages: [] }]); expect(fetch).not.toHaveBeenCalled();
    } finally { globalThis.fetch = original; }
  });
  it('rejects native history junctions outside the owning task even within data storage', async () => {
    const f = await fixture(); const foreign = join(f.dataDir, 'foreign-history'); await mkdir(foreign);
    await rmdir(join(f.taskDir, 'native-history'));
    await symlink(foreign, join(f.taskDir, 'native-history'), process.platform === 'win32' ? 'junction' : 'dir');
    const native = nativeSdk();
    await expect(runCursorWorker({ mode: 'history', ...f, sessionId: 'agent-native' }, () => {}, async () => native.sdk)).rejects.toMatchObject({ code: 'OFFICIAL_SESSION_MISMATCH' });
    expect(native.sdk.Agent.messages.list).not.toHaveBeenCalled();
  });
  it('fails actual SDK agent bootstrap closed when the native catalog network is forbidden', async () => {
    const f = await fixture(); const original = globalThis.fetch; const fetch = vi.fn((_input: any, _options?: any) => { throw new Error('Network forbidden during actual SDK configuration probe'); }); globalThis.fetch = fetch as any;
    await mkdir(join(f.taskDir, '.cursor'), { recursive: true });
    await writeFile(join(f.taskDir, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { malicious: { command: 'must-not-run' } } }));
    await writeFile(join(f.taskDir, '.cursor', 'hooks.json'), JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: 'must-not-run' }] } }));
    try {
      const actual = await import('@cursor/sdk');
      const sdk: any = { Agent: actual.Agent, JsonlLocalAgentStore: actual.JsonlLocalAgentStore, Cursor: { auth: actual.Cursor.auth, me: async () => ({ userId: 42 }), models: { list: async () => [{ id: 'native-model', displayName: 'Native model' }] } } };
      const events: any[] = [];
      await expect(runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Only host MCP', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer fake-host-token' }, names: ['resource_read'] } }, event => events.push(event), async () => sdk)).rejects.toMatchObject({ name: 'NetworkError' });
      expect(events).toEqual([]); expect(fetch).toHaveBeenCalled();
      expect(fetch.mock.calls.map(call => typeof call[0] === 'string' ? call[0] : call[0].url)).toContain('https://api.cursor.com/v1/models');
    } finally { globalThis.fetch = original; }
  });
  it('revalidates current account models before every prompt and never sends a removed model', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = [];
    const controller = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer token' }, names: ['resource_read'] } }, event => events.push(event), async () => native.sdk);
    native.sdk.Cursor.models.list = async () => [{ id: 'different-model', displayName: 'Changed account catalog' }];
    await expect(controller!.submit(wire)).rejects.toMatchObject({ code: 'OFFICIAL_MODEL_UNAVAILABLE' });
    expect(native.agent.send).not.toHaveBeenCalled(); await controller!.close();
  });
  it('creates and resumes the actual SDK using only a synthetic official model-metadata transport fixture', async () => {
    const f = await fixture(); const original = globalThis.fetch; const urls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === 'string' ? input : input.url; urls.push(url);
      if (url === 'https://api.cursor.com/v1/models') return new Response(JSON.stringify({ items: [{ id: 'native-model', displayName: 'Native model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      throw new Error('Only synthetic official model metadata is allowed in this SDK bootstrap fixture');
    }) as any;
    try {
      const actual = await import('@cursor/sdk');
      const sdk: any = { Agent: actual.Agent, JsonlLocalAgentStore: actual.JsonlLocalAgentStore, Cursor: { auth: actual.Cursor.auth, me: async () => ({ userId: 42 }), models: actual.Cursor.models } };
      const events: any[] = []; const init = { mode: 'run' as const, ...f, modelId: 'native-model', systemPrompt: 'Only host MCP', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer synthetic-host-token' }, names: ['resource_read'] } };
      const controller = await runCursorWorker(init, event => events.push(event), async () => sdk);
      await controller!.close(); const ready = events.find(event => event.type === 'ready'); expect(ready.sessionId).toMatch(/^[A-Za-z0-9_-]+$/);
      const resumed = await runCursorWorker({ ...init, sessionId: ready.sessionId }, event => events.push(event), async () => sdk);
      await resumed!.close(); expect(events.filter(event => event.type === 'ready')).toHaveLength(2); expect(events.some(event => event.type === 'receipt')).toBe(false);
      expect(urls.filter(url => url === 'https://api.cursor.com/v1/models').length).toBeGreaterThan(0);
    } finally { globalThis.fetch = original; }
  });
  it('accepts native summary display events and accumulates partial host MCP call identity', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = [];
    native.agent.send = vi.fn(async () => ({ id: 'run-native', agentId: 'agent-native', async *stream() {
      yield { type: 'task', agent_id: 'agent-native', run_id: 'run-native', text: 'Native conversation summary' };
      yield { type: 'tool_call', call_id: 'mcp-call', status: 'running', agent_id: 'agent-native', run_id: 'run-native', name: 'mcp' };
      yield { type: 'tool_call', call_id: 'mcp-call', status: 'running', agent_id: 'agent-native', run_id: 'run-native', name: 'mcp', args: { providerIdentifier: 'host' } };
      yield { type: 'tool_call', call_id: 'mcp-call', status: 'completed', agent_id: 'agent-native', run_id: 'run-native', name: 'mcp', args: { toolName: 'resource_read' } };
    }, wait: async () => ({ id: 'run-native', status: 'finished' }), cancel: vi.fn() })) as any;
    const controller = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer token' }, names: ['resource_read'] } }, event => events.push(event), async () => native.sdk);
    await expect(controller!.submit(wire)).resolves.toBeUndefined(); expect(events.some(event => event.type === 'error')).toBe(false); await controller!.close();
  });
  it('rejects completed MCP observations without matching host-server and registered-tool identity', async () => {
    const f = await fixture(); const native = nativeSdk();
    native.agent.send = vi.fn(async () => ({ id: 'run-native', agentId: 'agent-native', async *stream() { yield { type: 'tool_call', call_id: 'mcp-call', status: 'completed', agent_id: 'agent-native', run_id: 'run-native', name: 'mcp' }; }, wait: async () => ({ id: 'run-native', status: 'finished' }), cancel: vi.fn() })) as any;
    const controller = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: 'http://127.0.0.1:3031/mcp', headers: { Authorization: 'Bearer token' }, names: ['resource_read'] } }, () => {}, async () => native.sdk);
    await expect(controller!.submit(wire)).rejects.toMatchObject({ code: 'OFFICIAL_TOOL_POLICY' }); await controller!.close();
  });
  it('blocks concurrent MCP execution until exact native entry and parent durable receipt acknowledgment', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = []; let effects = 0;
    const server = createServer(async (request, response) => { for await (const _chunk of request) { /* Drain the bounded synthetic body. */ } effects++; response.writeHead(200, { 'content-type': 'application/json' }).end('{"jsonrpc":"2.0","id":1,"result":{"content":[]}}'); });
    await new Promise<void>(yes => server.listen(0, '127.0.0.1', yes)); const address = server.address() as { port: number };
    let response: Response | undefined; let requestFailed: unknown;
    native.agent.send = vi.fn(async (text: string, options: any) => {
      const endpoint = native.options.mcpServers.host;
      const request = fetch(endpoint.url, { method: 'POST', headers: { ...endpoint.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task_finish', arguments: {} } }) }).then(value => { response = value; }, error => { requestFailed = error; });
      const entry = options.onDelta?.({ update: { type: 'user-message-appended', userMessage: { type: 'user_message', session_id: 'agent-native', text } } });
      return { id: 'run-native', agentId: 'agent-native', async *stream() { await request; await entry; yield { type: 'assistant', agent_id: 'agent-native', run_id: 'run-native', message: { role: 'assistant', content: [{ type: 'text', text: 'Finished' }] } }; }, wait: async () => ({ id: 'run-native', status: 'finished' }), cancel: vi.fn() };
    }) as any;
    const controller = await runCursorWorker({ mode: 'run', ...f, modelId: 'native-model', systemPrompt: 'Host', mcp: { url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: 'Bearer token' }, names: ['task_finish'] } }, event => events.push(event), async () => native.sdk);
    const pending = controller!.submit(wire);
    try {
      await vi.waitFor(() => expect(native.agent.send).toHaveBeenCalledOnce()); await new Promise(yes => setTimeout(yes, 50));
      expect(effects, 'native exec lane must not reach the host while receipt durability is pending').toBe(0);
      expect(events.filter(event => event.type === 'receipt')).toEqual([{ type: 'receipt', sessionId: 'agent-native', uuid: wire.uuid, text: wire.text }]);
      (controller as any).acknowledgeReceipt(wire.uuid, 'agent-native'); await pending;
      expect(effects).toBe(1); expect(response?.status).toBe(200); expect(requestFailed).toBeUndefined();
    } finally { await controller!.close(); await pending.catch(() => {}); await new Promise<void>(yes => server.close(() => yes())); }
  });
  it('advertises only native catalog selections that the adapter can actually start', async () => {
    const f = await fixture(); const native = nativeSdk(); const events: any[] = [];
    native.sdk.Cursor.models.list = async () => [
      { id: 'native-model', displayName: 'Simple model' },
      { id: 'parameterized', displayName: 'Requires parameter mapping', parameters: [{ id: 'effort', values: [{ value: 'high' }] }] },
      { id: 'max-only', displayName: 'Requires max mode', variants: [{ isDefault: true, params: [], isMaxMode: true }] },
    ];
    await runCursorWorker({ mode: 'discover', ...f }, event => events.push(event), async () => native.sdk);
    expect(events).toEqual([{ type: 'models', models: [{ id: 'cursor-sdk/native-model', provider: 'cursor-sdk', name: 'Simple model' }] }]);
    await expect(runCursorWorker({ mode: 'run', ...f, modelId: 'parameterized' }, () => {}, async () => native.sdk)).rejects.toMatchObject({ code: 'OFFICIAL_MODEL_UNAVAILABLE' });
    expect(native.sdk.Agent.create).not.toHaveBeenCalled();
  });
});
