import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { createHostMcp, type HostMcp } from '../packages/runtime-official/mcp.ts';
import { runCursorWorker, type CursorWorkerController } from '../packages/runtime-official/cursor-worker.ts';
import { encodeInput } from '../packages/runtime-pi/input-envelope.ts';

it('keeps real Service task_finish behind native entry and delayed parent durability despite concurrent native tool dispatch', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'cursor-service-receipt-'));
  const home = join(dataDir, 'official', 'cursor-sdk', 'home'); const taskDir = join(dataDir, 'official', 'cursor-sdk', 'tasks', 'fixture');
  await mkdir(home, { recursive: true }); await mkdir(join(taskDir, 'native-history'), { recursive: true });
  await writeFile(join(home, 'sdk-browser-login.json'), JSON.stringify({ version: 1, provenance: 'cursor-sdk-official-browser', credentials: { version: 1, backendUrl: 'https://api2.cursor.sh', apiKey: 'synthetic-review-key', createdAtMs: Date.now() } }));
  let callbacks: any; let controller: CursorWorkerController | undefined; let mcp: HostMcp | undefined; let options: any; let receipt = false; let finishResponse: any;
  let release!: () => void; const durable = new Promise<void>(yes => { release = yes; });
  const runtime: any = {
    configure(value: any) { callbacks = value; }, async models() { return [{ id: 'cursor-sdk/review', provider: 'cursor-sdk', name: 'Synthetic review' }]; }, async history() { return []; }, async followUp() { throw new Error('unused'); }, async compact() { throw new Error('unused'); }, async cancel() { await mcp?.close(); await controller?.close(); }, async dispose() { await mcp?.close(); await controller?.close(); },
    async start(input: any) {
      const text = encodeInput(input); const uuid = randomUUID(); const inputIds = input.inputIds ?? [input.inputId];
      mcp = await createHostMcp({ ctx: input, current: () => true, onTool: callbacks.onTool, tools: [{ name: 'task_finish', description: 'Finish the task', parameters: { type: 'object', properties: { outcome: { type: 'string' } }, required: ['outcome'] } }] });
      const agent = { agentId: 'agent-review', close() {}, async send(_text: string, sendOptions: any) {
        // These lanes intentionally race, matching the installed SDK executor.
        const tool = fetch(options.mcpServers.host.url, { method: 'POST', headers: { ...options.mcpServers.host.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task_finish', arguments: { outcome: 'Completed receipt review' } } }) }).then(async response => { finishResponse = await response.json(); });
        const entry = sendOptions.onDelta({ update: { type: 'user-message-appended', userMessage: { type: 'user_message', session_id: 'agent-review', text } } });
        return { id: 'run-review', agentId: 'agent-review', async *stream() { await Promise.all([tool, entry]); yield { type: 'assistant', agent_id: 'agent-review', run_id: 'run-review', message: { role: 'assistant', content: [{ type: 'text', text: 'Completed receipt review' }] } }; }, async wait() { return { id: 'run-review', status: 'finished' }; }, async cancel() {} };
      } };
      const sdk: any = { Cursor: { auth: { async status() { return { status: 'logged-in', backendUrl: 'https://api2.cursor.sh' }; } }, async me() { return { userId: 42 }; }, models: { async list() { return [{ id: 'review', displayName: 'Review' }]; } } }, Agent: { async create(value: any) { options = value; return agent; }, messages: { async list() { return []; } } }, JsonlLocalAgentStore: class { agents = { get: async () => ({ agentId: 'agent-review', cwd: taskDir }) }; } };
      controller = await runCursorWorker({ mode: 'run', dataDir, taskDir, modelId: 'review', systemPrompt: 'Review', mcp: { url: mcp.url, headers: mcp.headers, names: ['task_finish'] } }, event => {
        if (event.type === 'receipt') { receipt = true; void durable.then(() => { callbacks.onEvent({ ...input, type: 'input.processing', inputIds }); controller?.acknowledgeReceipt(event.uuid, event.sessionId); }); }
        if (event.type === 'assistant') callbacks.onEvent({ ...input, type: 'assistant.message', content: event.text, inputIds });
        if (event.type === 'settled') callbacks.onEvent({ ...input, type: 'settled' });
      }, async () => sdk);
      void controller!.submit({ uuid, text, inputIds }).catch(() => {});
    },
  };
  const store = new Store(join(dataDir, 'state')); const service = new Service(store, runtime);
  try {
    await service.recover(); const thread: any = (await service.command({ id: randomUUID(), type: 'thread.create', payload: { title: 'Receipt ordering' } })).result;
    await service.command({ id: randomUUID(), type: 'message.send', threadId: thread.id, payload: { content: 'Finish the task', modelId: 'cursor-sdk/review' } });
    await vi.waitFor(() => expect(receipt).toBe(true)); await new Promise(yes => setTimeout(yes, 50));
    expect(store.all('finish', thread.id)).toHaveLength(0); expect(finishResponse).toBeUndefined(); expect(store.all('outbox', thread.id).some((row: any) => row.enteredRuntime)).toBe(false);
    release(); await vi.waitFor(() => expect(store.all('finish', thread.id)).toHaveLength(1));
    expect(JSON.stringify(finishResponse)).not.toContain('REQUEST_GATED');
  } finally { release(); await service.dispose(); store.close(); }
});
