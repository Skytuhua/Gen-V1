import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';

/** M10 read surface for the task-owned background drawer. Registered beneath
 * the existing local session, origin and CSRF guards; mutations go through
 * /api/commands so every change keeps its command receipt. */
export function registerBackgroundRoutes(app: FastifyInstance, service: Service) {
  app.get('/api/background', async (request, reply) => {
    const query = z.strictObject({ threadId: z.string().min(1).max(200).optional() }).parse(request.query);
    reply.header('Cache-Control', 'no-store');
    return {
      sequence: service.store.sequence,
      works: service.backgroundWork.works(query.threadId),
      schedules: service.backgroundWork.scheduler.schedules(),
      humanSteps: service.backgroundWork.humanSteps(query.threadId),
      idleOptIns: service.backgroundWork.idleOptIns(),
      intake: { status: service.intake.status(), records: service.intake.records() },
      closeSummary: service.backgroundWork.closeSummary(),
    };
  });
  app.get('/api/background/work/:workId/output', async (request, reply) => {
    const params = z.strictObject({ workId: z.string().min(1).max(200) }).parse(request.params);
    const query = z.strictObject({ threadId: z.string().min(1).max(200), cursor: z.coerce.number().int().min(0).optional() }).parse(request.query);
    reply.header('Cache-Control', 'no-store');
    return service.backgroundWork.readOutput(params.workId, query.threadId, query.cursor ?? 0);
  });
}
