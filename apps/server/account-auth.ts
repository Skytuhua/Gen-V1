import type { FastifyInstance } from 'fastify';
import type { Service } from '../../packages/core/service.ts';
import { HarnessError } from '../../packages/contracts/index.ts';
import { parseAccountAuthTarget, readAccountAuth, signOutAccount } from '../../packages/runtime/account-auth.ts';

/** Registered on the existing session/CSRF-protected API. Never accepts secrets. */
export function registerAccountAuthRoutes(app: FastifyInstance, service: Service) {
  app.get('/api/account-auth', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const query = request.query as Record<string, unknown>;
    if (!Object.hasOwn(query, 'accountId')) throw new HarnessError('INVALID_INPUT', 'An explicit account target is required.');
    const target = parseAccountAuthTarget({ ...query, accountId: query.accountId === '' ? null : query.accountId });
    return readAccountAuth(service.store, target);
  });
  app.post('/api/account-auth/signout', { bodyLimit: 2048 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); const target = parseAccountAuthTarget(request.body);
    await service.cancelComposerPredictions();
    return signOutAccount(service.store, target);
  });
}
