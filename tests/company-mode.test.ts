import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCompanyServer, launchCompanyHost, readCompanyHostOptions, type CompanyReader} from '../apps/server/company-mode.ts';

const apps: Awaited<ReturnType<typeof buildCompanyServer>>[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  await Promise.all(folders.splice(0).map(folder => rm(folder, {recursive: true, force: true})));
});

function reader() {
  return {
    role: 'owner',
    status: vi.fn(async (scope: unknown) => ({evidence_scope: 'synthetic_only', live_ready: false, company_accepted: false, scope})),
    artifactPreview: vi.fn(async () => ({artifact_id: 'artifact-1', evidence_scope: 'synthetic_only', html: '<p>inert</p>'})),
    reviewPackage: vi.fn(async () => ({synthetic_package_ready: true, evidence_scope: 'synthetic_contract', live_ready: false, company_accepted: false})),
  } as unknown as CompanyReader;
}
async function server(client?: CompanyReader) {
  const app = await buildCompanyServer({port: 4319, client}); apps.push(app); return app;
}
async function session(app: Awaited<ReturnType<typeof buildCompanyServer>>) {
  const response = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4319'}});
  expect(response.statusCode).toBe(200);
  return {host: '127.0.0.1:4319', cookie: response.headers['set-cookie']!.toString().split(';')[0], 'x-harness-csrf': response.json().csrfToken};
}

describe('isolated company host', () => {
  it('has no personal commands, account, filesystem, snapshot, model or widget endpoints', async () => {
    const app = await server(reader()), headers = await session(app);
    for (const url of ['/api/commands', '/api/snapshot', '/api/models', '/api/resources/private/content', '/api/accounts', '/api/skills/private', '/api/events', '/widget-runtime/worker.js']) {
      const response = await app.inject({url, method: url === '/api/commands' ? 'POST' : 'GET', headers, ...(url === '/api/commands' ? {payload: {type: 'message.send', id: 'x', payload: {}}} : {})});
      expect(response.statusCode, url).toBe(404);
    }
  });

  it('authenticates the local session and checks CSRF before contacting the company service', async () => {
    const client = reader(), app = await server(client);
    const payload = {scope: {kind: 'company', id: 'leo-company'}};
    expect((await app.inject({method: 'POST', url: '/api/company/status', headers: {host: '127.0.0.1:4319'}, payload})).statusCode).toBe(401);
    const headers = await session(app);
    expect((await app.inject({method: 'POST', url: '/api/company/status', headers: {...headers, 'x-harness-csrf': 'wrong'}, payload})).statusCode).toBe(403);
    expect(client.status).not.toHaveBeenCalled();
    const response = await app.inject({method: 'POST', url: '/api/company/status', headers, payload});
    expect(response.statusCode).toBe(200);
    expect(client.status).toHaveBeenCalledExactlyOnceWith(payload.scope);
    expect(response.json()).toMatchObject({source: 'company_service', data: {live_ready: false}});
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(Number.isNaN(Date.parse(response.json().receivedAt))).toBe(false);
  });

  it('refuses unknown request keys, ambiguous scopes, URL queries and model-selected identities', async () => {
    const client = reader(), app = await server(client), headers = await session(app);
    for (const payload of [
      {scope: {kind: 'company', id: 'other'}},
      {scope: {kind: 'project', id: 'alpha'}, employee_id: 'E01'},
      {scope: {kind: 'project', id: 'alpha', permission: '*'}},
      {scope: {kind: 'project', id: ''}},
    ]) expect((await app.inject({method: 'POST', url: '/api/company/status', headers, payload})).statusCode).toBe(400);
    expect((await app.inject({method: 'POST', url: '/api/company/status?project=beta', headers, payload: {scope: {kind: 'project', id: 'alpha'}}})).statusCode).toBe(400);
    expect(client.status).not.toHaveBeenCalled();
  });

  it('does not expose mutation or publication paths even with a valid owner session', async () => {
    const app = await server(reader()), headers = await session(app);
    for (const action of ['plan', 'start', 'pause', 'cancel', 'approve', 'publish', 'employee/tool']) {
      const response = await app.inject({method: 'POST', url: `/api/company/${action}`, headers, payload: {project_id: 'alpha', message_id: 'same'}});
      expect(response.statusCode, action).toBe(404);
    }
  });

  it('reports configured state separately from service authentication and model readiness', async () => {
    const app = await server(reader()), headers = await session(app);
    const before = await app.inject({url: '/api/company/connection', headers});
    expect(before.json()).toMatchObject({configured: true, ownerAuthenticated: false, mode: 'read_only', capabilities: {dispatch: false, publication: false, events: false, emergencyStop: false}});
    await app.inject({method: 'POST', url: '/api/company/status', headers, payload: {scope: {kind: 'company', id: 'leo-company'}}});
    expect((await app.inject({url: '/api/company/connection', headers})).json().ownerAuthenticated).toBe(true);
  });

  it('shows unavailable state without starting infrastructure when no credential is configured', async () => {
    const app = await server(), headers = await session(app);
    expect((await app.inject({url: '/api/company/connection', headers})).json()).toMatchObject({configured: false, ownerAuthenticated: false, capabilities: {status: false}});
    expect((await app.inject({method: 'POST', url: '/api/company/status', headers, payload: {scope: {kind: 'company', id: 'leo-company'}}})).statusCode).toBe(503);
  });

  it('rejects other hosts/origins and never serializes upstream errors or credentials', async () => {
    const client = reader(); vi.mocked(client.status).mockRejectedValue(new Error('private-token-and-database-path'));
    const app = await server(client), headers = await session(app);
    expect((await app.inject({url: '/api/bootstrap', headers: {host: 'evil.invalid:4319'}})).statusCode).toBe(403);
    expect((await app.inject({url: '/api/bootstrap', headers: {...headers, origin: 'https://evil.invalid'}})).statusCode).toBe(403);
    const response = await app.inject({method: 'POST', url: '/api/company/status', headers, payload: {scope: {kind: 'project', id: 'alpha'}}});
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain('private-token'); expect(response.body).not.toContain('database-path');
    expect((await app.inject({url: '/api/company/connection', headers})).json().ownerAuthenticated).toBe(false);
  });

  it('uses explicit scoped inert previews and keeps stateful review evaluation disabled', async () => {
    const client = reader(), app = await server(client), headers = await session(app);
    const preview = await app.inject({method: 'POST', url: '/api/company/artifacts/preview', headers, payload: {project_id: 'alpha', artifact_id: 'artifact-1'}});
    expect(preview.statusCode).toBe(200); expect(preview.headers['content-type']).toContain('application/json');
    expect(client.artifactPreview).toHaveBeenCalledExactlyOnceWith({project_id: 'alpha', artifact_id: 'artifact-1'});
    const review = await app.inject({method: 'POST', url: '/api/company/review/package', headers, payload: {project_id: 'alpha', work_order_id: 'work-1'}});
    expect(review.statusCode).toBe(404);
    expect(client.reviewPackage).not.toHaveBeenCalled();
  });

  it('refuses employee credentials in the owner host', async () => {
    await expect(buildCompanyServer({port: 4319, client: {...reader(), role: 'employee'} as unknown as CompanyReader})).rejects.toThrow();
  });

  it('starts one separate loopback host without opening a personal or company business database', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gen-company-host-')); folders.push(folder);
    const host = await launchCompanyHost({port: 0, dataDir: folder});
    try {
      expect(host.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const response = await fetch(`${host.origin}/api/bootstrap`); expect(response.status).toBe(200);
      expect(await readdir(folder)).not.toContain('harness.sqlite');
      await expect(launchCompanyHost({port: 0, dataDir: folder})).rejects.toThrow(/already open/i);
    } finally {await host.close();}
  });
});

describe('company host configuration', () => {
  it('uses a distinct profile and never reads the personal profile or implicit paid provider', () => {
    const options = readCompanyHostOptions({LOCALAPPDATA: 'C:/local', HARNESS_DATA_DIR: 'C:/private-personal', OPENAI_API_KEY: 'not-company-authority'});
    expect(options.dataDir).not.toContain('private-personal'); expect(options.port).toBe(4319); expect(options.client).toBeUndefined();
  });
  it('requires a complete, explicit service connection and refuses malformed ports', () => {
    expect(() => readCompanyHostOptions({GEN_COMPANY_SERVICE_ORIGIN: 'http://127.0.0.1:4555'})).toThrow();
    expect(() => readCompanyHostOptions({GEN_COMPANY_SERVICE_TOKEN: 'private'})).toThrow();
    expect(() => readCompanyHostOptions({HARNESS_COMPANY_PORT: '4319junk'})).toThrow();
    const options = readCompanyHostOptions({GEN_COMPANY_SERVICE_ORIGIN: 'http://127.0.0.1:4555', GEN_COMPANY_SERVICE_TOKEN: 'private'});
    expect(JSON.stringify(options)).not.toContain('private');
  });
  it('reads an explicit host-only token file lazily for each requested call without publishing its path or contents', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gen-company-token-')); folders.push(folder);
    const path = join(folder, 'owner.token'), seen: string[] = [];
    const endpoint = createServer((request, response) => {seen.push(request.headers.authorization ?? ''); response.writeHead(401).end();});
    await new Promise<void>(accept => endpoint.listen(0, '127.0.0.1', accept));
    try {
      const address = endpoint.address(); if (!address || typeof address === 'string') throw new Error('Synthetic endpoint unavailable');
      const options = readCompanyHostOptions({GEN_COMPANY_SERVICE_ORIGIN: `http://127.0.0.1:${address.port}`, GEN_COMPANY_SERVICE_TOKEN_FILE: path});
      expect(seen).toEqual([]); // Construction does not read or contact the service.
      expect(options.instructionClient).toBeUndefined(); expect(options.workPlanClient).toBeUndefined();
      await writeFile(path, 'PUBLIC-synthetic-owner-A', 'utf8');
      expect(JSON.stringify(options)).not.toContain(path); expect(JSON.stringify(options)).not.toContain('PUBLIC-synthetic-owner-A');
      await expect(options.client!.status({kind: 'company', id: 'leo-company'})).rejects.toMatchObject({code: 'COMPANY_AUTH'});
      await writeFile(path, 'PUBLIC-synthetic-owner-B', 'utf8');
      await expect(options.client!.status({kind: 'company', id: 'leo-company'})).rejects.toMatchObject({code: 'COMPANY_AUTH'});
      expect(seen).toEqual(['Bearer PUBLIC-synthetic-owner-A', 'Bearer PUBLIC-synthetic-owner-B']);
    } finally {await new Promise<void>(accept => endpoint.close(() => accept()));}
  });
  it('refuses ambiguous, incomplete or nonabsolute token-file configuration', () => {
    const origin = {GEN_COMPANY_SERVICE_ORIGIN: 'http://127.0.0.1:4555'};
    for (const file of ['', ' ', 'relative.token']) expect(() => readCompanyHostOptions({...origin, GEN_COMPANY_SERVICE_TOKEN_FILE: file})).toThrow();
    expect(() => readCompanyHostOptions({GEN_COMPANY_SERVICE_TOKEN_FILE: join(tmpdir(), 'owner.token')})).toThrow();
    expect(() => readCompanyHostOptions({...origin, GEN_COMPANY_SERVICE_TOKEN: 'PUBLIC-test', GEN_COMPANY_SERVICE_TOKEN_FILE: join(tmpdir(), 'owner.token')})).toThrow();
  });
  it('fails closed for missing, non-file, oversized or malformed credentials without contacting the service or exposing file errors', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gen-company-token-invalid-')); folders.push(folder);
    const path = join(folder, 'owner.token'); let calls = 0;
    const endpoint = createServer((_request, response) => {calls++; response.writeHead(401).end();});
    await new Promise<void>(accept => endpoint.listen(0, '127.0.0.1', accept));
    try {
      const address = endpoint.address(); if (!address || typeof address === 'string') throw new Error('Synthetic endpoint unavailable');
      const env = {GEN_COMPANY_SERVICE_ORIGIN: `http://127.0.0.1:${address.port}`};
      const missing = readCompanyHostOptions({...env, GEN_COMPANY_SERVICE_TOKEN_FILE: path});
      await expect(missing.client!.status({kind: 'company', id: 'leo-company'})).rejects.toMatchObject({code: 'COMPANY_AUTH', message: 'Company service authentication is unavailable.'});
      for (const content of ['', 'x'.repeat(4097), 'PUBLIC-test\n', '\uFEFFPUBLIC-test', 'PUBLIC-\u00e9', 'PUBLIC-\0test']) {
        await writeFile(path, content, 'utf8');
        await expect(missing.client!.status({kind: 'company', id: 'leo-company'})).rejects.toMatchObject({code: 'COMPANY_AUTH'});
      }
      const directory = readCompanyHostOptions({...env, GEN_COMPANY_SERVICE_TOKEN_FILE: folder});
      await expect(directory.client!.status({kind: 'company', id: 'leo-company'})).rejects.toMatchObject({code: 'COMPANY_AUTH'});
      expect(calls).toBe(0);
    } finally {await new Promise<void>(accept => endpoint.close(() => accept()));}
  });
});
