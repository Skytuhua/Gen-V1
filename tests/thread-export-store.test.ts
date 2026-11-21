import {afterEach, expect, it} from 'vitest';
import {mkdtemp, realpath, lstat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {HarnessError} from '../packages/contracts/index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});
async function fixture() {
  const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'gen-export-store-'));
  const store = new Store(root);
  cleanup.push(async () => {
    store.close();
    if (await realpath(root) !== resolve(root) || !root.startsWith(base + sep) || (await lstat(root)).isSymbolicLink()) throw Error('Unsafe fixture cleanup');
    await rm(root, {recursive: true, force: true, maxRetries: 5});
  });
  return store;
}
const message = (id: string, threadId = 't-a', content = id) => ({id, threadId, role: 'assistant', content, createdAt: '2026-11-06T00:00:00Z', runId: null});

it('returns one chronological timeline across entity kinds', async () => {
  const store = await fixture();
  store.internal('fixture', 't-a', () => {
    store.put('message', 'm-1', 't-a', message('m-1'));
    store.put('dataVersion', 'plan:t-a@1', 't-a', {id: 'plan:t-a', revision: 1, value: {version: 1}});
    store.put('operation', 'op-1', 't-a', {id: 'op-1', kind: 'test'});
    store.put('message', 'm-2', 't-a', message('m-2'));
    store.put('request', 'req-1', 't-a', {id: 'req-1', title: 'q'});
  });
  const timeline = store.timelineFor('t-a', ['message', 'dataVersion', 'operation', 'request']);
  expect(timeline.map(row => row.id)).toEqual(['m-1', 'plan:t-a@1', 'op-1', 'm-2', 'req-1']);
});

it('keeps an upserted row at its original position', async () => {
  const store = await fixture();
  store.internal('fixture', 't-a', () => {
    store.put('message', 'm-1', 't-a', message('m-1', 't-a', 'first'));
    store.put('message', 'm-2', 't-a', message('m-2'));
    store.put('message', 'm-1', 't-a', message('m-1', 't-a', 'updated'));
  });
  const timeline = store.timelineFor('t-a', ['message']);
  expect(timeline.map(row => (row.value as {content: string}).content)).toEqual(['updated', 'm-2']);
});

it('excludes rows owned by other threads and unlisted kinds', async () => {
  const store = await fixture();
  store.internal('fixture', 't-a', () => {
    store.put('message', 'm-a', 't-a', message('m-a', 't-a'));
    store.put('message', 'm-b', 't-b', message('m-b', 't-b'));
    store.put('artifact', 'art-a', 't-a', {id: 'art-a'});
  });
  expect(store.timelineFor('t-a', ['message']).map(row => row.id)).toEqual(['m-a']);
  expect(store.timelineFor('t-b', ['message']).map(row => row.id)).toEqual(['m-b']);
});

it('rejects kind lists outside the allowlist', async () => {
  const cases: readonly string[][] = [
    ['bogus-kind'], ['message; DROP TABLE entities'],
    ['data', 'dataVersion', 'taskMemory', 'userState', 'message', 'operation', 'request', 'artifact', 'resource', 'toolEffect', 'extra'],
    [],
  ];
  const store = await fixture();
  for (const kinds of cases) {
    expect(() => store.timelineFor('t-a', kinds)).toThrowError(HarnessError);
    expect(() => store.timelineFor('t-a', kinds)).toThrowError(expect.objectContaining({code: 'INVALID_INPUT'}));
  }
});
