import { expect, it } from 'vitest';
import { discoverCapabilities } from '../packages/core/discovery';
import { inspectTask } from '../packages/core/task-inspection';
import { Store } from '../packages/storage/store';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('prefers an exact component name over mentions inside unrelated descriptions',async()=>{
 const detail=await discoverCapabilities({query:'Comparison',details:true});
 expect(detail.components.map(item=>item.name)).toEqual(['Comparison']);
 expect(detail.domainTools).toEqual([]);
 expect(detail.total).toBe(1);
 expect(Object.keys(detail.everyday!.dataSchemas)).toEqual(['Comparison']);
});
it('pages an explicit list of component names without unrelated packs or tools',async()=>{
 const query='Stack, Tabs Timeline Markdown Disclosure';
 const first=await discoverCapabilities({query,details:true,limit:2});
 const second=await discoverCapabilities({query,details:true,limit:2,offset:2});
 const third=await discoverCapabilities({query,details:true,limit:2,offset:4});
 expect([...first.components,...second.components,...third.components].map(item=>item.name).sort()).toEqual(['Disclosure','Markdown','Stack','Tabs','Timeline']);
 expect(first.total).toBe(5);expect(first.nextOffset).toBe(2);expect(second.nextOffset).toBe(4);expect(third.nextOffset).toBeUndefined();
 expect(first.domainTools).toEqual([]);
 expect(JSON.stringify(first)).not.toContain('dataSchemas');
});
it('returns only the source contract requested by an exact timing-view lookup',async()=>{
 const detail=await discoverCapabilities({query:'TraceWaterfall',details:true});
 expect(detail.components.map(item=>item.name)).toEqual(['TraceWaterfall']);
 expect(Object.keys(detail.workObjects!.dataSchemas)).toEqual(['TraceWaterfall']);
 expect((await discoverCapabilities({query:'latency'})).components.map(item=>item.name)).toContain('TraceWaterfall');
});
it('keeps data contracts on their exact-name list page, including empty pages',async()=>{
 const first=await discoverCapabilities({query:'TraceWaterfall Stack',details:true,limit:1});
 const second=await discoverCapabilities({query:'TraceWaterfall Stack',details:true,limit:1,offset:1});
 expect(first.components.map(item=>item.name)).toEqual(['TraceWaterfall']);
 expect(first.workObjects).toBeDefined();
 expect(second.components.map(item=>item.name)).toEqual(['Stack']);
 expect(second).not.toHaveProperty('workObjects');
 const empty=await discoverCapabilities({query:'Comparison',details:true,offset:1});
 expect(empty.components).toEqual([]);expect(empty).not.toHaveProperty('everyday');
});

it('pages detail schemas instead of repeating every capability pack', async () => {
  const index = await discoverCapabilities({});
  expect(index.components.some(item => item.name === 'DocumentPreview')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(index))).toBeLessThan(16000);
  expect(JSON.stringify(index)).not.toContain('dataSchemas');
  const first = await discoverCapabilities({ details: true, limit: 3 });
  expect(first.components.length + first.domainTools.length).toBe(3);
  expect(first.nextOffset).toBe(3);
  const second = await discoverCapabilities({ details: true, limit: 3, offset: first.nextOffset });
  expect(second.components.map(c => c.name)).not.toEqual(first.components.map(c => c.name));
  const specific = await discoverCapabilities({ query: 'DocumentPreview', details: true });
  expect(specific.components).toHaveLength(1);
  expect(specific.components[0]).toHaveProperty('props');
});
it.each([
 ['ApiExplorer','softwareDevelopment'],['Pipeline','softwareDevelopment'],
 ['ReviewQueue','interactions'],['EditableTable','interactions'],
])('retrieves the source contract with an exact %s component query',async(name,pack)=>{
 const detail=await discoverCapabilities({query:name,details:true});
 expect(detail.components).toHaveLength(1);
 expect(detail).toHaveProperty(`${pack}.dataSchemas.${name}`);
 const index=await discoverCapabilities({query:name});
 expect(index).not.toHaveProperty(pack);
});
it('never constructs a workspace snapshot or leaks another thread during inspection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-inspection-')); const store = new Store(dir);
  try {
    store.internal('fixture', 'mine', () => { for (let n = 0; n < 70; n++) { store.put('operation', `mine${n}`, 'mine', { id: `mine${n}`, threadId: 'mine', status: 'succeeded', description: 'Check '+n, result: 'x'.repeat(100000) }); store.put('resource', `r${n}`, 'mine', { id: `r${n}`, threadId: 'mine', path: 'x'.repeat(1000), label: 'source'+n, writable: false }); } store.put('userState', 'foreign', 'other', { id: 'foreign', threadId: 'other', values: { secret: 'OTHER_THREAD_SENTINEL' } }); });
    store.snapshot = () => { throw new Error('Full snapshots are forbidden for task inspection'); };
    const read = store.all.bind(store); store.all = (kind, id) => { if (['operation', 'artifact', 'data', 'userState'].includes(kind)) throw new Error('Do not deserialize full payloads for metadata'); return read(kind, id); };
    const summary = inspectTask(store, { id: 'mine' } as never, undefined, {});
    expect(JSON.stringify(summary)).not.toContain('OTHER_THREAD_SENTINEL');
    expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(8192);
    expect(summary).toHaveProperty('truncated');
    expect(summary).toHaveProperty('counts.operations', 70);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
it('recovers exact source and plan values after compaction with revision-pinned pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-source-inspection-')); const store = new Store(dir);
  try {
    const data = { id: 'comparison', threadId: 'mine', revision: 1, provenance: 'source:fixture', createdAt: '', value: { rows: [{ label: 'Orion', price: 140 }, { label: 'Lyra', price: 95 }] } };
    store.internal('fixture', 'mine', () => { store.put('data', data.id, 'mine', data); store.put('dataVersion', data.id + '@1', 'mine', data); store.put('data', 'plan:mine', 'mine', { ...data, id: 'plan:mine', value: { steps: Array.from({ length: 100 }, (_, id) => ({ id: String(id), title: 'Preserve '+id, description: 'x'.repeat(1000) })) } }); store.put('data', 'text', 'mine', { ...data, id: 'text', value: { text: 'x'.repeat(9000)+'TAIL_SENTINEL' } }); });
    const read = (args: Record<string, unknown>, id = 'mine') => inspectTask(store, { id } as never, undefined, args);
    const first = read({ dataId: 'comparison', revision: 1, pointer: '/rows', limit: 1 }); expect(first).toMatchObject({ revision: 1, value: [{ label: 'Orion', price: 140 }], nextOffset: 1 });
    expect(read({ dataId: 'comparison', revision: 1, pointer: '/rows', offset: 1 })).toHaveProperty('value', [{ label: 'Lyra', price: 95 }]);
    expect(Buffer.byteLength(JSON.stringify(read({ dataId: 'plan:mine', pointer: '/steps' })))).toBeLessThan(8192);
    expect(read({ dataId: 'text', pointer: '/text', offset: 9000, limit: 100 })).toMatchObject({ value: 'TAIL_SENTINEL', units: 'UTF-16 code units' });
    expect(() => read({ dataId: 'comparison' }, 'other')).toThrow('unavailable');
    expect(() => read({ dataId: 'comparison', pointer: '/__proto__' })).toThrow('unavailable');
    expect(() => read({ dataId: 'comparison', revision: 2 })).toThrow('unavailable');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
