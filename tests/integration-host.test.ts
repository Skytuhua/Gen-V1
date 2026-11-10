import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {WorkspaceRepository} from '../packages/core/workspace-layout.ts';
import {createIntegrationHost} from '../apps/server/integration-host.ts';
import {ModelCapacity} from '../packages/runtime/model-capacity.ts';
import type {RuntimeAdapter,RuntimeCallbacks,StartRun,Thread} from '../packages/contracts/index.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
async function setup(createNativeRuntime?:()=>RuntimeAdapter){const root=await mkdtemp(join(tmpdir(),'harness-integration-host-')),store=new Store(root),stamp=new Date().toISOString();const thread:Thread={id:'owner',title:'owner',projectName:'fixture',projectId:'project',createdAt:stamp,updatedAt:stamp,status:'working',epoch:3,runId:'active-run',modelId:'openai/test',accountId:null,sessionPath:null};store.internal('fixture',null,()=>{store.put('thread',thread.id,thread.id,thread);store.put('workspaceProject','project',null,{id:'project',name:'fixture',authority:{kind:'local'},rootPath:root,createdAt:stamp});});const disabled:string[][]=[];const host=createIntegrationHost({store,workspace:new WorkspaceRepository(store),runtime:{refreshIntegrations:async ids=>{disabled.push(ids);}},createNativeRuntime,capacity:new ModelCapacity(2)});cleanups.push(async()=>{await host.close();store.close();await rm(root,{recursive:true,force:true});});return {host,store,thread,disabled};}
it('uses only current stored thread authority and refuses tool-supplied account or path choices',async()=>{
 const {host}=await setup();await expect(host.additionalTool({name:'integration_list',args:{accountId:'foreign'}},{threadId:'owner',runId:'active-run',epoch:3})).rejects.toThrow(/arguments/i);
 await expect(host.additionalTool({name:'integration_list',args:{}},{threadId:'owner',runId:'old-run',epoch:3})).rejects.toThrow(/owner|stale|run/i);
 await expect(host.manager.listTools('context7',{authority:{kind:'company',companyId:'company'},projectId:'project'})).rejects.toThrow(/company/i);
});
it('pins a fresh text-only native completion and ignores stale runtime events until confirmed settlement',async()=>{
 let disposed=0,start:StartRun|undefined;const {host}=await setup(()=>{let callbacks:RuntimeCallbacks;return {configure:value=>{callbacks=value;},models:async()=>[],start:async input=>{start=input;callbacks.onEvent({...input,type:'assistant.message',runId:'foreign-run',content:'wrong'});callbacks.onEvent({...input,type:'assistant.message',content:'selected native text'});callbacks.onEvent({...input,type:'settled'});},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{disposed++;}};});
 const result=await host.complete({authority:{kind:'local'},threadId:'owner',projectId:'project',modelId:'openai/test',accountId:null},'fixture completion');
 expect(result).toEqual({output:'selected native text'});expect(start).toMatchObject({modelId:'openai/test',accountId:null,sessionPath:null,resources:[]});expect(start?.threadId).not.toBe('owner');expect(disposed).toBe(1);
});
it('captures profile defaults for an active run and explicit disable revokes those grants',async()=>{
 const {host,store,disabled}=await setup();const input:StartRun={threadId:'owner',runId:'active-run',epoch:3,inputId:'input',prompt:'fixture',modelId:'openai/test',accountId:null,sessionPath:null,resources:[]};
 const initial=await host.settingsFor(input);expect(initial.integrations?.enabled).toContain('humanizer');
 new WorkspaceRepository(store).command({id:'changed-profile-default',type:'workspace.integrations.update',payload:{id:'humanizer',enabled:false}});
 expect((await host.settingsFor(input)).integrations?.enabled).toContain('humanizer');
 await host.manager.disable('humanizer',{authority:{kind:'local'}});expect(disabled).toEqual([['humanizer']]);
 await expect(host.additionalTool({name:'integration_call',args:{id:'humanizer',command:'humanizer',args:'fixture'}},{threadId:'owner',runId:'active-run',epoch:3})).rejects.toThrow(/disabled/);
});
it('cancels an outstanding native completion before closing its host',async()=>{
 let started!:()=>void,cancelled=0,disposed=0;const admitted=new Promise<void>(accept=>{started=accept;});
 const {host}=await setup(()=>({configure:()=>{},models:async()=>[],start:async()=>{started();},followUp:async()=>{},cancel:async()=>{cancelled++;},compact:async()=>{},history:async()=>[],dispose:async()=>{disposed++;}}));
 const completion=host.complete({authority:{kind:'local'},threadId:'owner',projectId:'project',modelId:'openai/test',accountId:null},'fixture pending completion');
 const rejected=expect(completion).rejects.toThrow(/cancelled/);await admitted;await host.close();await rejected;
 expect(cancelled).toBe(1);expect(disposed).toBe(1);
});
it('drains an ended run child and releases its captured preferences',async()=>{
 const {host,store,thread}=await setup();
 await host.settingsFor({threadId:thread.id,runId:thread.runId!,epoch:thread.epoch,inputId:'fixture',prompt:'fixture',modelId:thread.modelId!,accountId:null,sessionPath:null,resources:[]});
 await host.manager.listTools('context7',{authority:{kind:'local'},threadId:thread.id});
 store.internal('fixture.settled',thread.id,()=>store.put('thread',thread.id,thread.id,{...thread,status:'completed',runId:null}));
 await expect.poll(async()=>(await host.manager.status('context7')).state,{timeout:10000}).toBe('ready');
},45000);
it('drains the previous private Context7 child before committing a changed key and starts replacement lazily',async()=>{
 const {host}=await setup(),scope={authority:{kind:'local'} as const,threadId:'owner'};
 await host.configurePrivate({context7ApiKey:'fixture-old-key'});
 await host.manager.listTools('context7',scope);
 const sessions=(host.manager as unknown as {sessions:Map<string,{transport:{pid:number;_serverParams:{env:Record<string,string>}}}>}).sessions;
 expect([...sessions.values()][0].transport._serverParams.env.CONTEXT7_API_KEY).toBe('fixture-old-key');
 await host.configurePrivate({context7ApiKey:'fixture-new-key'});
 expect((await host.manager.status('context7')).state).toBe('ready');expect(sessions.size).toBe(0);
 await host.manager.listTools('context7',scope);
 expect([...sessions.values()][0].transport._serverParams.env.CONTEXT7_API_KEY).toBe('fixture-new-key');
},45000);
it('gives a delegated reader no personal integrations when it inherits the parent workspace',async()=>{
 const {host,store,thread}=await setup(),child:Thread={...thread,id:'reader',kind:'delegate',parentThreadId:thread.id,mode:'plan',workspaceId:'parent-workspace',runId:'reader-run'};
 store.internal('fixture.delegate',child.id,()=>{store.put('thread',thread.id,thread.id,{...thread,workspaceId:'parent-workspace'});store.put('thread',child.id,child.id,child);store.put('workspaceBinding','parent-workspace',thread.id,{id:'parent-workspace',threadId:thread.id,projectId:thread.projectId,path:store.dataDir});});
 const settings=await host.settingsFor({threadId:child.id,runId:child.runId!,epoch:child.epoch,inputId:'fixture',prompt:'read fixture',modelId:child.modelId!,accountId:null,sessionPath:null,resources:[]});
 expect(settings.integrations).toEqual({enabled:[],ponytailMode:'off'});expect(settings.projectRoot).toBeUndefined();expect(settings.hostTools?.some(tool=>tool.name.startsWith('integration_'))).toBe(false);
});
it('keeps Biome write proposals and Spec Kit initialization unavailable in plan mode',async()=>{
 const {host,store,thread}=await setup();store.internal('fixture.plan',thread.id,()=>store.put('thread',thread.id,thread.id,{...thread,mode:'plan'}));
 const scope={authority:{kind:'local'} as const,threadId:thread.id};
 await expect(host.manager.command('biome','format',{paths:['.'],write:true},scope)).rejects.toThrow(/plan mode/i);
 await expect(host.manager.command('spec-kit','init',{},scope)).rejects.toThrow(/plan mode/i);
});
