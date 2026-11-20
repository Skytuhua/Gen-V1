import {afterEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {PersonalResearchRepository} from '../packages/research/repository.ts';
import {digest} from '../packages/storage/store.ts';
import {abcHash,context,researchFixture} from './research-fixture.ts';
import type {ResearchContext} from '../packages/contracts/research.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const prefix=digest(context)+':';
const setup=async(options?:{assertHostActive:()=>void})=>{
 const f=await researchFixture();cleanups.push(f.close);
 return {...f,repo:new PersonalResearchRepository(f.store,options)};
};
const putSource=(f:Awaited<ReturnType<typeof researchFixture>>,over:Record<string,unknown>={})=>{
 const source={...context,id:'source-a',revision:1,title:'S',identity:{kind:'text'},status:'captured',capturedAt:'2026-01-01T00:00:00Z',sha256:abcHash,bytes:3,materialId:prefix+abcHash,...over};
 f.store.internal('test.source',null,()=>{
  f.store.put('researchMaterial',prefix+abcHash,context.threadId,{base64:'YWJj'});
  f.store.put('researchSource',prefix+source.id,context.threadId,source);
  f.store.put('researchSourceVersion',prefix+source.id+'@'+source.revision,context.threadId,source);
 });
 return source;
};
const ref={sourceId:'source-a',revision:1,sha256:abcHash,start:0,end:3};

describe('binding',()=>{
 it('denies company authority, archived, delegate, side, parented and project-mismatched threads',async()=>{
  const {store,repo,thread}=await setup();
  expect(()=>repo.list({...context,authority:{kind:'company',companyId:'c'}} as ResearchContext,{kind:'sources'})).toThrow(expect.objectContaining({code:'CAPABILITY_DENIED'}));
  const denied=()=>expect(()=>repo.list(context,{kind:'sources'})).toThrow(expect.objectContaining({code:'CAPABILITY_DENIED'}));
  store.internal('t.archived',null,()=>store.put('archivedThread',thread.id,thread.id,thread));denied();
  store.internal('t.unarchive',null,()=>store.db.prepare('DELETE FROM entities WHERE kind=?').run('archivedThread'));
  store.internal('t.delegate',null,()=>store.put('thread',thread.id,thread.id,{...thread,kind:'delegate'}));denied();
  store.internal('t.side',null,()=>store.put('thread',thread.id,thread.id,{...thread,kind:'side'}));denied();
  store.internal('t.parented',null,()=>store.put('thread',thread.id,thread.id,{...thread,sideParentId:'thread-z'}));denied();
  store.internal('t.project',null,()=>store.put('thread',thread.id,thread.id,{...thread,projectId:'project-b'}));denied();
  store.internal('t.restore',null,()=>store.put('thread',thread.id,thread.id,thread));
  store.internal('p.foreign',null,()=>store.put('workspaceProject',context.projectId,null,{id:context.projectId,authority:{kind:'cloud'}}));denied();
 });
 it('invokes the host-active assertion before any read',async()=>{
  const {repo}=await setup({assertHostActive:()=>{throw Error('host closing')}});
  expect(()=>repo.source(context,'x')).toThrow('host closing');
 });
});

describe('read',()=>{
 it('rejects malformed ids and revisions and reports missing revisions',async()=>{
  const {repo}=await setup();
  for(const id of ['','a'.repeat(201),'bad id','bad/id','a?b'])expect(()=>repo.source(context,id)).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
  for(const revision of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])expect(()=>repo.source(context,'x',revision)).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
  expect(()=>repo.source(context,'missing')).toThrow(expect.objectContaining({code:'NOT_FOUND'}));
  expect(()=>repo.document(context,'missing')).toThrow(expect.objectContaining({code:'NOT_FOUND'}));
 });
 it('reads pinned revisions and rejects records bound to another context',async()=>{
  const f=await setup(),v2={...context,id:'source-a',revision:2,title:'S2',identity:{kind:'text'},status:'captured',capturedAt:'2026-01-01T00:00:00Z',sha256:abcHash,bytes:3,materialId:prefix+abcHash};
  putSource(f);
  f.store.internal('test.v2',null,()=>{
   f.store.put('researchSource',prefix+'source-a',context.threadId,v2);
   f.store.put('researchSourceVersion',prefix+'source-a@2',context.threadId,v2);
   f.store.put('researchSource',digest({...context,projectId:'other'})+':'+'foreign',context.threadId,{...v2,id:'foreign'});
  });
  expect(f.repo.source(context,'source-a',1).revision).toBe(1);
  expect(f.repo.source(context,'source-a').revision).toBe(2);
  expect(()=>f.repo.source(context,'foreign')).toThrow(expect.objectContaining({code:'NOT_FOUND'}));
 });
});

describe('passage',()=>{
 it('rejects hash mismatches, out-of-range citations, missing material and corrupt bytes',async()=>{
  const f=await setup();putSource(f);
  expect(()=>f.repo.passage(context,{...ref,sha256:abcHash.replace('b','a')})).toThrow(expect.objectContaining({code:'INVALID_CITATION'}));
  expect(()=>f.repo.passage(context,{...ref,end:99})).toThrow(expect.objectContaining({code:'INVALID_CITATION'}));
  f.store.internal('t.pending',null,()=>{const pending={...f.store.get<Record<string,unknown>>('researchSourceVersion',prefix+'source-a@1'),status:'fetching'};f.store.put('researchSource',prefix+'source-a',context.threadId,pending);f.store.put('researchSourceVersion',prefix+'source-a@1',context.threadId,pending);});
  expect(()=>f.repo.passage(context,ref)).toThrow(expect.objectContaining({code:'INVALID_CITATION'}));
  f.store.internal('t.nomaterial',null,()=>{const captured={...f.store.get<Record<string,unknown>>('researchSourceVersion',prefix+'source-a@1'),status:'captured'};f.store.put('researchSource',prefix+'source-a',context.threadId,captured);f.store.put('researchSourceVersion',prefix+'source-a@1',context.threadId,captured);f.store.db.prepare('DELETE FROM entities WHERE kind=?').run('researchMaterial');});
  expect(()=>f.repo.passage(context,ref)).toThrow(expect.objectContaining({code:'NOT_FOUND'}));
  f.store.internal('t.short',null,()=>f.store.put('researchMaterial',prefix+abcHash,context.threadId,{base64:'YWI='}));
  expect(()=>f.repo.passage(context,ref)).toThrow(expect.objectContaining({code:'SOURCE_CHANGED'}));
  f.store.internal('t.binary',null,()=>f.store.put('researchMaterial',prefix+abcHash,context.threadId,{base64:'//8='}));
  expect(()=>f.repo.passage(context,ref)).toThrow(expect.objectContaining({code:'SOURCE_CHANGED'}));
 });
 it('rejects non-UTF8 and NUL passages inside a valid capture',async()=>{
  const f=await setup();
  const binary=Buffer.from([0x61,0xff,0x62]),hash=createHash('sha256').update(binary).digest('hex');
  const nul=Buffer.from('a\0b'),nulHash=createHash('sha256').update(nul).digest('hex');
  for(const [bytes,h] of [[binary,hash],[nul,nulHash]] as const){
   const source={...context,id:'s-'+h.slice(0,4),revision:1,title:'S',identity:{kind:'text'},status:'captured',capturedAt:'2026-01-01T00:00:00Z',sha256:h,bytes:bytes.length,materialId:prefix+h};
   f.store.internal('t.binary-'+h.slice(0,4),null,()=>{
    f.store.put('researchMaterial',prefix+h,context.threadId,{base64:bytes.toString('base64')});
    f.store.put('researchSource',prefix+source.id,context.threadId,source);
    f.store.put('researchSourceVersion',prefix+source.id+'@1',context.threadId,source);
   });
   expect(()=>f.repo.passage(context,{sourceId:source.id,revision:1,sha256:h,start:0,end:bytes.length})).toThrow(expect.objectContaining({code:'INVALID_SOURCE'}));
  }
 });
});

describe('list',()=>{
 it('pages sources with a signed keyset cursor and rejects tampered cursors',async()=>{
  const f=await setup();
  for(const id of ['a','b','c'])putSource(f,{id});
  const first=f.repo.list(context,{kind:'sources',limit:2});
  expect(first.items).toHaveLength(2);expect(first.nextCursor).toBeTruthy();
  const second=f.repo.list(context,{kind:'sources',limit:2,cursor:first.nextCursor!});
  expect(second.items).toHaveLength(1);expect(second.nextCursor).toBeNull();
  const tampered=first.nextCursor!.split('.');tampered[0]=Buffer.from(JSON.stringify({binding:'x',after:prefix+'a'})).toString('base64url');
  expect(()=>f.repo.list(context,{kind:'sources',cursor:tampered.join('.')})).toThrow(expect.objectContaining({code:'INVALID_CURSOR'}));
  expect(()=>f.repo.list(context,{kind:'documents',cursor:first.nextCursor!})).toThrow(expect.objectContaining({code:'INVALID_CURSOR'}));
  for(const cursor of ['a.b.c','!!!.sig','e30.sig'])expect(()=>f.repo.list(context,{kind:'sources',cursor})).toThrow(expect.objectContaining({code:'INVALID_CURSOR'}));
 });
 it('stops before the 192KiB response budget and denies records of another context',async()=>{
  const f=await setup(),big='x'.repeat(150*1024);
  putSource(f,{id:'big-a',title:big});putSource(f,{id:'big-b',title:big});
  const page=f.repo.list(context,{kind:'sources',limit:10});
  expect(page.items).toHaveLength(1);expect(page.nextCursor).toBeTruthy();
  f.store.internal('t.alien',null,()=>f.store.put('researchSource',prefix+'alien',context.threadId,{...context,projectId:'other',id:'alien',revision:1,identity:{kind:'text'},status:'captured',sha256:abcHash,bytes:3}));
  expect(()=>f.repo.list(context,{kind:'sources'})).toThrow(expect.objectContaining({code:'CAPABILITY_DENIED'}));
 });
 it('returns document heads without bodies or citations',async()=>{
  const f=await setup();
  const document={...context,id:'doc-a',revision:1,kind:'findings',title:'Findings',body:'body',sha256:abcHash,savedAt:'2026-01-01T00:00:00Z',citations:[ref]};
  const {body:_b,citations:_c,...head}=document;
  f.store.internal('t.doc',null,()=>{
   f.store.put('researchDocument',prefix+'doc-a',context.threadId,head);
   f.store.put('researchDocumentVersion',prefix+'doc-a@1',context.threadId,document);
  });
  const page=f.repo.list(context,{kind:'documents'});
  expect(page.items).toEqual([head]);
  expect(f.repo.document(context,'doc-a').citations[0]).toMatchObject({status:'unavailable',liveStatus:'unverified'});
 });
});
