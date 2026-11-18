import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HarnessError } from '../../packages/contracts/index.ts';
import { integrationSecretReferenceStatusSchema } from '../../packages/contracts/integration-secrets.ts';
import type { WorkspaceHost } from './workspace-host.ts';

const unavailable = () => new HarnessError('INTEGRATION_UNAVAILABLE', 'Secret reference metadata is unavailable.');

/** Public metadata only, registered beneath the existing host session hooks. */
export function registerIntegrationSecretReferenceRoutes(app: FastifyInstance, host: Pick<WorkspaceHost, 'secretReferences'>) {
  app.get('/api/integrations/secret-references', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    z.strictObject({}).parse(request.query);
    if (!host.secretReferences) throw unavailable();
    let value: unknown;
    try { value = await host.secretReferences(); } catch { throw unavailable(); }
    const parsed = integrationSecretReferenceStatusSchema.safeParse(value);
    if (!parsed.success) throw unavailable();
    return { ...parsed.data, ...(parsed.data.unavailableReason ? { unavailableReason: 'Secret reference metadata is unavailable.' } : {}) };
  });
}
