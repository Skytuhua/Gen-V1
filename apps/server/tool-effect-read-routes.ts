import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Sha256Hex } from '../../packages/contracts/hashing.ts';

interface ToolEffectReadRouteHost {
  readonly authority: 'personal';
  context(input: unknown): unknown;
  invocations(input: unknown): unknown;
  observations(input: unknown): unknown;
}

const hash = Sha256Hex;
const scope = z.strictObject({ scopeKey: hash });
const invocations = scope.extend({
  limit: z.string().regex(/^[1-9][0-9]?$/).transform(Number).pipe(z.number().max(50)).optional(),
  cursor: z.string().min(1).max(2048).optional(),
  invocationId: z.string().min(1).max(400).optional(),
});
const observations = scope.extend({ invocationId: z.string().min(1).max(400) });

/** Register before app.ready(), only in the existing authenticated Personal server. */
export function registerToolEffectReadRoutes(app: FastifyInstance, reads: ToolEffectReadRouteHost) {
  if (reads.authority !== 'personal') throw Error('A Personal tool-effect reader is required');
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/tool-effects/')) reply.header('Cache-Control', 'no-store');
  });
  app.get<{ Params: { threadId: string } }>('/api/tool-effects/:threadId', async request =>
    reads.context({ threadId: request.params.threadId }));
  app.get<{ Params: { threadId: string } }>('/api/tool-effects/:threadId/invocations', async request =>
    reads.invocations({ ...invocations.parse(request.query), threadId: request.params.threadId }));
  app.get<{ Params: { threadId: string } }>('/api/tool-effects/:threadId/observations', async request =>
    reads.observations({ ...observations.parse(request.query), threadId: request.params.threadId }));
}
