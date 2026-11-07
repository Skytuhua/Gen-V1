import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';
import {surfaceRefSchema,type SurfaceRef} from '../contracts/workspace.ts';
import {splitWorkspaceIdSchema,splitWorkspaceLayoutSchema,type SplitDropEdge,type SplitWorkspaceLayout,type SplitWorkspaceNode} from '../contracts/split-workspace.ts';

const invalid=(message:string):never=>{throw new HarnessError('INVALID_LAYOUT',message);};
const id=splitWorkspaceIdSchema;
export function createSplitWorkspaceLayout(workspaceId='workspace'):SplitWorkspaceLayout{return{version:2,id:id.parse(workspaceId),revision:0,root:{kind:'pane',paneId:'pane-main'},panes:{'pane-main':{id:'pane-main',viewIds:[],collapsed:false}},views:{},parkedViewIds:[],focusedPaneId:'pane-main',undoDepth:0,redoDepth:0};}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,canonical(value)])):value;
const ownerBinding=(view:SurfaceRef)=>Object.fromEntries(Object.entries(view.binding).filter(([key])=>key!=='liveProject'));
export const sameSplitWorkspaceView=(a:SurfaceRef,b:SurfaceRef)=>a.kind===b.kind&&JSON.stringify(canonical(ownerBinding(a)))===JSON.stringify(canonical(ownerBinding(b)));
export function splitPaneIds(node:SplitWorkspaceNode):string[]{return node.kind==='pane'?[node.paneId]:[...splitPaneIds(node.first),...splitPaneIds(node.second)];}
export function splitNodeById(node:SplitWorkspaceNode,splitId:string):Extract<SplitWorkspaceNode,{kind:'split'}>|undefined{if(node.kind==='pane')return;return node.id===splitId?node:splitNodeById(node.first,splitId)??splitNodeById(node.second,splitId);}
function replaceNode(node:SplitWorkspaceNode,paneId:string,replacement:SplitWorkspaceNode):SplitWorkspaceNode{return node.kind==='pane'?node.paneId===paneId?replacement:node:{...node,first:replaceNode(node.first,paneId,replacement),second:replaceNode(node.second,paneId,replacement)};}
function parentOf(node:SplitWorkspaceNode,paneId:string):Extract<SplitWorkspaceNode,{kind:'split'}>|undefined{if(node.kind==='pane')return;return node.first.kind==='pane'&&node.first.paneId===paneId||node.second.kind==='pane'&&node.second.paneId===paneId?node:parentOf(node.first,paneId)??parentOf(node.second,paneId);}
function prune(node:SplitWorkspaceNode,paneId:string):SplitWorkspaceNode|undefined{if(node.kind==='pane')return node.paneId===paneId?undefined:node;const first=prune(node.first,paneId),second=prune(node.second,paneId);return first&&second?{...node,first,second}:first??second;}

/** Pure geometry/reference transformation. It does not authorize or execute a surface. */
export function applySplitWorkspaceCommand(input:SplitWorkspaceLayout,type:string,payload:Record<string,unknown>):SplitWorkspaceLayout{
 const original=splitWorkspaceLayoutSchema.parse(input);
 if(payload.workspaceId!==undefined&&payload.workspaceId!==original.id)invalid('The workspace identity changed.');
 if(payload.baseRevision!==undefined&&payload.baseRevision!==original.revision)throw new HarnessError('WORKSPACE_CHANGED','The layout revision changed. Refresh before applying this operation.');
 const layout=structuredClone(original),action=type.replace(/^split-workspace\./,''),preserveFocus=payload.preserveFocus===undefined?false:z.boolean().parse(payload.preserveFocus);
 const pane=(value:unknown)=>{const key=id.parse(value);if(!Object.hasOwn(layout.panes,key))return invalid('The target pane is no longer available.');return layout.panes[key]!;};
 const view=(value:unknown)=>{const key=id.parse(value);if(!Object.hasOwn(layout.views,key))return invalid('The view is no longer available.');return layout.views[key]!;};
 const unassign=(viewId:string)=>{for(const entry of Object.values(layout.panes)){entry.viewIds=entry.viewIds.filter(value=>value!==viewId);if(entry.activeViewId===viewId)entry.activeViewId=entry.viewIds.at(-1);}layout.parkedViewIds=layout.parkedViewIds.filter(value=>value!==viewId);};
 const park=(viewId:string)=>{unassign(viewId);layout.parkedViewIds.push(viewId);};
 const open=(targetId:unknown,raw:unknown,placement:unknown='tab')=>{
  const target=pane(targetId),parsed=surfaceRefSchema.parse(raw),existing=Object.values(layout.views).find(value=>sameSplitWorkspaceView(value,parsed));
  if(Object.hasOwn(layout.views,parsed.id)&&!sameSplitWorkspaceView(layout.views[parsed.id]!,parsed))invalid('An existing view ID cannot be rebound to a different owner.');
  const value=existing??parsed;
  if(placement!=='tab'&&placement!=='replace')invalid('Choose tab or replace placement.');
  if(placement==='replace'&&target.activeViewId&&target.activeViewId!==value.id)park(target.activeViewId);
  unassign(value.id);layout.views[value.id]=value;target.viewIds.push(value.id);target.activeViewId=value.id;target.collapsed=false;layout.focusedPaneId=target.id;
 };
 if(action==='view.open')open(payload.paneId??layout.focusedPaneId,payload.view,payload.placement);
 else if(action==='layout.seed'){
  if(Object.keys(layout.views).length)invalid('This workspace already has a layout. Restore or arrange it explicitly.');
  for(const value of z.array(surfaceRefSchema).max(100).parse(payload.views))open(layout.focusedPaneId,value);
 }else if(action==='pane.split'){
  const target=pane(payload.paneId),newPaneId=id.parse(payload.newPaneId),splitId=id.parse(payload.splitId),axis=z.enum(['horizontal','vertical']).parse(payload.axis),ratio=z.number().finite().min(.05).max(.95).parse(payload.ratio??.5);
  if(Object.hasOwn(layout.panes,newPaneId)||splitNodeById(layout.root,splitId))invalid('New pane and split IDs must be unique.');
  const oldLeaf:SplitWorkspaceNode={kind:'pane',paneId:target.id},newLeaf:SplitWorkspaceNode={kind:'pane',paneId:newPaneId};
  const retained=payload.outer===true?layout.root:oldLeaf,replacement:SplitWorkspaceNode={kind:'split',id:splitId,axis,ratio,first:payload.before===true?newLeaf:retained,second:payload.before===true?retained:newLeaf};
  layout.panes[newPaneId]={id:newPaneId,viewIds:[],collapsed:false};layout.root=payload.outer===true?replacement:replaceNode(layout.root,target.id,replacement);layout.focusedPaneId=newPaneId;
  if(payload.view!==undefined)open(newPaneId,payload.view);
 }else if(action==='pane.join'){
  const source=pane(payload.paneId),parent=parentOf(layout.root,source.id);if(!parent)invalid('Keep at least one pane.');
  const siblings=splitPaneIds(parent!.first.kind==='pane'&&parent!.first.paneId===source.id?parent!.second:parent!.first),target=pane(payload.targetPaneId??siblings[0]);
  if(!siblings.includes(target.id))invalid('Join an adjacent pane within the same split.');
  for(const viewId of [...source.viewIds])park(viewId);
  layout.root=prune(layout.root,source.id)!;delete layout.panes[source.id];layout.focusedPaneId=target.id;
 }else if(action==='view.move'){
  const current=view(payload.viewId),target=pane(payload.paneId),index=z.number().int().min(0).max(100).parse(payload.index??target.viewIds.length);unassign(current.id);target.viewIds.splice(Math.min(index,target.viewIds.length),0,current.id);target.activeViewId=current.id;target.collapsed=false;layout.focusedPaneId=target.id;
 }else if(action==='view.activate'){
  const target=pane(payload.paneId),current=view(payload.viewId);if(!target.viewIds.includes(current.id))invalid('This tab does not belong to the target pane.');target.activeViewId=current.id;target.collapsed=false;layout.focusedPaneId=target.id;
 }else if(action==='view.park')park(view(payload.viewId).id);
 else if(action==='pane.focus')layout.focusedPaneId=pane(payload.paneId).id;
 else if(action==='pane.collapse')pane(payload.paneId).collapsed=z.boolean().parse(payload.collapsed);
 else if(action==='pane.resize'){
  const target=splitNodeById(layout.root,id.parse(payload.splitId));if(!target)invalid('The divider is no longer available.');target!.ratio=z.number().finite().min(.05).max(.95).parse(payload.ratio);
 }else invalid('Unknown split workspace command.');
 if(preserveFocus&&Object.hasOwn(layout.panes,original.focusedPaneId))layout.focusedPaneId=original.focusedPaneId;
 return splitWorkspaceLayoutSchema.parse({...layout,revision:original.revision+1});
}

export function minimumViewSize(view?:SurfaceRef):{width:number;height:number}{
 if(!view)return{width:240,height:180};
 if(view.kind==='thread')return{width:320,height:220};
 if(view.kind==='diff'||view.kind==='pull-request'||view.kind==='linked-pull-requests')return{width:360,height:220};
 if(view.kind==='browser')return{width:320,height:180};
 return{width:240,height:180};
}
export function minimumSplitSize(layout:SplitWorkspaceLayout,node:SplitWorkspaceNode=layout.root):{width:number;height:number}{
 if(node.kind==='pane'){const pane=layout.panes[node.paneId];if(pane?.collapsed)return{width:36,height:36};return minimumViewSize(pane?.activeViewId?layout.views[pane.activeViewId]:undefined);}
 const first=minimumSplitSize(layout,node.first),second=minimumSplitSize(layout,node.second);return node.axis==='horizontal'?{width:first.width+second.width+6,height:Math.max(first.height,second.height)}:{width:Math.max(first.width,second.width),height:first.height+second.height+6};
}
export function splitDropEdge({x,y,width,height}:{x:number;y:number;width:number;height:number}):SplitDropEdge{
 const horizontal=Math.min(64,width*.22),vertical=Math.min(64,height*.22),distances=[{edge:'left' as const,value:x/horizontal},{edge:'right' as const,value:(width-x)/horizontal},{edge:'top' as const,value:y/vertical},{edge:'bottom' as const,value:(height-y)/vertical}].sort((a,b)=>a.value-b.value);
 return distances[0]!.value<1?distances[0]!.edge:'center';
}
