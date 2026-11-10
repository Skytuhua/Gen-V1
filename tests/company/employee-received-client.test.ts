import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import type {RequestListener} from 'node:http';
import type {Duplex} from 'node:stream';
import {rootCertificates} from 'node:tls';
import {inspect} from 'node:util';
import {afterEach, expect, it, vi} from 'vitest';
import {EmployeeReceivedClient, EmployeeReceivedClientError} from '../../packages/company-client/employee-received.ts';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import type {EmployeeReceivedContext} from '../../packages/company-contracts/communications/employee-received.ts';
import golden from '../../packages/company-contracts/communications/v1/golden/employee-received.json';

const ca = readFileSync(new URL('./fixtures/owner-history-test.cert.pem', import.meta.url));
const key = readFileSync(new URL('./fixtures/owner-history-test.key.pem', import.meta.url));
const TOKEN = 'PUBLIC-received-client-unit-only';
const sample = golden.example;
type Mutable<T> = T extends object ? {-readonly [Key in keyof T]: Mutable<T[Key]>} : T;
const context = (): Mutable<EmployeeReceivedContext> => ({company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'},
  machine_principal_id: 'machine:E11', journal_owner_id: 'supervisor-E11', recipient: structuredClone(sample.envelope.delivery.recipient) as Mutable<EmployeeReceivedContext['recipient']>});
const envelope = () => canonicalBytes(sample.envelope);
const command = () => new TextEncoder().encode(`\n ${new TextDecoder().decode(canonicalBytes(sample.command))}\n`);
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});

async function fixture(handler: RequestListener) {
  const sockets = new Set<Duplex>(), server = createServer({cert: ca, key}, handler);
  server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => {for (const socket of sockets) socket.destroy(); server.close(() => resolve());}));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture');
  return {origin: `https://127.0.0.1:${address.port}`, sockets};
}
function client(origin: string, extra: Record<string, unknown> = {}) {
  return new EmployeeReceivedClient({origin, role: 'machine', credential: () => TOKEN, ca, timeoutMs: 2000, ...extra} as never);
}
function send(response: Parameters<RequestListener>[1], value: unknown, status = 200) {
  const bytes = Buffer.from(canonicalBytes(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length}); response.end(bytes);
}
async function fails(pending: Promise<unknown>, code: string, status?: number) {
  const error = await pending.catch(value => value);
  expect(error).toBeInstanceOf(EmployeeReceivedClientError);
  if (!(error instanceof EmployeeReceivedClientError)) throw Error('typed error');
  expect(error.code).toBe(code); expect(error.status).toBe(status); expect(inspect(error)).not.toContain(TOKEN);
}

it('exposes only a machine-role received ACK operation', () => {
  expect(typeof EmployeeReceivedClient).toBe('function');
  const reader = client('https://127.0.0.1:1');
  expect(reader.role).toBe('machine'); expect('send' in reader).toBe(false); expect('inbox' in reader).toBe(false);
});
it('posts the exact persisted ACK bytes and validates explicit same-ID replay without allocating an identity', async () => {
  const requests: {path: string; headers: Record<string, unknown>; body: Buffer}[] = [];
  const endpoint = await fixture((request, response) => {const chunks: Buffer[] = [];
    expect(request.method).toBe('POST'); request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
      requests.push({path: request.url!, headers: request.headers, body: Buffer.concat(chunks)}); send(response, sample.receipt);
    });
  });
  const reader = client(endpoint.origin), raw = command();
  const first = await reader.acknowledge(context(), envelope(), raw);
  expect(first).toEqual(sample.receipt); expect(await reader.acknowledge(context(), envelope(), raw)).toEqual(first);
  expect(requests).toHaveLength(2);
  for (const value of requests) {
    expect(value.path).toBe('/company/v1/commands'); expect(value.body).toEqual(Buffer.from(raw));
    expect(value.headers.authorization).toBe(`Bearer ${TOKEN}`); expect(value.headers.host).toBe(new URL(endpoint.origin).host);
    expect(value.headers['content-type']).toBe('application/json'); expect(value.headers['content-length']).toBe(String(raw.byteLength));
    for (const header of ['origin', 'transfer-encoding', 'content-encoding']) expect(value.headers[header]).toBeUndefined();
  }
});
it('captures the exact protected context, envelope and persisted ACK before credential await', async () => {
  let release!: (token: string) => void, entered!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  const retained = command(), endpoint = await fixture((request, response) => {const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {expect(Buffer.concat(chunks)).toEqual(Buffer.from(retained)); send(response, sample.receipt);});
  });
  const expected = context(), ack = command(), item = envelope();
  const pending = client(endpoint.origin, {credential: () => new Promise<string>(resolve => {release = resolve; entered();})}).acknowledge(expected, item, ack);
  await ready; expected.scope.id = 'beta'; expected.recipient.generation = 99; ack.fill(0); item.fill(0); release(TOKEN);
  await expect(pending).resolves.toEqual(sample.receipt);
});
it('rejects owner/employee roles, fallback options and arbitrary origins', () => {
  for (const extra of [{role: 'owner'}, {role: 'employee'}, {ownerCredential: () => TOKEN}, {timeoutMs: 0}, {timeoutMs: 10001},
    {origin: 'http://127.0.0.1:1'}, {origin: 'https://localhost:1'}, {origin: 'https://127.0.0.1:1/'}, {ca: 'bad'}]) {
    expect(() => client('https://127.0.0.1:1', extra)).toThrowError('CONFIG');
  }
});
it('rejects invalid ACKs and foreign envelope bindings before credentials', async () => {
  const credential = vi.fn(() => TOKEN), reader = client('https://127.0.0.1:1', {credential});
  await fails(reader.acknowledge(context(), envelope(), canonicalBytes({...sample.command, command_id: crypto.randomUUID()})), 'REQUEST');
  await fails(reader.acknowledge({...context(), scope: {kind: 'project', id: 'beta'}}, envelope(), command()), 'REQUEST');
  await fails(reader.acknowledge(context(), envelope(), new Uint8Array(32769)), 'REQUEST');
  await fails(reader.acknowledge(context(), new Uint8Array(262145), command()), 'REQUEST');
  expect(credential).not.toHaveBeenCalled();
});
it.each([[400, 'INVALID_REQUEST'], [401, 'AUTHENTICATION_REQUIRED'], [403, 'SCOPE_DENIED'], [404, 'NOT_FOUND'],
  [409, 'IDEMPOTENCY_CONFLICT'], [503, 'AUTHORITY_UNAVAILABLE'], [503, 'RECORDS_UNAVAILABLE']] as const)('returns closed sanitized wire error %s/%s', async (status, code) => {
  let calls = 0; const endpoint = await fixture((_request, response) => {calls++; send(response, {schema_version: 1, error: {code}}, status);});
  await fails(client(endpoint.origin).acknowledge(context(), envelope(), command()), code, status); expect(calls).toBe(1);
});
it('does not retry uncertain receipt delivery or redirect credentials', async () => {
  let calls = 0; const endpoint = await fixture(request => {calls++; request.socket.destroy();});
  await fails(client(endpoint.origin).acknowledge(context(), envelope(), command()), 'TRANSPORT'); expect(calls).toBe(1);
  const target = await fixture((_request, response) => {calls++; send(response, sample.receipt);});
  const redirect = await fixture((_request, response) => {response.writeHead(302, {Location: target.origin}); response.end();});
  await fails(client(redirect.origin).acknowledge(context(), envelope(), command()), 'RESPONSE'); expect(calls).toBe(1);
});
it('requires the configured CA and normal hostname verification', async () => {
  let calls = 0; const endpoint = await fixture((_request, response) => {calls++; send(response, sample.receipt);});
  await fails(client(endpoint.origin, {ca: rootCertificates[0]}).acknowledge(context(), envelope(), command()), 'TRANSPORT'); expect(calls).toBe(0);
});
it('bounds credential delay from method entry and makes no late request', async () => {
  let release!: (value: string) => void, calls = 0;
  const endpoint = await fixture((_request, response) => {calls++; send(response, sample.receipt);});
  const pending = client(endpoint.origin, {timeoutMs: 80, credential: () => new Promise<string>(resolve => {release = resolve;})}).acknowledge(context(), envelope(), command());
  await fails(pending, 'TIMEOUT'); release?.(TOKEN); await new Promise(resolve => setTimeout(resolve, 10)); expect(calls).toBe(0);
});
it('aborts before credentials and closes an active bounded response', async () => {
  const credential = vi.fn(() => TOKEN), abort = new AbortController(); abort.abort();
  await fails(client('https://127.0.0.1:1', {credential}).acknowledge(context(), envelope(), command(), abort.signal), 'ABORTED'); expect(credential).not.toHaveBeenCalled();
  let entered!: () => void; const ready = new Promise<void>(resolve => {entered = resolve;});
  const endpoint = await fixture((_request, response) => {response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': 1000}); response.write('{'); entered();});
  const active = new AbortController(), pending = client(endpoint.origin).acknowledge(context(), envelope(), command(), active.signal);
  await ready; active.abort(); await fails(pending, 'ABORTED'); await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
});
it('keeps a total deadline during slow body progress', async () => {
  const endpoint = await fixture((_request, response) => {response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': 1000}); response.write(' ');
    const drip = setInterval(() => response.write(' '), 10); response.once('close', () => clearInterval(drip));});
  await fails(client(endpoint.origin, {timeoutMs: 160}).acknowledge(context(), envelope(), command()), 'TIMEOUT');
  await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
});
it('rejects malformed, oversized, invalidly scoped or reflected replies', async () => {
  for (const mode of ['overflow', 'utf8', 'duplicate', 'html', 'encoding', 'extra-error', 'error-code', 'scope', 'digest']) {
    const endpoint = await fixture((_request, response) => {
      if (mode === 'extra-error' || mode === 'error-code') {send(response, {schema_version: 1, error: mode === 'extra-error' ? {code: 'RECORDS_UNAVAILABLE', secret: TOKEN} : {code: 'IDEMPOTENCY_CONFLICT'}}, 503); return;}
      if (mode === 'scope') {send(response, {...sample.receipt, company_id: 'foreign'}); return;}
      if (mode === 'digest') {send(response, {...sample.receipt, digest: '0'.repeat(64)}); return;}
      const body = mode === 'overflow' ? Buffer.alloc(262145, 32) : mode === 'utf8' ? Buffer.from([0xc3, 0x28]) :
        mode === 'duplicate' ? Buffer.from(new TextDecoder().decode(canonicalBytes(sample.receipt)).replace('"schema_version":1', '"schema_version":1,"schema_version":1')) :
          mode === 'html' ? Buffer.from(`<html>${TOKEN}</html>`) : Buffer.from(canonicalBytes(sample.receipt));
      response.writeHead(200, {'Content-Type': mode === 'html' ? 'text/html' : 'application/json; charset=utf-8', 'Content-Length': body.length, ...(mode === 'encoding' ? {'Content-Encoding': 'gzip'} : {})}); response.end(body);
    });
    await fails(client(endpoint.origin).acknowledge(context(), envelope(), command()), 'RESPONSE');
  }
});
