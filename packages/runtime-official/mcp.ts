import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { RunContext, RuntimeCallbacks } from '../contracts/index.ts';
import type { ToolMetadata } from '../runtime-pi/tool-definitions.ts';

export interface HostMcp { url: string; headers: Record<string, string>; names: Set<string>; close(): Promise<void> }

/** One random authenticated loopback endpoint per run. The model cannot configure it. */
export async function createHostMcp({ ctx, current, onTool, tools }: { ctx: RunContext; current: () => boolean; onTool: RuntimeCallbacks['onTool']; tools: readonly ToolMetadata[] }): Promise<HostMcp> {
  const secret = `Bearer ${randomBytes(32).toString('hex')}`;
  const names = new Set(tools.map(tool => tool.name));
  if (names.size !== tools.length || tools.some(tool => !/^[a-z][a-z0-9_]*$/.test(tool.name) || tool.parameters.type !== 'object' || ['bash', 'read', 'write', 'edit', 'shell', 'tool_search'].includes(tool.name))) throw new Error('Invalid host MCP tool metadata.');
  let closed = false;
  const sockets = new Set<Socket>();
  const sessions = new Set<Server>();
  const assertAuthority = () => { if (closed || !current()) throw new McpError(ErrorCode.InvalidRequest, 'Run authority revoked.'); };
  const http = createServer(async (request, response) => {
    const supplied = request.headers.authorization ?? '';
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) { response.writeHead(401).end(); return; }
    if (closed || !current()) { response.writeHead(403).end(); return; }
    const address = http.address();
    const host = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    if (request.url !== '/mcp' || request.headers.host !== host || (request.headers.origin && request.headers.origin !== `http://${host}`)) { response.writeHead(403).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    let server: Server | undefined;
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) { size += Buffer.byteLength(chunk); if (size > 2 * 1024 * 1024) { response.writeHead(413).end(); return; } chunks.push(Buffer.from(chunk)); }
      assertAuthority();
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      server = new Server({ name: 'generative-harness-host', version: '1.0.0' }, { capabilities: { tools: {} } });
      sessions.add(server);
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        assertAuthority();
        return { tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: structuredClone(tool.parameters) as { type: 'object' } })) };
      });
      server.setRequestHandler(CallToolRequestSchema, async request => {
        assertAuthority();
        if (!names.has(request.params.name)) throw new McpError(ErrorCode.InvalidParams, 'Only registered host tools are allowed.');
        const args = request.params.arguments ?? {};
        const result = await onTool({ name: request.params.name, args }, ctx);
        assertAuthority();
        return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null) }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) response.writeHead(400).end();
      else if (!response.writableEnded) response.end();
    } finally { if (server) { sessions.delete(server); await server.close().catch(() => {}); } }
  });
  http.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', () => { http.off('error', reject); resolve(); }); });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Host MCP loopback listener is unavailable.');
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: secret }, names,
    close() {
      closed = true;
      closing ??= (async () => {
        const stopped = new Promise<void>(resolve => http.close(() => resolve()));
        for (const socket of sockets) socket.destroy();
        await Promise.all([...sessions].map(server => server.close().catch(() => {})));
        await stopped;
      })();
      return closing;
    },
  };
}
