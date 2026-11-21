import {afterEach,expect,it,vi} from 'vitest';
import {renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {memoryFixture} from './project-memory-fixture.ts';
import {digest} from '../packages/storage/store.ts';
import type {ResourceGrant} from '../packages/contracts/index.ts';
import type {MemorySourceSnapshot} from '../packages/contracts/project-memory.ts';

// These fixtures exercise host capture/reuse custody with ordinary local reads.
// They do not claim native namespace-guard or platform file-read validation.
vi.mock('../packages/core/file-access.ts',async original=>({...await original<typeof import('../packages/core/file-access.ts')>(),withResourceGrant:async(grant:ResourceGrant,_profile:string,relative:string|undefined,_write:boolean,_signal:AbortSignal,action:(path:string)=>Promise<unknown>)=>action(relative?join(grant.path,relative):grant.path)}));
const fixtures:Awaited<ReturnType<typeof memoryFixture>>[]=[];
async function fixture(){const f=await memoryFixture();fixtures.push(f);return f;}
afterEach(()=>{for(const f of fixtures.splice(0)){f.store.close();rmSync(f.root,{recursive:true,force:true});}});

it('reuses the original immutable capture across unchanged settled-cut retries without extra source copies or events',async()=>{
 const f=await fixture();
 f.store.internal('fixture-settled-source','thread',()=>f.store.put('outbox','input','thread',{id:'input',threadId:'thread',messageId:'source',status:'handled',runId:'run'}));
 const sequence=f.store.sequence;
 for(let n=0;n<4;n++){
  expect(f.memory.captureMessage(f.access,'source')).toEqual(f.ref);
  expect(f.memory.extractionCut(f.access,{threadId:'thread',runId:'run',epoch:1}).sources[0].ref).toEqual(f.ref);
 }
 expect(f.store.all('projectMemorySource')).toHaveLength(1);expect(f.store.sequence).toBe(sequence);
});

it('reuses exact captures even at the retained-source limit',async()=>{
 const f=await fixture(),source=f.store.get<MemorySourceSnapshot>('projectMemorySource',digest(f.ref))!;
 f.store.internal('fixture-full-source-quota','thread',()=>{for(let n=1;n<1000;n++){const ref={...f.ref,sourceId:'unrelated:'+n,capturedSeq:f.ref.capturedSeq+n};f.store.put('projectMemorySource',digest(ref),'thread',{...source,ref});}});
 expect(f.memory.captureMessage(f.access,'source')).toEqual(f.ref);expect(f.store.all('projectMemorySource')).toHaveLength(1000);
});

it.each([{content:'Use PostgreSQL for project persistence.'},{createdAt:'2020-01-01T00:00:00.000Z'},{role:'assistant'}])('captures a new exact revision when source evidence changes: %j',async patch=>{
 const f=await fixture();f.store.internal('fixture-source-edit','thread',()=>f.store.put('message','source','thread',{...f.store.get<Record<string, unknown>>('message','source'),...patch}));
 const ref=f.memory.captureMessage(f.access,'source');expect(ref).not.toEqual(f.ref);expect(ref.sourceRevision).not.toBe(f.ref.sourceRevision);
 expect(f.memory.captureMessage(f.access,'source')).toEqual(ref);expect(f.store.all('projectMemorySource')).toHaveLength(2);
});

it('keeps identical text from different message IDs and approved source owners distinct',async()=>{
 const f=await fixture(),original=f.store.get<Record<string, unknown>>('message','source');
 f.act({action:'configure',enabled:true,sourceThreadIds:['thread','other'],baseRevision:1});
 f.store.internal('fixture-other-evidence',null,()=>{
  f.store.put('message','second','thread',{...original,id:'second'});
  f.store.put('message','other-source','other',{...original,id:'other-source',threadId:'other'});
 });
 const second=f.memory.captureMessage(f.access,'second'),other=f.memory.captureMessage(f.access,'other-source');
 expect(second.digest).toBe(f.ref.digest);expect(other.digest).toBe(f.ref.digest);expect(second.sourceId).toBe('second');expect(other.ownerThreadId).toBe('other');
 expect(f.memory.captureMessage(f.access,'second')).toEqual(second);expect(f.memory.captureMessage(f.access,'other-source')).toEqual(other);
 expect(f.store.all('projectMemorySource')).toHaveLength(3);
});

it('does not reuse a prior account capture after the source thread changes account ownership',async()=>{
 const f=await fixture();f.store.internal('fixture-account-change','thread',()=>f.store.put('thread','thread','thread',{...f.store.get<Record<string, unknown>>('thread','thread'),accountId:'next-account'}));
 const access=await f.memory.access('project','thread');f.act({action:'configure',enabled:true,sourceThreadIds:['thread'],baseRevision:0},access);
 const ref=f.memory.captureMessage(access,'source');expect(ref).not.toEqual(f.ref);expect(f.store.get<MemorySourceSnapshot>('projectMemorySource',digest(ref))?.accountId).toBe('next-account');
 expect(f.memory.captureMessage(access,'source')).toEqual(ref);expect(f.memory.sourceAvailable(access,f.ref)).toBe(false);
});

it('does not reuse retained evidence after the owning thread moves to another project',async()=>{
 const f=await fixture();f.store.internal('fixture-project-change','thread',()=>{
  f.store.put('workspaceProject','next-project',null,{...f.store.get<Record<string, unknown>>('workspaceProject','project')!,id:'next-project'});
  f.store.put('workspaceProjectRoot','next-project',null,f.store.get<Record<string, unknown>>('workspaceProjectRoot','project'));
  f.store.put('thread','thread','thread',{...f.store.get<Record<string, unknown>>('thread','thread'),projectId:'next-project'});
 });
 const access=f.memory.currentAccess('next-project','thread');f.act({action:'configure',enabled:true,sourceThreadIds:['thread'],baseRevision:0},access);
 const ref=f.memory.captureMessage(access,'source');expect(ref).not.toEqual(f.ref);
 expect(f.store.get<MemorySourceSnapshot>('projectMemorySource',digest(ref))?.projectIdentity).toBe(access.projectIdentity);
 expect(f.memory.captureMessage(access,'source')).toEqual(ref);expect(f.memory.sourceAvailable(access,f.ref)).toBe(false);
});

it('checks retained plaintext instead of trusting matching revision-index metadata',async()=>{
 const f=await fixture(),source=f.store.get<MemorySourceSnapshot>('projectMemorySource',digest(f.ref))!;
 f.store.internal('fixture-corrupt-retained-source','thread',()=>f.store.put('projectMemorySource',digest(f.ref),'thread',{...source,content:'Mismatched retained text.'}));
 const ref=f.memory.captureMessage(f.access,'source');expect(ref).not.toEqual(f.ref);expect(f.memory.sourceAvailable(f.access,f.ref)).toBe(false);
 expect(f.store.get<MemorySourceSnapshot>('projectMemorySource',digest(ref))?.content).toBe(source.content);
});

it('cannot reuse a retained source after Forget excludes its content digest',async()=>{
 const f=await fixture(),item=f.accept();f.act({action:'forget',itemId:item.id,baseRevision:item.revision});
 expect(()=>f.memory.captureMessage(f.access,'source')).toThrow();expect(f.memory.sourceAvailable(f.access,f.ref)).toBe(false);
});

async function fileFixture(){
 const f=await fixture(),path=join(f.path,'constraints.txt'),content='Keep every persistence change in an explicit transaction.';writeFileSync(path,content);
 const physical=statSync(path,{bigint:true});
 const grant:ResourceGrant={id:'source-file',threadId:'thread',kind:'file',path,label:'constraints.txt',writable:false,createdAt:'2026-01-01T00:00:00.000Z',identity:{dev:String(physical.dev),ino:String(physical.ino)}};
 f.store.internal('fixture-file-grant','thread',()=>f.store.put('resource',grant.id,'thread',grant));
 const ref=await f.memory.captureFile(f.access,grant.id);return{...f,grant,path,content,ref};
}

it('reuses only the original authorized FILE capture and its exact private grant metadata',async()=>{
 const f=await fileFixture(),before=f.store.sequence;
 expect(await f.memory.captureFile(f.access,f.grant.id)).toEqual(f.ref);expect(f.store.sequence).toBe(before);
 const source=f.store.get<MemorySourceSnapshot>('projectMemorySource',digest(f.ref))!;expect(source.fileGrant).toEqual({resourceId:f.grant.id,grantDigest:digest(f.grant)});
});

it.each(['content','grant','physical'] as const)('creates a fresh FILE reference after an authorized %s change',async change=>{
 const f=await fileFixture();let grant=f.grant;
 if(change==='content')writeFileSync(f.path,'Use a transaction and record a rollback checkpoint.');
 if(change==='grant')grant={...grant,createdAt:'2026-02-01T00:00:00.000Z'};
 if(change==='physical'){
  renameSync(f.path,f.path+'.prior');writeFileSync(f.path,f.content);
  await expect(f.memory.captureFile(f.access,grant.id)).rejects.toMatchObject({code:'MEMORY_SOURCE_DENIED'});
  const physical=statSync(f.path,{bigint:true});grant={...grant,identity:{dev:String(physical.dev),ino:String(physical.ino)}};
 }
 if(change!=='content')f.store.internal('fixture-reapproved-grant','thread',()=>f.store.put('resource',grant.id,'thread',grant));
 const ref=await f.memory.captureFile(f.access,grant.id);expect(ref).not.toEqual(f.ref);expect(await f.memory.captureFile(f.access,grant.id)).toEqual(ref);
 if(change!=='content')expect(f.memory.sourceAvailable(f.access,f.ref)).toBe(false);
});
