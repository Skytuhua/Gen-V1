import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Service} from '../../packages/core/service.ts';
import {sourceCaptureRequestV1Schema, sourceDescribeRequestV1Schema, sourceOpenRequestV1Schema, sourceRefreshRequestV1Schema, outputReadRequestV1Schema, workbenchInputRecoveryRequestV1Schema} from '../../packages/contracts/source-selection.ts';
import {workspaceHost, githubFor} from './workspace-host.ts';

const ownerParams = z.strictObject({threadId: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/)});
/** Registered beneath the existing Host, Origin, session and CSRF hooks. */
export function registerSourceWorkbenchRoutes(app: FastifyInstance, service: Service): void {
  // Composed hosts can omit this optional owning service. Expose no workbench
  // endpoints in that case; a partial host must never gain fallback authority.
  if (!service.sourceWorkbench) return;
  const host = workspaceHost(service);
  service.sourceWorkbench.bindProjectReaders(host.projects, githubFor(host));
  app.get('/api/workbench/threads/:threadId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); z.strictObject({}).parse(request.query);
    return service.sourceWorkbench.list(ownerParams.parse(request.params).threadId);
  });
  app.get('/api/workbench/threads/:threadId/evidence', async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); z.strictObject({}).parse(request.query);
    return service.sourceWorkbench.evidence(ownerParams.parse(request.params).threadId);
  });
  app.get('/api/workbench/threads/:threadId/context', async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); z.strictObject({}).parse(request.query);
    return service.sourceWorkbench.context(ownerParams.parse(request.params).threadId);
  });
  app.get('/api/workbench/threads/:threadId/inputs', async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); z.strictObject({}).parse(request.query);
    return service.sourceWorkbench.inputs(ownerParams.parse(request.params).threadId);
  });
  app.post('/api/workbench/inputs/recover', {bodyLimit: 16 * 1024}, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); return service.sourceWorkbench.recoverInput(workbenchInputRecoveryRequestV1Schema.parse(request.body));
  });
  app.post('/api/workbench/sources/describe', {bodyLimit: 16 * 1024}, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); return service.sourceWorkbench.describe(sourceDescribeRequestV1Schema.parse(request.body));
  });
  app.post('/api/workbench/sources/capture', {bodyLimit: 24 * 1024}, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); return service.sourceWorkbench.capture(sourceCaptureRequestV1Schema.parse(request.body));
  });
  app.post('/api/workbench/sources/open', {bodyLimit: 24 * 1024}, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); return service.sourceWorkbench.open(sourceOpenRequestV1Schema.parse(request.body));
  });
  app.post('/api/workbench/sources/refresh', {bodyLimit: 24 * 1024}, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); return service.sourceWorkbench.refresh(sourceRefreshRequestV1Schema.parse(request.body));
  });
  app.post('/api/workbench/output/read', {bodyLimit: 128 * 1024}, async (request, reply) => {
    reply.header('Cache-Control', 'no-store'); return service.sourceWorkbench.readOutput(outputReadRequestV1Schema.parse(request.body));
  });
}
