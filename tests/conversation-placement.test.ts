import {describe,expect,it} from 'vitest';
import {createSplitWorkspaceLayout,applySplitWorkspaceCommand} from '../packages/core/split-workspace-layout.ts';
import type {SplitWorkspaceLayout} from '../packages/contracts/split-workspace.ts';
import type {SurfaceRef} from '../packages/contracts/workspace.ts';
import type {Thread} from '../packages/contracts/index.ts';
import type {ChatViewport} from '../packages/ui-shell/chat-layout.ts';
import {threadPlacementCommand} from '../apps/web/src/split-thread-placement.ts';
import {
 conversationPlacementKey,
 readConversationPlacement,
 capturePlacementExpectation,
 expectationHolds,
 detachDesiredMainSelection,
 planVisible,
 type ConversationPlacementRecord,
} from '../apps/web/src/conversation-placement.ts';

const viewport:ChatViewport={width:1400,height:900};
const mkThread=(id:string,projectId='p1'):Thread=>({id,projectId,title:id.toUpperCase(),projectName:'P'} as Thread);
const A=mkThread('a'),B=mkThread('b'),threads=[A,B];
const viewId=(t:Thread)=>'thread:'+t.id;
const rect={x:40,y:40,width:420,height:520};

function open(layout:SplitWorkspaceLayout,t:Thread,paneId='pane-main',placement:'tab'|'replace'='replace'):SplitWorkspaceLayout{
 const command=threadPlacementCommand(layout,[t],t.id,paneId,'center');
 return applySplitWorkspaceCommand(layout,command.type,{...command.payload,placement});
}
function park(layout:SplitWorkspaceLayout,id:string):SplitWorkspaceLayout{
 return applySplitWorkspaceCommand(layout,'view.park',{workspaceId:layout.id,baseRevision:layout.revision,viewId:id});
}
function floatEntry(layout:SplitWorkspaceLayout,t:Thread){return {view:layout.views[viewId(t)]!,rect};}
function record(over:Partial<ConversationPlacementRecord>={}):ConversationPlacementRecord{
 return {version:1,workspaceId:'workspace',mainPaneId:'pane-main',mainSelection:{kind:'empty'},floating:{},mainBasis:{paneId:'pane-main',activeViewId:null,viewIds:[],revision:0},...over};
}
const raw=(value:unknown)=>JSON.stringify(value);

describe('conversation placement key',()=>{
 it('is versioned per workspace',()=>{
  expect(conversationPlacementKey('workspace')).toBe('harness:conversation-placement:v1:workspace');
  expect(conversationPlacementKey('ws-2')).toBe('harness:conversation-placement:v1:ws-2');
 });
});

describe('readConversationPlacement: missing and invalid records',()=>{
 it('missing record with no legacy thread preserves the fresh-conversation composer as new',()=>{
  const layout=createSplitWorkspaceLayout();
  const result=readConversationPlacement(null,layout,threads,viewport);
  expect(result.mainSelection).toEqual({kind:'new'});
  expect(result.mainPaneId).toBe('pane-main');
  expect(result.floating).toEqual({});
 });
 it('missing record may use a live legacy thread once',()=>{
  const layout=open(createSplitWorkspaceLayout(),A);
  const result=readConversationPlacement(null,layout,threads,viewport,A.id);
  expect(result.mainSelection).toEqual({kind:'thread',threadId:A.id});
 });
 it('missing record ignores a legacy thread that no longer exists',()=>{
  const layout=createSplitWorkspaceLayout();
  const result=readConversationPlacement(null,layout,threads,viewport,'gone');
  expect(result.mainSelection).toEqual({kind:'new'});
 });
 it('explicit empty never falls back to a new composer or the active thread',()=>{
  const layout=open(createSplitWorkspaceLayout(),A);
  const stored=record({mainSelection:{kind:'empty'},mainBasis:{paneId:'pane-main',activeViewId:viewId(A),viewIds:[viewId(A)],revision:layout.revision}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.mainSelection).toEqual({kind:'empty'});
 });
 it('rejects wrong version and wrong workspace as missing',()=>{
  const layout=createSplitWorkspaceLayout();
  expect(readConversationPlacement(raw({...record(),version:2}),layout,threads,viewport).mainSelection).toEqual({kind:'new'});
  expect(readConversationPlacement(raw({...record(),workspaceId:'other'}),layout,threads,viewport).mainSelection).toEqual({kind:'new'});
 });
 it('rejects malformed JSON and non-object payloads',()=>{
  const layout=createSplitWorkspaceLayout();
  expect(readConversationPlacement('{oops',layout,threads,viewport).mainSelection).toEqual({kind:'new'});
  expect(readConversationPlacement('null',layout,threads,viewport).mainSelection).toEqual({kind:'new'});
  expect(readConversationPlacement('42',layout,threads,viewport).mainSelection).toEqual({kind:'new'});
 });
});

describe('readConversationPlacement: main pane resolution',()=>{
 it('prefers a valid saved main pane over pane-main',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);
  layout=applySplitWorkspaceCommand(layout,'pane.split',{workspaceId:layout.id,baseRevision:layout.revision,paneId:'pane-main',newPaneId:'pane-right',splitId:'s1',axis:'horizontal',ratio:.5});
  const stored=record({mainPaneId:'pane-right',mainSelection:{kind:'empty'},mainBasis:{paneId:'pane-right',activeViewId:null,viewIds:[],revision:layout.revision}});
  expect(readConversationPlacement(raw(stored),layout,threads,viewport).mainPaneId).toBe('pane-right');
 });
 it('falls back to pane-main then the first pane when the saved main pane was removed',()=>{
  const layout=createSplitWorkspaceLayout();
  const stored=record({mainPaneId:'gone-pane'});
  expect(readConversationPlacement(raw(stored),layout,threads,viewport).mainPaneId).toBe('pane-main');
 });
 it('never uses focusedPaneId to choose the main role',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);
  layout=applySplitWorkspaceCommand(layout,'pane.split',{workspaceId:layout.id,baseRevision:layout.revision,paneId:'pane-main',newPaneId:'pane-right',splitId:'s1',axis:'horizontal',ratio:.5,view:{id:viewId(B),kind:'thread',binding:{authority:{kind:'local'},threadId:B.id,projectId:B.projectId}}});
  // focusedPaneId is now pane-right, but saved main is pane-main.
  expect(layout.focusedPaneId).toBe('pane-right');
  const stored=record({mainPaneId:'pane-main',mainSelection:{kind:'thread',threadId:A.id},mainBasis:{paneId:'pane-main',activeViewId:viewId(A),viewIds:[viewId(A)],revision:layout.revision}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.mainPaneId).toBe('pane-main');
  expect(result.mainSelection).toEqual({kind:'thread',threadId:A.id});
 });
});

describe('readConversationPlacement: floating validation',()=>{
 it('restores a valid parked floating thread with clamped geometry',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));
  const stored=record({mainSelection:{kind:'empty'},floating:{[viewId(A)]:floatEntry(layout,A)},mainBasis:{paneId:'pane-main',activeViewId:null,viewIds:[],revision:layout.revision}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(Object.keys(result.floating)).toEqual([viewId(A)]);
  expect(result.floating[viewId(A)]!.view).toEqual(layout.views[viewId(A)]);
  expect(result.mainSelection).toEqual({kind:'empty'});
 });
 it('drops a floating entry whose view is now pane-assigned (pane assignment wins)',()=>{
  const layout=open(createSplitWorkspaceLayout(),A); // A active in main, not parked
  const stored=record({floating:{[viewId(A)]:{view:{id:viewId(A),kind:'thread',binding:{authority:{kind:'local'},threadId:A.id,projectId:A.projectId}},rect}}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.floating).toEqual({});
 });
 it('drops a floating entry whose thread binding changed',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));
  const moved=[mkThread('a','p2'),B];
  const stored=record({floating:{[viewId(A)]:floatEntry(layout,A)}});
  const result=readConversationPlacement(raw(stored),layout,moved,viewport);
  expect(result.floating).toEqual({});
 });
 it('drops a floating entry whose thread no longer exists but keeps the durable view',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));
  const stored=record({floating:{[viewId(A)]:floatEntry(layout,A)}});
  const result=readConversationPlacement(raw(stored),layout,[B],viewport);
  expect(result.floating).toEqual({});
  expect(layout.views[viewId(A)]).toBeDefined(); // durable record untouched
 });
 it('drops a floating entry with a mismatched canonical owner',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));
  const forged:SurfaceRef={id:viewId(A),kind:'thread',binding:{authority:{kind:'local'},threadId:B.id,projectId:B.projectId}};
  const stored=record({floating:{[viewId(A)]:{view:forged,rect}}});
  expect(readConversationPlacement(raw(stored),layout,threads,viewport).floating).toEqual({});
 });
 it('clamps an invalid/out-of-bounds rectangle instead of rejecting the float',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));
  const stored=record({floating:{[viewId(A)]:{view:layout.views[viewId(A)]!,rect:{x:-5000,y:-5000,width:99999,height:99999}}}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  const got=result.floating[viewId(A)]!.rect;
  expect(got.x).toBeGreaterThanOrEqual(0);expect(got.y).toBeGreaterThanOrEqual(0);
  expect(got.x+got.width).toBeLessThanOrEqual(viewport.width);
  expect(got.y+got.height).toBeLessThanOrEqual(viewport.height);
 });
 it('ignores unknown floating entries not present in the canonical layout',()=>{
  const layout=createSplitWorkspaceLayout();
  const stored=record({floating:{'thread:ghost':{view:{id:'thread:ghost',kind:'thread',binding:{authority:{kind:'local'},threadId:'ghost'}},rect}}});
  expect(readConversationPlacement(raw(stored),layout,threads,viewport).floating).toEqual({});
 });
 it('does not mutate the durable layout or thread records',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));
  const layoutBefore=JSON.stringify(layout),threadsBefore=JSON.stringify(threads);
  const stored=record({mainSelection:{kind:'empty'},floating:{[viewId(A)]:floatEntry(layout,A)},mainBasis:{paneId:'pane-main',activeViewId:null,viewIds:[],revision:layout.revision}});
  readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(JSON.stringify(layout)).toBe(layoutBefore);
  expect(JSON.stringify(threads)).toBe(threadsBefore);
 });
});

describe('readConversationPlacement: main selection authority',()=>{
 it('resolves main to empty when the stored thread selection is now parked and validly floating',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));
  const stored=record({mainSelection:{kind:'thread',threadId:A.id},floating:{[viewId(A)]:floatEntry(layout,A)},mainBasis:{paneId:'pane-main',activeViewId:viewId(A),viewIds:[viewId(A)],revision:layout.revision}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.mainSelection).toEqual({kind:'empty'});
  expect(Object.keys(result.floating)).toEqual([viewId(A)]);
 });
 it('a stale stored thread selection yields to the main pane actual active thread',()=>{
  const layout=open(createSplitWorkspaceLayout(),B); // B active in main
  const stored=record({mainSelection:{kind:'thread',threadId:A.id},mainBasis:{paneId:'pane-main',activeViewId:viewId(A),viewIds:[viewId(A)],revision:0}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.mainSelection).toEqual({kind:'thread',threadId:B.id});
 });
 it('a changed durable main assignment wins over stale local empty',()=>{
  const layout=open(createSplitWorkspaceLayout(),B); // main now shows B
  const stored=record({mainSelection:{kind:'empty'},mainBasis:{paneId:'pane-main',activeViewId:null,viewIds:[],revision:0}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.mainSelection).toEqual({kind:'thread',threadId:B.id});
 });
 it('ratio-only updates do not erase an intentional empty main when membership still agrees',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));
  const basis={paneId:'pane-main',activeViewId:null,viewIds:[] as string[],revision:layout.revision};
  // A ratio change on an unrelated split bumps revision but not main membership.
  layout=applySplitWorkspaceCommand(layout,'pane.split',{workspaceId:layout.id,baseRevision:layout.revision,paneId:'pane-main',newPaneId:'pane-x',splitId:'sx',axis:'horizontal',ratio:.5});
  layout=applySplitWorkspaceCommand(layout,'pane.resize',{workspaceId:layout.id,baseRevision:layout.revision,splitId:'sx',ratio:.7});
  const stored=record({mainSelection:{kind:'empty'},mainBasis:basis});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.mainSelection).toEqual({kind:'empty'});
 });
 it('reload of valid parked A plus main B keeps both independent',()=>{
  let layout=open(createSplitWorkspaceLayout(),A);layout=park(layout,viewId(A));layout=open(layout,B);
  const stored=record({mainSelection:{kind:'thread',threadId:B.id},floating:{[viewId(A)]:floatEntry(layout,A)},mainBasis:{paneId:'pane-main',activeViewId:viewId(B),viewIds:[viewId(B)],revision:layout.revision}});
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.mainSelection).toEqual({kind:'thread',threadId:B.id});
  expect(Object.keys(result.floating)).toEqual([viewId(A)]);
 });
});

describe('placement expectation capture and matching',()=>{
 it('captures the projected durable result of a detach command and matches after apply',()=>{
  const layout=open(createSplitWorkspaceLayout(),A);
  const command={type:'view.park',payload:{workspaceId:layout.id,baseRevision:layout.revision,viewId:viewId(A)}};
  const expectation=capturePlacementExpectation(layout,command,'pane-main');
  expect(expectationHolds(layout,expectation)).toBe(false); // not yet applied
  const next=applySplitWorkspaceCommand(layout,command.type,command.payload);
  expect(expectationHolds(next,expectation)).toBe(true);
  expect(expectation.locations[viewId(A)]).toBe('parked');
 });
 it('detects a disagreeing postcondition after an unrelated durable change',()=>{
  const layout=open(createSplitWorkspaceLayout(),A);
  const command={type:'view.park',payload:{workspaceId:layout.id,baseRevision:layout.revision,viewId:viewId(A)}};
  const expectation=capturePlacementExpectation(layout,command,'pane-main');
  // Instead of parking A, something else opened B in main.
  const other=open(layout,B);
  expect(expectationHolds(other,expectation)).toBe(false);
 });
});

describe('readConversationPlacement: pending intent recovery',()=>{
 function pendingFixture(){
  const layout=open(createSplitWorkspaceLayout(),A);
  const command={type:'view.park',payload:{workspaceId:layout.id,baseRevision:layout.revision,viewId:viewId(A)}};
  const expectation=capturePlacementExpectation(layout,command,'pane-main');
  const pending={id:'intent-1',kind:'detach' as const,baseRevision:layout.revision,targetViewId:viewId(A),desiredMainSelection:{kind:'empty' as const},desiredMainPaneId:'pane-main',floatingAdd:{[viewId(A)]:{view:layout.views[viewId(A)]!,rect}},floatingRemove:[],expectation};
  const stored=record({mainSelection:{kind:'thread',threadId:A.id},mainBasis:{paneId:'pane-main',activeViewId:viewId(A),viewIds:[viewId(A)],revision:layout.revision},pending});
  return {layout,command,stored};
 }
 it('clears an unapplied intent when the durable revision still equals baseRevision',()=>{
  const {layout,stored}=pendingFixture();
  const result=readConversationPlacement(raw(stored),layout,threads,viewport);
  expect(result.pending).toBeUndefined();
  expect(result.mainSelection).toEqual({kind:'thread',threadId:A.id}); // prior acknowledged state retained
  expect(result.floating).toEqual({});
 });
 it('finalizes the desired local state when revision advanced and postconditions hold',()=>{
  const {layout,command,stored}=pendingFixture();
  const next=applySplitWorkspaceCommand(layout,command.type,command.payload);
  const result=readConversationPlacement(raw(stored),next,threads,viewport);
  expect(result.pending).toBeUndefined();
  expect(result.mainSelection).toEqual({kind:'empty'});
  expect(Object.keys(result.floating)).toEqual([viewId(A)]);
  expect(result.mainBasis.revision).toBe(next.revision);
 });
 it('keeps durable assignments and flags layout-changed when postconditions disagree',()=>{
  const {layout,stored}=pendingFixture();
  const other=open(layout,B); // revision advanced, but A was not parked
  const result=readConversationPlacement(raw(stored),other,threads,viewport);
  expect(result.pending).toBeUndefined();
  expect(result.recovery).toBe('layout-changed');
  expect(result.mainSelection).toEqual({kind:'thread',threadId:B.id});
  expect(result.floating).toEqual({}); // never auto-reopen the stale parked thread
 });
});

describe('plan visibility',()=>{
 const plan=(threadId:string):SurfaceRef=>({id:`plan:${threadId}`,kind:'plan',binding:{authority:{kind:'local'},projectId:'p1',threadId}});
 const run=(layout:SplitWorkspaceLayout,type:string,payload:Record<string,unknown>)=>applySplitWorkspaceCommand(layout,type,payload);

 it('is visible only while the plan tab is the pane that is showing',()=>{
  const opened=run(createSplitWorkspaceLayout(),'view.open',{paneId:'pane-main',view:plan('a')});
  expect(planVisible(opened,'a')).toBe(true);
  const backgrounded=run(opened,'view.open',{paneId:'pane-main',view:{id:'thread:a',kind:'thread',binding:{authority:{kind:'local'},projectId:'p1',threadId:'a'}}});
  expect(backgrounded.panes['pane-main']!.viewIds).toHaveLength(2);
  expect(planVisible(backgrounded,'a')).toBe(false);
  expect(planVisible(run(backgrounded,'view.activate',{paneId:'pane-main',viewId:'plan:a'}),'a')).toBe(true);
 });

 it('is not visible in a minimized pane, for another thread, or once parked',()=>{
  const opened=run(createSplitWorkspaceLayout(),'view.open',{paneId:'pane-main',view:plan('a')});
  expect(planVisible(run(opened,'pane.collapse',{paneId:'pane-main',collapsed:true}),'a')).toBe(false);
  expect(planVisible(opened,'b')).toBe(false);
  expect(planVisible(run(opened,'view.park',{viewId:'plan:a'}),'a')).toBe(false);
 });
});

describe('detachDesiredMainSelection',()=>{
 it('keeps the main thread selection when a non-main view is detached (R02)',()=>{
  let layout=createSplitWorkspaceLayout();
  layout=open(layout,A);
  layout=applySplitWorkspaceCommand(layout,'pane.split',{workspaceId:layout.id,baseRevision:layout.revision,paneId:'pane-main',newPaneId:'pane-side',splitId:'split-1',axis:'horizontal',before:false,view:layout.views[viewId(A)]});
  layout=open(layout,B);
  expect(layout.panes['pane-main']?.activeViewId).toBe(viewId(B));
  expect(detachDesiredMainSelection(layout,viewId(A),{kind:'thread',threadId:'b'},'pane-main')).toEqual({kind:'thread',threadId:'b'});
 });
 it('empties main only when its active thread is detached',()=>{
  const layout=open(createSplitWorkspaceLayout(),B);
  expect(detachDesiredMainSelection(layout,viewId(B),{kind:'thread',threadId:'b'},'pane-main')).toEqual({kind:'empty'});
 });
 it('keeps an explicit empty main when a docked secondary is detached',()=>{
  let layout=createSplitWorkspaceLayout();
  layout=open(layout,A);
  layout=applySplitWorkspaceCommand(layout,'pane.split',{workspaceId:layout.id,baseRevision:layout.revision,paneId:'pane-main',newPaneId:'pane-side',splitId:'split-1',axis:'horizontal',before:false,view:layout.views[viewId(A)]});
  expect(detachDesiredMainSelection(layout,viewId(A),{kind:'empty'},'pane-main')).toEqual({kind:'empty'});
 });
});
