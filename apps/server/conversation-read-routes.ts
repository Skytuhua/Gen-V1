import type {FastifyInstance} from 'fastify';
import {z} from 'zod';

interface ConversationReadRouteHost {
  readonly authority: 'personal';
  context(input: unknown): unknown;
  history(input: unknown): unknown;
  content(input: unknown): unknown;
  updates(input: unknown): unknown;
}
const cursor = z.string().min(1).max(2048);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const target = z.strictObject({authority: z.literal('personal'), includeArchived: z.enum(['true', 'false']).transform(value => value === 'true').optional()});
const scope = target.extend({scopeKey: hash});
const history = scope.extend({limit: z.string().regex(/^[1-9][0-9]?$/).transform(Number).pipe(z.number().max(50)).optional(), cursor: cursor.optional()});

/** Register before app.ready(), only in the existing authenticated Personal server. */
export function registerConversationReadRoutes(app: FastifyInstance, reads: ConversationReadRouteHost) {
  if (reads.authority !== 'personal') throw Error('A Personal conversation reader is required');
  // onSend also covers auth, validation and revocation failures sent by earlier hooks.
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/conversations/')) reply.header('Cache-Control', 'no-store');
  });
  app.get<{Params: {threadId: string}}>('/api/conversations/:threadId', async request =>
    reads.context({...target.parse(request.query), threadId: request.params.threadId}));
  app.get<{Params: {threadId: string}}>('/api/conversations/:threadId/transcript', async request =>
    reads.history({...history.parse(request.query), threadId: request.params.threadId}));
  app.get<{Params: {threadId: string}}>('/api/conversations/:threadId/content', async request =>
    reads.content({...scope.extend({cursor}).parse(request.query), threadId: request.params.threadId}));
  app.get<{Params: {threadId: string}}>('/api/conversations/:threadId/updates', async request =>
    reads.updates({...scope.extend({checkpoint: cursor}).parse(request.query), threadId: request.params.threadId}));
}
