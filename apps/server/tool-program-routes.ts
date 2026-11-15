import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';

const identifier = z.string().min(1).max(200);
const rangeQuery = z.strictObject({
  offset: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().safe().nonnegative()).default(0),
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().min(1).max(64 * 1024)).default(16 * 1024),
});
/** Registered behind the server's authenticated same-origin session gate. */
export function registerToolProgramRoutes(app: FastifyInstance, service: Service): void {
  app.get<{ Params: { id: string } }>('/api/threads/:id/tool-programs', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    z.strictObject({}).parse(request.query);
    return service.toolProgramView(identifier.parse(request.params.id));
  });
  app.get<{ Params: { id: string; programId: string; ref: string } }>('/api/threads/:id/tool-programs/:programId/results/:ref', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const params = z.strictObject({ id: identifier, programId: identifier, ref: identifier }).parse(request.params);
    return service.toolProgramResultRange(params.id, params.programId, params.ref, rangeQuery.parse(request.query));
  });
}
