import type {Thread} from '../../../packages/contracts/index.ts';
import type {CanvasLayout,PanelBounds,PanelPlacement} from '../../../packages/contracts/workspace.ts';

export interface CanvasSize {width:number;height:number}
type Viewport=CanvasLayout['viewport'];
export interface CanvasFamilyGroup {key:string;rootThreadId?:string;panelIds:string[];bounds:PanelBounds}
export interface CanvasProjectGroup {key:string;projectId:string;authority:PanelPlacement['binding']['authority'];families:CanvasFamilyGroup[];bounds:PanelBounds}
const finite=(value:number,fallback:number)=>Number.isFinite(value)?value:fallback;
const snap=(value:number)=>Math.round(value/8)*8;
const clampZoom=(zoom:number)=>Math.max(.4,Math.min(2,finite(zoom,1)));
const shown=(panel:PanelPlacement)=>panel.visible&&panel.placement==='canvas';
const effectiveBounds=(panel:PanelPlacement)=>({...panel.bounds,height:panel.collapsed?40:panel.bounds.height});
const authorityKey=(panel:PanelPlacement)=>panel.binding.authority.kind==='local'?'local':`plugin:${panel.binding.authority.pluginId}:${panel.binding.authority.scopeId}`;
export function canvasPoint(point:{x:number;y:number},viewport:Viewport){return {x:(point.x-viewport.x)/viewport.zoom,y:(point.y-viewport.y)/viewport.zoom};}
export function canvasZoom(current:number,direction:-1|0|1){return direction===0?1:clampZoom(Math.round((current+direction*.1)*10)/10);}
export function canvasZoomAt(viewport:Viewport,zoom:number,point:{x:number;y:number}):Viewport {const next=clampZoom(zoom),factor=next/viewport.zoom;return {x:point.x-(point.x-viewport.x)*factor,y:point.y-(point.y-viewport.y)*factor,zoom:next};}
export function snapPanelBounds(bounds:PanelBounds):PanelBounds{return {x:Math.max(-1_000_000,Math.min(1_000_000,snap(finite(bounds.x,0)))),y:Math.max(-1_000_000,Math.min(1_000_000,snap(finite(bounds.y,0)))),width:Math.max(120,Math.min(8192,snap(finite(bounds.width,120)))),height:Math.max(80,Math.min(8192,snap(finite(bounds.height,80))))};}
export const threadParent=(thread:Thread)=>thread.sideParentId??thread.parentThreadId;
export const delegatedThread=(thread:Thread)=>thread.kind==='delegate';
export const threadProject=(thread:Thread)=>thread.projectId??'unassigned';

function rootFor(id:string,threads:Map<string,Thread>,projectId:string,roots?:Map<string,string>){
 const path:string[]=[],positions=new Map<string,number>();let current=id,root=id;
 for(;;){
  const cached=roots?.get(current);
  if(cached!==undefined){root=cached;break;}
  const cycleStart=positions.get(current);
  if(cycleStart!==undefined){root=path.slice(cycleStart).sort()[0];break;}
  positions.set(current,path.length);path.push(current);
  const value=threads.get(current),parentId=value&&threadParent(value),parent=parentId?threads.get(parentId):undefined;
  if(!parent||threadProject(parent)!==projectId){root=current;break;}
  current=parentId!;
 }
 for(const member of path)roots?.set(member,root);
 return root;
}
export function liveProjectRows(threads:Thread[],canvas:Pick<CanvasLayout,'filter'|'projectIds'>){
 const selected=new Set(canvas.projectIds),eligible=threads.filter(thread=>!selected.size||selected.has(threadProject(thread)));
 const byId=new Map(eligible.map(thread=>[thread.id,thread])),roots=new Map<string,string>(),families=new Map<string,{root:string;members:Thread[]}>(),groups=new Map<string,Thread[]>();
 for(const thread of eligible){
  const project=threadProject(thread),root=rootFor(thread.id,byId,project,roots),key=JSON.stringify([project,root]);
  let family=families.get(key);if(!family){family={root,members:[]};families.set(key,family);}
  family.members.push(thread);
 }
 const active=(thread:Thread)=>Boolean(thread.runId)||thread.status==='working'||thread.status==='awaiting_input'||thread.presentation?.pinned;
 for(const {root,members} of families.values()){
  if(canvas.filter!=='all'&&!members.some(active))continue;
  const children=new Map<string,Thread[]>(),seen=new Set<string>();
  for(const member of members){
   const parent=threadParent(member);if(!parent)continue;
   let siblings=children.get(parent);if(!siblings){siblings=[];children.set(parent,siblings);}siblings.push(member);
  }
  const project=threadProject(members[0]);
  let ordered=groups.get(project);if(!ordered){ordered=[];groups.set(project,ordered);}
  const output=ordered;
  const descend=(first:Thread)=>{
   const pending=[first];
   while(pending.length){
    const member=pending.pop()!;if(seen.has(member.id))continue;seen.add(member.id);output.push(member);
    const next=children.get(member.id);
    if(next)for(let index=next.length-1;index>=0;index--)pending.push(next[index]);
   }
  };
  const first=byId.get(root);if(first)descend(first);
  for(const member of members)descend(member);
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([projectId,items])=>({projectId,threads:items}));
}
function union(bounds:PanelBounds[],padding:number,heading:number):PanelBounds {
 const left=Math.min(...bounds.map(value=>value.x))-padding,top=Math.min(...bounds.map(value=>value.y))-heading;
 return {x:left,y:top,width:Math.max(...bounds.map(value=>value.x+value.width))-left+padding,height:Math.max(...bounds.map(value=>value.y+value.height))-top+padding};
}
/** Containers describe existing bindings; they never create a second ownership hierarchy. */
export function groupCanvasPanels(panels:PanelPlacement[],threads:Thread[]=[]):CanvasProjectGroup[]{
 const byThread=new Map(threads.map(thread=>[thread.id,thread])),projects=new Map<string,{projectId:string;authority:CanvasProjectGroup['authority'];families:Map<string,PanelPlacement[]>}>();
 for(const panel of panels.filter(shown)){
  const projectId=panel.binding.projectId??'unassigned',projectKey=JSON.stringify([authorityKey(panel),projectId]);
  let project=projects.get(projectKey);if(!project){project={projectId,authority:panel.binding.authority,families:new Map()};projects.set(projectKey,project);}
  const threadId=panel.binding.threadId,root=threadId&&panel.binding.authority.kind==='local'?rootFor(threadId,byThread,projectId):threadId;
  const familyKey=root??panel.id;project.families.set(familyKey,[...(project.families.get(familyKey)??[]),panel]);
 }
 return [...projects].map(([key,project])=>{
  const families=[...project.families].map(([root,members])=>({key:JSON.stringify([key,root]),rootThreadId:members[0].binding.threadId?root:undefined,panelIds:members.map(panel=>panel.id),bounds:union(members.map(effectiveBounds),16,42)}));
  return {key,projectId:project.projectId,authority:project.authority,families,bounds:union(families.map(family=>family.bounds),16,42)};
 });
}
export function liveThreadPanels(threads:Thread[],canvas:CanvasLayout):PanelPlacement[]{
 const rows=liveProjectRows(threads,canvas),eligible=new Set(rows.flatMap(row=>row.threads.map(thread=>thread.id)));
 // Saved local overrides retain their identities, visibility, placement and bounds.
 const panels=canvas.panels.filter(panel=>panel.binding.authority.kind!=='local'||panel.kind!=='thread'||panel.id!==`live-thread:${canvas.id}:${panel.binding.threadId}`||eligible.has(panel.binding.threadId!));
 const bound=new Set(panels.filter(panel=>panel.kind==='thread'&&panel.binding.authority.kind==='local').map(panel=>panel.binding.threadId));
 const generated:PanelPlacement[]=[];
 for(const row of rows)for(const thread of row.threads)if(!bound.has(thread.id))generated.push({id:`live-thread:${canvas.id}:${thread.id}`,kind:'thread',binding:{authority:{kind:'local'},threadId:thread.id,...(threadProject(thread)!=='unassigned'?{projectId:threadProject(thread)}:{})},canvasId:canvas.id,placement:'canvas',visible:true,collapsed:false,bounds:{x:48,y:104,width:threadParent(thread)?360:520,height:threadParent(thread)?320:560},order:generated.length,alwaysOnTop:false});
 const arranged=arrangeCanvasPanels([...panels,...generated],'all-agents',{width:1440,height:900},threads),byThread=new Map(threads.map(thread=>[thread.id,thread])),occupied=panels.filter(shown),placed:PanelPlacement[]=[];
 for(const panel of generated){
  let bounds=arranged.get(panel.id)??panel.bounds;
  const project=panel.binding.projectId??'unassigned',root=rootFor(panel.binding.threadId!,byThread,project),anchor=occupied.find(value=>value.kind==='thread'&&value.binding.authority.kind==='local'&&(value.binding.projectId??'unassigned')===project&&value.binding.threadId&&rootFor(value.binding.threadId,byThread,project)===root);
  const plannedAnchor=anchor&&arranged.get(anchor.id);if(anchor&&plannedAnchor)bounds=snapPanelBounds({...bounds,x:bounds.x+anchor.bounds.x-plannedAnchor.x,y:bounds.y+anchor.bounds.y-plannedAnchor.y});
  if([...occupied,...placed].some(value=>overlaps(bounds,effectiveBounds(value))))bounds=findCanvasPanelBounds([...occupied,...placed],{x:24-bounds.x,y:24-bounds.y,zoom:1},{width:1440,height:900},bounds);
  placed.push({...panel,bounds});
 }
 return [...panels,...placed];
}
export function fitCanvasViewport(panels:PanelPlacement[],size:CanvasSize,padding=24):Viewport {
 const bounds=panels.filter(shown).map(effectiveBounds);if(!bounds.length)return {x:0,y:0,zoom:1};
 const area=union(bounds,0,0),zoom=clampZoom(Math.min(1,Math.max(1,size.width-padding*2)/Math.max(1,area.width),Math.max(1,size.height-padding*2)/Math.max(1,area.height)));
 return {x:(size.width-area.width*zoom)/2-area.x*zoom,y:(size.height-area.height*zoom)/2-area.y*zoom,zoom};
}
const overlaps=(a:PanelBounds,b:PanelBounds,gap=16)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
export function findCanvasPanelBounds(panels:PanelPlacement[],viewport:Viewport,size:CanvasSize,preferred:Partial<Pick<PanelBounds,'width'|'height'>>={}):PanelBounds {
 const start=canvasPoint({x:24,y:24},viewport),width=Math.max(240,Math.min(preferred.width??520,Math.max(240,(size.width-48)/viewport.zoom))),height=Math.max(180,Math.min(preferred.height??440,Math.max(180,(size.height-48)/viewport.zoom))),occupied=panels.filter(shown).map(effectiveBounds),columns=Math.max(1,Math.floor((size.width/viewport.zoom-32)/(width+24)));
 const rows=Math.max(1,Math.floor((size.height/viewport.zoom-32)/(height+24)));
 for(let index=0;index<columns*rows;index++){
  const next=snapPanelBounds({x:start.x+(index%columns)*(width+24),y:start.y+Math.floor(index/columns)*(height+24),width,height});
  if(!occupied.some(bounds=>overlaps(next,bounds)))return next;
 }
 const edge=canvasPoint({x:size.width-24,y:size.height-24},viewport),offset=24*(occupied.length%5);
 return snapPanelBounds({x:Math.min(start.x+offset,Math.max(start.x,edge.x-width)),y:Math.min(start.y+offset,Math.max(start.y,edge.y-height)),width,height});
}
export function arrangeCanvasPanels(panels:PanelPlacement[],preset:CanvasLayout['preset'],size:CanvasSize,threads:Thread[]=[]):Map<string,PanelBounds>{
 const visible=panels.filter(shown),result=new Map<string,PanelBounds>(),width=Math.max(640,size.width-48),height=Math.max(520,size.height-48);
 const set=(panel:PanelPlacement,bounds:PanelBounds)=>result.set(panel.id,snapPanelBounds(bounds));
 if(preset==='all-agents'){
  let projectY=104;
  for(const project of groupCanvasPanels(visible,threads)){
   let familyY=projectY;
   for(const family of project.families){
    const members=family.panelIds.map(id=>visible.find(panel=>panel.id===id)!),main=members.find(panel=>panel.kind==='thread'&&panel.binding.threadId===family.rootThreadId)??members[0],children=members.filter(panel=>panel!==main);
    set(main,{x:48,y:familyY,width:520,height:560});let childY=familyY;
    for(const child of children){set(child,{x:592,y:childY,width:360,height:320});childY+=344;}
    familyY+=Math.max(560,children.length*344-24)+88;
   }
   projectY=familyY+48;
  }
  return result;
 }
 if(preset==='code-review'){
  const files=visible.find(panel=>panel.kind==='files'),diff=visible.find(panel=>panel.kind==='diff'),terminal=visible.find(panel=>panel.kind==='terminal'),prs=visible.find(panel=>panel.kind==='linked-pull-requests'||panel.kind==='pull-request'),left=Math.max(240,Math.round(width*.27)),right=width-left-24,top=Math.round(height*.62);
  if(files)set(files,{x:24,y:24,width:left,height:top});if(diff)set(diff,{x:48+left,y:24,width:right,height:top});
  if(terminal)set(terminal,{x:24,y:48+top,width:Math.round((width-24)/2),height:height-top-24});if(prs)set(prs,{x:48+Math.round((width-24)/2),y:48+top,width:Math.round((width-24)/2),height:height-top-24});
 }
 if(preset==='research'){
  const chat=visible.find(panel=>panel.kind==='thread'),sources=visible.find(panel=>panel.kind==='files'),notes=visible.find(panel=>String(panel.kind)==='notes'),left=Math.round(width*.62),right=width-left-24;
  if(chat)set(chat,{x:24,y:24,width:left,height});if(sources)set(sources,{x:48+left,y:24,width:right,height:Math.round((height-24)*.5)});if(notes)set(notes,{x:48+left,y:48+Math.round((height-24)*.5),width:right,height:Math.round((height-24)*.5)});
 }
 const occupied=visible.filter(panel=>result.has(panel.id)).map(panel=>({...panel,bounds:result.get(panel.id)!}));
 for(const panel of visible)if(!result.has(panel.id)){const bounds=findCanvasPanelBounds(occupied,{x:0,y:0,zoom:1},size,{width:width>=1000?Math.round((width-24)/2):width,height:440});set(panel,bounds);occupied.push({...panel,bounds});}
 return result;
}
export function panelInViewport(bounds:PanelBounds,viewport:Viewport,size:CanvasSize,overscan=160){const x=bounds.x*viewport.zoom+viewport.x,y=bounds.y*viewport.zoom+viewport.y;return x+bounds.width*viewport.zoom>=-overscan&&y+bounds.height*viewport.zoom>=-overscan&&x<=size.width+overscan&&y<=size.height+overscan;}
