import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {rootCertificates} from 'node:tls';
import {inspect} from 'node:util';
import {afterEach, expect, it, vi} from 'vitest';
import {OwnerDiscussionSSEClient, OwnerDiscussionSSEError} from '../../packages/company-client/owner-discussion-sse.ts';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import {normalizeOwnerDiscussionStreamRequest, validateOwnerDiscussionSnapshot, validateOwnerDiscussionChanges, type OwnerDiscussionChangesState} from '../../packages/company-contracts/communications/owner-discussion-stream.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-stream-candidate.1/examples.json';

const ca = readFileSync(new URL('./fixtures/owner-history-test.cert.pem', import.meta.url));
const key = readFileSync(new URL('./fixtures/owner-history-test.key.pem', import.meta.url));
const TOKEN = 'PUBLIC-owner-SSE-client-fixture-only';
const context = () => ({company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}});
const page = (index: number) => examples.examples[index].page;
const changes = () => Buffer.from(`id: ${page(2).next_cursor}\nevent: changes\ndata: ${Buffer.from(canonicalBytes(page(2))).toString('utf8')}\n\n`);
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
async function fixture(handler: (request: IncomingMessage) => void) {
  const sockets = new Set<Duplex>(), server = createServer({cert: ca, key}, request => handler(request));
  server.on('connection', socket => {sockets.add(socket); socket.once('close', () => sockets.delete(socket));});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => {for (const socket of sockets) socket.destroy(); server.close(() => resolve());}));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture');
  return {origin: `https://127.0.0.1:${address.port}`, sockets};
}
function headers(request: IncomingMessage, extra = '', status = 200) {
  request.socket.write(`HTTP/1.0 ${status} Result\r\nContent-Type: ${status === 200 ? 'text/event-stream' : 'application/json'}; charset=utf-8\r\nCache-Control: no-store, no-transform\r\nConnection: close\r\n${extra}\r\n`);
}
function client(origin: string, override: Record<string, unknown> = {}) {
  return new OwnerDiscussionSSEClient({origin, role: 'owner', credential: () => TOKEN, ca, timeoutMs: 1000, ...override} as never);
}
async function baseline() {
  const first = await validateOwnerDiscussionSnapshot(canonicalBytes(page(0)), context(), normalizeOwnerDiscussionStreamRequest('snapshot', context(), 1));
  if (first.state.mode !== 'snapshot') throw Error('fixture');
  const last = await validateOwnerDiscussionSnapshot(canonicalBytes(page(1)), context(), normalizeOwnerDiscussionStreamRequest('snapshot', context(), 1, first.state.nextCursor), first.state);
  if (last.state.mode !== 'changes') throw Error('fixture');
  return last.state;
}
async function collect(reader: OwnerDiscussionSSEClient, from: OwnerDiscussionChangesState, controller = new AbortController()) {
  const values = [];
  for await (const value of reader.open(context(), from, {signal: controller.signal})) values.push(value);
  return values;
}
async function fails(pending: Promise<unknown>, code: string, status?: number) {
  const error = await pending.catch(error => error);
  expect(error).toBeInstanceOf(OwnerDiscussionSSEError); if (!(error instanceof OwnerDiscussionSSEError)) throw Error('missing typed error');
  expect(error.code).toBe(code); expect(error.status).toBe(status);
  expect(error.requiresSnapshot).toBe(code === 'RESYNC_REQUIRED'); expect(inspect(error)).not.toContain(TOKEN);
}

it('opens exactly one fixed GET, yields comments without state and applies a complete existing page', async () => {
  const observed: IncomingMessage[] = [], endpoint = await fixture(request => {
    observed.push(request); headers(request); request.socket.write(': connected\n\n: keepalive\n\n'); request.socket.end(changes());
  });
  const from = await baseline(), before = canonicalBytes(from), values = await collect(client(endpoint.origin), from);
  expect(values.map(value => value.kind)).toEqual(['comment', 'comment', 'changes']);
  expect(values[0]).toMatchObject({comment: 'connected'}); expect(values[1]).toMatchObject({comment: 'keepalive'});
  const update = values[2]; if (update.kind !== 'changes') throw Error('fixture');
  expect(update.result.applied).toHaveLength(1); expect(update.result.state.position).toBe(2);
  expect(Buffer.from(update.rawFrame)).toEqual(changes()); expect(canonicalBytes(from)).toEqual(before);
  expect(observed).toHaveLength(1); expect(observed[0].url).toBe(`/company/v1/projects/alpha/owner-discussion/events?limit=1&cursor=${from.nextCursor}`);
  expect(observed[0].headers).toMatchObject({host: new URL(endpoint.origin).host, authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream'});
  for (const name of ['origin','content-type','content-length','transfer-encoding','content-encoding','last-event-id']) expect(observed[0].headers[name]).toBeUndefined();
  await vi.waitFor(() => expect(endpoint.sockets.size).toBe(0));
});
it('requires a complete baseline and explicit AbortSignal before touching credentials', async () => {
  const credential = vi.fn(() => TOKEN), reader = client('https://127.0.0.1:1', {credential});
  const from = await baseline();
  for (const value of [undefined, null, {}, {...from, mode: 'snapshot'}, {...from, requestedLimit: 51}]) {
    expect(() => reader.open(context(), value as never, {signal: new AbortController().signal})).toThrow('REQUEST');
  }
  for (const options of [undefined, {}, {signal: {}}, {signal: new AbortController().signal, headers: {} }]) expect(() => reader.open(context(), from, options as never)).toThrow('REQUEST');
  expect(credential).not.toHaveBeenCalled();
});
it.each(['http://127.0.0.1:1','https://localhost:1','https://127.0.0.2:1','https://127.0.0.1:0','https://127.0.0.1:01','https://127.0.0.1:65536','https://127.0.0.1:1/'])('rejects nonexact origin %s', origin => {
  expect(() => client(origin)).toThrow('CONFIG');
});
it('rejects unsafe role, trust, deadline and transport overrides', () => {
  for (const value of [{role:'employee'},{ca:'bad'},{rejectUnauthorized:false},{headers:{}},{agent:{}},{timeoutMs:0},{timeoutMs:10001}]) expect(() => client('https://127.0.0.1:1', value)).toThrow('CONFIG');
});
it('captures scope, cursor, projection and CA before asynchronous credentials', async () => {
  let release!: (value: string) => void, entered!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  const paths: string[] = [], endpoint = await fixture(request => {paths.push(request.url!); headers(request); request.socket.end(Buffer.concat([Buffer.from(': connected\n\n'), changes()]));});
  const expected = context(), from = structuredClone(await baseline()), caCopy = Buffer.from(ca);
  const iterator = client(endpoint.origin, {ca: caCopy, credential: () => new Promise<string>(resolve => {release = resolve; entered();})}).open(expected, from, {signal: new AbortController().signal});
  const pending = iterator.next(); await ready;
  expected.scope.id = 'beta'; expected.company_id = 'foreign'; Object.assign(from, {nextCursor:'AA',position:9,baseline:[]}); caCopy.fill(0); release(TOKEN);
  expect((await pending).value).toMatchObject({kind:'comment',comment:'connected'});
  const update = (await iterator.next()).value; expect(update).toMatchObject({kind:'changes',result:{state:{position:2}}});
  await iterator.return(undefined); expect(paths[0]).toContain('/alpha/');
});
it('aborts pending credentials and prevents any late network dispatch', async () => {
  let release!: (value: string) => void, calls = 0;
  const endpoint = await fixture(() => {calls++;}), controller = new AbortController();
  const iterator = client(endpoint.origin, {credential: () => new Promise<string>(resolve => {release=resolve;})}).open(context(), await baseline(), {signal:controller.signal});
  const pending = iterator.next(); await vi.waitFor(() => expect(release).toBeTypeOf('function')); controller.abort();
  expect((await pending).done).toBe(true); release(TOKEN); await new Promise(resolve => setTimeout(resolve, 10)); expect(calls).toBe(0);
});
it('bounds credential/header establishment while allowing stream lifetime beyond that deadline', async () => {
  const from = await baseline(), endpoint = await fixture(request => {headers(request); request.socket.write(': connected\n\n');});
  const controller = new AbortController(), iterator = client(endpoint.origin,{timeoutMs:100}).open(context(),from,{signal:controller.signal});
  expect((await iterator.next()).value).toMatchObject({kind:'comment'});
  await new Promise(resolve=>setTimeout(resolve,150)); controller.abort(); expect((await iterator.next()).done).toBe(true);
  await fails(collect(client(endpoint.origin,{timeoutMs:30,credential:()=>new Promise(()=>{})}),from),'TIMEOUT');
});
it('explicit abort while waiting closes the socket and keeps the last applied cursor', async () => {
  const endpoint = await fixture(request => {headers(request);request.socket.write(': connected\n\n');});
  const controller = new AbortController(), iterator = client(endpoint.origin).open(context(),await baseline(),{signal:controller.signal});
  await iterator.next(); const pending = iterator.next(); controller.abort(); expect((await pending).done).toBe(true);
  await vi.waitFor(()=>expect(endpoint.sockets.size).toBe(0));
});
it('discarding an incomplete frame on ordinary EOF never yields its id or advances state', async () => {
  const endpoint = await fixture(request=>{headers(request);request.socket.end(': connected\n\nid: AA\nevent: changes\ndata: {"partial":');});
  const from=await baseline(), before=canonicalBytes(from), values=await collect(client(endpoint.origin),from);
  expect(values).toHaveLength(1); expect(canonicalBytes(from)).toEqual(before);
});
it('merges older cursor overlap against the separately retained latest projection once', async () => {
  const old=await baseline(), latest=await validateOwnerDiscussionChanges(canonicalBytes(page(2)),context(),normalizeOwnerDiscussionStreamRequest('changes',context(),1,old.nextCursor),old);
  const endpoint=await fixture(request=>{headers(request);request.socket.end(Buffer.concat([Buffer.from(': connected\n\n'),changes()]));});
  const values=[]; for await(const value of client(endpoint.origin).open(context(),old,{signal:new AbortController().signal,projection:latest.state})) values.push(value);
  const last=values.at(-1); if(last?.kind!=='changes')throw Error('fixture'); expect(last.result.applied).toEqual([]); expect(last.result.state).toEqual(latest.state);
});
it.each([[400,'INVALID_REQUEST'],[401,'AUTHENTICATION_REQUIRED'],[403,'SCOPE_DENIED'],[404,'NOT_FOUND'],[409,'RESYNC_REQUIRED'],[410,'RESYNC_REQUIRED'],[503,'RECORDS_UNAVAILABLE']] as const)('surfaces closed HTTP %i without reconnect',async(status,code)=>{
  let calls=0; const endpoint=await fixture(request=>{calls++;headers(request,'',status);request.socket.end(canonicalBytes({schema_version:1,error:{code}}));});
  await fails(collect(client(endpoint.origin),await baseline()),code,status); expect(calls).toBe(1);
});
it.each(['RESYNC_REQUIRED','AUTHENTICATION_REQUIRED','SCOPE_DENIED','RECORDS_UNAVAILABLE'] as const)('surfaces complete terminal control %s without a cursor or hidden retry',async code=>{
  let calls=0; const endpoint=await fixture(request=>{calls++;headers(request);request.socket.end(`: connected\n\nevent: control\ndata: ${Buffer.from(canonicalBytes({schema_version:1,error:{code}})).toString()}\n\n`);});
  await fails(collect(client(endpoint.origin),await baseline()),code); expect(calls).toBe(1);
});
it('rejects mismatched id, unknown framing, overflow, malformed payload and noncanonical data',async()=>{
  for(const body of [changes().toString().replace(`id: ${page(2).next_cursor}`,'id: AA'),': connected\n\nretry: 1\n\n',': connected\n\n'+ 'x'.repeat(65537),': connected\n\nevent: control\ndata: {"schema_version":1,"error":{"code":"RESYNC_REQUIRED","secret":"'+TOKEN+'"}}\n\n',changes().toString().replace('data: {','data: { ')]){
    const endpoint=await fixture(request=>{headers(request);request.socket.end(body.startsWith(': connected')?body:': connected\n\n'+body);});
    await fails(collect(client(endpoint.origin),await baseline()),'RESPONSE');
  }
});
it('rejects unexpected stream headers, redirects and wrong CA without dispatch fallback',async()=>{
  for(const extra of ['Content-Length: 0\r\n','Transfer-Encoding: chunked\r\n','Content-Encoding: gzip\r\n']){
    const endpoint=await fixture(request=>{headers(request,extra);request.socket.end();}); await fails(collect(client(endpoint.origin),await baseline()),'RESPONSE');
  }
  let calls=0;const endpoint=await fixture(request=>{calls++;headers(request);request.socket.end(': connected\n\n');});
  await fails(collect(client(endpoint.origin,{ca:rootCertificates[0]}),await baseline()),'TRANSPORT'); expect(calls).toBe(0);
  const redirect=await fixture(request=>{request.socket.end(`HTTP/1.0 302 Redirect\r\nLocation: ${endpoint.origin}\r\n\r\n`);});
  await fails(collect(client(redirect.origin),await baseline()),'RESPONSE');expect(calls).toBe(0);
});
it('sanitizes credential failures and rejects header injection without leaking values',async()=>{
  const from=await baseline();
  for(const token of ['',null,42,'bad\r\nOrigin: evil'])await fails(collect(client('https://127.0.0.1:1',{credential:()=>token}),from),'AUTHENTICATION_REQUIRED');
  await fails(collect(client('https://127.0.0.1:1',{credential:()=>{throw Error(TOKEN);}}),from),'AUTHENTICATION_REQUIRED');
});
