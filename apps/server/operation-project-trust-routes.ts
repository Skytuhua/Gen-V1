import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';
import {
  operationProjectTrustTargetSchema, operationProjectTrustDecisionSchema, operationProjectTrustRevokeSchema,
  operationProjectTrustReviewSchema, operationProjectTrustStatusSchema, operationProjectTrustReceiptSchema,
} from '../../packages/contracts/operation-project-trust.ts';

const querySchema = operationProjectTrustTargetSchema.extend({
  operationRevision: z.string().max(16).regex(/^[1-9]\d*$/).transform(Number).pipe(operationProjectTrustTargetSchema.shape.operationRevision),
});

/** Registered after the host's origin, authenticated-session and CSRF hooks.
 * Caller input identifies an operation; it cannot supply roots, bytes or scope. */
export function registerOperationProjectTrustRoutes(app: FastifyInstance, service: Pick<Service, 'projectTrust'>) {
  app.get('/api/operation-project-trust', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return operationProjectTrustReviewSchema.parse(await service.projectTrust.preview(querySchema.parse(request.query)));
  });
  app.get('/api/operation-project-trust/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return operationProjectTrustStatusSchema.parse(service.projectTrust.status(querySchema.parse(request.query)));
  });
  app.post('/api/operation-project-trust/decisions', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return operationProjectTrustReceiptSchema.parse(await service.projectTrust.decide(operationProjectTrustDecisionSchema.parse(request.body)));
  });
  app.post('/api/operation-project-trust/revocations', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return operationProjectTrustReceiptSchema.parse(service.projectTrust.revoke(operationProjectTrustRevokeSchema.parse(request.body)));
  });
}
