import type { FastifyInstance } from 'fastify';
import type { Service } from '../../packages/core/service.ts';
import { initNetworkProxyTransport, refreshNetworkProxyTransport } from '../../packages/core/network-proxy-transport.ts';
import { networkProxySettingsFor } from '../../packages/core/network-proxy-settings.ts';
import { networkProxySaveSchema, networkProxyDeleteSchema } from '../../packages/contracts/network-proxy.ts';

/**
 * #1531 T02 — profile-wide proxy management.
 * Dedicated authenticated path beneath the host's origin/cookie/CSRF hooks;
 * values never enter Store.command, snapshots, logs or sync. Public responses
 * are always credential-free.
 */
export function registerNetworkProxyRoutes(app: FastifyInstance, service: Service) {
  const settings = networkProxySettingsFor(service.store.dataDir);
  void initNetworkProxyTransport(settings).catch(() => {});
  app.get('/api/network-proxy', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').send(await settings.read()));
  app.put('/api/network-proxy', { bodyLimit: 32768 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const state = await settings.save(networkProxySaveSchema.parse(request.body));
    await refreshNetworkProxyTransport();
    return state;
  });
  app.delete('/api/network-proxy', { bodyLimit: 2048 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const state = await settings.remove(networkProxyDeleteSchema.parse(request.body));
    await refreshNetworkProxyTransport();
    return state;
  });
}
