import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:https';
import type {RequestListener} from 'node:http';
import type {Duplex} from 'node:stream';
import {rootCertificates} from 'node:tls';
import {inspect} from 'node:util';
import {afterEach, expect, it, vi} from 'vitest';
import {OwnerDiscussionThreadClient, OwnerDiscussionThreadError} from '../../packages/company-client/owner-discussion-thread.ts';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-thread-candidate.1/examples.json';

const full = examples.examples[1].page, limited = examples.examples[2].page, empty = examples.examples[0].page;
const ca = readFileSync(new URL('./fixtures/owner-history-test.cert.pem', import.meta.url));
const key = readFileSync(new URL('./fixtures/owner-history-test.key.pem', import.meta.url));
const TOKEN = 'PUBLIC-owner-thread-unit-fixture-only';
const context = () => ({company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}});
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
const digest = (value: object) => createHash('sha256').update(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest')))).digest('hex');
async function fixture(handler: RequestListener) {
  const sockets = new Set<Duplex>(), server = createServer({cert: ca, key}, handler);
  server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => {for (const socket of sockets) socket.destroy(); server.close(() => resolve());}));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture unavailable');
  return {origin: `https://127.0.0.1:${address.port}`, sockets};
}
function client(origin: string, overrides: Record<string, unknown> = {}) {
  return new OwnerDiscussionThreadClient({origin, role: 'owner', credential: () => TOKEN, ca, timeoutMs: 2000, ...overrides} as never);
}
function send(response: Parameters<RequestListener>[1], value: unknown, status = 200) {
  const raw = Buffer.from(canonicalBytes(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.length}); response.end(raw);
}
async function fails(value: Promise<unknown>, code: string, secrets: string[] = []) {
  const error = await value.catch(error => error);
  expect(error).toBeInstanceOf(OwnerDiscussionThreadError);
  expect((error as OwnerDiscussionThreadError).code).toBe(code); expect((error as Error).message).toBe(code);
  for (const secret of secrets) expect(inspect(error)).not.toContain(secret);
}

it('discovers the room by project using only fixed GET and independent default/explicit limits', async () => {
  const observed: {method: string; path: string; headers: Record<string, unknown>; bytes: number}[] = [];
  const fifty = structuredClone(full); fifty.requested_limit = 50; fifty.digest = digest(fifty);
  const endpoint = await fixture((request, response) => {
    let bytes = 0; request.on('data', chunk => {bytes += chunk.length;}); request.on('end', () => {
      observed.push({method: request.method!, path: request.url!, headers: request.headers, bytes});
      send(response, request.url!.endsWith('limit=1') ? limited : request.url!.endsWith('limit=50') ? fifty : full);
    });
  });
  const reader = client(endpoint.origin);
  for (const limit of [undefined, 1, 50]) {
    const page = await reader.readThread(context(), limit);
    expect(page.requested_limit).toBe(limit ?? 20); expect(page.room_head?.id).toBe(full.room_head!.id);
    expect(Object.isFrozen(page.items)).toBe(true); expect(Object.isFrozen(page.items[0].message)).toBe(true);
  }
  expect(observed.map(x => x.path)).toEqual(['/company/v1/projects/alpha/owner-discussion/thread', '/company/v1/projects/alpha/owner-discussion/thread?limit=1', '/company/v1/projects/alpha/owner-discussion/thread?limit=50']);
  for (const item of observed) {
    expect(item.method).toBe('GET'); expect(item.bytes).toBe(0); expect(item.headers.host).toBe(new URL(endpoint.origin).host); expect(item.headers.authorization).toBe(`Bearer ${TOKEN}`);
    for (const header of ['origin', 'content-type', 'content-length', 'transfer-encoding', 'content-encoding']) expect(item.headers[header]).toBeUndefined();
  }
});
it('accepts an authenticated observed empty room without fabricating IDs or complete coverage', async () => {
  const endpoint = await fixture((_request, response) => send(response, empty));
  const page = await client(endpoint.origin).readThread(context());
  expect(page.room_head).toBeNull(); expect(page.items).toEqual([]); expect(page.coverage.status).toBe('partial'); expect(page.has_more).toBeNull();
});

it.each(['http://127.0.0.1:1', 'https://localhost:1', 'https://127.0.0.2:1', 'https://127.0.0.1:0', 'https://127.0.0.1:65536', 'https://127.0.0.1:01', 'https://127.0.0.1:1/', 'https://127.0.0.1:1?q=1'])('rejects nonexact origin %s', origin => {
  expect(() => client(origin)).toThrowError('CONFIG');
});
it('rejects unsafe transport/role options and invalid request data before credentials', async () => {
  for (const extra of [{role: 'employee'}, {rejectUnauthorized: false}, {headers: {}}, {agent: {}}, {ca: 'bad'}, {timeoutMs: 0}, {timeoutMs: 10001}]) expect(() => client('https://127.0.0.1:1', extra)).toThrowError('CONFIG');
  const credential = vi.fn(() => TOKEN), reader = client('https://127.0.0.1:1', {credential});
  for (const limit of [0, 51, -1, 1.5, NaN, Infinity, null, '20']) await fails(reader.readThread(context(), limit as never), 'REQUEST');
  await fails(reader.readThread({...context(), scope: {kind: 'project', id: 'company-ops'}}), 'REQUEST');
  await fails(reader.readThread({...context(), scope: {kind: 'project', id: 'alpha%2fbeta'}}), 'REQUEST');
  expect(credential).not.toHaveBeenCalled();
});
it.each([[400, 'INVALID_REQUEST'], [401, 'AUTHENTICATION_REQUIRED'], [403, 'SCOPE_DENIED'], [404, 'NOT_FOUND'], [503, 'RECORDS_UNAVAILABLE']] as const)('returns only closed error %s/%s without retry', async (status, code) => {
  let requests = 0;
  const endpoint = await fixture((_request, response) => {requests++; send(response, {schema_version: 1, error: {code}}, status);});
  await fails(client(endpoint.origin).readThread(context()), code); expect(requests).toBe(1);
});
it('rejects mismatched/extra error fields and HTML without exposing private text', async () => {
  for (const [status, value] of [[400, {schema_version: 1, error: {code: 'NOT_FOUND'}}], [403, {schema_version: 1, error: {code: 'SCOPE_DENIED', detail: TOKEN}}], [409, {schema_version: 1, error: {code: 'IDEMPOTENCY_CONFLICT'}}], [200, {schema_version: 1, error: {code: 'NOT_FOUND'}}]] as const) {
    const endpoint = await fixture((_request, response) => send(response, value, status));
    await fails(client(endpoint.origin).readThread(context()), 'RESPONSE', [TOKEN]);
  }
  const endpoint = await fixture((_request, response) => {response.writeHead(200, {'Content-Type': 'text/html'}); response.end(`<html>${TOKEN}</html>`);});
  await fails(client(endpoint.origin).readThread(context()), 'RESPONSE', [TOKEN]);
});
it('verifies copied explicit CA trust and never follows redirects or retries', async () => {
  let count = 0, targetCount = 0;
  const target = await fixture((_request, response) => {targetCount++; send(response, full);});
  await fails(client(target.origin, {ca: rootCertificates[0]}).readThread(context()), 'TRANSPORT'); expect(targetCount).toBe(0);
  const mutable = Buffer.from(ca), reader = client(target.origin, {ca: mutable}); mutable.fill(0);
  await expect(reader.readThread(context())).resolves.toMatchObject({requested_limit: 20});
  const redirect = await fixture((_request, response) => {count++; response.writeHead(302, {Location: target.origin}); response.end();});
  await fails(client(redirect.origin).readThread(context()), 'RESPONSE'); expect(count).toBe(1); expect(targetCount).toBe(1);
  count = 0; const lost = await fixture(request => {count++; request.socket.destroy();});
  await fails(client(lost.origin).readThread(context()), 'TRANSPORT'); expect(count).toBe(1);
});
it('rejects a valid page under different independent company/project/limit expectations', async () => {
  const endpoint = await fixture((_request, response) => send(response, full));
  const reader = client(endpoint.origin);
  await fails(reader.readThread({...context(), company_id: 'other-company'}), 'RESPONSE');
  await fails(reader.readThread({...context(), scope: {kind: 'project', id: 'beta'}}), 'RESPONSE');
  await fails(reader.readThread(context(), 1), 'RESPONSE');
  const echo = await fixture((_request, response) => send(response, limited));
  await fails(client(echo.origin).readThread(context()), 'RESPONSE');
});
it('rejects response overflow, malformed codec and unsupported encoding', async () => {
  for (const mode of ['length', 'chunked', 'encoding', 'utf8', 'duplicate']) {
    const endpoint = await fixture((_request, response) => {
      const headers: Record<string, string | number> = {'Content-Type': 'application/json; charset=utf-8'};
      if (mode === 'length') headers['Content-Length'] = 262145;
      if (mode === 'encoding') headers['Content-Encoding'] = 'gzip'; response.writeHead(200, headers);
      if (mode === 'length') response.write('{'); else if (mode === 'chunked') response.end(Buffer.alloc(262145, 32));
      else if (mode === 'utf8') response.end(Buffer.from([0xc3, 0x28]));
      else if (mode === 'duplicate') response.end(Buffer.from(canonicalBytes(full)).toString().replace('"schema_version":1', '"schema_version":1,"schema_version":1'));
      else response.end(canonicalBytes(full));
    });
    await fails(client(endpoint.origin).readThread(context()), 'RESPONSE'); await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
  }
});
it('captures scope before credential work and does not reuse response echoes', async () => {
  let release!: (value: string) => void, entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => {entered = resolve;});
  const paths: string[] = [], endpoint = await fixture((request, response) => {paths.push(request.url!); send(response, full);});
  const credential = () => new Promise<string>(resolve => {release = resolve; entered();});
  const expected = context(), result = client(endpoint.origin, {credential}).readThread(expected);
  await enteredPromise; expected.company_id = 'other-company'; expected.scope.id = 'beta'; release(TOKEN);
  await expect(result).resolves.toMatchObject({company_id: 'leo-company', scope: {id: 'alpha'}});
  expect(paths).toEqual(['/company/v1/projects/alpha/owner-discussion/thread']);
});
it('times out stalled credentials and suppresses late network dispatch', async () => {
  let release!: (value: string) => void, requests = 0;
  const endpoint = await fixture((_request, response) => {requests++; send(response, full);});
  await fails(client(endpoint.origin, {credential: () => new Promise<string>(resolve => {release = resolve;}), timeoutMs: 30}).readThread(context()), 'TIMEOUT');
  release(TOKEN); await new Promise(resolve => setTimeout(resolve, 20)); expect(requests).toBe(0);
});
it('uses a total deadline despite a continuously arriving body', async () => {
  const endpoint = await fixture((_request, response) => {
    response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    const interval = setInterval(() => {if (response.destroyed) clearInterval(interval); else response.write(' ');}, 10);
    cleanup.push(() => clearInterval(interval));
  });
  await fails(client(endpoint.origin, {timeoutMs: 70}).readThread(context()), 'TIMEOUT');
  await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
});
it('aborts before credentials and while reading and releases the owned request', async () => {
  const before = new AbortController(); before.abort(); const credential = vi.fn(() => TOKEN);
  await fails(client('https://127.0.0.1:1', {credential}).readThread(context(), undefined, before.signal), 'ABORTED'); expect(credential).not.toHaveBeenCalled();
  let started!: () => void; const start = new Promise<void>(resolve => {started = resolve;});
  const endpoint = await fixture((_request, response) => {response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'}); response.write('{'); started();});
  const active = new AbortController(), pending = client(endpoint.origin).readThread(context(), undefined, active.signal);
  await start; active.abort(); await fails(pending, 'ABORTED'); await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
});
it('sanitizes credential failures and keeps tokens out of public client/errors', async () => {
  let count = 0; const endpoint = await fixture((_request, response) => {count++; send(response, full);});
  for (const token of ['', null, 17, 'private\r\nOrigin: https://private.invalid']) await fails(client(endpoint.origin, {credential: () => token}).readThread(context()), 'AUTHENTICATION_REQUIRED', ['private.invalid']);
  const reader = client(endpoint.origin, {credential: () => {throw Error(TOKEN);}});
  expect(inspect(reader)).not.toContain(TOKEN); await fails(reader.readThread(context()), 'AUTHENTICATION_REQUIRED', [TOKEN]); expect(count).toBe(0);
});
