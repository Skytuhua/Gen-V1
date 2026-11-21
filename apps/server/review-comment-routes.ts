import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';
import { HarnessError, type Thread } from '../../packages/contracts/index.ts';
import { capabilityEnabled } from '../../packages/core/capability-flags.ts';
import { listReviewComments } from '../../packages/core/review-comments.ts';

const identifier = z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/);

/** Registered beneath the existing host/origin/cookie/CSRF hooks. */
export function registerReviewCommentRoutes(app: FastifyInstance, service: Service) {
  app.get('/api/threads/:threadId/review-comments', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { threadId } = z.strictObject({ threadId: identifier }).parse(request.params);
    const thread = service.store.get<Thread>('thread', threadId);
    if (!thread) throw new HarnessError('NOT_FOUND', 'Unknown thread.');
    if (!capabilityEnabled('ui.reviewCommentsV1')) return { enabled: false, comments: [] };
    return { enabled: true, comments: listReviewComments(service.store, threadId) };
  });
}
