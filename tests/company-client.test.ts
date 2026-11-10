import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { inspect } from 'node:util';
import { CompanyClient, CompanyError } from '../packages/company-client/index.ts';
import { CompanyStatusSchema, COMPANY_TRANSPORT } from '../packages/company-contracts/index.ts';

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
function status() {
  const observation = { status: 'unavailable', observed_at: null, expires_at: null, evidence_scope: 'unavailable' };
  const project = { id: 'alpha', name: 'Alpha', state: 'active', scheduler_paused: false, task_counts: {}, occupied_synthetic_slots: 0, marketing: { status: 'unavailable', additional_draft_field: ['new'] } };
  return {
    evidence_scope: 'synthetic_only', live_ready: false, company_accepted: false,
    planning_mode: 'planning_only', native_chat_planner: 'capability_missing',
    targets: { employees: 32, departments: 16, hermes: 18, codex: 14 }, actual_live: { employees: 0, hermes: 0, codex: 0 }, employees: [{
      id: 'E01', department: 'D01', state: 'planned_unverified', target_runtime: 'hermes', effective_runtime: null,
      required_model: 'gpt-6.1-sol', required_reasoning: 'max', effective_model: null, effective_reasoning: null,
      required_route: { provider: 'openai-codex', billing_route: 'subscription', fallbacks: [] }, effective_route: null,
      required_mode: 'native', effective_mode: null, effective_config_digest: null, configured_profile_version: 1,
      configured_profile_digest: 'c'.repeat(64), synthetic_admission: { present: false, expired: false, evidence_scope: 'unavailable' },
      playbooks: { configured: [], active: false, state: 'inactive_pending_evaluation' },
    }],
    runtime_requirements: { source: 'trusted_host_configuration', hermes: { mode: null, repository: null, commit: null, compatibility_evidence: null, image_digest: null }, codex: { mode: null, package: null, version: null, external_auth_candidate_status: null, image_digest: null } },
    configured_requirements_digest: 'a'.repeat(64), configured_company_digest: 'b'.repeat(64),
    native_limits: { task_timeout_seconds: 600, hermes_iteration_cap: 50, codex_turn_cap: null, max_child_processes_per_attempt: 8, effective_limits: null },
    auth: observation, budget: observation, projects: [project], project, blockers: ['native_dispatch_unavailable'],
  };
}
describe('Node-only company client', () => {
  it.each(['https://127.0.0.1:1234', 'http://localhost:1234', 'http://127.1:1234', 'http://127.0.0.1:1234/', 'http://127.0.0.1:1234?x', 'http://127.0.0.1:1234#x', 'http://user@127.0.0.1:1234', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:1234/path'])('rejects non-exact loopback origin %s', origin => {
    expect(() => new CompanyClient({ origin, credential: () => 'fixture', role: 'owner' })).toThrowError(expect.objectContaining({ code: 'COMPANY_CONFIG' }));
  });
  it('sends explicit framing, exact scope and only its server-held credential', async () => {
    const seen: unknown[] = [];
    const origin = await fixture((request, response, body) => {
      seen.push(body); expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/status');
      expect(request.headers.authorization).toBe('Bearer fixture-owner'); expect(request.headers.origin).toBeUndefined();
      expect(request.headers['transfer-encoding']).toBeUndefined(); expect(request.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify(body))));
      json(response, status());
    });
    const client = new CompanyClient({ origin, credential: () => 'fixture-owner', role: 'owner' });
    const result = await client.status({ kind: 'project', id: 'alpha' });
    expect(result).toMatchObject({ live_ready: false, actual_live: { employees: 0 }, targets: { hermes: 18, codex: 14 } });
    expect(seen).toEqual([{ scope: { kind: 'project', id: 'alpha' } }]);
    expect(CompanyStatusSchema.parse(result).projects[0].marketing).toEqual({ status: 'unavailable', additional_draft_field: ['new'] });
    expect(JSON.stringify(client) + inspect(client)).not.toContain('fixture-owner');
  });
  it('denies cross-role operations before fetching credentials or opening a connection', async () => {
    const credential = vi.fn(() => 'fixture'); const client = new CompanyClient({ origin: 'http://127.0.0.1:1', credential, role: 'employee' });
    await expect(client.plan({ project_id: 'alpha', instruction: 'fix', message_id: '1' })).rejects.toMatchObject({ code: 'COMPANY_FORBIDDEN' });
    await expect(client.status({ kind: 'company', id: 'leo-company' })).rejects.toMatchObject({ code: 'COMPANY_FORBIDDEN' });
    const owner = new CompanyClient({ origin: 'http://127.0.0.1:1', credential, role: 'owner' });
    await expect(owner.employeeTool({ project_id: 'alpha', tool: 'status_scoped', arguments: {} })).rejects.toMatchObject({ code: 'COMPANY_FORBIDDEN' });
    expect(credential).not.toHaveBeenCalled();
  });
  it('rejects extra fields and oversized UTF-8 requests before credential lookup', async () => {
    const credential = vi.fn(() => 'fixture'); const client = new CompanyClient({ origin: 'http://127.0.0.1:1', credential, role: 'owner' });
    await expect(client.pause({ project_id: 'alpha', message_id: '1', principal: 'owner' } as never)).rejects.toMatchObject({ code: 'COMPANY_REQUEST' });
    await expect(client.plan({ project_id: 'alpha', message_id: '1', instruction: '漢'.repeat(16000) })).rejects.toMatchObject({ code: 'COMPANY_REQUEST' });
    expect(credential).not.toHaveBeenCalled();
  });
  it('returns capability_missing from start without inventing dispatch or retrying', async () => {
    let requests = 0; const origin = await fixture((request, response, body) => {
      requests++; expect(request.url).toBe('/v1/owner/start'); expect(body).toEqual({ project_id: 'alpha', message_id: '1', proposal_id: 'p1' });
      json(response, { status: 'capability_missing', live_ready: false, proposal_id: 'p1', dispatch_authorized: false, blockers: ['native_dispatch_unavailable'] });
    });
    const client = new CompanyClient({ origin, credential: () => 'fixture', role: 'owner' });
    expect(await client.start({ project_id: 'alpha', message_id: '1', proposal_id: 'p1' })).toMatchObject({ status: 'capability_missing', dispatch_authorized: false }); expect(requests).toBe(1);
  });
  it('preserves source-native profile versions and current target/effective distinctions', () => {
    const result = CompanyStatusSchema.parse(status());
    expect(result.employees[0]).toMatchObject({ configured_profile_version: 1, target_runtime: 'hermes', effective_runtime: null, effective_route: null });
  });
  it('supports the remaining exact owner routes without adding generic operations', async () => {
    const seen: string[] = [];
    const origin = await fixture((request, response, body) => {
      seen.push(request.url!);
      switch (request.url) {
        case '/v1/owner/plan': json(response, { id: 'p1', ...(body as object), kind: 'planning_proposal', state: 'planning_only', planner: 'capability_missing', model_produced: false, dispatch_authorized: false, live_ready: false, evidence_scope: 'local_owner_instruction', blockers: ['native_dispatch_unavailable'] }); break;
        case '/v1/owner/pause': json(response, { status: 'paused', project_id: 'alpha', occupancy_released: false }); break;
        case '/v1/owner/cancel': json(response, { status: 'cancelling', project_id: 'alpha', occupied_synthetic_slots: 1, occupancy_released: false, blockers: ['termination_or_quarantine_proof_required'], evidence_scope: 'synthetic_only' }); break;
        case '/v1/artifacts/preview': json(response, { artifact_id: 'a1', html: '<pre>inert source</pre>', evidence_scope: 'synthetic_only' }); break;
        case '/v1/review/package': json(response, { synthetic_package_ready: true, evidence_scope: 'synthetic_contract', live_ready: false, company_accepted: false }); break;
        default: json(response, { error: 'unexpected' }, 404);
      }
    });
    const client = new CompanyClient({ origin, credential: () => 'fixture-owner', role: 'owner' });
    expect(await client.plan({ project_id: 'alpha', instruction: 'Plan only', message_id: '1' })).toMatchObject({ model_produced: false, dispatch_authorized: false });
    expect(await client.pause({ project_id: 'alpha', message_id: '2' })).toMatchObject({ status: 'paused', occupancy_released: false });
    expect(await client.cancel({ project_id: 'alpha', message_id: '3' })).toMatchObject({ status: 'cancelling', occupied_synthetic_slots: 1, occupancy_released: false });
    expect(await client.artifactPreview({ project_id: 'alpha', artifact_id: 'a1' })).toMatchObject({ artifact_id: 'a1' });
    expect(await client.reviewPackage({ project_id: 'alpha', work_order_id: 'w1' })).toMatchObject({ live_ready: false, company_accepted: false });
    expect(seen).toEqual(['/v1/owner/plan', '/v1/owner/pause', '/v1/owner/cancel', '/v1/artifacts/preview', '/v1/review/package']);
  });
  it('uses only employee authentication for scoped status and employee reads', async () => {
    const origin = await fixture((request, response, body) => {
      expect(request.headers.authorization).toBe('Bearer fixture-employee');
      if (request.url === '/v1/status') expect(body).toEqual({ scope: { kind: 'project', id: 'alpha' } });
      else expect(body).toEqual({ project_id: 'alpha', tool: 'read_assignment', arguments: {} });
      json(response, { project_id: 'alpha', employee_id: 'E01', evidence_scope: 'synthetic_only', live_ready: false, assignments: [] });
    });
    const client = new CompanyClient({ origin, credential: () => 'fixture-employee', role: 'employee' });
    expect(await client.status({ kind: 'project', id: 'alpha' })).toMatchObject({ project_id: 'alpha' });
    expect(await client.employeeTool({ project_id: 'alpha', tool: 'read_assignment', arguments: {} })).toMatchObject({ employee_id: 'E01' });
  });
  it.each([401, 403, 409, 500])('sanitizes an HTTP %s body instead of echoing tokens or server errors', async code => {
    const origin = await fixture((_request, response) => json(response, { error: 'secret-server-body fixture-private' }, code));
    const client = new CompanyClient({ origin, credential: () => 'fixture-private', role: 'owner' });
    const error = await client.status({ kind: 'project', id: 'alpha' }).catch(value => value);
    expect(error).toBeInstanceOf(Error); expect(error.code).toBe(code === 401 ? 'COMPANY_AUTH' : code === 403 ? 'COMPANY_FORBIDDEN' : 'COMPANY_HTTP'); expect(String(error) + JSON.stringify(error)).not.toMatch(/secret-server-body|fixture-private/);
  });
  it('does not follow redirects or accept an incomplete or live-promoting status', async () => {
    let requests = 0; const origin = await fixture((_request, response) => { requests++; response.writeHead(302, { Location: 'http://localhost:1' }); response.end(); });
    const client = new CompanyClient({ origin, credential: () => 'fixture', role: 'owner' });
    await expect(client.status({ kind: 'project', id: 'alpha' })).rejects.toMatchObject({ code: 'COMPANY_HTTP' }); expect(requests).toBe(1);
    const invalidOrigin = await fixture((_request, response) => json(response, { ...status(), live_ready: true }));
    await expect(new CompanyClient({ origin: invalidOrigin, credential: () => 'fixture', role: 'owner' }).status({ kind: 'project', id: 'alpha' })).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' });
  });
  it('enforces a total deadline even when response bytes keep arriving', async () => {
    const origin = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' }); const timer = setInterval(() => response.write(' '), 8); response.on('close', () => clearInterval(timer));
    });
    const client = new CompanyClient({ origin, credential: () => 'fixture', role: 'owner', timeoutMs: 50 });
    await expect(client.status({ kind: 'project', id: 'alpha' })).rejects.toMatchObject({ code: 'COMPANY_TIMEOUT' });
  });
  it('bounds credential lookup and sanitizes rejected or invalid credentials', async () => {
    for (const credential of [() => Promise.reject(new Error('private-token')), () => 'bad\r\nprivate-token']) {
      const client = new CompanyClient({ origin: 'http://127.0.0.1:1', credential, role: 'owner' });
      const error = await client.status({ kind: 'project', id: 'alpha' }).catch(value => value);
      expect(error.code).toBe('COMPANY_AUTH'); expect(String(error)).not.toContain('private-token');
    }
    const client = new CompanyClient({ origin: 'http://127.0.0.1:1', credential: () => new Promise<string>(() => {}), role: 'owner', timeoutMs: 30 });
    await expect(client.status({ kind: 'project', id: 'alpha' })).rejects.toMatchObject({ code: 'COMPANY_TIMEOUT' });
  });
  it('bounds responses before buffering their declared body and never automatically retries', async () => {
    let requests = 0; const origin = await fixture((_request, response) => { requests++; response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': COMPANY_TRANSPORT.responseBytes + 1 }); response.end('{}'); });
    await expect(new CompanyClient({ origin, credential: () => 'fixture', role: 'owner' }).status({ kind: 'project', id: 'alpha' })).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' }); expect(requests).toBe(1);
  });
  it('rejects raw non-JSON HTTP parser errors without exposing or rendering their body', async () => {
    const origin = await fixture((_request, response) => { response.writeHead(400, { 'Content-Type': 'text/html' }); response.end('<html>private parser diagnostic</html>'); });
    const error = await new CompanyClient({ origin, credential: () => 'fixture-owner', role: 'owner' }).status({ kind: 'project', id: 'alpha' }).catch(value => value);
    expect(error).toBeInstanceOf(CompanyError); expect(error.code).toBe('COMPANY_HTTP');
    expect(String(error) + JSON.stringify(error)).not.toContain('private parser diagnostic');
  });
  it('rejects an oversized streamed reply with an explicit bounded-response error', async () => {
    const origin = await fixture((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(Buffer.alloc(COMPANY_TRANSPORT.responseBytes + 1, 32));
    });
    const error = await new CompanyClient({ origin, credential: () => 'fixture-owner', role: 'owner' }).status({ kind: 'project', id: 'alpha' }).catch(value => value);
    expect(error).toBeInstanceOf(CompanyError); expect(error.code).toBe('COMPANY_RESPONSE');
  });
  it('rejects mismatched artifact and project identities in otherwise valid replies', async () => {
    const origin = await fixture((request, response) => {
      if (request.url === '/v1/artifacts/preview') json(response, { artifact_id: 'wrong', html: '<pre>source</pre>', evidence_scope: 'synthetic_only' });
      else json(response, { ...status(), project: { ...status().project, id: 'beta' } });
    });
    const client = new CompanyClient({ origin, credential: () => 'fixture-owner', role: 'owner' });
    await expect(client.artifactPreview({ project_id: 'alpha', artifact_id: 'a1' })).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' });
    await expect(client.status({ kind: 'project', id: 'alpha' })).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' });
  });
  it('rejects malformed JSON and successful responses that reflect the bearer', async () => {
    const origins = [
      await fixture((_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{'); }),
      await fixture((_request, response) => json(response, { artifact_id: 'a1', html: '<pre>fixture-private</pre>', evidence_scope: 'synthetic_only' })),
    ];
    for (const origin of origins) await expect(new CompanyClient({ origin, credential: () => 'fixture-private', role: 'owner' }).artifactPreview({ project_id: 'alpha', artifact_id: 'a1' })).rejects.toMatchObject({ code: 'COMPANY_RESPONSE' });
  });
  it.each([false, true])('validates status UTF-8 bytes without replacing invalid input (malformed=%s)', async malformed => {
    const value = status(), name = 'Unicode \u00e9 \ud83d\ude80 \ufffd'; value.project.name = name;
    const body = Buffer.from(JSON.stringify(value));
    if (malformed) body[body.indexOf('Unicode')] = 0xff;
    let requests = 0;
    const origin = await fixture((_request, response) => {
      requests++; response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': body.length}); response.end(body);
    });
    const result = new CompanyClient({origin, credential: () => 'fixture-owner', role: 'owner'}).status({kind: 'project', id: 'alpha'});
    if (malformed) await expect(result).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
    else await expect(result).resolves.toMatchObject({project: {name}});
    expect(requests).toBe(1);
  });
  it('checks decoded response strings and keys before returning any credential-bearing data', async () => {
    for (const token of ['fixture-private', 'fixture"private', 'fixture\\private']) {
      const origin = await fixture((_request, response) => {
        const body = JSON.stringify({artifact_id: 'a1', html: `<pre>${token}</pre>`, evidence_scope: 'synthetic_only'}).replaceAll('fixture', '\\u0066ixture');
        response.writeHead(200, {'Content-Type': 'application/json'}); response.end(body);
      });
      await expect(new CompanyClient({origin, credential: () => token, role: 'owner'}).artifactPreview({project_id: 'alpha', artifact_id: 'a1'})).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
    }
    const origin = await fixture((_request, response) => {
      const data = status(); data.projects[0].marketing = {status: 'available', additional_draft_field: ['new'], ['fixture-private']: []} as typeof data.projects[0]['marketing'];
      response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify(data).replaceAll('fixture-private', '\\u0066ixture-private'));
    });
    await expect(new CompanyClient({origin, credential: () => 'fixture-private', role: 'owner'}).status({kind: 'company', id: 'leo-company'})).rejects.toMatchObject({code: 'COMPANY_RESPONSE'});
  });
  it.each([0, 10001, Infinity, NaN])('rejects an invalid or excessive timeout %s', timeoutMs => {
    expect(() => new CompanyClient({ origin: 'http://127.0.0.1:1', credential: () => 'fixture', role: 'owner', timeoutMs })).toThrowError(expect.objectContaining({ code: 'COMPANY_CONFIG' }));
  });
});
