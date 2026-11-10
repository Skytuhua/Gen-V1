import {afterEach, expect, it, vi} from 'vitest';
import {createServer, type Server, type IncomingMessage, type ServerResponse} from 'node:http';
import examples from '../packages/company-contracts/owner-work-plan-candidate.1/examples.json';
import {WorkPlanClient} from '../packages/company-client/work-plan.ts';
import {workPlanCanonicalBytes, type WorkPlanProposeRequest, type WorkPlanReadRequest, type WorkPlanAuthorizeRequest} from '../packages/company-contracts/work-plan.ts';
const servers: Server[] = [];
afterEach(async () => {vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {server.closeAllConnections(); server.close(() => resolve());})));});
const cases = examples.cases, first = cases[0], read = cases[1], auth = cases[2];
async function host(handler: (request: IncomingMessage, reply: ServerResponse) => void) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
  return {origin: `http://127.0.0.1:${address.port}`, server};
}
const reply = (response: ServerResponse, value: unknown, status = 200) => {const raw = Buffer.from(workPlanCanonicalBytes(value)); response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.length}); response.end(raw);};
const client = (origin: string, credential = () => 'PUBLIC-owner-work-plan-fixture', timeoutMs = 1000) => new WorkPlanClient({origin, role: 'owner', credential, timeoutMs});
it('rejects non-loopback origins, non-owner roles, token literals and unbounded timeouts', () => {
  for (const origin of ['https://127.0.0.1:9', 'http://localhost:9', 'http://127.0.0.1:9/', 'http://127.0.0.1:65536']) expect(() => client(origin)).toThrow();
  expect(() => new WorkPlanClient({origin: 'http://127.0.0.1:9', role: 'employee' as 'owner', credential: () => 'PUBLIC'})).toThrow();
  expect(() => client('http://127.0.0.1:9', () => 'PUBLIC', 10001)).toThrow();
});
it('sends only the three fixed operations with owner bearer and exact JSON framing', async () => {
  const seen: {path: string; body: unknown; auth: string|undefined; origin: string|undefined; type: string|undefined}[] = [];
  const fixture = await host((request, response) => {
    const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
      seen.push({path: request.url!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')), auth: request.headers.authorization, origin: request.headers.origin, type: request.headers['content-type']});
      const item = request.url?.endsWith('/propose') ? first : request.url?.endsWith('/read') ? read : auth; reply(response, item.response);
    });
  });
  const caller = client(fixture.origin);
  await expect(caller.propose(first.request as WorkPlanProposeRequest)).resolves.toEqual(first.response);
  await expect(caller.read(read.request as WorkPlanReadRequest)).resolves.toEqual(read.response);
  await expect(caller.authorize(auth.request as WorkPlanAuthorizeRequest)).resolves.toEqual(auth.response);
  expect(seen.map(item => item.path)).toEqual(['/v1/owner/work-plan/propose', '/v1/owner/work-plan/read', '/v1/owner/work-plan/authorize']);
  expect(seen.every(item => item.auth === 'Bearer PUBLIC-owner-work-plan-fixture' && item.origin === undefined && item.type === 'application/json')).toBe(true);
});
it('captures all nested arguments before credential await', async () => {
  let release!: (token: string) => void, got: unknown;
  const fixture = await host((request, response) => {const chunks: Buffer[] = []; request.on('data', c => chunks.push(c)); request.on('end', () => {got = JSON.parse(Buffer.concat(chunks).toString()); reply(response, first.response);});});
  const source = structuredClone(first.request) as WorkPlanProposeRequest;
  const pending = new WorkPlanClient({origin: fixture.origin, role: 'owner', credential: () => new Promise(resolve => {release = resolve;})}).propose(source);
  source.project_id = 'beta'; source.plan.summary = 'Changed'; source.plan.employee_ids.reverse();
  release('PUBLIC-owner-work-plan-fixture'); await pending;
  expect(got).toEqual(first.request);
});
it('fails invalid arguments before asking for credentials or contacting a host', async () => {
  const credential = vi.fn(() => 'PUBLIC'); const caller = new WorkPlanClient({origin: 'http://127.0.0.1:9', role: 'owner', credential});
  await expect(caller.propose({...first.request, plan: {...first.request.plan, summary: 'é'.repeat(1025)}} as WorkPlanProposeRequest)).rejects.toMatchObject({code: 'REQUEST'});
  expect(credential).not.toHaveBeenCalled();
});
it('returns only matching closed error/status pairs and performs no retry', async () => {
  let requests = 0;
  const fixture = await host((_request, response) => {requests++; reply(response, {schema_version: 1, error: {code: 'command_conflict'}}, 409);});
  await expect(client(fixture.origin).propose(first.request as WorkPlanProposeRequest)).rejects.toMatchObject({code: 'command_conflict', status: 409});
  expect(requests).toBe(1);
});
it('rejects HTML, reflected credentials, malformed JSON and mismatched error/status', async () => {
  for (const kind of ['html', 'reflection', 'malformed', 'mismatch']) {
    const fixture = await host((_request, response) => {
      if (kind === 'reflection') return reply(response, first.response);
      if (kind === 'mismatch') return reply(response, {schema_version: 1, error: {code: 'scope_denied'}}, 401);
      const raw = kind === 'html' ? '<script>private</script>' : '{';
      response.writeHead(200, {'Content-Type': kind === 'html' ? 'text/html' : 'application/json', 'Content-Length': Buffer.byteLength(raw)}); response.end(raw);
    });
    await expect(client(fixture.origin, () => kind === 'reflection' ? 'control' : 'PUBLIC').propose(first.request as WorkPlanProposeRequest)).rejects.toMatchObject({code: 'RESPONSE'});
  }
});
it('rejects compressed, chunked, oversized and foreign-scope response projections', async () => {
  for (const kind of ['compressed', 'chunked', 'oversized', 'foreign']) {
    const fixture = await host((_request, response) => {
      if (kind === 'foreign') return reply(response, {...first.response, plan: {...first.response.plan, project_id: 'beta'}});
      if (kind === 'compressed') {response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': 2, 'Content-Encoding': 'gzip'}); response.end('{}');}
      else if (kind === 'oversized') {response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': 262145}); response.end('x'.repeat(262145));}
      else {response.writeHead(200, {'Content-Type': 'application/json'}); response.write('{'); response.end('}');}
    });
    await expect(client(fixture.origin).propose(first.request as WorkPlanProposeRequest)).rejects.toMatchObject({code: 'RESPONSE'});
  }
});
it('uses one total deadline including a hanging credential provider', async () => {
  const caller = new WorkPlanClient({origin: 'http://127.0.0.1:9', role: 'owner', credential: () => new Promise(() => {}), timeoutMs: 35});
  await expect(caller.read(read.request as WorkPlanReadRequest)).rejects.toMatchObject({code: 'TIMEOUT'});
});
it('aborts before credential resolution and sends no network request afterward', async () => {
  let count = 0, release!: (token: string) => void;
  const fixture = await host((_request, response) => {count++; reply(response, first.response);});
  const abort = new AbortController();
  const pending = new WorkPlanClient({origin: fixture.origin, role: 'owner', credential: () => new Promise(resolve => {release = resolve;})}).propose(first.request as WorkPlanProposeRequest, abort.signal);
  abort.abort(); await expect(pending).rejects.toMatchObject({code: 'ABORTED'}); release('PUBLIC');
  await new Promise(resolve => setTimeout(resolve, 15)); expect(count).toBe(0);
});
it('defeats slow-drip responses with the total deadline', async () => {
  const fixture = await host((_request, response) => {response.writeHead(200, {'Content-Type': 'application/json', 'Content-Length': 100}); const timer = setInterval(() => response.write(' '), 8); response.on('close', () => clearInterval(timer));});
  await expect(client(fixture.origin, () => 'PUBLIC', 35).propose(first.request as WorkPlanProposeRequest)).rejects.toMatchObject({code: 'TIMEOUT'});
});
