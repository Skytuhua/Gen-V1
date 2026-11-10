import {afterEach,expect,it} from 'vitest';
import {link,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {IntegrationManager} from '../packages/integrations/index.ts';
import type {IntegrationPreferences,IntegrationScope} from '../packages/contracts/integrations.ts';
import {DOMAIN_TOOLS,handleDomainTool,executeDomainOperation,type DomainContext} from '../packages/capabilities/index.ts';
import type {Operation} from '../packages/contracts/index.ts';
import {randomUUID} from 'node:crypto';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
const scope:IntegrationScope={authority:{kind:'local'},projectId:'fixture',accountId:'selected-account',modelId:'selected-model'};
async function setup(){
 const dataRoot=await mkdtemp(join(tmpdir(),'harness-real-mcp-'));let preferences:IntegrationPreferences={};const completions:{scope:IntegrationScope;prompt:string}[]=[];
 const manager=new IntegrationManager({root:resolve('.'),dataRoot,nodeExecutable:process.execPath,getPreferences:()=>preferences,setPreference:async(id,value)=>{preferences={...preferences,[id]:value};},authorize:async input=>{if(input.authority.kind!=='local')throw Error('Company authority denied');return {profileId:'real-mcp-test',projectRoot:dataRoot};},hostComplete:async(selected,prompt)=>{completions.push({scope:selected,prompt});return {output:prompt};},onDisable:async()=>{}});
 cleanups.push(async()=>{await manager.dispose();await rm(dataRoot,{recursive:true,force:true});});return {manager,completions,dataRoot};
}
it('initializes the genuine Context7 stdio service and revokes its owned process on disable',async()=>{
 const {manager,completions}=await setup();const tools=await manager.listTools('context7',scope);
 expect(tools.map(tool=>tool.name)).toEqual(expect.arrayContaining(['resolve-library-id','query-docs']));
 expect((await manager.status('context7',scope)).state).toBe('running');expect(completions).toEqual([]);
 await manager.disable('context7',scope);expect((await manager.status('context7',scope)).state).toBe('disabled');
 await expect(manager.callTool('context7',tools[0].name,{},scope)).rejects.toThrow(/disabled/);
},45000);
it('runs the genuine Promptfoo CLI MCP evaluation through only the scoped host callback',async()=>{
 const {manager,completions}=await setup();const tools=await manager.listTools('promptfoo',scope);
 expect(tools.map(tool=>tool.name)).toEqual(expect.arrayContaining(['run_evaluation','list_evaluations','get_evaluation_details']));
 expect(tools.map(tool=>tool.name)).not.toContain('test_provider');expect(completions).toEqual([]);
 const result=await manager.callTool('promptfoo','run_evaluation',{config:{prompts:['fixture native callback transport'],tests:[{assert:[{type:'equals',value:'fixture native callback transport'}]}]}},scope);
 expect(result.isError).not.toBe(true);expect(completions).toEqual([{scope,prompt:'fixture native callback transport'}]);
 await expect(manager.callTool('promptfoo','run_evaluation',{config:{prompts:['x'],tests:[{assert:[{type:'javascript',value:'return true'}]}]}},scope)).rejects.toThrow(/assertion/);
 const session=[...(manager as unknown as {sessions:Map<string,{bridge:{listening:boolean}}>}).sessions.values()][0];
 expect(session.bridge.listening).toBe(true);await manager.releaseOwner(scope);expect(session.bridge.listening).toBe(false);
 await manager.disable('promptfoo',scope);expect((await manager.status('promptfoo',scope)).state).toBe('disabled');
},90000);
it('builds a real Graphify code graph, queries its stdio server and exports GraphML without a model',async()=>{
 const {manager,completions,dataRoot}=await setup();await writeFile(join(dataRoot,'sample.py'),'def add(first, second):\n    return first + second\n\ndef run():\n    return add(1, 2)\n');
 await manager.command('graphify','graphify',{operation:'extract'},scope);
 const graph=JSON.parse(await readFile(join(dataRoot,'graphify-out/graph.json'),'utf8'));expect(graph.nodes.length).toBeGreaterThan(1);
 const stats=await manager.callTool('graphify','graph_stats',{},scope);expect(stats.isError).not.toBe(true);
 await manager.disable('graphify',scope);expect((await manager.status('graphify',scope)).state).toBe('disabled');
 await expect(manager.callTool('graphify','graph_stats',{},scope)).rejects.toThrow(/disabled/);
 await manager.enable('graphify',scope);expect((await manager.status('graphify',scope)).state).toBe('ready');
 expect((await manager.callTool('graphify','graph_stats',{},scope)).isError).not.toBe(true);
 await manager.command('graphify','graphify',{operation:'export',format:'graphml'},scope);
 await manager.command('graphify','graphify',{operation:'export',format:'graphml'},scope);
 expect(await readFile(join(dataRoot,'graphify-out/graph.graphml'),'utf8')).toContain('graphml');expect(completions).toEqual([]);
 await manager.command('graphify','graphify',{operation:'export',format:'obsidian'},scope);
 expect(await readFile(join(dataRoot,'graphify-out/obsidian/graph.canvas'),'utf8')).toContain('nodes');
 await manager.command('graphify','graphify',{operation:'export',format:'wiki'},scope);
 expect(await readFile(join(dataRoot,'graphify-out/wiki/index.md'),'utf8')).toContain('#');
},90000);
it('initializes only project-local genuine Spec Kit assets and dispatches its original workflow through the host',async()=>{
 const {manager,completions,dataRoot}=await setup();await manager.command('spec-kit','init',{},scope);
 expect(await readFile(join(dataRoot,'.specify/init-options.json'),'utf8')).toContain('generic');
 const workflow=await manager.command('spec-kit','workflow',{command:'plan',arguments:'fixture project plan'},scope);expect(workflow).toMatchObject({prompt:expect.stringContaining('fixture project plan')});
 const version=await manager.callTool('spec-kit','specify_version',{},scope);expect(version.isError).not.toBe(true);
 const generic=await manager.callTool('spec-kit','specify_run_command',{command:'version'},scope);expect(generic.isError).not.toBe(true);
 await expect(manager.command('spec-kit','init',{},scope)).rejects.toThrow(/already exist/);expect(completions).toEqual([]);
},90000);
it('executes the pinned native Biome and Impeccable engines',async()=>{
 const {manager}=await setup();expect(await manager.health('biome',scope)).toEqual({version:expect.stringContaining('2.6.4')});
 expect(await manager.health('impeccable',scope)).toEqual({version:expect.stringContaining('0.1.18')});
});

it('keeps Promptfoo away from project default configuration discovery',async()=>{
 const {manager,dataRoot}=await setup();
 await writeFile(join(dataRoot,'promptfooconfig.mjs'),'export default {description:"passive fixture; never imported"};');
 await manager.listTools('promptfoo',scope);
 const session=[...(manager as unknown as {sessions:Map<string,{transport:{_serverParams:{cwd?:string}}}>}).sessions.values()][0];
 expect(session.transport._serverParams.cwd).not.toBe(dataRoot);
},45000);

it('refuses external evaluator loaders recursively before invoking the genuine evaluator',async()=>{
 const {manager}=await setup();
 const prepare=(manager as unknown as {prepareEvaluation:(args:unknown,scope:IntegrationScope,session:{key:string})=>Promise<unknown>}).prepareEvaluation.bind(manager);
 for(const test of [
  {vars:'file://fixture.json'},
  {vars:{nested:[{text:'file://fixture.mjs'}]}},
  {assert:[{type:'equals',value:'file://fixture.mjs'}]},
  {assert:[{type:'equals',value:{nested:'package:@fixture/module'}}]},
  {options:{rubricPrompt:'file://fixture.mjs'}},
 ])await expect(prepare({config:{prompts:['fixture'],tests:[test]}},scope,{key:'inline-fixture'})).rejects.toThrow(/inline|external|vars/i);
},45000);

it('refuses linked Graphify graph input and linked export directories inside the owned fixture',async()=>{
 const {manager,dataRoot}=await setup(),project=join(dataRoot,'project'),other=join(dataRoot,'other');
 await mkdir(project);await mkdir(other);await writeFile(join(other,'graph.json'),'{}');
 // Both ends of each junction belong to this disposable fixture.
 await symlink(other,join(dataRoot,'graphify-out'),'junction');
 await expect(manager.callTool('graphify','graph_stats',{},scope)).rejects.toThrow(/link|guard|resource/i);
 await rm(join(dataRoot,'graphify-out'));await mkdir(join(dataRoot,'graphify-out'));
 await writeFile(join(dataRoot,'graphify-out/graph.json'),'{}');
 for(const format of ['obsidian','wiki']){
  await symlink(other,join(dataRoot,'graphify-out',format),'junction');
  await expect(manager.command('graphify','graphify',{operation:'export',format},scope)).rejects.toThrow(/link|guard|resource/i);
  await rm(join(dataRoot,'graphify-out',format));
 }
 await link(join(other,'graph.json'),join(dataRoot,'graphify-out/.graphify_labels.json'));
 await expect(manager.callTool('graphify','graph_stats',{},scope)).rejects.toThrow(/link|guard|resource/i);
},45000);

it('evicts a disconnected owned MCP child and can lazily restart it',async()=>{
 const {manager}=await setup();await manager.listTools('context7',scope);
 const session=[...(manager as unknown as {sessions:Map<string,{transport:{pid:number}}>}).sessions.values()][0];
 process.kill(session.transport.pid);
 await expect.poll(async()=>(await manager.status('context7',scope)).state,{timeout:10000}).not.toBe('running');
 expect((await manager.listTools('context7',scope)).length).toBeGreaterThan(0);
},45000);

it('releases only the ended run owner and leaves other owned MCP sessions available',async()=>{
 const {manager}=await setup(),first={...scope,threadId:'first'},second={...scope,threadId:'second'};
 await manager.listTools('context7',first);await manager.listTools('context7',second);
 const lifecycle=manager as unknown as {releaseOwner:(scope:IntegrationScope)=>Promise<void>;sessions:Map<string,unknown>};
 await lifecycle.releaseOwner(first);expect(lifecycle.sessions.size).toBe(1);
 await manager.listTools('context7',second);expect(lifecycle.sessions.size).toBe(1);
},45000);
it('routes Biome proposals through the registered granted-file approval flow',async()=>{
 const {manager,dataRoot}=await setup(),path=join(dataRoot,'sample.js'),source='const value={x:1};\n';await writeFile(path,source);
 const result=await manager.command('biome','format',{paths:['sample.js'],write:true},scope) as {changes:{path:string;sha256:string;text:string}[];next:string};
 expect(result).toMatchObject({changes:[{path:'sample.js',sha256:expect.stringMatching(/^[a-f0-9]{64}$/),text:expect.stringContaining('x: 1')}]});
 expect(await readFile(path,'utf8')).toBe(source);
 const tool=DOMAIN_TOOLS.find(tool=>result.next.includes(tool.name));expect(tool?.name).toBe('file_replace_prepare');
 const ctx:DomainContext={threadId:'format-owner',signal:new AbortController().signal,
  resolveResource:async(id,relativePath)=>{if(id!=='formatted-file'||relativePath!==undefined)throw Error('Outside the test file grant');return path;},
  prepareOperation(kind,args,resourceIds,preconditions,description){return{id:randomUUID(),threadId:this.threadId,revision:1,kind,args,resourceIds,preconditions,description,status:'prepared',approved:false,createdAt:new Date().toISOString()};},
  publishData(value,provenance){return{id:randomUUID(),threadId:this.threadId,revision:1,value,provenance,createdAt:new Date().toISOString()};},progress(){},
 };
 const change=result.changes[0],operation=await handleDomainTool(tool!.name,{resourceId:'formatted-file',content:change.text,expectedSha256:change.sha256},ctx) as Operation;
 await expect(executeDomainOperation(operation,ctx)).rejects.toMatchObject({code:'OPERATION_NOT_APPROVED'});expect(await readFile(path,'utf8')).toBe(source);
 await writeFile(path,'Newer unreviewed content\n');const approved:Operation={...operation,approved:true,status:'running'};
 await expect(executeDomainOperation(approved,ctx)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});expect(await readFile(path,'utf8')).toBe('Newer unreviewed content\n');
 await writeFile(path,source);await executeDomainOperation(approved,ctx);expect(await readFile(path,'utf8')).toBe(change.text);
});
it('admits a manually requested native rubric without accepting external grader configuration',async()=>{
 const {manager}=await setup(),prepare=(manager as unknown as {prepareEvaluation:(args:unknown,scope:IntegrationScope,session:{key:string})=>Promise<{configPath:string}>}).prepareEvaluation.bind(manager);
 const config={prompts:['fixture'],tests:[{assert:[{type:'llm-rubric',value:'fixture rubric'}]}]};
 await expect(prepare({config},scope,{key:'native-grader'})).rejects.toThrow(/native grader/);
 const forwarded=await prepare({config,allowModelGrading:true},scope,{key:'native-grader'}),normalized=JSON.parse(await readFile(forwarded.configPath,'utf8'));
 expect(normalized.tests[0].assert[0].type).toBe('llm-rubric');expect(normalized.defaultTest.options.provider.id).toContain('promptfoo-provider.mjs');
});
