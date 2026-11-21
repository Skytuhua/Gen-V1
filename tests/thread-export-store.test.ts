import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/store.ts";
import { HarnessError } from "../packages/contracts/index.ts";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() { const dir = mkdtempSync(join(tmpdir(), "harness-thread-export-")); const store = new Store(dir); cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); }); return store; }

const KINDS = ['message', 'dataVersion', 'operation', 'request', 'artifact', 'resource', 'toolEffect'] as const;

describe('thread export timeline reads', () => {
  it('returns every requested kind in one interleaved insertion order for the thread only', () => {
    const store = setup();
    store.internal('fixture', null, () => {
      store.put('message', 'a-1', 'a', { id: 'a-1', threadId: 'a', content: 'first' });
      store.put('dataVersion', 'plan:a@1', 'a', { id: 'plan:a', revision: 1, value: { title: 'v1' } });
      store.put('message', 'b-1', 'b', { id: 'b-1', threadId: 'b', content: 'other thread' });
      store.put('operation', 'op-1', 'a', { id: 'op-1', kind: 'bash', status: 'completed' });
      store.put('message', 'a-2', 'a', { id: 'a-2', threadId: 'a', content: 'second' });
      store.put('request', 'req-1', 'a', { id: 'req-1', title: 'Pick', status: 'answered' });
      store.put('artifact', 'art-1', 'a', { id: 'art-1', kind: 'widget', title: 'Chart' });
      store.put('resource', 'res-1', 'a', { id: 'res-1', kind: 'attachment', label: 'note', path: '/tmp/note.txt' });
      store.put('toolEffect', 'fx-1', 'a', { effectId: 'fx-1', toolId: 'bash', state: 'SUCCEEDED' });
      store.put('taskMemory', 'mem-1', 'a', { id: 'mem-1', note: 'not a timeline kind' });
    });
    const rows = store.timelineFor('a', KINDS);
    expect(rows.map(row => row.kind)).toEqual(['message', 'dataVersion', 'operation', 'message', 'request', 'artifact', 'resource', 'toolEffect']);
    expect(rows.map(row => (row.value as { id?: string; effectId?: string }).id ?? (row.value as { effectId?: string }).effectId)).toEqual(['a-1', 'plan:a', 'op-1', 'a-2', 'req-1', 'art-1', 'res-1', 'fx-1']);
  });

  it('keeps an upserted message at its original insertion position', () => {
    const store = setup();
    store.internal('fixture', null, () => {
      store.put('message', 'm-1', 'a', { id: 'm-1', threadId: 'a', content: 'draft' });
      store.put('message', 'm-2', 'a', { id: 'm-2', threadId: 'a', content: 'later' });
      store.put('message', 'm-1', 'a', { id: 'm-1', threadId: 'a', content: 'edited' });
    });
    const rows = store.timelineFor('a', ['message']);
    expect(rows.map(row => (row.value as { id: string }).id)).toEqual(['m-1', 'm-2']);
    expect((rows[0]?.value as { content: string }).content).toBe('edited');
  });

  it('honors kind subsets and repeated kinds without changing results', () => {
    const store = setup();
    store.internal('fixture', null, () => {
      store.put('message', 'm-1', 'a', { id: 'm-1', content: 'one' });
      store.put('operation', 'op-1', 'a', { id: 'op-1' });
      store.put('message', 'm-2', 'a', { id: 'm-2', content: 'two' });
    });
    expect(store.timelineFor('a', ['message']).map(row => row.kind)).toEqual(['message', 'message']);
    expect(store.timelineFor('a', ['message', 'operation', 'message'])).toHaveLength(3);
  });

  it('rejects unknown kinds, empty lists and SQL-shaped input without touching the store', () => {
    const store = setup();
    const before = store.sequence;
    for (const kinds of [[], ['bogus'], ['message', "message'); DROP TABLE entities;--"], ['taskMemory']]) {
      try { store.timelineFor('a', kinds); expect.unreachable(`accepted ${JSON.stringify(kinds)}`); }
      catch (error) { expect(error).toBeInstanceOf(HarnessError); expect((error as HarnessError).code).toBe('INVALID_INPUT'); }
    }
    expect(store.sequence).toBe(before);
  });

  it('is read-only: a timeline read never advances the event sequence', () => {
    const store = setup();
    store.internal('fixture', null, () => store.put('message', 'm-1', 'a', { id: 'm-1', content: 'x' }));
    const before = store.sequence;
    store.timelineFor('a', KINDS);
    store.timelineFor('a', KINDS);
    expect(store.sequence).toBe(before);
  });
});
