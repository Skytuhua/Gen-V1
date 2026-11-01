import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/store.ts";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() { const dir = mkdtempSync(join(tmpdir(), "harness-store-")); const store = new Store(dir); cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); }); return store; }
describe("durable command storage", () => {
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
