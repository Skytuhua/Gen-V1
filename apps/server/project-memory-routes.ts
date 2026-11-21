import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Sha256Hex } from '../../packages/contracts/hashing.ts';
import { HarnessError } from '../../packages/contracts/index.ts';
import { memoryActionEnvelopeSchema, memoryScope, memoryScopeSchema, memorySourceRefV1Schema } from '../../packages/contracts/project-memory.ts';
import { ProjectMemory } from '../../packages/core/project-memory.ts';
import { digest } from '../../packages/storage/store.ts';
import type { Service } from '../../packages/core/service.ts';

const id = z.string().min(1).max(200).regex(/^[a-zA-Z0-9:_.-]+$/);
const ownerQuery = z.strictObject({ threadId: id });
const revisionQuery = ownerQuery.extend({ itemId: id, revision: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().positive().safe()) });
const sourceQuery = revisionQuery.extend({ sourceDigest: Sha256Hex, sourceRef: z.string().max(4096).transform((text, ctx) => { try { return JSON.parse(text) as unknown; } catch { ctx.addIssue({code: 'custom', message: 'Invalid source reference'}); return z.NEVER; } }).pipe(memorySourceRefV1Schema).optional() });

/** Register only under the Personal host session/origin/CSRF hooks. No tool or plugin dispatch. */
export function registerProjectMemoryRoutes(app: FastifyInstance, createMemory: () => ProjectMemory, service?: Service): void {
  let instance: ProjectMemory | undefined;
  const memory = () => instance ??= createMemory();
  app.addHook('onSend', async (request, reply) => { if (/^\/api\/projects\/[^/]+\/memory(?:[/?]|$)/.test(request.url)) reply.header('Cache-Control', 'no-store'); });
  const admission = (projectId: string, threadId: string) => memory().access(id.parse(projectId), threadId);
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/memory', async request => {
    const query = ownerQuery.parse(request.query); return memory().read(await admission(request.params.projectId, query.threadId));
  });
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/memory/usage', async request => {
    const query = ownerQuery.parse(request.query); return memory().usage(await admission(request.params.projectId, query.threadId));
  });
  const host = () => {if (!service) throw new HarnessError('REQUEST_CONTEXT_DISABLED', 'This host has no request preparation owner.'); return service;};
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/memory/requests/prepare', {bodyLimit: 80 * 1024}, async request => {
    const body = z.strictObject({threadId: id, prompt: z.string().min(1).max(65536), modelId: z.string().min(1).max(300).optional(), thinkingLevel: z.string().min(1).max(100).nullable().optional()}).parse(request.body);
    return host().prepareProjectMemory(id.parse(request.params.projectId), body.threadId, body.prompt, {modelId: body.modelId, thinkingLevel: body.thinkingLevel});
  });
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/memory/requests/latest', async request => {
    const query = ownerQuery.parse(request.query); return host().latestProjectMemory(id.parse(request.params.projectId), query.threadId);
  });
  app.post<{ Params: { projectId: string; requestId: string } }>('/api/projects/:projectId/memory/requests/:requestId/exclude', {bodyLimit: 4096}, async request => {
    const body = z.strictObject({scope: memoryScopeSchema, contextGeneration: z.number().int().nonnegative().safe(), itemId: id, revision: z.number().int().positive().safe()}).parse(request.body);
    if (body.scope.projectId !== id.parse(request.params.projectId)) throw new HarnessError('CAPABILITY_DENIED', 'The exclusion project changed.');
    return host().excludeProjectMemory(id.parse(request.params.requestId), body);
  });
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/memory/source', async request => {
    const query = sourceQuery.parse(request.query); return memory().source(await admission(request.params.projectId, query.threadId), query.itemId, query.revision, query.sourceDigest, query.sourceRef);
  });
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/memory/forget', async request => {
    const query = revisionQuery.parse(request.query); return memory().forgetPreview(await admission(request.params.projectId, query.threadId), query.itemId, query.revision);
  });
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/memory/actions', { bodyLimit: 32 * 1024 }, async request => {
    const body = memoryActionEnvelopeSchema.parse(request.body), access = await admission(request.params.projectId, body.scope.threadId);
    if (digest(memoryScope(access)) !== digest(body.scope)) throw new HarnessError('CAPABILITY_DENIED', 'The reviewed project, account or conversation changed.');
    const receipt = memory().review(access, { id: body.commandId, type: 'project.memory.review', threadId: access.threadId, payload: { operation: body.operation, scope: body.scope } }, 'local-user');
    service?.projectMemoryReviewed(access, body.operation); return receipt;
  });
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/memory/export', { bodyLimit: 4096 }, async request => {
    const body = z.strictObject({ scope: memoryScopeSchema }).parse(request.body), access = await admission(request.params.projectId, body.scope.threadId);
    if (digest(memoryScope(access)) !== digest(body.scope)) throw new HarnessError('CAPABILITY_DENIED', 'The export owner changed.');
    return memory().export(access);
  });
  // Bounded local maintenance only. Native history and external services are outside its custody.
  const timer = setInterval(() => { try { memory().purge(); } catch { /* Keep tombstones active; retry the bounded batch later. */ } }, 60_000);
  timer.unref(); app.addHook('onClose', async () => clearInterval(timer));
}
