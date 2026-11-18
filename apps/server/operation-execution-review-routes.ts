import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';
import { operationExecutionTargetSchema, operationExecutionReviewSchema } from '../../packages/contracts/operation-execution-review.ts';

const query = operationExecutionTargetSchema.extend({
  operationRevision: z.string().max(16).regex(/^[1-9]\d*$/).transform(Number).pipe(operationExecutionTargetSchema.shape.operationRevision),
});
/** Existing authenticated session/origin hooks apply. This read does not issue
 * review tokens, resolve credentials, recompute live bytes or write authority. */
export function registerOperationExecutionReviewRoutes(app: FastifyInstance, service: Pick<Service, 'executionAdvice'>) {
  app.get('/api/operation-execution-review', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return operationExecutionReviewSchema.parse(service.executionAdvice.read(query.parse(request.query)));
  });
}
