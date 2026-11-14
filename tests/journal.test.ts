import {afterEach, expect, it, vi} from 'vitest';
import type {JournalRecord} from '../apps/web/src/journal';

afterEach(() => {vi.unstubAllGlobals(); vi.resetModules();});

function fakeOpenRequest(record: JournalRecord<string>) {
 const get = vi.fn(() => {
  const request: {result: JournalRecord<string>; onsuccess?: () => void} = {result: record};
  queueMicrotask(() => request.onsuccess?.());
  return request;
 });
 const objectStore = vi.fn(() => ({get}));
 const transaction = vi.fn(() => ({objectStore}));
 const request: {result: {transaction: typeof transaction}; onsuccess?: () => void} = {result: {transaction}};
 return {request, transaction, objectStore, get};
}

it('retries a synchronous IndexedDB open failure on the same journal module', async () => {
 const failure = new Error('IndexedDB temporarily unavailable');
 const record = {value: 'recovered draft', updatedAt: 1, generation: 'draft-generation'};
 const db = fakeOpenRequest(record);
 const open = vi.fn().mockImplementationOnce(() => {throw failure;}).mockReturnValue(db.request);
 vi.stubGlobal('indexedDB', {open});
 const {journalReadRecord} = await import('../apps/web/src/journal');

 await expect(journalReadRecord('draft:example')).rejects.toBe(failure);
 const retry = journalReadRecord<string>('draft:example');
 db.request.onsuccess?.();
 await expect(retry).resolves.toEqual(record);
 expect(open).toHaveBeenCalledTimes(2);
 expect(open).toHaveBeenLastCalledWith('generative-harness-journal', 1);
 expect(db.transaction).toHaveBeenCalledWith('entries');
 expect(db.objectStore).toHaveBeenCalledWith('entries');
 expect(db.get).toHaveBeenCalledWith('draft:example');
});

it('retries an asynchronous IndexedDB open failure on the same journal module', async () => {
 const failure = new Error('IndexedDB open failed');
 const failedRequest: {error: Error; onerror?: () => void} = {error: failure};
 const record = {value: 'recovered draft', updatedAt: 1, generation: 'draft-generation'};
 const db = fakeOpenRequest(record);
 const open = vi.fn().mockReturnValueOnce(failedRequest).mockReturnValue(db.request);
 vi.stubGlobal('indexedDB', {open});
 const {journalReadRecord} = await import('../apps/web/src/journal');

 const failedRead = expect(journalReadRecord('draft:example')).rejects.toBe(failure);
 failedRequest.onerror?.();
 await failedRead;
 const retry = journalReadRecord<string>('draft:example');
 db.request.onsuccess?.();
 await expect(retry).resolves.toEqual(record);
 expect(open).toHaveBeenCalledTimes(2);
});

it('shares an in-flight open and retains a successful database for later reads', async () => {
 const record = {value: 'saved draft', updatedAt: 1, generation: 'draft-generation'};
 const db = fakeOpenRequest(record);
 const open = vi.fn().mockReturnValue(db.request);
 vi.stubGlobal('indexedDB', {open});
 const {journalReadRecord} = await import('../apps/web/src/journal');

 const first = journalReadRecord<string>('draft:first');
 const second = journalReadRecord<string>('draft:second');
 expect(open).toHaveBeenCalledTimes(1);
 db.request.onsuccess?.();
 await expect(Promise.all([first, second])).resolves.toEqual([record, record]);
 await expect(journalReadRecord<string>('draft:third')).resolves.toEqual(record);
 expect(open).toHaveBeenCalledTimes(1);
 expect(db.get.mock.calls).toEqual([['draft:first'], ['draft:second'], ['draft:third']]);
});

function atomicDatabase(fail=false){
 const rows=new Map<string,JournalRecord>(),request:{result:unknown;onsuccess?:()=>void}={result:null};
 const database={transaction:()=>{
  let pending=0,aborted=false;const staged=new Map<string,JournalRecord>();
  const tx={error:new Error('Atomic transaction aborted'),oncomplete:undefined as undefined|(()=>void),onabort:undefined as undefined|(()=>void),onerror:undefined as undefined|(()=>void),abort:()=>{aborted=true;},objectStore:()=>({
   get:(key:string)=>{pending++;const read:{result:JournalRecord|undefined;onsuccess?:()=>void}={result:rows.get(key)};queueMicrotask(()=>{read.onsuccess?.();if(--pending===0)queueMicrotask(()=>{if(aborted)tx.onabort?.();else{for(const [key,value]of staged)rows.set(key,value);tx.oncomplete?.();}});});return read;},
   put:(record:JournalRecord,key:string)=>{if(fail&&staged.size){aborted=true;throw tx.error;}staged.set(key,record);},
  })};return tx;
 }};request.result=database;vi.stubGlobal('indexedDB',{open:()=>{queueMicrotask(()=>request.onsuccess?.());return request;}});return rows;
}
it('commits multiple CAS records atomically and publishes only committed values',async()=>{
 const rows=atomicDatabase();const journal=await import('../apps/web/src/journal');const seen:unknown[]=[],keys:string[]=[];journal.journalSubscribe('active',value=>seen.push(value));const stop=journal.journalSubscribeEntries(key=>keys.push(key));
 expect(await journal.journalCompareAndSwapMany([{key:'active',generation:undefined,value:'restored'},{key:'library',generation:undefined,value:'backup'}])).toBe(true);
 expect(rows.get('active')?.value).toBe('restored');expect(rows.get('library')?.value).toBe('backup');expect(seen).toEqual(['restored']);expect(keys).toEqual(['active','library']);stop();await journal.journalCompareAndSwapMany([{key:'later',generation:undefined,value:'later'}]);expect(keys).toEqual(['active','library']);
});
it('aborts every replacement without notifications or memory changes when a multi-key write fails',async()=>{
 const rows=atomicDatabase(true),journal=await import('../apps/web/src/journal'),seen:unknown[]=[],keys:string[]=[];journal.journalSubscribe('active',value=>seen.push(value));journal.journalSubscribeEntries(key=>keys.push(key));
 await expect(journal.journalCompareAndSwapMany([{key:'active',generation:undefined,value:'restored'},{key:'library',generation:undefined,value:'backup'}])).rejects.toThrow();
 expect(rows.size).toBe(0);expect(journal.journalGeneration('active')).toBeUndefined();expect(seen).toEqual([]);expect(keys).toEqual([]);
});
it('refuses all writes when a durable generation changed in another window',async()=>{
 const rows=atomicDatabase(),journal=await import('../apps/web/src/journal');rows.set('active',{value:'before',generation:'one',updatedAt:1});await journal.journalReadRecord('active');rows.set('active',{value:'concurrent',generation:'two',updatedAt:2});
 expect(await journal.journalCompareAndSwapMany([{key:'active',generation:'one',value:'restored'},{key:'library',generation:undefined,value:'backup'}])).toBe(false);expect(rows.get('active')?.value).toBe('concurrent');expect(rows.has('library')).toBe(false);
});
