import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Service } from '../../packages/core/service.ts';
import { HarnessError } from '../../packages/contracts/index.ts';
import type { ProjectSummary } from '../../packages/contracts/workspace.ts';
import { agentFilePolicyScopeSchema, readAgentFilePolicy, saveAgentFilePolicy } from '../../packages/core/agent-file-policy-store.ts';

const readQuery = z.strictObject({ scope: z.string() });
const saveBody = z.strictObject({ scope: z.string(), baseRevision: z.number().int().nonnegative(), rulesText: z.string() });

/** Registered beneath the existing host/origin/cookie/CSRF hooks. */
export function registerAgentFilePolicyRoutes(app: FastifyInstance, service: Service) {
	const validateScope = (scope: string) => {
		if (scope === 'global') return;
		const projectId = scope.slice('project:'.length);
		const project = service.store.get<ProjectSummary>('workspaceProject', projectId);
		if (!project || project.authority.kind !== 'local') throw new HarnessError('CAPABILITY_DENIED', 'The local project is unavailable.');
	};
	app.get('/api/agent-file-policy', async (request, reply) => {
		const { scope } = readQuery.parse(request.query);
		if (!agentFilePolicyScopeSchema(scope)) throw new HarnessError('INVALID_INPUT', 'Choose a global or project scope.');
		validateScope(scope);
		reply.header('Cache-Control', 'no-store');
		return readAgentFilePolicy(service.store, scope);
	});
	app.put('/api/agent-file-policy', { bodyLimit: 64 * 1024 }, async (request, reply) => {
		const body = saveBody.parse(request.body);
		if (!agentFilePolicyScopeSchema(body.scope)) throw new HarnessError('INVALID_INPUT', 'Choose a global or project scope.');
		validateScope(body.scope);
		reply.header('Cache-Control', 'no-store');
		return saveAgentFilePolicy(service.store, body.scope, body.baseRevision, body.rulesText);
	});
}
