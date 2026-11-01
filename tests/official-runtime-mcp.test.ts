import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';
import { createHostMcp } from '../packages/runtime-official/mcp.ts';

describe('official runtime host MCP', () => {
  it('round trips raw nested JSON Schema and preserves exact host run context', async () => {
    const ctx = { threadId: 't', runId: 'r', epoch: 3 };
    const onTool = vi.fn(async () => ({ result: 'host receipt' }));
    const schema = { type: 'object', additionalProperties: false, properties: { binding: { anyOf: [{ type: 'object', properties: { mode: { const: 'live' } } }, { type: 'null' }] } } };
    const mcp = await createHostMcp({ ctx, current: () => true, onTool, tools: [{ name: 'ui_inspect', description: 'Host read', parameters: schema }] });
    const transport = new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: mcp.headers } });
    const client = new Client({ name: 'scripted-official-client', version: '1' });
    try {
      const unauthorized = await fetch(mcp.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(unauthorized.status).toBe(401);
      await client.connect(transport);
      expect((await client.listTools()).tools[0].inputSchema).toEqual(schema);
      expect(await client.callTool({ name: 'ui_inspect', arguments: { binding: null } })).toMatchObject({ content: [{ type: 'text', text: '{"result":"host receipt"}' }] });
      expect(onTool).toHaveBeenCalledWith({ name: 'ui_inspect', args: { binding: null } }, ctx);
      await expect(client.callTool({ name: 'Bash', arguments: { command: 'echo unsafe' } })).rejects.toThrow();
      expect(onTool).toHaveBeenCalledTimes(1);
    } finally { await client.close(); await mcp.close(); }
  });

  it('revokes tool authority before teardown and suppresses an in-flight result', async () => {
    let active = true;
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const started = vi.fn();
    const mcp = await createHostMcp({ ctx: { threadId: 't', runId: 'r', epoch: 1 }, current: () => active, onTool: async () => { started(); await blocked; return { stale: true }; }, tools: [{ name: 'ui_inspect', description: '', parameters: { type: 'object' } }] });
    const client = new Client({ name: 'scripted-official-client', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: mcp.headers } }));
      const result = client.callTool({ name: 'ui_inspect', arguments: {} });
      await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
      active = false;
      finish();
      await expect(result).rejects.toThrow(/authority|revoked/i);
      await expect(client.callTool({ name: 'ui_inspect', arguments: {} })).rejects.toThrow();
      expect(started).toHaveBeenCalledOnce();
    } finally { finish(); await client.close(); await mcp.close(); }
  });
});
