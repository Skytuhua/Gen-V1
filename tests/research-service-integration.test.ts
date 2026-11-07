import {afterEach, expect, it} from 'vitest';
import {buildServer} from '../apps/server/server.ts';
import {Service} from '../packages/core/service.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';
import type {VerifiedBrowserCaptureProvider} from '../packages/research/capture.ts';
import {abcHash, command, context, researchFixture, textSource} from './research-fixture.ts';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close();});
async function fixture(browser?: VerifiedBrowserCaptureProvider) {
  const f = await researchFixture();
  const runtime: RuntimeAdapter = {configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(f.store, runtime, {researchBrowserCapture: browser}), app = await buildServer(service, {port: 4317, dev: false});
  cleanups.push(async () => {await app.close(); await service.dispose(); await f.close();});
  const boot = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4317'}});
  const headers = {host: '127.0.0.1:4317', cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  return {...f, service, app, headers};
}
it('composes actual Service.command and protected routes without a direct HTTP Store writer', async () => {
  const f = await fixture(), c = textSource(); c.payload.title = '  Exact title  ';
  const saved = await f.app.inject({method: 'POST', url: '/api/commands', headers: f.headers, payload: c});
  expect(saved.statusCode).toBe(200); expect(saved.json().result).toMatchObject({revision: 1, sha256: abcHash});
  const replay = await f.app.inject({method: 'POST', url: '/api/research/commands', headers: f.headers, payload: c});
  expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual(saved.json());
  const source = await f.app.inject({url: '/api/research/sources/source-a?authority=personal&threadId=thread-a&projectId=project-a&revision=1', headers: f.headers});
  expect(source.statusCode).toBe(200); expect(source.json().sha256).toBe(abcHash);
  f.store.internal('rebind', null, () => f.store.put('thread', context.threadId, context.threadId, {...f.thread, projectId: 'other'}));
  const denied = await f.app.inject({method: 'POST', url: '/api/commands', headers: f.headers, payload: c});
  expect(denied.statusCode).toBe(403);
});
it('holds update admission for a pending capture and rejects persistence after a host freeze', async () => {
  let resume!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => {resume = resolve;}), ready = new Promise<void>(resolve => {entered = resolve;});
  const browser: VerifiedBrowserCaptureProvider = {authority: {kind: 'personal'}, async withCapture(_input, _signal, consume) {
    entered(); await paused;
    return consume({browserId: 'b', navigationId: 'n', authorizationId: 'capture', url: 'https://example.invalid', bytes: Buffer.from('abc'), assertCurrent() {}});
  }};
  const f = await fixture(browser), seq = f.store.sequence;
  const pending = f.service.command(command('pending-capture', 'source.capture', {sourceId: 'pending', expectedRevision: 0, title: 'Pending', input: {kind: 'browser', browserId: 'b', navigationId: 'n'}})).then(result => ({ok: true, result}), error => ({ok: false, error}));
  await ready; const idle = f.service.isUpdateIdle(), freeze = f.service.freezeForUpdate(); resume(); const result = await pending;
  expect({idle, freeze, result, sequence: f.store.sequence}).toMatchObject({idle: false, freeze: false, result: {ok: false, error: {code: 'HOST_CLOSING'}}, sequence: seq});
});
it('keeps browser capture unavailable and rejects Company and delegated writes through actual host commands', async () => {
  const f = await fixture(), base = command('browser', 'source.capture', {sourceId: 'browser-source', expectedRevision: 0, title: 'Browser', input: {kind: 'browser', browserId: 'b', navigationId: 'n'}});
  await expect(f.service.command(base)).rejects.toMatchObject({code: 'CAPABILITY_UNAVAILABLE'});
  await expect(f.service.command({...base, id: 'company', payload: {...base.payload, authority: {kind: 'company', companyId: 'private'}}})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  f.store.internal('delegate', null, () => f.store.put('thread', context.threadId, context.threadId, {...f.thread, kind: 'delegate'}));
  await expect(f.service.command(textSource('delegate'))).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});
it('aborts a pending Research capture before waiting for host shutdown', async () => {
  let entered!: () => void, release!: () => void, captureSignal: AbortSignal | undefined;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  const browser: VerifiedBrowserCaptureProvider = {authority: {kind: 'personal'}, async withCapture(_input, signal, consume) {
    captureSignal = signal;
    await new Promise<void>((resolve, reject) => {
      release = resolve;
      signal.addEventListener('abort', () => reject(signal.reason), {once: true});
      entered();
    });
    return consume({browserId: 'b', navigationId: 'n', authorizationId: 'capture', url: 'https://example.invalid', bytes: Buffer.from('abc'), assertCurrent() {}});
  }};
  const f = await fixture(browser), sequence = f.store.sequence;
  const capture = f.service.command(command('shutdown-capture', 'source.capture', {sourceId: 'shutdown', expectedRevision: 0, title: 'Pending', input: {kind: 'browser', browserId: 'b', navigationId: 'n'}}));
  const result = capture.then(() => 'committed', () => 'rejected');
  await ready;
  const closing = f.service.dispose();
  try {expect(captureSignal?.aborted).toBe(true);}
  finally {release(); await closing;}
  expect(await result).toBe('rejected');
  expect(f.store.sequence).toBe(sequence);
});
