import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import type {RequestListener} from 'node:http';
import {rootCertificates} from 'node:tls';
import type {Duplex} from 'node:stream';
import {inspect} from 'node:util';
import {afterEach, expect, it, vi} from 'vitest';
import {OwnerDiscussionClient, OwnerDiscussionError} from '../../packages/company-client/owner-discussion.ts';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-candidate.1/examples.json';

const ca = readFileSync(new URL('./fixtures/owner-history-test.cert.pem', import.meta.url));
const key = readFileSync(new URL('./fixtures/owner-history-test.key.pem', import.meta.url));
const sample = examples.examples[0], TOKEN = 'PUBLIC-owner-discussion-unit-fixture-token';
const context = () => ({company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}});
const command = () => canonicalBytes(sample.command);
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function fixture(handler: RequestListener) {
  const sockets = new Set<Duplex>(), server = createServer({cert: ca, key}, handler);
  server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => {for (const socket of sockets) socket.destroy(); server.close(() => resolve());}));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture unavailable');
  return {origin: `https://127.0.0.1:${address.port}`, sockets};
}
function client(origin: string, overrides: Record<string, unknown> = {}) {
  return new OwnerDiscussionClient({origin, role: 'owner', credential: () => TOKEN, ca, timeoutMs: 2000, ...overrides} as never);
}
function send(response: Parameters<RequestListener>[1], value: unknown, status = 200) {
  const raw = Buffer.from(canonicalBytes(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.length}); response.end(raw);
}
async function fails(value: Promise<unknown>, code: string, secrets: string[] = []) {
  const error = await value.catch(error => error);
  expect(error).toBeInstanceOf(OwnerDiscussionError);
  expect((error as OwnerDiscussionError).code).toBe(code); expect((error as OwnerDiscussionError).message).toBe(code);
  for (const secret of secrets) expect(inspect(error)).not.toContain(secret);
}

it('uses exactly the fixed POST and historical GET with trusted headers and no hidden requests', async () => {
  const observed: {method: string; path: string; headers: Record<string, unknown>; body: Buffer}[] = [];
  const endpoint = await fixture((request, response) => {
    const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
      observed.push({method: request.method!, path: request.url!, headers: request.headers, body: Buffer.concat(chunks)});
      send(response, request.method === 'POST' ? sample.receipt : sample.read_back);
    });
  });
  const owner = client(endpoint.origin), raw = command();
  const receipt = await owner.append(context(), raw), read = await owner.readBack(context(), raw, receipt);
  expect(read.message.id).toBe(receipt.message_ref.id); expect(read.conversation.revision).toBe(1);
  expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(read.message)).toBe(true);
  expect(observed).toHaveLength(2);
  expect(observed[0]).toMatchObject({method: 'POST', path: '/company/v1/projects/alpha/owner-discussion/messages', body: Buffer.from(raw)});
  expect(observed[1]).toMatchObject({method: 'GET', path: `/company/v1/projects/alpha/owner-discussion/conversations/${receipt.conversation_ref.id}/messages/${receipt.message_ref.id}`, body: Buffer.alloc(0)});
  for (const item of observed) {
    expect(item.headers.host).toBe(new URL(endpoint.origin).host); expect(item.headers.authorization).toBe(`Bearer ${TOKEN}`);
    for (const name of ['origin', 'content-encoding', 'transfer-encoding']) expect(item.headers[name]).toBeUndefined();
  }
  expect(observed[0].headers['content-type']).toBe('application/json'); expect(observed[0].headers['content-length']).toBe(String(raw.length));
  expect(observed[1].headers['content-type']).toBeUndefined(); expect(observed[1].headers['content-length']).toBeUndefined();
});

it.each(['http://127.0.0.1:1', 'https://localhost:1', 'https://127.0.0.2:1', 'https://127.0.0.1:0', 'https://127.0.0.1:65536', 'https://127.0.0.1:01', 'https://127.0.0.1:1/', 'https://127.0.0.1:1?q=1'])('rejects nonexact origin %s', origin => {
  expect(() => client(origin)).toThrowError('CONFIG');
});
it('rejects role, transport overrides, bad CA and unbounded deadlines', () => {
  for (const extra of [{role: 'employee'}, {rejectUnauthorized: false}, {headers: {}}, {agent: {}}, {ca: ''}, {ca: 'bad'}, {timeoutMs: 0}, {timeoutMs: 10001}]) expect(() => client('https://127.0.0.1:1', extra)).toThrowError('CONFIG');
});

it('rejects invalid commands/context/receipt locally before credentials or network', async () => {
  const credential = vi.fn(() => TOKEN), owner = client('https://127.0.0.1:1', {credential});
  for (const value of [{...sample.command, actor: 'owner'}, {...sample.command, body: 'é'.repeat(4097)}, {...sample.command, body: '\u0001'.repeat(8192)}, {...sample.command, action: 'message.send'}]) await fails(owner.append(context(), canonicalBytes(value)), 'REQUEST');
  await fails(owner.append({...context(), scope: {kind: 'project', id: 'company-ops'}}, command()), 'REQUEST');
  await fails(owner.append(context(), Buffer.from('{"schema_version":1,"schema_version":1}')), 'REQUEST');
  await fails(owner.readBack(context(), command(), {...sample.receipt, request_digest: '0'.repeat(64)} as never), 'REQUEST');
  for (const receipt of [undefined, null]) await fails(owner.readBack(context(), command(), receipt as never), 'REQUEST');
  expect(credential).not.toHaveBeenCalled();
});

it.each([[400, 'INVALID_REQUEST'], [401, 'AUTHENTICATION_REQUIRED'], [403, 'SCOPE_DENIED'], [404, 'NOT_FOUND'], [409, 'IDEMPOTENCY_CONFLICT'], [503, 'RECORDS_UNAVAILABLE']] as const)('preserves only closed error %s/%s and never retries', async (status, code) => {
  let count = 0;
  const endpoint = await fixture((_request, response) => {count++; send(response, {schema_version: 1, error: {code}}, status);});
  await fails(client(endpoint.origin).append(context(), command()), code); expect(count).toBe(1);
});

it('rejects mismatched or reflected errors and HTML without exposing their contents', async () => {
  for (const [status, value] of [[400, {schema_version: 1, error: {code: 'NOT_FOUND'}}], [409, {schema_version: 1, error: {code: 'IDEMPOTENCY_CONFLICT', detail: TOKEN}}], [200, {schema_version: 1, error: {code: 'NOT_FOUND'}}]] as const) {
    const endpoint = await fixture((_request, response) => send(response, value, status));
    await fails(client(endpoint.origin).append(context(), command()), 'RESPONSE', [TOKEN]);
  }
  const endpoint = await fixture((_request, response) => {response.writeHead(500, {'Content-Type': 'text/html'}); response.end(`<html>${TOKEN}</html>`);});
  await fails(client(endpoint.origin).append(context(), command()), 'RESPONSE', [TOKEN]);
});

it('does not follow redirects or retry a POST after a connection closes', async () => {
  let targetCount = 0, count = 0;
  const target = await fixture((_request, response) => {targetCount++; send(response, sample.receipt);});
  const redirect = await fixture((_request, response) => {count++; response.writeHead(302, {Location: target.origin}); response.end();});
  await fails(client(redirect.origin).append(context(), command()), 'RESPONSE'); expect(count).toBe(1); expect(targetCount).toBe(0);
  count = 0; const lost = await fixture(request => {count++; request.socket.destroy();});
  await fails(client(lost.origin).append(context(), command()), 'TRANSPORT'); expect(count).toBe(1);
});

it('verifies the explicit CA and copies its trust bytes at construction', async () => {
  let count = 0; const endpoint = await fixture((_request, response) => {count++; send(response, sample.receipt);});
  await fails(client(endpoint.origin, {ca: rootCertificates[0]}).append(context(), command()), 'TRANSPORT'); expect(count).toBe(0);
  const mutable = Buffer.from(ca), owner = client(endpoint.origin, {ca: mutable}); mutable.fill(0);
  await expect(owner.append(context(), command())).resolves.toMatchObject({outcome: 'stored'}); expect(count).toBe(1);
});

it('rejects a different valid receipt or historical pair instead of accepting response echoes', async () => {
  const endpoint = await fixture((request, response) => send(response, request.method === 'POST' ? examples.examples[1].receipt : examples.examples[1].read_back));
  await fails(client(endpoint.origin).append(context(), command()), 'RESPONSE');
  await fails(client(endpoint.origin).readBack(context(), command(), sample.receipt as never), 'RESPONSE');
});

it('rejects raw overflow, unsupported encoding, malformed UTF8 and duplicate JSON keys', async () => {
  for (const mode of ['length', 'chunked', 'encoding', 'utf8', 'duplicate']) {
    const endpoint = await fixture((_request, response) => {
      const headers: Record<string, string | number> = {'Content-Type': 'application/json; charset=utf-8'};
      if (mode === 'length') headers['Content-Length'] = 262145;
      if (mode === 'encoding') headers['Content-Encoding'] = 'gzip'; response.writeHead(200, headers);
      if (mode === 'length') response.write('{'); else if (mode === 'chunked') response.end(Buffer.alloc(262145, 32));
      else if (mode === 'utf8') response.end(Buffer.from([0xc3, 0x28]));
      else if (mode === 'duplicate') response.end(Buffer.from(canonicalBytes(sample.receipt)).toString().replace('"schema_version":1', '"schema_version":1,"schema_version":1'));
      else response.end(canonicalBytes(sample.receipt));
    });
    await fails(client(endpoint.origin).append(context(), command()), 'RESPONSE'); await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
  }
});

it('captures context and command bytes before awaiting credentials', async () => {
  let release!: (value: string) => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => {entered = resolve;});
  const credential = () => new Promise<string>(resolve => {release = resolve; entered();});
  const paths: string[] = [], bodies: Buffer[] = [];
  const endpoint = await fixture((request, response) => {const chunks: Buffer[] = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {paths.push(request.url!); bodies.push(Buffer.concat(chunks)); send(response, sample.receipt);});});
  const expected = context(), raw = command(), retained = Buffer.from(raw), pending = client(endpoint.origin, {credential}).append(expected, raw);
  await waiting; expected.company_id = 'other-company'; expected.scope.id = 'beta'; raw.fill(32); release(TOKEN);
  await expect(pending).resolves.toMatchObject({company_id: 'leo-company'});
  expect(paths).toEqual(['/company/v1/projects/alpha/owner-discussion/messages']); expect(bodies).toEqual([retained]);
});

it('captures the exact read-back receipt before credential work', async () => {
  let release!: (value: string) => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => {entered = resolve;});
  const endpoint = await fixture((_request, response) => send(response, sample.read_back));
  const receipt = structuredClone(sample.receipt), credential = () => new Promise<string>(resolve => {release = resolve; entered();});
  const pending = client(endpoint.origin, {credential}).readBack(context(), command(), receipt as never);
  await waiting; receipt.message_ref.id = examples.examples[1].receipt.message_ref.id; release(TOKEN);
  await expect(pending).resolves.toMatchObject({message: {id: sample.receipt.message_ref.id}});
});

it('includes stalled credential work in the deadline and never dispatches after timeout', async () => {
  let release!: (value: string) => void, count = 0;
  const endpoint = await fixture((_request, response) => {count++; send(response, sample.receipt);});
  await fails(client(endpoint.origin, {credential: () => new Promise<string>(resolve => {release = resolve;}), timeoutMs: 30}).append(context(), command()), 'TIMEOUT');
  release(TOKEN); await new Promise(resolve => setTimeout(resolve, 20)); expect(count).toBe(0);
});

it('aborts before credentials and during active response without claiming undo or retry', async () => {
  const controller = new AbortController(); controller.abort(); const credential = vi.fn(() => TOKEN);
  await fails(client('https://127.0.0.1:1', {credential}).append(context(), command(), controller.signal), 'ABORTED'); expect(credential).not.toHaveBeenCalled();
  let begin!: () => void, count = 0; const started = new Promise<void>(resolve => {begin = resolve;});
  const endpoint = await fixture((_request, response) => {count++; response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'}); response.write('{'); begin();});
  const active = new AbortController(), pending = client(endpoint.origin).append(context(), command(), active.signal);
  await started; active.abort(); await fails(pending, 'ABORTED'); expect(count).toBe(1); await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
});

it('sanitizes callback/header failures and keeps credentials out of inspectable client fields', async () => {
  const endpoint = await fixture((_request, response) => send(response, sample.receipt));
  for (const token of ['', null, 17, 'secret\r\nOrigin: https://private.invalid']) await fails(client(endpoint.origin, {credential: () => token}).append(context(), command()), 'AUTHENTICATION_REQUIRED', ['private.invalid']);
  const owner = client(endpoint.origin, {credential: () => {throw Error(TOKEN);}});
  expect(inspect(owner)).not.toContain(TOKEN); await fails(owner.append(context(), command()), 'AUTHENTICATION_REQUIRED', [TOKEN]);
});
