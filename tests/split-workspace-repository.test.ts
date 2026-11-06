import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {Store} from '../packages/storage/store.ts';
import {SplitWorkspaceRepository} from '../packages/core/split-workspace.ts';
import type {SplitWorkspaceLayout} from '../packages/contracts/split-workspace.ts';

const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const run of cleanup.splice(0).reverse())await run();});
async function fixture(){const home=await mkdtemp(join(tmpdir(),'gen-split-'));let store=new Store(home);cleanup.push(async()=>{store.close();await rm(home,{recursive:true,force:true,maxRetries:5});});const repository=new SplitWorkspaceRepository(store);return{store,repository,reopen:()=>{store.close();store=new Store(home);return new SplitWorkspaceRepository(store);}};}
const send=(repository:SplitWorkspaceRepository,id:string,type:string,payload:Record<string,unknown>={})=>repository.command({id,type:'split-workspace.'+type,payload:{workspaceId:'workspace',baseRevision:repository.read().revision,...payload}});
it('persists exact layouts, deduplicates commands, and leaves v1 canvas data untouched',async()=>{
 const{store,repository,reopen}=await fixture();store.internal('fixture',null,()=>store.put('workspaceState','personal',null,{version:1,protected:'original'}));
 const input={id:'once',type:'split-workspace.pane.split',payload:{workspaceId:'workspace',baseRevision:0,paneId:repository.read().focusedPaneId,newPaneId:'right',splitId:'s1',axis:'horizontal'}};
 const result=repository.command(input);expect(repository.command(input)).toEqual(result);expect(repository.read().revision).toBe(1);
 const resumed=reopen();expect(resumed.read()).toEqual(result.result);expect(resumed.store.get('workspaceState','personal')).toEqual({version:1,protected:'original'});
});
it('requires exact revisions and preserves state when a local or plugin owner is invalid',async()=>{
 const{repository}=await fixture(),before=repository.read();
 expect(()=>repository.command({id:'missing-revision',type:'split-workspace.pane.focus',payload:{workspaceId:'workspace',paneId:before.focusedPaneId}})).toThrow();
 expect(()=>send(repository,'plugin','view.open',{view:{id:'private',kind:'workspace',binding:{authority:{kind:'plugin',pluginId:'sample-plugin',scopeId:'scope-one'}}}})).toThrow(/plug|local|authority/i);
 expect(()=>send(repository,'missing-thread','view.open',{view:{id:'chat',kind:'thread',binding:{authority:{kind:'local'},threadId:'missing'}}})).toThrow(/conversation|thread|owner/i);
 expect(repository.read()).toEqual(before);
});
it('undoes only layout changes and preserves drafts, account identity and history after restart',async()=>{
 const{store,repository,reopen}=await fixture();store.internal('fixture',null,()=>{store.put('thread','one','one',{id:'one',projectId:'project'});store.put('draft','one','one',{text:'keep me'});store.put('account','pinned',null,{id:'pinned'});});
 send(repository,'open','view.open',{view:{id:'one',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'project'}}});
 const opened=repository.read();send(repository,'split','pane.split',{paneId:opened.focusedPaneId,newPaneId:'right',splitId:'s1',axis:'horizontal'});
 send(repository,'undo','history.undo');expect(Object.keys(repository.read().panes)).toHaveLength(1);expect(repository.read().views).toEqual(opened.views);
 const resumed=reopen();send(resumed,'redo','history.redo');expect(Object.keys(resumed.read().panes)).toHaveLength(2);
 expect(resumed.store.get('draft','one')).toEqual({text:'keep me'});expect(resumed.store.get('account','pinned')).toEqual({id:'pinned'});
});
it('bounds history and rejects changed project ownership',async()=>{
 const{store,repository}=await fixture();store.internal('fixture',null,()=>store.put('thread','one','one',{id:'one',projectId:'project'}));
 expect(()=>send(repository,'wrong-project','view.open',{view:{id:'one',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'other'}}})).toThrow(/project|binding|owner/i);
 for(let index=0;index<25;index++)send(repository,'collapse-'+index,'pane.collapse',{paneId:repository.read().focusedPaneId,collapsed:index%2===0});
 expect(repository.read().undoDepth).toBe(20);expect((store.get<{undo:SplitWorkspaceLayout[]}>('splitWorkspaceHistory','workspace'))?.undo).toHaveLength(20);
});
it('does not consume layout undo history when focus alone changes',async()=>{
 const{repository}=await fixture();send(repository,'split','pane.split',{paneId:repository.read().focusedPaneId,newPaneId:'right',splitId:'s1',axis:'horizontal'});
 const depth=repository.read().undoDepth;send(repository,'focus','pane.focus',{paneId:'pane-main'});expect(repository.read().undoDepth).toBe(depth);
 send(repository,'undo','history.undo');expect(Object.keys(repository.read().panes)).toHaveLength(1);
});
it('requires a frozen owner instead of a current-sidebar-selection binding',async()=>{
 const{store,repository}=await fixture();store.internal('fixture',null,()=>store.put('thread','one','one',{id:'one',projectId:'project'}));
 expect(()=>send(repository,'live-project','view.open',{view:{id:'one',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'project',liveProject:true}}})).toThrow(/explicit|frozen|binding/i);
 expect(repository.read().views).toEqual({});
});
it('reconciles an explicitly reconnected conversation in place and updates layout-only history',async()=>{
 const{store,repository}=await fixture();store.internal('fixture',null,()=>{store.put('thread','one','one',{id:'one',projectId:'a'});store.put('draft','one','one',{text:'keep me'});});
 send(repository,'open','view.open',{view:{id:'stable-chat',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'a'}}});
 send(repository,'split','pane.split',{paneId:repository.read().focusedPaneId,newPaneId:'right',splitId:'s1',axis:'horizontal'});
 const before=repository.read(),expectedBinding=before.views['stable-chat']!.binding;store.internal('workspace.project.connected','one',()=>store.put('thread','one','one',{id:'one',projectId:'b'}));
 send(repository,'reconcile','thread.reconcile',{viewId:'stable-chat',expectedBinding,projectId:'b'});
 expect(repository.read().views['stable-chat']!.binding.projectId).toBe('b');expect(repository.read().undoDepth).toBe(before.undoDepth);expect(store.get('draft','one')).toEqual({text:'keep me'});
 send(repository,'undo-after-connect','history.undo');expect(repository.read().views['stable-chat']!.binding.projectId).toBe('b');
 send(repository,'redo-after-connect','history.redo');expect(repository.read().views['stable-chat']!.binding.projectId).toBe('b');
 send(repository,'restore-after-connect','layout.restore');expect(repository.read().views['stable-chat']!.binding.projectId).toBe('b');
 send(repository,'reopen-connected','view.open',{view:{id:'stable-chat',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'b'}}});
 send(repository,'save-connected','profile.save',{name:'Connected'});expect(repository.readProfiles()).toHaveLength(1);
});
it('rejects forged, raced and tool retargeting reconciliation without changing stored ownership',async()=>{
 const{store,repository}=await fixture();store.internal('fixture',null,()=>store.put('thread','one','one',{id:'one',projectId:'a'}));
 send(repository,'open','view.open',{view:{id:'chat',kind:'thread',binding:{authority:{kind:'local'},threadId:'one',projectId:'a'}}});send(repository,'tool','view.open',{view:{id:'files',kind:'files',binding:{authority:{kind:'local'},threadId:'one',projectId:'a'}}});
 const before=repository.read();expect(()=>send(repository,'forged','thread.reconcile',{viewId:'chat',expectedBinding:before.views.chat!.binding,projectId:'not-canonical'})).toThrow(/project|changed/i);
 store.internal('workspace.project.connected','one',()=>store.put('thread','one','one',{id:'one',projectId:'b'}));
 expect(()=>send(repository,'wrong-old','thread.reconcile',{viewId:'chat',expectedBinding:{authority:{kind:'local'},threadId:'other',projectId:'a'},projectId:'b'})).toThrow(/owner|binding|changed/i);
 expect(()=>send(repository,'retarget-tool','thread.reconcile',{viewId:'files',expectedBinding:before.views.files!.binding,projectId:'b'})).toThrow(/conversation|thread/i);
 expect(repository.read()).toEqual(before);send(repository,'valid','thread.reconcile',{viewId:'chat',expectedBinding:before.views.chat!.binding,projectId:'b'});expect(repository.read().views.files!.binding.projectId).toBe('a');
});
