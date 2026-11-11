import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,lstat,realpath,rm,symlink,link,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {SkillCatalogRepository} from '../packages/skill-catalog/repository.ts';
import {directoryCatalog,parseSkillMetadata} from '../packages/skill-catalog/filesystem.ts';
import {harnessCatalog,bundledCatalog,projectCatalog,installedAppCatalog,createPersonalSkillCatalog} from '../packages/skill-catalog/adapters.ts';
import {Store} from '../packages/storage/store.ts';
import {applySkillOperations} from '../packages/core/skills.ts';
import type {SkillCatalogPage} from '../packages/contracts/skill-catalog.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){
 const base=await realpath(tmpdir()),root=await mkdtemp(join(base,'gen-skcat-'));
 cleanups.push(async()=>{if(await realpath(root)!==resolve(root)||!root.startsWith(base+sep)||(await lstat(root)).isSymbolicLink())throw Error('Unsafe fixture cleanup');await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const skills=join(root,'skills');await mkdir(skills);
 const skill=async(name:string,description='Metadata only',body='UNTRUSTED: $(touch forbidden); never execute this.',support?:string)=>{
  const path=join(skills,name);await mkdir(path,{recursive:true});await writeFile(join(path,'SKILL.md'),`---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n${body}`);if(support!==undefined)await writeFile(join(path,'support.bin'),support);return path;
 };
 const provider=directoryCatalog({id:'personal:test',kind:'personal',label:'Personal',root:skills});
 return{root,skills,skill,provider,repo:new SkillCatalogRepository([provider])};
}
async function all(repo:SkillCatalogRepository,limit=7){let cursor:string|undefined;const entries:SkillCatalogPage['skills']=[];do{const page=await repo.list({limit,cursor});entries.push(...page.skills);cursor=page.nextCursor??undefined;}while(cursor);return entries;}

it('enumerates every page, keeps colliding names distinct, and exposes metadata without source bytes',async()=>{
 const f=await fixture();for(let i=0;i<25;i++)await f.skill(`skill-${i}`);
 const store=new Store(join(f.root,'data'));cleanups.push(async()=>store.close());
 store.internal('test.seed',null,()=>applySkillOperations(store,[{action:'create',name:'skill-0',baseRevision:0,description:'Harness record',content:'HARNESS-BODY'}],{kind:'user'}));
 const repo=new SkillCatalogRepository([f.provider,harnessCatalog(store)]),entries=await all(repo);
 expect(entries).toHaveLength(26);expect(new Set(entries.map(e=>e.id)).size).toBe(26);expect(entries.filter(e=>e.name==='skill-0')).toHaveLength(2);
 expect(new Set(entries.map(e=>e.sourceId))).toEqual(new Set(['personal:test','harness:library']));
 expect(JSON.stringify(entries)).not.toMatch(/UNTRUSTED|HARNESS-BODY|support\.bin|gen-skcat-/);
 expect(await all(repo)).toEqual(entries);
});

it('pins exact bytes and supporting-file custody, rejecting edits even when size and display name stay equal',async()=>{
 const f=await fixture(),path=await f.skill('multi word name','A description','body','first');
 const first=(await f.repo.list()).skills[0];expect(first.files).toBe(2);expect(first.ref).toMatchObject({sourceId:'personal:test',digest:expect.stringMatching(/^[a-f0-9]{64}$/)});
 const receipt=await f.repo.checkReference(first.ref!);expect(receipt.files).toHaveLength(2);expect(receipt.files.find(file=>file.path==='support.bin')).toMatchObject({digest:expect.any(String),identity:{dev:expect.any(String),ino:expect.any(String)}});
 await writeFile(join(path,'support.bin'),'other');
 const changed=(await f.repo.list()).skills[0];expect(changed.id).toBe(first.id);expect(changed.ref?.revision).not.toBe(first.ref?.revision);
 await expect(f.repo.checkReference(first.ref!)).rejects.toMatchObject({code:'SKILL_CATALOG_CHANGED'});
});

it('binds authenticated cursors to inventory, search, page size and connection context',async()=>{
 const f=await fixture();for(let i=0;i<4;i++)await f.skill(`item-${i}`);
 const page=await f.repo.list({limit:1,query:'item'});expect(page.nextCursor).toBeTruthy();
 for(const options of [{limit:2,query:'item'},{limit:1,query:'other'},{limit:1,query:'item',threadId:'different'}])await expect(f.repo.list({...options,cursor:page.nextCursor!})).rejects.toMatchObject({code:'INVALID_CURSOR'});
 const cursor=page.nextCursor!,index=cursor.length-5,tampered=cursor.slice(0,index)+(cursor[index]==='a'?'b':'a')+cursor.slice(index+1);
 await expect(f.repo.list({limit:1,query:'item',cursor:tampered})).rejects.toMatchObject({code:'INVALID_CURSOR'});
 await f.skill('item-new');await expect(f.repo.list({limit:1,query:'item',cursor})).rejects.toMatchObject({code:'SKILL_CATALOG_CHANGED'});
});

it('denies file/directory symlinks and hardlinks while retaining other safe packages',async()=>{
 const f=await fixture(),safe=await f.skill('safe'),bad=await f.skill('bad');
 await link(join(safe,'SKILL.md'),join(bad,'linked.md'));
 const linked=join(f.skills,'redirected');await symlink(safe,linked,process.platform==='win32'?'junction':'dir');
 const entries=await all(f.repo);expect(entries.find(e=>e.name==='bad')?.availability).toMatchObject({status:'unavailable',reason:'denied'});
 expect(entries.find(e=>e.name==='redirected')?.ref).toBeNull();expect(entries.find(e=>e.name==='safe')?.ref).toBeNull();
});

it('bounds file counts and bytes without truncating a package into an available reference',async()=>{
 const f=await fixture(),path=await f.skill('large');await writeFile(join(path,'huge.bin'),Buffer.alloc(1025));
 const provider=directoryCatalog({id:'bounded',kind:'personal',label:'Personal',root:f.skills,limits:{fileBytes:1024}});
 expect((await new SkillCatalogRepository([provider]).list()).skills[0]).toMatchObject({ref:null,availability:{status:'unavailable',reason:'limit'}});
 const count=directoryCatalog({id:'bounded',kind:'personal',label:'Personal',root:f.skills,limits:{files:1}});
 expect((await new SkillCatalogRepository([count]).list()).skills[0].availability).toMatchObject({status:'unavailable',reason:'limit'});
});

it('marks an exhausted root inventory unavailable instead of silently presenting a partial catalog',async()=>{
 const f=await fixture();await f.skill('folder/child');
 const provider=directoryCatalog({id:'bounded-root',kind:'personal',label:'Personal',root:f.skills,limits:{entries:2}});
 const page=await new SkillCatalogRepository([provider]).list();expect(page.sources[0].availability).toEqual({status:'unavailable',reason:'limit'});expect(page.skills).toEqual([]);
});

it('counts bytes consumed by rejected packages against the root budget',async()=>{
 const f=await fixture();for(const name of ['invalid-a','invalid-b']){const path=await f.skill(name);await writeFile(join(path,'SKILL.md'),'---\nname: invalid\n---\n'+'x'.repeat(160));}
 const provider=directoryCatalog({id:'bounded-root',kind:'personal',label:'Personal',root:f.skills,limits:{rootBytes:250}});
 expect((await new SkillCatalogRepository([provider]).list()).sources[0].availability).toEqual({status:'unavailable',reason:'limit'});
});

it('rejects namespace escalation and source substitution without resolving a display name',async()=>{
 const f=await fixture();await f.skill('same');const ref=(await f.repo.list()).skills[0].ref!;
 await expect(f.repo.checkReference({...ref,scope:{kind:'provider',providerId:'private',scopeId:'private'}})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 await expect(f.repo.checkReference({...ref,sourceId:'other'})).rejects.toMatchObject({code:'SKILL_CATALOG_CHANGED'});
});

it('accepts bound references for the full declared source-identity length',async()=>{
 const f=await fixture();await f.skill('procedure');const repo=new SkillCatalogRepository([directoryCatalog({id:'s'.repeat(240),kind:'personal',label:'Personal',root:f.skills})]);
 const entry=(await repo.list()).skills[0];expect((await repo.checkReference(entry.ref!)).files).toHaveLength(1);
});

it('parses quoted, folded and literal descriptions as data and rejects duplicate/invalid metadata',()=>{
 expect(parseSkillMetadata('---\r\nname: "multi word"\r\ndescription: >-\r\n  First line\r\n  second line\r\nmetadata:\r\n  command: $(do-not-run)\r\n---\r\nBODY')).toEqual({name:'multi word',description:'First line second line'});
 expect(parseSkillMetadata("---\nname: 'quoted ''name'''\ndescription: |\n  One\n  Two\n---\nBODY")).toEqual({name:"quoted 'name'",description:'One Two'});
 for(const text of ['---\nname: x\nname: y\ndescription: d\n---','---\nname: x\ndescription: !execute something\n---','---\nname: [x]\ndescription: d\n---'])expect(()=>parseSkillMetadata(text)).toThrow();
});

it('includes nested installed skill entries beneath another skill package',async()=>{
 const f=await fixture();await f.skill('outer');await f.skill('outer/nested');
 const entries=await all(f.repo);expect(entries.map(e=>e.name).sort()).toEqual(['outer','outer/nested']);expect(entries.every(e=>e.ref)).toBe(true);
});

it('keeps a root skill distinct from a child named after the root directory',async()=>{
 const f=await fixture();await writeFile(join(f.skills,'SKILL.md'),'---\nname: Root skill\ndescription: Metadata\n---\nbody');await f.skill('skills');
 const entries=await all(f.repo);expect(entries).toHaveLength(2);expect(new Set(entries.map(e=>e.id)).size).toBe(2);
});

it('reads YAML multiline quoted display metadata used by installed catalogs',()=>{
 expect(parseSkillMetadata('---\nname: seo\ndescription: "First line\n  second line. Use when \\"quoted\\".\n  Last line."\n---\nBody')).toEqual({name:'seo',description:'First line second line. Use when "quoted". Last line.'});
});

it('detects replacement during capture and never returns mixed metadata/custody',async()=>{
 const f=await fixture(),path=await f.skill('racing');let fired=false;
 const provider=directoryCatalog({id:'race',kind:'personal',label:'Personal',root:f.skills,beforeCapture:async()=>{if(!fired){fired=true;await rename(path,path+'-old');await f.skill('racing','Replacement');}}});
 expect((await new SkillCatalogRepository([provider]).list()).skills.find(e=>e.name==='racing')?.ref).toBeNull();
});

it('uses canonical connected project/worktree bindings and separates unavailable project authority',async()=>{
 const f=await fixture(),store=new Store(join(f.root,'data'));cleanups.push(async()=>store.close());
 const project=join(f.root,'project');await mkdir(join(project,'.agents','skills','project-skill'),{recursive:true});await writeFile(join(project,'.agents','skills','project-skill','SKILL.md'),'---\nname: Project skill\ndescription: From connected root\n---\nprivate body');
 const info=await lstat(project,{bigint:true});store.internal('test.seed',null,()=>{store.put('workspaceProject','project',null,{id:'project',name:'Connected',authority:{kind:'local'},createdAt:new Date().toISOString()});store.put('workspaceProjectRoot','project',null,{path:project,identity:{dev:String(info.dev),ino:String(info.ino)}});});
 const repo=new SkillCatalogRepository([projectCatalog(store)]);
 expect((await repo.list({projectId:'project'})).skills.some(e=>e.name==='Project skill')).toBe(true);
 store.internal('test.seed',null,()=>store.put('workspaceProjectRoot','project',null,{path:project,identity:{dev:'0',ino:'0'}}));
 expect((await repo.list({projectId:'project'})).sources[0].availability).toMatchObject({status:'unavailable',reason:'denied'});
 store.internal('test.seed',null,()=>store.put('workspaceProject','private',null,{id:'private',name:'Must not discover',authority:{kind:'plugin',pluginId:'other',scopeId:'private'}}));
 expect((await repo.list({projectId:'private'})).skills).toEqual([]);
 expect(JSON.stringify(await repo.list({projectId:'private'}))).not.toContain('Must not discover');
});

it('discovers only the selected worktree and invalidates its references after rebinding or revocation',async()=>{
 const f=await fixture(),store=new Store(join(f.root,'data'));cleanups.push(async()=>store.close());
 const original=join(f.root,'project'),working=join(f.root,'working');
 for(const [path,name]of [[original,'Original only'],[working,'Worktree only']]){await mkdir(join(path,'.agents','skills','procedure'),{recursive:true});await writeFile(join(path,'.agents','skills','procedure','SKILL.md'),`---\nname: ${name}\ndescription: Connected\n---\nbody`);}
 const rootInfo=await lstat(original,{bigint:true}),workingInfo=await lstat(working,{bigint:true});
 const rootIdentity={dev:String(rootInfo.dev),ino:String(rootInfo.ino)},workingIdentity={dev:String(workingInfo.dev),ino:String(workingInfo.ino)};
 store.internal('test.seed',null,()=>{store.put('workspaceProject','project',null,{id:'project',name:'Connected',authority:{kind:'local'},createdAt:new Date().toISOString()});store.put('workspaceProjectRoot','project',null,{path:original,identity:rootIdentity});store.put('workspaceBinding','working',null,{id:'working',projectId:'project',threadId:'thread',path:working,identity:workingIdentity});store.put('thread','thread','thread',{id:'thread',kind:'main',projectId:'project',workspaceId:'working'});});
 const repo=new SkillCatalogRepository([projectCatalog(store)]),page=await repo.list({threadId:'thread'});
 expect(page.skills.map(e=>e.name)).toEqual(['Worktree only']);const ref=page.skills[0].ref!;
 expect((await repo.list({threadId:'thread',projectId:'other'})).skills).toEqual([]);
 store.internal('test.rebind',null,()=>store.put('workspaceBinding','working',null,{id:'working',projectId:'project',threadId:'thread',path:original,identity:rootIdentity}));
 await expect(repo.checkReference(ref,{threadId:'thread'})).rejects.toMatchObject({code:'SKILL_CATALOG_CHANGED'});
 store.internal('test.revoke',null,()=>store.remove('workspaceProjectRoot','project'));
 expect((await repo.list({threadId:'thread'})).sources[0].availability).toEqual({status:'unavailable',reason:'disconnected'});
});

it.each(['title','status','project metadata','working-copy branch'])('preserves exact references and pagination after unrelated %s updates',async(change)=>{
 const f=await fixture(),store=new Store(join(f.root,'stable-data'));cleanups.push(async()=>store.close());
 const original=join(f.root,'original'),working=join(f.root,'working');await mkdir(original);await mkdir(working);
 for(const name of ['alpha','beta']){const folder=join(working,'.agents','skills',name);await mkdir(folder,{recursive:true});await writeFile(join(folder,'SKILL.md'),`---\nname: ${name}\ndescription: Stable binding\n---\nunchanged`);}
 const rootInfo=await lstat(original,{bigint:true}),workingInfo=await lstat(working,{bigint:true});
 const project={id:'project',name:'Connected',authority:{kind:'local'},createdAt:'2026-11-05T00:00:00Z'},thread={id:'thread',kind:'main',projectId:'project',workspaceId:'working',title:'Original',status:'ready'},binding={id:'working',projectId:'project',threadId:'thread',path:working,identity:{dev:String(workingInfo.dev),ino:String(workingInfo.ino)},branch:'first'};
 store.internal('test.seed',null,()=>{store.put('workspaceProject','project',null,project);store.put('workspaceProjectRoot','project',null,{path:original,identity:{dev:String(rootInfo.dev),ino:String(rootInfo.ino)}});store.put('workspaceBinding','working',null,binding);store.put('thread','thread','thread',thread);});
 const repo=new SkillCatalogRepository([projectCatalog(store)]),page=await repo.list({threadId:'thread',limit:1}),ref=page.skills[0].ref!;expect(page.nextCursor).toBeTruthy();
 store.internal('test.unrelated-update',null,()=>{
  if(change==='title')store.put('thread','thread','thread',{...thread,title:'Renamed',updatedAt:'2026-11-05T00:00:01Z'});
  if(change==='status')store.put('thread','thread','thread',{...thread,status:'working',runId:'live-run',epoch:4});
  if(change==='project metadata')store.put('workspaceProject','project',null,{...project,repository:'https://example.test/new-display-metadata'});
  if(change==='working-copy branch')store.put('workspaceBinding','working',null,{...binding,branch:'second'});
 });
 expect((await repo.checkReference(ref,{threadId:'thread'})).files).toHaveLength(1);
 const next=await repo.list({threadId:'thread',limit:1,cursor:page.nextCursor!});expect(next.skills).toHaveLength(1);expect(next.skills[0].id).not.toBe(page.skills[0].id);
 expect((await repo.list({threadId:'thread',limit:1})).skills[0].ref).toEqual(ref);
});

it('reuses the real bundled integration inventory and covers all declared skills across pages',async()=>{
 const manifest=JSON.parse(await readFile(resolve('third-party/integrations/manifest.json'),'utf8')) as {integrations:{skills:unknown[]}[]};
 const repo=new SkillCatalogRepository([bundledCatalog(resolve('.'))]),entries=await all(repo,30);
 expect(entries).toHaveLength(manifest.integrations.reduce((sum,i)=>sum+i.skills.length,0));
 expect(entries.every(e=>e.availability.status==='available')).toBe(true);
 expect(entries.some(e=>e.name==='test-driven-development')).toBe(true);
},60000);

it('reports missing roots and unsupported registries explicitly',async()=>{
 const f=await fixture(),repo=new SkillCatalogRepository([directoryCatalog({id:'missing',kind:'personal',label:'Personal',root:join(f.root,'absent')}),installedAppCatalog({})]);
 const page=await repo.list();expect(page.skills).toEqual([]);expect(page.sources.map(s=>s.availability)).toEqual(expect.arrayContaining([{status:'unavailable',reason:'disconnected'},{status:'unavailable',reason:'unsupported'}]));
});

it('requires composition to supply the installed registry instead of guessing a host plugin directory',async()=>{
 const f=await fixture(),store=new Store(join(f.root,'data'));cleanups.push(async()=>store.close());
 const page=await createPersonalSkillCatalog(store,{personalRoots:[],bundleRoot:join(f.root,'absent')}).list();
 expect(page.sources.find(s=>s.id==='app:registry')?.availability).toEqual({status:'unavailable',reason:'unsupported'});
});
