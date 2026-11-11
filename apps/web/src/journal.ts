export interface JournalRecord<T = unknown> { value: T; updatedAt: number; generation: string }
let database: Promise<IDBDatabase> | undefined;
const memory = new Map<string, JournalRecord>();
const listeners = new Map<string, Set<(value: unknown) => void>>();
const entryListeners=new Set<(key:string)=>void>();
function notifyLocal(key:string,value:unknown){listeners.get(key)?.forEach(listener=>listener(value));entryListeners.forEach(listener=>listener(key));}
export function journalSubscribeEntries(listener:(key:string)=>void){entryListeners.add(listener);return()=>{entryListeners.delete(listener);};}
const writes=new Set<Promise<void>>();
const failedWrites=new Map<string,JournalRecord>();
const journalChannel=typeof window!=='undefined'&&typeof BroadcastChannel==='function'?new BroadcastChannel('harness:journal-changes:v1'):undefined;
const journalSender=crypto.randomUUID();
function notifyOtherWindows(key:string,generation:string){journalChannel?.postMessage({key,generation,sender:journalSender});}
if(journalChannel)journalChannel.onmessage=event=>{const value=event.data;if(!value||value.sender===journalSender||typeof value.key!=='string'||value.key.length>2048||typeof value.generation!=='string'||value.generation.length>128)return;const key=value.key;void open().then(db=>new Promise<JournalRecord|undefined>((resolve,reject)=>{const request=db.transaction('entries').objectStore('entries').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);})).then(record=>{if(!record||record.generation!==value.generation||pendingRecord(key)&&pendingRecord(key)?.generation!==record.generation)return;const previous=memory.get(key);if(previous&&previous.updatedAt>record.updatedAt)return;memory.set(key,record);notifyLocal(key,record.value);}).catch(()=>{});};
export async function journalFlush(){while(writes.size)await Promise.all([...writes]);const failed=[...failedWrites].filter(([key,record])=>memory.get(key)?.generation===record.generation);if(failed.length)await Promise.all(failed.map(([key,record])=>persist(key,record)));}
export async function journalEntries():Promise<{key:string;record:JournalRecord}[]>{await journalFlush();const db=await open();const rows=await new Promise<{key:string;record:JournalRecord}[]>((resolve,reject)=>{const transaction=db.transaction('entries'),store=transaction.objectStore('entries'),keys=store.getAllKeys(),values=store.getAll();transaction.oncomplete=()=>resolve(keys.result.map((key,index)=>({key:String(key),record:values.result[index]})));transaction.onerror=()=>reject(transaction.error);});const entries=new Map(rows.map(row=>[row.key,row.record]));for(const [key,record]of memory)entries.set(key,record);return [...entries].map(([key,record])=>({key,record}));}
const pendingKey = (key: string) => `harness:journal-pending:${encodeURIComponent(key)}`;
function pendingRecord(key: string): JournalRecord | undefined {
  try {
    const raw = localStorage.getItem(pendingKey(key)); if (!raw) return;
    const record = JSON.parse(raw) as JournalRecord;
    if (record && typeof record.generation === 'string' && record.generation.length <= 128 && Number.isFinite(record.updatedAt) && Object.hasOwn(record, 'value')) return record;
  } catch { /* IndexedDB remains the primary journal if synchronous storage is unavailable. */ }
}
function stage(key: string, record: JournalRecord) {
  try { localStorage.setItem(pendingKey(key), JSON.stringify(record)); } catch { /* The awaited IndexedDB write still reports storage failures. */ }
}
function clearStaged(key: string, generation: string) {
  try { if (pendingRecord(key)?.generation === generation) localStorage.removeItem(pendingKey(key)); } catch { /* A retained staging record is recoverable. */ }
}
async function persistRecord(key: string, record: JournalRecord): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite'), entries = transaction.objectStore('entries');
    const request = entries.get(key);
    request.onsuccess = () => { if (!request.result || request.result.updatedAt <= record.updatedAt) entries.put(record, key); };
    transaction.oncomplete = () => { clearStaged(key, record.generation); resolve(); };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function persist(key:string,record:JournalRecord):Promise<void>{const task=persistRecord(key,record).then(()=>{if(failedWrites.get(key)?.generation===record.generation)failedWrites.delete(key);},cause=>{if(memory.get(key)?.generation===record.generation)failedWrites.set(key,record);throw cause;});writes.add(task);void task.finally(()=>writes.delete(task)).catch(()=>{});return task;}
export function journalSubscribe(key: string, listener: (value: unknown) => void) {
  let subscriptions = listeners.get(key);
  if (!subscriptions) listeners.set(key, subscriptions = new Set());
  subscriptions.add(listener);
  return () => { subscriptions.delete(listener); if (!subscriptions.size) listeners.delete(key); };
}
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('generative-harness-journal', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(cause => { database = undefined; throw cause; });
}
export async function journalReadRecord<T>(key: string): Promise<JournalRecord<T> | undefined> {
  const local = memory.get(key);
  if (local) return local as JournalRecord<T>;
  // A synchronous write-ahead record closes the edit -> navigation gap before
  // IndexedDB has opened/committed. Replay that exact generation, then retire it.
  const staged = pendingRecord(key);
  if (staged) { memory.set(key, staged); void persist(key, staged).catch(() => {}); return staged as JournalRecord<T>; }
  const db = await open();
  return new Promise<JournalRecord<T> | undefined>((resolve, reject) => {
    const request = db.transaction('entries').objectStore('entries').get(key);
    request.onsuccess = () => {
      const record = memory.get(key) ?? request.result as JournalRecord<T> | undefined;
      if (record) memory.set(key, record);
      resolve(record as JournalRecord<T> | undefined);
    };
    request.onerror = () => reject(request.error);
  });
}
export async function journalRead<T>(key: string): Promise<T | undefined> { return (await journalReadRecord<T>(key))?.value; }
export async function journalWrite(key: string, value: unknown) {
  const record: JournalRecord = { value, updatedAt: Math.max(Date.now(), (memory.get(key)?.updatedAt ?? 0) + 1), generation: crypto.randomUUID() };
  stage(key, record);
  memory.set(key, record);
  notifyLocal(key,value);
  await persist(key, record);
  notifyOtherWindows(key,record.generation);
  return record.generation;
}

export const journalGeneration = (key: string) => memory.get(key)?.generation;

// Compare both the in-tab owner and the durable generation in one IDB transaction.
// An acknowledgment from an older mount must never clear a later edit.
export async function journalCompareAndSwap(key: string, generation: string | undefined, value: unknown) {
  if (memory.get(key)?.generation !== generation) return false;
  const db = await open();
  return new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction('entries', 'readwrite');
    const entries = transaction.objectStore('entries');
    const request = entries.get(key);
    let replacement: JournalRecord | undefined;
    request.onsuccess = () => {
      const durable = request.result as JournalRecord | undefined, local = memory.get(key);
      if (durable?.generation !== generation || local?.generation !== generation) return;
      const record = { value, updatedAt: Math.max(Date.now(), (local?.updatedAt ?? 0) + 1, (durable?.updatedAt ?? 0) + 1), generation: crypto.randomUUID() };
      entries.put(record, key);
      replacement = record;
    };
    transaction.oncomplete = () => {
      if (replacement && memory.get(key)?.generation === generation) { clearStaged(key, generation!); memory.set(key, replacement); notifyLocal(key,value); }
      if(replacement)notifyOtherWindows(key,replacement.generation);
      resolve(Boolean(replacement));
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export interface JournalChange {key:string;generation:string|undefined;value:unknown}
/** Recovery copy and active text commit together; nothing is published before IDB commits. */
export async function journalCompareAndSwapMany(changes:readonly JournalChange[],checks:readonly Omit<JournalChange,'value'>[]=[]):Promise<boolean>{
 if(!changes.length||new Set(changes.map(c=>c.key)).size!==changes.length)throw Error('Invalid atomic journal changes.');
 const expected=new Map<string,string|undefined>();for(const check of [...checks,...changes]){if(expected.has(check.key)&&expected.get(check.key)!==check.generation)throw Error('Conflicting journal generations.');expected.set(check.key,check.generation);}
 await journalFlush();
 if([...expected].some(([key,generation])=>memory.get(key)?.generation!==generation))return false;
 const db=await open();
 return new Promise<boolean>((resolve,reject)=>{
  const transaction=db.transaction('entries','readwrite'),entries=transaction.objectStore('entries'),durable=new Map<string,JournalRecord|undefined>(),replacements=new Map<string,JournalRecord>();let pending=expected.size,failed:unknown;
  for(const [key]of expected){const request=entries.get(key);request.onsuccess=()=>{
   durable.set(key,request.result as JournalRecord|undefined);if(--pending)return;
   if([...expected].some(([name,generation])=>memory.get(name)?.generation!==generation||durable.get(name)?.generation!==generation))return;
   try{for(const change of changes){const record={value:change.value,updatedAt:Math.max(Date.now(),(memory.get(change.key)?.updatedAt??0)+1,(durable.get(change.key)?.updatedAt??0)+1),generation:crypto.randomUUID()};entries.put(record,change.key);replacements.set(change.key,record);}}
   catch(cause){failed=cause;transaction.abort();}
  };}
  transaction.oncomplete=()=>{
   const published:string[]=[];
   for(const [key,record]of replacements)if(memory.get(key)?.generation===expected.get(key)){clearStaged(key,expected.get(key)!);memory.set(key,record);published.push(key);}
   for(const key of published)notifyLocal(key,replacements.get(key)!.value);
   for(const [key,record]of replacements)notifyOtherWindows(key,record.generation);
   resolve(replacements.size===changes.length);
  };
  transaction.onerror=()=>reject(failed??transaction.error??new Error('Draft transaction failed.'));
  transaction.onabort=()=>reject(failed??transaction.error??new Error('Draft transaction aborted.'));
 });
}
