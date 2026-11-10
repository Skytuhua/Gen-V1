import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import type {RequestListener} from 'node:http';
import type {Duplex} from 'node:stream';
import {rootCertificates} from 'node:tls';
import {inspect} from 'node:util';
import {afterEach, expect, it, vi} from 'vitest';
import {OwnerDiscussionHistoryClient, OwnerDiscussionHistoryError} from '../../packages/company-client/owner-discussion-history.ts';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-history-candidate.1/examples.json';

const initial = examples.examples[1].page, terminal = examples.examples[2].page, empty = examples.examples[0].page, fresh = examples.examples[3].page;
const ca = readFileSync(new URL('./fixtures/owner-history-test.cert.pem', import.meta.url));
const key = readFileSync(new URL('./fixtures/owner-history-test.key.pem', import.meta.url));
const TOKEN = 'PUBLIC-owner-history-page-unit-fixture-only';
const context = () => ({company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}});
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
async function fixture(handler: RequestListener) {
  const sockets = new Set<Duplex>(), server = createServer({cert: ca, key}, handler);
  server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => {for (const socket of sockets) socket.destroy(); server.close(() => resolve());}));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture unavailable');
  return {origin: `https://127.0.0.1:${address.port}`, sockets};
}
function client(origin: string, overrides: Record<string, unknown> = {}) {
  return new OwnerDiscussionHistoryClient({origin, role: 'owner', credential: () => TOKEN, ca, timeoutMs: 2000, ...overrides} as never);
}
function send(response: Parameters<RequestListener>[1], value: unknown, status = 200) {
  const raw = Buffer.from(canonicalBytes(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.length}); response.end(raw);
}
async function fails(promise: Promise<unknown>, code: string, status?: number) {
  const error = await promise.catch(error => error);
  expect(error).toBeInstanceOf(OwnerDiscussionHistoryError); expect((error as Error).message).toBe(code);
  expect((error as OwnerDiscussionHistoryError).code).toBe(code); expect((error as OwnerDiscussionHistoryError).status).toBe(status);
  expect(inspect(error)).not.toContain(TOKEN);
}
async function started() {
  const endpoint = await fixture((request, response) => send(response, request.url!.includes('cursor=') ? terminal : initial));
  const reader = client(endpoint.origin), result = await reader.start(context(), 2);
  expect(result.continuation).not.toBeNull();
  return {endpoint, reader, result};
}

it('makes one fixed GET per explicit start/continue, retaining the cut without automatic fetching', async () => {
  const observed: {path: string; method: string; bytes: number; headers: Record<string, unknown>}[] = [];
  const endpoint = await fixture((request, response) => {
    let bytes = 0; request.on('data', chunk => {bytes += chunk.length;}); request.on('end', () => {
      observed.push({path: request.url!, method: request.method!, bytes, headers: request.headers});
      send(response, request.url!.includes('cursor=') ? terminal : initial);
    });
  });
  const reader = client(endpoint.origin), first = await reader.start(context(), 2);
  expect(observed).toHaveLength(1); expect(first.continuation!.seenMessageIds).toHaveLength(2);
  expect(Object.isFrozen(first.continuation!.seenMessageIds)).toBe(true);
  const next = await reader.continue(context(), first.continuation!);
  expect(next.page.range.start_sequence).toBe(1); expect(next.continuation).toBeNull();
  expect(next.page.snapshot).toEqual(first.page.snapshot); expect(next.page.watermark_head).toEqual(first.page.watermark_head);
  expect(observed.map(x => x.path)).toEqual(['/company/v1/projects/alpha/owner-discussion/history?limit=2', `/company/v1/projects/alpha/owner-discussion/history?limit=2&cursor=${initial.next_cursor}`]);
  for (const request of observed) {
    expect(request.method).toBe('GET'); expect(request.bytes).toBe(0); expect(request.headers.host).toBe(new URL(endpoint.origin).host); expect(request.headers.authorization).toBe(`Bearer ${TOKEN}`);
    for (const name of ['origin', 'content-type', 'content-length', 'transfer-encoding', 'content-encoding']) expect(request.headers[name]).toBeUndefined();
  }
});
it('resolves absent limit to20 and accepts only an empty issued cut, not global completeness', async () => {
  const paths: string[] = [], endpoint = await fixture((request, response) => {paths.push(request.url!); send(response, empty);});
  const result = await client(endpoint.origin).start(context());
  expect(paths).toEqual(['/company/v1/projects/alpha/owner-discussion/history']);
  expect(result.page.coverage.status).toBe('complete_for_cut'); expect(result.page.watermark_head).toBeNull(); expect(result.continuation).toBeNull();
});
it('allows explicit repetition of the same retained continuation without hidden advancement', async () => {
  const {reader, result} = await started(), before = canonicalBytes(result.continuation);
  const one = await reader.continue(context(), result.continuation!), two = await reader.continue(context(), result.continuation!);
  expect(canonicalBytes(one.page)).toEqual(canonicalBytes(two.page)); expect(canonicalBytes(result.continuation)).toEqual(before);
});
it('rejects null/absent/invalid continuation locally instead of silently starting a new cut', async () => {
  const credential = vi.fn(() => TOKEN), reader = client('https://127.0.0.1:1', {credential});
  for (const value of [null, undefined, {}, {nextCursor: 'x'}, {context: context(), requestedLimit: 20}]) await fails(reader.continue(context(), value as never), 'REQUEST');
  for (const limit of [null, 0, 51, 1.5, NaN, '20']) await fails(reader.start(context(), limit as never), 'REQUEST');
  await fails(reader.start({...context(), scope: {kind: 'project', id: 'company-ops'}}), 'REQUEST');
  expect(credential).not.toHaveBeenCalled();
});
it.each(['http://127.0.0.1:1', 'https://localhost:1', 'https://127.0.0.2:1', 'https://127.0.0.1:0', 'https://127.0.0.1:65536', 'https://127.0.0.1:01', 'https://127.0.0.1:1/', 'https://127.0.0.1:1?x=1'])('rejects nonexact origin %s', origin => {
  expect(() => client(origin)).toThrowError('CONFIG');
});
it('rejects role/trust/transport overrides and unbounded deadlines', () => {
  for (const value of [{role: 'employee'}, {ca: 'bad'}, {rejectUnauthorized: false}, {headers: {}}, {agent: {}}, {timeoutMs: 0}, {timeoutMs: 10001}]) expect(() => client('https://127.0.0.1:1', value)).toThrowError('CONFIG');
});
it.each([[400, 'INVALID_REQUEST'], [401, 'AUTHENTICATION_REQUIRED'], [403, 'SCOPE_DENIED'], [404, 'NOT_FOUND'], [409, 'RESYNC_REQUIRED'], [410, 'RESYNC_REQUIRED'], [503, 'RECORDS_UNAVAILABLE']] as const)('surfaces only exact wire error %s/%s and preserves its HTTP status', async (status, code) => {
  let count = 0; const endpoint = await fixture((_request, response) => {count++; send(response, {schema_version: 1, error: {code}}, status);});
  await fails(client(endpoint.origin).start(context(), 2), code, status); expect(count).toBe(1);
});
it('does not silently resnapshot or retry a rejected continuation', async () => {
  let count = 0; const endpoint = await fixture((request, response) => {count++; send(response, request.url!.includes('cursor=') ? {schema_version: 1, error: {code: 'RESYNC_REQUIRED'}} : initial, request.url!.includes('cursor=') ? 410 : 200);});
  const reader = client(endpoint.origin), first = await reader.start(context(), 2);
  await fails(reader.continue(context(), first.continuation!), 'RESYNC_REQUIRED', 410); expect(count).toBe(2);
});
it('rejects response-provided scope/limit and mixed snapshots during continuation', async () => {
  const endpoint = await fixture((request, response) => send(response, request.url!.includes('cursor=') ? fresh : initial));
  const reader = client(endpoint.origin), first = await reader.start(context(), 2);
  await fails(reader.continue(context(), first.continuation!), 'RESPONSE');
  await fails(reader.start({...context(), company_id: 'other-company'}, 2), 'RESPONSE');
  await fails(reader.start(context(), 1), 'RESPONSE');
});
it('copies explicit CA trust and does not follow redirects or retry transport failures', async () => {
  let requests = 0;
  const endpoint = await fixture((_request, response) => {requests++; send(response, initial);});
  await fails(client(endpoint.origin, {ca: rootCertificates[0]}).start(context(), 2), 'TRANSPORT'); expect(requests).toBe(0);
  const mutable = Buffer.from(ca), reader = client(endpoint.origin, {ca: mutable}); mutable.fill(0);
  await expect(reader.start(context(), 2)).resolves.toBeDefined();
  const redirect = await fixture((_request, response) => {response.writeHead(302, {Location: endpoint.origin}); response.end();});
  await fails(client(redirect.origin).start(context(), 2), 'RESPONSE'); expect(requests).toBe(1);
  let lostCount = 0; const lost = await fixture(request => {lostCount++; request.socket.destroy();});
  await fails(client(lost.origin).start(context(), 2), 'TRANSPORT'); expect(lostCount).toBe(1);
});
it('rejects malformed, mismatched and reflected responses without exposing them', async () => {
  for (const mode of ['overflow', 'encoding', 'utf8', 'duplicate', 'error-extra', 'error-mismatch', 'html']) {
    const endpoint = await fixture((_request, response) => {
      if (mode === 'error-extra' || mode === 'error-mismatch') {send(response, {schema_version: 1, error: mode === 'error-extra' ? {code: 'RESYNC_REQUIRED', detail: TOKEN} : {code: 'NOT_FOUND'}}, 409); return;}
      response.writeHead(200, {'Content-Type': mode === 'html' ? 'text/html' : 'application/json; charset=utf-8', ...(mode === 'encoding' ? {'Content-Encoding': 'gzip'} : {})});
      if (mode === 'overflow') response.end(Buffer.alloc(262145, 32)); else if (mode === 'utf8') response.end(Buffer.from([0xc3, 0x28]));
      else if (mode === 'duplicate') response.end(Buffer.from(canonicalBytes(initial)).toString().replace('"schema_version":1', '"schema_version":1,"schema_version":1'));
      else if (mode === 'html') response.end(`<html>${TOKEN}</html>`); else response.end(canonicalBytes(initial));
    });
    await fails(client(endpoint.origin).start(context(), 2), 'RESPONSE'); await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
  }
});
it('captures independent context before awaiting credentials', async () => {
  let release!: (value: string) => void, entered!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  const paths: string[] = [], endpoint = await fixture((request, response) => {paths.push(request.url!); send(response, initial);});
  const credential = () => new Promise<string>(resolve => {release = resolve; entered();});
  const expected = context(), pending = client(endpoint.origin, {credential}).start(expected, 2);
  await ready; expected.company_id = 'other-company'; expected.scope.id = 'beta'; release(TOKEN);
  await expect(pending).resolves.toMatchObject({page: {company_id: 'leo-company'}}); expect(paths).toEqual(['/company/v1/projects/alpha/owner-discussion/history?limit=2']);
});
it('captures the retained continuation before asynchronous credential work', async () => {
  const {result} = await started(); const retained = structuredClone(result.continuation!);
  let release!: (value: string) => void, entered!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  const endpoint = await fixture((_request, response) => send(response, terminal));
  const credential = () => new Promise<string>(resolve => {release = resolve; entered();});
  const pending = client(endpoint.origin, {credential}).continue(context(), retained);
  await ready; Object.assign(retained.context, {scope: {kind: 'project', id: 'beta'}}); Object.assign(retained.snapshot, {id: fresh.snapshot.id}); Object.assign(retained, {seenMessageIds: []});
  release(TOKEN); await expect(pending).resolves.toMatchObject({page: {snapshot: initial.snapshot}});
});
it('includes stalled credentials in its deadline and blocks late dispatch', async () => {
  let release!: (value: string) => void, count = 0; const endpoint = await fixture((_request, response) => {count++; send(response, initial);});
  await fails(client(endpoint.origin, {credential: () => new Promise<string>(resolve => {release = resolve;}), timeoutMs: 30}).start(context(), 2), 'TIMEOUT');
  release(TOKEN); await new Promise(resolve => setTimeout(resolve, 20)); expect(count).toBe(0);
});
it('aborts before credentials and during an active response without advancing state', async () => {
  const before = new AbortController(); before.abort(); const credential = vi.fn(() => TOKEN);
  await fails(client('https://127.0.0.1:1', {credential}).start(context(), 2, before.signal), 'ABORTED'); expect(credential).not.toHaveBeenCalled();
  let entered!: () => void; const ready = new Promise<void>(resolve => {entered = resolve;});
  const endpoint = await fixture((_request, response) => {response.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'}); response.write('{'); entered();});
  const controller = new AbortController(), pending = client(endpoint.origin).start(context(), 2, controller.signal);
  await ready; controller.abort(); await fails(pending, 'ABORTED'); await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
});
it('sanitizes credential failures and keeps secrets out of public state', async () => {
  const reader = client('https://127.0.0.1:1', {credential: () => {throw Error(TOKEN);}});
  expect(inspect(reader)).not.toContain(TOKEN); await fails(reader.start(context(), 2), 'AUTHENTICATION_REQUIRED');
  for (const token of ['', null, 12, 'private\r\nOrigin: https://private.invalid']) await fails(client('https://127.0.0.1:1', {credential: () => token}).start(context(), 2), 'AUTHENTICATION_REQUIRED');
});
