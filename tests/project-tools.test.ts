import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store} from '../packages/storage/store.ts';
import {ProjectTools} from '../packages/workspace/tools.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'gen-project-')),path=join(root,'repo'),{mkdir}=await import('node:fs/promises');await mkdir(path);const store=new Store(join(root,'data'));const tools=new ProjectTools(store,{git:'C:/Program Files/Git/cmd/git.exe'});cleanup.push(async()=>{await tools.dispose();store.close();await rm(root,{recursive:true,force:true,maxRetries:5});});const git=(...args:string[])=>execFileSync('git',['-C',path,...args],{windowsHide:true,encoding:'utf8'}).trim();git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');await writeFile(join(path,'one.txt'),'first\n');git('add','.');git('commit','-m','Initial');return{root,path,store,tools,git};}
it('enrolls a local project and assigns new agents separate real branches and working copies',async()=>{
 const{path,store,tools}=await fixture();const project=await tools.connect({id:'connect',type:'workspace.project.connect',payload:{name:'Fixture',path}});
 const projectId=(project.result as {projects:{id:string}[]}).projects[0]!.id;
 const thread=(id:string)=>({id,title:id,projectId,projectName:'Fixture',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready' as const,epoch:0,runId:null,modelId:null,sessionPath:null,kind:'main' as const});
 store.internal('fixture',null,()=>{for(const id of ['first','second'])store.put('thread',id,id,thread(id));});
 await Promise.all(['first','second'].map(id=>tools.prepareWorkspace(thread(id))));
 const one=await tools.binding(projectId,'first'),two=await tools.binding(projectId,'second');
 expect(one.path).not.toBe(two.path);expect(one.path).not.toBe(path);
 await writeFile(join(one.path,'one.txt'),'agent one\n');expect(await readFile(join(two.path,'one.txt'),'utf8')).toBe('first\n');expect(await readFile(join(path,'one.txt'),'utf8')).toBe('first\n');
 await tools.prepareWorkspace(store.get('thread','first')!);expect((await tools.binding(projectId,'first')).path).toBe(one.path);
});
it('reports live managed untracked/staged changes and refuses an action against an old revision',async()=>{
 const{path,tools,store}=await fixture(),receipt=await tools.connect({id:'project',type:'workspace.project.connect',payload:{name:'Fixture',path}}),projectId=(receipt.result as {projects:{id:string}[]}).projects[0]!.id;
 const thread={id:'main',title:'Main',projectId,projectName:'Fixture',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'ready' as const,epoch:0,runId:null,modelId:null,sessionPath:null,kind:'main' as const};store.internal('fixture',null,()=>store.put('thread',thread.id,thread.id,thread));await tools.prepareWorkspace(thread);const managed=await tools.binding(projectId,thread.id);
 const before=await tools.gitStatus(projectId,thread.id);await writeFile(join(managed.path,'new.txt'),'new\n');
 const after=await tools.gitStatus(projectId,thread.id);expect(after.files.some(item=>item.path==='new.txt'&&item.untracked)).toBe(true);expect(after.revision).not.toBe(before.revision);
 await expect(tools.gitAction(projectId,thread.id,{type:'stage',paths:['new.txt'],revision:before.revision})).rejects.toThrow(/changed|revision/i);
 await tools.gitAction(projectId,thread.id,{type:'stage',paths:['new.txt'],revision:after.revision});expect((await tools.gitStatus(projectId,thread.id)).files.find(item=>item.path==='new.txt')?.staged).toBe(true);
},60000);
it('rejects a remote company reference and a thread from another project',async()=>{
 const{tools,store}=await fixture();store.internal('fixture',null,()=>{store.put('workspaceProject','remote',null,{id:'remote',name:'Remote',authority:{kind:'company',companyId:'fleet'},rootPath:'C:/',createdAt:new Date().toISOString()});});
 await expect(tools.binding('remote')).rejects.toThrow(/local|authority|company/i);
});
it('keeps Git status inside the enrolled root even when repository config names another worktree',async()=>{
 const{root,path,tools,git}=await fixture(),{mkdir}=await import('node:fs/promises'),other=join(root,'other');await mkdir(other);await writeFile(join(other,'one.txt'),'Other folder contents must not be reviewed.\n');
 const receipt=await tools.connect({id:'scope',type:'workspace.project.connect',payload:{name:'Fixture',path}}),projectId=(receipt.result as {projects:{id:string}[]}).projects[0]!.id;
 git('config','core.worktree',other);const status=await tools.gitStatus(projectId);expect(status.diff).not.toContain('Other folder contents');expect(status.files).toHaveLength(0);
});
