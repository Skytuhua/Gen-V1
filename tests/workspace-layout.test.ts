import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {Store} from '../packages/storage/store.ts';
import {WorkspaceRepository,createWorkspaceCanvas} from '../packages/core/workspace-layout.ts';
import {threadNavigationRevision} from '../packages/contracts/shell-read-models.ts';
import {workspaceStateSchema,surfaceRefSchema,SUPPORTED_WORKSPACE_PRESETS,isSupportedWorkspacePreset} from '../packages/contracts/workspace.ts';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){const home=await mkdtemp(join(tmpdir(),'gen-workspace-'));const store=new Store(home);cleanups.push(async()=>{store.close();await rm(home,{recursive:true,force:true,maxRetries:5});});return{store,workspace:new WorkspaceRepository(store)};}
const command=(workspace:WorkspaceRepository,id:string,type:string,payload:Record<string,unknown>={})=>workspace.command({id,type:'workspace.'+type,payload});
it('binds Research conversation and notes to the selected personal thread and spaces default panels',()=>{
 const research=createWorkspaceCanvas('research','Research','research-layout',{authority:{kind:'local'},threadId:'thread-research',projectId:'project-research'});
 expect(research.panels.map(panel=>panel.kind)).toEqual(['thread','files','notes']);expect(research.panels.every(panel=>panel.binding.threadId==='thread-research')).toBe(true);
 expect(surfaceRefSchema.safeParse({id:'notes',kind:'notes',binding:{authority:{kind:'local'}}}).success).toBe(false);
 expect(surfaceRefSchema.safeParse({id:'notes',kind:'notes',binding:{authority:{kind:'local'},threadId:'thread-research'}}).success).toBe(true);
 expect(createWorkspaceCanvas('code-review','Review').panels.every(panel=>panel.bounds.x>=24&&panel.bounds.y>=24)).toBe(true);
});

it('creates a default workspace, persists a snapped panel and saves/restores only layout preferences',async()=>{
 const{workspace}=await fixture();const initial=workspace.read();expect(initial.state.canvases[0]?.preset).toBe('workspace');
 const created=command(workspace,'create','canvas.create',{name:'Layout',preset:'workspace'}).result as ReturnType<WorkspaceRepository['read']>;
 const canvasId=created.state.activeCanvasId;
 command(workspace,'panel','panel.add',{canvasId,panel:{id:'diff-one',kind:'diff',binding:{authority:{kind:'local'},threadId:'task-one'}},bounds:{x:16,y:24,width:640,height:480}});
 command(workspace,'save','profile.save',{name:'Coding'});
 const saved=workspace.read().state.profiles[0]!;
 command(workspace,'hide','panel.update',{panelId:'diff-one',patch:{visible:false}});
 const beforeApply=workspace.read().state.revision;
 command(workspace,'apply','profile.apply',{profileId:saved.id,baseRevision:beforeApply});
 expect(workspace.read().state.canvases.find(c=>c.id===canvasId)?.panels.find(p=>p.id==='diff-one')?.visible).toBe(true);
 expect(workspaceStateSchema.safeParse(workspace.read().state).success).toBe(true);
 expect(JSON.stringify(saved)).not.toMatch(/apiKey|credentials|permissions/);
});

it('deduplicates commands, rejects stale profile application and retains current state on invalid input',async()=>{
 const{workspace}=await fixture();const before=workspace.read().state;
 const first=command(workspace,'once','canvas.create',{name:'Agents',preset:'all-agents'});
 expect(command(workspace,'once','canvas.create',{name:'Agents',preset:'all-agents'})).toEqual(first);
 expect(workspace.read().state.canvases).toHaveLength(2);
 expect(()=>command(workspace,'stale','profile.apply',{profileId:'missing',baseRevision:before.revision})).toThrow(/changed|revision/i);
 const current=workspace.read().state;
 expect(()=>command(workspace,'invalid','canvas.viewport',{canvasId:current.activeCanvasId,x:0,y:0,zoom:0})).toThrow();
 expect(workspace.read().state).toEqual(current);
});

it('validates authority-bound references and forbids secret-bearing layout imports',async()=>{
 const{workspace}=await fixture();
 expect(surfaceRefSchema.safeParse({id:'company-panel',kind:'thread',binding:{authority:{kind:'company'},threadId:'task'}}).success).toBe(false);
 const state=workspace.read().state;
 expect(()=>command(workspace,'secret','profile.restore',{state:{...state,apiKey:'synthetic-secret'},baseRevision:state.revision})).toThrow();
 expect(workspace.read().state).toEqual(state);
});
it('binds plug-in artifacts, agents and plans without inventing personal threads',()=>{
 const authority={kind:'plugin',pluginId:'example-plugin',scopeId:'scope-one'};
 for(const[kind,reference]of[['artifact',{artifactId:'artifact-one'}],['agent',{agentId:'employee-one'}],['plan',{resourceId:'plan-one'}]] as const){
  expect(surfaceRefSchema.safeParse({id:'company-'+kind,kind,binding:{authority,projectId:'project-one',...reference}}).success).toBe(true);
  expect(surfaceRefSchema.safeParse({id:'local-'+kind,kind,binding:{authority:{kind:'local'},projectId:'project-one',...reference}}).success).toBe(false);
  expect(surfaceRefSchema.safeParse({id:'scoped-'+kind,kind,binding:{authority,...reference}}).success).toBe(true);
  expect(surfaceRefSchema.safeParse({id:'missing-scope-'+kind,kind,binding:{authority:{kind:'plugin',pluginId:'example-plugin'},...reference}}).success).toBe(false);
 }
 expect(surfaceRefSchema.safeParse({id:'missing-company-plan',kind:'plan',binding:{authority,projectId:'project-one'}}).success).toBe(false);
});
it('gives each terminal panel a stable host-owned reference across profile and placement changes',async()=>{
 const{workspace}=await fixture(),canvasId=workspace.read().state.activeCanvasId;
 for(const id of ['terminal-one','terminal-two'])command(workspace,'add-'+id,'panel.add',{canvasId,panel:{id,kind:'terminal',binding:{authority:{kind:'local'},projectId:'project',threadId:'thread'}}});
 const references=()=>workspace.read().state.canvases[0]!.panels.map(panel=>panel.binding.terminalId),before=references();expect(new Set(before).size).toBe(2);expect(before.every(Boolean)).toBe(true);
 command(workspace,'save-terminals','profile.save',{name:'Terminals'});const profile=workspace.read().state.profiles[0]!;
 command(workspace,'float-terminal','panel.update',{panelId:'terminal-one',patch:{placement:'native'}});expect(references()).toEqual(before);
 command(workspace,'restore-terminals','profile.apply',{profileId:profile.id,baseRevision:workspace.read().state.revision});expect(references()).toEqual(before);
});

it('hiding windows never changes running task state or account records',async()=>{
 const{workspace,store}=await fixture();store.internal('fixture',null,()=>{store.put('thread','live','live',{id:'live',runId:'running',status:'working'});store.put('account','private',null,{id:'private',secretRef:'vault-only'});});
 const thread=store.get('thread','live'),account=store.get('account','private');
 command(workspace,'hide-kind','kind.enabled',{kind:'thread',enabled:false});
 expect(store.get('thread','live')).toEqual(thread);expect(store.get('account','private')).toEqual(account);
 expect(workspace.read().state.disabledKinds).toContain('thread');
});

it('keeps legacy retired-canvas bindings on the explicit stored thread, never the active server thread (T05/R12)', async () => {
 const {store, workspace} = await fixture();
 const base = {title:'Owner', createdAt:'2026-01-01', updatedAt:'2026-01-01', epoch:0, modelId:null, sessionPath:null};
 store.internal('fixture', null, () => {
  store.put('thread', 'active-a', 'active-a', {...base,id:'active-a',projectId:'project-a',projectName:'A',status:'working',runId:'run-a'});
  store.put('thread', 'selected-b', 'selected-b', {...base,id:'selected-b',projectId:'project-b',projectName:'B',status:'ready',runId:null});
 });
 expect(store.snapshot().activeThreadId).toBe('active-a');
 for (const preset of ['research', 'code-review'] as const) {
  const legacy=createWorkspaceCanvas(preset,'Legacy '+preset,'legacy-'+preset,{authority:{kind:'local'},threadId:'selected-b',projectId:'project-b'});
  const state=workspace.read().state;
  command(workspace,'restore-'+preset,'profile.restore',{state:{...state,canvases:[...state.canvases,legacy],activeCanvasId:legacy.id},baseRevision:state.revision});
  const canvas=workspace.read().state.canvases.find(item=>item.id===legacy.id)!;
  expect(canvas.projectIds).toEqual(['project-b']);
  expect(canvas.panels.every(panel=>panel.binding.threadId==='selected-b'&&panel.binding.projectId==='project-b'&&panel.binding.authority.kind==='local')).toBe(true);
  expect(()=>command(workspace,'recreate-'+preset,'canvas.create',{name:preset,preset,threadId:'selected-b'})).toThrow(/no longer available/i);
 }
});

it('selects Code Review and changes its owner in one transaction, preserving the previous canvas on failure',async()=>{
 const {store,workspace}=await fixture(),original=workspace.read().state.activeCanvasId;
 store.internal('fixture',null,()=>{for(const id of ['review-a','review-b'])store.put('thread',id,id,{id,projectId:'project-a',workspaceId:id==='review-a'?'copy-a':'copy-b',updatedAt:'2026-01-01T00:00:00Z',epoch:1,status:'ready',kind:'main'});});
 const legacyReview=createWorkspaceCanvas('code-review','Review','review-legacy',{authority:{kind:'local'},threadId:'review-a',projectId:'project-a'});
 legacyReview.panels.push({id:'review-owner-review-legacy',kind:'thread',binding:{authority:{kind:'local'},threadId:'review-a',projectId:'project-a'},canvasId:'review-legacy',placement:'canvas',visible:true,collapsed:false,bounds:{x:24,y:24,width:540,height:380},order:legacyReview.panels.length,alwaysOnTop:false});
 legacyReview.projectIds=['project-a'];
 const baseState=workspace.read().state;
 const opened=command(workspace,'open','profile.restore',{state:{...baseState,canvases:[...baseState.canvases,legacyReview],activeCanvasId:'review-legacy'},baseRevision:baseState.revision}).result as ReturnType<WorkspaceRepository['read']>;
 const reviewId=opened.state.activeCanvasId;
 expect(opened.state.canvases.find(item=>item.id===reviewId)?.panels.find(item=>item.kind==='thread')?.binding.threadId).toBe('review-a');
 command(workspace,'back','canvas.select',{canvasId:original});
 const before=workspace.read().state;
 expect(()=>command(workspace,'denied','canvas.select',{canvasId:reviewId,threadId:'missing',baseRevision:before.revision})).toThrow();
 expect(workspace.read().state).toEqual(before);
 const owner=store.get<{id:string;projectId:string;workspaceId:string;updatedAt:string;epoch:number}>('thread','review-b')!;
 const expected={projectId:owner.projectId,workingCopyId:owner.workspaceId,revision:threadNavigationRevision(owner)};
 store.internal('fixture',null,()=>store.put('thread','review-b','review-b',{...owner,workspaceId:'copy-reassigned'}));
 expect(()=>command(workspace,'moved','canvas.select',{canvasId:reviewId,threadId:'review-b',expected,baseRevision:before.revision})).toThrow('working copy changed');
 expect(workspace.read().state).toEqual(before);
 store.internal('fixture',null,()=>store.put('thread','review-b','review-b',{...owner,epoch:2}));
 expect(()=>command(workspace,'restarted','canvas.select',{canvasId:reviewId,threadId:'review-b',expected,baseRevision:before.revision})).toThrow('working copy changed');
 expect(workspace.read().state).toEqual(before);
 const selected=command(workspace,'switch','canvas.select',{canvasId:reviewId,threadId:'review-b',expected:{...expected,revision:threadNavigationRevision({...owner,epoch:2})},baseRevision:before.revision}).result as ReturnType<WorkspaceRepository['read']>;
 expect(selected.state.activeCanvasId).toBe(reviewId);
 expect(selected.state.revision).toBe(before.revision+1);
 expect(selected.state.canvases.find(item=>item.id===reviewId)?.panels.find(item=>item.kind==='thread')?.binding.threadId).toBe('review-b');
 expect(selected.state.canvases.find(item=>item.id===reviewId)?.panels.filter(item=>item.kind==='thread')).toHaveLength(1);
});

it('supports only Workspace and All Agents for new creation while retired presets stay readable (T05/R12)',async()=>{
 expect(SUPPORTED_WORKSPACE_PRESETS).toEqual(['workspace','all-agents']);
 expect(isSupportedWorkspacePreset('workspace')).toBe(true);
 expect(isSupportedWorkspacePreset('all-agents')).toBe(true);
 for(const preset of ['code-review','research','custom'] as const)expect(isSupportedWorkspacePreset(preset)).toBe(false);
 const{workspace}=await fixture();
 for(const preset of ['code-review','research','custom'] as const){
  const before=workspace.read().state;
  expect(()=>command(workspace,'retired-'+preset,'canvas.create',{name:preset,preset})).toThrow(/no longer available/i);
  expect(workspace.read().state).toEqual(before);
 }
 // Legacy records: a retired canvas nested in saved state restores, selects and saves byte-for-byte.
 const legacy=createWorkspaceCanvas('research','Old research','legacy-research',{authority:{kind:'local'},threadId:'thread-a',projectId:'project-a'});
 const state=workspace.read().state;
 command(workspace,'restore-legacy','profile.restore',{state:{...state,canvases:[...state.canvases,legacy],activeCanvasId:'legacy-research'},baseRevision:state.revision});
 const current=workspace.read().state;
 expect(current.canvases.find(canvas=>canvas.id==='legacy-research')).toEqual(legacy);
 expect(current.activeCanvasId).toBe('legacy-research');
 command(workspace,'select-legacy','canvas.select',{canvasId:'legacy-research'});
 expect(workspace.read().state.canvases.find(canvas=>canvas.id==='legacy-research')).toEqual(legacy);
 command(workspace,'save-legacy','profile.save',{name:'With retired canvas'});
 const saved=workspace.read().state.profiles[0]!;
 expect(saved.canvases.find(canvas=>canvas.id==='legacy-research')).toEqual(legacy);
 const beforeApply=workspace.read().state.revision;
 command(workspace,'apply-legacy','profile.apply',{profileId:saved.id,baseRevision:beforeApply});
 expect(workspace.read().state.canvases.find(canvas=>canvas.id==='legacy-research')).toEqual(legacy);
});
