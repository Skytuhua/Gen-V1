import type {Thread} from '../../../packages/contracts/index.ts';
import type {SplitWorkspaceLayout} from '../../../packages/contracts/split-workspace.ts';
import type {SurfaceRef} from '../../../packages/contracts/workspace.ts';
import {applySplitWorkspaceCommand,sameSplitWorkspaceView,splitPaneIds} from '../../../packages/core/split-workspace-layout.ts';
import {clampChatRect,type ChatRect,type ChatViewport} from '../../../packages/ui-shell/chat-layout.ts';

/** Renderer-local placement metadata. It never stores messages, drafts, credentials or account inference. */
export type MainSelection={kind:'empty'}|{kind:'new'}|{kind:'thread';threadId:string};
export interface FloatingPlacementEntry{view:SurfaceRef;rect:ChatRect}
export interface MainBasis{paneId:string;activeViewId:string|null;viewIds:string[];revision:number}
export type PlacementIntentKind='detach'|'return'|'dock'|'select'|'join';
/** Projected durable membership for the affected views only; computed through the canonical split reducer. */
export interface PlacementExpectation{mainPaneId:string;mainActiveViewId:string|null;locations:Record<string,string|'parked'>;active:string[]}
export interface PendingPlacementIntent{
 id:string;
 kind:PlacementIntentKind;
 baseRevision:number;
 targetViewId:string|null;
 desiredMainSelection:MainSelection;
 desiredMainPaneId:string|null;
 floatingAdd:Record<string,FloatingPlacementEntry>;
 floatingRemove:string[];
 expectation:PlacementExpectation;
}
export interface ConversationPlacementRecord{
 version:1;
 workspaceId:string;
 mainPaneId:string;
 mainSelection:MainSelection;
 floating:Record<string,FloatingPlacementEntry>;
 mainBasis:MainBasis;
 pending?:PendingPlacementIntent;
 recovery?:'layout-changed';
}

export const conversationPlacementKey=(workspaceId:string)=>`harness:conversation-placement:v1:${workspaceId}`;
const DEFAULT_RECT:ChatRect={x:40,y:40,width:420,height:520};
const finite=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;

/** Main is a navigation role, never the focused pane. */
export function resolveMainPaneId(layout:SplitWorkspaceLayout,saved?:string|null):string{
 if(saved&&Object.hasOwn(layout.panes,saved))return saved;
 if(Object.hasOwn(layout.panes,'pane-main'))return 'pane-main';
 return splitPaneIds(layout.root)[0]!;
}
/** True only when this thread's plan is the showing tab of a non-collapsed pane; a parked or backgrounded tab is not on screen. */
export function planVisible(layout:SplitWorkspaceLayout,threadId:string):boolean{
 for(const pane of Object.values(layout.panes)){
  if(pane.collapsed||!pane.activeViewId)continue;
  const view=layout.views[pane.activeViewId];
  if(view?.kind==='plan'&&view.binding.threadId===threadId)return true;
 }
 return false;
}
function viewLocation(layout:SplitWorkspaceLayout,viewId:string):string|'parked'|null{
 if(layout.parkedViewIds.includes(viewId))return 'parked';
 for(const pane of Object.values(layout.panes))if(pane.viewIds.includes(viewId))return pane.id;
 return null;
}
function liveLocalThread(view:SurfaceRef,threads:Thread[]):Thread|null{
 if(view.kind!=='thread'||view.binding.authority.kind!=='local')return null;
 const thread=threads.find(value=>value.id===view.binding.threadId);
 if(!thread)return null;
 if((thread.projectId??null)!==(view.binding.projectId??null))return null;
 return thread;
}
function activeThreadIdOfPane(layout:SplitWorkspaceLayout,paneId:string,threads:Thread[]):string|null{
 const activeViewId=layout.panes[paneId]?.activeViewId;
 if(!activeViewId)return null;
 const view=layout.views[activeViewId];
 if(!view)return null;
 return liveLocalThread(view,threads)?.id??null;
}
/** A float is accepted only for an exact, live, parked canonical conversation; pane assignment wins. */
function validFloat(entry:FloatingPlacementEntry,layout:SplitWorkspaceLayout,threads:Thread[]):boolean{
 const canonical=layout.views[entry.view.id];
 if(!canonical||!sameSplitWorkspaceView(canonical,entry.view))return false;
 if(!liveLocalThread(entry.view,threads))return false;
 return layout.parkedViewIds.includes(entry.view.id);
}
function sanitizeRect(rect:unknown):ChatRect{
 const value=(rect??{}) as Partial<ChatRect>;
 return {x:finite(value.x,DEFAULT_RECT.x),y:finite(value.y,DEFAULT_RECT.y),width:finite(value.width,DEFAULT_RECT.width),height:finite(value.height,DEFAULT_RECT.height)};
}
function validateFloats(entries:Record<string,FloatingPlacementEntry>,layout:SplitWorkspaceLayout,threads:Thread[],viewport:ChatViewport):Record<string,FloatingPlacementEntry>{
 const out:Record<string,FloatingPlacementEntry>={};
 for(const [id,entry] of Object.entries(entries)){
  if(!entry||entry.view?.id!==id||!validFloat(entry,layout,threads))continue;
  out[id]={view:layout.views[id]!,rect:clampChatRect(sanitizeRect(entry.rect),viewport)};
 }
 return out;
}
function basisFromLayout(layout:SplitWorkspaceLayout,paneId:string):MainBasis{
 const pane=layout.panes[paneId];
 return {paneId,activeViewId:pane?.activeViewId??null,viewIds:[...(pane?.viewIds??[])],revision:layout.revision};
}
/** Membership agreement ignores revision so ratio-only/unrelated-pane updates keep intentional empty/new. */
function mainMembershipAgrees(layout:SplitWorkspaceLayout,paneId:string,basis:MainBasis):boolean{
 if(basis.paneId!==paneId)return false;
 const pane=layout.panes[paneId];
 if((pane?.activeViewId??null)!==basis.activeViewId)return false;
 const current=new Set(pane?.viewIds??[]),saved=new Set(basis.viewIds);
 if(current.size!==saved.size)return false;
 for(const id of current)if(!saved.has(id))return false;
 return true;
}

function membershipSnapshot(layout:SplitWorkspaceLayout):Record<string,{paneId:string|null;parked:boolean;active:boolean}>{
 const out:Record<string,{paneId:string|null;parked:boolean;active:boolean}>={};
 for(const id of Object.keys(layout.views)){
  const loc=viewLocation(layout,id),paneId=loc&&loc!=='parked'?loc:null;
  out[id]={paneId,parked:loc==='parked',active:paneId!==null&&layout.panes[paneId]?.activeViewId===id};
 }
 return out;
}
/** Capture only the affected membership/identity facts of a command's projected durable result. */
export function capturePlacementExpectation(layout:SplitWorkspaceLayout,command:{type:string;payload:Record<string,unknown>},mainPaneId:string):PlacementExpectation{
 const next=applySplitWorkspaceCommand(layout,command.type,command.payload);
 const before=membershipSnapshot(layout),after=membershipSnapshot(next),affected=new Set<string>();
 for(const id of new Set([...Object.keys(before),...Object.keys(after)]))if(JSON.stringify(before[id])!==JSON.stringify(after[id]))affected.add(id);
 const target=command.payload.viewId??(command.payload.view as {id?:unknown}|undefined)?.id;
 if(typeof target==='string')affected.add(target);
 const resolvedMain=resolveMainPaneId(next,mainPaneId),locations:Record<string,string|'parked'>={},active:string[]=[];
 for(const id of affected){
  const state=after[id];if(!state)continue;
  locations[id]=state.parked?'parked':state.paneId!;
  if(state.active)active.push(id);
 }
 return {mainPaneId:resolvedMain,mainActiveViewId:next.panes[resolvedMain]?.activeViewId??null,locations,active};
}
/** Detaching a non-main view leaves the main selection untouched; only detaching main's active thread empties it (R02). */
export function detachDesiredMainSelection(layout:SplitWorkspaceLayout,viewId:string,base:MainSelection,mainPaneId:string):MainSelection{
 return layout.panes[mainPaneId]?.activeViewId===viewId?{kind:'empty'}:base;
}
export function expectationHolds(layout:SplitWorkspaceLayout,expectation:PlacementExpectation):boolean{
 const mainPane=layout.panes[expectation.mainPaneId];
 if(!mainPane||(mainPane.activeViewId??null)!==expectation.mainActiveViewId)return false;
 for(const [id,loc] of Object.entries(expectation.locations)){
  const actual=viewLocation(layout,id);
  if(loc==='parked'?actual!=='parked':actual!==loc)return false;
 }
 for(const id of expectation.active){
  const loc=viewLocation(layout,id);
  if(loc===null||loc==='parked'||layout.panes[loc]?.activeViewId!==id)return false;
 }
 return true;
}

function parseSelection(value:unknown):MainSelection|null{
 if(!value||typeof value!=='object')return null;
 const sel=value as {kind?:unknown;threadId?:unknown};
 if(sel.kind==='empty'||sel.kind==='new')return {kind:sel.kind};
 if(sel.kind==='thread'&&typeof sel.threadId==='string'&&sel.threadId)return {kind:'thread',threadId:sel.threadId};
 return null;
}
function parseBasis(value:unknown):MainBasis|null{
 if(!value||typeof value!=='object')return null;
 const basis=value as {paneId?:unknown;activeViewId?:unknown;viewIds?:unknown;revision?:unknown};
 if(typeof basis.paneId!=='string')return null;
 if(basis.activeViewId!==null&&typeof basis.activeViewId!=='string')return null;
 if(!Array.isArray(basis.viewIds)||basis.viewIds.some(id=>typeof id!=='string'))return null;
 if(typeof basis.revision!=='number'||!Number.isInteger(basis.revision)||basis.revision<0)return null;
 return {paneId:basis.paneId,activeViewId:basis.activeViewId,viewIds:[...basis.viewIds],revision:basis.revision};
}
function parseFloating(value:unknown):Record<string,FloatingPlacementEntry>{
 const out:Record<string,FloatingPlacementEntry>={};
 if(!value||typeof value!=='object')return out;
 for(const [id,entry] of Object.entries(value as Record<string,unknown>)){
  if(!entry||typeof entry!=='object')continue;
  const view=(entry as {view?:unknown}).view;
  if(!view||typeof view!=='object'||(view as {id?:unknown}).id!==id)continue;
  out[id]={view:view as SurfaceRef,rect:sanitizeRect((entry as {rect?:unknown}).rect)};
 }
 return out;
}
function parsePending(value:unknown):PendingPlacementIntent|undefined{
 if(!value||typeof value!=='object')return undefined;
 const p=value as Record<string,unknown>;
 const kind=p.kind,selection=parseSelection(p.desiredMainSelection);
 if(typeof p.id!=='string'||!['detach','return','dock','select','join'].includes(kind as string))return undefined;
 if(typeof p.baseRevision!=='number'||!selection)return undefined;
 const expectation=p.expectation as PlacementExpectation|undefined;
 if(!expectation||typeof expectation.mainPaneId!=='string'||!expectation.locations||!Array.isArray(expectation.active))return undefined;
 const floatingAdd:Record<string,FloatingPlacementEntry>={};
 if(p.floatingAdd&&typeof p.floatingAdd==='object')for(const [id,entry] of Object.entries(p.floatingAdd as Record<string,unknown>)){
  const view=(entry as {view?:unknown})?.view;
  if(view&&typeof view==='object'&&(view as {id?:unknown}).id===id)floatingAdd[id]={view:view as SurfaceRef,rect:sanitizeRect((entry as {rect?:unknown}).rect)};
 }
 return {
  id:p.id,kind:kind as PlacementIntentKind,baseRevision:p.baseRevision,
  targetViewId:typeof p.targetViewId==='string'?p.targetViewId:null,
  desiredMainSelection:selection,desiredMainPaneId:typeof p.desiredMainPaneId==='string'?p.desiredMainPaneId:null,
  floatingAdd,floatingRemove:Array.isArray(p.floatingRemove)?p.floatingRemove.filter((id):id is string=>typeof id==='string'):[],
  expectation,
 };
}
function parseRecord(raw:string|null,workspaceId:string):(Omit<ConversationPlacementRecord,'mainPaneId'>&{mainPaneId:string})|null{
 if(!raw||raw.length>65536)return null;
 let value:unknown;try{value=JSON.parse(raw);}catch{return null;}
 if(!value||typeof value!=='object')return null;
 const r=value as Record<string,unknown>;
 if(r.version!==1||r.workspaceId!==workspaceId)return null;
 const mainSelection=parseSelection(r.mainSelection),mainBasis=parseBasis(r.mainBasis);
 if(!mainSelection||!mainBasis)return null;
 const pending=parsePending(r.pending);
 return {version:1,workspaceId,mainPaneId:typeof r.mainPaneId==='string'?r.mainPaneId:'',mainSelection,floating:parseFloating(r.floating),mainBasis,...(pending?{pending}:{})};
}

/** Deterministic reader: validates stored placement against the durable layout and reconciles pending intents. */
export function readConversationPlacement(raw:string|null,layout:SplitWorkspaceLayout,threads:Thread[],viewport:ChatViewport,legacyThreadId?:string|null):ConversationPlacementRecord{
 const stored=parseRecord(raw,layout.id);
 let mainPaneId=resolveMainPaneId(layout,stored?.mainPaneId);
 let floating=validateFloats(stored?.floating??{},layout,threads,viewport);
 let mainSelection:MainSelection;
 let mainBasis:MainBasis;
 let recovery:'layout-changed'|undefined;
 const intent=stored?.pending;

 if(stored&&intent){
  if(layout.revision===intent.baseRevision){
   // The command never landed: keep the last acknowledged state and drop the unapplied intent.
   mainSelection=stored.mainSelection;mainBasis=stored.mainBasis;
  }else if(expectationHolds(layout,intent.expectation)){
   // The command landed as captured: publish the desired local state once, without resending.
   mainPaneId=resolveMainPaneId(layout,intent.desiredMainPaneId??stored.mainPaneId);
   mainSelection=intent.desiredMainSelection;
   for(const id of intent.floatingRemove)delete floating[id];
   for(const [id,entry] of Object.entries(intent.floatingAdd))if(validFloat(entry,layout,threads))floating[id]={view:layout.views[id]!,rect:clampChatRect(sanitizeRect(entry.rect),viewport)};
   mainBasis=basisFromLayout(layout,mainPaneId);
  }else{
   // Revision advanced differently: keep durable assignments, never auto-reopen a stale parked thread.
   recovery='layout-changed';
   const active=activeThreadIdOfPane(layout,mainPaneId,threads);
   mainSelection=active?{kind:'thread',threadId:active}:{kind:'empty'};
   mainBasis=basisFromLayout(layout,mainPaneId);
  }
 }else if(stored){
  const sel=stored.mainSelection,active=activeThreadIdOfPane(layout,mainPaneId,threads);
  if(sel.kind==='thread'){
   const canonical=Object.values(layout.views).find(view=>view.kind==='thread'&&view.binding.authority.kind==='local'&&view.binding.threadId===sel.threadId);
   if(canonical&&layout.parkedViewIds.includes(canonical.id)&&floating[canonical.id])mainSelection={kind:'empty'};
   else if(active===sel.threadId)mainSelection=sel;
   else mainSelection=active?{kind:'thread',threadId:active}:{kind:'empty'};
  }else if(mainMembershipAgrees(layout,mainPaneId,stored.mainBasis)){
   mainSelection=sel;
  }else{
   mainSelection=active?{kind:'thread',threadId:active}:{kind:'empty'};
  }
  mainBasis=basisFromLayout(layout,mainPaneId);
 }else{
  const active=activeThreadIdOfPane(layout,mainPaneId,threads);
  if(legacyThreadId&&threads.some(thread=>thread.id===legacyThreadId))mainSelection={kind:'thread',threadId:legacyThreadId};
  else if(active)mainSelection={kind:'thread',threadId:active};
  else mainSelection={kind:'new'};
  mainBasis=basisFromLayout(layout,mainPaneId);
 }

 return {version:1,workspaceId:layout.id,mainPaneId,mainSelection,floating,mainBasis,...(recovery?{recovery}:{})};
}
