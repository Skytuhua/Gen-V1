import {afterEach, expect, it, vi} from 'vitest';
import {link, mkdir, mkdtemp, readdir, rm, symlink} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CompanyClient} from '../packages/company-client/index.ts';
import {Store} from '../packages/storage/store.ts';
import {launchCompanyManagerHost, type CompanyManagerHostAuthority} from '../apps/server/company-manager-host.ts';
import {launchCompanyHost, readCompanyHostOptions, type CompanyReader} from '../apps/server/company-mode.ts';
import type {CompanyManagerInteraction} from '../packages/company-manager/journal.ts';
import type {HermesEngine, HermesEngineOptions} from '../packages/runtime-hermes/index.ts';
import type {RuntimeCallbacks, StartRun} from '../packages/contracts/index.ts';
import {COMPANY_MANAGER_MODEL, type CompanyManagerPermit} from '../packages/company-manager/contracts.ts';

// Injected authority/engine + disposable loopback reads only. No real account,
// model request, Maritime Store/credential or live admission is used here.
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
const input = {requestId: 'synthetic-owner-1', projectId: 'alpha', instruction: 'Draft a bounded inspection plan. Publish nothing.'};
const accountId = '00000000-0000-4000-8000-000000000001';
const proposal = {summary: 'Inspect the approved source', interpretation: 'A local draft only.', assumptions: [], blockers: [], tasks: [{id: 'inspect', title: 'Inspect', instructions: 'Read the scoped source.', dependsOn: [], proposedEmployeeId: null, sourceRefs: [], deliverable: 'research', requiredEvidence: ['Exact source observation']}]};
const deferred = () => {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};};

async function fixture(hold = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'gen-manager-host-')); cleanup.push(() => rm(dataDir, {recursive: true, force: true}));
  const seen: {authorization?: string; body: unknown}[] = [];
  const service = createServer((request, response) => {
    const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
      seen.push({authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))});
      response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({project_id: 'alpha', employee_id: 'E01', evidence_scope: 'synthetic_only', live_ready: false, assignments: []}));
    });
  });
  await new Promise<void>(accept => service.listen(0, '127.0.0.1', accept)); cleanup.push(() => new Promise<void>(accept => service.close(() => accept())));
  const address = service.address(); if (!address || typeof address === 'string') throw Error('Synthetic service unavailable');
  const employeeClient = new CompanyClient({origin: `http://127.0.0.1:${address.port}`, role: 'employee', credential: () => 'PUBLIC-synthetic-employee'});
  const ownerClient = {role: 'owner', status: vi.fn(async (scope: {id: string}) => ({project: {id: scope.id}}))} as unknown as CompanyReader;
  const bootstrap = {authorize: vi.fn(async (): Promise<CompanyManagerPermit> => ({id: 'synthetic-permit', projectId: 'alpha', employeeId: 'E01', machineId: 'synthetic-E01', machineGeneration: 1, accountId, modelId: COMPANY_MANAGER_MODEL, thinkingLevel: 'max', policyRevision: 'synthetic-policy', receiptDigest: 'a'.repeat(64), issuedAt: Date.now() - 1000, expiresAt: Date.now() + 60000, maxModelRequests: 2, maxToolCalls: 3, maxDurationMs: 30000})), assertCurrent: vi.fn(async () => {})};
  const accounts = {get: vi.fn((id: string) => id === accountId ? {id, providerId: 'openai-codex' as const, enabled: true, label: 'Synthetic isolated account', createdAt: '', updatedAt: ''} : null)};
  const authority = {employeeClient, bootstrap, accounts} satisfies CompanyManagerHostAuthority;
  let callbacks: RuntimeCallbacks, started = false;
  const disposal = deferred(), entered = deferred();
  const engines: HermesEngineOptions[] = [];
  const engineDispose = vi.fn(async () => {if (hold) await disposal.promise;});
  const createEngine = vi.fn((options: HermesEngineOptions) => {
    engines.push(options);
    return {configure(value: RuntimeCallbacks) {callbacks = value;}, models: async () => [{id: COMPANY_MANAGER_MODEL, provider: 'openai-codex', thinkingLevels: ['max']}],
      async start(value: StartRun) {started = true; entered.resolve(); if (!hold) {callbacks.onEvent({...value, type: 'assistant.message', content: JSON.stringify(proposal)}); callbacks.onEvent({...value, type: 'settled'});}},
      cancel: async () => {}, dispose: engineDispose} as unknown as HermesEngine;
  });
  return {dataDir, options: {port: 0, dataDir, client: ownerClient}, authority, ownerClient, bootstrap, seen, createEngine, engineDispose, engines, disposal, entered, isStarted: () => started};
}
async function session(host: {origin: string}) {
  const response = await fetch(host.origin + '/api/bootstrap');
  return {cookie: response.headers.get('set-cookie')!.split(';')[0], 'x-harness-csrf': (await response.json()).csrfToken, 'Content-Type': 'application/json'};
}
async function post(host: {origin: string}, headers: Record<string, string>, path: string, body: unknown) {
  return fetch(host.origin + path, {method: 'POST', headers, body: JSON.stringify(body)});
}
it('keeps the executable host unavailable without a trusted producer despite environment permit hints', async () => {
  const f = await fixture();
  const options = readCompanyHostOptions({HARNESS_COMPANY_DATA_DIR: f.dataDir, HARNESS_COMPANY_PORT: '4319', GEN_COMPANY_MANAGER_ENABLED: 'true', GEN_COMPANY_MANAGER_PERMIT: JSON.stringify({approved: true})});
  const host = await launchCompanyManagerHost({...options, port: 0, client: f.ownerClient}, undefined, {createEngine: f.createEngine}); cleanup.push(() => host.close());
  const headers = await session(host);
  expect(await fetch(host.origin + '/api/company/manager/availability', {headers}).then(value => value.json())).toMatchObject({configured: false, dispatchAuthorized: false});
  expect((await post(host, headers, '/api/company/manager/propose', input)).status).toBe(503);
  expect(f.createEngine).not.toHaveBeenCalled(); expect(f.seen).toEqual([]);
  expect(await readdir(f.dataDir)).not.toContain('manager-ui');
});
it('composes the real manager runtime, read tools and local interaction journal behind current owner scope', async () => {
  const f = await fixture();
  const host = await launchCompanyManagerHost(f.options, f.authority, {createEngine: f.createEngine}); cleanup.push(() => host.close());
  const headers = await session(host);
  expect(await fetch(host.origin + '/api/company/manager/availability', {headers}).then(value => value.json())).toMatchObject({configured: true, mode: 'shadow_proposals', dispatchAuthorized: false, durableCompanyStorage: false});
  const response = await post(host, headers, '/api/company/manager/propose', input), record = await response.json();
  expect(response.status).toBe(200); expect(record).toMatchObject({status: 'draft_ready', scope: 'local_ui_interaction', companyReceipt: null, draft: {dispatchAuthorized: false, content: proposal}});
  expect(f.ownerClient.status).toHaveBeenCalledWith({kind: 'project', id: 'alpha'});
  expect(f.seen).toEqual([{authorization: 'Bearer PUBLIC-synthetic-employee', body: {project_id: 'alpha', tool: 'read_assignment', arguments: {}}}]);
  expect(f.engines[0]).toMatchObject({dataDir: join(f.dataDir, 'manager-runtime'), home: join(f.dataDir, 'manager-home'), readOnly: true, skillPolicy: {enabled: false}, integrations: {enabled: [], ponytailMode: 'off'}});
  expect(f.engines[0].hostTools!.map(tool => tool.name)).toEqual(['status_scoped', 'read_assignment', 'read_artifact']);
  const replay = await post(host, headers, '/api/company/manager/propose', input);
  expect((await replay.json()).draft.id).toBe(record.draft.id); expect(f.createEngine).toHaveBeenCalledOnce();
  await host.close();
  const store = new Store(join(f.dataDir, 'manager-ui'));
  try {expect(store.all('companyManagerInteraction')).toHaveLength(1); for (const kind of ['task', 'thread', 'account', 'operation']) expect(store.all(kind)).toEqual([]);} finally {store.close();}
});
it('refuses owner-tool fallback and incomplete trusted producers before opening the journal', async () => {
  const f = await fixture();
  for (const authority of [{...f.authority, employeeClient: f.ownerClient}, {...f.authority, bootstrap: undefined}, {...f.authority, accounts: undefined}]) {
    await expect(launchCompanyManagerHost(f.options, authority as unknown as CompanyManagerHostAuthority, {createEngine: f.createEngine})).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
  }
  expect(f.createEngine).not.toHaveBeenCalled(); expect(f.seen).toEqual([]);
  expect(await readdir(f.dataDir)).not.toContain('manager-ui');
});
it('does not start an engine when current admission refuses the proposal', async () => {
  const f = await fixture(); f.bootstrap.authorize.mockRejectedValue(new Error('private authority detail'));
  const host = await launchCompanyManagerHost(f.options, f.authority, {createEngine: f.createEngine}); cleanup.push(() => host.close());
  const headers = await session(host), response = await post(host, headers, '/api/company/manager/propose', input);
  const record = await response.json(); expect(record).toMatchObject({status: 'failed', errorCode: 'COMPANY_MANAGER_BLOCKED'}); expect(JSON.stringify(record)).not.toContain('private authority detail');
  expect(f.createEngine).not.toHaveBeenCalled(); expect(f.seen).toEqual([]);
});
it('awaits active engine teardown and final cancelled journal settlement on host close', async () => {
  const f = await fixture(true);
  const host = await launchCompanyManagerHost(f.options, f.authority, {createEngine: f.createEngine}); cleanup.push(() => host.close());
  const headers = await session(host), pending = post(host, headers, '/api/company/manager/propose', input).then(value => value.json());
  await f.entered.promise; expect(f.isStarted()).toBe(true);
  let closed = false; const closing = host.close().then(() => {closed = true;});
  await vi.waitFor(() => expect(f.engineDispose).toHaveBeenCalledOnce()); expect(closed).toBe(false);
  f.disposal.resolve(); expect(await pending).toMatchObject({status: 'cancelled'}); await closing;
  const store = new Store(join(f.dataDir, 'manager-ui'));
  try {expect(store.get<CompanyManagerInteraction>('companyManagerInteraction', input.requestId)).toMatchObject({status: 'cancelled'});} finally {store.close();}
});
it('releases startup-owned local resources when the listening port is unavailable', async () => {
  const f = await fixture();
  const busy = createServer(); await new Promise<void>(accept => busy.listen(0, '127.0.0.1', accept)); cleanup.push(() => new Promise<void>(accept => busy.close(() => accept())));
  const address = busy.address(); if (!address || typeof address === 'string') throw Error('Synthetic port unavailable');
  await expect(launchCompanyManagerHost({...f.options, port: address.port}, f.authority, {createEngine: f.createEngine})).rejects.toThrow();
  const host = await launchCompanyHost(f.options); await host.close();
  expect(f.createEngine).not.toHaveBeenCalled();
});
it.each(['manager-ui', 'manager-runtime', 'manager-home'])('rejects a redirected %s before opening journal/runtime state', async name => {
  const f = await fixture(), foreign = await mkdtemp(join(tmpdir(), 'gen-manager-foreign-'));
  cleanup.push(() => rm(foreign, {recursive: true, force: true}));
  await symlink(foreign, join(f.dataDir, name), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(launchCompanyManagerHost(f.options, f.authority, {createEngine: f.createEngine}).then(host => {cleanup.push(() => host.close()); return host;})).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
  expect(await readdir(foreign)).toEqual([]); expect(f.createEngine).not.toHaveBeenCalled();
});
it('rejects an existing linked journal database rather than adopting another profile', async () => {
  const f = await fixture(), foreign = await mkdtemp(join(tmpdir(), 'gen-manager-foreign-db-'));
  cleanup.push(() => rm(foreign, {recursive: true, force: true}));
  const store = new Store(foreign); store.close();
  await mkdir(join(f.dataDir, 'manager-ui'));
  await link(join(foreign, 'harness.sqlite'), join(f.dataDir, 'manager-ui', 'harness.sqlite'));
  await expect(launchCompanyManagerHost(f.options, f.authority, {createEngine: f.createEngine}).then(host => {cleanup.push(() => host.close()); return host;})).rejects.toMatchObject({code: 'COMPANY_MANAGER_BLOCKED'});
  expect(f.createEngine).not.toHaveBeenCalled();
});
