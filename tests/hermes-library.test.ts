import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import {applySkillOperations} from '../packages/core/skills.ts';
import {HermesSourceLibrary,type HermesLibrarySource} from '../packages/runtime-hermes/library.ts';
import {HarnessError} from '../packages/contracts/index.ts';
import {harnessCatalog} from '../packages/skill-catalog/adapters.ts';
import {SkillCatalogRepository} from '../packages/skill-catalog/repository.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'hermes-library-')),store=new Store(root);
 cleanups.push(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const records=new Map<string,any>();let writes=0,failRefresh=false;
 const request=vi.fn(async(method:string,p:Record<string,any>):Promise<unknown>=>{
  if(method==='skills.list'){if(failRefresh)throw Error('Uncertain source read');return{skills:[...records.values()].map(x=>({name:x.name,description:x.description,category:'general'})),archived:[],usage:Object.fromEntries([...records].map(([n,x])=>[n,x.usage]))};}
  if(method==='skills.snapshot')return{catalog:await request('skills.list',{}),inspections:structuredClone(Object.fromEntries(records)),proposals:[]};
  if(method==='skills.capture'){const x=structuredClone(records.get(p.name));return{inspection:x,files:{},...(x.versions[0]?{sourceId:x.versions[0].id}:{})};}
  if(method==='skills.inspect'){const x=records.get(p.name);if(!x)throw Error('Skill not found');return structuredClone(x);}
  if(method==='skills.compose')return{document:p.document?`${p.document.slice(0,p.document.indexOf('BODY:'))}BODY:${p.content??'old'}`:`---\nname: ${p.name}\ndescription: ${p.description}\n---\n\nBODY:${p.content}`,content:p.content??'old',frontmatter:{name:p.name,description:p.description}};
  if(method==='skills.proposals')return[];
  if(method==='skills.manage'||method==='skills.import'){
   expect(store.all('hermesIntent').length).toBeGreaterThan(0);writes++;
   const args=method==='skills.import'?p.payload:p;
   for(const op of args.operations??[args])records.set(op.name,{name:op.name,description:'Procedure',category:'general',document:op.content,content:op.content.split('BODY:')[1]??op.content,frontmatter:{name:op.name},files:['SKILL.md'],fileHashes:{'SKILL.md':sha(op.content)},usage:{created_by:'learn',state:'active'},versions:[{id:`entry-${writes}`,skill:op.name,action:op.action,actor:'user',ts:'2026-11-01T00:00:00Z',before:[],after:[]}]});
   return{success:true};
  }
  if(method==='skills.flags'){const x=records.get(p.name);if(p.enabled!==undefined)x.usage.harness_enabled=p.enabled;if(p.protected!==undefined)x.usage.harness_protected=p.protected;if(p.legacyUsage&&!x.usage.harness_legacy_usage)Object.assign(x.usage,{use_count:p.legacyUsage.count,last_used_at:p.legacyUsage.lastUsedAt,patch_count:p.legacyUsage.patchCount,harness_legacy_usage:p.legacyUsage});return{success:true};}
  throw Error('Unexpected RPC '+method);
 });
 const source={request} as unknown as HermesLibrarySource;
 const library=new HermesSourceLibrary({source,store});
 return{store,source,request,library,records,get writes(){return writes;},failRefresh(){failRefresh=true;}};
}
const command={id:'create-command',type:'skill.manage',payload:{operations:[{action:'create',name:'procedure',baseRevision:0,description:'Procedure',content:'old'}]}};
it('migrates authoritative legacy usage before the source projection replaces cached counters',async()=>{
 const x=await fixture(),lastUsedAt='2026-10-04T12:00:00.000Z';x.store.internal('legacy.metrics',null,()=>{applySkillOperations(x.store,command.payload.operations,{kind:'user'});const summary=x.store.get<any>('skill','procedure');x.store.put('skill','procedure',null,{...summary,patchCount:4});x.store.put('skillUsage','procedure',null,{count:7,lastUsedAt});});
 await x.library.initialize();expect(x.store.get('skillUsage','procedure')).toEqual({count:7,lastUsedAt});expect(x.store.get<any>('skill','procedure').patchCount).toBe(4);expect(x.request.mock.calls.some(([method,p])=>method==='skills.flags'&&p.legacyUsage?.count===7)).toBe(true);
});

it('persists intent before source mutation, verifies projection and returns one durable receipt',async()=>{
 const x=await fixture();await x.library.initialize();const receipt=await x.library.command(command);
 expect(receipt.result).toMatchObject({status:'applied',changes:[{name:'procedure',revision:1}]});
 expect(x.store.receipt(command)).toEqual(receipt);expect(await x.library.command(command)).toEqual(receipt);expect(x.writes).toBe(1);
 expect((await x.library.view('procedure',{includeInactive:true})).content).toBe('old');
});

it('retains uncertain intent and never blindly repeats a source write after refresh fails',async()=>{
 const x=await fixture();await x.library.initialize();x.failRefresh();
 await expect(x.library.command(command)).rejects.toThrow();
 // A failed preflight does not write. Exercise an uncertain post-mutation read.
 const y=await fixture();await y.library.initialize();
 const original=y.source.request.bind(y.source);let mutated=false;
 y.source.request=async<T>(method:string,p?:Record<string,unknown>)=>{if(mutated&&['skills.list','skills.snapshot'].includes(method))throw Error('Refresh unavailable');const result=await original<T>(method,p);if(method==='skills.manage')mutated=true;return result;};
 await expect(y.library.command(command)).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});
 expect(y.store.receipt(command)).toBeNull();expect(y.writes).toBe(1);
 await expect(y.library.command(command)).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});expect(y.writes).toBe(1);
});

it('preserves full source frontmatter at the single UI body translation boundary',async()=>{
 const x=await fixture();await x.library.initialize();await x.library.command(command);
 x.records.get('procedure').document='---\nname: procedure\ndescription: Procedure\nmetadata:\n  retained: true\n---\n\nBODY:old';x.records.get('procedure').fileHashes['SKILL.md']=sha(x.records.get('procedure').document);
 await x.library.refresh();const summary=x.store.all<any>('skill')[0];
 await x.library.command({id:'patch-command',type:'skill.manage',payload:{operations:[{action:'patch',name:'procedure',baseRevision:summary.revision,content:'new'}]}});
 expect(x.request.mock.calls.some(([method,p])=>method==='skills.compose'&&String(p.document).includes('retained: true'))).toBe(true);
 expect(x.records.get('procedure').document).toContain('retained: true');
});

it('preserves conflicting legacy bytes and versions without overwriting canonical source',async()=>{
 const x=await fixture();x.store.internal('legacy',null,()=>applySkillOperations(x.store,command.payload.operations,{kind:'user'}));
 const old=x.store.get('skillVersion','procedure@1');
 x.records.set('procedure',{name:'procedure',description:'Procedure',document:'different',content:'different',files:['SKILL.md'],fileHashes:{'SKILL.md':'different'},usage:{},versions:[]});
 await expect(x.library.initialize()).resolves.toEqual({migrated:0});
 expect(x.store.get<any>('skill','procedure').migrationError).toMatch(/differ/);
 expect((await x.library.view('procedure',{includeInactive:true})).content).toBe('old');
 await expect(x.library.command({id:'pending-migration-edit',type:'skill.manage',payload:{operations:[{action:'patch',name:'procedure',baseRevision:1,content:'do not change'}]}})).rejects.toMatchObject({code:'HERMES_MIGRATION_PENDING'});
 expect(x.records.get('procedure').document).toBe('different');expect(x.store.get('skillVersion','procedure@1')).toEqual(old);expect(x.writes).toBe(0);
});

it.each([
 {type:'skill.decide',payload:{proposalId:'pending',approve:'false'}},
 {type:'skill.flags',payload:{name:'procedure',baseRevision:1,enabled:'false'}},
 {type:'skill.flags',payload:{name:'procedure',baseRevision:1}},
 {type:'skill.manage',payload:{operations:{name:'procedure'}}},
])('rejects malformed user intent before calling source: $type',async(value)=>{
 const x=await fixture();await expect(x.library.command({id:'invalid-command',...value})).rejects.toMatchObject({code:'INVALID_SKILL'});expect(x.request).not.toHaveBeenCalled();
});

it.each(['HERMES_SOURCE_BUSY','HERMES_CONFIG_BUSY'])('clears a definite pre-dispatch refusal: %s',async(code)=>{
 const x=await fixture();await x.library.initialize();const original=x.source.request.bind(x.source);
 x.source.request=async<T>(method:string,p?:Record<string,unknown>)=>{if(method==='skills.manage')throw new HarnessError(code,'Source admission refused');return original<T>(method,p);};
 await expect(x.library.command(command)).rejects.toMatchObject({code});expect(x.store.get('hermesIntent',command.id)).toBeNull();
});

it('clears a confirmed original skill refusal without recording success',async()=>{
 const x=await fixture();await x.library.initialize();const original=x.source.request.bind(x.source);
 x.source.request=async<T>(method:string,p?:Record<string,unknown>)=>method==='skills.manage'?{success:false,error:'Original validation refused'} as T:original<T>(method,p);
 await expect(x.library.command(command)).rejects.toMatchObject({code:'HERMES_SKILL_REFUSED'});expect(x.store.get('hermesIntent',command.id)).toBeNull();expect(x.store.receipt(command)).toBeNull();
});

it('migrates compatible committed legacy bytes repeatably without overwriting old revisions',async()=>{
 const x=await fixture();x.store.internal('legacy',null,()=>applySkillOperations(x.store,command.payload.operations,{kind:'user'}));const old=x.store.get('skillVersion','procedure@1');
 expect(await x.library.initialize()).toEqual({migrated:1});expect(await x.library.initialize()).toEqual({migrated:0});expect(x.writes).toBe(1);expect(x.store.get('skillVersion','procedure@1')).toEqual(old);
});

it('keeps oversized atomic legacy imports readable while gating only their activation and mutation',async()=>{
 const x=await fixture();x.store.internal('legacy',null,()=>applySkillOperations(x.store,[...command.payload.operations,...Array.from({length:20},(_,i)=>({action:'write_file' as const,name:'procedure',baseRevision:i+1,path:`references/file-${i}.md`,content:`Retained ${i}`}))],{kind:'user'}));
 expect(await x.library.initialize()).toEqual({migrated:0});expect(x.writes).toBe(0);
 expect((await x.library.view('procedure',{includeInactive:true,path:'references/file-19.md'})).content).toBe('Retained 19');
 expect(x.store.get<any>('skill','procedure').migrationError).toMatch(/20-operation/);
});

it('does not link a proposal ID unless the canonical pending payload was persisted',async()=>{
 const x=await fixture();x.store.internal('legacy-proposal',null,()=>applySkillOperations(x.store,command.payload.operations,{kind:'agent'},{requireApproval:true}));const proposal=x.store.all<any>('skillProposal')[0],original=x.source.request.bind(x.source);
 x.source.request=async<T>(method:string,p?:Record<string,unknown>)=>method==='skills.stage'?{id:'deadbeef',payload:p?.payload} as T:original<T>(method,p);
 await expect(x.library.initialize()).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});
 expect(x.store.all('hermesProposal')).toEqual([]);expect(x.store.get('skillProposal',proposal.id)).toEqual(proposal);expect(x.store.get('hermesIntent',`proposal-migration:${proposal.id}`)).not.toBeNull();
});

it('does not acknowledge a pending command when its source record is missing',async()=>{
 const x=await fixture();await x.library.initialize();const original=x.source.request.bind(x.source);
 x.source.request=async<T>(method:string,p?:Record<string,unknown>)=>method==='skills.manage'?{success:true,staged:true,pending_id:'deadbeef'} as T:original<T>(method,p);
 await expect(x.library.command(command)).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});expect(x.store.receipt(command)).toBeNull();expect(x.store.get('hermesIntent',command.id)).not.toBeNull();
});

// The source boundary returns detached DTOs, as JSONL does, with actual raw hashes.
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const packageRecord=(label:string,name='procedure')=>{
 const document=`---\nname: ${name}\ndescription: Description ${label}\n---\n\nBody ${label}\n`,support=`Support ${label}\n`;
 return{name,description:`Description ${label}`,category:'general',document,content:`Body ${label}\n`,files:['SKILL.md','references/help.md'],fileHashes:{'SKILL.md':sha(document),'references/help.md':sha(support)},usage:{state:'active'},versions:[{id:`tip-${label}`,ts:'2026-11-01T00:00:00Z',actor:'user',action:'patch',skill:name}],support};
};
async function captureFixture(){
 const x=await fixture();let current:any=packageRecord('initial'),captures=0,pending:any[]=[],beforeRead:undefined|(()=>Promise<void>),transform:undefined|((value:any)=>any);
 const historical=new Map([[current.versions[0].id,structuredClone(current)]]),calls:{method:string;params:Record<string,any>}[]=[];
 x.source.request=async<T>(method:string,p:Record<string,any>={})=>{
  calls.push({method,params:structuredClone(p)});
  if(method==='skills.snapshot'){const {document,content,support,...inspection}=structuredClone(current);return{catalog:{skills:[{name:current.name}],archived:current.usage.state==='archived'?[current.name]:[],usage:{}},inspections:{[current.name]:inspection},proposals:structuredClone(pending)} as T;}
  if(method==='skills.capture'||method==='skills.inspect'){
   await beforeRead?.();
   const row=structuredClone(p.revisionId?historical.get(p.revisionId):current)!;
   if(!row)throw new HarnessError('SKILL_SOURCE_UNAVAILABLE','The original source for this revision is no longer available.');
   if(method==='skills.inspect')return{...row,versions:structuredClone(current.versions),...(p.file_path?{fileContent:row.support}:{})} as T;
   captures++;
   const expected={documentHash:row.fileHashes['SKILL.md'],fileHashes:row.fileHashes,state:row.usage.state,enabled:row.usage.harness_enabled??true,protected:row.usage.harness_protected??false,tip:row.versions[0]?.id??null};
   if(JSON.stringify(p.expected?.[row.name])!==JSON.stringify(expected))throw new HarnessError('STALE_SKILL','Canonical package changed');
   const result={inspection:row,files:{'references/help.md':row.support},...(row.versions[0]?{sourceId:row.versions[0].id}:{})};return(transform?transform(result):result) as T;
  }
  throw Error('Unexpected capture fixture RPC '+method);
 };
 return{...x,calls,get captures(){return captures;},retire(id:string){historical.delete(id);current.versions=current.versions.filter((row:any)=>row.id!==id);},update(fn:(row:any)=>void){fn(current);},set(label:string){const previous=current.versions;current=packageRecord(label);current.versions.push(...previous);historical.set(current.versions[0].id,structuredClone(current));},pause(fn?:()=>Promise<void>){beforeRead=fn;},transform(fn:(value:any)=>any){transform=fn;},pending(value:any[]){pending=value;}};
}
const projectionRows=(store:Store)=>['skill','skillVersion','hermesSkill','skillUsage','skillProposal','hermesProposal','hermesIntent'].map(kind=>[kind,store.all(kind)]);
it('labels retained and retired source history from one canonical inspection without changing captured evidence',async()=>{
 const x=await captureFixture();await x.library.refresh();x.set('B');await x.library.refresh();
 const before=projectionRows(x.store),catalog=new SkillCatalogRepository([harnessCatalog(x.store)]),reference=(await catalog.list()).skills[0];
 const retained=await x.library.view('procedure');
 expect(retained.versions).toMatchObject([{revision:2,sourceAvailability:'retained'},{revision:1,sourceAvailability:'retained'}]);
 const historical=await x.library.view('procedure',{revision:1});expect(historical.content).toBe('Body initial\n');expect(historical.document).toBe(packageRecord('initial').document);
 expect((await x.library.view('procedure',{revision:1,path:'references/help.md'})).content).toBe('Support initial\n');
 x.retire('tip-initial');x.calls.length=0;
 const retired=await x.library.view('procedure');
 expect(retired.versions).toEqual(retained.versions.map(row=>row.revision===1?{...row,sourceAvailability:'unavailable'}:row));
 expect(retired.content).toBe('Body B\n');expect(retired.document).toBe(packageRecord('B').document);
 expect(x.calls).toEqual([{method:'skills.inspect',params:{name:'procedure'}}]);expect(x.captures).toBe(2);expect(projectionRows(x.store)).toEqual(before);
 expect((await catalog.list()).skills[0]).toEqual(reference);expect(await catalog.checkReference(reference.ref!)).toMatchObject({files:expect.arrayContaining([{path:'SKILL.md',bytes:Buffer.byteLength(packageRecord('B').document),digest:sha(packageRecord('B').document)}])});
});
it('keeps current reads independent when their historical source ID retires',async()=>{
 const x=await captureFixture();await x.library.refresh();const before=projectionRows(x.store);x.retire('tip-initial');x.calls.length=0;
 const current=await x.library.view('procedure');expect(current.content).toBe('Body initial\n');expect(current.versions).toMatchObject([{revision:1,sourceAvailability:'unavailable'}]);
 expect((await x.library.view('procedure',{path:'references/help.md'})).content).toBe('Support initial\n');
 expect(x.calls.every(call=>call.params.revisionId===undefined)).toBe(true);
 await expect(x.library.view('procedure',{revision:1})).rejects.toMatchObject({code:'SKILL_SOURCE_UNAVAILABLE'});expect(projectionRows(x.store)).toEqual(before);expect(x.captures).toBe(1);
});
it('pages source availability without extra captures and leaves ledger-less history unqualified',async()=>{
 const x=await captureFixture();x.update(row=>{row.versions=[];});await x.library.refresh();
 for(let revision=2;revision<=22;revision++){x.set(String(revision));await x.library.refresh();}
 x.retire('tip-2');x.calls.length=0;const first=await x.library.view('procedure'),last=await x.library.view('procedure',{versionOffset:20});
 expect(first.versions).toHaveLength(20);expect(first.nextVersionOffset).toBe(20);
 expect(last.versions).toMatchObject([{revision:2,sourceAvailability:'unavailable'},{revision:1}]);expect(last.versions[1]).not.toHaveProperty('sourceAvailability');expect(last.nextVersionOffset).toBeNull();
 expect(x.calls).toHaveLength(2);expect(x.captures).toBe(22);
 x.calls.length=0;expect((await x.library.view('procedure',{revision:1})).content).toBe('Body initial\n');expect(x.calls).toHaveLength(0);
});
it.each(['revision','support'])('refuses retired %s before rollback dispatch while preserving immutable versions and unrelated uncertainty',async(kind)=>{
 const x=await captureFixture();await x.library.refresh();x.set('B');await x.library.refresh();await x.library.view('procedure',{revision:1});
 const pending={hash:'unconfirmed',state:'uncertain',method:'skills.manage',params:{},at:'2026-11-01T00:00:00Z'};
 x.store.internal('fixture.uncertainty',null,()=>x.store.put('hermesIntent','older-command',null,pending));const before=projectionRows(x.store),original=x.source.request.bind(x.source);
 if(kind==='revision')x.retire('tip-initial');
 x.source.request=async<T>(method:string,p:Record<string,any>={})=>{if(kind==='support'&&method==='skills.inspect'&&p.revisionId==='tip-initial'&&p.file_path)throw new HarnessError('SKILL_SOURCE_UNAVAILABLE','The original source for this revision is no longer available.');return original<T>(method,p);};
 const rollback={id:'retired-rollback',type:'skill.manage',payload:{operations:[{action:'rollback',name:'procedure',baseRevision:2,revision:1}]}};
 await expect(x.library.command(rollback)).rejects.toMatchObject({code:'SKILL_SOURCE_UNAVAILABLE'});
 expect(x.calls.some(call=>call.method==='skills.manage')).toBe(false);expect(x.store.receipt(rollback)).toBeNull();expect(x.store.get('hermesIntent',rollback.id)).toBeNull();expect(projectionRows(x.store)).toEqual(before);
 await expect(x.library.command({...rollback,id:'stale-rollback',payload:{operations:[{...rollback.payload.operations[0],baseRevision:1}]}})).rejects.toMatchObject({code:'STALE_SKILL'});
 await expect(x.library.command({...rollback,id:'older-command'})).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});expect(x.store.get('hermesIntent','older-command')).toEqual(pending);
});
it.each(['HERMES_SOURCE_BUSY','PermissionError','HERMES_PROTOCOL','INVALID_SKILL','NOT_FOUND'])('preserves historical read failures without inferring retirement: %s',async(code)=>{
 const x=await captureFixture();await x.library.refresh();const before=projectionRows(x.store),original=x.source.request.bind(x.source),error=new HarnessError(code,'Original read failure');
 x.source.request=async<T>(method:string,p:Record<string,any>={})=>{if(method==='skills.inspect'&&p.revisionId)throw error;return original<T>(method,p);};
 await expect(x.library.view('procedure',{revision:1})).rejects.toBe(error);expect(projectionRows(x.store)).toEqual(before);
});
it.each(['PermissionError','OSError','UnicodeDecodeError'])('keeps unverified ledger history retryable while current content remains readable: %s',async(code)=>{
 const x=await captureFixture();await x.library.refresh();x.set('B');await x.library.refresh();
 const before=projectionRows(x.store),original=x.source.request.bind(x.source),error=new HarnessError(code,'Canonical ledger read failed');
 x.source.request=async<T>(method:string,p:Record<string,any>={})=>{
  if(method==='skills.inspect'&&p.revisionId)throw error;
  const result=await original<any>(method,p);
  return(method==='skills.inspect'?{...result,versions:[],versionsVerified:false}:result) as T;
 };
 const current=await x.library.view('procedure');expect(current.content).toBe('Body B\n');expect(current.versions.map(row=>row.revision)).toEqual([2,1]);expect(current.versions.every(row=>!Object.hasOwn(row,'sourceAvailability'))).toBe(true);
 expect((await x.library.view('procedure',{path:'references/help.md'})).content).toBe('Support B\n');
 await expect(x.library.view('procedure',{revision:1})).rejects.toBe(error);
 const rollback={id:`unverified-ledger-${code}`,type:'skill.manage',payload:{operations:[{action:'rollback',name:'procedure',baseRevision:2,revision:1}]}};
 await expect(x.library.command(rollback)).rejects.toBe(error);expect(x.calls.some(call=>call.method==='skills.manage')).toBe(false);expect(x.store.receipt(rollback)).toBeNull();expect(x.store.get('hermesIntent',rollback.id)).toBeNull();expect(projectionRows(x.store)).toEqual(before);
 x.source.request=original;expect((await x.library.view('procedure')).versions).toMatchObject([{revision:2,sourceAvailability:'retained'},{revision:1,sourceAvailability:'retained'}]);expect((await x.library.view('procedure',{revision:1})).content).toBe('Body initial\n');
});
it('refuses A metadata with B body after a canonical change and commits no partial refresh',async()=>{
 const x=await captureFixture();await x.library.refresh();const before=projectionRows(x.store);x.set('A');
 let entered!:()=>void,resume!:()=>void;const started=new Promise<void>(done=>{entered=done;}),gate=new Promise<void>(done=>{resume=done;});
 x.pause(async()=>{entered();await gate;});x.pending([{id:'proposal-B',created_at:1,origin:'foreground',payload:{action:'patch',name:'procedure',content:'proposal'}}]);
 const refreshing=x.library.refresh().catch(error=>error);await started;x.set('B');resume();
 const result=await refreshing;
 expect({code:result?.code,rows:projectionRows(x.store)}).toEqual({code:'HERMES_RECONCILIATION_REQUIRED',rows:before});
 x.pause();await x.library.refresh();const saved=x.store.get<any>('skillVersion','procedure@2');
 expect(saved).toMatchObject({sourceId:'tip-B',skill:{description:'Description B',content:'Body B\n',files:{'references/help.md':'Support B\n'}}});
 expect(x.store.all('skillVersion')).toHaveLength(2);expect((await x.library.view('procedure',{revision:2})).content).toBe(saved.skill.content);
 await x.library.refresh();expect(x.store.all('skillVersion')).toHaveLength(2);
});
it.each(['missing','extra','main','missingMain','extraPath','duplicatePath','malformed','descriptor','sourceId'])('refuses an invalid successful capture DTO before commit: %s',async(mode)=>{
 const x=await captureFixture();await x.library.refresh();const before=projectionRows(x.store);x.set('next');
 x.transform(result=>{if(mode==='missing')delete result.files['references/help.md'];if(mode==='extra')result.files['extra.txt']='extra';if(mode==='main')result.files['SKILL.md']='main';if(mode==='missingMain')result.inspection.files=result.inspection.files.filter((path:string)=>path!=='SKILL.md');if(mode==='extraPath')result.inspection.files.push('references/extra.md');if(mode==='duplicatePath')result.inspection.files.push('references/help.md');if(mode==='malformed')result.inspection.content=null;if(mode==='descriptor')result.inspection.fileHashes['SKILL.md']=sha('unrelated');if(mode==='sourceId')result.sourceId='unrelated';return result;});
 await expect(x.library.refresh()).rejects.toMatchObject({code:mode==='malformed'?'HERMES_PROTOCOL':'HERMES_RECONCILIATION_REQUIRED'});expect(projectionRows(x.store)).toEqual(before);
});


it('keeps real catalog custody unchanged on refused capture, then exposes coherent B bytes',async()=>{
 const x=await captureFixture(),catalog=new SkillCatalogRepository([harnessCatalog(x.store)]);await x.library.refresh();
 const first=(await catalog.list()).skills[0],custody=await catalog.checkReference(first.ref!);
 x.set('B');x.transform(value=>{delete value.files['references/help.md'];return value;});
 await expect(x.library.refresh()).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});
 expect((await catalog.list()).skills[0]).toEqual(first);expect(await catalog.checkReference(first.ref!)).toEqual(custody);
 x.transform(value=>value);await x.library.refresh();const next=(await catalog.list()).skills[0],record=packageRecord('B');
 expect(next).toMatchObject({description:'Description B',files:2,availability:{status:'available'}});
 expect((await catalog.checkReference(next.ref!)).files).toEqual([{path:'SKILL.md',bytes:Buffer.byteLength(record.document),digest:sha(record.document)},{path:'references/help.md',bytes:Buffer.byteLength(record.support),digest:sha(record.support)}]);
 await expect(catalog.checkReference(first.ref!)).rejects.toMatchObject({code:'SKILL_CATALOG_CHANGED'});
});

it('keeps unchanged usage refresh cheap and captures archived, disabled and protected controls coherently',async()=>{
 const x=await captureFixture();await x.library.refresh();expect(x.captures).toBe(1);
 x.update(row=>{row.usage.use_count=7;});await x.library.refresh();expect(x.captures).toBe(1);expect(x.store.all('skillVersion')).toHaveLength(1);expect(x.store.get<any>('skill','procedure').useCount).toBe(7);
 x.update(row=>Object.assign(row.usage,{state:'archived',harness_enabled:false,harness_protected:true}));await x.library.refresh();
 expect(x.captures).toBe(2);expect(x.store.get<any>('skillVersion','procedure@2').skill).toMatchObject({state:'archived',enabled:false,protected:true});
 await expect(x.library.view('procedure')).rejects.toMatchObject({code:'SKILL_DISABLED'});
 expect((await x.library.view('procedure',{revision:2,includeInactive:true})).content).toBe('Body initial\n');
 await x.library.refresh();expect(x.captures).toBe(2);expect(x.store.all('skillVersion')).toHaveLength(2);
});

it('retains captured immutable text for a genuinely ledger-less package',async()=>{
 const x=await captureFixture();x.update(row=>{row.versions=[];});await x.library.refresh();
 expect(x.store.get<any>('skillVersion','procedure@1').sourceId).toBeUndefined();x.set('later');
 expect((await x.library.view('procedure',{revision:1})).content).toBe('Body initial\n');
 expect((await x.library.view('procedure',{revision:1,path:'references/help.md'})).content).toBe('Support initial\n');
});

it.each(['STALE_SKILL','FileNotFoundError','ValueError','PermissionError','HERMES_PROTOCOL'])('translates capture refusal %s without retry or Store writes',async(code)=>{
 const x=await captureFixture();await x.library.refresh();const before=projectionRows(x.store),original=x.source.request.bind(x.source);let attempts=0;x.set('later');
 x.source.request=async<T>(method:string,params?:Record<string,unknown>)=>{if(method==='skills.capture'){attempts++;throw new HarnessError(code,'Capture refused');}return original<T>(method,params);};
 await expect(x.library.refresh()).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});expect(attempts).toBe(1);expect(projectionRows(x.store)).toEqual(before);
});

it('does not commit an earlier successful package when a later capture fails',async()=>{
 const x=await captureFixture();await x.library.refresh();const before=projectionRows(x.store),original=x.source.request.bind(x.source);x.set('changed');
 x.source.request=async<T>(method:string,params?:Record<string,unknown>)=>{
  if(method==='skills.capture'&&params?.name==='second')throw new HarnessError('STALE_SKILL','Second package changed');
  const result=await original<any>(method,params);if(method==='skills.snapshot'){const second=packageRecord('second','second');result.catalog.skills.push({name:'second'});result.inspections.second=second;}return result as T;
 };
 await expect(x.library.refresh()).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});expect(x.captures).toBe(2);expect(projectionRows(x.store)).toEqual(before);
});


it('retains the uncertain command intent when post-write capture fails and never repeats the write',async()=>{
 const x=await fixture();await x.library.initialize();const original=x.source.request.bind(x.source);let wrote=false;
 x.source.request=async<T>(method:string,params?:Record<string,unknown>)=>{if(wrote&&method==='skills.capture')throw new HarnessError('STALE_SKILL','Canonical bytes changed after write');const result=await original<T>(method,params);if(method==='skills.manage')wrote=true;return result;};
 await expect(x.library.command(command)).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});expect(x.store.receipt(command)).toBeNull();expect(x.store.get('hermesIntent',command.id)).not.toBeNull();expect(x.store.all('skillVersion')).toEqual([]);
 await expect(x.library.command(command)).rejects.toMatchObject({code:'HERMES_RECONCILIATION_REQUIRED'});expect(x.writes).toBe(1);
});
