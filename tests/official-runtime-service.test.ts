import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, it, vi } from 'vitest';
import type { ArtifactRecord, InputRequest, Thread } from '../packages/contracts/index.ts';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { createOfficialRuntime } from '../packages/runtime-official/index.ts';

function stream<T>() {
  const entries: T[] = []; let wake: (() => void) | undefined; let ended = false;
  return { push(value: T) { entries.push(value); wake?.(); }, close() { ended = true; wake?.(); }, async *[Symbol.asyncIterator]() { while (!ended) { if (!entries.length) await new Promise<void>(resolve => { wake = resolve; }); while (entries.length) yield entries.shift()!; } } };
}

it('continues a durable host decision in the same official session through real Service callbacks and authenticated MCP', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'official-service-'));
  const queries: Array<{ options: any; inputs: any[]; events: ReturnType<typeof stream<any>> }> = [];
  const runtime = createOfficialRuntime({ dataDir }, {
    claudeSdk: { query({ prompt, options }: any) {
      const events = stream<any>(); const state = { options, events, inputs: [] as any[] }; queries.push(state);
      void (async () => { for await (const input of prompt) state.inputs.push(input); })();
      return Object.assign(events[Symbol.asyncIterator](), {
        accountInfo: async () => ({ apiProvider: 'firstParty', subscriptionType: 'Claude Max', apiKeySource: 'none' }),
        supportedModels: async () => [{ value: 'official-fixture', displayName: 'Scripted official runtime fixture', description: '' }],
        setModel: async () => {}, getContextUsage: async () => ({ totalTokens: 10, maxTokens: 100 }), interrupt: async () => undefined, close: () => events.close(),
      });
    } } as any,
    claudeHistory: async (_dir, manifest) => Object.entries(manifest.value.inputs).filter(([, receipt]) => receipt.observed).map(([uuid, receipt]) => ({ uuid, inputIds: receipt.inputIds })),
  });
  // Model metadata fixture avoids discovery-only queries; starts use the real adapter preflight.
  runtime.models = async () => [{ id: 'claude-code/official-fixture', provider: 'claude-code', name: 'Scripted official runtime fixture' }];
  const store = new Store(join(dataDir, 'state')); const service = new Service(store, runtime);
  const clients: Client[] = [];
  const send = (type: string, payload: Record<string, unknown>, threadId?: string) => service.command({ id: randomUUID(), type, payload, threadId });
  const tool = async (index: number, name: string, args: Record<string, unknown>) => {
    const client = new Client({ name: 'scripted-official-service-client', version: '1' }); clients.push(client);
    const config = queries[index].options.mcpServers.host;
    await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }));
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result));
    return JSON.parse((result.content as any)[0].text);
  };
  try {
    await service.recover();
    const thread = (await send('thread.create', { title: 'Official runtime scripted integration' })).result as Thread;
    await send('message.send', { content: 'Review a decision', modelId: 'claude-code/official-fixture' }, thread.id);
    await vi.waitFor(() => expect(queries[0]?.inputs).toHaveLength(1));
    const created = await tool(0, 'ui_request_input', { title: 'Choose a disposition', prompt: 'Keep this direction?', responseSchema: { type: 'string', enum: ['Keep', 'Revise'] } });
    const first = queries[0];
    first.events.push({ type: 'assistant', session_id: first.options.sessionId, user_message_uuids: [first.inputs[0].uuid], message: { id: 'first-answer', content: [{ type: 'text', text: 'Please choose a direction.' }] } });
    first.events.push({ type: 'result', subtype: 'success', session_id: first.options.sessionId, user_message_uuids: [first.inputs[0].uuid], queued_turn_count: 0 });
    await vi.waitFor(() => expect(store.get<Thread>('thread', thread.id)).toMatchObject({ status: 'awaiting_input', runId: null }));
    expect(store.all<any>('outbox', thread.id).every(input => input.status === 'handled')).toBe(true);
    await send('request.respond', { requestId: created.requestId, revision: 1, response: 'Keep' }, thread.id);
    await vi.waitFor(() => expect(queries[1]?.inputs).toHaveLength(1));
    expect(queries[1].options.resume).toBe(first.options.sessionId);
    expect(JSON.parse(queries[1].inputs[0].message.content.split('\n').slice(1).join('\n')).prompt).toContain('"response":"Keep"');
    const presented = await tool(1, 'ui_present', { title: 'Kept decision', spec: { root: 'text', elements: { text: { type: 'Text', props: { text: 'Scripted host integration evidence; no live inference.' } } } } });
    const second = queries[1];
    second.events.push({ type: 'assistant', session_id: second.options.resume, user_message_uuids: [second.inputs[0].uuid], message: { id: 'second-answer', content: [{ type: 'text', text: 'Decision preserved.' }] } });
    second.events.push({ type: 'result', subtype: 'success', session_id: second.options.resume, user_message_uuids: [second.inputs[0].uuid], queued_turn_count: 0 });
    await vi.waitFor(() => expect(store.get<Thread>('thread', thread.id)?.runId).toBeNull());
    expect(store.get<InputRequest>('request', created.requestId)?.status).toBe('accepted');
    expect(store.get<ArtifactRecord>('artifact', presented.artifactId)?.title).toBe('Kept decision');
    expect(store.all<any>('outbox', thread.id).every(input => input.status === 'handled')).toBe(true);
  } finally { await Promise.all(clients.map(client => client.close())); await service.dispose(); store.close(); }
});
