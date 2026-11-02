import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createCursorMcpGate } from '../packages/runtime-official/cursor-mcp.ts';

it('preserves supported host-operation lifetime without a shorter proxy deadline or late header writes', async () => {
  const nativeTimer = globalThis.setTimeout;
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: any, milliseconds: number, ...args: any[]) => nativeTimer(callback, milliseconds === 30_000 ? 20 : milliseconds, ...args)) as any);
  const server = createServer(async (request, response) => { for await (const _chunk of request) {} nativeTimer(() => response.writeHead(200, { 'content-type': 'application/json' }).end('{"jsonrpc":"2.0","id":1,"result":{"content":[]}}'), 120); });
  await new Promise<void>(yes => server.listen(0, '127.0.0.1', yes)); const port = (server.address() as { port: number }).port;
  const gate = await createCursorMcpGate({ url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer parent-only' } }, ['repository_test'], async () => {});
  try {
    const response = await fetch(gate.url, { method: 'POST', headers: { ...gate.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'repository_test', arguments: {} } }) });
    expect(response.status).toBe(200); await response.json();
    await new Promise(yes => nativeTimer(yes, 150));
  } finally { timer.mockRestore(); await gate.close(); await new Promise<void>(yes => server.close(() => yes())); }
});

it('aborts an owned upstream connection on gate closure before delayed response callbacks', async () => {
  let received!: () => void; const entered = new Promise<void>(yes => { received = yes; }); let upstreamClosed = false;
  const server = createServer(async (request, response) => { for await (const _chunk of request) {} response.once('close', () => { upstreamClosed = true; }); received(); setTimeout(() => { if (!response.destroyed) response.writeHead(200).end('{}'); }, 100); });
  await new Promise<void>(yes => server.listen(0, '127.0.0.1', yes)); const port = (server.address() as { port: number }).port;
  const gate = await createCursorMcpGate({ url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer parent-only' } }, ['repository_test'], async () => {});
  const request = fetch(gate.url, { method: 'POST', headers: { ...gate.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'repository_test', arguments: {} } }) }); void request.catch(() => {});
  try { await entered; await gate.close(); await expect(request).rejects.toThrow(); await vi.waitFor(() => expect(upstreamClosed).toBe(true)); await new Promise(yes => setTimeout(yes, 130)); }
  finally { await gate.close(); await new Promise<void>(yes => server.close(() => yes())); }
});

it('does not forward a tool effect when its native client disconnects while receipt acknowledgment is pending', async () => {
  let effects = 0; let entered!: () => void; let release!: () => void;
  const waiting = new Promise<void>(yes => { entered = yes; }); const receipt = new Promise<void>(yes => { release = yes; });
  const server = createServer(async (request, response) => { for await (const _chunk of request) {} effects++; response.writeHead(200).end('{}'); });
  await new Promise<void>(yes => server.listen(0, '127.0.0.1', yes)); const port = (server.address() as { port: number }).port;
  const gate = await createCursorMcpGate({ url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer parent-only' } }, ['repository_test'], async () => { entered(); await receipt; });
  const abort = new AbortController(); const request = fetch(gate.url, { method: 'POST', signal: abort.signal, headers: { ...gate.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'repository_test', arguments: {} } }) }); void request.catch(() => {});
  try { await waiting; abort.abort(); await expect(request).rejects.toThrow(); await new Promise(yes => setTimeout(yes, 20)); release(); await new Promise(yes => setTimeout(yes, 50)); expect(effects).toBe(0); }
  finally { release(); await gate.close(); await new Promise<void>(yes => server.close(() => yes())); }
});
