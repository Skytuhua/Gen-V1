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

test('successful CAS clear stays newer across clock rollback', async ({ page, context }) => {
 const peer = await context.newPage();
 await page.goto('/');
 await peer.goto('/');
 await page.clock.setFixedTime(2_000_000_000_000);
 const local = await page.evaluate(async () => {
  const path = '/src/journal.ts', journal = await import(path);
  await journal.journalWrite('regression:rollback', 'Already sent draft');
  return (await journal.journalReadRecord('regression:rollback'))!;
 });
 const peerBefore = await peer.evaluate(async () => {
  const path = '/src/journal.ts', journal = await import(path);
  const record = await journal.journalReadRecord('regression:rollback');
  const changes: unknown[] = [];
  (window as unknown as { journalChanges: unknown[] }).journalChanges = changes;
  journal.journalSubscribe('regression:rollback', (value: unknown) => changes.push(value));
  return record;
 });
 expect(peerBefore).toEqual(local);
 // A durable predecessor can be newer than this tab's cached copy, while
 // retaining the exact generation the acknowledgment owns.
 const durableUpdatedAt = local.updatedAt + 500;
 await page.evaluate(({ local, durableUpdatedAt }) => new Promise<void>((resolve, reject) => {
  const opening = indexedDB.open('generative-harness-journal', 1);
  opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
   const db = opening.result, transaction = db.transaction('entries', 'readwrite');
   transaction.objectStore('entries').put({ ...local, updatedAt: durableUpdatedAt }, 'regression:rollback');
   transaction.oncomplete = () => { db.close(); resolve(); };
   transaction.onerror = () => { db.close(); reject(transaction.error); };
  };
 }), { local, durableUpdatedAt });
 await page.clock.setFixedTime(local.updatedAt - 1_000);
 const swapped = await page.evaluate(async generation => {
  const path = '/src/journal.ts', journal = await import(path);
  return journal.journalCompareAndSwap('regression:rollback', generation, '');
 }, local.generation);
 expect(swapped).toBe(true);
 await expect.poll(() => peer.evaluate(() => (window as unknown as { journalChanges: unknown[] }).journalChanges)).toEqual(['']);
 for (const current of [page, peer]) {
  const replacement = await current.evaluate(async () => {
   const path = '/src/journal.ts', journal = await import(path);
   return journal.journalReadRecord('regression:rollback');
  });
  expect(replacement?.value).toBe('');
  expect(replacement?.updatedAt).toBeGreaterThan(local.updatedAt);
  expect(replacement?.updatedAt).toBeGreaterThan(durableUpdatedAt);
 }
 await page.reload();
 expect(await page.evaluate(async () => {
  const path = '/src/journal.ts', journal = await import(path);
  return journal.journalRead('regression:rollback');
 })).toBe('');
});

test('repeated CAS replacements advance when the wall clock stays fixed', async ({ page }) => {
 await page.goto('/');
 await page.clock.setFixedTime(2_000_000_000_000);
 const result = await page.evaluate(async () => {
  const path = '/src/journal.ts', journal = await import(path);
  await journal.journalWrite('regression:fixed-clock', 'Draft');
  const records = [(await journal.journalReadRecord('regression:fixed-clock'))!];
  const swapped: boolean[] = [];
  for (const value of ['', 'Next draft']) {
   swapped.push(await journal.journalCompareAndSwap('regression:fixed-clock', records.at(-1)!.generation, value));
   records.push((await journal.journalReadRecord('regression:fixed-clock'))!);
  }
  return { records, swapped };
 });
 expect(result.swapped).toEqual([true, true]);
 expect(result.records.map(record => record.value)).toEqual(['Draft', '', 'Next draft']);
 expect(result.records[1].updatedAt).toBeGreaterThan(result.records[0].updatedAt);
 expect(result.records[2].updatedAt).toBeGreaterThan(result.records[1].updatedAt);
});

test('a later peer edit survives an acknowledgment of the captured generation', async ({ page, context }) => {
 const peer = await context.newPage();
 await page.goto('/');
 await peer.goto('/');
 const captured = await page.evaluate(async () => {
  const path = '/src/journal.ts', journal = await import(path);
  return journal.journalWrite('regression:late-ack', 'Sent draft');
 });
 await peer.evaluate(async () => {
  const path = '/src/journal.ts', journal = await import(path);
  await journal.journalRead('regression:late-ack');
  await journal.journalWrite('regression:late-ack', 'Later unsent text');
 });
 expect(await page.evaluate(async generation => {
  const path = '/src/journal.ts', journal = await import(path);
  return journal.journalCompareAndSwap('regression:late-ack', generation, '');
 }, captured)).toBe(false);
 for (const current of [page, peer]) {
  await expect.poll(() => current.evaluate(async () => {
   const path = '/src/journal.ts', journal = await import(path);
   return journal.journalRead('regression:late-ack');
  })).toBe('Later unsent text');
 }
 await page.reload();
 expect(await page.evaluate(async () => {
  const path = '/src/journal.ts', journal = await import(path);
  return journal.journalRead('regression:late-ack');
 })).toBe('Later unsent text');
});
