import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {ShellReadModels} from '../../packages/core/shell-read-models.ts';
import type {Store} from '../../packages/storage/store.ts';

const page = z.strictObject({limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(2048).optional()});
export function registerShellReadRoutes(app: FastifyInstance, store: Store) {
  const models = new ShellReadModels(store);
  app.addHook('onSend', async (request, reply) => {if (request.url.startsWith('/api/shell/')) reply.header('Cache-Control', 'no-store');});
  app.get('/api/shell/navigation', request => models.navigation(page.extend({archived: z.enum(['true', 'false']).transform(value => value === 'true').optional(), text: z.string().max(200).optional()}).parse(request.query)));
  app.get<{Params: {id: string}}>('/api/shell/navigation/:id', request => {z.strictObject({}).parse(request.query); return models.navigationItem(z.string().min(1).max(200).parse(request.params.id));});
  app.get('/api/shell/settings', request => {z.strictObject({}).parse(request.query); return models.settings();});
  app.get('/api/shell/resources', request => models.resources(page.parse(request.query)));
  app.post('/api/shell/draft-references', request => models.draftReferences(z.strictObject({keys: z.array(z.string().min(1).max(2048)).max(500)}).parse(request.body).keys));
}
