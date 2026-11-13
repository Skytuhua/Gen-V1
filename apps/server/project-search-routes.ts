import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';
import { HarnessError } from '../../packages/contracts/index.ts';
import { projectSearchIdSchema, searchRequestSchema } from '../../packages/contracts/project-search.ts';
import { ProjectSearch } from '../../packages/workspace/project-search.ts';
import { workspaceHost } from './workspace-host.ts';

/** Integration owns registration beneath the existing authenticated server hooks. */
export function registerProjectSearchRoutes(app: FastifyInstance, service: Service) {
  const search = new ProjectSearch(workspaceHost(service).projects), active = new Set<AbortController>();
  app.register(async scope => {
    // onSend also covers errors sent by the parent's earlier auth hooks.
    scope.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
    scope.get('/api/projects/:projectId/search', async (request, reply) => {
      const { projectId } = z.strictObject({ projectId: projectSearchIdSchema }).parse(request.params);
      const raw = request.raw.url ?? request.url, query: Record<string, string | number> = Object.create(null);
      for (const pair of (raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '').split('&')) {
        if (!pair) continue;
        const split = pair.indexOf('='), encodedKey = split < 0 ? pair : pair.slice(0, split), encodedValue = split < 0 ? '' : pair.slice(split + 1);
        let key: string, value: string;
        try { key = decodeURIComponent(encodedKey.replaceAll('+', ' ')); value = decodeURIComponent(encodedValue.replaceAll('+', ' ')); }
        catch { throw new HarnessError('INVALID_INPUT', 'Search query must use valid UTF-8.'); }
        if (Object.hasOwn(query, key)) throw new HarnessError('INVALID_INPUT', 'Search query keys must be unique.');
        query[key] = value;
      }
      if (query.limit !== undefined) {
        if (typeof query.limit !== 'string' || !/^[0-9]+$/.test(query.limit)) throw new HarnessError('INVALID_INPUT', 'Choose a search limit from 1 to 100.');
        query.limit = Number(query.limit);
      }
      if (request.body !== undefined || Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined) throw new HarnessError('INVALID_INPUT', 'Search does not accept a body.');
      const input = searchRequestSchema.parse(query), controller = new AbortController();
      const cancel = () => controller.abort(), close = () => { if (!reply.raw.writableFinished) cancel(); };
      active.add(controller); request.raw.once('aborted', cancel); reply.raw.once('close', close);
      try { return await search.search(projectId, input, controller.signal); }
      finally { active.delete(controller); request.raw.removeListener('aborted', cancel); reply.raw.removeListener('close', close); }
    });
  });
  app.addHook('preClose', async () => { for (const controller of active) controller.abort(); });
  app.addHook('onClose', async () => { search.dispose(); });
}
