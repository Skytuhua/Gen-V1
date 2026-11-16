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
    const controller = new AbortController(), abort = () => controller.abort(), disconnected = () => {if(!reply.raw.writableFinished)abort();};
    request.raw.once('aborted',abort); reply.raw.once('close',disconnected);
    try {return await readAccountAuth(service.store, target, undefined, controller.signal);}
    finally {request.raw.removeListener('aborted',abort);reply.raw.removeListener('close',disconnected);}
  });
  app.post('/api/account-auth/signout', { bodyLimit: 2048 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); const target = parseAccountAuthTarget(request.body);
    await service.cancelComposerPredictions();
    const status = await signOutAccount(service.store, target);
    // AUD-07: drop the signed-out account's cached catalog so it is never served again; other owners stay intact.
    await service.runtime.invalidateModels?.({ accountId: target.accountId });
    return status;
  });
}
