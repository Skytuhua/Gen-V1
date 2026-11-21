import {describe,expect,it,vi} from 'vitest';
import {withTimeout} from '../apps/web/src/with-timeout';

describe('withTimeout',()=>{
 it('resolves with the wrapped value',async()=>{
  await expect(withTimeout(Promise.resolve('ok'),50)).resolves.toBe('ok');
 });
 it('rejects with the wrapped failure before the deadline',async()=>{
  await expect(withTimeout(Promise.reject(new Error('load broke')),50)).rejects.toThrow('load broke');
 });
 it('rejects with settings-load-timeout when the promise never settles',async()=>{
  const start=Date.now();
  await expect(withTimeout(new Promise(()=>{}),30)).rejects.toThrow('settings-load-timeout');
  expect(Date.now()-start).toBeLessThan(5000);
 });
 it('clears its timer once the promise settles',async()=>{
  vi.useFakeTimers();
  try{
   await withTimeout(Promise.resolve('done'),1000);
   expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();}
 });
 it('rejects and clears the timer when cancelled via signal',async()=>{
  const controller=new AbortController();
  const pending=withTimeout(new Promise(()=>{}),60_000,controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow('settings-load-cancelled');
 });
});

describe('settings load state machine',()=>{
 // Mirrors ScopedSettings.refresh + the three lazy-import sites: load -> timeout error -> retry -> outcome.
 const refresh=async(load:()=>Promise<unknown>)=>{
  try{return{data:await withTimeout(load(),30),error:''};}
  catch(cause){return{data:undefined,error:cause instanceof Error?cause.message:'Settings could not load.'};}
 };
 it('load -> error -> retry -> success',async()=>{
  const hung=()=>new Promise(()=>{});
  const first=await refresh(hung);
  expect(first.error).toBe('settings-load-timeout');expect(first.data).toBeUndefined();
  const second=await refresh(()=>Promise.resolve({settings:{}}));
  expect(second.error).toBe('');expect(second.data).toEqual({settings:{}});
 });
 it('load -> error -> retry -> error returns the identical state',async()=>{
  const first=await refresh(()=>new Promise(()=>{}));
  const second=await refresh(()=>new Promise(()=>{}));
  expect(second).toEqual(first);
 });
});
