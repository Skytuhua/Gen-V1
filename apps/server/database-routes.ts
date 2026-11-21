// Database browser read/query routes (T04): 30s schema cache plus bounded
// read-only queries over thread attachments. Every handler revalidates the
// flag and attachment→thread ownership; results publish as thread DataRecords
// with provenance 'database-query'. Global host/origin/session/CSRF hooks in
// server.ts apply; secrets never leave the gateway.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DATABASE_LIMITS } from '../../packages/contracts/database.ts';
import type { Service } from '../../packages/core/service.ts';
import { capabilityEnabled } from '../../packages/core/capability-flags.ts';

const uuid = z.string().uuid();
const queryBody = z.strictObject({
	sql: z.string().min(1).max(DATABASE_LIMITS.maxSqlChars),
	limit: z.number().int().min(1).max(DATABASE_LIMITS.maxRows).optional(),
	timeoutMs: z.number().int().min(100).max(DATABASE_LIMITS.maxTimeoutMs).optional(),
	requestId: uuid.optional(),
});
const SCHEMA_CACHE_MS = 30_000;
const schemaCache = new Map<string, { value: unknown; expiresAt: number }>();
const inFlight = new Map<string, AbortController>();

export function registerDatabaseRoutes(app: FastifyInstance, service: Service) {
	app.addHook('onSend', async (request, reply) => {
		if (request.url.startsWith('/api/threads/')) reply.header('Cache-Control', 'no-store');
	});
	app.get('/api/databases', async () => {
		if (!capabilityEnabled('data.databaseBrowserV1')) return { available: false as const, connections: [], attachments: [] };
		const databases = service.databases();
		return { available: true as const, connections: databases.connections(), attachments: databases.allAttachments() };
	});
	app.get<{ Params: { threadId: string } }>('/api/threads/:threadId/databases', async request => {
		const threadId = uuid.parse(request.params.threadId);
		const databases = service.databases();
		return { connections: databases.connections(), attachments: databases.attachments(threadId) };
	});
	app.get<{ Params: { threadId: string; attachmentId: string }; Querystring: { refresh?: string } }>(
		'/api/threads/:threadId/databases/:attachmentId/schema', async request => {
			const threadId = uuid.parse(request.params.threadId);
			const attachmentId = uuid.parse(request.params.attachmentId);
			const databases = service.databases();
			const { connection } = databases.attachmentFor(threadId, attachmentId);
			const cached = schemaCache.get(attachmentId);
			const refresh = request.query.refresh === 'true';
			if (cached && cached.expiresAt > Date.now() && !refresh) return cached.value;
			const schema = await databases.gateway().schema(connection);
			schemaCache.set(attachmentId, { value: schema, expiresAt: Date.now() + SCHEMA_CACHE_MS });
			return schema;
		});
	app.post<{ Params: { threadId: string; attachmentId: string } }>(
		'/api/threads/:threadId/databases/:attachmentId/query', async request => {
			const threadId = uuid.parse(request.params.threadId);
			const attachmentId = uuid.parse(request.params.attachmentId);
			const body = queryBody.parse(request.body);
			const databases = service.databases();
			const { connection } = databases.attachmentFor(threadId, attachmentId);
			const controller = new AbortController();
			const requestId = body.requestId ?? randomUUID();
			inFlight.set(requestId, controller);
			try {
				const result = await databases.gateway().query(connection, { sql: body.sql, signal: controller.signal, limit: body.limit, timeoutMs: body.timeoutMs });
				const record = service.publishData(threadId, result, 'database-query');
				return { requestId, dataId: record.id, result };
			} finally {
				inFlight.delete(requestId);
			}
		});
	app.post<{ Params: { threadId: string; attachmentId: string; requestId: string } }>(
		'/api/threads/:threadId/databases/:attachmentId/query/:requestId/cancel', async request => {
			const threadId = uuid.parse(request.params.threadId);
			const attachmentId = uuid.parse(request.params.attachmentId);
			service.databases().attachmentFor(threadId, attachmentId);
			inFlight.get(request.params.requestId)?.abort();
			return { cancelled: true };
		});
}
