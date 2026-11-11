import {describe,it,expect,beforeEach,afterEach,vi} from 'vitest';
import {savedDraftOwnerKey,readSavedDraftLibrary,createSavedDraft,insertDraftText,disabledReferenceValidation,loadSavedDrafts,saveNamedDraft,deleteSavedDraft,planDraftRestore,restoreSavedDraftText,savedDraftLibraryKey} from '../apps/web/src/saved-drafts';
import {captureTerminalExcerpt} from '../apps/web/src/terminal-excerpts';
const owner={profileId:'profile',accountId:'account',threadId:'thread',projectId:'project',workingCopyId:'copy'};
describe('saved drafts text-only contract',()=>{
 it('isolates every ownership dimension without ambiguous concatenation',()=>{const key=savedDraftOwnerKey(owner);for(const field of Object.keys(owner))expect(savedDraftOwnerKey({...owner,[field]:'other'})).not.toBe(key);});
 it('stores versioned bounded records and rejects extra secret/runtime fields or a foreign owner',()=>{
  const draft=createSavedDraft(owner,'Review release','Prompt');expect(draft).toMatchObject({version:1,owner,name:'Review release',text:'Prompt',resourceRefs:[],skills:[],excerpts:[]});
  expect(()=>readSavedDraftLibrary({version:1,owner,records:[{...draft,token:'private'}]},owner)).toThrow();expect(()=>readSavedDraftLibrary({version:1,owner,records:[draft]},{...owner,accountId:'other'})).toThrow();expect(()=>createSavedDraft(owner,'','text')).toThrow();
 });
 it('inserts at the caret without deleting selected text or changing attachment choices',()=>{expect(insertDraftText('abcd','new',2)).toEqual({text:'abnewcd',caret:5});expect(insertDraftText('😀x','new',1)).toEqual({text:'😀newx',caret:5});});
 it('rejects provisional requests, missing bindings, duplicate references and oversized frozen requests',async()=>{
  const valid={threadId:owner.threadId,projectId:owner.projectId,resources:[{resourceId:'r',binding:'a'.repeat(64)}],skills:[]};
  for(const input of [{owner,resourceRefs:[{resourceId:'r'}],skills:[]},{...valid,resources:[{resourceId:'r'}]},{...valid,resources:[valid.resources[0],valid.resources[0]]},{...valid,resources:Array.from({length:33},(_,i)=>({resourceId:'r'+i,binding:'a'.repeat(64)}))},{...valid,grant:{token:'private'}}])await expect(disabledReferenceValidation.validate(input as never)).rejects.toThrow();
 });
});
it('preserves existing over-limit records for inspection and rejects private reference fields',()=>{
 const draft=createSavedDraft(owner,'Prompt','text');const library={version:1,owner,records:Array.from({length:21},()=>({...draft,id:crypto.randomUUID()}))};expect(readSavedDraftLibrary(library,owner).records).toHaveLength(21);
 expect(()=>createSavedDraft(owner,'Secret','text',{resourceRefs:[{resourceId:'r',token:'must-not-persist'} as never]})).toThrow();
 expect(()=>createSavedDraft(owner,'Oversized','😀'.repeat(25001))).toThrow();
});

it('uses frozen v1 resource bindings and required nullable project identity in the disabled adapter',async()=>{
 const input={threadId:owner.threadId,projectId:owner.projectId,resources:[{resourceId:'r',binding:'a'.repeat(64)}],skills:[]};
 const result=await disabledReferenceValidation.validate(input);expect(result.available).toBe(false);expect(result.issues[0]).toContain('r');
 const bound=createSavedDraft(owner,'Bound reference','Prompt',{resourceRefs:[{resourceId:'r',binding:'a'.repeat(64)}]});expect(readSavedDraftLibrary({version:1,owner,records:[bound]},owner).records[0].resourceRefs).toEqual(input.resources);
});
it('keeps frozen v1 bind unavailable without inventing a resource binding',async()=>{
 const adapter=disabledReferenceValidation;
 const result=await adapter.bind({threadId:owner.threadId,projectId:null,resourceIds:['r']});expect(result.available).toBe(false);expect(result.issues[0]).toContain('r');expect(result).not.toHaveProperty('resources');
});


const local=vi.hoisted(()=>({rows:new Map<string,{value:unknown;updatedAt:number;generation:string}>(),memory:new Map<string,{value:unknown;updatedAt:number;generation:string}>(),sequence:0}));
vi.mock('../apps/web/src/journal',()=>({
 journalReadRecord:async(key:string)=>{const record=local.memory.get(key)??local.rows.get(key);if(record)local.memory.set(key,record);return record;},
 journalEntries:async()=>[...new Map([...local.rows,...local.memory])].map(([key,record])=>({key,record})),
 journalSubscribe:()=>()=>{},
 journalCompareAndSwapMany:async(changes:{key:string;generation:string|undefined;value:unknown}[],checks:{key:string;generation:string|undefined}[]=[])=>{
  if([...checks,...changes].some(row=>local.rows.get(row.key)?.generation!==row.generation||local.memory.get(row.key)?.generation!==row.generation))return false;
  for(const change of changes){const record={value:change.value,generation:String(++local.sequence),updatedAt:Date.now()};local.rows.set(change.key,record);local.memory.set(change.key,record);}return true;
 },
}));
beforeEach(()=>{local.rows.clear();local.memory.clear();local.sequence=0;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-11T20:00:00Z'));vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Drafts must never use the network.');}));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function put(key:string,value:unknown){local.memory.delete(key);local.rows.set(key,{value,generation:String(++local.sequence),updatedAt:Date.now()});}
function seedLibrary(scope=owner,count=1){const records=Array.from({length:count},()=>createSavedDraft(scope,'Prompt','Saved text'));put(savedDraftLibraryKey(scope),{version:1,owner:scope,records});return records;}
const day=24*60*60*1000;

describe('approved saved-draft owner limits',()=>{
 it.each([99999,100000])('accepts %i UTF-8 bytes of draft text',size=>{expect(createSavedDraft(owner,'Boundary','a'.repeat(size)).text).toHaveLength(size);});
 it('rejects the first byte over 100 KB, counting Unicode bytes rather than characters',()=>{
  expect(createSavedDraft(owner,'Unicode','😀'.repeat(25000)).text).toHaveLength(50000);
  expect(()=>createSavedDraft(owner,'ASCII overflow','a'.repeat(100001))).toThrow(/100 KB/);
  expect(()=>createSavedDraft(owner,'Unicode overflow','😀'.repeat(25000)+'a')).toThrow(/100 KB/);
 });
 it('counts reviewed excerpt text inside the 100 KB draft budget',()=>{
  const excerpt=captureTerminalExcerpt({threadId:owner.threadId,projectId:owner.projectId,terminalId:'terminal',selection:'x'.repeat(16000)});
  expect(createSavedDraft(owner,'Boundary','a'.repeat(84000),{excerpts:[excerpt]}).text).toHaveLength(84000);
  expect(()=>createSavedDraft(owner,'Overflow','a'.repeat(84001),{excerpts:[excerpt]})).toThrow(/100 KB/);
 });
 it('caps the combined reviewed and original excerpt text at 16 KB for new saved drafts',()=>{
  const capture=(text:string)=>captureTerminalExcerpt({threadId:owner.threadId,projectId:owner.projectId,terminalId:'terminal',selection:text});
  const a=capture('a'.repeat(8000)),b=capture('b'.repeat(8000));expect(createSavedDraft(owner,'Boundary','',{excerpts:[a,b]}).excerpts).toHaveLength(2);
  expect(()=>createSavedDraft(owner,'Overflow','',{excerpts:[a,{...b,text:b.text+'x'}]})).toThrow(/16 KB/);
  expect(()=>createSavedDraft(owner,'Original overflow','',{excerpts:[a,capture('b'.repeat(8001))]})).toThrow(/16 KB/);
 });
 it('allows draft 20 and blocks draft 21 without dropping any existing record',async()=>{
  seedLibrary(owner,19);put('draft:'+owner.threadId,'Current text');await saveNamedDraft(owner,'Twentieth');const before=(await loadSavedDrafts(owner)).library;
  expect(before.records).toHaveLength(20);await expect(saveNamedDraft(owner,'Overflow')).rejects.toThrow(/20.*thread/);expect((await loadSavedDrafts(owner)).library).toEqual(before);
 });
 it('shares the 20-draft cap across working-copy/project scopes in the same thread',async()=>{
  const otherCopy={...owner,workingCopyId:'other-copy'},otherProject={...owner,projectId:'other-project'};seedLibrary(owner,19);seedLibrary(otherCopy,1);put('draft:'+owner.threadId,'Current text');
  await expect(saveNamedDraft(otherProject,'Overflow')).rejects.toThrow(/20.*thread/);expect((await loadSavedDrafts(otherCopy)).library.records).toHaveLength(1);
  const loaded=await loadSavedDrafts(otherCopy);await deleteSavedDraft(otherCopy,loaded.library.records[0].id,loaded.generation);await expect(saveNamedDraft(otherProject,'After delete')).resolves.toBeDefined();
 });
 it('does not share quota with another thread, account or profile',async()=>{
  seedLibrary(owner,20);put('draft:'+owner.threadId,'Current text');
  for(const scope of [{...owner,threadId:'other-thread'},{...owner,accountId:'other-account'},{...owner,profileId:'other-profile'}]){put('draft:'+scope.threadId,'Current text');await expect(saveNamedDraft(scope,'Separate owner')).resolves.toBeDefined();}
 });
 it('keeps legacy over-limit libraries intact and blocks further saves',async()=>{
  const old=seedLibrary(owner,21);put('draft:'+owner.threadId,'Current text');expect((await loadSavedDrafts(owner)).library.records).toEqual(old);await expect(saveNamedDraft(owner,'Overflow')).rejects.toThrow(/20.*thread/);expect((await loadSavedDrafts(owner)).library.records).toEqual(old);
 });
 it.each([[-1,1],[0,0],[1,0]])('expires at the 90-day idle boundary (%i ms), persisting only the approved deletions',async(offset,remaining)=>{
  const records=seedLibrary();records[0].updatedAt=new Date(Date.now()-90*day-offset).toISOString();put('draft:'+owner.threadId,'Keep the active composer');
  const result=await loadSavedDrafts(owner);expect(result.library.records).toHaveLength(remaining);expect((local.rows.get(savedDraftLibraryKey(owner))!.value as {records:unknown[]}).records).toHaveLength(remaining);expect(local.rows.get('draft:'+owner.threadId)?.value).toBe('Keep the active composer');
 });
 it('expires idle drafts in other working copies but keeps recently edited records and timestamps',async()=>{
  const otherCopy={...owner,workingCopyId:'other-copy'};const stale=seedLibrary(otherCopy);stale[0].updatedAt=new Date(Date.now()-90*day).toISOString();const fresh=seedLibrary(owner),stamp=fresh[0].updatedAt;
  await loadSavedDrafts(owner);expect((await loadSavedDrafts(otherCopy)).library.records).toHaveLength(0);expect((await loadSavedDrafts(owner)).library.records[0].updatedAt).toBe(stamp);
 });
 it('stores, restores, deletes and expires drafts entirely in local journal storage',async()=>{
  put('draft:'+owner.threadId,'Saved locally');const saved=await saveNamedDraft(owner,'Local');put('draft:'+owner.threadId,'');const plan=await planDraftRestore(owner,saved.id);await restoreSavedDraftText(owner,plan,'replace',0);
  expect(local.rows.get('draft:'+owner.threadId)?.value).toBe('Saved locally');const loaded=await loadSavedDrafts(owner);await deleteSavedDraft(owner,saved.id,loaded.generation);expect((await loadSavedDrafts(owner)).library.records).toHaveLength(0);expect(fetch).not.toHaveBeenCalled();
 });
});


it('serializes concurrent saves into the last thread-wide slot across working copies',async()=>{
 seedLibrary(owner,19);put('draft:'+owner.threadId,'Current text');const otherCopy={...owner,workingCopyId:'racing-copy'};
 const results=await Promise.allSettled([saveNamedDraft(owner,'First'),saveNamedDraft(otherCopy,'Second')]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await loadSavedDrafts(owner)).count).toBe(20);
});
it('blocks Replace at capacity rather than losing the current draft or its recovery copy',async()=>{
 const records=seedLibrary(owner,20);put('draft:'+owner.threadId,'Keep current');let plan=await planDraftRestore(owner,records[0].id);
 await expect(restoreSavedDraftText(owner,plan,'replace',0)).rejects.toThrow(/20.*thread/);expect(local.rows.get('draft:'+owner.threadId)?.value).toBe('Keep current');expect((await loadSavedDrafts(owner)).library.records).toHaveLength(20);
 const loaded=await loadSavedDrafts(owner);await deleteSavedDraft(owner,records[1].id,loaded.generation);plan=await planDraftRestore(owner,records[0].id);await restoreSavedDraftText(owner,plan,'replace',0);
 const after=await loadSavedDrafts(owner);expect(after.library.records).toHaveLength(20);expect(after.library.records.some(r=>r.text==='Keep current')).toBe(true);expect(local.rows.get('draft:'+owner.threadId)?.value).toBe('Saved text');
});

it('rejects a foreign owner at the current library key without hiding or overwriting it',async()=>{
 const foreign={...owner,accountId:'foreign-account'},records=[createSavedDraft(foreign,'Foreign prompt','Keep private')],value={version:1,owner:foreign,records};put(savedDraftLibraryKey(owner),value);put('draft:'+owner.threadId,'Current text');
 await expect(loadSavedDrafts(owner)).rejects.toThrow(/another owner/);await expect(saveNamedDraft(owner,'Do not overwrite')).rejects.toThrow(/another owner/);expect(local.rows.get(savedDraftLibraryKey(owner))?.value).toEqual(value);
});


it.each(['load','save'] as const)('globally evicts inactive expired libraries on %s without loading their owner',async action=>{
 const scopes=[{...owner,workingCopyId:'inactive-copy'},{...owner,threadId:'inactive-thread'},{...owner,profileId:'inactive-profile',accountId:'inactive-account'}];
 for(const scope of scopes){const records=seedLibrary(scope,2);records[0].updatedAt=new Date(Date.now()-90*day-1).toISOString();records[1].name='Recent';}
 put('draft:'+owner.threadId,'Keep active text');if(action==='save')await saveNamedDraft(owner,'Saved locally');else await loadSavedDrafts(owner);
 for(const scope of scopes)expect((local.rows.get(savedDraftLibraryKey(scope))!.value as {records:{name:string}[]}).records.map(r=>r.name)).toEqual(['Recent']);
 expect(local.rows.get('draft:'+owner.threadId)?.value).toBe('Keep active text');expect(fetch).not.toHaveBeenCalled();
});


it('retries a global sweep without deleting an inactive draft edited concurrently',async()=>{
 const copy={...owner,workingCopyId:'inactive-copy'},thread={...owner,threadId:'inactive-thread'};
 for(const scope of [copy,thread])seedLibrary(scope)[0].updatedAt=new Date(Date.now()-90*day-1).toISOString();
 const journal=await import('../apps/web/src/journal'),original=journal.journalCompareAndSwapMany;
 const spy=vi.spyOn(journal,'journalCompareAndSwapMany').mockImplementationOnce(async()=>{put(savedDraftLibraryKey(copy),{version:1,owner:copy,records:[createSavedDraft(copy,'Edited concurrently','Keep newer text')]});return false;});
 try{await loadSavedDrafts(owner);expect((local.rows.get(savedDraftLibraryKey(copy))!.value as {records:{name:string}[]}).records.map(r=>r.name)).toEqual(['Edited concurrently']);expect((local.rows.get(savedDraftLibraryKey(thread))!.value as {records:unknown[]}).records).toEqual([]);}finally{spy.mockRestore();}
 expect(journal.journalCompareAndSwapMany).toBe(original);
});
