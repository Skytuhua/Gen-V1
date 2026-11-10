import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CompanyClient, CompanyError, createCompanyManagerTools } from '../packages/company-client/index.ts';
import samples from '../packages/company-contracts/company-manager.v1.samples.json';
import {
  COMPANY_MANAGER_TRANSPORT, ProjectContextInputSchema, ProjectContextResponseSchema,
  TaskContextInputSchema, TaskContextResponseSchema,
  type TaskContextInput, type ProjectContextResponse, type TaskContextResponse, type ContextRef,
} from '../packages/company-contracts/manager.ts';

const projectInput = () => structuredClone(ProjectContextInputSchema.parse(samples.examples[0].request));
const taskInput = () => structuredClone(TaskContextInputSchema.parse(samples.examples[1].request));
const projectResponse = () => structuredClone(ProjectContextResponseSchema.parse(samples.examples[0].response));
const taskResponse = () => structuredClone(TaskContextResponseSchema.parse(samples.examples[1].response));
const ref = <T extends ContextRef['type']>(type: T, id: string): ContextRef<T> => ({ ...structuredClone(taskResponse().task.entity), type, id });

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(handler: (request: IncomingMessage, response: ServerResponse, body: unknown) => void) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    handler(request, response, JSON.parse(Buffer.concat(chunks).toString('utf8')));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture address missing');
  return `http://127.0.0.1:${address.port}`;
}
function json(response: ServerResponse, value: unknown, status = 200) {
  const body = JSON.stringify(value); response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }); response.end(body);
}

describe('candidate owner context client', () => {
  it.each([false, true])('validates context UTF-8 bytes without replacing invalid input (malformed=%s)', async malformed => {
    const value = projectResponse(), purpose = 'Unicode \u00e9 \ud83d\ude80 \ufffd'; value.project.purpose = purpose;
    const body = Buffer.from(JSON.stringify(value));
    if (malformed) body[body.indexOf('Unicode')] = 0xff;
    let requests = 0;
    const origin = await fixture((_request, response) => {
      requests++; response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': body.length}); response.end(body);
    });
    const result = new CompanyClient({origin, credential: () => 'context-owner', role: 'owner'}).projectContext(projectInput());
    if (malformed) await expect(result).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
    else await expect(result).resolves.toMatchObject({project: {purpose}});
    expect(requests).toBe(1);
  });
  it('provides project and task reads through the existing company client', async () => {
    const project = samples.examples[0];
    const task = samples.examples[1];
    const origin = await fixture((request, response, body) => {
      expect(request.headers.authorization).toBe('Bearer context-owner');
      expect(request.method).toBe('POST');
      const example = request.url === '/company-manager/v1/project-context' ? project : task;
      expect(request.url).toBe(example === project ? '/company-manager/v1/project-context' : '/company-manager/v1/task-context');
      expect(body).toEqual(example.request);
      json(response, example.response);
    });
    const client = new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' });
    expect(client).toHaveProperty('projectContext', expect.any(Function));
    expect(client).toHaveProperty('taskContext', expect.any(Function));
    expect(await client.projectContext(project.request)).toEqual(project.response);
    expect(await client.taskContext(task.request as TaskContextInput)).toEqual(task.response);
  });
  it('denies both reads to employees before reading the input, credential or network', async () => {
    const credential = vi.fn(() => 'employee-private');
    const client = new CompanyClient({ origin: 'http://127.0.0.1:1', credential, role: 'employee' });
    const hostile = { get project_id() { throw new Error('private getter'); } };
    await expect(client.projectContext(hostile as never)).rejects.toMatchObject({ code: 'COMPANY_FORBIDDEN' });
    await expect(client.taskContext(hostile as never)).rejects.toMatchObject({ code: 'COMPANY_FORBIDDEN' });
    expect(credential).not.toHaveBeenCalled();
    expect(createCompanyManagerTools(client).names).toEqual(['status_scoped', 'read_assignment', 'read_artifact']);
    expect(() => createCompanyManagerTools(new CompanyClient({ origin: 'http://127.0.0.1:1', credential, role: 'owner' }))).toThrowError(expect.objectContaining({ code: 'COMPANY_FORBIDDEN' }));
  });
  it('rejects malformed and extra request fields before credential lookup', async () => {
    const credential = vi.fn(() => 'owner-private');
    const client = new CompanyClient({ origin: 'http://127.0.0.1:1', credential, role: 'owner' });
    for (const request of [
      { ...projectInput(), limit: 0 }, { ...projectInput(), limit: 51 }, { ...projectInput(), limit: '20' },
      { project_id: 'alpha', limit: 20 }, { ...projectInput(), cursor: 'not/a/cursor' },
      { ...projectInput(), principal: 'owner' }, { ...projectInput(), project_id: 'company-ops' },
    ]) await expect(client.projectContext(request as never)).rejects.toMatchObject({ code: 'COMPANY_REQUEST' });
    for (const request of [{ ...taskInput(), task_id: '' }, { ...taskInput(), section: 'sql' }, { ...taskInput(), arguments: {} }]) {
      await expect(client.taskContext(request as never)).rejects.toMatchObject({ code: 'COMPANY_REQUEST' });
    }
    const error = await client.projectContext({ get project_id() { throw new Error('owner-private'); } } as never).catch(value => value);
    expect(error.code).toBe('COMPANY_REQUEST'); expect(String(error)).not.toContain('owner-private');
    expect(credential).not.toHaveBeenCalled();
  });
  it('copies request identities before asynchronous credential lookup', async () => {
    const seen: unknown[] = [];
    const origin = await fixture((_request, response, body) => { seen.push(body); json(response, projectResponse()); });
    let resolveCredential!: (token: string) => void;
    const client = new CompanyClient({ origin, credential: () => new Promise<string>(resolve => { resolveCredential = resolve; }), role: 'owner' });
    const input = projectInput(); const pending = client.projectContext(input);
    input.project_id = 'beta'; input.limit = 1; input.cursor = 'mutated';
    await Promise.resolve(); resolveCredential('context-owner');
    expect((await pending).project_id).toBe('alpha'); expect(seen).toEqual([projectInput()]);
  });
  const mismatchedProjects: [string, (value: ProjectContextResponse) => void][] = [
    ['response project', value => { value.project_id = 'beta'; }],
    ['project entity identity', value => { value.project.entity.id = 'beta'; }],
    ['project manager scope', value => { value.project.manager.scope.id = 'beta'; }],
    ['staffing scope', value => { value.project.staffing[0].employee.scope.id = 'beta'; }],
    ['task work-order scope', value => { value.tasks[0].work_order.scope.id = 'beta'; }],
    ['page scope', value => { value.page.entity.scope.id = 'beta'; }],
    ['request limit', value => { value.page.limit = 10; }],
    ['returned count', value => { value.page.returned_count = 0; }],
    ['items exceeding limit', value => { value.tasks = Array.from({ length: 21 }, () => structuredClone(value.tasks[0])); value.page.returned_count = 21; }],
  ];
  it.each(mismatchedProjects)('rejects mismatched %s', async (_name, change) => {
    const value = projectResponse(); change(value);
    const origin = await fixture((_request, response) => json(response, value));
    await expect(new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' }).projectContext(projectInput())).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' });
  });
  it('rejects unknown response fields, live flags, private paths and invalid page boundaries', async () => {
    const base = projectResponse();
    const invalid: unknown[] = [
      { ...base, raw_sql: 'private' }, { ...base, project: { ...base.project, storage_key: 'private' } },
      { ...base, project: { ...base.project, entity: { ...base.project.entity, observation: { ...base.project.entity.observation, live_verified: true } } } },
      { ...base, project: { ...base.project, repositories: [{ repository: 'org/repo', relative_paths: ['C:/private'] }] } },
      { ...base, page: { ...base.page, truncated: true, next_cursor: null } },
      { ...base, page: { ...base.page, truncated: false, next_cursor: 'unexpected' } },
      { ...base, page: { ...base.page, boundary: 'continuation' } },
      { ...base, page: { ...base.page, snapshot_status: 'live_verified' } },
    ];
    for (const value of invalid) {
      const origin = await fixture((_request, response) => json(response, value));
      await expect(new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' }).projectContext(projectInput())).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' });
    }
  });
  it('passes opaque cursors exactly and reports continuation without automatically fetching more', async () => {
    let requests = 0; const value = projectResponse();
    value.page.truncated = true; value.page.boundary = 'response_size_limit'; value.page.next_cursor = 'next_A-1';
    const input = { ...projectInput(), cursor: 'opaque_previous-1' };
    const origin = await fixture((_request, response, body) => { requests++; expect(body).toEqual(input); json(response, value); });
    const result = await new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' }).projectContext(input);
    expect(result.page).toMatchObject({ truncated: true, boundary: 'response_size_limit', next_cursor: 'next_A-1' }); expect(requests).toBe(1);
  });
  it('preserves each section type and stored review provenance', async () => {
    const origin = await fixture((_request, response, raw) => {
      const input = raw as TaskContextInput; const base = taskResponse(); let items: unknown[];
      switch (input.section) {
        case 'dependencies': items = [{ entity: ref('task', 'dependency'), expected_target_digest: { status: 'unavailable', value: null }, state: 'blocked' }]; break;
        case 'attempts': items = [{ entity: ref('attempt', 'attempt-1'), task: ref('task', input.task_id), employee: ref('employee', 'E10'), machine: ref('machine', 'machine-1'), generation: 1, state: 'recorded' }]; break;
        case 'artifacts': items = [{ ...samples.standalone_artifact_metadata.dto }]; break;
        case 'reviews': items = [{ entity: ref('review_receipt', 'review-1'), task: ref('task', input.task_id), target_digest: 'a'.repeat(64), target_status: 'stale', review_attempt: ref('attempt', 'review-attempt'), checks: [{ check_id: 'check-1', outcome: 'blocked', artifact: ref('artifact', 'check-artifact') }], acceptance: 'not_inferred' }]; break;
      }
      json(response, { ...base, section: input.section, items, page: { ...base.page, returned_count: 1 } });
    });
    const client = new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' });
    for (const section of ['dependencies', 'attempts', 'artifacts', 'reviews'] as const) {
      const result = await client.taskContext({ ...taskInput(), section });
      expect(result.section).toBe(section); expect(result.items).toHaveLength(1);
      if (result.section === 'artifacts') expect(result.items[0]).toEqual(samples.standalone_artifact_metadata.dto);
      if (result.section === 'reviews') expect(result.items[0]).toMatchObject({ target_status: 'stale', acceptance: 'not_inferred', review_attempt: { type: 'attempt' }, checks: [{ artifact: { type: 'artifact' }, outcome: 'blocked' }] });
    }
  });
  const mismatchedTasks: [string, (value: TaskContextResponse) => void][] = [
    ['task ID', value => { value.task_id = 'another-task'; }],
    ['task entity ID', value => { value.task.entity.id = 'another-task'; }],
    ['task section', value => { value.section = 'attempts'; }],
    ['work-order scope', value => { value.task.work_order.scope.id = 'beta'; }],
  ];
  it.each(mismatchedTasks)('rejects a mismatched %s in task context', async (_name, change) => {
    const value = taskResponse(); change(value);
    const origin = await fixture((_request, response) => json(response, value));
    await expect(new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' }).taskContext(taskInput())).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' });
  });
  it.each([401, 403, 409, 413, 500, 503])('sanitizes candidate HTTP %s and makes 409 an explicit first-page restart', async status => {
    let requests = 0;
    const origin = await fixture((_request, response) => { requests++; response.writeHead(status, { 'Content-Type': 'text/html' }); response.end('<html>context-owner private diagnostic</html>'); });
    const error = await new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' }).projectContext(projectInput()).catch(value => value);
    expect(error).toBeInstanceOf(CompanyError);
    expect(error.code).toBe(status === 401 ? 'COMPANY_AUTH' : status === 403 ? 'COMPANY_FORBIDDEN' : status === 409 ? 'COMPANY_SNAPSHOT_CHANGED' : 'COMPANY_HTTP');
    expect(error.restartRequired).toBe(status === 409);
    if (status === 409) expect(error.message).toContain('Restart from the first page');
    expect(String(error) + JSON.stringify(error)).not.toMatch(/context-owner|private diagnostic|html/); expect(requests).toBe(1);
  });
  it.each(['declared', 'streamed'])('enforces the candidate 256 KiB response bound for %s bytes', async framing => {
    const origin = await fixture((_request, response) => {
      const headers: Record<string, string | number> = { 'Content-Type': 'application/json' };
      if (framing === 'declared') headers['Content-Length'] = COMPANY_MANAGER_TRANSPORT.responseBytes + 1;
      response.writeHead(200, headers); response.end(Buffer.alloc(COMPANY_MANAGER_TRANSPORT.responseBytes + 1, 32));
    });
    await expect(new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' }).projectContext(projectInput())).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' });
  });
  it('uses the existing total deadline, JSON framing and decoded credential-reflection rejection', async () => {
    const delayed = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      const timer = setInterval(() => response.write(' '), 8); response.on('close', () => clearInterval(timer));
    });
    await expect(new CompanyClient({ origin: delayed, credential: () => 'context-owner', role: 'owner', timeoutMs: 50 }).projectContext(projectInput())).rejects.toMatchObject({ code: 'COMPANY_TIMEOUT' });
    for (const invalid of ['html', 'reflection', 'malformed', 'redirect']) {
      const origin = await fixture((_request, response) => {
        if (invalid === 'redirect') { response.writeHead(302, { Location: '/company-manager/v1/project-context' }); response.end(); return; }
        response.writeHead(200, { 'Content-Type': invalid === 'html' ? 'text/html' : 'application/json' });
        const value = projectResponse(); value.project.purpose = 'context-owner';
        response.end(invalid === 'malformed' ? '{' : JSON.stringify(value).replaceAll('context-owner', '\\u0063ontext-owner'));
      });
      await expect(new CompanyClient({ origin, credential: () => 'context-owner', role: 'owner' }).projectContext(projectInput())).rejects.toMatchObject({ code: invalid === 'redirect' ? 'COMPANY_HTTP' : 'COMPANY_RESPONSE' });
    }
  });
});
