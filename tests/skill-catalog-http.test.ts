import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,realpath,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {buildServer} from '../apps/server/server.ts';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import {SkillCatalogRepository} from '../packages/skill-catalog/repository.ts';
import {directoryCatalog} from '../packages/skill-catalog/filesystem.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){
 const base=await realpath(tmpdir()),root=await mkdtemp(join(base,'gen-skcat-http-')),skills=join(root,'skills');await mkdir(join(skills,'procedure'),{recursive:true});await writeFile(join(skills,'procedure','SKILL.md'),'---\nname: Test procedure\ndescription: Description\n---\nNEVER-PROMOTE-THIS-BODY');
 const store=new Store(join(root,'data')),runtime:RuntimeAdapter={configure:()=>{},models:async()=>[],start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
 const service=new Service(store,runtime);await service.recover();const catalog=new SkillCatalogRepository([directoryCatalog({id:'personal:test',label:'Personal',kind:'personal',root:skills})]);
 const app=await buildServer(service,{port:4317,dev:false,skillCatalog:catalog});
 cleanups.push(async()=>{await app.close();await service.dispose();store.close();if(await realpath(root)!==resolve(root)||!root.startsWith(base+sep)||(await lstat(root)).isSymbolicLink())throw Error('Unsafe HTTP fixture cleanup');await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const host={host:'127.0.0.1:4317'},boot=await app.inject({url:'/api/bootstrap',headers:host}),headers={...host,cookie:String(boot.headers['set-cookie']).split(';')[0]};
 return{app,store,host,headers,root};
}
it('requires the existing host/session gate and returns metadata without bodies or file paths',async()=>{
 const f=await fixture(),seq=f.store.sequence;
 expect((await f.app.inject({url:'/api/skill-catalog',headers:f.host})).statusCode).toBe(401);
 expect((await f.app.inject({url:'/api/skill-catalog',headers:{...f.headers,origin:'https://untrusted.invalid'}})).statusCode).toBe(403);
 const result=await f.app.inject({url:'/api/skill-catalog?limit=1',headers:f.headers});expect(result.statusCode).toBe(200);expect(result.headers['cache-control']).toBe('no-store');expect(result.json().skills[0]).toMatchObject({name:'Test procedure',sourceId:'personal:test',availability:{status:'available'}});expect(result.body).not.toMatch(/NEVER-PROMOTE|gen-skcat-http|SKILL.md/);
 expect(f.store.sequence).toBe(seq);expect(f.store.snapshot().resources).toEqual([]);expect(f.store.snapshot().operations).toEqual([]);
});
it('rejects arbitrary paths, scope escalation and malformed paging without widening host discovery',async()=>{
 const f=await fixture();for(const query of ['?root=C:/','?path=../../','?scope=company','?providerId=private','?limit=0','?limit=101','?limit=nan','?limit=1&limit=2','?cursor=invalid','?query='+('x'.repeat(201))]){
  const result=await f.app.inject({url:'/api/skill-catalog'+query,headers:f.headers});expect(result.statusCode,query).toBe(400);expect(result.body).not.toContain(f.root);
 }
});
