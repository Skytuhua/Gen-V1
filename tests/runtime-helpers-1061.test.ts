import {describe,expect,it,vi} from 'vitest';
import {finite,bounded,asyncQueue} from '../packages/runtime-official/internal.ts';
import {createHostTools,hostSystemPrompt} from '../packages/runtime-pi/tool-definitions.ts';

describe('finite',()=>{
 it.each([[3.5,3.5],[0,0]])('returns %o for %o',(input,out)=>expect(finite(input)).toBe(out));
 it.each([NaN,Infinity,-Infinity,-1,'2',null,undefined,{}])('returns null for %o',input=>expect(finite(input)).toBeNull());
});

describe('bounded',()=>{
 it('resolves under the limit and propagates rejection',async()=>{
  await expect(bounded(Promise.resolve('ok'),1000,'t')).resolves.toBe('ok');
  await expect(bounded(Promise.reject(new Error('boom')),1000,'t')).rejects.toThrow('boom');
 });
 it('rejects with the timeout message when the promise stalls',async()=>{
  await expect(bounded(new Promise(()=>{}),10,'worker timeout')).rejects.toThrow('worker timeout');
 });
 it('rejects with the abort reason on a pre-aborted signal',async()=>{
  const controller=new AbortController(),reason=new Error('caller cancelled');
  controller.abort(reason);
  await expect(bounded(Promise.resolve('late'),1000,'worker timeout',controller.signal)).rejects.toBe(reason);
 });
 it('rejects with the abort reason when the signal fires mid-flight',async()=>{
  const controller=new AbortController(),reason=new Error('caller cancelled');
  const pending=bounded(new Promise(()=>{}),1000,'worker timeout',controller.signal);
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
 });
});

describe('asyncQueue',()=>{
 it('yields pushed values in FIFO order and ends on close',async()=>{
  const queue=asyncQueue<number>();queue.push(1);queue.push(2);
  const iterator=queue[Symbol.asyncIterator]();
  await expect(iterator.next()).resolves.toMatchObject({value:1,done:false});
  await expect(iterator.next()).resolves.toMatchObject({value:2,done:false});
  queue.close();
  await expect(iterator.next()).resolves.toMatchObject({done:true});
 });
 it('wakes a waiting consumer when a value is pushed',async()=>{
  const queue=asyncQueue<string>();
  const first=queue[Symbol.asyncIterator]().next();
  queue.push('hello');
  await expect(first).resolves.toMatchObject({value:'hello',done:false});
  queue.close();
 });
 it('discards buffered values on close and rejects later pushes',async()=>{
  const queue=asyncQueue<number>();queue.push(1);queue.close();
  const seen:number[]=[];for await(const v of queue)seen.push(v);
  expect(seen).toEqual([]);
  expect(()=>queue.push(2)).toThrowError(/closed/i);
 });
});

describe('createHostTools',()=>{
 const domain=[{name:'demo_tool',description:'a demo',parameters:{type:'object',properties:{x:{type:'number'}}}}];
 it('wraps domain metadata and returns JSON-serialized tool results',async()=>{
  const call=vi.fn(async()=>({count:2}));
  const tool=createHostTools(domain,call).find(t=>t.name==='demo_tool')!;
  expect(tool.description).toBe('a demo');
  const result=await tool.execute('id1',{x:1},new AbortController().signal) as {content:{text:string}[];details:unknown};
  expect(call).toHaveBeenCalledWith('id1','demo_tool',{x:1},expect.anything());
  expect(JSON.parse(result.content[0].text)).toEqual({count:2});
  expect(result.details).toEqual({count:2});
 });
 for(const [label,bad] of [
  ['uppercase name',[{name:'BadName',description:'d',parameters:{type:'object'}}]],
  ['reserved name',[{name:'bash',description:'d',parameters:{type:'object'}}]],
  ['duplicate name',[{name:'demo_tool',description:'d',parameters:{type:'object'}},{name:'demo_tool',description:'dup',parameters:{type:'object'}}]],
  ['non-object schema',[{name:'demo_tool',description:'d',parameters:{type:'string'}}]],
 ] as const) it(`rejects ${label} tool metadata`,()=>expect(()=>createHostTools(bad as never,async()=>null)).toThrowError(/PI_TOOL_POLICY|Invalid|Zod|object JSON/i));
});

describe('hostSystemPrompt',()=>{
 it('includes saved-memory instructions only when memory is supplied',()=>{
  const plain=hostSystemPrompt();
  expect(plain).not.toContain('Saved thread notes');
  const withMemory=hostSystemPrompt('remember this');
  expect(withMemory).toContain('Saved thread notes');
  expect(withMemory).toContain('remember this');
 });
 it('carries the durable-task and approval policy statements',()=>{
  expect(hostSystemPrompt()).toMatch(/Never invent approval|durable task|ui_discover/);
 });
});
