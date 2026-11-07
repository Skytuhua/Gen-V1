import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { once } from 'node:events';
import { z } from 'zod';
import { HarnessError } from '../../packages/contracts/index.ts';
import { agentStatuses, type PersonalAgentInventory, type UpdatesQuery } from '../../packages/contracts/agent-inventory.ts';

const cursor = z.string().min(1).max(2048);
const id = z.string().min(1).max(500);
const archived = z.enum(['true', 'false']).transform(value => value === 'true').optional();
const scope = z.strictObject({
  projectId: z.string().max(500).transform(value => value === '' ? null : value).optional(), status: z.string().max(200).transform(value => value.split(',')).pipe(z.array(z.enum(agentStatuses)).max(agentStatuses.length)).optional(),
  text: z.string().max(200).optional(), includeArchived: archived,
});
const pageQuery = scope.extend({ limit: z.coerce.number().int().min(1).max(100).optional(), cursor: cursor.optional() });
const historyQuery = z.strictObject({ agentId: id, includeArchived: archived, limit: z.coerce.number().int().min(1).max(100).optional(), cursor: cursor.optional() });
const updatesQuery = scope.extend({
  after: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), scopeKey: z.string().min(1).max(64),
  visible: z.string().max(12024).transform(value => value.split(',')).pipe(z.array(id).max(24)).optional(),
});
function parseUpdates(input: unknown): UpdatesQuery {
  const { status, visible, ...query } = updatesQuery.parse(input);
  return { ...query, statuses: status, visibleAgentIds: visible };
}

/** Mounted only by the Personal server, beneath its host/origin/session/CSRF gates. No write endpoint. */
export function registerAgentInventoryRoutes(app: FastifyInstance, provider: PersonalAgentInventory) {
  if (provider.authority !== 'personal') throw new HarnessError('CAPABILITY_DENIED', 'A Personal inventory provider is required');
  const streams = new Set<ServerResponse>();
  app.get('/api/agents', async (request, reply) => {
    const { status, ...query } = pageQuery.parse(request.query);
    return reply.header('Cache-Control', 'no-store').send(provider.inventory({ ...query, statuses: status }));
  });
  app.get('/api/agents/history', async (request, reply) => reply.header('Cache-Control', 'no-store').send(provider.history(historyQuery.parse(request.query))));
  app.get('/api/agents/content', async (request, reply) => {
    const query = historyQuery.omit({ limit: true }).required({ cursor: true }).parse(request.query);
    return reply.header('Cache-Control', 'no-store').send(provider.content(query));
  });
  app.get('/api/agents/updates', async (request, reply) => reply.header('Cache-Control', 'no-store').send(provider.updates(parseUpdates(request.query))));
  app.get('/api/agents/events', async (request, reply) => {
    const query = parseUpdates(request.query);
    const last = request.headers['last-event-id'];
    if (last !== undefined) query.after = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(last);
    // Validate the scoped checkpoint before hijacking, so all errors use the normal host handler.
    provider.updates(query);
    if (streams.size >= 32) return reply.code(429).send({ error: { code: 'STREAM_LIMIT', message: 'Too many inventory readers' } });
    reply.hijack();
    const response = reply.raw, controller = new AbortController();
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    streams.add(response);
    let pumping = false, pending = true, closed = false, comment = ': connected\n\n';
    const pump = async () => {
      if (pumping || closed) return;
      pumping = true;
      try {
        while (pending && !closed) {
          pending = false;
          const update = provider.updates(query);
          const changed = update.sequence !== query.after || update.resync;
          const chunk = changed ? `id: ${update.sequence}\nevent: agents\ndata: ${JSON.stringify(update)}\n\n` : comment;
          query.after = update.sequence; comment = '';
          if (chunk && !response.write(chunk)) await once(response, 'drain', { signal: controller.signal });
          if (update.resync) { response.end(); break; }
        }
      } catch { if (!closed) response.destroy(); }
      finally { pumping = false; }
    };
    const unsubscribe = provider.subscribe(() => { pending = true; void pump(); });
    const heartbeat = setInterval(() => { comment = ': heartbeat\n\n'; pending = true; void pump(); }, 15000);
    heartbeat.unref();
    const close = () => {
      if (closed) return;
      closed = true; controller.abort(); clearInterval(heartbeat); unsubscribe(); streams.delete(response);
    };
    response.once('close', close); response.once('error', close);
    void pump();
  });
  app.addHook('preClose', async () => { for (const response of streams) response.destroy(); streams.clear(); });
}
