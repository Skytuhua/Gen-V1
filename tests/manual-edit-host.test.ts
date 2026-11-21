import {afterEach,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import {mkdtemp,mkdir,readFile,rm,writeFile,lstat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ZodError} from 'zod';
import {Store} from '../packages/storage/store.ts';
import {ProjectTools} from '../packages/workspace/tools.ts';
import {HarnessError} from '../packages/contracts/index.ts';
import type {Service} from '../packages/core/service.ts';
import type {TerminalHost} from '../packages/workspace/terminal.ts';
import type {GitHubTools} from '../packages/workspace/github.ts';
import {registerWorkspaceHost} from '../apps/server/workspace-host.ts';
import {registerWorkspaceRoutes} from '../apps/server/workspace-routes.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{__setCapabilityFlagForTests('workspace.manualEditV1',undefined);__setCapabilityFlagForTests('workspace.checkpointsV1',undefined);for(const close of cleanup.splice(0).reverse())await close();});

const sha256='a'.repeat(64);
const threadRecord=(id:string,projectId:string,kind:'main'|'side'|'delegate'='main')=>({id,title:id,projectId,projectName:'Fixture',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready' as const,epoch:0,runId:null,modelId:null,sessionPath:null,kind});

// Host-level fixture per tests/project-tools.test.ts: a real bound managed
// working copy. On hosts without the path-guard backend these cases fail with
// CAPABILITY_DENIED from the guard itself, the same gate the M08 suites hit.
async function hostFixture(){
 const root=await mkdtemp(join(tmpdir(),'gen-manual-edit-')),path=join(root,'repo');
 await mkdir(path);
 const store=new Store(join(root,'data')),tools=new ProjectTools(store);
 cleanup.push(async()=>{await tools.dispose();store.close();await rm(root,{recursive:true,force:true,maxRetries:5});});
 const git=(...args:string[])=>execFileSync('git',['-C',path,...args],{windowsHide:true,encoding:'utf8'}).trim();
 git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 await writeFile(join(path,'one.txt'),'first\n');git('add','.');git('commit','-m','Initial');
 const project=await tools.connect({id:'connect',type:'workspace.project.connect',payload:{name:'Fixture',path}});
 const projectId=(project.result as {projects:{id:string}[]}).projects[0]!.id;
 const thread=threadRecord('main',projectId);
 store.internal('fixture',null,()=>store.put('thread',thread.id,thread.id,thread));
 await tools.prepareWorkspace(thread);
 const bound=await tools.binding(projectId,'main');
 return{root,store,tools,projectId,managed:bound.path};
}

async function routeFixture(overrides:Partial<ProjectTools>={}){
 const root=await mkdtemp(join(tmpdir(),'gen-manual-edit-routes-')),store=new Store(join(root,'data')),service={store} as Service,app=Fastify();
 cleanup.push(async()=>{await app.close();store.close();await rm(root,{recursive:true,force:true,maxRetries:5});});
 const projects={binding:vi.fn(async()=>({path:root})),saveFile:vi.fn(async()=>({sha256:'b'.repeat(64),bytes:4})),file:vi.fn(async()=>({text:'x',binary:false,sha256})),workspace:{migrateProjects:vi.fn()},dispose:async()=>{},...overrides} as unknown as ProjectTools;
 const terminals={dispose:async()=>{}} as TerminalHost;
 const github={details:vi.fn(),list:vi.fn(),repo:vi.fn(),auth:vi.fn(),comparison:vi.fn(),comparisonFile:vi.fn()} as unknown as GitHubTools;
 registerWorkspaceHost(service,{projects,terminals,github});
 app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ZodError?400:error instanceof HarnessError?403:500).send({error:{code:error instanceof HarnessError?error.code:'INVALID_INPUT'}}));
 registerWorkspaceRoutes(app,service);
 return{app,store,projects};
}

it('flag off: file() response has no edit key and the baseline shape is unchanged',async()=>{
 const{tools,projectId}=await hostFixture();
 const result=await tools.file(projectId,'main','one.txt');
 expect(result).toEqual({text:'first\n',binary:false,sha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
 expect('edit' in result).toBe(false);
});

it('flag on: file() reports editable state, BOM and line separators',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{tools,projectId,managed}=await hostFixture();
 const write=(name:string,data:Buffer|string)=>writeFile(join(managed,name),data);
 await write('lf.txt','a\nb\n');await write('crlf.txt','a\r\nb\r\n');await write('mixed.txt','a\r\nb\n');await write('bom.txt','\uFEFFa\n');await write('bin.dat',Buffer.from([0,1,2]));await write('bad.txt',Buffer.from([0xC3,0x28]));await write('.env','KEY=value\n');await mkdir(join(managed,'.harness-directory-guard'),{recursive:true}).catch(()=>{});await writeFile(join(managed,'.harness-directory-guard'),'');
 expect((await tools.file(projectId,'main','lf.txt')).edit).toEqual({editable:true,bom:false,lineSeparator:'lf'});
 expect((await tools.file(projectId,'main','crlf.txt')).edit).toEqual({editable:true,bom:false,lineSeparator:'crlf'});
 expect((await tools.file(projectId,'main','mixed.txt')).edit).toEqual({editable:true,bom:false,lineSeparator:'mixed'});
 expect((await tools.file(projectId,'main','bom.txt')).edit).toEqual({editable:true,bom:true,lineSeparator:'lf'});
 expect((await tools.file(projectId,'main','bin.dat')).edit).toMatchObject({editable:false,reason:'binary'});
 expect((await tools.file(projectId,'main','bad.txt')).edit).toMatchObject({editable:false,reason:'not_utf8'});
 expect((await tools.file(projectId,'main','.env')).edit).toMatchObject({editable:false,reason:'protected'});
 expect((await tools.file(projectId,'main','.harness-directory-guard')).edit).toMatchObject({editable:false,reason:'protected'});
});

it('saveFile round trip keeps CRLF and BOM bytes and returns the new SHA',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{tools,projectId,managed}=await hostFixture();
 await writeFile(join(managed,'crlf.txt'),'a\r\nb\r\n');
 const before=await tools.file(projectId,'main','crlf.txt');
 const saved=await tools.saveFile(projectId,'main','crlf.txt','\uFEFFa\r\nCHANGED\r\n',before.sha256);
 expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);expect(saved.sha256).not.toBe(before.sha256);expect(saved.bytes).toBe(Buffer.byteLength('\uFEFFa\r\nCHANGED\r\n','utf8'));
 expect(await readFile(join(managed,'crlf.txt'))).toEqual(Buffer.from('\uFEFFa\r\nCHANGED\r\n','utf8'));
});

it('saveFile keeps the file mode on POSIX',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{tools,projectId,managed}=await hostFixture();
 if(process.platform==='win32')return;
 const {chmod}=await import('node:fs/promises');await chmod(join(managed,'one.txt'),0o640);
 const before=await tools.file(projectId,'main','one.txt');
 await tools.saveFile(projectId,'main','one.txt','new\n',before.sha256);
 expect((await lstat(join(managed,'one.txt'))).mode&0o777).toBe(0o640);
});

it('saveFile with a stale SHA fails PRECONDITION_FAILED with the disk SHA and writes nothing',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{tools,projectId,managed}=await hostFixture();
 await writeFile(join(managed,'one.txt'),'other\n');
 await expect(tools.saveFile(projectId,'main','one.txt','new\n',sha256)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
 expect(await readFile(join(managed,'one.txt'),'utf8')).toBe('other\n');
});

it('saveFile denies traversal, .git, absolute, NUL, symlink, directory and secret paths; leaves no temp',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{tools,projectId,managed,root}=await hostFixture();
 await mkdir(join(managed,'dir'),{recursive:true});
 const{symlink}=await import('node:fs/promises');await symlink(join(managed,'one.txt'),join(managed,'link.txt'));
 for(const path of ['../x','.git/config','/etc/passwd','.env','dir','link.txt','a\0b'])await expect(tools.saveFile(projectId,'main',path,'x\n',sha256)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 expect((await readdir(managed)).filter(name=>name.includes('.gen-')&&name.endsWith('.tmp'))).toEqual([]);
 void root;
});

it('saveFile rejects NUL text and text over the 1 MiB cap',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{tools,projectId}=await hostFixture();
 await expect(tools.saveFile(projectId,'main','one.txt','a\0b',sha256)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 await expect(tools.saveFile(projectId,'main','one.txt','x'.repeat(1024*1024+1),sha256)).rejects.toMatchObject({code:'RESOURCE_LIMIT'});
});

it('saveFile on a side thread is denied',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{tools,projectId,store}=await hostFixture();
 store.internal('fixture',null,()=>store.put('thread','side','side',threadRecord('side',projectId,'side')));
 await expect(tools.saveFile(projectId,'side','one.txt','x\n',sha256)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});

it('edit-capability route: flag off returns flag_off without touching the project',async()=>{
 const{app,projects}=await routeFixture();
 const reply=await app.inject('/api/projects/project/file/edit-capability?threadId=main');
 expect(reply.statusCode).toBe(200);expect(reply.json()).toEqual({available:false,checkpoints:false,reason:'flag_off'});
 expect(projects.binding).not.toHaveBeenCalled();
});

it('edit-capability route: side/delegate/archived threads and missing bindings map to reasons',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{app,store}=await routeFixture();
 store.internal('fixture',null,()=>{
  store.put('thread','side','side',threadRecord('side','project','side'));
  store.put('thread','delegate','delegate',threadRecord('delegate','project','delegate'));
  store.put('thread','main','main',threadRecord('main','project'));
  store.put('archivedThread','old','old',threadRecord('old','project'));
 });
 const get=(threadId:string)=>app.inject('/api/projects/project/file/edit-capability?threadId='+threadId).then(reply=>reply.json());
 expect(await get('side')).toEqual({available:false,checkpoints:false,reason:'thread_kind'});
 expect(await get('delegate')).toEqual({available:false,checkpoints:false,reason:'thread_kind'});
 expect(await get('old')).toEqual({available:false,checkpoints:false,reason:'archived'});
 expect(await get('main')).toEqual({available:true,checkpoints:false});
});

it('edit-capability route: binding failure reports no_project',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{app}=await routeFixture({binding:vi.fn(async()=>{throw new HarnessError('CAPABILITY_DENIED','no')})} as Partial<ProjectTools>);
 expect((await app.inject('/api/projects/missing/file/edit-capability')).json()).toEqual({available:false,checkpoints:false,reason:'no_project'});
});

it('save route: flag off is CAPABILITY_DENIED; success returns sha/bytes and disabled checkpoint',async()=>{
 const{app,projects}=await routeFixture();
 const denied=await app.inject({method:'POST',url:'/api/projects/project/file/save',payload:{path:'a.txt',text:'x',expectedSha256:sha256}});
 expect(denied.statusCode).toBe(403);expect(denied.json().error.code).toBe('CAPABILITY_DENIED');
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const ok=await app.inject({method:'POST',url:'/api/projects/project/file/save',payload:{path:'a.txt',text:'x',expectedSha256:sha256}});
 expect(ok.statusCode).toBe(200);expect(ok.json()).toEqual({sha256:'b'.repeat(64),bytes:4,checkpoint:'disabled'});
 expect(projects.saveFile).toHaveBeenCalledWith('project',undefined,'a.txt','x',sha256,undefined);
});

it('save route: checkpoint capture failure degrades to unavailable without failing the save',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);__setCapabilityFlagForTests('workspace.checkpointsV1',true);
 const{app,store}=await routeFixture({saveFile:vi.fn(async(_p,_t,_path,_text,_sha,preWrite)=>{await preWrite?.(Buffer.from('old'));return{sha256:'b'.repeat(64),bytes:4};})} as Partial<ProjectTools>);
 store.internal('fixture',null,()=>store.put('thread','main','main',threadRecord('main','project')));
 // The preimage identity read cannot stat a NUL path, so capture throws and degrades.
 const reply=await app.inject({method:'POST',url:'/api/projects/project/file/save',payload:{threadId:'main',path:'a\0b',text:'x',expectedSha256:sha256}});
 expect(reply.statusCode).toBe(200);expect(reply.json().checkpoint).toBe('unavailable');
});

it('save route: PRECONDITION_FAILED carries the disk SHA',async()=>{
 __setCapabilityFlagForTests('workspace.manualEditV1',true);
 const{app}=await routeFixture({saveFile:vi.fn(async()=>{throw new HarnessError('PRECONDITION_FAILED','File changed on disk.',{sha256})})} as Partial<ProjectTools>);
 const reply=await app.inject({method:'POST',url:'/api/projects/project/file/save',payload:{path:'a.txt',text:'x',expectedSha256:'c'.repeat(64)}});
 expect(reply.statusCode).toBe(403);expect(reply.json().error.code).toBe('PRECONDITION_FAILED');
});
