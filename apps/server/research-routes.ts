import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {CommandReceipt, HostCommand} from '../../packages/contracts/index.ts';
import {RESEARCH_SOURCE_BYTES, researchCommandSchema, researchContextSchema, researchHashSchema, type ResearchContext} from '../../packages/contracts/research.ts';
import type {PersonalResearchRepository} from '../../packages/research/repository.ts';

const contextQuery = z.strictObject({authority: z.literal('personal'), threadId: researchContextSchema.shape.threadId, projectId: researchContextSchema.shape.projectId.unwrap().optional()});
const integer = z.string().regex(/^(?:0|[1-9][0-9]{0,15})$/).transform(Number).pipe(z.number().int().nonnegative());
const revision = integer.pipe(z.number().int().positive());
const pageQuery = contextQuery.extend({kind: z.enum(['sources', 'documents']), limit: integer.pipe(z.number().min(1).max(100)).optional(), cursor: z.string().max(2048).optional()}).strict();
const sourceQuery = contextQuery.extend({revision: revision.optional()}).strict();
const passageQuery = contextQuery.extend({revision, sha256: researchHashSchema, start: integer, end: integer}).strict();
const fileQuery = contextQuery.extend({resourceId: researchContextSchema.shape.threadId, relativePath: z.string().min(1).max(4096).optional()}).strict();
const context = (query: z.infer<typeof contextQuery>): ResearchContext => ({authority: {kind: 'personal'}, threadId: query.threadId, projectId: query.projectId ?? null});
const noStore = async (_request: FastifyRequest, reply: FastifyReply) => {reply.header('Cache-Control', 'no-store');};

export interface ResearchRouteHost {
  research: Pick<PersonalResearchRepository, 'list' | 'source' | 'document' | 'passage' | 'fileReference'>;
  command(command: HostCommand): Promise<CommandReceipt>;
}
/** Register only inside buildServer's existing host/session/origin/CSRF boundary. */
export function registerResearchRoutes(app: FastifyInstance, host: ResearchRouteHost) {
  app.get('/api/research', {onRequest: noStore}, async request => {
    const query = pageQuery.parse(request.query);
    return host.research.list(context(query), {kind: query.kind, limit: query.limit, cursor: query.cursor});
  });
  app.get<{Params: {id: string}}>('/api/research/sources/:id', {onRequest: noStore}, async request => {
    const query = sourceQuery.parse(request.query);
    return host.research.source(context(query), request.params.id, query.revision);
  });
  app.get<{Params: {id: string}}>('/api/research/sources/:id/passage', {onRequest: noStore}, async request => {
    const query = passageQuery.parse(request.query);
    return host.research.passage(context(query), {sourceId: request.params.id, revision: query.revision, sha256: query.sha256, start: query.start, end: query.end});
  });
  app.get<{Params: {id: string}}>('/api/research/documents/:id', {onRequest: noStore}, async request => {
    const query = sourceQuery.parse(request.query);
    return host.research.document(context(query), request.params.id, query.revision);
  });
  app.get('/api/research/file-reference', {onRequest: noStore}, async (request, reply) => {
    const query = fileQuery.parse(request.query), controller = new AbortController();
    const close = () => {if (!reply.raw.writableEnded) controller.abort();}; reply.raw.once('close', close);
    try {return await host.research.fileReference(context(query), query.resourceId, query.relativePath, controller.signal);}
    finally {reply.raw.removeListener('close', close);}
  });
  app.post('/api/research/commands', {
    onRequest: noStore, bodyLimit: RESEARCH_SOURCE_BYTES + 64 * 1024,
    errorHandler(error, _request, reply) {
      if ((error as {code?: string}).code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({error: {code: 'RESOURCE_LIMIT', message: 'The research command exceeds its request limit.'}});
      throw error;
    },
  }, async request => host.command(researchCommandSchema.parse(request.body)));
}
