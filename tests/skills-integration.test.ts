import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Service} from '../packages/core/service.ts';
import {Store} from '../packages/storage/store.ts';
import {accountResolver} from '../packages/core/accounts.ts';
import {accountProfileRoot} from '../packages/runtime/account-profile.ts';
import {createRuntime} from '../packages/runtime/index.ts';
import {createHostTools,createHostResourceLoader,SKILL_TOOLS} from '../packages/runtime-pi/tool-definitions.ts';
import {createHostMcp} from '../packages/runtime-official/mcp.ts';
import {isOfficialRuntimeProviderId,type ConnectionProviderId} from '../packages/contracts/connections.ts';
import type {ConnectionAccount} from '../packages/contracts/accounts.ts';
import type {RunContext,RuntimeAdapter,RuntimeCallbacks,StartRun,Thread} from '../packages/contracts/index.ts';
import type {SkillDetail} from '../packages/contracts/skills.ts';

// Real Store, Service, account/profile guards and router; model adapters are synthetic.
// These receipts do not establish authentication, provider inference or learning quality.
const providers:ConnectionProviderId[]=['openai','openai-codex','github-copilot','xai','claude-code','gemini-cli','cursor-sdk','kimi-coding','opencode-go'];
const models=providers.map(provider=>({id:`${provider}/skill-acceptance`,provider,name:`Synthetic ${provider}`}));
const createOperation={action:'create',name:'verify-packaged-source',baseRevision:0,description:'Verify packaged source using exact custody receipts.',content:'Read the release manifest before packaging. Preserve unverified provider gates.'};
const cleanups:(()=>Promise<void>)[]=[];
const waitFor=(assertion:()=>void)=>vi.waitFor(assertion,{timeout:5000,interval:25});
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});

function native(official:boolean){
 let callbacks!:RuntimeCallbacks,disposed=0;
 const starts:StartRun[]=[];
 const runtime:RuntimeAdapter={configure:value=>{callbacks=value;},models:async()=>models.filter(model=>isOfficialRuntimeProviderId(model.provider)===official),start:async input=>{starts.push(input);},followUp:async input=>{starts.push(input);},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{disposed++;}};
 const event=(input:RunContext,type:string,fields:Record<string,unknown>={})=>callbacks.onEvent({...input,type,...fields});
 return {runtime,starts,get disposed(){return disposed;},tool:(input:RunContext,name:string,args:Record<string,unknown>)=>callbacks.onTool({name,args},input),finish(input:StartRun,sessionPath:string){event(input,'session',{sessionPath});event(input,'input.processing',{inputIds:input.inputIds});event(input,'assistant.message',{messageId:crypto.randomUUID(),content:'Synthetic source checks passed; live provider acceptance remains open.',inputIds:input.inputIds});event(input,'settled');}};
}

async function fixture(){
 const temporaryRoot=await realpath(tmpdir()),directory=await mkdtemp(join(temporaryRoot,'harness-skills-integration-'));
 let store=new Store(directory),service!:Service;
 const adapters:{role:'primary'|'review';root:string;official:boolean;native:ReturnType<typeof native>}[]=[];
 const make=(role:'primary'|'review')=>createRuntime({dataDir:directory,accounts:accountResolver(store)},{pi:({dataDir})=>{const value=native(false);adapters.push({role,root:dataDir,official:false,native:value});return value.runtime;},official:({dataDir})=>{const value=native(true);adapters.push({role,root:dataDir,official:true,native:value});return value.runtime;}});
 const open=async()=>{service=new Service(store,make('primary'),{learningRuntimeFactory:()=>make('review')});await service.recover();};
 await open();
 cleanups.push(async()=>{try{await service.dispose();}finally{store.close();if(await realpath(directory)!==resolve(directory)||!resolve(directory).startsWith(temporaryRoot+sep)||(await lstat(directory)).isSymbolicLink())throw Error('Unsafe skills fixture cleanup');await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:100});}});
 const send=(type:string,payload:Record<string,unknown>={},threadId?:string)=>service.command({id:crypto.randomUUID(),type,payload,threadId});
 const started=(role:'primary'|'review',account:ConnectionAccount|null,providerId:ConnectionProviderId)=>adapters.filter(item=>item.role===role&&item.root===(account?accountProfileRoot(directory,account):directory)&&item.official===isOfficialRuntimeProviderId(providerId)&&item.native.starts.length).at(-1)?.native;
 return{directory,adapters,send,started,get service(){return service;},get store(){return store;},thread:async()=>(await send('thread.create',{})).result as Thread,account:async(providerId:ConnectionProviderId,label:string)=>(await send('account.create',{providerId,label})).result as ConnectionAccount,reopen:async()=>{await service.dispose();store.close();store=new Store(directory);await open();}};
}
function sessionPath(directory:string,providerId:ConnectionProviderId,input:StartRun){return isOfficialRuntimeProviderId(providerId)?join(directory,'official',providerId,'tasks',input.threadId,'session.json'):join(directory,'pi','tasks',input.threadId,'sessions','synthetic.jsonl');}

it.each(providers)('keeps %s automatic skill review account-pinned through changed defaults, settlement and restart',async providerId=>{
 const x=await fixture(),a=await x.account(providerId,'Current task'),b=await x.account(providerId,'Future tasks'),thread=await x.thread(),modelId=`${providerId}/skill-acceptance`;
 await x.send('account.select',{providerId,accountId:a.id});await x.send('message.send',{content:'Verify the source custody and remember the reusable procedure.',modelId},thread.id);
 await waitFor(()=>expect(x.started('primary',a,providerId)?.starts).toHaveLength(1));const primary=x.started('primary',a,providerId)!,input=primary.starts[0];
 expect(input).toMatchObject({threadId:thread.id,modelId,accountId:a.id});
 expect(await primary.tool(input,'skill_manage',{operations:[createOperation]})).toMatchObject({status:'applied',changes:[{revision:1}]});
 for(let i=0;i<10;i++)await primary.tool(input,'ui_discover',{});
 await x.send('account.select',{providerId,accountId:b.id});
 const sourceSession=sessionPath(accountProfileRoot(x.directory,a),providerId,input);primary.finish(input,sourceSession);
 await waitFor(()=>expect(x.started('review',a,providerId)?.starts).toHaveLength(1));const review=x.started('review',a,providerId)!,reviewInput=review.starts[0];
 expect(reviewInput).toMatchObject({modelId,accountId:a.id,sessionPath:null,resources:[]});expect(reviewInput.threadId).not.toBe(thread.id);
 expect(x.started('review',b,providerId)).toBeUndefined();
 expect(await review.tool(reviewInput,'skill_view',{name:createOperation.name})).toMatchObject({skill:{revision:1},content:createOperation.content});
 expect(await review.tool(reviewInput,'skill_manage',{operations:[{action:'patch',name:createOperation.name,baseRevision:1,oldText:'before packaging',newText:'and verify its checksum before packaging'}]})).toMatchObject({status:'applied',changes:[{revision:2}]});
 review.finish(reviewInput,sessionPath(accountProfileRoot(x.directory,a),providerId,reviewInput));
 await waitFor(()=>expect(x.store.snapshot().learning).toMatchObject({status:'idle',lastReview:{status:'completed',appliedChanges:1,sourceThreadId:thread.id,modelId,accountId:a.id}}));
 expect(x.service.thread(thread.id)).toMatchObject({runId:null,status:'ready',accountId:a.id,sessionPath:sourceSession});
 const before=x.store.snapshot();expect(before.threads).toHaveLength(1);expect(before.messages).toHaveLength(2);expect(before.messages.every(message=>message.threadId===thread.id)).toBe(true);expect(before.resources).toEqual([]);expect(before.operations).toEqual([]);
 const reviewStarts=x.adapters.filter(item=>item.role==='review').reduce((n,item)=>n+item.native.starts.length,0);await x.reopen();expect(x.adapters.filter(item=>item.role==='review').reduce((n,item)=>n+item.native.starts.length,0)).toBe(reviewStarts);
 const next=await x.thread();await x.send('message.send',{content:'Reuse the saved custody procedure for another release.',modelId},next.id);await waitFor(()=>expect(x.started('primary',b,providerId)?.starts).toHaveLength(1));const resumed=x.started('primary',b,providerId)!,nextInput=resumed.starts[0];
 expect(nextInput).toMatchObject({threadId:next.id,modelId,accountId:b.id});expect(nextInput.prompt).toContain(createOperation.name);expect(nextInput.prompt).not.toContain(createOperation.content);
 const loaded=await resumed.tool(nextInput,'skill_view',{name:createOperation.name}) as SkillDetail;expect(loaded.skill.revision).toBe(2);expect(loaded.content).toContain('verify its checksum');
 expect(x.store.snapshot().settings.selectedAccounts?.[providerId]).toBe(b.id);expect(x.store.snapshot().resources).toEqual([]);expect(x.store.snapshot().operations).toEqual([]);
},30_000);

it('registers and executes the shared learning tools in the installed Pi SDK without model calls or ambient skills',async()=>{
 const x=await fixture(),thread=await x.thread();await x.send('message.send',{content:'Inspect the reusable library.',modelId:'openai/skill-acceptance'},thread.id);await waitFor(()=>expect(x.started('primary',null,'openai')?.starts).toHaveLength(1));const input=x.started('primary',null,'openai')!.starts[0];
 const sdk=await import('@earendil-works/pi-coding-agent'),tools=createHostTools([],async(_id,name,args)=>x.service.tool({name,args},input));
 const modelRuntime=await sdk.ModelRuntime.create({authPath:join(x.directory,'isolated-sdk-auth.json'),modelsPath:null,refreshOnCreate:false});const model=modelRuntime.getModels('openai')[0]!;
 const {session}=await sdk.createAgentSession({cwd:x.directory,agentDir:x.directory,modelRuntime,model,tools:tools.map(tool=>tool.name),customTools:tools,resourceLoader:createHostResourceLoader(sdk),sessionManager:sdk.SessionManager.inMemory(x.directory),settingsManager:sdk.SettingsManager.inMemory({cacheWarming:'off'})});
 try{
  for(const name of SKILL_TOOLS.map(tool=>tool.name))expect(session.getActiveToolNames()).toContain(name);
  expect(session.getCallableToolNames().some(name=>['read','bash','powershell','write','edit','codemode','tool_search'].includes(name))).toBe(false);expect(session.resourceLoader.getSkills().skills).toEqual([]);
  const created=await tools.find(tool=>tool.name==='skill_manage')!.execute('sdk-learn',{operations:[createOperation]},undefined,undefined,{} as never);expect(created.details).toMatchObject({status:'applied',changes:[{name:createOperation.name,revision:1}]});
  const viewed=await tools.find(tool=>tool.name==='skill_view')!.execute('sdk-load',{name:createOperation.name},undefined,undefined,{} as never);expect(viewed.details).toMatchObject({skill:{name:createOperation.name},content:createOperation.content});expect(viewed.details).not.toHaveProperty('document');
  expect(x.store.snapshot().resources).toEqual([]);expect(x.store.snapshot().operations).toEqual([]);
 }finally{session.dispose();}
});

it('round trips the same skill schemas and real Service writes through the authenticated official MCP bridge',async()=>{
 const x=await fixture(),thread=await x.thread();await x.send('message.send',{content:'Inspect the reusable library.',modelId:'claude-code/skill-acceptance'},thread.id);await waitFor(()=>expect(x.started('primary',null,'claude-code')?.starts).toHaveLength(1));const input=x.started('primary',null,'claude-code')!.starts[0];
 let active=true;const mcp=await createHostMcp({ctx:input,current:()=>active,onTool:(call,ctx)=>x.service.tool(call,ctx),tools:SKILL_TOOLS});const client=new Client({name:'synthetic-learning-acceptance',version:'1'});
 try{
  expect((await fetch(mcp.url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401);
  await client.connect(new StreamableHTTPClientTransport(new URL(mcp.url),{requestInit:{headers:mcp.headers}}));const advertised=(await client.listTools()).tools;expect(advertised.map(tool=>tool.name).sort()).toEqual(SKILL_TOOLS.map(tool=>tool.name).sort());
  for(const tool of SKILL_TOOLS)expect(advertised.find(value=>value.name===tool.name)?.inputSchema).toEqual(JSON.parse(JSON.stringify(tool.parameters)));
  const result=await client.callTool({name:'skill_manage',arguments:{operations:[createOperation]}});expect(result).toMatchObject({content:[{type:'text',text:expect.stringContaining('"status":"applied"')}]});
  const viewed=await client.callTool({name:'skill_view',arguments:{name:createOperation.name}});expect(viewed).toMatchObject({content:[{type:'text',text:expect.stringContaining(createOperation.content)}]});
  active=false;await expect(client.callTool({name:'skill_manage',arguments:{operations:[{...createOperation,name:'revoked-skill'}]}})).rejects.toThrow();expect(x.store.snapshot().skills?.map(skill=>skill.name)).toEqual([createOperation.name]);
  expect(x.store.snapshot().resources).toEqual([]);expect(x.store.snapshot().operations).toEqual([]);
 }finally{await client.close();await mcp.close();}
});
