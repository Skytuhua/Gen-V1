import { test, expect } from '@playwright/test';

test('a last edit survives reload before IndexedDB opens its write transaction',async({page})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  const nativeOpen=indexedDB.open.bind(indexedDB);
  indexedDB.open=((name:string,version?:number)=>{
   const request=version===undefined?nativeOpen(name):nativeOpen(name,version);
   if(name==='generative-harness-journal'){
    const descriptor=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess')!;
    Object.defineProperty(request,'onsuccess',{set(listener:(event:Event)=>void){descriptor.set!.call(request,function(event:Event){setTimeout(()=>listener.call(request,event),10_000)});}});
   }
   return request;
  }) as typeof indexedDB.open;
  const moduleUrl='/src/journal.ts?reload-boundary=before';const journal=await import(moduleUrl);
  void journal.journalWrite('regression:last-decision',{reviewers:[{name:'Avery',active:true}]}).catch(()=>{});
 });
 await page.reload();
 const restored=await page.evaluate(async()=>{
  const moduleUrl='/src/journal.ts?reload-boundary=after';const journal=await import(moduleUrl);
  return journal.journalRead('regression:last-decision');
 });
 expect(restored).toEqual({reviewers:[{name:'Avery',active:true}]});
});
