import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/store.ts";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function setup() { const dir = mkdtempSync(join(tmpdir(), "harness-store-")); const store = new Store(dir); cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); }); return store; }
describe("durable command storage", () => {
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
