import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { ToolEffectReadModels } from '../packages/core/tool-effect-read-models.ts';
import { buildServer } from '../apps/server/server.ts';

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'effect-public-projection-'));
  const store = new Store(root), reader = new ToolEffectReadModels(store);
  cleanups.push(() => { reader.dispose(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const thread = { id: 'thread-public', title: 'Public ledger', projectName: null, createdAt: '', updatedAt: '',
    status: 'idle', epoch: 1, runId: null, modelId: 'test/model', sessionPath: null,
    accountId: null, projectId: null, workspaceId: null };
  store.internal('fixture.thread', thread.id, () => { store.put('thread', thread.id, thread.id, thread); });
  const owner = { threadId: thread.id, runId: null, epoch: 1, accountBinding: null, projectId: null, workspaceId: null };
  const records = [1, 2].map(index => {
    const approval = { approvalId: 'approval-' + index, operationId: 'operation-' + index,
      actionCommitment: String(index + 2).repeat(64), owner, targetPreconditions: ['version=1'],
      issuedAt: '2026-11-17T00:00:00Z', expiresAt: '2026-11-17T00:15:00Z', remainingUses: 0, issuer: 'authenticated_user' };
    const effect = { effectId: 'effect-' + index, invocationId: 'invocation-' + index, attemptId: 1, parentInvocationId: null,
      owner, threadId: thread.id, toolId: 'operation:file.replace', definitionDigest: String(index + 4).repeat(64),
      privateArgumentCommitment: String(index).repeat(64), publicRedactedSummary: 'Replace approved file',
      targetPreconditions: ['version=1'], approvalId: approval.approvalId, state: 'SUCCEEDED', providerReceiptRef: null,
      createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:01Z',
      transitions: [{ from: 'DISPATCHED', to: 'SUCCEEDED', at: '2026-11-17T00:00:01Z' }], outcome: { value: { bytes: index } } };
    store.internal('toolEffect.admitted', thread.id, () => {
      store.put('approval', approval.approvalId, thread.id, approval);
      store.put('toolEffect', effect.invocationId, thread.id, effect);
      return { invocationId: effect.invocationId, state: 'DISPATCHED' };
    });
    return { effect, approval };
  });
  const privateValues = records.flatMap(({ effect, approval }) => [effect.privateArgumentCommitment, effect.definitionDigest, approval.actionCommitment]);
  const bodies = () => store.db.prepare("SELECT kind,id,body FROM entities WHERE kind IN ('toolEffect','approval') ORDER BY kind,id").all();
  const privateBodies = bodies();
  const assertPrivate = value => {
    const json = JSON.stringify(value);
    for (const key of ['privateArgumentCommitment', 'definitionDigest', 'actionCommitment']) expect(json).not.toContain(key);
    for (const value of privateValues) expect(json).not.toContain(value);
  };
  return { store, reader, thread, records, bodies, privateBodies, assertPrivate };
}

it('projects every invocation page without argument-derived commitments and keeps the retained bodies unchanged', () => {
  const x = fixture(), context = x.reader.context({ threadId: x.thread.id }), sequence = x.store.sequence;
  const first = x.reader.invocations({ threadId: x.thread.id, scopeKey: context.scopeKey, limit: 1 });
  expect(first.nextCursor).toBeTruthy();
  const second = x.reader.invocations({ threadId: x.thread.id, scopeKey: context.scopeKey, limit: 1, cursor: first.nextCursor });
  expect(second.nextCursor).toBeNull();
  expect([...first.effects, ...second.effects].map(effect => effect.invocationId)).toEqual(['invocation-1', 'invocation-2']);
  x.assertPrivate(first); x.assertPrivate(second);
  expect(x.reader.invocations({ threadId: x.thread.id, scopeKey: context.scopeKey, limit: 1, cursor: first.nextCursor })).toEqual(second);
  expect(x.store.sequence).toBe(sequence); expect(x.bodies()).toEqual(x.privateBodies);
});

it('projects captured effect and approval details while retaining useful evidence and private host authority', () => {
  const x = fixture(), context = x.reader.context({ threadId: x.thread.id }), sequence = x.store.sequence;
  for (const { effect, approval } of x.records) {
    const result = x.reader.observations({ threadId: x.thread.id, scopeKey: context.scopeKey, invocationId: effect.invocationId });
    x.assertPrivate(result);
    expect(result.effect).toMatchObject({ invocationId: effect.invocationId, state: effect.state, owner: effect.owner,
      publicRedactedSummary: effect.publicRedactedSummary, transitions: effect.transitions, outcome: effect.outcome });
    expect(result.approval).toMatchObject({ approvalId: approval.approvalId, operationId: approval.operationId,
      issuedAt: approval.issuedAt, expiresAt: approval.expiresAt, remainingUses: 0, issuer: 'authenticated_user' });
    expect(x.store.get('toolEffect', effect.invocationId)).toEqual(effect);
    expect(x.store.get('approval', approval.approvalId)).toEqual(approval);
  }
  expect(x.store.sequence).toBe(sequence); expect(x.bodies()).toEqual(x.privateBodies);
});

it('keeps future internal authentication fields out of the captured public DTOs', () => {
  const x = fixture(), { effect, approval } = x.records[0], marker = 'private-future-authenticator-fixture';
  x.store.internal('fixture.internal-authentication', x.thread.id, () => {
    x.store.put('toolEffect', effect.invocationId, x.thread.id, { ...effect, internalAuthenticator: marker });
    x.store.put('approval', approval.approvalId, x.thread.id, { ...approval, internalAuthenticator: marker });
  });
  const bodies = x.bodies(), context = x.reader.context({ threadId: x.thread.id });
  const page = x.reader.invocations({ threadId: x.thread.id, scopeKey: context.scopeKey });
  const detail = x.reader.observations({ threadId: x.thread.id, scopeKey: context.scopeKey, invocationId: effect.invocationId });
  for (const value of [page, detail]) {
    x.assertPrivate(value);
    expect(JSON.stringify(value)).not.toContain('internalAuthenticator');
    expect(JSON.stringify(value)).not.toContain(marker);
  }
  expect(x.bodies()).toEqual(bodies);
});

async function httpFixture() {
  const x = fixture();
  const runtime = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {},
    cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(x.store, runtime);
  cleanups.push(() => service.dispose());
  const app = await buildServer(service, { port: 4317, dev: false, launchToken: 'a'.repeat(64) });
  cleanups.push(() => app.close());
  const host = { host: '127.0.0.1:4317' };
  expect((await app.inject({ url: '/api/tool-effects/' + x.thread.id, headers: host })).statusCode).toBe(401);
  const bootstrap = await app.inject({ url: '/api/bootstrap', headers: { ...host, 'x-harness-launch': 'a'.repeat(64) } });
  expect(bootstrap.statusCode).toBe(200);
  const headers = { ...host, cookie: String(bootstrap.headers['set-cookie']).split(';')[0] };
  const get = async url => {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(200);
    return response.json();
  };
  return { ...x, get };
}

it('does not serialize private commitments through the authenticated ledger HTTP routes', async () => {
  const x = await httpFixture(), path = '/api/tool-effects/' + x.thread.id;
  const context = await x.get(path), query = '?scopeKey=' + context.scopeKey;
  const first = await x.get(path + '/invocations' + query + '&limit=1');
  expect(first.nextCursor).toBeTruthy();
  const second = await x.get(path + '/invocations' + query + '&limit=1&cursor=' + encodeURIComponent(first.nextCursor));
  expect([...first.effects, ...second.effects]).toHaveLength(2);
  for (const result of [context, first, second]) x.assertPrivate(result);
  for (const { effect } of x.records) {
    const detail = await x.get(path + '/observations' + query + '&invocationId=' + effect.invocationId);
    expect(detail.effect.invocationId).toBe(effect.invocationId); expect(detail.approval.remainingUses).toBe(0);
    x.assertPrivate(detail);
  }
  expect(x.bodies()).toEqual(x.privateBodies);
});

it('keeps ordinary workspace and thread snapshot responses free of ledger commitments', async () => {
  const x = await httpFixture();
  for (const path of ['/api/snapshot', '/api/threads/' + x.thread.id + '/snapshot']) {
    const result = await x.get(path);
    expect(result.threads.map(thread => thread.id)).toContain(x.thread.id);
    x.assertPrivate(result);
  }
  expect(x.bodies()).toEqual(x.privateBodies);
});
