import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { capabilityEnabled } from '../../packages/core/capability-flags.ts';

interface SessionBranchReadRouteHost {
  overview(threadId: string): unknown;
  captureMessages(captureId: string, input: { cursor?: string | null; limit?: number }): unknown;
  importedMessages(conversationId: string, input: { cursor?: string | null; limit?: number }): unknown;
}

const page = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.string().regex(/^[1-9][0-9]?$|^100$/).transform(Number).optional(),
});

/** Owner-fenced historical reads. Captured and imported provenance stays
 * readable when creation flags are off; the overview reports current flag
 * state so the UI only offers live actions the host would admit. */
export function registerSessionBranchReadRoutes(app: FastifyInstance, reads: SessionBranchReadRouteHost) {
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/session-branches')) reply.header('Cache-Control', 'no-store');
  });
  app.get<{ Params: { threadId: string } }>('/api/session-branches/:threadId', async request => ({
    enabled: { branch: capabilityEnabled('sessions.branchV1'), import: capabilityEnabled('sessions.inertImportV1') },
    ...(reads.overview(request.params.threadId) as Record<string, unknown>),
  }));
  app.get<{ Params: { captureId: string } }>('/api/session-branches/captures/:captureId/messages', async request =>
    reads.captureMessages(request.params.captureId, page.parse(request.query)));
  app.get<{ Params: { conversationId: string } }>('/api/session-branches/imports/:conversationId/messages', async request =>
    reads.importedMessages(request.params.conversationId, page.parse(request.query)));
}
