import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Socket} from 'node:net';
import type {Duplex} from 'node:stream';
import {rootCertificates} from 'node:tls';
import {inspect} from 'node:util';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {OwnerHistoryClient, OwnerHistoryError} from '../../packages/company-client/owner-history.ts';
import {canonicalBytes} from '../../packages/company-contracts/communications/index.ts';
import {validateOwnerNoteHistory} from '../../packages/company-contracts/communications/history.ts';
import golden from '../../packages/company-contracts/communications/owner-note-history-candidate.1/golden.json';

const certificate = readFileSync(new URL('./fixtures/owner-history-test.cert.pem', import.meta.url));
const privateKey = readFileSync(new URL('./fixtures/owner-history-test.key.pem', import.meta.url));
const TOKEN = 'public-fixture-owner-token';
const ROOM = '11111111-1111-4111-8111-111111111111';
const context = () => ({company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}});
const full = golden.examples.two_historical_pairs;
const limited = golden.examples.item_limited;
const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const sockets = new Set<Duplex>();
  const server = createServer({cert: certificate, key: privateKey, minVersion: 'TLSv1.2'}, handler);
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('tlsClientError', () => {});
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
  }));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address missing');
  return {origin: `https://127.0.0.1:${address.port}`, sockets};
}

function send(response: ServerResponse, raw: Uint8Array, status = 200, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, {'Content-Type': contentType, 'Content-Length': raw.byteLength});
  response.end(raw);
}
const sendHistory = (response: ServerResponse, value: unknown = full) => send(response, canonicalBytes(value));
const client = (origin: string, overrides: Record<string, unknown> = {}) => new OwnerHistoryClient({
  origin, role: 'owner', credential: () => TOKEN, ca: certificate, ...overrides,
} as never);
const configFails = (value: unknown) => expect(() => new OwnerHistoryClient(value as never))
  .toThrowError(expect.objectContaining({code: 'CONFIG'}));
const baseConfig = () => ({origin: 'https://127.0.0.1:1234', role: 'owner', credential: () => TOKEN, ca: certificate});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function digest(value: Record<string, unknown>) {
  return createHash('sha256').update(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest')))).digest('hex');
}

async function fails(result: Promise<unknown>, code: string, privateValues: string[] = []) {
  let failure: unknown;
  try {await result;} catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(OwnerHistoryError);
  expect(failure).toMatchObject({code, name: 'OwnerHistoryError', message: code});
  expect((failure as Error).cause).toBeUndefined();
  const visible = String(failure) + JSON.stringify(failure) + inspect(failure);
  for (const value of privateValues) expect(visible).not.toContain(value);
}

describe('server-only verified owner history client', () => {
  it('pins deliberately public test TLS bytes copied from the control fixture', () => {
    const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
    expect(hash(certificate)).toBe('e90aac4fc38cfc57051c4c3ebdcdde8b12b1fa23bc0af13669c15b552252ce99');
    expect(hash(privateKey)).toBe('9cfb337da6d23f82182485ce8b19acdac769b2883e949a0f6c70fc8fe0d499d4');
  });

  it('rejects every non-exact HTTPS loopback origin', () => {
    for (const origin of [
      'http://127.0.0.1:1234', 'https://localhost:1234', 'https://127.1:1234',
      'https://[::1]:1234', 'https://127.0.0.1', 'https://127.0.0.1:0',
      'https://127.0.0.1:65536', 'https://127.0.0.1:01234', 'https://127.0.0.1:1234/',
      'https://user:secret@127.0.0.1:1234', 'https://127.0.0.1:1234/path',
      'https://127.0.0.1:1234?x=1', 'https://127.0.0.1:1234#x',
    ]) configFails({...baseConfig(), origin});
  });

  it('requires owner role, credential callback, isolated CA, and a bounded integer deadline', () => {
    for (const field of ['origin', 'role', 'credential', 'ca']) {
      const value: Record<string, unknown> = baseConfig(); delete value[field]; configFails(value);
    }
    for (const role of ['employee', 'coordinator', '', null]) configFails({...baseConfig(), role});
    for (const credential of [TOKEN, null, 1]) configFails({...baseConfig(), credential});
    for (const ca of ['', Buffer.alloc(0), null, []]) configFails({...baseConfig(), ca});
    for (const timeoutMs of [0, -1, 10001, 1.5, NaN, Infinity, '3000']) configFails({...baseConfig(), timeoutMs});
    for (const timeoutMs of [1, 10000]) expect(() => client(baseConfig().origin, {timeoutMs})).not.toThrow();
    expect(() => client(baseConfig().origin, {ca: certificate.toString('ascii')})).not.toThrow();
  });

  it('rejects unknown transport, TLS, URL and header overrides rather than forwarding them', () => {
    for (const extra of [
      {rejectUnauthorized: false}, {checkServerIdentity: () => undefined}, {agent: false},
      {headers: {Authorization: 'Bearer private-override'}}, {fetch: () => {}},
      {servername: 'localhost'}, {lookup: () => {}}, {path: '/v1/status'},
      {method: 'POST'}, {body: '{}'}, {protocol: 'http:'}, {redirect: 'follow'},
    ]) configFails({...baseConfig(), ...extra});
  });

  it.each([
    {limit: undefined, value: full, query: 'project_id=alpha'},
    {limit: 1, value: limited, query: 'project_id=alpha&limit=1'},
  ])('returns the exact immutable projection for limit $limit and sends only the bounded GET', async ({limit, value, query}) => {
    const seen: {method: string | undefined; url: string | undefined; headers: IncomingMessage['headers']; body: Buffer}[] = [];
    const endpoint = await fixture((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        seen.push({method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks)});
        sendHistory(response, value);
      });
    });
    const result = await client(endpoint.origin).readHistory(context(), ROOM, limit);
    expect(canonicalBytes(result)).toEqual(canonicalBytes(value));
    expect(result.requested_limit).toBe(limit ?? 20);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0].message)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('GET');
    expect(seen[0].url).toBe(`/company/v1/conversations/${ROOM}/messages?${query}`);
    expect(seen[0].headers.host).toBe(new URL(endpoint.origin).host);
    expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0].headers.origin).toBeUndefined();
    expect(seen[0].headers['content-type']).toBeUndefined();
    expect(seen[0].headers['transfer-encoding']).toBeUndefined();
    expect([undefined, '0']).toContain(seen[0].headers['content-length']);
    expect(seen[0].headers.connection).toBe('close');
    expect(seen[0].body.byteLength).toBe(0);
  });

  it('resolves a fresh credential and opens an unpooled connection for each read', async () => {
    const headers: string[] = [], sockets = new Set<Socket>();
    const endpoint = await fixture((request, response) => {
      headers.push(request.headers.authorization!); sockets.add(request.socket); sendHistory(response);
    });
    const credential = vi.fn().mockReturnValueOnce('first-public-token').mockResolvedValueOnce('second-public-token');
    const reader = client(endpoint.origin, {credential});
    await reader.readHistory(context(), ROOM); await reader.readHistory(context(), ROOM);
    expect(credential).toHaveBeenCalledTimes(2);
    expect(headers).toEqual(['Bearer first-public-token', 'Bearer second-public-token']);
    expect(sockets.size).toBe(2);
  });

  it('rejects malformed context and company-ops before credentials or a request', async () => {
    let requests = 0;
    const endpoint = await fixture((_request, response) => {requests++; sendHistory(response);});
    const credential = vi.fn(() => TOKEN), reader = client(endpoint.origin, {credential});
    for (const expected of [
      null, {}, {...context(), company_id: 'Private Company'}, {...context(), actor: 'owner'},
      {...context(), scope: {kind: 'company_ops', id: 'company-ops'}},
      {...context(), scope: {kind: 'project', id: 'company-ops'}},
      {...context(), scope: {kind: 'project', id: 'alpha', principal: 'private-principal'}},
    ]) await fails(reader.readHistory(expected as never, ROOM), 'REQUEST');
    expect(credential).not.toHaveBeenCalled(); expect(requests).toBe(0);
  });

  it('rejects noncanonical room IDs before credentials or a request', async () => {
    const credential = vi.fn(() => TOKEN), reader = client('https://127.0.0.1:1', {credential});
    for (const room of ['', 'private-room', ROOM.replaceAll('-', ''), ROOM + '/messages',
      'AAAAAAAA-1111-4111-8111-111111111111', `${ROOM}?project_id=beta`, null]) {
      await fails(reader.readHistory(context(), room as never), 'REQUEST');
    }
    expect(credential).not.toHaveBeenCalled();
  });

  it('rejects invalid limits before credentials or a request', async () => {
    const credential = vi.fn(() => TOKEN), reader = client('https://127.0.0.1:1', {credential});
    for (const limit of [0, 51, -1, 1.5, NaN, Infinity, null, '20']) {
      await fails(reader.readHistory(context(), ROOM, limit as never), 'REQUEST');
    }
    expect(credential).not.toHaveBeenCalled();
  });

  it('verifies the explicit CA and never accepts this fixture through unrelated system roots', async () => {
    let requests = 0;
    const endpoint = await fixture((_request, response) => {requests++; sendHistory(response);});
    await fails(client(endpoint.origin, {ca: rootCertificates[0]}).readHistory(context(), ROOM), 'TRANSPORT', [TOKEN]);
    expect(requests).toBe(0);
  });

  it.each([
    [400, 'INVALID_REQUEST'], [401, 'AUTHENTICATION_REQUIRED'], [403, 'SCOPE_DENIED'],
    [404, 'NOT_FOUND'], [503, 'RECORDS_UNAVAILABLE'],
  ] as const)('accepts only the exact closed error pair %s/%s', async (status, code) => {
    let requests = 0;
    const endpoint = await fixture((_request, response) => {
      requests++; send(response, canonicalBytes({schema_version: 1, error: {code}}), status);
    });
    await fails(client(endpoint.origin).readHistory(context(), ROOM), code, [TOKEN]);
    expect(requests).toBe(1);
  });

  it('rejects mismatched status/code pairs and a success status carrying an error', async () => {
    for (const [status, code] of [[400, 'NOT_FOUND'], [401, 'SCOPE_DENIED'], [403, 'AUTHENTICATION_REQUIRED'], [200, 'NOT_FOUND'], [500, 'RECORDS_UNAVAILABLE']]) {
      const endpoint = await fixture((_request, response) => send(response, canonicalBytes({schema_version: 1, error: {code}}), status as number));
      await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE');
    }
  });

  it('rejects additional, reflected, nested and unknown error fields without exposing them', async () => {
    const canary = 'private-backend-reflection-canary';
    for (const value of [
      {schema_version: 1, error: {code: 'NOT_FOUND'}, detail: canary},
      {schema_version: 1, error: {code: 'NOT_FOUND', detail: canary}},
      {schema_version: 1, error: {code: canary}}, {error: {code: 'NOT_FOUND'}},
      {schema_version: 2, error: {code: 'NOT_FOUND'}},
    ]) {
      const endpoint = await fixture((_request, response) => send(response, canonicalBytes(value), 404));
      await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE', [TOKEN, canary]);
    }
  });

  it('rejects HTML, missing JSON media type and unsupported encodings without reflection', async () => {
    const canary = 'private-html-reflection-canary';
    for (const variant of ['html', 'missing-type', 'encoding']) {
      const endpoint = await fixture((_request, response) => {
        const raw = variant === 'html' ? Buffer.from(`<html>${canary}</html>`) : canonicalBytes(full);
        const headers: Record<string, string | number> = {'Content-Length': raw.byteLength};
        if (variant !== 'missing-type') headers['Content-Type'] = variant === 'html' ? 'text/html' : 'application/json';
        if (variant === 'encoding') headers['Content-Encoding'] = 'gzip';
        response.writeHead(200, headers); response.end(raw);
      });
      await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE', [TOKEN, canary]);
    }
  });

  it('does not follow a redirect or send its bearer to the redirect target', async () => {
    let targetRequests = 0, requests = 0;
    const target = await fixture((_request, response) => {targetRequests++; sendHistory(response);});
    const endpoint = await fixture((_request, response) => {
      requests++; response.writeHead(302, {Location: `${target.origin}/private-redirect-canary`, 'Content-Length': 0}); response.end();
    });
    await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE', [TOKEN, 'private-redirect-canary']);
    expect(requests).toBe(1); expect(targetRequests).toBe(0);
  });

  it('caps raw response bytes even when the body is chunked', async () => {
    const endpoint = await fixture((_request, response) => {
      response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      response.write(Buffer.alloc(131072, 32)); response.end(Buffer.alloc(131073, 32));
    });
    await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE');
    await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
  });

  it('rejects an oversized advertised response before accepting any body', async () => {
    const endpoint = await fixture((_request, response) => {
      response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': 262145});
      response.write('{');
    });
    await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE');
    await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
  });

  it('rejects a correctly hashed null-head history instead of fabricating the requested room', async () => {
    const value = structuredClone(golden.examples.empty_observed);
    value.scope.id = 'alpha'; value.digest = digest(value);
    await expect(validateOwnerNoteHistory(canonicalBytes(value), context(), 20)).resolves.toMatchObject({room_head: null});
    const endpoint = await fixture((_request, response) => sendHistory(response, value));
    await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE');
  });

  it('rejects an escaped bearer reflection even in otherwise valid immutable history', async () => {
    const value = structuredClone(full);
    value.items[0].message.body = TOKEN;
    value.items[0].message.digest = digest(value.items[0].message);
    value.digest = digest(value);
    const raw = Buffer.from(Buffer.from(canonicalBytes(value)).toString('utf8').replaceAll(TOKEN, [...TOKEN].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('')));
    expect(raw.includes(Buffer.from(TOKEN))).toBe(false);
    await expect(validateOwnerNoteHistory(raw, context(), 20)).resolves.toMatchObject({requested_limit: 20});
    const endpoint = await fixture((_request, response) => send(response, raw));
    await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE', [TOKEN]);
  });

  it('rejects strict UTF-8 and duplicate JSON keys before accepting a projection', async () => {
    const raw = Buffer.from(canonicalBytes(full));
    for (const body of [
      Buffer.from([0xc3, 0x28]),
      Buffer.from(raw.toString('utf8').replace('"schema_version":1', '"schema_version":1,"schema_version":1')),
    ]) {
      const endpoint = await fixture((_request, response) => send(response, body));
      await fails(client(endpoint.origin).readHistory(context(), ROOM), 'RESPONSE');
    }
  });

  it('binds valid history to the independently retained company, project, room and resolved limit', async () => {
    const endpoint = await fixture((_request, response) => sendHistory(response));
    const reader = client(endpoint.origin);
    await fails(reader.readHistory({...context(), company_id: 'other-company'}, ROOM), 'RESPONSE');
    await fails(reader.readHistory({...context(), scope: {kind: 'project', id: 'beta'}}, ROOM), 'RESPONSE');
    await fails(reader.readHistory(context(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'RESPONSE');
    await fails(reader.readHistory(context(), ROOM, 1), 'RESPONSE');
    const wrongDefault = await fixture((_request, response) => sendHistory(response, limited));
    await fails(client(wrongDefault.origin).readHistory(context(), ROOM), 'RESPONSE');
  });

  it('snapshots expected company and scope before awaiting the credential callback', async () => {
    let release!: (token: string) => void, entered!: () => void;
    const credentialEntered = new Promise<void>(resolve => {entered = resolve;});
    const credential = vi.fn(() => new Promise<string>(resolve => {release = resolve; entered();}));
    const paths: string[] = [];
    const endpoint = await fixture((request, response) => {paths.push(request.url!); sendHistory(response);});
    const expected = context(), result = client(endpoint.origin, {credential}).readHistory(expected, ROOM);
    await credentialEntered;
    expect(credential).toHaveBeenCalledOnce();
    expected.company_id = 'mutated-company'; expected.scope.id = 'beta'; release(TOKEN);
    await expect(result).resolves.toMatchObject({company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'}});
    expect(paths).toEqual([`/company/v1/conversations/${ROOM}/messages?project_id=alpha`]);
  });

  it('includes a stalled credential callback in the total deadline and never dispatches after expiry', async () => {
    let requests = 0, release!: (token: string) => void;
    const endpoint = await fixture((_request, response) => {requests++; sendHistory(response);});
    const credential = () => new Promise<string>(resolve => {release = resolve;});
    await fails(client(endpoint.origin, {credential, timeoutMs: 40}).readHistory(context(), ROOM), 'TIMEOUT');
    release(TOKEN); await tick();
    expect(requests).toBe(0); expect(endpoint.sockets.size).toBe(0);
  });

  it('uses one deadline across credential work and a continuously arriving response body', async () => {
    const endpoint = await fixture((_request, response) => {
      const raw = Buffer.from(canonicalBytes(full)), size = Math.ceil(raw.byteLength / 6);
      response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.byteLength});
      let offset = 0;
      const interval = setInterval(() => {
        if (response.destroyed) {clearInterval(interval); return;}
        const next = Math.min(offset + size, raw.byteLength);
        response.write(raw.subarray(offset, next)); offset = next;
        if (offset === raw.byteLength) {clearInterval(interval); response.end();}
      }, 20);
      cleanups.push(() => clearInterval(interval));
    });
    const credential = async () => {await pause(100); return TOKEN;};
    await fails(client(endpoint.origin, {credential, timeoutMs: 180}).readHistory(context(), ROOM), 'TIMEOUT');
    await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
  });

  it('honors an already-aborted signal before credential lookup or network activity', async () => {
    const controller = new AbortController(); controller.abort();
    const credential = vi.fn(() => TOKEN);
    await fails(client('https://127.0.0.1:1', {credential}).readHistory(context(), ROOM, undefined, controller.signal), 'ABORTED');
    expect(credential).not.toHaveBeenCalled();
  });

  it('aborts during credential work and never dispatches when the callback later resolves', async () => {
    let requests = 0, release!: (token: string) => void, entered!: () => void;
    const endpoint = await fixture((_request, response) => {requests++; sendHistory(response);});
    const controller = new AbortController();
    const credentialEntered = new Promise<void>(resolve => {entered = resolve;});
    const credential = () => new Promise<string>(resolve => {release = resolve; entered();});
    const result = client(endpoint.origin, {credential}).readHistory(context(), ROOM, undefined, controller.signal);
    await credentialEntered;
    controller.abort(); await fails(result, 'ABORTED'); release(TOKEN); await tick();
    expect(requests).toBe(0); expect(endpoint.sockets.size).toBe(0);
  });

  it('aborts an active response and releases the owned TLS socket', async () => {
    let started!: () => void;
    const bodyStarted = new Promise<void>(resolve => {started = resolve;});
    const endpoint = await fixture((_request, response) => {
      response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'}); response.write('{'); started();
    });
    const controller = new AbortController();
    const result = client(endpoint.origin).readHistory(context(), ROOM, undefined, controller.signal);
    await bodyStarted; controller.abort(); await fails(result, 'ABORTED');
    await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
  });

  it('sanitizes credential callback rejection without opening a request', async () => {
    let requests = 0;
    const endpoint = await fixture((_request, response) => {requests++; sendHistory(response);});
    const canary = 'private-credential-callback-canary';
    const credential = () => Promise.reject(new Error(canary));
    await fails(client(endpoint.origin, {credential}).readHistory(context(), ROOM), 'AUTHENTICATION_REQUIRED', [canary, TOKEN]);
    expect(requests).toBe(0);
  });

  it('rejects empty, non-string and newline-bearing bearer credentials without reflection or a request', async () => {
    let requests = 0;
    const endpoint = await fixture((_request, response) => {requests++; sendHistory(response);});
    for (const token of ['', null, 17, 'private-header-canary\r\nOrigin: https://private.invalid']) {
      await fails(client(endpoint.origin, {credential: () => token}).readHistory(context(), ROOM), 'AUTHENTICATION_REQUIRED', ['private-header-canary', 'private.invalid']);
    }
    expect(requests).toBe(0);
  });

  it('does not expose credential callback contents through client inspection or transport failures', async () => {
    const secret = 'private-transport-token-canary';
    const endpoint = await fixture(request => request.socket.destroy());
    const reader = client(endpoint.origin, {credential: () => secret});
    expect(JSON.stringify(reader) + inspect(reader)).not.toContain(secret);
    await fails(reader.readHistory(context(), ROOM), 'TRANSPORT', [secret]);
    expect(JSON.stringify(reader) + inspect(reader)).not.toContain(secret);
  });
});
