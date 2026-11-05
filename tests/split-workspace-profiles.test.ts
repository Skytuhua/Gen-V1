import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {Store} from '../packages/storage/store.ts';
import {SplitWorkspaceRepository} from '../packages/core/split-workspace.ts';
import type {SplitWorkspaceLayout} from '../packages/contracts/split-workspace.ts';

const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const run of cleanup.splice(0).reverse())await run();});
async function fixture(){const home=await mkdtemp(join(tmpdir(),'gen-split-profiles-'));let store=new Store(home);cleanup.push(async()=>{store.close();await rm(home,{recursive:true,force:true,maxRetries:5});});return{get store(){return store;},repository:new SplitWorkspaceRepository(store),reopen:()=>{store.close();store=new Store(home);return new SplitWorkspaceRepository(store);}};}
function send(repository:SplitWorkspaceRepository,id:string,type:string,payload:Record<string,unknown>={}){const workspaceId=typeof payload.workspaceId==='string'?payload.workspaceId:'workspace';return repository.command({id,type:'split-workspace.'+type,payload:{workspaceId,baseRevision:repository.read(workspaceId).revision,...payload}});}
function thread(store:Store,id='one',projectId='project'){store.internal('fixture.thread',null,()=>store.put('thread',id,id,{id,projectId}));}

it('saves named layouts separately, deduplicates saves and lists only metadata after reload',async()=>{
 const f=await fixture(),repository=f.repository;send(repository,'split','pane.split',{paneId:repository.read().focusedPaneId,newPaneId:'right',splitId:'columns',axis:'horizontal'});
 const command={id:'save-once',type:'split-workspace.profile.save',payload:{workspaceId:'workspace',baseRevision:repository.read().revision,name:'  Coding  '}};
 const receipt=repository.command(command);expect(repository.command(command)).toEqual(receipt);
 expect(repository.readProfiles()).toHaveLength(1);const profile=repository.readProfiles()[0]!;
 expect(profile.name).toBe('Coding');expect(Object.keys(profile).sort()).toEqual(['id','name','updatedAt']);expect(new Date(profile.updatedAt).toISOString()).toBe(profile.updatedAt);
 expect(f.reopen().readProfiles()).toEqual([profile]);expect((receipt.result as SplitWorkspaceLayout).revision).toBe(2);
});
it('applies exact saved tabs, parked views, collapse and geometry without changing v1/native/task/account records',async()=>{
 const f=await fixture(),repository=f.repository;thread(f.store);
 const protectedRecords={workspaceState:{version:1,nativeLayout:{version:1,windows:[{id:'existing-child'}]}},draft:{text:'unsent'},account:{id:'pinned-account'},userState:{value:'entered'}};
 f.store.internal('fixture.protected',null,()=>{for(const[kind,value]of Object.entries(protectedRecords))f.store.put(kind,kind==='workspaceState'?'personal':'one',null,value);});
 send(repository,'open','view.open',{view:{id:'chat',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'project'}}});
 send(repository,'split','pane.split',{paneId:'pane-main',newPaneId:'right',splitId:'columns',axis:'horizontal',ratio:.62,view:{id:'usage',kind:'usage',binding:{authority:{kind:'local'},threadId:'one',projectId:'project'}}});
 send(repository,'park','view.park',{viewId:'usage'});send(repository,'collapse','pane.collapse',{paneId:'right',collapsed:true});
 const saved=repository.read();send(repository,'save','profile.save',{name:'Review'});const profile=repository.readProfiles()[0]!;
 send(repository,'join','pane.join',{paneId:'right'});const revision=repository.read().revision;send(repository,'apply','profile.apply',{profileId:profile.id});const restored=repository.read();
 expect(restored.revision).toBe(revision+1);expect({...restored,revision:0,undoDepth:0,redoDepth:0}).toEqual({...saved,revision:0,undoDepth:0,redoDepth:0});
 for(const[kind,value]of Object.entries(protectedRecords))expect(f.store.get(kind,kind==='workspaceState'?'personal':'one')).toEqual(value);
 send(repository,'undo-apply','history.undo');expect(Object.keys(repository.read().panes)).toHaveLength(1);
});
it('updates an existing named layout without consuming undo history and rejects invalid names or stale commands',async()=>{
 const{repository}=await fixture();send(repository,'save','profile.save',{name:'One'});const profile=repository.readProfiles()[0]!,before=repository.read();
 send(repository,'rename','profile.save',{name:'Renamed',profileId:profile.id});expect(repository.readProfiles()).toHaveLength(1);expect(repository.readProfiles()[0]!.name).toBe('Renamed');expect(repository.read().undoDepth).toBe(before.undoDepth);
 const current=repository.read(),profiles=repository.readProfiles();
 for(const[index,name]of ['', ' '.repeat(10),'x'.repeat(101),'hidden\nrow','control\u0000name'].entries())expect(()=>send(repository,'bad-name-'+index,'profile.save',{name})).toThrow();
 expect(()=>send(repository,'stale','profile.apply',{profileId:profile.id,baseRevision:before.revision})).toThrow(/revision|changed/i);
 expect(repository.read()).toEqual(current);expect(repository.readProfiles()).toEqual(profiles);
});
it('limits each workspace to fifty named layouts while allowing updates and scoped removal',async()=>{
 const{repository}=await fixture();for(let index=0;index<50;index++)send(repository,'save-'+index,'profile.save',{name:'Layout '+index});
 const before=repository.read();expect(()=>send(repository,'overflow','profile.save',{name:'Overflow'})).toThrow(/fifty|50|limit/i);expect(repository.read()).toEqual(before);
 const first=repository.readProfiles()[0]!;send(repository,'update','profile.save',{name:'Updated',profileId:first.id});expect(repository.readProfiles()).toHaveLength(50);
 send(repository,'remove','profile.remove',{profileId:first.id});expect(repository.readProfiles()).toHaveLength(49);send(repository,'replacement','profile.save',{name:'Replacement'});expect(repository.readProfiles()).toHaveLength(50);
 send(repository,'other','profile.save',{workspaceId:'other',name:'Other workspace'});expect(repository.readProfiles('other')).toHaveLength(1);
});
it('denies missing profiles, foreign workspaces and tampered private bindings without a layout mutation',async()=>{
 const f=await fixture(),repository=f.repository;send(repository,'save','profile.save',{name:'Original'});const profile=repository.readProfiles()[0]!,before=repository.read();
 expect(()=>send(repository,'missing','profile.apply',{profileId:'missing'})).toThrow(/layout|profile|available/i);
 expect(()=>send(repository,'foreign','profile.apply',{workspaceId:'other',profileId:profile.id})).toThrow(/layout|profile|scope|available/i);expect(repository.read('other').revision).toBe(0);
 const record=f.store.get<Record<string,unknown>>('splitWorkspaceProfile',profile.id)!;const layout=structuredClone(record.layout) as SplitWorkspaceLayout;layout.views.private={id:'private',kind:'workspace',binding:{authority:{kind:'plugin',pluginId:'sample-plugin',scopeId:'scope-one'}}};layout.parkedViewIds.push('private');
 f.store.internal('fixture.tamper',null,()=>f.store.put('splitWorkspaceProfile',profile.id,null,{...record,layout}));
 expect(()=>send(repository,'private','profile.apply',{profileId:profile.id})).toThrow(/plug|authority/i);expect(repository.read()).toEqual(before);
});
it('revalidates missing threads, changed projects and frozen binding on restore',async()=>{
 const f=await fixture(),repository=f.repository;thread(f.store);send(repository,'open','view.open',{view:{id:'chat',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'project'}}});send(repository,'save','profile.save',{name:'Current'});const profile=repository.readProfiles()[0]!,before=repository.read();
 f.store.internal('fixture.remove',null,()=>f.store.remove('thread','one'));expect(()=>send(repository,'missing-thread','profile.apply',{profileId:profile.id})).toThrow(/conversation/i);expect(repository.read()).toEqual(before);
 thread(f.store,'one','changed');expect(()=>send(repository,'changed-project','profile.apply',{profileId:profile.id})).toThrow(/project binding/i);expect(repository.read()).toEqual(before);
 thread(f.store);const record=f.store.get<Record<string,unknown>>('splitWorkspaceProfile',profile.id)!,layout=structuredClone(record.layout) as SplitWorkspaceLayout;layout.views.chat!.binding.liveProject=true;
 f.store.internal('fixture.binding',null,()=>f.store.put('splitWorkspaceProfile',profile.id,null,{...record,layout}));expect(()=>send(repository,'live-binding','profile.apply',{profileId:profile.id})).toThrow(/frozen/i);expect(repository.read()).toEqual(before);
});
it('revalidates artifact ownership and refuses extra credential/native fields in a saved record',async()=>{
 const f=await fixture(),repository=f.repository;thread(f.store);f.store.internal('fixture.artifact',null,()=>f.store.put('artifact','artifact','one',{id:'artifact',threadId:'one'}));
 send(repository,'open-artifact','view.open',{view:{id:'artifact-view',kind:'artifact',binding:{authority:{kind:'local'},threadId:'one',projectId:'project',artifactId:'artifact'}}});send(repository,'save','profile.save',{name:'Artifact review'});const profile=repository.readProfiles()[0]!,before=repository.read();
 f.store.internal('fixture.artifact-reassigned',null,()=>f.store.put('artifact','artifact','other',{id:'artifact',threadId:'other'}));expect(()=>send(repository,'artifact-owner','profile.apply',{profileId:profile.id})).toThrow(/artifact.*conversation/i);expect(repository.read()).toEqual(before);
 const record=f.store.get<Record<string,unknown>>('splitWorkspaceProfile',profile.id)!;f.store.internal('fixture.extra',null,()=>f.store.put('splitWorkspaceProfile',profile.id,null,{...record,credentials:'not-a-layout',nativeLayout:{windows:[]}}));
 expect(()=>send(repository,'extra-fields','profile.apply',{profileId:profile.id})).toThrow();expect(repository.read()).toEqual(before);
});
it('reconciles saved conversation references after explicit connect without retargeting saved project tools',async()=>{
 const f=await fixture(),repository=f.repository;thread(f.store,'one','a');
 send(repository,'open','view.open',{view:{id:'chat',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'a'}}});send(repository,'save-chat','profile.save',{name:'Chat only'});const chatProfile=repository.readProfiles()[0]!;
 send(repository,'tool','view.open',{view:{id:'files',kind:'files',binding:{authority:{kind:'local'},threadId:'one',projectId:'a'}}});send(repository,'save-tool','profile.save',{name:'With project tool'});const toolProfile=repository.readProfiles().find(value=>value.name==='With project tool')!;
 const expectedBinding=repository.read().views.chat!.binding;thread(f.store,'one','b');send(repository,'reconcile','thread.reconcile',{viewId:'chat',expectedBinding,projectId:'b'});
 const toolSaved=f.store.get<{layout:SplitWorkspaceLayout}>('splitWorkspaceProfile',toolProfile.id)!;expect(toolSaved.layout.views.chat!.binding.projectId).toBe('b');expect(toolSaved.layout.views.files!.binding.projectId).toBe('a');
 send(repository,'apply-chat','profile.apply',{profileId:chatProfile.id});expect(repository.read().views.chat!.binding.projectId).toBe('b');const before=repository.read();expect(()=>send(repository,'apply-old-tool','profile.apply',{profileId:toolProfile.id})).toThrow(/project binding/i);expect(repository.read()).toEqual(before);
 expect(f.reopen().read().views.chat!.binding.projectId).toBe('b');
});
