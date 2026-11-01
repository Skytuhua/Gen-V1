import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {applySkillOperations} from '../packages/core/skills.ts';
import {HermesSourceLibrary,type HermesLibrarySource} from '../packages/runtime-hermes/library.ts';
import {HarnessError} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'hermes-library-')),store=new Store(root);
 cleanups.push(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const records=new Map<string,any>();let writes=0,failRefresh=false;
 const request=vi.fn(async(method:string,p:Record<string,any>):Promise<unknown>=>{
  if(method==='skills.list'){if(failRefresh)throw Error('Uncertain source read');return{skills:[...records.values()].map(x=>({name:x.name,description:x.description,category:'general'})),archived:[],usage:Object.fromEntries([...records].map(([n,x])=>[n,x.usage]))};}
  if(method==='skills.snapshot')return{catalog:await request('skills.list',{}),inspections:Object.fromEntries(records),proposals:[]};
  if(method==='skills.inspect'){const x=records.get(p.name);if(!x)throw Error('Skill not found');return structuredClone(x);}
  if(method==='skills.compose')return{document:p.document?`${p.document.slice(0,p.document.indexOf('BODY:'))}BODY:${p.content??'old'}`:`---\nname: ${p.name}\ndescription: ${p.description}\n---\n\nBODY:${p.content}`,content:p.content??'old',frontmatter:{name:p.name,description:p.description}};
  if(method==='skills.proposals')return[];
  if(method==='skills.manage'||method==='skills.import'){
   expect(store.all('hermesIntent').length).toBeGreaterThan(0);writes++;
   const args=method==='skills.import'?p.payload:p;
   for(const op of args.operations??[args])records.set(op.name,{name:op.name,description:'Procedure',category:'general',document:op.content,content:op.content.split('BODY:')[1]??op.content,frontmatter:{name:op.name},files:['SKILL.md'],fileHashes:{'SKILL.md':op.content},usage:{created_by:'learn',state:'active'},versions:[{id:`entry-${writes}`,skill:op.name,action:op.action,actor:'user',ts:'2026-11-01T00:00:00Z',before:[],after:[]}]});
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
 x.records.get('procedure').document='---\nname: procedure\ndescription: Procedure\nmetadata:\n  retained: true\n---\n\nBODY:old';x.records.get('procedure').fileHashes['SKILL.md']=x.records.get('procedure').document;
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
