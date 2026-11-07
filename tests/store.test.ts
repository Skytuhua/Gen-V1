import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/store.ts";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() { const dir = mkdtempSync(join(tmpdir(), "harness-store-")); const store = new Store(dir); cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); }); return store; }
describe("durable command storage", () => {
  it('omits archived thread bodies from global snapshots while retaining them for restore',()=>{
    const store=setup(),large='x'.repeat(1024*1024);
    store.internal('fixture.archived',null,()=>{
      store.put('thread','old',null,{id:'old',title:'Archived task',status:'ready',runId:null});store.put('archivedThread','old',null,true);
      store.put('message','old-message','old',{id:'old-message',threadId:'old',content:large});
      for(const kind of ['artifact','request','userState','data','operation','resource','taskMemory'])store.put(kind,'old-'+kind,'old',{id:'old-'+kind,threadId:'old',bindings:{},basis:[],revision:1,value:'Archived private body',values:{note:'Archived private body'}});
      store.put('usage','old','old',{id:'old',value:{inputTokens:123}});
    });
    const archived=store.snapshot();expect(archived.threads).toEqual([]);expect(archived.archivedThreads?.map(thread=>thread.id)).toEqual(['old']);
    for(const values of [archived.messages,archived.artifacts,archived.requests,archived.userStates,archived.data,archived.operations,archived.resources,archived.memory])expect(values).toEqual([]);
    expect(archived.usage).toEqual({});expect(JSON.stringify(archived).length).toBeLessThan(4096);
    expect(store.get<{content:string}>('message','old-message')?.content).toBe(large);
    store.internal('fixture.restore',null,()=>store.remove('archivedThread','old'));
    const restored=store.snapshot();expect(restored.messages).toMatchObject([{id:'old-message',content:large}]);expect(restored.artifacts).toHaveLength(1);expect(restored.data).toHaveLength(1);expect(restored.usage).toEqual({old:{inputTokens:123}});
  });
  it('retains global entities and a visible child when its parent is archived',()=>{
    const store=setup();store.internal('fixture.child',null,()=>{
      store.put('thread','parent',null,{id:'parent',title:'Parent',status:'ready',runId:null});store.put('archivedThread','parent',null,true);
      store.put('thread','child',null,{id:'child',sideParentId:'parent',title:'Child',status:'ready',runId:null});
      store.put('message','child-message','child',{id:'child-message',threadId:'child',content:'Keep visible child'});
      store.put('data','global',null,{id:'global',revision:1,value:'Global data'});store.put('taskMemory','global-memory',null,{id:'global-memory',note:'Global note'});
      store.put('artifact','child-artifact','child',{id:'child-artifact',bindings:{source:{mode:'snapshot',ref:{id:'parent-source',revision:1}}}});
      store.put('data','parent-source','parent',{id:'parent-source',revision:2,value:'Unreferenced archived current value'});store.put('dataVersion','parent-source@1','parent',{id:'parent-source',revision:1,value:'Explicitly pinned child source'});
    });
    const snapshot=store.snapshot();expect(snapshot.threads.map(thread=>thread.id)).toEqual(['child']);expect(snapshot.messages).toMatchObject([{id:'child-message'}]);expect(snapshot.data).toEqual([{id:'global',revision:1,value:'Global data'},{id:'parent-source',revision:1,value:'Explicitly pinned child source'}]);expect(snapshot.memory).toMatchObject([{id:'global-memory'}]);
  });
  it('keeps snapshot query counts constant as threads grow while preserving archived content and pinned versions', () => {
    const store = setup();
    const thread = (id: string) => ({ id, title: id, status: 'ready', runId: null });
    store.internal('fixture', null, () => {
      store.put('thread', 'visible', null, thread('visible')); store.put('thread', 'archived', null, thread('archived'));
      store.put('archivedThread', 'archived', null, true); store.put('archivedThread', 'visible', null, false);
      store.put('message', 'retained', 'archived', { id: 'retained', content: 'Keep archived history' });
      store.put('artifact', 'artifact', 'visible', { bindings: { source: { mode: 'snapshot', ref: { id: 'source', revision: 1 } } } });
      store.put('data', 'source', 'visible', { id: 'source', revision: 2, value: 'current' });
      store.put('dataVersion', 'source@1', 'visible', { id: 'source', revision: 1, value: 'pinned' });
    });
    const queries = vi.spyOn(store.db, 'prepare');
    const first = store.snapshot(), count = queries.mock.calls.length;
    store.internal('more-threads', null, () => { for (let n = 0; n < 100; n++) store.put('thread', `thread-${n}`, null, thread(`thread-${n}`)); });
    queries.mockClear(); const next = store.snapshot();
    expect(queries.mock.calls.length).toBe(count); expect(count).toBeLessThanOrEqual(20);
    expect(first.threads.map(item => item.id)).toEqual(['visible']); expect(first.archivedThreads?.map(item => item.id)).toEqual(['archived']);
    expect(next.threads).toHaveLength(101); expect(next.messages).toEqual(first.messages);
    expect(next.data).toEqual(first.data); expect(next.data.map(item => item.value)).toEqual(['current', 'pinned']);
    queries.mockRestore();
  });
  it("commits internal state and events atomically without creating retry receipts", () => {
    const store=setup(),seen:unknown[]=[];
    store.subscribe(event=>seen.push({event,value:store.get("sample","internal")}));
    store.internal("runtime.progress",null,()=>{store.put("sample","internal",null,{value:1});return {progress:1};});
    expect(store.eventsAfter(0)).toHaveLength(1);expect(seen).toMatchObject([{event:{type:"runtime.progress"},value:{value:1}}]);
    expect(store.db.prepare("SELECT count(*) AS n FROM receipts").get()).toEqual({n:0});
    expect(()=>store.internal("runtime.failed",null,()=>{store.put("sample","internal",null,{value:2});throw new Error("rollback");})).toThrow("rollback");
    expect(store.get("sample","internal")).toEqual({value:1});expect(store.eventsAfter(0)).toHaveLength(1);
  });
  it("deduplicates identical commands and rejects changed content under an existing ID", () => {
    const store = setup(); let calls = 0;
    const command = { id: "same", type: "test", payload: { value: 1 } };
    const first = store.command(command, () => { calls++; store.put("sample", "one", null, { value: 1 }); return "accepted"; });
    expect(store.command(command, () => { calls++; return "duplicate"; })).toEqual(first);
    expect(calls).toBe(1); expect(store.eventsAfter(0)).toHaveLength(1);
    expect(() => store.command({ ...command, payload: { value: 2 } }, () => null)).toThrow(/reused/i);
  });
  it("delivers reentrant committed events in sequence order to every subscriber", () => {
    const store = setup(), seenA: { seq: number; type: string }[] = [], seenB: { seq: number; type: string }[] = [];
    const delivery: string[] = [];
    let innerReceipt: ReturnType<Store['command']> | undefined;
    store.subscribe(event => {
      seenA.push({ seq: event.seq, type: event.type }); delivery.push(`A:${event.seq}`);
      if (event.type === 'outer') {
        innerReceipt = store.command({ id: 'inner', type: 'inner', payload: {} }, () => 'inner result');
        delivery.push(`receipt:${innerReceipt.eventSeq}`);
      }
    });
    store.subscribe(event => { seenB.push({ seq: event.seq, type: event.type }); delivery.push(`B:${event.seq}`); });

    const outerReceipt = store.command({ id: 'outer', type: 'outer', payload: {} }, () => 'outer result');
    delivery.push('returned');

    const expected = [{ seq: 1, type: 'outer' }, { seq: 2, type: 'inner' }];
    expect(seenB).toEqual(expected); expect(seenA).toEqual(expected);
    expect(innerReceipt).toEqual({ commandId: 'inner', eventSeq: 2, result: 'inner result' });
    expect(outerReceipt).toEqual({ commandId: 'outer', eventSeq: 1, result: 'outer result' });
    expect(delivery).toEqual(['A:1', 'receipt:2', 'B:1', 'A:2', 'B:2', 'returned']);
  });
  it("continues FIFO delivery after a subscriber commits and throws", () => {
    const store = setup(), seenA: number[] = [], seenB: number[] = [], seenC: number[] = [];
    const innerCommand = { id: 'inner', type: 'inner', payload: {} };
    let failure: unknown, innerReceipt: ReturnType<Store['command']> | undefined, replay: ReturnType<Store['command']> | undefined, replayApplied = false;
    store.subscribe(event => {
      seenA.push(event.seq);
      if (event.type !== 'outer') return;
      try {
        store.internal('failed', null, () => {
          store.put('sample', 'rolled-back', null, { value: 'discarded' });
          store.internal('nested', null, () => 'must not commit');
        });
      } catch (error) { failure = error; }
      innerReceipt = store.command(innerCommand, () => { store.put('sample', 'inner', null, { value: 'inner' }); return 'inner result'; });
      replay = store.command(innerCommand, () => { replayApplied = true; return 'must not apply'; });
      throw new Error('subscriber failure');
    });
    store.subscribe(event => seenB.push(event.seq));
    store.subscribe(event => seenC.push(event.seq));

    const outerReceipt = store.command({ id: 'outer', type: 'outer', payload: {} }, () => {
      store.put('sample', 'outer', null, { value: 'outer' }); return 'outer result';
    });

    expect(seenB).toEqual([1, 2]); expect(seenC).toEqual([1, 2]); expect(seenA).toEqual([1, 2]);
    expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toBe('Nested command transaction');
    expect(store.get('sample', 'rolled-back')).toBeNull();
    expect(store.get('sample', 'outer')).toEqual({ value: 'outer' }); expect(store.get('sample', 'inner')).toEqual({ value: 'inner' });
    expect(store.eventsAfter(0).map(event => ({ seq: event.seq, type: event.type }))).toEqual([{ seq: 1, type: 'outer' }, { seq: 2, type: 'inner' }]);
    expect(outerReceipt).toEqual({ commandId: 'outer', eventSeq: 1, result: 'outer result' });
    expect(innerReceipt).toEqual({ commandId: 'inner', eventSeq: 2, result: 'inner result' });
    expect(replay).toEqual(innerReceipt); expect(replayApplied).toBe(false);
    expect(store.receipt({ id: 'outer', type: 'outer', payload: {} })).toEqual(outerReceipt);
    expect(store.receipt(innerCommand)).toEqual(innerReceipt);

    expect(store.internal('later', null, () => 'later result')).toBe('later result');
    expect(seenA).toEqual([1, 2, 3]); expect(seenB).toEqual([1, 2, 3]); expect(seenC).toEqual([1, 2, 3]);
    expect(store.eventsAfter(0).map(event => event.type)).toEqual(['outer', 'inner', 'later']);
  });
  it("rolls back projection and event together on failure", () => {
    const store = setup();
    expect(() => store.command({ id: "bad", type: "test", payload: {} }, () => { store.put("sample", "one", null, { value: 1 }); throw new Error("rollback"); })).toThrow("rollback");
    expect(store.get("sample", "one")).toBeNull(); expect(store.eventsAfter(0)).toEqual([]);
  });
  it("persists monotonic committed event sequences across reopening", () => {
    const store = setup();
    for (const id of ["a", "b"]) store.command({ id, type: "test", payload: {} }, () => id);
    expect(store.eventsAfter(0).map(e => e.seq)).toEqual([1, 2]);
    const seen: number[] = []; store.subscribe(e => seen.push(e.seq));
    store.command({ id: "c", type: "test", payload: {} }, () => null);
    expect(seen).toEqual([3]);
  });
});
