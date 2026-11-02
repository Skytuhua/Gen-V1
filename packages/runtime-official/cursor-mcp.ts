import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { bounded } from './internal.ts';
import type { HostMcp } from './mcp.ts';

/** Cursor dispatches native interactions and tool execution on concurrent lanes.
 * Gate the independent MCP HTTP lane until the host confirms durable entry. */
export async function createCursorMcpGate(upstream: Pick<HostMcp, 'url' | 'headers'>, names: string[], beforeTool: () => Promise<void>): Promise<HostMcp> {
  const authorization = `Bearer ${randomBytes(32).toString('hex')}`;
  const allowed = new Set(names); const sockets = new Set<Socket>(); const outgoing = new Set<ClientRequest>();
  let closed = false;
  const http = createServer(async (request, response) => {
    const reject = (status: number) => { if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Current Cursor host-tool authority is unavailable.' } })); };
    const supplied = request.headers.authorization ?? '';
    if (closed || Buffer.byteLength(supplied) !== Buffer.byteLength(authorization) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(authorization))) { reject(401); return; }
    const address = http.address(); const host = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    if (request.method !== 'POST' || request.url !== '/mcp' || request.headers.host !== host || (request.headers.origin && request.headers.origin !== `http://${host}`)) { reject(403); return; }
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { size += Buffer.byteLength(chunk); if (size > 2 * 1024 * 1024) { reject(413); return; } chunks.push(Buffer.from(chunk)); }
      const body = Buffer.concat(chunks); const message = JSON.parse(body.toString('utf8'));
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') { reject(400); return; }
      if (message.method === 'tools/call') {
        if (!message.params || typeof message.params !== 'object' || Array.isArray(message.params) || !allowed.has(message.params.name)) { reject(403); return; }
        await bounded(beforeTool(), 10_000, 'Cursor native entry was not confirmed.');
      } else if (!['initialize', 'notifications/initialized', 'tools/list', 'ping'].includes(message.method)) { reject(403); return; }
      if (closed || request.aborted || response.destroyed || response.writableEnded) { reject(403); return; }
      // The existing host operations own their deadlines (some are 120s).
      // Cancellation/client disconnect owns this transport's whole lifetime.
      await new Promise<void>((resolve, rejectForward) => {
        let settled = false; let incoming: IncomingMessage | undefined; let forward: ClientRequest;
        const finish = (error?: Error) => {
          if (settled) return; settled = true;
          response.off('close', clientClosed);
          if (error) { incoming?.destroy(); forward?.destroy(); rejectForward(error); } else resolve();
        };
        const clientClosed = () => { if (!response.writableFinished) finish(new Error('Cursor host client disconnected.')); };
        response.once('close', clientClosed);
        // Only the fixed parent endpoint and parent-owned headers are forwarded.
        forward = httpRequest(upstream.url, { method: 'POST', agent: false, headers: { ...upstream.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': body.length } }, source => {
          incoming = source;
          const buffers: Buffer[] = []; let received = 0;
          source.on('data', chunk => { if (settled) return; received += Buffer.byteLength(chunk); if (received > 4 * 1024 * 1024) finish(new Error('Cursor host response exceeded its bound.')); else buffers.push(Buffer.from(chunk)); });
          source.on('error', finish); source.on('aborted', () => finish(new Error('Cursor host response was aborted.')));
          source.on('end', () => {
            if (settled) return;
            if (closed || response.destroyed || response.headersSent || (source.statusCode ?? 500) >= 300 && (source.statusCode ?? 500) < 400) { finish(new Error('Cursor host response was unavailable.')); return; }
            response.writeHead(source.statusCode ?? 502, { 'content-type': source.headers['content-type'] ?? 'application/json' }).end(Buffer.concat(buffers)); finish();
          });
        });
        outgoing.add(forward); forward.once('close', () => outgoing.delete(forward)); forward.once('error', finish); forward.end(body);
      });
    } catch { reject(403); }
  });
  http.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  const address = http.address(); if (!address || typeof address === 'string') throw new Error('Cursor host gate did not bind.');
  return { url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: authorization }, names: allowed, async close() {
    if (closed) return; closed = true;
    for (const request of outgoing) request.destroy(); for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => http.close(() => resolve()));
  } };
}
