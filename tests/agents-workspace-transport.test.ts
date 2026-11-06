import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {InventoryUpdates} from '../packages/contracts/agent-inventory';
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
it('uses authenticated compact routes, preserves filters and renews expired sessions', async () => {
 const paths: string[] = []; let expired = true;
 vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
  paths.push(input); expect(options?.credentials).toBe('same-origin');
  if (input === '/api/bootstrap') return Response.json({csrfToken: 'test'});
  if (expired) {expired = false; return Response.json({error: {code: 'AUTH_REQUIRED'}}, {status: 401});}
  return Response.json({authority: 'personal', items: []});
 }));
 const {personalAgentTransport, agentQuery} = await import('../apps/web/src/agents-workspace/transport');
 await personalAgentTransport.inventory({projectId: null, statuses: ['cancelled', 'queued', 'needs_review'], text: 'a & b', cursor: 'cursor'}, new AbortController().signal);
 expect(paths.filter(path => path === '/api/bootstrap')).toHaveLength(2);
 expect(paths.filter(path => path.startsWith('/api/agents?'))).toHaveLength(2);
 expect(paths.some(path => path.includes('snapshot') || path === '/api/events')).toBe(false);
 const params = new URLSearchParams(agentQuery({projectId: null, visibleAgentIds: ['job:a', 'thread:b'], statuses: ['queued']}));
 expect(params.get('projectId')).toBe(''); expect(params.get('visible')).toBe('job:a,thread:b'); expect(params.get('status')).toBe('queued');
});
it('decodes fragmented UTF-8 SSE frames and releases the reader on abort', async () => {
 const update: InventoryUpdates = {authority: 'personal', scopeKey: 's', sequence: 2, fromSequence: 1, resync: false, upserts: [], removed: [], ancestors: [], transcripts: [{agentId: '😀', sequence: 2}]};
 const bytes = new TextEncoder().encode(`: heartbeat\r\n\r\nevent: agents\r\ndata: ${JSON.stringify(update)}\r\n\r\n`);
 vi.stubGlobal('fetch', vi.fn(async (input: string) => input === '/api/bootstrap' ? Response.json({csrfToken: 'test'}) : new Response(new ReadableStream({start(controller) {for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close();}}), {headers: {'content-type': 'text/event-stream'}})));
 const {personalAgentTransport} = await import('../apps/web/src/agents-workspace/transport'); const accept = vi.fn();
 await personalAgentTransport.events({after: 1, scopeKey: 's', visibleAgentIds: ['😀']}, accept, new AbortController().signal);
 expect(accept).toHaveBeenCalledExactlyOnceWith(update);
});
