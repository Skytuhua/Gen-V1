import { afterEach, expect, it, vi } from 'vitest';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HarnessError } from '../packages/contracts/index.ts';
import { resolveGrant } from '../packages/core/security.ts';
import { buildServer } from '../apps/server/server.ts';
import { approvedContext7, context7FixtureKey } from './fixtures/approved-context7.mjs';

// Native leases alone are substituted for the repository preparation fixture.
// Service, Store, authenticated HTTP, exact file observations and approvals are
// real. No model, upstream integration, or native confinement proof is implied.
vi.mock('../packages/core/file-access.ts', async original => {
  const actual = await original();
  const lease = async (_paths, signal, action) => {
    if (signal.aborted) throw new HarnessError('CANCELLED', 'Owned advice fixture cancelled');
    return action([]);
  };
  return { ...actual, withPathGuard: lease,
    withResourceGrant: async (grant, dataDir, path, write, signal, action) => {
      const target = await resolveGrant(grant, path, write, dataDir);
      return lease([], signal, async () => {
        if (await resolveGrant(grant, path, write, dataDir) !== target) throw new HarnessError('CAPABILITY_DENIED', 'Owned grant changed');
        return action(target);
      });
    },
  };
});
const originalNode = process.execPath;
afterEach(() => { process.execPath = originalNode; vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function fixture(kind = 'integration.context7', beforePrepare) {
  vi.stubEnv('HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1', '1');
  const x = await approvedContext7();
  await beforePrepare?.(x);
  let operation;
  if (kind === 'repository.test') {
    process.execPath = x.executable;
    await writeFile(join(x.project, 'owned.test.cjs'), "require('node:test')('owned', () => {});\n");
    const grant = (await x.command('resource.grant', { path: x.project, kind: 'project', writable: true })).result;
    operation = await x.service.tool({ name: 'repository_test_prepare', args: { resourceId: grant.id, testFile: 'owned.test.cjs' } }, x.ctx);
  } else operation = await x.prepare();
  const app = await buildServer(x.service, { port: 4319, dev: false });
  x.keep(() => app.close());
  const boot = await app.inject({ url: '/api/bootstrap', headers: { host: '127.0.0.1:4319' } });
  const headers = { host: '127.0.0.1:4319', cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken };
  const target = { threadId: operation.threadId, operationId: operation.id, operationRevision: operation.revision };
  const url = '/api/operation-execution-review?' + new URLSearchParams({ ...target, operationRevision: String(operation.revision) });
  const read = () => app.inject({ url, headers });
  return { ...x, app, headers, url, target, operation, read };
}

it.each(['repository.test', 'integration.context7'])('records real %s preparation advice without issuing approval or starting a child', async kind => {
  const x = await fixture(kind), records = x.store.all('operationExecutionAdvice');
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ version: 1, target: x.target, sourceCommitment: expect.any(String), recorded: {
    recordedAt: expect.any(String), decisionAtPreparation: 'REQUIRE_APPROVAL',
    advisory: { label: 'Advisory', classifier: 'execution-policy-advisory', model: 'deterministic-v1', version: '1.0.0', uncertainty: 'medium', cannotAuthorize: true },
  } });
  expect(x.store.get('operation', x.operation.id)).toMatchObject({ status: 'prepared', approved: false });
  expect(x.store.all('approval')).toEqual([]); expect(await x.starts()).toEqual([]);
  expect(JSON.stringify(x.store.snapshot())).not.toContain(records[0].sourceCommitment);
  expect(JSON.stringify(x.store.eventsAfter(0))).not.toContain(records[0].sourceCommitment);
});

it('projects stored provenance separately from current recorded state and actual host policy', async () => {
  const x = await fixture(), before = x.store.sequence, response = await x.read();
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toMatchObject({ version: 1, ...x.target,
    current: { operationStatus: 'prepared', approved: false, authority: 'NOT_EVALUATED' },
    execution: { mode: 'TRUSTED_HOST', backendId: 'TRUSTED_HOST', runner: 'context7-stdio',
      policy: { filesystem: 'unrestricted', network: 'unrestricted', processes: 'unrestricted' },
      isolated: { status: 'BLOCKED', stage: 'ISOLATED_EXECUTION', code: 'BLOCKED_BACKEND_SELECTION', approvedBackendId: null, platformProofRef: null } },
    advice: { state: 'RECORDED', validation: 'NOT_REVALIDATED', recorded: { decisionAtPreparation: 'REQUIRE_APPROVAL', advisory: { cannotAuthorize: true } } },
  });
  expect(response.body).not.toContain('sourceCommitment'); expect(response.body).not.toContain(context7FixtureKey);
  expect(x.store.sequence).toBe(before); expect(await x.starts()).toEqual([]);
});

it.each(['epoch', 'accountId', 'mode', 'status'])('labels recorded advice stale after the current owner/state changes %s', async field => {
  const x = await fixture(), thread = x.store.get('thread', x.thread.id);
  const value = field === 'epoch' ? thread.epoch + 1 : field === 'mode' ? 'plan' : field === 'status' ? 'stopped' : 'changed-account';
  x.store.internal('fixture.changed', thread.id, () => x.store.put('thread', thread.id, thread.id, { ...thread, [field]: value }));
  const before = x.store.sequence, response = await x.read();
  expect(response.statusCode).toBe(200);
  expect(response.json().advice).toMatchObject({ state: 'STALE', validation: 'NOT_REVALIDATED', recorded: { decisionAtPreparation: 'REQUIRE_APPROVAL' } });
  expect(response.json().current.authority).toBe('NOT_EVALUATED');
  expect(x.store.sequence).toBe(before); expect(await x.starts()).toEqual([]);
});

it('detects changed arguments under the same operation revision without exposing the private commitment', async () => {
  const x = await fixture();
  x.store.internal('fixture.changed', x.thread.id, () => x.store.put('operation', x.operation.id, x.thread.id,
    { ...x.operation, args: { ...x.operation.args, request: { ...x.operation.args.request, args: { topic: 'changed' } } } }));
  const response = await x.read();
  expect(response.statusCode).toBe(200); expect(response.json().advice).toMatchObject({ state: 'STALE', reason: 'ACTION_CHANGED' });
  expect(response.body).not.toContain('sourceCommitment'); expect(await x.starts()).toEqual([]);
});

it('retains historical preparation provenance after cancellation instead of reporting it as the current decision', async () => {
  const x = await fixture();
  await x.command('operation.reject', { operationId: x.operation.id, revision: x.operation.revision });
  const response = await x.read();
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ current: { operationStatus: 'cancelled', authority: 'NOT_EVALUATED' },
    advice: { state: 'STALE', reason: 'STATE_CHANGED', recorded: { decisionAtPreparation: 'REQUIRE_APPROVAL' } } });
  expect(x.store.all('operationExecutionAdvice')).toHaveLength(1); expect(await x.starts()).toEqual([]);
});

it('keeps a real declined trust decision authoritative even when preparation advice exists', async () => {
  const x = await fixture('repository.test'), review = await x.service.projectTrust.preview(x.target);
  await x.service.projectTrust.decide({ ...x.target, reviewId: review.reviewId, expectedTrustRevision: review.current.revision, decision: 'declined' });
  const response = await x.read();
  expect(response.statusCode).toBe(200); expect(response.json().advice).toMatchObject({ state: 'STALE', reason: 'TRUST_CHANGED' });
  await expect(x.command('operation.approve', { operationId: x.operation.id, revision: x.operation.revision })).rejects.toMatchObject({ code: 'PROJECT_TRUST_REQUIRED' });
  expect(x.store.all('approval')).toEqual([]); expect(await x.starts()).toEqual([]);
});

it('does not pretend a metadata GET revalidated changed executable/configuration bytes', async () => {
  const x = await fixture(); await appendFile(join(x.bundle, x.entry), '\n// changed after preparation\n');
  const response = await x.read();
  expect(response.statusCode).toBe(200); expect(response.json().advice.validation).toBe('NOT_REVALIDATED');
  expect(response.json().current.authority).toBe('NOT_EVALUATED');
  expect((await x.execute(x.operation)).status).toBe('failed'); expect(await x.starts()).toEqual([]);
});

it('makes advice unavailable when its computation fails without altering the required approval', async () => {
  const x = await fixture('integration.context7', async x => {
    const original = x.service.effects.privateArgumentCommitment.bind(x.service.effects);
    vi.spyOn(x.service.effects, 'privateArgumentCommitment').mockImplementation(call => {
      if (call.name === 'operation.executionAdvice') throw Error('synthetic-private-computation-diagnostic');
      return original(call);
    });
  });
  const response = await x.read();
  expect(response.statusCode).toBe(200); expect(response.json().advice).toEqual({ state: 'UNAVAILABLE', reason: 'COMPUTATION_FAILED' });
  expect(response.body).not.toContain('synthetic-private');
  expect(x.store.get('operation', x.operation.id)).toMatchObject({ status: 'prepared', approved: false });
  expect(x.store.all('approval')).toEqual([]); expect(await x.starts()).toEqual([]);
});

it('rejects corrupted private metadata without publishing an injected field or exception', async () => {
  const x = await fixture(), row = x.store.all('operationExecutionAdvice')[0];
  expect(row).toBeDefined();
  x.store.internal('fixture.corrupt', x.thread.id, () => x.store.put('operationExecutionAdvice', JSON.stringify([x.operation.id, x.operation.revision]), x.thread.id,
    { ...row, credential: context7FixtureKey }));
  const response = await x.read();
  expect(response.statusCode).toBe(200); expect(response.json().advice).toEqual({ state: 'UNAVAILABLE', reason: 'INVALID_RECORD' });
  expect(response.body).not.toContain(context7FixtureKey); expect(response.body).not.toContain('sourceCommitment');
});

it('rejects caller-selected metadata, duplicate targets and stale operation revisions', async () => {
  const x = await fixture(), before = x.store.sequence;
  for (const suffix of ['&approvedBackendId=caller-backend', '&threadId=foreign', '&advisory=ALLOW'])
    expect((await x.app.inject({ url: x.url + suffix, headers: x.headers })).statusCode).toBe(400);
  expect((await x.app.inject({ url: x.url.replace('operationRevision=1', 'operationRevision=2'), headers: x.headers })).statusCode).toBe(400);
  expect((await x.app.inject({ url: x.url.replace('threadId=owner', 'threadId=foreign'), headers: x.headers })).statusCode).toBe(404);
  expect(x.store.sequence).toBe(before);
});

it('keeps the metadata read behind the existing real authenticated session', async () => {
  const x = await fixture(), before = x.store.sequence;
  const response = await x.app.inject({ url: x.url, headers: { host: x.headers.host } });
  expect(response.statusCode).toBe(401); expect(x.store.sequence).toBe(before);
});
