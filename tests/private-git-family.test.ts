import {afterEach,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {link,lstat,mkdir,mkdtemp,open,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {ProjectTools} from '../packages/workspace/tools.ts';
import {assertNotStorage} from '../packages/core/security.ts';
import type {Thread} from '../packages/contracts/index.ts';
import {copyBoundGitMetadata,withPathGuard} from '../packages/core/file-access.ts';
import {directoryIdentity,withLegacyGitView,type PrivateGitFamily} from '../packages/workspace/git-storage.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'gen-private-family-')),path=join(root,'source');await mkdir(path);
 const store=new Store(join(root,'data')),tools=new ProjectTools(store,{git:'C:/Program Files/Git/cmd/git.exe'});
 cleanup.push(async()=>{await tools.dispose();store.close();await rm(root,{recursive:true,force:true,maxRetries:5});});
 const git=(...args:string[])=>execFileSync('git',['-C',path,...args],{windowsHide:true,encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 await writeFile(join(path,'.gitignore'),'node_modules/\n');await writeFile(join(path,'one.txt'),'base\n');git('add','.');git('commit','-qm','base');
 const receipt=await tools.connect({id:'connect',type:'workspace.project.connect',payload:{name:'Fixture',path}}),projectId=(receipt.result as {projects:{id:string}[]}).projects[0]!.id;
 const thread=(id:string):Thread=>({id,title:id,projectId,projectName:'Fixture',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready',epoch:0,runId:null,modelId:null,sessionPath:null,kind:'main'});
 const add=async(id:string)=>{const item=thread(id);store.internal('fixture',null,()=>store.put('thread',id,id,item));await tools.prepareWorkspace(item);return tools.binding(projectId,id);};
 return{root,path,store,tools,git,projectId,add};
}
it('imports once into protected private bare storage and creates three independent native worktrees',async()=>{
 const f=await fixture(),bindings=await Promise.all(['one','two','three'].map(f.add));
 expect(new Set(bindings.map(x=>x.path)).size).toBe(3);
 const family=f.store.get<{commonDirectory:string}>('workspaceGitFamily',f.projectId)!;
 expect(family.commonDirectory).toBe(join(f.store.dataDir,'git',f.projectId,'repository.git'));
 expect(()=>assertNotStorage(family.commonDirectory,f.store.dataDir)).toThrow(/storage/i);
 for(const binding of bindings){expect(binding.workspace?.commonDirectory).toBe(family.commonDirectory);expect(binding.workspace?.familyId).toBe(f.projectId);}
 const one=bindings[0]!;await writeFile(join(one.path,'one.txt'),'staged\n');
 let status=await f.tools.gitStatus(f.projectId,'one');expect(status).toMatchObject({mode:'managed',gitWrite:true,untrackedIncluded:true});
 await f.tools.gitAction(f.projectId,'one',{type:'stage',paths:['one.txt'],revision:status.revision});await writeFile(join(one.path,'one.txt'),'working\n');
 status=await f.tools.gitStatus(f.projectId,'one');expect(status.diff).toContain('+working');expect(status.stagedDiff).toContain('+staged');
 const committed=await f.tools.gitAction(f.projectId,'one',{type:'commit',message:'Managed fixture',revision:status.revision});expect(committed.head).not.toBe(status.head);
 const branched=await f.tools.gitAction(f.projectId,'one',{type:'branch',name:'fixture/independent',revision:committed.revision});expect(branched.branch).toBe('fixture/independent');
 expect((await f.tools.gitStatus(f.projectId,'two')).files).toHaveLength(0);expect((await f.tools.gitStatus(f.projectId,'three')).head).toBe(status.head);expect(await readFile(join(f.path,'one.txt'),'utf8')).toBe('base\n');
},60000);
it('does not consume original metadata after private import and ignores dependency bulk for managed status',async()=>{
 const f=await fixture(),binding=await f.add('one');await rename(join(f.path,'.git'),join(f.path,'original-metadata'));
 await mkdir(join(binding.path,'node_modules'));for(let start=0;start<10010;start+=100)await Promise.all(Array.from({length:Math.min(100,10010-start)},(_,i)=>writeFile(join(binding.path,'node_modules',String(start+i)),'dependency')));
 await writeFile(join(binding.path,'new.bin'),Buffer.from([0,1,2,3]));const status=await f.tools.gitStatus(f.projectId,'one');
 expect(status.files).toEqual([expect.objectContaining({path:'new.bin',untracked:true,binary:true})]);
 await f.tools.gitAction(f.projectId,'one',{type:'stage',paths:['new.bin'],revision:status.revision});await writeFile(join(binding.path,'new.bin'),Buffer.from([0,5,2,3]));const binary=await f.tools.gitStatus(f.projectId,'one');
 expect(binary.files[0]?.binary).toBe(true);expect(binary.diff).toContain('Binary files');expect(binary.diff).toMatch(/index [0-9a-f]{40}\.\.[0-9a-f]{40}/);expect(binary.diff).not.toContain('GIT binary patch');
},60000);
it('keeps original bindings in place, reports tracked-only coverage and rejects legacy mutations',async()=>{
 const f=await fixture();await writeFile(join(f.path,'one.txt'),'legacy change\n');await writeFile(join(f.path,'untracked.txt'),'hidden from tracked projection');
 const status=await f.tools.gitStatus(f.projectId);expect(status).toMatchObject({mode:'legacy',gitWrite:false,untrackedIncluded:false});expect(status.diff).toContain('+legacy change');
 expect((await f.tools.binding(f.projectId)).path).toBe(f.path);expect(status.files.map(x=>x.path)).toEqual(['one.txt']);
 await expect(f.tools.gitAction(f.projectId,undefined,{type:'stage',paths:['one.txt'],revision:status.revision})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 f.git('commit','-qam','external');await rm(join(f.path,'one.txt'));expect((await f.tools.gitStatus(f.projectId)).files).toContainEqual(expect.objectContaining({path:'one.txt',worktree:'D'}));
},60000);
it.each(['identity','gitDirectoryIdentity','commonDirectoryIdentity']as const)('refuses stored %s substitution before managed Git starts',async(field)=>{
 const f=await fixture(),binding=await f.add('one'),saved=binding.workspace!;
 f.store.internal('fixture',null,()=>f.store.put('workspaceBinding',saved.id,'one',{...saved,[field]:{dev:'0',ino:'0'}}));
 await expect(f.tools.gitStatus(f.projectId,'one')).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 expect((await lstat(join(f.path,'.git'))).isDirectory()).toBe(true);
});
it.each(['include','alternates','hardlink']as const)('refuses untrusted metadata %s during import without publishing a usable family',async(kind)=>{
 const f=await fixture();
 if(kind==='include')await writeFile(join(f.path,'.git','config'),'[include]\npath = elsewhere\n');
 if(kind==='alternates'){await mkdir(join(f.path,'.git','objects','info'),{recursive:true});await writeFile(join(f.path,'.git','objects','info','alternates'),'elsewhere\n');}
 if(kind==='hardlink')await link(join(f.path,'.git','HEAD'),join(f.root,'linked-head'));
 await expect(f.add('denied')).rejects.toMatchObject({code:'CAPABILITY_DENIED'});expect(f.store.get('workspaceGitFamily',f.projectId)).toBeNull();expect((await f.tools.binding(f.projectId,'denied')).path).toBe(f.path);
});
it('streams metadata beyond the unchanged ordinary snapshot budget with a bounded buffer',async()=>{
 const f=await fixture(),metadata=join(f.root,'metadata'),destination=join(f.root,'copied');await mkdir(metadata);const large=join(metadata,'pack'),file=await open(large,'wx');try{await file.truncate(65*1024*1024);}finally{await file.close();}
 const signal=new AbortController().signal;
 await expect(withPathGuard([{path:metadata,leaf:false,tree:true,readOnly:true}],signal,async()=>true)).rejects.toMatchObject({code:'RESOURCE_LIMIT'});
 await withPathGuard([{path:metadata,leaf:false,tree:true,readOnly:true,gitMetadataImport:true}],signal,async entries=>{expect(entries).toHaveLength(1);await copyBoundGitMetadata(entries[0]!,destination,signal,()=>{});});
 expect((await lstat(destination)).size).toBe(65*1024*1024);expect((await lstat(destination)).nlink).toBe(1);
},60000);
it('imports safe author and GitHub origin scalars and drops arbitrary source configuration',async()=>{
 const f=await fixture();f.git('remote','add','origin','https://github.com/example/project.git');f.git('config','credential.helper','DO_NOT_EXECUTE');f.git('config','core.worktree',join(f.root,'elsewhere'));f.git('config','maintenance.strategy','DO_NOT_EXECUTE');
 const binding=await f.add('one'),config=await readFile(join(binding.workspace!.commonDirectory,'config'),'utf8');
 expect(config).toContain('fixture@example.invalid');expect(config).toContain('https://github.com/example/project.git');expect(config).not.toMatch(/DO_NOT_EXECUTE|worktree\s*=/);
 expect((await f.tools.git(binding.path,['remote','get-url','origin'])).trim()).toBe('https://github.com/example/project.git');
});
it('keeps a failed import unavailable and supports ordinary non-Git project sessions',async()=>{
 const f=await fixture();await mkdir(join(f.path,'.git','objects','pack'),{recursive:true});await writeFile(join(f.path,'.git','objects','pack','pack-'+ '0'.repeat(40)+'.pack'),'invalid pack');
 await expect(f.add('broken')).rejects.toThrow();expect(f.store.get('workspaceGitFamily',f.projectId)).toBeNull();expect((await lstat(join(f.path,'.git'))).isDirectory()).toBe(true);
 const plain=join(f.root,'plain');await mkdir(plain);const result=await f.tools.connect({id:'plain',type:'workspace.project.connect',payload:{name:'Plain',path:plain}}),project=(result.result as {projects:{id:string;rootPath?:string}[]}).projects.find(p=>p.rootPath===plain)!;
 const thread={id:'plain',title:'Plain',projectId:project.id,projectName:'Plain',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready' as const,epoch:0,runId:null,modelId:null,sessionPath:null,kind:'main' as const};f.store.internal('fixture',null,()=>f.store.put('thread',thread.id,thread.id,thread));await expect(f.tools.prepareWorkspace(thread)).resolves.toBeUndefined();expect((await f.tools.binding(project.id,thread.id)).path).toBe(plain);
},60000);
it('refuses a legacy scratch view inside a broad source grant',async()=>{
 const f=await fixture();await f.add('one');const family=f.store.get<PrivateGitFamily>('workspaceGitFamily',f.projectId)!;
 await expect(withLegacyGitView(family,tmpdir(),undefined,'git',new AbortController().signal,async()=>true,await directoryIdentity(tmpdir()))).rejects.toThrow(/outside source grants/);
});
it('keeps incremental legacy objects out of the authoritative managed family',async()=>{
 const f=await fixture(),binding=await f.add('one'),common=binding.workspace!.commonDirectory;
 const wanted='planned fixture content\n',foreign='different fixture content\n';
 const object=(text:string)=>Buffer.concat([Buffer.from('blob '+Buffer.byteLength(text)+'\0'),Buffer.from(text)]),oid=createHash('sha1').update(object(wanted)).digest('hex');
 const sourceObject=join(f.path,'.git','objects',oid.slice(0,2),oid.slice(2));await mkdir(join(f.path,'.git','objects',oid.slice(0,2)),{recursive:true});await writeFile(sourceObject,deflateSync(object(foreign)));
 await f.tools.gitStatus(f.projectId);
 await expect(lstat(join(common,'objects',oid.slice(0,2),oid.slice(2)))).rejects.toMatchObject({code:'ENOENT'});
 await writeFile(join(binding.path,'future.txt'),wanted);const before=await f.tools.gitStatus(f.projectId,'one');
 await f.tools.gitAction(f.projectId,'one',{type:'stage',paths:['future.txt'],revision:before.revision});
 expect(execFileSync('git',['--git-dir='+common,'cat-file','blob',oid],{windowsHide:true,encoding:'utf8'})).toBe(wanted);
 execFileSync('git',['--git-dir='+common,'fsck','--full','--no-reflogs'],{windowsHide:true,stdio:'pipe'});
},60000);
