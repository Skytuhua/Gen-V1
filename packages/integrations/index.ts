import {execFile,type ChildProcess} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {mkdir,writeFile,lstat,readdir,mkdtemp,rm} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {Tool} from '@modelcontextprotocol/sdk/types.js';
import {integrationPreferenceSchema,type HostComplete,type IntegrationId,type IntegrationPreference,type IntegrationPreferences,type IntegrationScope,type IntegrationStatus} from '../contracts/integrations.ts';
import {dependencyFile,integrationIds,ordinaryFile,payloadPath,readManifest,verifyDefinition,type IntegrationDefinition,type IntegrationManifest} from './manifest.ts';
import {readBoundFile,replaceOwnedFile,withPathGuard} from '../core/file-access.ts';
import {inlineJson} from './inline-json.ts';

export interface ResolvedIntegrationScope {profileId:string;projectRoot?:string;scope?:IntegrationScope;runId?:string|null;epoch?:number}
export interface IntegrationManagerOptions {
 root:string;dataRoot:string;nodeExecutable?:string;pythonExecutable?:string;
 getPreferences:(scope?:IntegrationScope)=>IntegrationPreferences|Promise<IntegrationPreferences>;
 setPreference:(id:IntegrationId,preference:IntegrationPreference)=>Promise<void>;
 authorize:(scope:IntegrationScope,operation:string)=>Promise<ResolvedIntegrationScope>;
 hostComplete:HostComplete;onDisable:(id:IntegrationId)=>Promise<void>;
 context7Key?:()=>Promise<string|undefined>;
}
interface Session {id:IntegrationId;key:string;scope:IntegrationScope;generation:number;client:Client;transport:StdioClientTransport;starting:Promise<void>;ready:boolean;released?:boolean;bridge?:Server;controllers:Set<AbortController>;closing?:Promise<void>}
interface OwnedCommand {id:IntegrationId;scope?:IntegrationScope;child:ChildProcess;settled:Promise<unknown>}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,24);
const promptfooTools=new Set(['run_evaluation','list_evaluations','get_evaluation_details']);
const graphTools=new Set(['query_graph','get_node','get_neighbors','get_community','god_nodes','graph_stats','shortest_path']);
const deterministicAssertions=new Set(['equals','contains','icontains','not-contains','not-icontains','starts-with','regex','not-regex','is-json','contains-json','rouge-n','levenshtein','latency','cost','is-xml','contains-xml']);
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Integration arguments must be an object');return value as Record<string,unknown>;}
function inside(root:string,path:string){const target=resolve(root,path),part=relative(resolve(root),target);if(part==='..'||part.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(part))throw Error('Integration path leaves the authorized project');return target;}
async function scopedTarget(root:string,path:string,mustExist=false){const target=inside(root,path);let cursor=target;while(true){try{const info=await lstat(cursor);if(info.isSymbolicLink()||info.isFile()&&info.nlink!==1)throw Error('Integration project paths cannot traverse links');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||mustExist&&cursor===target)throw error;}if(cursor===resolve(root))break;const parent=dirname(cursor);if(parent===cursor)throw Error('Integration path leaves its project');cursor=parent;}return target;}
const scopedFile=(root:string,path:string)=>scopedTarget(root,path,true);

export class IntegrationManager {
 private readonly root:string;private manifest?:Promise<IntegrationManifest>;private verified=new Map<IntegrationId,Promise<void>>();
 private sessions=new Map<string,Session>();private commands=new Set<OwnedCommand>();private blocked=new Set<IntegrationId>();private failures=new Map<IntegrationId,string>();private installErrors=new Map<IntegrationId,string>();private stopping=new Set<IntegrationId>();private generations=new Map<IntegrationId,number>();private disposed=false;
 constructor(private readonly options:IntegrationManagerOptions){this.root=resolve(options.root);}
 private registry(){return this.manifest??=readManifest(this.root);}
 private async definition(id:IntegrationId){if(!integrationIds.includes(id))throw Error('Unknown bundled integration');const item=(await this.registry()).integrations.find(item=>item.id===id);if(!item)throw Error('Bundled integration is missing');return item;}
 private async resolved(scope:IntegrationScope,operation:string,project=false){if(this.disposed)throw Error('Integration manager disposed');const result=await this.options.authorize(scope,operation);if(scope.authority.kind!=='local')throw Error('Personal integrations reject company authority');if(!result.profileId||project&&(!result.projectRoot||!isAbsolute(result.projectRoot)))throw Error('Integration requires an authorized local project');return result;}
 private async preference(id:IntegrationId,scope?:IntegrationScope){const prefs=await this.options.getPreferences(scope);return prefs[id]??{enabled:true,...(id==='ponytail'?{mode:'full' as const}:{})};}
 private async available(item:IntegrationDefinition){
  try{
   let verification=this.verified.get(item.id);if(!verification){verification=verifyDefinition(this.root,item);this.verified.set(item.id,verification);}await verification;
   if(item.runtime?.kind==='node'){const pkg=JSON.parse((await dependencyFile(resolve(this.root,'node_modules',item.runtime.package!,'package.json'))).toString());if(pkg.version!==item.runtime.version)throw Error('Pinned Node package version is missing');await dependencyFile(payloadPath(this.root,item.runtime.entry));if(item.id==='biome')await dependencyFile(resolve(this.root,'node_modules/@biomejs/cli-win32-x64/biome.exe'));}
   if(item.runtime?.kind==='python'){const lock=JSON.parse((await ordinaryFile(resolve(this.root,'third-party/integrations/PYTHON_LOCK.json'),8*1024*1024)).toString()) as {distributions:{name:string;version:string}[]};const name=item.id==='graphify'?'graphifyy':'specify-cli';if(!lock.distributions.some(dist=>dist.name===name&&dist.version===item.runtime?.version))throw Error('Pinned Python distribution is missing');await lstat(resolve(this.root,'.harness-integrations-python-deps',item.id==='graphify'?'graphify':'specify_cli'));}
   this.installErrors.delete(item.id);return true;
  }catch(error){this.installErrors.set(item.id,(error as Error).message);return false;}
 }
 async inventory(scope:IntegrationScope={authority:{kind:'local'}}):Promise<IntegrationStatus[]>{await this.resolved(scope,'inventory');const registry=await this.registry();return Promise.all(integrationIds.map(async id=>this.itemStatus(registry.integrations.find(item=>item.id===id)!)));}
 private async itemStatus(item:IntegrationDefinition):Promise<IntegrationStatus>{const pref=await this.preference(item.id),installed=await this.available(item),enabled=pref.enabled&&!this.blocked.has(item.id);const sessions=[...this.sessions.values()].filter(session=>session.id===item.id);const state=this.stopping.has(item.id)?'stopping':!enabled?'disabled':!installed?'missing':this.failures.has(item.id)?'error':sessions.some(session=>session.closing)?'stopping':sessions.some(session=>!session.ready)?'starting':sessions.length||[...this.commands].some(command=>command.id===item.id)?'running':'ready';const error=this.failures.get(item.id)??this.installErrors.get(item.id);return {id:item.id,name:item.name,version:item.version,installed,enabled,state,capabilities:item.capabilities,...(item.id==='ponytail'?{mode:pref.mode??'full'}:{}),...(error?{error}:{}),...(item.id==='context7'?{configured:true}:{})};}
 async status(id:IntegrationId,scope:IntegrationScope={authority:{kind:'local'}}){await this.resolved(scope,'status');return this.itemStatus(await this.definition(id));}
 async configure(id:IntegrationId,patch:Partial<IntegrationPreference>,scope:IntegrationScope){await this.resolved(scope,'configure');const parsed=integrationPreferenceSchema.partial().safeParse(patch);if(!parsed.success)throw Error('Invalid integration configuration');if(id!=='ponytail'&&parsed.data.mode!==undefined)throw Error('Only Ponytail has a mode');if(parsed.data.enabled===false)return this.disable(id,scope);const next={...await this.preference(id),...parsed.data};await this.options.setPreference(id,next);if(next.enabled)this.blocked.delete(id);this.failures.delete(id);return this.status(id,scope);}
 async enable(id:IntegrationId,scope:IntegrationScope){return this.configure(id,{enabled:true},scope);}
 async setEnabled(id:IntegrationId,enabled:boolean,scope:IntegrationScope){return enabled?this.enable(id,scope):this.disable(id,scope);}
 async disable(id:IntegrationId,scope:IntegrationScope){
  await this.resolved(scope,'disable');await this.definition(id);this.blocked.add(id);this.stopping.add(id);this.generations.set(id,(this.generations.get(id)??0)+1);
  await this.options.setPreference(id,{...await this.preference(id),enabled:false});
  try{await Promise.all([this.options.onDisable(id),...[...this.sessions.values()].filter(session=>session.id===id).map(session=>this.closeSession(session)),...this.stopCommands(id)]);this.stopping.delete(id);this.failures.delete(id);return this.status(id,scope);}catch(error){this.failures.set(id,'Integration teardown did not confirm completion');throw error;}
 }
 async workerConfig(scope:IntegrationScope){const resolvedScope=await this.resolved(scope,'workerConfig');const enabled:IntegrationId[]=[];for(const id of integrationIds)if((await this.preference(id,scope)).enabled&&!this.blocked.has(id)&&await this.available(await this.definition(id)))enabled.push(id);return {enabled,ponytailMode:(await this.preference('ponytail',scope)).mode??'full',...(resolvedScope.projectRoot?{projectRoot:resolvedScope.projectRoot}:{})};}
 private async admitted(id:IntegrationId,scope:IntegrationScope,operation:string){const scoped=await this.resolved(scope,operation,true);if(!(await this.preference(id,scope)).enabled||this.blocked.has(id)||this.stopping.has(id))throw Error('Integration is disabled or stopping');const item=await this.definition(id);if(!await this.available(item))throw Error('Bundled integration is unavailable: '+this.installErrors.get(id));return {item,scoped};}
 private environment(directory:string):Record<string,string>{const env:Record<string,string>={};for(const key of ['SystemRoot','WINDIR','COMSPEC','TEMP','TMP','PATH'])if(process.env[key])env[key]=process.env[key]!;return {...env,HOME:directory,USERPROFILE:directory,APPDATA:join(directory,'roaming'),LOCALAPPDATA:join(directory,'local'),XDG_CONFIG_HOME:join(directory,'config'),PYTHON_MANAGER_AUTOMATIC_INSTALL:'false',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',PYTHONHASHSEED:'0',GRAPHIFY_BACKEND:'none',GRAPHIFY_NO_AUTO_REFRESH:'1',PROMPTFOO_DISABLE_TELEMETRY:'1',PROMPTFOO_DISABLE_UPDATE:'1',PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION:'true',PROMPTFOO_CONFIG_DIR:directory,IMPECCABLE_BIN:join(this.root,'third-party/integrations/impeccable/engine/impeccable.exe')};}
 private pythonArgs(entry:string,args:string[]){return [...(this.options.pythonExecutable?[]:['-3.14']),'-I','-S','-B',join(this.root,'packages/integrations/python-entry.py'),entry,...args];}
 private python(){return this.options.pythonExecutable??join(process.env.SystemRoot??'C:/Windows','py.exe');}
 private async runNative(id:IntegrationId,file:string,args:string[],cwd:string,env:Record<string,string>,timeout=60000,scope?:IntegrationScope,projectRoot?:string):Promise<{stdout:string;stderr:string}>{
  if(scope){const current=await this.resolved(scope,'command',true);if(projectRoot&&current.projectRoot!==projectRoot)throw Error('Integration project changed before command admission');}
  if(this.disposed||this.blocked.has(id))return Promise.reject(Error('Integration is disabled'));
  let owned:OwnedCommand;const result=new Promise<{stdout:string;stderr:string}>((accept,reject)=>{const child=execFile(file,args,{cwd,env,windowsHide:true,timeout,maxBuffer:4*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>error?reject(error):accept({stdout,stderr}));owned={id,scope,child,settled:Promise.resolve()};this.commands.add(owned);});
  owned!.settled=result.then(()=>undefined,()=>undefined).finally(()=>this.commands.delete(owned!));return result;
 }
 private stopCommands(id:IntegrationId,scope?:IntegrationScope){return [...this.commands].filter(command=>command.id===id&&(!scope||command.scope&&this.sameOwner(command.scope,scope))).map(async command=>{if(command.child.pid&&command.child.exitCode===null){if(process.platform==='win32')await promisify(execFile)(join(process.env.SystemRoot??'C:/Windows','System32/taskkill.exe'),['/PID',String(command.child.pid),'/T','/F'],{windowsHide:true,timeout:10000,maxBuffer:65536}).catch(error=>{if(![128,255].includes((error as {code:number}).code))throw error;});else command.child.kill('SIGKILL');}await command.settled;});}
 private sameOwner(owner:IntegrationScope,scope:IntegrationScope){return Object.entries(scope).every(([key,value])=>key==='authority'||(owner as unknown as Record<string,unknown>)[key]===value);}
 async releaseOwner(scope:IntegrationScope){await Promise.all([...[...this.sessions.values()].filter(session=>this.sameOwner(session.scope,scope)).map(session=>this.closeSession(session)),...integrationIds.flatMap(id=>this.stopCommands(id,scope))]);}
 async restart(id:IntegrationId,commit:()=>void){await this.definition(id);if(this.disposed||this.stopping.has(id))throw Error('Integration is disposed or already stopping');this.stopping.add(id);this.generations.set(id,(this.generations.get(id)??0)+1);try{await Promise.all([...[...this.sessions.values()].filter(session=>session.id===id).map(session=>this.closeSession(session)),...this.stopCommands(id)]);if(this.disposed)throw Error('Integration manager disposed');commit();this.failures.delete(id);}finally{this.stopping.delete(id);}}
 private async completionBridge(session:Session,token:string){
  const server=createServer((request,response)=>{void(async()=>{
   if(request.method!=='POST'||request.url!=='/complete'||request.headers.authorization!=='Bearer '+token){response.writeHead(403).end();return;}
   const parts:Buffer[]=[];let bytes=0;for await(const part of request){bytes+=part.length;if(bytes>256*1024)throw Error('Evaluation prompt exceeds limit');parts.push(part);}
   const {prompt}=object(JSON.parse(Buffer.concat(parts).toString()));if(typeof prompt!=='string'||prompt.length>128*1024)throw Error('Invalid native evaluation prompt');
   await this.admitted('promptfoo',session.scope,'evaluate');if(session.released||session.generation!==(this.generations.get('promptfoo')??0))throw Error('Evaluation grant revoked');
   const controller=new AbortController();session.controllers.add(controller);request.once('aborted',()=>controller.abort());
   try{const result=await this.options.hostComplete(session.scope,prompt,controller.signal);response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));}finally{session.controllers.delete(controller);}
  })().catch(()=>{if(!response.headersSent)response.writeHead(502,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'Native evaluation did not complete'}));});});
  session.bridge=server;await new Promise<void>((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});const address=server.address();if(!address||typeof address==='string')throw Error('Native evaluation bridge unavailable');return `http://127.0.0.1:${address.port}/complete`;
 }
 private async session(id:IntegrationId,scope:IntegrationScope):Promise<Session>{
  const {item,scoped}=await this.admitted(id,scope,'mcp');if(!item.capabilities.mcp||!item.runtime)throw Error('Integration does not expose an MCP server');
  const effectiveScope=scoped.scope??scope;
  const key=hash(JSON.stringify([id,scoped.profileId,effectiveScope.projectId,scoped.projectRoot,effectiveScope.threadId,effectiveScope.accountId,effectiveScope.modelId,scoped.runId,scoped.epoch]));let session=this.sessions.get(key);if(session){if(session.closing){await session.closing;return this.session(id,scope);}await session.starting;if(!session.ready){await this.closeSession(session);return this.session(id,scope);}return session;}
  const directory=join(this.options.dataRoot,'integrations',hash(scoped.profileId),key),env=this.environment(directory);
  const client=new Client({name:'gen-v1-integrations',version:'1.0.0'},{capabilities:{}});
  const runtime=item.runtime,command=runtime.kind==='node'?(this.options.nodeExecutable??process.execPath):this.python(),args=runtime.kind==='node'?[payloadPath(this.root,runtime.entry),...runtime.args]:this.pythonArgs(runtime.entry,runtime.args);
  const transport=new StdioClientTransport({command,args,cwd:id==='promptfoo'?directory:scoped.projectRoot,env,stderr:'pipe',maxBufferSize:8*1024*1024});
  transport.stderr?.on('data',()=>{});
  session={id,key,scope:{...effectiveScope,...(scoped.epoch===undefined?{}:{epoch:scoped.epoch,runId:scoped.runId})},generation:this.generations.get(id)??0,client,transport,starting:Promise.resolve(),ready:false,controllers:new Set()};this.sessions.set(key,session);
  const selected=session;client.onclose=()=>{void this.closeSession(selected).catch(()=>this.failures.set(id,'Integration teardown did not confirm completion'));};client.onerror=()=>{void this.closeSession(selected).catch(()=>this.failures.set(id,'Integration teardown did not confirm completion'));};session.starting=(async()=>{try{
   await mkdir(directory,{recursive:true});if(id==='context7'){const secret=await this.options.context7Key?.();if(secret)env.CONTEXT7_API_KEY=secret;}
   if(this.disposed||this.blocked.has(id)||selected.released||selected.generation!==(this.generations.get(id)??0))throw Error('Integration startup grant revoked');
   if(id==='promptfoo'){const token=randomBytes(32).toString('hex');env.HARNESS_PROMPTFOO_BRIDGE_URL=await this.completionBridge(selected,token);env.HARNESS_PROMPTFOO_BRIDGE_TOKEN=token;}
   if(this.disposed||this.blocked.has(id)||selected.released||selected.generation!==(this.generations.get(id)??0))throw Error('Integration startup grant revoked');
   await client.connect(transport,{timeout:30000});if(this.blocked.has(id)||selected.released||selected.generation!==(this.generations.get(id)??0)){await this.closeSession(selected);throw Error('Integration was disabled during startup');}selected.ready=true;this.failures.delete(id);
  }catch(error){this.failures.set(id,'Bundled MCP did not initialize');await this.closeSession(selected);throw error;}})();await session.starting;return session;
 }
 private async graphRead<T>(scope:IntegrationScope,action:(root:string)=>Promise<T>){const {scoped}=await this.admitted('graphify',scope,'tool'),root=scoped.projectRoot!;await scopedFile(root,'graphify-out/graph.json');return withPathGuard([{path:join(root,'graphify-out'),leaf:false,tree:true}],new AbortController().signal,()=>action(root),()=>{for(const session of this.sessions.values())if(session.id==='graphify'&&this.sameOwner(session.scope,scope))void this.closeSession(session).catch(()=>{});});}
 private async publishTree(source:string,root:string,destination:string,scope:IntegrationScope,id:IntegrationId){
  if((await this.admitted(id,scope,'write')).scoped.projectRoot!==root)throw Error('Integration project changed before publication');
  let count=0,bytes=0;const signal=new AbortController().signal;
  const publish=async(folder:string)=>{for(const entry of await readdir(folder,{withFileTypes:true})){
   if(entry.name==='.harness-directory-guard')continue;
   if(++count>10000)throw Error('Integration output exceeds its file bound');
   const path=join(folder,entry.name),part=relative(source,path),target=await scopedTarget(root,join(destination,part));
   const info=await lstat(path);if(info.isSymbolicLink())throw Error('Integration outputs cannot traverse links');
   if(info.isDirectory()){try{await mkdir(target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}await withPathGuard([{path:target,leaf:false,allowChildWrites:true}],signal,()=>publish(path));continue;}
   const data=await ordinaryFile(path,8*1024*1024);bytes+=data.length;if(bytes>64*1024*1024)throw Error('Integration output exceeds its byte bound');
   if((await this.admitted(id,scope,'write')).scoped.projectRoot!==root)throw Error('Integration project changed before publication');
   await withPathGuard([{path:dirname(target),leaf:false,allowChildWrites:true}],signal,async()=>{
    const sha256=createHash('sha256').update(data).digest('hex');let expected:string|undefined;
    try{expected=createHash('sha256').update(await ordinaryFile(target,8*1024*1024)).digest('hex');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(expected===sha256)return;
    const temporary=join(dirname(target),'.harness-integration-'+randomBytes(12).toString('hex'));
    try{await writeFile(temporary,data,{flag:'wx'});await replaceOwnedFile(temporary,target,await lstat(temporary,{bigint:true}),sha256,signal,expected);}finally{await rm(temporary,{force:true});}
   });
  }};
  const enter=async(parent:string,parts:string[]):Promise<void>=>{
   if(!parts.length)return publish(source);
   const target=await scopedTarget(root,relative(root,join(parent,parts[0]!)));try{await mkdir(target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
   await withPathGuard([{path:target,leaf:false,allowChildWrites:true}],signal,()=>enter(target,parts.slice(1)));
  };
  await withPathGuard([{path:root,leaf:false,allowChildWrites:true}],signal,()=>enter(root,destination.split(/[\\/]/)));
 }
 private async graphWrite(root:string,operation:'extract'|'export',format:string|undefined,scope:IntegrationScope){
  await this.resolved(scope,'write',true);const out=await scopedTarget(root,'graphify-out'),base=join(this.options.dataRoot,'integrations');await mkdir(base,{recursive:true});const stage=await mkdtemp(join(base,'graphify-')),stagedOut=join(stage,'graphify-out');
  try{
   await mkdir(stagedOut);
   try{await lstat(out);await withPathGuard([{path:out,leaf:false,tree:true}],new AbortController().signal,async()=>{
    for(const name of ['graph.json','.graphify_analysis.json','.graphify_labels.json','manifest.json','.graphify_root'])try{await writeFile(join(stagedOut,name),await readBoundFile(join(out,name),8*1024*1024),{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   });}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(operation==='export')await ordinaryFile(join(stagedOut,'graph.json'),8*1024*1024);
   const argv=operation==='extract'?['extract',root,'--code-only','--max-workers','1','--out',stage]:['export',format!];
   const result=await this.runNative('graphify',this.python(),this.pythonArgs('graphify',argv),stage,this.environment(join(base,'graphify')),180000,scope,root);
   await this.admitted('graphify',scope,'command');
   // Only Graphify's fixed output tree is admitted; staged input files are unchanged.
   await this.publishTree(stagedOut,root,'graphify-out',scope,'graphify');return {result};
  }finally{await rm(stage,{recursive:true,force:true});}
 }
 async listTools(id:IntegrationId,scope:IntegrationScope):Promise<Tool[]>{const list=async()=>{const session=await this.session(id,scope);const result=await session.client.listTools();return result.tools.filter(tool=>id==='promptfoo'?promptfooTools.has(tool.name):id==='graphify'?graphTools.has(tool.name):id==='spec-kit'?['specify_version','specify_list_commands','specify_describe_command','specify_run_command'].includes(tool.name):true);};return id==='graphify'?this.graphRead(scope,list):list();}
 private async prepareEvaluation(args:Record<string,unknown>,scope:IntegrationScope,session:Session){
  const {scoped}=await this.admitted('promptfoo',scope,'evaluate');const root=scoped.projectRoot!;
  let config:Record<string,unknown>;if(args.config!==undefined)config=object(args.config);else{if(typeof args.configPath!=='string')throw Error('Evaluation requires an explicit configuration');const path=await scopedFile(root,args.configPath);if(!path.endsWith('.json'))throw Error('Native evaluations require a JSON configuration');const data=await withPathGuard([{path,leaf:true,readOnly:true}],new AbortController().signal,()=>readBoundFile(path,1024*1024));config=object(JSON.parse(data.toString()));}
  if(Object.keys(config).some(key=>!['description','prompts','providers','tests','defaultTest'].includes(key)))throw Error('Native evaluation configuration contains unsupported execution options');
  if(!Array.isArray(config.prompts)||config.prompts.length<1||config.prompts.length>20||config.prompts.some(prompt=>typeof prompt!=='string'||prompt.length>128*1024||prompt.startsWith('file://')))throw Error('Evaluation prompts must be bounded inline strings');
  if(!Array.isArray(config.tests)||config.tests.length>100)throw Error('Evaluation tests must be a bounded inline array');
  const allowModelGrading=args.allowModelGrading===true;
  const inspect=(test:unknown)=>{const item=object(inlineJson(test));if(Object.keys(item).some(key=>!['description','vars','assert','options'].includes(key)))throw Error('Unsupported native evaluation test option');if(item.vars!==undefined)object(item.vars);if(item.options){const options=object(item.options);if(Object.keys(options).some(key=>!['rubricPrompt'].includes(key)))throw Error('Native evaluation cannot import grader providers');if(options.rubricPrompt!==undefined&&typeof options.rubricPrompt!=='string')throw Error('Evaluation rubricPrompt must be an inline string');}if(item.assert!==undefined){if(!Array.isArray(item.assert))throw Error('Invalid evaluation assertions');for(const assertion of item.assert){const row=object(assertion);if(typeof row.type!=='string'||!deterministicAssertions.has(row.type)&&!(allowModelGrading&&row.type==='llm-rubric'))throw Error('Evaluation assertion requires an explicitly admitted native grader');if(Object.keys(row).some(key=>!['type','value','threshold','weight','metric','reason'].includes(key)))throw Error('Unsupported evaluation assertion options');}}return item;};
  const tests=config.tests.map(inspect),defaultTest=config.defaultTest===undefined?{}:inspect(config.defaultTest);
  const provider='file://'+join(this.root,'packages/integrations/promptfoo-provider.mjs').replaceAll('\\','/');
  const data=object(inlineJson({...(config.description===undefined?{}:{description:config.description}),prompts:config.prompts,tests,defaultTest}));
  const normalized={...data,providers:[{id:provider,label:'harness-native-selected-account'}],defaultTest:{...defaultTest,options:{...object(defaultTest.options??{}),provider:{id:provider}}}};
  const directory=join(this.options.dataRoot,'integrations','evaluations',session.key);await mkdir(directory,{recursive:true});const path=join(directory,randomBytes(12).toString('hex')+'.json');await writeFile(path,JSON.stringify(normalized),{flag:'wx'});
  const forwarded:Record<string,unknown>={configPath:path,maxConcurrency:2,share:false,cache:false,write:true};for(const key of ['testCaseIndices','promptFilter','timeoutMs','repeat','delay','resultLimit','resultOffset'])if(args[key]!==undefined)forwarded[key]=args[key];return object(inlineJson(forwarded));
 }
 async callTool(id:IntegrationId,name:string,args:unknown,scope:IntegrationScope){
  const input={...object(args)},tools=await this.listTools(id,scope),tool=tools.find(tool=>tool.name===name);if(!tool)throw Error('Integration tool is not admitted');const {scoped}=await this.admitted(id,scope,'tool'),session=await this.session(id,scope);
  let forwarded=input;if(id==='graphify')forwarded={...input,project_path:scoped.projectRoot};if(id==='spec-kit'&&name==='specify_run_command'&&input.command!=='version')throw Error('Spec Kit MCP commands are read-only version queries');if(id==='promptfoo'&&name==='run_evaluation')forwarded=await this.prepareEvaluation(input,scope,session);
  const invoke=()=>{if(this.blocked.has(id)||session.released||session.generation!==(this.generations.get(id)??0))throw Error('Integration grant revoked');return session.client.callTool({name,arguments:forwarded},undefined,{timeout:id==='promptfoo'?300000:60000});};return id==='graphify'?this.graphRead(scope,invoke):invoke();
 }
 async health(id:IntegrationId,scope:IntegrationScope){const {item,scoped}=await this.admitted(id,scope,'health');if(item.capabilities.mcp)return {tools:(await this.listTools(id,scope)).map(tool=>tool.name)};if(id==='impeccable'||id==='biome'){const executable=id==='impeccable'?join(this.root,'third-party/integrations/impeccable/engine/impeccable.exe'):join(this.root,'node_modules/@biomejs/cli-win32-x64/biome.exe');const result=await this.runNative(id,executable,['--version'],scoped.projectRoot!,this.environment(join(this.options.dataRoot,'integrations','diagnostics')),10000,scoped.scope??scope,scoped.projectRoot);return {version:result.stdout.trim()};}return {skills:item.capabilities.skills};}
 async command(id:IntegrationId,name:string,args:unknown,scope:IntegrationScope){
  const {item,scoped}=await this.admitted(id,scope,'command');scope=scoped.scope??scope;if(!item.capabilities.commands.includes(name))throw Error('Integration command is not admitted');
  if(id==='ponytail'&&name==='ponytail'&&typeof args==='string'&&['off','lite','full','ultra'].includes(args.trim())){await this.configure(id,{mode:args.trim() as IntegrationPreference['mode']},scope);return {result:{mode:args.trim()}};}
  if(id==='promptfoo'&&name==='evaluate')return {result:await this.callTool(id,'run_evaluation',args,scope)};
  if(id==='biome'){
   const input=object(args??{}),paths=input.paths??['.'];if(!Array.isArray(paths)||paths.length>100||paths.some(path=>typeof path!=='string'||path.startsWith('-')))throw Error('Invalid Biome paths');if(input.write!==undefined&&typeof input.write!=='boolean')throw Error('Invalid Biome write option');
   const targets=await Promise.all(paths.map(path=>scopedFile(scoped.projectRoot!,String(path)))),executable=join(this.root,'node_modules/@biomejs/cli-win32-x64/biome.exe');
   if(input.write){
    await this.resolved(scope,'write',true);if(!['format','check','lint'].includes(name))throw Error('Biome write proposals require format, check, or lint');
    const base=join(this.options.dataRoot,'integrations','biome');await mkdir(base,{recursive:true});const stage=await mkdtemp(join(base,'format-'));
    try{const changes=[];for(let i=0;i<targets.length;i++){
     const path=targets[i]!,data=await withPathGuard([{path,leaf:true,readOnly:true}],new AbortController().signal,()=>readBoundFile(path,1024*1024)),copy=join(stage,String(i)+'-'+basename(path));await writeFile(copy,data,{flag:'wx'});
     await this.runNative(id,executable,[name,copy,'--write'],stage,this.environment(base),60000,scope,scoped.projectRoot);
     changes.push({path:relative(scoped.projectRoot!,path),sha256:createHash('sha256').update(data).digest('hex'),text:(await ordinaryFile(copy,1024*1024)).toString()});
    }return {changes,next:'Prepare each change with file_replace_prepare using a writable grant for that file, content=text and expectedSha256=sha256 (and a grant-relative path if needed); request approval before execution.'};}finally{await rm(stage,{recursive:true,force:true});}
   }
   return withPathGuard(targets.map(path=>({path,leaf:true,tree:false})),new AbortController().signal,async()=>({result:await this.runNative(id,executable,[name,...paths as string[]],scoped.projectRoot!,this.environment(join(this.options.dataRoot,'integrations','biome')),60000,scope,scoped.projectRoot)}));
  }
  if(id==='spec-kit'){
   const root=scoped.projectRoot!;if(name==='init'){
    await this.resolved(scope,'write',true);for(const path of ['.specify','.harness/spec-kit']){const target=await scopedTarget(root,path);try{await lstat(target);throw Error('Spec Kit project assets already exist; initialization will not overwrite them');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
    const base=join(this.options.dataRoot,'integrations','spec-kit');await mkdir(base,{recursive:true});const stage=await mkdtemp(join(base,'init-'));
    try{const result=await this.runNative(id,this.python(),this.pythonArgs('specify',['init','--here','--force','--non-interactive','--integration','generic','--integration-options=--commands-dir .harness/spec-kit/commands','--script','py','--ignore-agent-tools']),stage,this.environment(base),120000,scope,root);
     await this.admitted(id,scope,'command');for(const path of ['.specify','.harness/spec-kit'])await this.publishTree(join(stage,path),root,path,scope,id);return {result};
    }finally{await rm(stage,{recursive:true,force:true});}
   }
   const input=object(args),command=input.command;if(typeof command!=='string'||!['constitution','specify','plan','tasks','implement','converge','clarify','analyze','checklist'].includes(command))throw Error('Spec Kit workflow command is not admitted');
   const path=await scopedFile(root,`.harness/spec-kit/commands/speckit.${command}.md`),content=(await withPathGuard([{path,leaf:true,readOnly:true}],new AbortController().signal,()=>readBoundFile(path,256*1024))).toString(),argument=typeof input.arguments==='string'?input.arguments:'';
   return {prompt:content.replaceAll('$ARGUMENTS',argument),command:`spec-kit:${command}`,baseDirectory:root};
  }
  if(id==='graphify'&&typeof args==='object'&&args!==null){
   const input=object(args),operation=input.operation;let argv:string[];
   if(operation==='extract')return this.graphWrite(scoped.projectRoot!,'extract',undefined,scope);
   else if(operation==='query'){if(typeof input.query!=='string'||input.query.length>8192)throw Error('Invalid Graphify query');argv=['query',input.query,'--budget','2000'];}
   else if(operation==='export'){if(typeof input.format!=='string'||!['html','obsidian','wiki','svg','graphml'].includes(input.format))throw Error('Graphify export format is not admitted');return this.graphWrite(scoped.projectRoot!,'export',input.format,scope);}
   else throw Error('Graphify operation is not admitted');
   return this.graphRead(scope,async()=>({result:await this.runNative(id,this.python(),this.pythonArgs('graphify',argv),scoped.projectRoot!,this.environment(join(this.options.dataRoot,'integrations','graphify')),180000,scope,scoped.projectRoot)}));
  }
  const skill=item.skills.find(skill=>skill.name===name);if(!skill)throw Error('Integration skill is missing');return {prompt:`Load and follow the native bundled skill \`${id}:${name}\`.${typeof args==='string'&&args.trim()?'\n\nUser arguments: '+args.trim():''}`,skillPath:payloadPath(this.root,skill.path)};
 }
 private closeSession(session:Session):Promise<void>{session.ready=false;session.released=true;return session.closing??=Promise.resolve().then(async()=>{for(const controller of session.controllers)controller.abort();try{const pid=session.transport.pid;if(pid&&process.platform==='win32')await promisify(execFile)(join(process.env.SystemRoot??'C:/Windows','System32/taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true,timeout:10000,maxBuffer:65536}).catch(error=>{if(![128,255].includes((error as {code:number}).code))throw error;});await session.client.close();if(session.bridge)await new Promise<void>((accept,reject)=>{session.bridge!.close(error=>error?reject(error):accept());session.bridge!.closeAllConnections();});if(this.sessions.get(session.key)===session)this.sessions.delete(session.key);}catch(error){session.closing=undefined;this.failures.set(session.id,'Integration teardown did not confirm completion');throw error;}});}
 async dispose(){this.disposed=true;for(const id of integrationIds)this.blocked.add(id);await Promise.all([...[...this.sessions.values()].map(session=>this.closeSession(session)),...integrationIds.flatMap(id=>this.stopCommands(id))]);}
}
