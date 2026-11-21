import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,realpathSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {createContextResultLineage} from '../packages/core/context-result-lineage.ts';
import {contextResultReadArgs} from '../packages/core/context-result-tool.ts';
import {memoryContainsSecret} from '../packages/core/memory-publication.ts';
import {OperationExecutionAdviceHost} from '../packages/core/operation-execution-advice.ts';
import type {Operation,Thread} from '../packages/contracts/index.ts';

// The real withResourceGrant needs the native namespace guard which is
// unavailable off-host (CAPABILITY_DENIED); the lineage logic is the unit.
vi.mock('../packages/core/file-access.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../packages/core/file-access.ts')>(),
  withResourceGrant: vi.fn(async (grant: { path: string }, _dir: string, rel: string | undefined, _w: boolean, _s: AbortSignal, action: (path: string) => Promise<unknown>) =>
    action(rel ? join(grant.path, rel) : grant.path)),
}));

const dirs:string[]=[];
afterEach(()=>{while(dirs.length)rmSync(dirs.pop()!,{recursive:true,force:true});});

function fixture(){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'lin-')));dirs.push(dir);
  const store=new Store(dir),file=join(dir,'source.txt');
  writeFileSync(file,'captured content');
  const grant={id:'g1',threadId:'t1',kind:'file' as const,path:dir,label:'src',writable:false,createdAt:'2026-11-21'};
  store.internal('fixture',grant.threadId,()=>store.put('resource',grant.id,grant.threadId,grant));
  const controller=new AbortController();
  const lineage=createContextResultLineage({store,threadId:'t1',signal:controller.signal,assertCurrent:()=>{}});
  const context={withResource:(id:string,relativePath:string|undefined,write:boolean,action:(path:string)=>Promise<unknown>)=>
    action(relativePath?join(store.get<typeof grant>('resource',id)!.path,relativePath):store.get<typeof grant>('resource',id)!.path)} as never;
  return {store,grant,file,lineage,context,controller};
}

describe('contextResultReadArgs',()=>{
 it('accepts a bounded read',()=>expect(contextResultReadArgs.safeParse({handle:crypto.randomUUID(),offset:0,length:1024}).success).toBe(true));
 it('rejects out-of-range bounds and extra fields',()=>{
  const h=crypto.randomUUID(),base={handle:h,offset:0,length:1};
  expect(contextResultReadArgs.safeParse({...base,offset:-1}).success).toBe(false);
  expect(contextResultReadArgs.safeParse({...base,length:0}).success).toBe(false);
  expect(contextResultReadArgs.safeParse({...base,length:1024*1024+1}).success).toBe(false);
  expect(contextResultReadArgs.safeParse({...base,extra:true}).success).toBe(false);
  expect(contextResultReadArgs.safeParse({handle:'not-a-uuid',offset:0,length:1}).success).toBe(false);
 });
});

describe('memoryContainsSecret',()=>{
 it.each([
  'key is sk-proj-abcdefghijklmnop1234',
  'ghp_abcdefghijklmnop123456',
  'github_pat_11ABCDEFGHIJ_abcdefghijklmnop',
  'AIzaSyAbcdefghijklmnop1234567890',
  'AKIAIOSFODNN7EXAMPLE',
  '-----BEGIN PRIVATE KEY-----\nMII',
  'api_key: "sup3rs3cretvalue"',
  'access_token=abcdef12345678',
  'Authorization: Bearer abcdefghijklmnop',
  'eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxIn0.signature',
 ])('flags %s',text=>expect(memoryContainsSecret(text)).toBe(true));
 it.each([
  'a normal paragraph about passwords and security',
  'secret=short',
  'the api key is rotated weekly',
  'sk-short',
  'bearer of bad news',
 ])('ignores %s',text=>expect(memoryContainsSecret(text)).toBe(false));
});

describe('createContextResultLineage',()=>{
 it('records a real read and authorized() re-verifies it',async()=>{
  const f=fixture(),wrapped=f.lineage.wrap(f.context);
  expect(f.lineage.observed).toBe(false);
  const value=await wrapped.withResource('g1','source.txt',false,async path=>path);
  expect(value).toBe(f.file);
  expect(f.lineage.observed).toBe(true);
  await expect(f.lineage.authorized()).resolves.toBe(true);
 });
 it('write-capable or unobserved captures are never authorized',async()=>{
  const f=fixture(),wrapped=f.lineage.wrap(f.context);
  await expect(f.lineage.authorized()).resolves.toBe(false);
  await wrapped.withResource('g1','source.txt',true,async()=>'w');
  await expect(f.lineage.authorized()).resolves.toBe(false);
 });
 it('goes stale when the grant changes after capture',async()=>{
  const f=fixture(),wrapped=f.lineage.wrap(f.context);
  await wrapped.withResource('g1','source.txt',false,async()=>'r');
  f.store.internal('mutation','t1',()=>f.store.put('resource','g1','t1',{...f.grant,label:'swapped'}));
  expect(()=>f.lineage.assertCurrent()).toThrowError(/authority changed/i);
 });
 it('goes stale when the signal aborts',async()=>{
  const f=fixture();
  f.controller.abort();
  expect(()=>f.lineage.assertCurrent()).toThrowError(/authority changed/i);
 });
 it('rejects when the captured file identity changes during the action',async()=>{
  const f=fixture(),wrapped=f.lineage.wrap(f.context);
  await expect(wrapped.withResource('g1','source.txt',false,async path=>{
    const other=join(dirname(path),'swap.txt');writeFileSync(other,'replaced inode');renameSync(other,path);
    return path;
  })).rejects.toThrowError(/authority changed/i);
 });
 it('rejects a resource read with no live grant',async()=>{
  const f=fixture(),wrapped=f.lineage.wrap(f.context);
  await expect(wrapped.withResource('missing','source.txt',false,async()=>'x')).rejects.toThrowError(/authority changed/i);
 });
});

describe('OperationExecutionAdviceHost',()=>{
 const op=(over:Partial<Operation>={})=>({id:'op1',threadId:'t1',revision:1,kind:'repository.test',description:'t',args:{},resourceIds:[],preconditions:{},status:'prepared' as const,approved:false,createdAt:'2026-11-21',...over});
 const thread=(over:Partial<Thread>={})=>({id:'t1',title:'t',projectName:null,createdAt:'c',updatedAt:'c',status:'working',epoch:0,runId:'r1',modelId:'m',sessionPath:null,...over});
 const host=(store:Store)=>new OperationExecutionAdviceHost(store,{assertHostActive(){},sourceCommitment(){return 'commit'}});
 function seeded(){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'adv-')));dirs.push(dir);
  const store=new Store(dir);
  store.internal('fixture','t1',()=>{store.put('thread','t1','t1',thread());store.put('operation','op1','t1',op());});
  return store;
 }
 it('read reports NOT_FOUND for a missing or cross-thread operation',()=>{
  const store=seeded();
  expect(()=>host(store).read({threadId:'t1',operationId:'missing',operationRevision:1})).toThrowError(/unavailable/i);
  expect(()=>host(store).read({threadId:'other',operationId:'op1',operationRevision:1})).toThrowError(/unavailable/i);
 });
 it('read rejects a stale revision and an unsupported operation kind',()=>{
  const store=seeded();
  expect(()=>host(store).read({threadId:'t1',operationId:'op1',operationRevision:2})).toThrowError(/revision changed/i);
  store.internal('kind','t1',()=>store.put('operation','op1','t1',op({kind:'tool.call'})));
  expect(()=>host(store).read({threadId:'t1',operationId:'op1',operationRevision:1})).toThrowError(/no host process execution metadata/i);
 });
 it('read reports UNAVAILABLE/NOT_RECORDED when no advice was captured',()=>{
  const review=host(seeded()).read({threadId:'t1',operationId:'op1',operationRevision:1});
  expect(review.advice).toMatchObject({state:'UNAVAILABLE',reason:'NOT_RECORDED'});
 });
 it('recordPrepared stores an unavailable record when the binding cannot be computed',()=>{
  const store=seeded();
  store.internal('op.prepared','t1',()=>host(store).recordPrepared(op(),thread()));
  expect(store.get('operationExecutionAdvice','["op1",1]')).toMatchObject({available:false,reason:'COMPUTATION_FAILED'});
  const review=host(store).read({threadId:'t1',operationId:'op1',operationRevision:1});
  expect(review.advice).toMatchObject({state:'UNAVAILABLE',reason:'COMPUTATION_FAILED'});
 });
 it('recordPrepared is write-once and ignores unknown operation kinds',()=>{
  const store=seeded();
  store.internal('op.prepared','t1',()=>host(store).recordPrepared(op({kind:'tool.call'}),thread()));
  expect(store.get('operationExecutionAdvice','["op1",1]')).toBeNull();
  store.internal('op.prepared','t1',()=>host(store).recordPrepared(op(),thread()));
  const first=store.get('operationExecutionAdvice','["op1",1]');
  store.internal('op.prepared','t1',()=>host(store).recordPrepared(op({args:{different:true}}),thread()));
  expect(store.get('operationExecutionAdvice','["op1",1]')).toEqual(first);
 });
});
