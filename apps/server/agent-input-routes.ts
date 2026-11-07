import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {PlanningCoordinator} from '../../packages/core/planning.ts';

const id = z.string().min(1).max(200).regex(/^[\w:.-]+$/);
/** Personal host only, under buildServer's existing host/session/origin gate. */
export function registerAgentInputRoutes(app: FastifyInstance, planning: PlanningCoordinator) {
  app.get('/api/agents/follow-up-target', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const query = z.strictObject({parentThreadId: id, jobId: id}).parse(request.query);
    return planning.followUpTarget(query.parentThreadId, query.jobId);
  });
  app.get<{Params: {id: string}}>('/api/agents/inputs/:id', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const query = z.strictObject({parentThreadId: id}).parse(request.query);
    return planning.inputTicket(query.parentThreadId, id.parse(request.params.id));
  });
}
