import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHostTools } from '../packages/runtime-pi/tool-definitions.ts';
import { createHostMcp } from '../packages/runtime-official/mcp.ts';
import { PROGRAM_TOOLS } from '../packages/core/tool-program-tools.ts';

const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of close.splice(0).reverse()) await fn(); });
it('adds only the exact host-selected program metadata and keeps the default tool list unchanged', () => {
  const call = vi.fn();
  expect(createHostTools([], call).some(tool => tool.name === 'tool_program')).toBe(false);
  const tools = createHostTools([], call, PROGRAM_TOOLS);
  expect(tools.filter(tool => PROGRAM_TOOLS.some(program => program.name === tool.name)).map(tool => tool.name)).toEqual(PROGRAM_TOOLS.map(tool => tool.name));
  expect(() => createHostTools([], call, [{ ...PROGRAM_TOOLS[0], description: 'forged' }])).toThrow();
  expect(() => createHostTools([], call, [PROGRAM_TOOLS[0], PROGRAM_TOOLS[0]])).toThrow();
  expect(() => createHostTools([], call, [{ name: 'write_api', description: '', parameters: { type: 'object' } }])).toThrow();
});
it('preserves failed aggregate status in Pi tool results without dropping retained handles', async () => {
  const value = { state: 'FAILED', error: { code: 'NESTED_TOOL_FAILED' }, sourceRefs: ['result_retained'] };
  const tool = createHostTools([], async () => value, PROGRAM_TOOLS).find(tool => tool.name === 'tool_program');
  expect(tool).toBeDefined();
  const result = await tool!.execute('call', {}, new AbortController().signal, undefined, {} as never);
  expect(result).toMatchObject({ isError: true, details: value });
  expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(value);
});
it('preserves failed aggregate status through the authenticated official MCP transport', async () => {
  const value = { state: 'FAILED', error: { code: 'NESTED_TOOL_FAILED' }, sourceRefs: ['result_retained'] };
  const server = await createHostMcp({ ctx: { threadId: 't', runId: 'r', epoch: 1 }, current: () => true,
    onTool: async () => value, tools: [...PROGRAM_TOOLS] });
  close.push(() => server.close());
  const client = new Client({ name: 'm12-fixture', version: '1' }); close.push(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
  expect(await client.callTool({ name: 'tool_program', arguments: {} })).toMatchObject({ isError: true,
    content: [{ type: 'text', text: JSON.stringify(value) }] });
});
