import {describe,expect,it} from 'vitest';
import type {Snapshot,Thread} from '../packages/contracts';
import {PLANNING_PROVENANCE,planDataId} from '../packages/contracts/planning';
import {selectPlanRecord,createPlanVisibility} from '../apps/web/src/plan-visibility';

const thread={id:'thread-a',epoch:1,runId:'run-a'} as Thread;
const value={version:1,title:'Checkout repair',steps:[{id:'tests',title:'Run checkout tests',status:'pending',requirements:[]}],agents:[]};
const row={id:planDataId(thread.id),threadId:thread.id,provenance:PLANNING_PROVENANCE,revision:1,createdAt:'2026-11-01T00:00:00Z',value};
const snapshot=(rows:unknown[])=>({data:rows} as Snapshot);

describe('plan selection and automatic opening',()=>{
 it('selects the newest exact same-thread trusted record and fails closed on invalid latest data',()=>{
  expect(selectPlanRecord(snapshot([{...row,threadId:'other'}, {...row,provenance:'untrusted'}]),thread.id)).toBeUndefined();
  expect(selectPlanRecord(snapshot([row]),thread.id)?.plan?.title).toBe('Checkout repair');
  expect(selectPlanRecord(snapshot([row,{...row,revision:2,value:{...value,steps:[{...value.steps[0],agentIds:['missing']} ]}}]),thread.id)?.plan).toBeNull();
  expect(selectPlanRecord(snapshot([{...row,value:{...value,steps:Array(25).fill(value.steps[0])}}]),thread.id)?.plan).toBeNull();
 });
 it('opens once when substantive valid data appears, never on subsequent progress after dismissal',()=>{
  const visibility=createPlanVisibility();
  expect(visibility.observe(thread,undefined)).toBe(false);
  expect(visibility.observe(thread,selectPlanRecord(snapshot([row]),thread.id))).toBe(true);
  visibility.dismiss(thread);
  expect(visibility.observe(thread,selectPlanRecord(snapshot([{...row,revision:2}]),thread.id))).toBe(false);
  expect(visibility.observe({...thread,runId:null},selectPlanRecord(snapshot([{...row,revision:3}]),thread.id))).toBe(false);
 });
 it('waits for fresh plan publication in the next run and does not mistake stale data for it',()=>{
  const visibility=createPlanVisibility(),selected=selectPlanRecord(snapshot([row]),thread.id);
  expect(visibility.observe(thread,selected)).toBe(true);visibility.dismiss(thread);
  const next={...thread,epoch:2,runId:'run-b'};
  expect(visibility.observe(next,selected)).toBe(false);
  expect(visibility.observe(next,selectPlanRecord(snapshot([{...row,revision:2}]),thread.id))).toBe(true);
  expect(visibility.observe(next,selectPlanRecord(snapshot([{...row,revision:3}]),thread.id))).toBe(false);
 });
 it('ignores empty and malformed plans until a valid substantive record appears',()=>{
  const visibility=createPlanVisibility();
  expect(visibility.observe(thread,selectPlanRecord(snapshot([{...row,value:{...value,steps:[]}}]),thread.id))).toBe(false);
  expect(visibility.observe(thread,selectPlanRecord(snapshot([{...row,value:{version:1}}]),thread.id))).toBe(false);
  expect(visibility.observe(thread,selectPlanRecord(snapshot([row]),thread.id))).toBe(true);
 });
 it('persists dismissal across reload, bounds storage, and waits for new-run publication after reload',()=>{
  const saved=new Map<string,string>(),storage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value);}};
  const selected=selectPlanRecord(snapshot([row]),thread.id),visibility=createPlanVisibility(storage);
  expect(visibility.observe(thread,selected)).toBe(true);visibility.dismiss(thread);
  expect(createPlanVisibility(storage).observe(thread,{...selected!,revision:2})).toBe(false);
  expect(createPlanVisibility(storage).observe({...thread,runId:null},selected)).toBe(false);
  const next=createPlanVisibility(storage),nextThread={...thread,runId:'run-b',epoch:2};
  expect(next.observe(nextThread,selected)).toBe(false);expect(next.observe(nextThread,{...selected!,revision:2})).toBe(true);
  for(let index=0;index<40;index++)visibility.dismiss({...thread,id:`thread-${index}`});
  expect(JSON.parse([...saved.values()][0])).toHaveLength(32);
 });
});
